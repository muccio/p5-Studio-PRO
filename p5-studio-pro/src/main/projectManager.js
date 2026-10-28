import fs from 'fs';
import path from 'path';
import http from 'http';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.glsl': 'text/plain; charset=utf-8',
  '.vert': 'text/plain; charset=utf-8',
  '.frag': 'text/plain; charset=utf-8',
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

      // Handle Shader Preprocessor API endpoint: /api/shader?file=effect.frag
      if (reqPath === '/api/shader') {
        const fileParam = parsedUrl.searchParams.get('file');
        if (!fileParam) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing ?file parameter' }));
          return;
        }

        try {
          const preprocessed = this.preprocessShader(fileParam);
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

      const filePath = path.join(this.projectPath, reqPath);

      // Prevent directory traversal
      if (!filePath.startsWith(this.projectPath)) {
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
      if (['.frag', '.vert', '.glsl'].includes(ext)) {
        const relativeFile = path.relative(this.projectPath, filePath);
        const preprocessed = this.preprocessShader(relativeFile);
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
        if (filename.startsWith('.') || filename.includes('node_modules') || filename.includes('.takes')) {
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
          const isShader = ['.frag', '.vert', '.glsl'].includes(ext);

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
      // Ignore hidden files, node_modules, and .takes
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.takes') {
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
  preprocessShader(entryRelativePath) {
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
      const absolutePath = path.resolve(currentDir, filePath);
      const relativeNorm = path.relative(this.projectPath, absolutePath).replace(/\\/g, '/');

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

    const entryFullPath = path.resolve(this.projectPath, entryRelativePath);
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
}
