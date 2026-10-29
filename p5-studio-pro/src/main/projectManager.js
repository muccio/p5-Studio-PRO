import fs from 'fs';
import path from 'path';
import http from 'http';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SHADER_EXTENSIONS = new Set([
  '.glsl', '.vert', '.frag', '.fs', '.vs', '.fsh', '.vsh',
  '.shader', '.comp', '.geom', '.tesc', '.tese', '.glslf', '.glslv'
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.glsl': 'text/plain; charset=utf-8',
  '.vert': 'text/plain; charset=utf-8',
  '.frag': 'text/plain; charset=utf-8',
  '.fs': 'text/plain; charset=utf-8',
  '.vs': 'text/plain; charset=utf-8',
  '.fsh': 'text/plain; charset=utf-8',
  '.vsh': 'text/plain; charset=utf-8',
  '.shader': 'text/plain; charset=utf-8',
  '.comp': 'text/plain; charset=utf-8',
  '.geom': 'text/plain; charset=utf-8',
  '.tesc': 'text/plain; charset=utf-8',
  '.tese': 'text/plain; charset=utf-8',
  '.glslf': 'text/plain; charset=utf-8',
  '.glslv': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
};

export class ProjectManager extends EventEmitter {
  constructor(initialProjectPath = null) {
    super();
    this.projectPath = initialProjectPath;
    this.httpServer = null;
    this.serverPort = 0;
    this.watcher = null;
    this.watchDebounceTimers = new Map();
    if (this.projectPath && fs.existsSync(this.projectPath)) {
      this._startWatcher();
    }
  }

  /**
   * Set active project directory and re-initialize server & watcher
   */
  async setProjectPath(newPath) {
    if (!fs.existsSync(newPath)) {
      throw new Error(`Project directory does not exist: ${newPath}`);
    }

    this.projectPath = path.resolve(newPath);
    this._stopWatcher();
    this._startWatcher();

    if (!this.httpServer) {
      await this.startServer();
    }

    this.emit('project:changed', {
      projectPath: this.projectPath,
      serverUrl: this.getServerUrl()
    });

    return {
      projectPath: this.projectPath,
      serverUrl: this.getServerUrl()
    };
  }

  getProjectPath() {
    return this.projectPath;
  }

  getServerUrl() {
    if (!this.httpServer || !this.serverPort) return null;
    return `http://127.0.0.1:${this.serverPort}`;
  }

  /**
   * Start local HTTP server to host project files
   */
  startServer(preferredPort = 0) {
    return new Promise((resolve, reject) => {
      if (this.httpServer) {
        return resolve(this.serverPort);
      }

      this.httpServer = http.createServer((req, res) => {
        this._handleHttpRequest(req, res);
      });

      this.httpServer.on('error', (err) => {
        console.error('[ProjectServer] HTTP Server error:', err);
      });

      this.httpServer.listen(preferredPort, '127.0.0.1', () => {
        const addr = this.httpServer.address();
        this.serverPort = addr.port;
        console.log(`[ProjectServer] Local project server running at http://127.0.0.1:${this.serverPort}`);
        resolve(this.serverPort);
      });
    });
  }

  stopServer() {
    this._stopWatcher();
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
      this.serverPort = 0;
    }
  }

  /**
   * Request handler for local project HTTP server
   */
  _handleHttpRequest(req, res) {
    // Enable CORS and Cross-Origin isolation headers for SharedArrayBuffer / AudioWorklet
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      const parsedUrl = new URL(req.url, `http://127.0.0.1:${this.serverPort}`);
      let reqPath = decodeURIComponent(parsedUrl.pathname);

      // Serve Sandbox Runtime Script
      if (reqPath === '/sandboxRuntime.js' || reqPath === '/__sandboxRuntime.js') {
        const candidates = [
          path.join(__dirname, 'sandboxRuntime.js'),
          path.join(__dirname, '../main/sandboxRuntime.js'),
          path.join(process.resourcesPath || '', 'app.asar/src/main/sandboxRuntime.js'),
          path.join(process.resourcesPath || '', 'app.asar.unpacked/src/main/sandboxRuntime.js')
        ];
        const runtimePath = candidates.find(p => p && fs.existsSync(p));
        if (runtimePath) {
          res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
          const code = fs.readFileSync(runtimePath, 'utf-8');
          res.end(code);
          return;
        }
      }

      // Check for Live Stage Output namespace: /__live/...
      const isLiveRequest = reqPath === '/__live' || reqPath.startsWith('/__live/');
      if (isLiveRequest) {
        reqPath = reqPath.slice(7); // strip '/__live'
        if (reqPath === '' || reqPath === '/') {
          reqPath = '/index.html';
        }
      }

      // Root directory for this request: either .live_buffer or canonical projectPath!
      const rootDir = isLiveRequest
        ? path.join(this.projectPath, '.live_buffer')
        : this.projectPath;

      // Handle Shader Preprocessor API endpoint: /api/shader?file=effect.frag
      if (reqPath === '/api/shader') {
        const fileParam = parsedUrl.searchParams.get('file');
        if (!fileParam) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing ?file parameter' }));
          return;
        }

        try {
          const preprocessed = this.preprocessShader(fileParam, rootDir);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(preprocessed));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      if (reqPath === '/' || reqPath === '') {
        reqPath = '/index.html';
      }

      let filePath = path.join(rootDir, reqPath);

      // If live buffer request and file doesn't exist yet in buffer, fallback to projectPath
      if (isLiveRequest && !fs.existsSync(filePath)) {
        filePath = path.join(this.projectPath, reqPath);
      }

      // Prevent directory traversal
      if (!filePath.startsWith(rootDir) && !filePath.startsWith(this.projectPath)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }

      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`File Not Found: ${reqPath}`);
        return;
      }

      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        const indexPath = path.join(filePath, 'index.html');
        if (fs.existsSync(indexPath)) {
          this._serveFile(indexPath, res);
        } else {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('Directory listing forbidden');
        }
        return;
      }

      // Check if it's a shader file directly requested via HTTP: preprocess it!
      const ext = path.extname(filePath).toLowerCase();
      if (SHADER_EXTENSIONS.has(ext)) {
        const relativeFile = path.relative(rootDir, filePath);
        const preprocessed = this.preprocessShader(relativeFile, rootDir);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(preprocessed.code);
        return;
      }

      this._serveFile(filePath, res);
    } catch (err) {
      console.error('[ProjectServer] Request error:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Internal Server Error: ${err.message}`);
    }
  }

  _serveFile(filePath, res) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Auto-inject sandboxRuntime into HTML sketches
    if (ext === '.html') {
      try {
        let html = fs.readFileSync(filePath, 'utf-8');
        if (!html.includes('sandboxRuntime.js')) {
          const injection = '<script src="/sandboxRuntime.js"></script>\n';
          if (html.includes('<head>')) {
            html = html.replace('<head>', '<head>\n  ' + injection);
          } else if (html.includes('<html>')) {
            html = html.replace('<html>', '<html>\n<head>' + injection + '</head>');
          } else {
            html = injection + html;
          }
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      } catch (e) {
        console.warn('[ProjectManager] Failed to inject runtime into html, falling back to stream:', e);
      }
    }

    const stream = fs.createReadStream(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    stream.pipe(res);
  }

  /**
   * Watch project directory for live file changes
   */
  _startWatcher() {
    if (!this.projectPath || !fs.existsSync(this.projectPath)) return;

    try {
      this.watcher = fs.watch(this.projectPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        // Ignore internal files
        if (filename.startsWith('.') || filename.includes('node_modules') || filename.includes('.takes') || filename.includes('.live_buffer')) {
          return;
        }

        // Debounce to prevent duplicate editor notifications
        if (this.watchDebounceTimers.has(filename)) {
          clearTimeout(this.watchDebounceTimers.get(filename));
        }

        const timer = setTimeout(() => {
          this.watchDebounceTimers.delete(filename);
          const fullPath = path.join(this.projectPath, filename);
          const exists = fs.existsSync(fullPath);
          const ext = path.extname(filename).toLowerCase();
          const isShader = SHADER_EXTENSIONS.has(ext);

          this.emit('file:changed', {
            filename,
            fullPath,
            eventType,
            exists,
            isShader
          });
        }, 100);

        this.watchDebounceTimers.set(filename, timer);
      });
    } catch (err) {
      console.warn('[ProjectManager] File watcher initialization warning:', err.message);
    }
  }

  _stopWatcher() {
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch (e) {}
      this.watcher = null;
    }
    for (const timer of this.watchDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.watchDebounceTimers.clear();
  }

  /**
   * List files in the project recursively for the file tree
   */
  listFiles(dir = this.projectPath) {
    if (!dir || !fs.existsSync(dir)) return [];

    const results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Ignore hidden files, node_modules, .takes, and .live_buffer
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.takes' || entry.name === '.live_buffer') {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(this.projectPath, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        results.push({
          name: entry.name,
          path: relativePath,
          fullPath,
          type: 'directory',
          children: this.listFiles(fullPath)
        });
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        results.push({
          name: entry.name,
          path: relativePath,
          fullPath,
          type: 'file',
          ext,
          size: fs.statSync(fullPath).size
        });
      }
    }

    return results;
  }

  /**
   * Commit/swap the active staging workspace files into the isolated Live Stage buffer (.live_buffer)
   */
  commitToLiveBuffer() {
    if (!this.projectPath || !fs.existsSync(this.projectPath)) return { success: false };

    const bufferDir = path.join(this.projectPath, '.live_buffer');
    if (!fs.existsSync(bufferDir)) {
      fs.mkdirSync(bufferDir, { recursive: true });
    }

    const copyRecursive = (src, dest) => {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
      }
      const entries = fs.readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          entry.name === '.takes' ||
          entry.name === '.live_buffer'
        ) {
          continue;
        }
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          copyRecursive(srcPath, destPath);
        } else {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    };

    copyRecursive(this.projectPath, bufferDir);
    return { success: true, timestamp: Date.now() };
  }

  readFile(relativePath) {
    const fullPath = path.resolve(this.projectPath, relativePath);
    if (!fullPath.startsWith(this.projectPath)) {
      throw new Error('Access outside project root is forbidden');
    }
    return fs.readFileSync(fullPath, 'utf-8');
  }

  writeFile(relativePath, content) {
    const fullPath = path.resolve(this.projectPath, relativePath);
    if (!fullPath.startsWith(this.projectPath)) {
      throw new Error('Access outside project root is forbidden');
    }

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content, 'utf-8');
    return { success: true, path: relativePath };
  }

  createItem(relativePath, type = 'file') {
    const fullPath = path.resolve(this.projectPath, relativePath);
    if (!fullPath.startsWith(this.projectPath)) {
      throw new Error('Access outside project root is forbidden');
    }

    if (fs.existsSync(fullPath)) {
      throw new Error(`Item already exists: ${relativePath}`);
    }

    if (type === 'directory') {
      fs.mkdirSync(fullPath, { recursive: true });
    } else {
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(fullPath, '', 'utf-8');
    }

    return { success: true, path: relativePath, type };
  }

  deleteItem(relativePath) {
    const fullPath = path.resolve(this.projectPath, relativePath);
    if (!fullPath.startsWith(this.projectPath)) {
      throw new Error('Access outside project root is forbidden');
    }

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Item not found: ${relativePath}`);
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(fullPath);
    }

    return { success: true, path: relativePath };
  }

  renameItem(oldRelativePath, newRelativePath) {
    const oldFullPath = path.resolve(this.projectPath, oldRelativePath);
    const newFullPath = path.resolve(this.projectPath, newRelativePath);

    if (!oldFullPath.startsWith(this.projectPath) || !newFullPath.startsWith(this.projectPath)) {
      throw new Error('Access outside project root is forbidden');
    }

    if (!fs.existsSync(oldFullPath)) {
      throw new Error(`Item not found: ${oldRelativePath}`);
    }

    if (fs.existsSync(newFullPath)) {
      throw new Error(`Target already exists: ${newRelativePath}`);
    }

    fs.renameSync(oldFullPath, newFullPath);
    return { success: true, oldPath: oldRelativePath, newPath: newRelativePath };
  }

  /**
   * Recursive GLSL #include Preprocessor
   * Resolves `#include "path/file.glsl"` directives, injects #line directives,
   * tracks source files, and builds error mapping table.
   */
  preprocessShader(entryRelativePath, baseDir = this.projectPath) {
    const sourceTable = []; // Array of filenames: index is sourceStringNumber
    const sourceMap = new Map(); // filename -> sourceStringNumber

    const getSourceId = (filePath) => {
      const norm = path.normalize(filePath).replace(/\\/g, '/');
      if (sourceMap.has(norm)) {
        return sourceMap.get(norm);
      }
      const id = sourceTable.length;
      sourceTable.push(norm);
      sourceMap.set(norm, id);
      return id;
    };

    const visitedFiles = new Set();

    const resolveIncludes = (filePath, currentDir) => {
      let absolutePath = path.resolve(currentDir, filePath);
      if (!fs.existsSync(absolutePath) && baseDir !== this.projectPath) {
        const fallback = path.resolve(this.projectPath, filePath);
        if (fs.existsSync(fallback)) absolutePath = fallback;
      }
      const relativeNorm = path.relative(baseDir, absolutePath).replace(/\\/g, '/');

      if (!fs.existsSync(absolutePath)) {
        throw new Error(`GLSL #include file not found: "${filePath}" (resolved to ${relativeNorm})`);
      }

      if (visitedFiles.has(absolutePath)) {
        // Prevent circular includes by skipping already included header files
        return `// #include "${filePath}" already visited\n`;
      }
      visitedFiles.add(absolutePath);

      const sourceId = getSourceId(relativeNorm);
      const rawContent = fs.readFileSync(absolutePath, 'utf-8');
      const lines = rawContent.split(/\r?\n/);
      const outputLines = [];

      // Inject #line 1 <sourceId> so compiler errors reference this file
      outputLines.push(`#line 1 ${sourceId}`);

      const includeRegex = /^\s*#include\s+["<]([^">]+)[">]/;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(includeRegex);

        if (match) {
          const includePath = match[1];
          const includedCode = resolveIncludes(includePath, path.dirname(absolutePath));
          outputLines.push(includedCode);
          // Restore line numbering in current file after include returns
          outputLines.push(`#line ${i + 2} ${sourceId}`);
        } else {
          outputLines.push(line);
        }
      }

      return outputLines.join('\n');
    };

    let entryFullPath = path.resolve(baseDir, entryRelativePath);
    if (!fs.existsSync(entryFullPath) && baseDir !== this.projectPath) {
      entryFullPath = path.resolve(this.projectPath, entryRelativePath);
    }
    const entryDir = path.dirname(entryFullPath);
    const code = resolveIncludes(path.basename(entryFullPath), entryDir);

    return {
      code,
      sourceTable,
      entryFile: entryRelativePath
    };
  }

  /**
   * Parse WebGL shader compiler log and map back to exact source file and line
   * Typical WebGL error logs:
   * ERROR: 1:25: 'foo' : undeclared identifier
   * 0:14: S0002: syntax error
   */
  mapCompilerErrors(infoLog, sourceTable = []) {
    if (!infoLog) return [];

    const errors = [];
    const lines = infoLog.split('\n');

    // Regex handles 'ERROR: sourceId:line: message' or 'sourceId:line: message'
    const errorRegex = /(?:ERROR:\s*)?(\d+):(\d+):\s*(.*)/i;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const match = trimmed.match(errorRegex);
      if (match) {
        const sourceId = parseInt(match[1], 10);
        const lineNumber = parseInt(match[2], 10);
        const message = match[3] || 'Shader compilation error';
        const file = sourceTable[sourceId] || `source_${sourceId}`;

        errors.push({
          raw: trimmed,
          sourceId,
          file,
          line: lineNumber,
          message
        });
      } else {
        errors.push({
          raw: trimmed,
          sourceId: 0,
          file: sourceTable[0] || 'shader',
          line: 1,
          message: trimmed
        });
      }
    }

    return errors;
  }

  /**
   * Get active p5.js version from project configuration or index.html
   */
  getP5Version() {
    if (!this.projectPath) return '1.11.2';
    const configPath = path.join(this.projectPath, 'project.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.p5Version) return config.p5Version;
      } catch (e) {}
    }

    const indexPath = path.join(this.projectPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      try {
        const html = fs.readFileSync(indexPath, 'utf-8');
        const matchCdn = html.match(/p5\.js\/([0-9\.\-beta]+)\/p5(?:\.min)?\.js/i);
        if (matchCdn) return matchCdn[1];
        const matchUnpkg = html.match(/p5@([0-9\.\-beta]+)\/lib\/p5(?:\.min)?\.js/i);
        if (matchUnpkg) return matchUnpkg[1];
        if (html.includes('p5.min.js')) return 'local';
      } catch (e) {}
    }
    return '1.11.2';
  }

  /**
   * Set p5.js version in project.json and rewrite script tag in index.html
   */
  setP5Version(version) {
    if (!this.projectPath) throw new Error('No active project path set');

    // 1. Update project.json
    const configPath = path.join(this.projectPath, 'project.json');
    let config = {};
    if (fs.existsSync(configPath)) {
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch (e) {
        config = {};
      }
    }
    config.p5Version = version;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    // 2. Update index.html script tag
    const indexPath = path.join(this.projectPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      let html = fs.readFileSync(indexPath, 'utf-8');
      let scriptTag = '';
      if (version === 'local') {
        scriptTag = '<script src="./p5.min.js"></script>';
      } else if (version.startsWith('2.0')) {
        scriptTag = `<script src="https://unpkg.com/p5@${version}/lib/p5.min.js"></script>`;
      } else {
        scriptTag = `<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/${version}/p5.min.js"></script>`;
      }

      // Replace existing p5 script reference
      const p5Regex = /<script\s+src=["'][^"']*(?:p5(?:\.min)?\.js|p5@[^"']+)["']\s*><\/script>/i;
      if (p5Regex.test(html)) {
        html = html.replace(p5Regex, scriptTag);
      } else {
        // Inject before sketch.js or before </head>
        if (html.includes('<script src="./sketch.js">')) {
          html = html.replace('<script src="./sketch.js">', `${scriptTag}\n  <script src="./sketch.js">`);
        } else if (html.includes('</head>')) {
          html = html.replace('</head>', `  ${scriptTag}\n</head>`);
        }
      }
      fs.writeFileSync(indexPath, html, 'utf-8');
    }

    return { success: true, version };
  }

  /**
   * Get available p5 libraries catalog and currently active libraries in project
   */
  getP5Libraries() {
    let enabledLibraries = [];
    if (this.projectPath) {
      const configPath = path.join(this.projectPath, 'project.json');
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          if (Array.isArray(config.libraries)) {
            enabledLibraries = config.libraries;
          }
        } catch (e) {}
      }

      const indexPath = path.join(this.projectPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        try {
          const html = fs.readFileSync(indexPath, 'utf-8');
          for (const lib of P5_LIBRARIES_CATALOG) {
            if (!enabledLibraries.includes(lib.id)) {
              if (html.includes(lib.cdnUrl) || (lib.additionalCdnUrls && lib.additionalCdnUrls.some(u => html.includes(u)))) {
                enabledLibraries.push(lib.id);
              }
            }
          }
        } catch (e) {}
      }
    }

    return {
      catalog: P5_LIBRARIES_CATALOG,
      enabledLibraries
    };
  }

  /**
   * Enable or disable a p5.js library in project.json and index.html
   */
  toggleP5Library(libId, enabled) {
    if (!this.projectPath) throw new Error('No active project path set');

    const lib = P5_LIBRARIES_CATALOG.find(l => l.id === libId);
    if (!lib) throw new Error(`Library not found: ${libId}`);

    // 1. Update project.json
    const configPath = path.join(this.projectPath, 'project.json');
    let config = {};
    if (fs.existsSync(configPath)) {
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch (e) {
        config = {};
      }
    }
    if (!Array.isArray(config.libraries)) {
      config.libraries = [];
    }

    if (enabled) {
      if (!config.libraries.includes(libId)) {
        config.libraries.push(libId);
      }
    } else {
      config.libraries = config.libraries.filter(id => id !== libId);
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    // 2. Update index.html
    const indexPath = path.join(this.projectPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      let html = fs.readFileSync(indexPath, 'utf-8');
      const urls = [lib.cdnUrl, ...(lib.additionalCdnUrls || [])];

      if (enabled) {
        // Add script tags if missing
        for (const url of urls) {
          if (!html.includes(url)) {
            const scriptTag = `<script src="${url}"></script>`;
            if (html.includes('<script src="./sketch.js">')) {
              html = html.replace('<script src="./sketch.js">', `${scriptTag}\n  <script src="./sketch.js">`);
            } else if (html.includes('</body>')) {
              html = html.replace('</body>', `  ${scriptTag}\n</body>`);
            } else {
              html += `\n${scriptTag}`;
            }
          }
        }
      } else {
        // Remove script tags
        for (const url of urls) {
          const escaped = url.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
          const scriptRegex = new RegExp(`[ \\t]*<script\\s+src=["']${escaped}["']\\s*><\\/script>\\r?\\n?`, 'gi');
          html = html.replace(scriptRegex, '');
        }
      }
      fs.writeFileSync(indexPath, html, 'utf-8');
    }

    return {
      success: true,
      libId,
      enabled,
      enabledLibraries: config.libraries
    };
  }
}

export const P5_LIBRARIES_CATALOG = [
  {
    id: 'p5.sound',
    name: 'p5.sound',
    category: 'Audio & Music',
    description: 'Libreria audio ufficiale per sintesi sonora, effetti, microfono e analisi FFT.',
    cdnUrl: 'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.11.2/addons/p5.sound.min.js',
    website: 'https://p5js.org/reference/#/libraries/p5.sound'
  },
  {
    id: 'ml5',
    name: 'ml5.js',
    category: 'Machine Learning & AI',
    description: 'Machine Learning accessibile per creative coding: PoseNet, HandPose, FaceMesh e Image Classifier.',
    cdnUrl: 'https://unpkg.com/ml5@1/dist/ml5.min.js',
    website: 'https://ml5js.org/'
  },
  {
    id: 'tweakpane',
    name: 'Tweakpane',
    category: 'UI & Controls',
    description: 'Pannello di controllo compatto ed elegante per calibrare parametri e uniform in tempo reale.',
    cdnUrl: 'https://cdn.jsdelivr.net/npm/tweakpane@4.0.3/dist/tweakpane.min.js',
    website: 'https://cocopon.github.io/tweakpane/'
  },
  {
    id: 'p5.gui',
    name: 'p5.gui',
    category: 'UI & Controls',
    description: 'Crea automaticamente slider, checkbox e color picker per le variabili dello sketch.',
    cdnUrl: 'https://cdn.jsdelivr.net/gh/bitcraftlab/p5.gui/libraries/p5.gui.js',
    website: 'https://github.com/bitcraftlab/p5.gui'
  },
  {
    id: 'p5.brush',
    name: 'p5.brush',
    category: 'Generative & Visual FX',
    description: 'Pennelli artistici digitali in WEBGL: acquerello, acrilico, pennarelli e texture organiche.',
    cdnUrl: 'https://cdn.jsdelivr.net/npm/p5.brush@latest/dist/p5.brush.min.js',
    website: 'https://github.com/acamposuribe/p5.brush'
  },
  {
    id: 'p5.scribble',
    name: 'p5.scribble',
    category: 'Generative & Visual FX',
    description: 'Disegna primitive 2D con un look organico fatto a mano stile sketch/bozzetto su carta.',
    cdnUrl: 'https://cdn.jsdelivr.net/gh/generative-light/p5.scribble.js/p5.scribble.js',
    website: 'https://github.com/generative-light/p5.scribble.js'
  },
  {
    id: 'p5.glitch',
    name: 'p5.glitch',
    category: 'Generative & Visual FX',
    description: 'Manipolazione glitch art, corruzione di immagini binarie e byte sorting in tempo reale.',
    cdnUrl: 'https://cdn.jsdelivr.net/npm/p5.glitch@latest/p5.glitch.js',
    website: 'https://github.com/ffd8/p5.glitch'
  },
  {
    id: 'simplex-noise',
    name: 'simplex-noise',
    category: 'Math & Algorithms',
    description: 'Generatore rapido di rumore coerente Simplex Noise in 2D, 3D e 4D senza discontinuità.',
    cdnUrl: 'https://cdnjs.cloudflare.com/ajax/libs/simplex-noise/2.4.0/simplex-noise.min.js',
    website: 'https://github.com/jwagner/simplex-noise.js'
  },
  {
    id: 'matter-js',
    name: 'Matter.js',
    category: 'Physics & Simulation',
    description: 'Motore fisico 2D per corpi rigidi, collisioni, gravità, molle e vincoli elastici.',
    cdnUrl: 'https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js',
    website: 'https://brm.io/matter-js/'
  },
  {
    id: 'p5play',
    name: 'p5.play (v3 / planck)',
    category: 'Physics & Simulation',
    description: 'Motore di gioco e fisica con sprite interattivi, hitbox e animazioni.',
    cdnUrl: 'https://p5play.org/v3/planck.min.js',
    additionalCdnUrls: ['https://p5play.org/v3/p5play.js'],
    website: 'https://p5play.org/'
  },
  {
    id: 'p5.serialport',
    name: 'p5.serialport',
    category: 'Hardware & IoT',
    description: 'Comunicazione seriale con Arduino, microcontrollori e sensori fisici esterni.',
    cdnUrl: 'https://cdn.jsdelivr.net/npm/p5.serialport@latest/lib/p5.serialport.js',
    website: 'https://github.com/p5-serial/p5.serialport'
  },
  {
    id: 'p5.ble',
    name: 'p5.ble',
    category: 'Hardware & IoT',
    description: 'Comunicazione wireless Bluetooth Low Energy (BLE) con micro:bit, sensori e wearable.',
    cdnUrl: 'https://unpkg.com/p5.ble@0.0.7/dist/p5.ble.min.js',
    website: 'https://github.com/ITPNYU/p5.ble'
  },
  {
    id: 'p5.speech',
    name: 'p5.speech',
    category: 'Audio & Voice',
    description: 'Riconoscimento vocale (speech-to-text) e sintesi vocale (text-to-speech) via Web Speech API.',
    cdnUrl: 'https://cdn.jsdelivr.net/gh/IDMNYU/p5.js-speech@0.0.3/lib/p5.speech.js',
    website: 'https://github.com/IDMNYU/p5.js-speech'
  },
  {
    id: 'tone',
    name: 'Tone.js',
    category: 'Audio & Music',
    description: 'Framework avanzato Web Audio per sintetizzatori polifonici, sequencing e scheduling musicale.',
    cdnUrl: 'https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js',
    website: 'https://tonejs.github.io/'
  },
  {
    id: 'dat-gui',
    name: 'dat.GUI',
    category: 'UI & Controls',
    description: 'Controller interfaccia classico e ultraleggero per parametri numerici e booleani.',
    cdnUrl: 'https://cdnjs.cloudflare.com/ajax/libs/dat-gui/0.7.9/dat.gui.min.js',
    website: 'https://github.com/dataarts/dat.gui'
  },
  {
    id: 'p5.asciiart',
    name: 'p5.asciiart',
    category: 'Generative & Visual FX',
    description: 'Rendering e conversione di flussi video e canvas in tipografia ASCII art in tempo reale.',
    cdnUrl: 'https://cdn.jsdelivr.net/gh/pawelniewiadomski/p5.asciiart/p5.asciiart.min.js',
    website: 'https://github.com/pawelniewiadomski/p5.asciiart'
  }
];
