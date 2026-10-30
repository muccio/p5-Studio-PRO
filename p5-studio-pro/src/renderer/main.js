import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import 'monaco-editor/esm/vs/language/html/monaco.contribution';
import 'monaco-editor/esm/vs/language/css/monaco.contribution';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import { setupGLSLSupport, setModelDiagnostics, clearModelDiagnostics, isShaderFile } from './glslMonacoSetup.js';
import { setupWebAndScriptSupport, P5_REFERENCE_DOCS, getCategoryForSymbol } from './ideLanguageService.js';

import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_, label) {
    try {
      if (label === 'json') {
        return new jsonWorker();
      }
      if (label === 'css' || label === 'scss' || label === 'less') {
        return new cssWorker();
      }
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new htmlWorker();
      }
      if (label === 'typescript' || label === 'javascript') {
        return new tsWorker();
      }
      return new editorWorker();
    } catch (err) {
      console.warn('[Monaco] Web Worker instantiation error, falling back to basic editor worker:', err);
      return new editorWorker();
    }
  }
};

class IDEApp {
  constructor() {
    window.p5StudioApp = this;
    this.projectInfo = null;
    this.openFiles = new Map(); // relativePath -> { model, viewState, isDirty }
    this.activeFilePath = null;
    this.editor = null;

    // Audio & Take Recording state
    this.isRecordingTake = false;
    this.recordStartTime = 0;
    this.recordTimerInterval = null;
    this.audioContext = null;
    this.workletNode = null;
    this.recordedAudioChunks = [];
    this.recordedSampleCount = 0;
    this.currentTakeDir = null;
    this.latestAudioMetrics = null;

    // UI Audio meters state
    this.fftCanvas = document.getElementById('canvas-fft');
    this.fftCtx = this.fftCanvas.getContext('2d');
    this.waveCanvas = document.getElementById('canvas-waveform');
    this.waveCtx = this.waveCanvas.getContext('2d');

    // Sketch Playback state
    this.isPaused = false;

    // Live Stage safe staging & manual push state
    this.isLiveWindowOpen = false;
    this.isLiveDirty = false;
    this.pendingLiveType = null;
    this.hasShaderErrors = false;
    this.hasJsErrors = false;

    // Editor typography & window appearance state
    const savedFontSize = parseInt(localStorage.getItem('p5_studio_font_size') || '13', 10);
    this.currentFontSize = (!isNaN(savedFontSize) && savedFontSize >= 10 && savedFontSize <= 36) ? savedFontSize : 13;
    this.currentFontFamily = localStorage.getItem('p5_studio_font_family') || "JetBrains Mono, 'Fira Code', Menlo, Consolas, monospace";
    const savedOpacity = parseFloat(localStorage.getItem('p5_studio_window_opacity') || '1.0');
    this.currentWindowOpacity = (!isNaN(savedOpacity) && savedOpacity >= 0.2 && savedOpacity <= 1.0) ? savedOpacity : 1.0;
  }

  async init() {
    setupGLSLSupport();
    this.initMonaco();
    setupWebAndScriptSupport(this.editor);
    this.initEventListeners();
    this.initAudioMeters();
    this.initLiveWindowControls();
    this.initPreviewPopoutControls();
    this.initP5VersionControls();
    this.initP5LibrariesModal();
    this.initP5ReferenceModal();
    this.initAppearanceControls();

    // Restore window opacity from saved preferences
    if (this.currentWindowOpacity !== 1.0) {
      this.setWindowOpacity(this.currentWindowOpacity);
    }

    // Fetch initial project info and file tree
    if (window.electronAPI) {
      this.projectInfo = await window.electronAPI.project.getInfo();
      if (this.projectInfo && this.projectInfo.projectPath) {
        document.getElementById('label-project-name').textContent =
          this.projectInfo.projectPath.split(/[\\/]/).pop();
        await this.refreshFileTree();
        this.loadPreview();
      }

      // Listen for project file changes from main process watcher
      window.electronAPI.project.onFileChanged((change) => {
        this.handleExternalFileChange(change);
      });

      // Listen for OSC messages
      window.electronAPI.osc.onMessage((msg) => {
        this.logOscMessage(msg);
      });

      // Listen for Export progress
      window.electronAPI.export.onProgress((progress) => {
        this.updateExportProgress(progress);
      });

      window.electronAPI.export.onComplete((result) => {
        this.finishExportUI(result);
      });

      window.electronAPI.export.onError((err) => {
        alert(`Export Failed: ${err.message}`);
        this.resetExportUI();
      });
    }

    // Populate Audio Devices
    this.populateAudioDevices();
  }

  // =========================================================================
  // 1. Monaco Editor Initialization & Tab Management
  // =========================================================================
  initMonaco() {
    const container = document.getElementById('monaco-container');

    monaco.editor.defineTheme('p5StudioDark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        // GLSL & Preprocessor
        { token: 'meta.preprocessor', foreground: '00f0ff', fontStyle: 'bold' },
        { token: 'keyword', foreground: 'ff0077', fontStyle: 'bold' },
        { token: 'type', foreground: '00ff88' },
        { token: 'predefined', foreground: 'ffb700' },
        { token: 'variable.predefined', foreground: '00f0ff', fontStyle: 'bold' },
        { token: 'number', foreground: 'ffb700' },
        { token: 'number.float', foreground: 'ffb700' },
        { token: 'number.hex', foreground: 'ffb700' },
        { token: 'string', foreground: 'a0ec70' },
        { token: 'comment', foreground: '546279', fontStyle: 'italic' },
        { token: 'operator', foreground: '00e5ff' },
        { token: 'delimiter', foreground: '8c9ba5' },

        // HTML Syntax Token Colors
        { token: 'tag', foreground: 'ff0077', fontStyle: 'bold' },
        { token: 'tag.html', foreground: 'ff0077', fontStyle: 'bold' },
        { token: 'tag.id', foreground: '00f0ff' },
        { token: 'tag.class', foreground: '00ff88' },
        { token: 'metatag', foreground: 'a0ec70' },
        { token: 'metatag.html', foreground: 'a0ec70' },
        { token: 'metatag.content.html', foreground: 'e6ecf5' },
        { token: 'attribute.name', foreground: '00e5ff' },
        { token: 'attribute.name.html', foreground: '00e5ff' },
        { token: 'attribute.value', foreground: 'a0ec70' },
        { token: 'attribute.value.html', foreground: 'a0ec70' },
        { token: 'delimiter.html', foreground: '788896' },

        // CSS Syntax Token Colors
        { token: 'tag.css', foreground: 'ff0077', fontStyle: 'bold' },
        { token: 'attribute.name.css', foreground: '00e5ff' },
        { token: 'property.name.css', foreground: '00e5ff' },
        { token: 'attribute.value.css', foreground: '00ff88' },
        { token: 'attribute.value.unit', foreground: 'ffb700' },
        { token: 'attribute.value.number', foreground: 'ffb700' },
        { token: 'string.css', foreground: 'a0ec70' },
        { token: 'selector.css', foreground: 'ff0077' },

        // JavaScript & TypeScript Token Colors
        { token: 'identifier.js', foreground: 'e6ecf5' },
        { token: 'variable.js', foreground: 'e6ecf5' },
        { token: 'keyword.js', foreground: 'ff0077', fontStyle: 'bold' }
      ],
      colors: {
        'editor.background': '#0d0f12',
        'editor.foreground': '#e6ecf5',
        'editor.lineHighlightBackground': '#161a22',
        'editorCursor.foreground': '#00f0ff',
        'editorWhitespace.foreground': '#272e3d',
        'editorIndentGuide.background': '#1c222d',
        'editorIndentGuide.activeBackground': '#364053'
      }
    });

    this.editor = monaco.editor.create(container, {
      theme: 'p5StudioDark',
      fontSize: this.currentFontSize || 13,
      fontFamily: this.currentFontFamily || "JetBrains Mono, 'Fira Code', Menlo, Consolas, monospace",
      automaticLayout: true,
      minimap: { enabled: true },
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      tabSize: 2,
      quickSuggestions: {
        other: true,
        comments: false,
        strings: true
      },
      quickSuggestionsDelay: 0,
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnEnter: 'on',
      acceptSuggestionOnCommitCharacter: true,
      tabCompletion: 'on',
      snippetSuggestions: 'top',
      wordBasedSuggestions: 'matchingDocuments',
      suggest: {
        showIcons: true,
        showStatusBar: true,
        preview: true,
        previewMode: 'subwordSmart',
        filterGraceful: true,
        snippetsPreventQuickSuggestions: false,
        showWords: true,
        showFunctions: true,
        showVariables: true,
        showConstants: true,
        showMethods: true,
        showSnippets: true
      },
      parameterHints: {
        enabled: true,
        cycle: true
      }
    });

    // Auto-save on edit with debounce & instant preview update
    let saveTimeout = null;
    this.editor.onDidChangeModelContent(() => {
      if (!this.activeFilePath) return;

      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(async () => {
        const content = this.editor.getValue();
        if (window.electronAPI) {
          await window.electronAPI.project.writeFile(this.activeFilePath, content);
        }
        this.validateActiveShader();

        // Update preview dynamically
        const ext = this.activeFilePath.split('.').pop().toLowerCase();
        const frame = document.getElementById('preview-frame');
        if (isShaderFile(ext)) {
          if (frame && frame.contentWindow) {
            frame.contentWindow.postMessage({ type: 'shader:hotReload' }, '*');
          }
          if (window.electronAPI) {
            if (window.electronAPI.preview) window.electronAPI.preview.notifyShaderHotReload();
            // In Live mode: do NOT push automatically to the external display; mark dirty for manual push!
            if (this.isLiveWindowOpen) {
              this.setLiveStageDirty(true, 'shader');
            }
          }
        } else if (['js', 'jsx', 'ts', 'tsx'].includes(ext)) {
          const isSyntaxValid = this.validateActiveScript(content);
          if (isSyntaxValid) {
            this.restartPreview();
            if (window.electronAPI) {
              if (window.electronAPI.preview) window.electronAPI.preview.reload();
              if (this.isLiveWindowOpen) {
                this.setLiveStageDirty(true, 'code');
              }
            }
          } else {
            // Fault-tolerant Live Coding: keep previous working canvas alive!
            if (this.isLiveWindowOpen) {
              this.setLiveStageDirty(true, 'code');
            }
          }
        } else if (['html', 'htm', 'css', 'json'].includes(ext)) {
          this.restartPreview();
          if (window.electronAPI) {
            if (window.electronAPI.preview) window.electronAPI.preview.reload();
            if (this.isLiveWindowOpen) {
              this.setLiveStageDirty(true, 'code');
            }
          }
        }
      }, 250);
    });

    // Window resize handler
    window.addEventListener('resize', () => {
      this.editor.layout();
    });

    // Prevent accidental drag-drop navigation across IDE workspace
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
  }

  async openFile(relativePath) {
    if (this.openFiles.has(relativePath)) {
      this.setActiveTab(relativePath);
      return;
    }

    try {
      let content = '';
      if (window.electronAPI) {
        content = await window.electronAPI.project.readFile(relativePath);
      }
      const ext = relativePath.split('.').pop().toLowerCase();
      let language = 'javascript';

      if (isShaderFile(ext)) {
        language = 'glsl';
      } else if (ext === 'json') {
        language = 'json';
      } else if (['html', 'htm'].includes(ext)) {
        language = 'html';
      } else if (ext === 'css') {
        language = 'css';
      } else if (['ts', 'tsx'].includes(ext)) {
        language = 'typescript';
      }

      const fileUri = monaco.Uri.file(relativePath);
      const existingModel = monaco.editor.getModel(fileUri);
      if (existingModel) {
        existingModel.dispose();
      }

      const model = monaco.editor.createModel(content, language, fileUri);
      this.openFiles.set(relativePath, {
        model,
        viewState: null
      });

      this.renderTabs();
      this.setActiveTab(relativePath);
    } catch (err) {
      console.error(`Failed to open file: ${relativePath}`, err);
    }
  }

  setActiveTab(relativePath) {
    if (!this.openFiles.has(relativePath)) return;

    if (this.activeFilePath && this.openFiles.has(this.activeFilePath)) {
      this.openFiles.get(this.activeFilePath).viewState = this.editor.saveViewState();
    }

    this.activeFilePath = relativePath;
    const fileRecord = this.openFiles.get(relativePath);
    this.editor.setModel(fileRecord.model);

    if (fileRecord.viewState) {
      this.editor.restoreViewState(fileRecord.viewState);
    }
    this.editor.focus();

    // Clear stale markers when switching or opening tabs
    if (fileRecord.model) {
      monaco.editor.setModelMarkers(fileRecord.model, 'p5-runtime', []);
    }

    document.getElementById('status-file-info').textContent = relativePath;
    this.renderTabs();
    this.highlightActiveTreeItem();
    if (relativePath.endsWith('.js')) {
      this.validateActiveScript(this.editor.getValue());
    } else {
      this.validateActiveShader();
    }
  }

  closeTab(relativePath, event) {
    if (event) event.stopPropagation();
    if (!this.openFiles.has(relativePath)) return;

    const fileRecord = this.openFiles.get(relativePath);
    fileRecord.model.dispose();
    this.openFiles.delete(relativePath);

    if (this.activeFilePath === relativePath) {
      const remaining = Array.from(this.openFiles.keys());
      if (remaining.length > 0) {
        this.setActiveTab(remaining[remaining.length - 1]);
      } else {
        this.activeFilePath = null;
        this.editor.setModel(null);
        document.getElementById('status-file-info').textContent = 'No file open';
      }
    }

    this.renderTabs();
    this.highlightActiveTreeItem();
  }

  renderTabs() {
    const tabsContainer = document.getElementById('editor-tabs');
    tabsContainer.innerHTML = '';

    for (const filePath of this.openFiles.keys()) {
      const tab = document.createElement('div');
      tab.className = `editor-tab ${filePath === this.activeFilePath ? 'active' : ''}`;
      const name = filePath.split('/').pop();

      tab.innerHTML = `
        <span class="tab-label">${name}</span>
        <span class="tab-close" title="Close Tab">&times;</span>
      `;

      tab.addEventListener('click', () => this.setActiveTab(filePath));
      tab.querySelector('.tab-close').addEventListener('click', (e) => this.closeTab(filePath, e));

      tabsContainer.appendChild(tab);
    }
  }

  async validateActiveShader() {
    if (!this.activeFilePath) return;
    const ext = this.activeFilePath.split('.').pop().toLowerCase();
    const isShader = isShaderFile(ext);
    const diagSpan = document.getElementById('status-diagnostics');

    if (!isShader) {
      if (this.activeFilePath.endsWith('.js')) {
        this.validateActiveScript(this.editor.getValue());
      } else {
        diagSpan.className = 'diagnostic-clean';
        diagSpan.textContent = 'Ready';
        clearModelDiagnostics(this.editor);
        this.hasShaderErrors = false;
      }
      return;
    }

    try {
      if (window.electronAPI) {
        const res = await window.electronAPI.project.loadShader(this.activeFilePath);
        diagSpan.className = 'diagnostic-clean';
        diagSpan.textContent = `GLSL: OK (#includes resolved: ${res.sourceTable.length} modules)`;
        clearModelDiagnostics(this.editor);
        this.hasShaderErrors = false;
      }
    } catch (err) {
      this.hasShaderErrors = true;
      diagSpan.className = 'diagnostic-error';
      diagSpan.textContent = `GLSL Error: ${err.message}`;
      setModelDiagnostics(this.editor, [{ line: 1, message: err.message }]);
    }
  }

  validateActiveScript(code) {
    if (!this.activeFilePath || !this.activeFilePath.endsWith('.js')) {
      this.hasJsErrors = false;
      return true;
    }
    const model = this.editor ? this.editor.getModel() : null;
    if (!model) return true;

    try {
      if (/^\s*(import|export)\s/m.test(code)) {
        const testCode = code
          .replace(/^\s*export\s+default\s+/gm, 'let __def = ')
          .replace(/^\s*export\s+(const|let|var|function|class)\s+/gm, '$1 ')
          .replace(/^\s*export\s*\{[^}]*\}\s*;?/gm, '')
          .replace(/^\s*import\s+.*?from\s+['"][^'"]+['"]\s*;?/gm, '');
        new Function(testCode);
      } else {
        new Function(code);
      }

      this.hasJsErrors = false;
      monaco.editor.setModelMarkers(model, 'js-syntax', []);
      monaco.editor.setModelMarkers(model, 'p5-runtime', []);
      const diagSpan = document.getElementById('status-diagnostics');
      if (diagSpan && !this.hasShaderErrors) {
        diagSpan.className = 'diagnostic-clean';
        diagSpan.textContent = 'Ready';
      }
      return true;
    } catch (err) {
      this.hasJsErrors = true;
      const cursorPos = this.editor.getPosition();
      const line = cursorPos ? cursorPos.lineNumber : 1;

      monaco.editor.setModelMarkers(model, 'js-syntax', [{
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: model.getLineMaxColumn(line) || 80,
        message: `SyntaxError: ${err.message}`,
        severity: monaco.MarkerSeverity.Error
      }]);

      const diagSpan = document.getElementById('status-diagnostics');
      if (diagSpan) {
        diagSpan.className = 'diagnostic-error';
        diagSpan.textContent = `JS Syntax Error: ${err.message} (L${line})`;
      }
      return false;
    }
  }

  // =========================================================================
  // 2. Project Explorer & File Tree
  // =========================================================================
  async refreshFileTree() {
    if (!window.electronAPI) return;
    const files = await window.electronAPI.project.listFiles();
    const treeContainer = document.getElementById('file-tree');
    treeContainer.innerHTML = '';

    const buildTree = (items, container) => {
      for (const item of items) {
        const itemEl = document.createElement('div');
        itemEl.className = 'tree-item';
        itemEl.dataset.path = item.path;

        if (item.type === 'directory') {
          itemEl.innerHTML = `
            <svg class="icon-small" viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
            <span class="tree-item-name">${item.name}</span>
          `;
          container.appendChild(itemEl);
          if (item.children && item.children.length > 0) {
            const subContainer = document.createElement('div');
            subContainer.style.paddingLeft = '14px';
            buildTree(item.children, subContainer);
            container.appendChild(subContainer);
          }
        } else {
          itemEl.innerHTML = `
            <svg class="icon-small" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
            <span class="tree-item-name">${item.name}</span>
            <button class="btn-action tree-item-delete" title="Delete file">&times;</button>
          `;
          itemEl.querySelector('.tree-item-name').addEventListener('click', () => this.openFile(item.path));
          itemEl.querySelector('svg').addEventListener('click', () => this.openFile(item.path));
          itemEl.querySelector('.tree-item-delete').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm(`Delete ${item.name}?`)) {
              await window.electronAPI.project.deleteItem(item.path);
              this.closeTab(item.path);
              await this.refreshFileTree();
            }
          });
          container.appendChild(itemEl);
        }
      }
    };

    buildTree(files, treeContainer);
    this.highlightActiveTreeItem();

    // Default open sketch.js if no file open
    if (!this.activeFilePath) {
      const sketchFile = files.find(f => f.name === 'sketch.js');
      if (sketchFile) {
        this.openFile('sketch.js');
      } else if (files.length > 0 && files[0].type === 'file') {
        this.openFile(files[0].path);
      }
    }
  }

  highlightActiveTreeItem() {
    const items = document.querySelectorAll('.tree-item');
    items.forEach((item) => {
      if (item.dataset.path === this.activeFilePath) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  handleExternalFileChange(change) {
    if (this.openFiles.has(change.filename)) {
      window.electronAPI.project.readFile(change.filename).then((content) => {
        const fileRecord = this.openFiles.get(change.filename);
        if (fileRecord.model.getValue() !== content) {
          fileRecord.model.setValue(content);
        }
      });
    }
    this.refreshFileTree();
  }

  // =========================================================================
  // 3. Preview Sandbox Management
  // =========================================================================
  loadPreview() {
    if (!this.projectInfo || !this.projectInfo.serverUrl) return;
    const frame = document.getElementById('preview-frame');
    frame.src = `${this.projectInfo.serverUrl}/index.html?t=${Date.now()}`;

    // Listen for messages from preview iframe
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data) return;

      if (data.type === 'shader:diagnostics' && data.errors) {
        setModelDiagnostics(this.editor, data.errors);
        document.getElementById('status-diagnostics').className = 'diagnostic-error';
        document.getElementById('status-diagnostics').textContent = `GLSL Error (${data.errors.length})`;
      } else if (data.type === 'shader:error') {
        const errMsg = data.log ? data.log.split('\n')[0] : 'Compilation error';
        document.getElementById('status-diagnostics').className = 'diagnostic-error';
        document.getElementById('status-diagnostics').textContent = `Shader Error: ${errMsg}`;
      } else if (data.type === 'shader:success') {
        clearModelDiagnostics(this.editor);
        document.getElementById('status-diagnostics').className = 'diagnostic-clean';
        document.getElementById('status-diagnostics').textContent = 'GLSL: OK (Live Hot-Reloaded)';
      } else if (data.type === 'runtime:error') {
        const isGenericScriptError = data.message === 'Script error.' || !data.lineno || data.lineno <= 0;
        this.hasJsErrors = true;
        const diagSpan = document.getElementById('status-diagnostics');
        if (diagSpan) {
          diagSpan.className = 'diagnostic-error';
          const loc = !isGenericScriptError && data.lineno ? ` (L${data.lineno})` : '';
          diagSpan.textContent = `JS Error: ${data.message}${loc}`;
        }
        if (!isGenericScriptError && data.lineno && this.editor && this.activeFilePath && this.activeFilePath.endsWith('.js')) {
          const model = this.editor.getModel();
          if (model && data.lineno <= model.getLineCount()) {
            monaco.editor.setModelMarkers(model, 'p5-runtime', [{
              startLineNumber: data.lineno,
              startColumn: data.colno || 1,
              endLineNumber: data.lineno,
              endColumn: Math.max((data.colno || 1) + 10, model.getLineMaxColumn(data.lineno) || 80),
              message: data.message,
              severity: monaco.MarkerSeverity.Error
            }]);
          }
        }
      } else if (data.type === 'runtime:success') {
        this.hasJsErrors = false;
        if (!this.hasShaderErrors) {
          const diagSpan = document.getElementById('status-diagnostics');
          if (diagSpan) {
            diagSpan.className = 'diagnostic-clean';
            diagSpan.textContent = 'Ready';
          }
          if (this.editor && this.editor.getModel()) {
            monaco.editor.setModelMarkers(this.editor.getModel(), 'p5-runtime', []);
            monaco.editor.setModelMarkers(this.editor.getModel(), 'js-syntax', []);
          }
        }
      } else if (data.type === 'audio:update') {
        this.latestAudioMetrics = data;
      }
    });
  }

  restartPreview() {
    this.hasJsErrors = false;
    if (this.editor && this.editor.getModel()) {
      monaco.editor.setModelMarkers(this.editor.getModel(), 'p5-runtime', []);
    }
    const diagSpan = document.getElementById('status-diagnostics');
    if (diagSpan && !this.hasShaderErrors) {
      diagSpan.className = 'diagnostic-clean';
      diagSpan.textContent = 'Ready';
    }
    const frame = document.getElementById('preview-frame');
    if (frame) {
      if (this.projectInfo && this.projectInfo.serverUrl) {
        frame.src = `${this.projectInfo.serverUrl}/index.html?t=${Date.now()}`;
      } else {
        frame.src = frame.src;
      }
    }
    if (window.electronAPI) {
      // NOTE: Never reload liveWindow from restartPreview! Live Stage is isolated and explicitly pushed.
      if (window.electronAPI.preview) window.electronAPI.preview.reload();
    }
  }

  togglePlayPause() {
    this.isPaused = !this.isPaused;
    const frame = document.getElementById('preview-frame');
    const playIcon = document.getElementById('icon-play');
    const pauseIcon = document.getElementById('icon-pause');

    if (this.isPaused) {
      playIcon.classList.remove('hidden');
      pauseIcon.classList.add('hidden');
      if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage({ type: 'sketch:pause' }, '*');
      }
    } else {
      playIcon.classList.add('hidden');
      pauseIcon.classList.remove('hidden');
      if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage({ type: 'sketch:resume' }, '*');
      }
    }
  }

  // =========================================================================
  // 4. Audio-Reactive DSP Meters & Waveform Visualizer
  // =========================================================================
  initAudioMeters() {
    const draw = () => {
      requestAnimationFrame(draw);

      const w = this.fftCanvas.width;
      const h = this.fftCanvas.height;
      this.fftCtx.fillStyle = '#080a0d';
      this.fftCtx.fillRect(0, 0, w, h);

      const barCount = 32;
      const barWidth = (w / barCount) - 1;

      let rms = 0;
      let bands = { sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0 };
      const frame = document.getElementById('preview-frame');

      if (this.latestAudioMetrics) {
        rms = this.latestAudioMetrics.rms || 0;
        bands = this.latestAudioMetrics.bands || bands;
        const fftData = this.latestAudioMetrics.fft || [];

        for (let i = 0; i < barCount; i++) {
          const val = fftData[i * 4] || 0;
          const barHeight = (val / 255.0) * h;
          this.fftCtx.fillStyle = i < 8 ? '#00f0ff' : (i < 18 ? '#ffb700' : '#ff0077');
          this.fftCtx.fillRect(i * (barWidth + 1), h - barHeight, barWidth, barHeight);
        }

        const waveData = this.latestAudioMetrics.wave || [];
        this.waveCtx.fillStyle = '#080a0d';
        this.waveCtx.fillRect(0, 0, w, h);
        this.waveCtx.strokeStyle = '#ffb700';
        this.waveCtx.lineWidth = 1.5;
        this.waveCtx.beginPath();

        const sliceW = w / 128.0;
        for (let i = 0; i < 128; i++) {
          const v = (waveData[i] || 128) / 128.0;
          const y = (v * h) / 2;
          if (i === 0) this.waveCtx.moveTo(0, y);
          else this.waveCtx.lineTo(i * sliceW, y);
        }
        this.waveCtx.stroke();
      } else {
        try {
          if (frame && frame.contentWindow && frame.contentWindow.ideAudio) {
            const audio = frame.contentWindow.ideAudio;
            rms = audio.getRMS();
            bands = audio.bands;
            const fftData = audio.getFFT();
            for (let i = 0; i < barCount; i++) {
              const val = fftData[i * 4] || 0;
              const barHeight = (val / 255.0) * h;
              this.fftCtx.fillStyle = i < 8 ? '#00f0ff' : (i < 18 ? '#ffb700' : '#ff0077');
              this.fftCtx.fillRect(i * (barWidth + 1), h - barHeight, barWidth, barHeight);
            }

            const waveData = audio.getWaveform();
            this.waveCtx.fillStyle = '#080a0d';
            this.waveCtx.fillRect(0, 0, w, h);
            this.waveCtx.strokeStyle = '#ffb700';
            this.waveCtx.lineWidth = 1.5;
            this.waveCtx.beginPath();

            const sliceW = w / 128.0;
            for (let i = 0; i < 128; i++) {
              const v = (waveData[i * 8] || 128) / 128.0;
              const y = (v * h) / 2;
              if (i === 0) this.waveCtx.moveTo(0, y);
              else this.waveCtx.lineTo(i * sliceW, y);
            }
            this.waveCtx.stroke();
          }
        } catch (e) {
          // Cross-origin access safely handled
        }
      }

      document.getElementById('meter-sub').style.height = `${Math.min(100, bands.sub * 100)}%`;
      document.getElementById('meter-bass').style.height = `${Math.min(100, bands.bass * 100)}%`;
      document.getElementById('meter-lowmid').style.height = `${Math.min(100, bands.lowMid * 100)}%`;
      document.getElementById('meter-mid').style.height = `${Math.min(100, bands.mid * 100)}%`;
      document.getElementById('meter-highmid').style.height = `${Math.min(100, bands.highMid * 100)}%`;
      document.getElementById('meter-treble').style.height = `${Math.min(100, bands.treble * 100)}%`;
      document.getElementById('rms-badge').textContent = `RMS: ${rms.toFixed(2)}`;
    };

    draw();
  }

  async populateAudioDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const select = document.getElementById('audio-device-select');
      select.innerHTML = '';

      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      for (const dev of audioInputs) {
        const option = document.createElement('option');
        option.value = dev.deviceId;
        option.textContent = dev.label || `Audio Input ${select.children.length + 1}`;
        select.appendChild(option);
      }
    } catch (e) {}
  }

  // =========================================================================
  // 5. In-App Input Modal (No window.prompt dependency)
  // =========================================================================
  showInputDialog(title, placeholder, defaultValue = '') {
    return new Promise((resolve) => {
      const modal = document.getElementById('input-modal');
      const titleEl = document.getElementById('input-modal-title');
      const inputEl = document.getElementById('input-modal-value');
      const btnConfirm = document.getElementById('btn-confirm-input-modal');
      const btnCancel = document.getElementById('btn-cancel-input-modal');
      const btnClose = document.getElementById('btn-close-input-modal');

      titleEl.textContent = title;
      inputEl.placeholder = placeholder;
      inputEl.value = defaultValue;
      modal.classList.remove('hidden');
      inputEl.focus();
      inputEl.select();

      const cleanup = () => {
        modal.classList.add('hidden');
        btnConfirm.removeEventListener('click', onConfirm);
        btnCancel.removeEventListener('click', onCancel);
        btnClose.removeEventListener('click', onCancel);
        inputEl.removeEventListener('keydown', onKeyDown);
      };

      const onConfirm = () => {
        const val = inputEl.value.trim();
        cleanup();
        resolve(val || null);
      };

      const onCancel = () => {
        cleanup();
        resolve(null);
      };

      const onKeyDown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onConfirm();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      };

      btnConfirm.addEventListener('click', onConfirm);
      btnCancel.addEventListener('click', onCancel);
      btnClose.addEventListener('click', onCancel);
      inputEl.addEventListener('keydown', onKeyDown);
    });
  }

  // =========================================================================
  // 6. Take Recorder
  // =========================================================================
  async toggleRecordTake() {
    const btn = document.getElementById('btn-record-take');
    const label = document.getElementById('label-record-take');
    const timer = document.getElementById('record-timer');

    if (!this.isRecordingTake) {
      this.isRecordingTake = true;
      btn.classList.add('recording');
      label.textContent = 'Stop Recording';
      timer.classList.remove('hidden');
      this.recordStartTime = performance.now();

      this.recordTimerInterval = setInterval(() => {
        const elapsed = (performance.now() - this.recordStartTime) / 1000;
        const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const secs = (elapsed % 60).toFixed(1).padStart(4, '0');
        timer.textContent = `${mins}:${secs}`;
      }, 100);

      const takeName = `take_${Date.now()}`;
      const takeRes = await window.electronAPI.osc.startRecordTake(takeName);
      this.currentTakeDir = takeRes.takeDir;

      await this.startAudioWorkletRecording();
    } else {
      this.isRecordingTake = false;
      btn.classList.remove('recording');
      label.textContent = 'Record Take';
      timer.classList.add('hidden');
      clearInterval(this.recordTimerInterval);

      const oscResult = await window.electronAPI.osc.stopRecordTake();
      await this.stopAudioWorkletRecording();

      alert(`Take recorded successfully!\nAudio: take_audio.wav\nOSC: ${oscResult.count} events in take_osc.json`);

      if (this.currentTakeDir) {
        document.getElementById('export-audio-path').value = `${this.currentTakeDir}/take_audio.wav`;
        document.getElementById('export-osc-path').value = `${this.currentTakeDir}/take_osc.json`;
      }
    }
  }

  async startAudioWorkletRecording() {
    try {
      this.recordedAudioChunks = [];
      this.recordedSampleCount = 0;

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContextClass({ sampleRate: 48000 });

      await this.audioContext.audioWorklet.addModule('./audioWorkletRecorder.js');

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 48000
        }
      });

      const source = this.audioContext.createMediaStreamSource(stream);
      this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-worklet-recorder');

      this.workletNode.port.onmessage = (event) => {
        if (event.data.type === 'chunk') {
          const left = new Float32Array(event.data.left);
          const right = new Float32Array(event.data.right);
          this.recordedAudioChunks.push({ left, right, length: event.data.length });
          this.recordedSampleCount += event.data.length;
        }
      };

      source.connect(this.workletNode);
      this.workletNode.port.postMessage({ command: 'start' });
    } catch (err) {
      console.error('[TakeRecorder] Failed to start audio worklet:', err);
    }
  }

  async stopAudioWorkletRecording() {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ command: 'stop' });
    }

    const leftFull = new Float32Array(this.recordedSampleCount);
    const rightFull = new Float32Array(this.recordedSampleCount);
    let offset = 0;

    for (const chunk of this.recordedAudioChunks) {
      leftFull.set(chunk.left, offset);
      rightFull.set(chunk.right, offset);
      offset += chunk.length;
    }

    if (this.currentTakeDir && this.recordedSampleCount > 0) {
      await window.electronAPI.audio.saveTakeWav(
        this.currentTakeDir,
        [leftFull, rightFull],
        this.audioContext.sampleRate || 48000
      );
    }

    if (this.audioContext) {
      try { await this.audioContext.close(); } catch (e) {}
      this.audioContext = null;
    }
  }

  // =========================================================================
  // 7. OSC Monitor
  // =========================================================================
  logOscMessage(msg) {
    const logContainer = document.getElementById('osc-log');
    const entry = document.createElement('div');
    entry.className = 'osc-entry';

    const argsFormatted = (msg.args || [])
      .map(a => (typeof a === 'number' ? a.toFixed(3) : String(a)))
      .join(', ');

    entry.innerHTML = `
      <span class="osc-address">${msg.address}</span>
      <span class="osc-args">[${argsFormatted}]</span>
    `;

    logContainer.prepend(entry);
    while (logContainer.children.length > 20) {
      logContainer.removeChild(logContainer.lastChild);
    }

    // Forward OSC to preview iframe
    const frame = document.getElementById('preview-frame');
    if (frame && frame.contentWindow) {
      frame.contentWindow.postMessage({ type: 'osc:message', address: msg.address, args: msg.args }, '*');
    }
  }

  // =========================================================================
  // 8. Deterministic Video Exporter UI
  // =========================================================================
  openExportModal() {
    document.getElementById('export-modal').classList.remove('hidden');
  }

  closeExportModal() {
    document.getElementById('export-modal').classList.add('hidden');
    this.resetExportUI();
  }

  async startLockstepExport() {
    const preset = document.getElementById('export-preset-select').value.split('x');
    const width = parseInt(preset[0], 10);
    const height = parseInt(preset[1], 10);
    const fps = parseInt(document.getElementById('export-fps-select').value, 10);
    const durationSec = parseFloat(document.getElementById('export-duration-input').value);
    const profile = document.getElementById('export-profile-select').value;
    const audioPath = document.getElementById('export-audio-path').value || null;
    const oscPath = document.getElementById('export-osc-path').value || null;

    const ext = profile === 'prores-4444-alpha' ? 'mov' : 'mp4';
    const outputPath = await window.electronAPI.export.showSaveDialog({
      title: 'Save Deterministic Rendered Video',
      defaultPath: `render_${width}x${height}_${fps}fps.${ext}`,
      filters: [{ name: 'Video', extensions: [ext] }]
    });

    if (!outputPath) return;

    document.getElementById('export-progress-container').classList.remove('hidden');
    document.getElementById('btn-start-export').classList.add('hidden');
    document.getElementById('btn-cancel-export').classList.remove('hidden');

    await window.electronAPI.export.start({
      width,
      height,
      fps,
      durationSec,
      profile,
      outputPath,
      audioPath,
      oscPath
    });
  }

  updateExportProgress(p) {
    const fill = document.getElementById('export-progress-fill');
    const text = document.getElementById('export-progress-text');
    const eta = document.getElementById('export-progress-eta');

    fill.style.width = `${p.percent}%`;
    text.textContent = `Frame ${p.frame} / ${p.totalFrames} (${p.percent}%) @ ${p.fpsProcessed} fps`;
    eta.textContent = `ETA: ${p.etaSec}s`;
  }

  finishExportUI(result) {
    alert(`Deterministic Video Export Completed!\nSaved to: ${result.outputPath}\nTotal Frames: ${result.totalFrames}`);
    this.closeExportModal();
  }

  resetExportUI() {
    document.getElementById('export-progress-container').classList.add('hidden');
    document.getElementById('export-progress-fill').style.width = '0%';
    document.getElementById('btn-start-export').classList.remove('hidden');
    document.getElementById('btn-cancel-export').classList.add('hidden');
  }

  // =========================================================================
  // 9. Live Stage Output Window Controls
  // =========================================================================
  async initLiveWindowControls() {
    if (!window.electronAPI || !window.electronAPI.live) return;

    const btnToggle = document.getElementById('btn-toggle-live-window');
    const selectDisplay = document.getElementById('select-live-display');
    const btnFs = document.getElementById('btn-live-fullscreen');
    const btnPush = document.getElementById('btn-push-live-stage');

    // Populate display selector
    await this.loadLiveDisplays();

    // Toggle live output window
    if (btnToggle) {
      btnToggle.addEventListener('click', async () => {
        const displayId = selectDisplay ? selectDisplay.value : 'auto';
        await window.electronAPI.live.toggle({ displayId });
      });
    }

    // Push changes to live stage
    if (btnPush) {
      btnPush.addEventListener('click', () => {
        this.pushToLiveStage();
      });
    }

    // Display selection change: dynamically move window to selected monitor
    if (selectDisplay) {
      selectDisplay.addEventListener('change', async () => {
        const displayId = selectDisplay.value;
        const status = await window.electronAPI.live.getStatus();
        if (status.isOpen) {
          await window.electronAPI.live.moveToDisplay(displayId);
        }
      });
    }

    // Fullscreen button
    if (btnFs) {
      btnFs.addEventListener('click', async () => {
        await window.electronAPI.live.toggleFullscreen();
      });
    }

    // Listen for status changes from main process
    window.electronAPI.live.onStatusChanged((status) => {
      this.updateLiveUI(status);
    });

    // Listen for monitor connect / disconnect events
    window.electronAPI.live.onDisplaysChanged(() => {
      this.loadLiveDisplays();
    });

    // Query initial status
    const initialStatus = await window.electronAPI.live.getStatus();
    this.updateLiveUI(initialStatus);
  }

  async loadLiveDisplays() {
    if (!window.electronAPI || !window.electronAPI.live) return;
    try {
      const displays = await window.electronAPI.live.getDisplays();
      const select = document.getElementById('select-live-display');
      if (!select) return;

      const currentVal = select.value;
      select.innerHTML = '<option value="auto">Auto Display</option>';
      for (const d of displays) {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.label;
        if (String(d.id) === String(currentVal)) {
          opt.selected = true;
        }
        select.appendChild(opt);
      }
    } catch (e) {
      console.warn('[Live] Could not load displays:', e);
    }
  }

  updateLiveUI(status) {
    const btnToggle = document.getElementById('btn-toggle-live-window');
    const label = document.getElementById('label-live-btn');
    const btnFs = document.getElementById('btn-live-fullscreen');
    const btnPush = document.getElementById('btn-push-live-stage');

    if (!btnToggle || !label) return;

    this.isLiveWindowOpen = !!(status && status.isOpen);

    if (this.isLiveWindowOpen) {
      btnToggle.classList.add('active');
      label.textContent = status.isFullscreen ? 'LIVE (FULL)' : 'LIVE ON';
      if (btnFs) btnFs.classList.remove('hidden');
      if (btnPush) btnPush.classList.remove('hidden');
    } else {
      btnToggle.classList.remove('active');
      label.textContent = 'Live Stage';
      if (btnFs) btnFs.classList.add('hidden');
      if (btnPush) btnPush.classList.add('hidden');
      this.setLiveStageDirty(false);
    }
  }

  setLiveStageDirty(dirty, type = null) {
    this.isLiveDirty = dirty;
    if (dirty && type) this.pendingLiveType = type;
    const badge = document.getElementById('badge-live-dirty');
    const btnPush = document.getElementById('btn-push-live-stage');
    const labelPush = document.getElementById('label-push-stage');

    if (!btnPush) return;

    if (dirty) {
      if (badge) badge.classList.remove('hidden');
      btnPush.classList.add('dirty');
      if (labelPush) labelPush.textContent = 'Invia al Live ●';
    } else {
      if (badge) badge.classList.add('hidden');
      btnPush.classList.remove('dirty');
      if (labelPush) labelPush.textContent = 'Invia al Live';
      this.pendingLiveType = null;
    }
  }

  async pushToLiveStage() {
    if (!this.isLiveWindowOpen || !window.electronAPI || !window.electronAPI.live) {
      return;
    }

    const activeCode = this.editor ? this.editor.getValue() : '';
    const isJsSyntaxValid = this.validateActiveScript(activeCode);

    if (this.hasShaderErrors || this.hasJsErrors || !isJsSyntaxValid) {
      const diagSpan = document.getElementById('status-diagnostics');
      if (diagSpan) {
        diagSpan.className = 'diagnostic-error';
        diagSpan.textContent = '⚠️ Errore sintassi attivo: correggi prima di inviare al Live Stage!';
      }
      return;
    }

    const btnPush = document.getElementById('btn-push-live-stage');
    const labelPush = document.getElementById('label-push-stage');
    if (labelPush) labelPush.textContent = 'Invio in corso...';

    try {
      if (this.pendingLiveType === 'shader') {
        await window.electronAPI.live.notifyShaderHotReload();
      } else {
        await window.electronAPI.live.pushStage();
      }

      this.setLiveStageDirty(false);
      if (labelPush) labelPush.textContent = '✓ Inviato!';
      setTimeout(() => {
        if (labelPush && !this.isLiveDirty) labelPush.textContent = 'Invia al Live';
      }, 1500);
    } catch (err) {
      console.error('[Live] Push to live stage failed:', err);
      if (labelPush) labelPush.textContent = 'Errore invio';
    }
  }

  // =========================================================================
  // 10. p5.js Version Controls (like editor.p5js.org)
  // =========================================================================
  async initP5VersionControls() {
    const select = document.getElementById('select-p5-version');
    if (!select || !window.electronAPI || !window.electronAPI.project) return;

    try {
      const activeVersion = await window.electronAPI.project.getP5Version();
      if (activeVersion) {
        select.value = activeVersion;
      }
    } catch (e) {
      console.warn('[p5Version] Failed to load version:', e);
    }

    select.addEventListener('change', async () => {
      const selected = select.value;
      try {
        await window.electronAPI.project.setP5Version(selected);
        const diagSpan = document.getElementById('status-diagnostics');
        if (diagSpan) {
          diagSpan.className = 'diagnostic-clean';
          diagSpan.textContent = `p5.js v${selected} impostata con successo`;
        }
        this.restartPreview();
      } catch (err) {
        console.error('[p5Version] Failed to switch version:', err);
        alert(`Errore cambio versione p5.js: ${err.message}`);
      }
    });
  }

  // =========================================================================
  // 11. p5.js Libraries Catalog & Direct Import Modal
  // =========================================================================
  async initP5LibrariesModal() {
    const btnOpen = document.getElementById('btn-open-libraries');
    const modal = document.getElementById('libraries-modal');
    const btnClose = document.getElementById('btn-close-libraries-modal');
    const btnDone = document.getElementById('btn-done-libraries');
    const searchInput = document.getElementById('input-search-libraries');
    const filtersContainer = document.getElementById('libraries-category-filters');
    const grid = document.getElementById('libraries-grid');
    const countLabel = document.getElementById('libraries-active-count');

    if (!btnOpen || !modal) return;

    let catalog = [];
    let enabledLibraries = [];
    let activeCategory = 'all';
    let searchQuery = '';

    const renderLibraries = () => {
      if (!grid) return;
      grid.innerHTML = '';

      const filtered = catalog.filter((lib) => {
        const matchCategory = activeCategory === 'all' || lib.category === activeCategory;
        const matchSearch =
          !searchQuery ||
          lib.name.toLowerCase().includes(searchQuery) ||
          lib.description.toLowerCase().includes(searchQuery) ||
          lib.category.toLowerCase().includes(searchQuery);
        return matchCategory && matchSearch;
      });

      if (countLabel) {
        countLabel.textContent = `${enabledLibraries.length} libreri${enabledLibraries.length === 1 ? 'a attiva' : 'e attive'}`;
      }

      if (filtered.length === 0) {
        grid.innerHTML = '<div class="libraries-empty">Nessuna libreria trovata per questa ricerca.</div>';
        return;
      }

      for (const lib of filtered) {
        const isEnabled = enabledLibraries.includes(lib.id);
        const card = document.createElement('div');
        card.className = `library-card ${isEnabled ? 'enabled' : ''}`;
        card.innerHTML = `
          <div class="library-card-header">
            <div class="library-title-row">
              <span class="library-name">${lib.name}</span>
              <span class="library-badge">${lib.category}</span>
            </div>
            <button class="btn-toggle-lib ${isEnabled ? 'active' : ''}" title="${isEnabled ? 'Rimuovi dal progetto' : 'Aggiungi al progetto'}">
              ${isEnabled ? '✓ Attiva' : '+ Aggiungi'}
            </button>
          </div>
          <p class="library-desc">${lib.description}</p>
          <div class="library-card-footer">
            <a href="${lib.website}" class="library-link" target="_blank">Documentazione / Esempi ↗</a>
          </div>
        `;

        // Toggle button click
        const toggleBtn = card.querySelector('.btn-toggle-lib');
        toggleBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const nextState = !enabledLibraries.includes(lib.id);
          try {
            await window.electronAPI.project.toggleP5Library(lib.id, nextState);
            if (nextState) {
              enabledLibraries.push(lib.id);
            } else {
              enabledLibraries = enabledLibraries.filter(id => id !== lib.id);
            }
            renderLibraries();
            this.restartPreview();
          } catch (err) {
            console.error('[Libraries] Toggle error:', err);
            alert(`Errore libreria: ${err.message}`);
          }
        });

        // External link click
        const link = card.querySelector('.library-link');
        link.addEventListener('click', (e) => {
          e.preventDefault();
          if (window.electronAPI && window.electronAPI.system) {
            window.electronAPI.system.openExternal(lib.website);
          } else {
            window.open(lib.website, '_blank');
          }
        });

        grid.appendChild(card);
      }
    };

    const openModal = async () => {
      try {
        if (window.electronAPI && window.electronAPI.project) {
          const res = await window.electronAPI.project.getP5Libraries();
          catalog = res.catalog || [];
          enabledLibraries = res.enabledLibraries || [];
        }
        renderLibraries();
        modal.classList.remove('hidden');
        if (searchInput) {
          searchInput.value = '';
          searchQuery = '';
          searchInput.focus();
        }
      } catch (err) {
        console.error('[Libraries] Open error:', err);
      }
    };

    const closeModal = () => {
      modal.classList.add('hidden');
    };

    btnOpen.addEventListener('click', openModal);
    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnDone) btnDone.addEventListener('click', closeModal);

    // Search input
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim().toLowerCase();
        renderLibraries();
      });
    }

    // Category filters
    if (filtersContainer) {
      const pills = filtersContainer.querySelectorAll('.pill-filter');
      pills.forEach((pill) => {
        pill.addEventListener('click', () => {
          pills.forEach((p) => p.classList.remove('active'));
          pill.classList.add('active');
          activeCategory = pill.dataset.category || 'all';
          renderLibraries();
        });
      });
    }
  }

  // =========================================================================
  // 12. p5.js Reference Explorer & Fast Code Injection Modal
  // =========================================================================
  initP5ReferenceModal() {
    const btnOpen = document.getElementById('btn-open-reference');
    const modal = document.getElementById('reference-modal');
    const btnClose = document.getElementById('btn-close-reference-modal');
    const btnDone = document.getElementById('btn-done-reference');
    const searchInput = document.getElementById('input-search-reference');
    const btnClearSearch = document.getElementById('btn-clear-search-reference');
    const filtersContainer = document.getElementById('reference-category-filters');
    const grid = document.getElementById('reference-results-grid');
    const countLabel = document.getElementById('reference-results-count');
    const btnOfficial = document.getElementById('btn-open-official-ref');

    if (!modal) return;

    let activeCategory = 'all';
    let searchQuery = '';

    const allSymbols = Object.keys(P5_REFERENCE_DOCS).map((key) => {
      const item = P5_REFERENCE_DOCS[key];
      return {
        name: key,
        syntax: item.syntax || key,
        desc: item.desc || '',
        category: getCategoryForSymbol(key)
      };
    });

    const renderReference = () => {
      if (!grid) return;
      grid.innerHTML = '';

      const filtered = allSymbols.filter((sym) => {
        const matchCategory = activeCategory === 'all' || sym.category === activeCategory;
        const matchSearch =
          !searchQuery ||
          sym.name.toLowerCase().includes(searchQuery) ||
          sym.desc.toLowerCase().includes(searchQuery) ||
          sym.syntax.toLowerCase().includes(searchQuery) ||
          sym.category.toLowerCase().includes(searchQuery);
        return matchCategory && matchSearch;
      });

      if (countLabel) {
        countLabel.textContent = `Visualizzazione di ${filtered.length} ${filtered.length === 1 ? 'voce' : 'voci'}${activeCategory !== 'all' ? ` in "${activeCategory}"` : ''}${searchQuery ? ` per "${searchQuery}"` : ''}`;
      }

      if (filtered.length === 0) {
        grid.innerHTML = '<div class="reference-empty">Nessuna funzione o costante trovata per questa ricerca.</div>';
        return;
      }

      for (const sym of filtered) {
        const card = document.createElement('div');
        card.className = 'reference-card';
        card.innerHTML = `
          <div class="reference-card-header">
            <span class="reference-sym-name">${sym.name}</span>
            <span class="reference-category-pill">${sym.category}</span>
          </div>
          <div class="reference-syntax-block">
            <code>${sym.syntax}</code>
            <button class="btn-copy-syntax" title="Copia sintassi negli appunti">Copia</button>
          </div>
          <p class="reference-desc">${sym.desc}</p>
          <div class="reference-card-actions">
            <button class="btn btn-secondary btn-insert-code" title="Inserisci questa istruzione nell'editor alla posizione corrente">
              <svg class="icon-small" viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              <span>Inserisci nell'Editor</span>
            </button>
            <button class="btn btn-subtle btn-external-ref" title="Apri sul Reference Ufficiale p5js.org">
              <span>p5js.org ↗</span>
            </button>
          </div>
        `;

        // Copy syntax button
        const copyBtn = card.querySelector('.btn-copy-syntax');
        if (copyBtn) {
          copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(sym.syntax).then(() => {
              const orig = copyBtn.textContent;
              copyBtn.textContent = '✓ Copiato!';
              copyBtn.classList.add('copied');
              setTimeout(() => {
                copyBtn.textContent = orig;
                copyBtn.classList.remove('copied');
              }, 1800);
            });
          });
        }

        // Insert code into Monaco editor
        const insertBtn = card.querySelector('.btn-insert-code');
        if (insertBtn) {
          insertBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.editor) {
              const snippet = sym.syntax.includes('(') ? sym.syntax : `${sym.name};`;
              const selection = this.editor.getSelection();
              const op = {
                range: selection,
                text: snippet,
                forceMoveMarkers: true
              };
              this.editor.executeEdits('p5-reference-insert', [op]);
              this.editor.focus();
            }
            modal.classList.add('hidden');
          });
        }

        // External reference link
        const extBtn = card.querySelector('.btn-external-ref');
        if (extBtn) {
          extBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const refUrl = `https://p5js.org/reference/#/p5/${sym.name}`;
            if (window.electronAPI && window.electronAPI.system) {
              window.electronAPI.system.openExternal(refUrl);
            } else {
              window.open(refUrl, '_blank');
            }
          });
        }

        grid.appendChild(card);
      }
    };

    this.openReferenceModal = (query = '') => {
      searchQuery = (query || '').trim().toLowerCase();
      activeCategory = 'all';
      if (searchInput) {
        searchInput.value = query || '';
      }
      if (btnClearSearch) {
        if (searchQuery) btnClearSearch.classList.remove('hidden');
        else btnClearSearch.classList.add('hidden');
      }
      if (filtersContainer) {
        const pills = filtersContainer.querySelectorAll('.pill-filter');
        pills.forEach((p) => p.classList.remove('active'));
        const allPill = filtersContainer.querySelector('[data-category="all"]');
        if (allPill) allPill.classList.add('active');
      }
      renderReference();
      modal.classList.remove('hidden');
      if (searchInput) searchInput.focus();
    };

    const closeModal = () => {
      modal.classList.add('hidden');
    };

    if (btnOpen) btnOpen.addEventListener('click', () => this.openReferenceModal(''));
    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnDone) btnDone.addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    if (btnOfficial) {
      btnOfficial.addEventListener('click', () => {
        const url = 'https://p5js.org/reference/';
        if (window.electronAPI && window.electronAPI.system) {
          window.electronAPI.system.openExternal(url);
        } else {
          window.open(url, '_blank');
        }
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim().toLowerCase();
        if (btnClearSearch) {
          if (searchQuery) btnClearSearch.classList.remove('hidden');
          else btnClearSearch.classList.add('hidden');
        }
        renderReference();
      });
    }

    if (btnClearSearch) {
      btnClearSearch.addEventListener('click', () => {
        if (searchInput) {
          searchInput.value = '';
          searchQuery = '';
          btnClearSearch.classList.add('hidden');
          searchInput.focus();
          renderReference();
        }
      });
    }

    if (filtersContainer) {
      const pills = filtersContainer.querySelectorAll('.pill-filter');
      pills.forEach((pill) => {
        pill.addEventListener('click', () => {
          pills.forEach((p) => p.classList.remove('active'));
          pill.classList.add('active');
          activeCategory = pill.dataset.category || 'all';
          renderReference();
        });
      });
    }
  }

  // =========================================================================
  // 10. Popout / Detached Preview Sandbox Window Controls
  // =========================================================================
  async initPreviewPopoutControls() {
    if (!window.electronAPI || !window.electronAPI.preview) return;

    const btnPopout = document.getElementById('btn-popout-preview');
    const btnDock = document.getElementById('btn-dock-preview');

    if (btnPopout) {
      btnPopout.addEventListener('click', async () => {
        await window.electronAPI.preview.toggle();
      });
    }

    if (btnDock) {
      btnDock.addEventListener('click', async () => {
        await window.electronAPI.preview.close();
      });
    }

    // Status listener
    window.electronAPI.preview.onStatusChanged((status) => {
      this.updatePreviewPopoutUI(status);
    });

    // Relay compiler diagnostics from detached preview to Monaco
    window.electronAPI.preview.onShaderDiagnostics((data) => {
      if (data && data.errors) {
        setModelDiagnostics(this.editor, data.errors);
        const diagEl = document.getElementById('status-diagnostics');
        if (diagEl) {
          diagEl.className = 'diagnostic-error';
          diagEl.textContent = `GLSL Error (${data.errors.length})`;
        }
      }
    });

    window.electronAPI.preview.onShaderSuccess(() => {
      clearModelDiagnostics(this.editor);
      const diagEl = document.getElementById('status-diagnostics');
      if (diagEl) {
        diagEl.className = 'diagnostic-clean';
        diagEl.textContent = 'GLSL: OK (Live Hot-Reloaded)';
      }
    });

    const initialStatus = await window.electronAPI.preview.getStatus();
    this.updatePreviewPopoutUI(initialStatus);
  }

  updatePreviewPopoutUI(status) {
    const frame = document.getElementById('preview-frame');
    const notice = document.getElementById('preview-docked-notice');
    const label = document.getElementById('label-popout-preview');

    if (!frame || !notice) return;

    if (status && status.isOpen) {
      frame.classList.add('hidden');
      notice.classList.remove('hidden');
      if (label) label.textContent = 'Dock';
    } else {
      frame.classList.remove('hidden');
      notice.classList.add('hidden');
      if (label) label.textContent = 'Pop Out';
    }
  }

  // =========================================================================
  // 11. Appearance & Typography Controls (Font Size, Family, Window Opacity)
  // =========================================================================
  openAppearanceModal() {
    const modal = document.getElementById('appearance-modal');
    if (modal) {
      modal.classList.remove('hidden');
      this.syncAppearanceUI();
    }
  }

  closeAppearanceModal() {
    const modal = document.getElementById('appearance-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  syncAppearanceUI() {
    // 1. Font Size
    const sliderFont = document.getElementById('slider-font-size');
    const badgeFont = document.getElementById('badge-font-size');
    const statusFont = document.getElementById('status-font-size');
    if (sliderFont) sliderFont.value = this.currentFontSize;
    if (badgeFont) badgeFont.textContent = `${this.currentFontSize}px`;
    if (statusFont) statusFont.textContent = `${this.currentFontSize}px`;

    // 2. Font Family
    const selectFont = document.getElementById('select-font-family');
    const customWrap = document.getElementById('custom-font-wrapper');
    const customInput = document.getElementById('input-custom-font');
    if (selectFont) {
      let found = false;
      for (const opt of selectFont.options) {
        if (opt.value === this.currentFontFamily) {
          selectFont.value = this.currentFontFamily;
          found = true;
          break;
        }
      }
      if (!found) {
        selectFont.value = 'custom';
        if (customWrap) customWrap.classList.remove('hidden');
        if (customInput) customInput.value = this.currentFontFamily.replace(/, monospace/g, '').replace(/['"]/g, '');
      } else {
        if (customWrap) customWrap.classList.add('hidden');
      }
    }

    // 3. Live Preview Box
    this.updateFontPreview();

    // 4. Window Opacity
    const sliderOpacity = document.getElementById('slider-window-opacity');
    const badgeOpacity = document.getElementById('badge-window-opacity');
    const statusOpacity = document.getElementById('status-window-opacity');
    const pct = Math.round(this.currentWindowOpacity * 100);
    if (sliderOpacity) sliderOpacity.value = pct;
    if (badgeOpacity) badgeOpacity.textContent = `${pct}%`;
    if (statusOpacity) statusOpacity.textContent = `${pct}%`;

    // Highlight active preset button
    document.querySelectorAll('.btn-preset-opacity').forEach((btn) => {
      const btnVal = Math.round(parseFloat(btn.getAttribute('data-opacity')) * 100);
      btn.classList.toggle('active', btnVal === pct);
    });
  }

  updateFontPreview() {
    const previewBox = document.getElementById('font-preview-box');
    const previewMeta = document.getElementById('font-preview-meta');
    if (previewBox) {
      previewBox.style.fontFamily = this.currentFontFamily;
      previewBox.style.fontSize = `${this.currentFontSize}px`;
    }
    if (previewMeta) {
      let displayName = this.currentFontFamily.split(',')[0].replace(/['"]/g, '').trim();
      previewMeta.textContent = `${displayName} • ${this.currentFontSize}px`;
    }
  }

  setFontSize(newSize) {
    const size = Math.max(10, Math.min(36, parseInt(newSize, 10) || 13));
    this.currentFontSize = size;
    localStorage.setItem('p5_studio_font_size', String(size));

    if (this.editor) {
      this.editor.updateOptions({ fontSize: size });
    }

    const slider = document.getElementById('slider-font-size');
    const badge = document.getElementById('badge-font-size');
    const status = document.getElementById('status-font-size');
    if (slider && Number(slider.value) !== size) slider.value = size;
    if (badge) badge.textContent = `${size}px`;
    if (status) status.textContent = `${size}px`;

    this.updateFontPreview();
  }

  setFontFamily(newFamily) {
    if (!newFamily) return;
    this.currentFontFamily = newFamily;
    localStorage.setItem('p5_studio_font_family', newFamily);

    if (this.editor) {
      this.editor.updateOptions({ fontFamily: newFamily });
    }

    this.updateFontPreview();
  }

  async setWindowOpacity(opacity) {
    const val = Math.max(0.2, Math.min(1.0, parseFloat(opacity) || 1.0));
    this.currentWindowOpacity = val;
    const pct = Math.round(val * 100);
    localStorage.setItem('p5_studio_window_opacity', String(val));

    // Call native Electron window opacity via IPC
    if (window.electronAPI && window.electronAPI.window && window.electronAPI.window.setOpacity) {
      try {
        await window.electronAPI.window.setOpacity(val);
      } catch (err) {
        console.warn('[Window Opacity] IPC error:', err);
      }
    }

    // Set CSS variable
    document.documentElement.style.setProperty('--window-opacity', String(val));

    const slider = document.getElementById('slider-window-opacity');
    const badge = document.getElementById('badge-window-opacity');
    const status = document.getElementById('status-window-opacity');
    if (slider && Number(slider.value) !== pct) slider.value = pct;
    if (badge) badge.textContent = `${pct}%`;
    if (status) status.textContent = `${pct}%`;

    // Highlight active preset button
    document.querySelectorAll('.btn-preset-opacity').forEach((btn) => {
      const btnVal = Math.round(parseFloat(btn.getAttribute('data-opacity')) * 100);
      btn.classList.toggle('active', btnVal === pct);
    });
  }

  initAppearanceControls() {
    const modal = document.getElementById('appearance-modal');
    const btnOpenHeader = document.getElementById('btn-open-appearance');
    const btnCloseModal = document.getElementById('btn-close-appearance-modal');
    const btnDoneModal = document.getElementById('btn-done-appearance');
    const btnReset = document.getElementById('btn-reset-appearance');

    // Status bar triggers
    const btnStatusGear = document.getElementById('btn-status-appearance');
    const badgeStatusFont = document.getElementById('status-font-size');
    const badgeStatusOpacity = document.getElementById('status-window-opacity');
    const btnQuickDec = document.getElementById('btn-quick-font-decrease');
    const btnQuickInc = document.getElementById('btn-quick-font-increase');

    // Modal controls
    const sliderFont = document.getElementById('slider-font-size');
    const btnFontDec = document.getElementById('btn-font-dec');
    const btnFontInc = document.getElementById('btn-font-inc');
    const selectFont = document.getElementById('select-font-family');
    const customFontWrap = document.getElementById('custom-font-wrapper');
    const inputCustomFont = document.getElementById('input-custom-font');
    const sliderOpacity = document.getElementById('slider-window-opacity');

    // Open modal triggers
    if (btnOpenHeader) btnOpenHeader.addEventListener('click', () => this.openAppearanceModal());
    if (btnStatusGear) btnStatusGear.addEventListener('click', () => this.openAppearanceModal());
    if (badgeStatusFont) badgeStatusFont.addEventListener('click', () => this.openAppearanceModal());
    if (badgeStatusOpacity) badgeStatusOpacity.addEventListener('click', () => this.openAppearanceModal());

    // Close modal triggers
    if (btnCloseModal) btnCloseModal.addEventListener('click', () => this.closeAppearanceModal());
    if (btnDoneModal) btnDoneModal.addEventListener('click', () => this.closeAppearanceModal());

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeAppearanceModal();
      });
    }

    // Keyboard navigation (Esc to close) & Zoom shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
        this.closeAppearanceModal();
      }
      // Global zoom/font shortcuts: Cmd/Ctrl + '+' / '=' or Cmd/Ctrl + '-'
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        this.setFontSize(this.currentFontSize + 1);
      } else if ((e.metaKey || e.ctrlKey) && e.key === '-') {
        e.preventDefault();
        this.setFontSize(this.currentFontSize - 1);
      } else if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        // Reset zoom to default 13px
        e.preventDefault();
        this.setFontSize(13);
      }
    });

    // Font size controls
    if (sliderFont) {
      sliderFont.addEventListener('input', (e) => {
        this.setFontSize(parseInt(e.target.value, 10));
      });
    }
    if (btnFontDec) {
      btnFontDec.addEventListener('click', () => this.setFontSize(this.currentFontSize - 1));
    }
    if (btnFontInc) {
      btnFontInc.addEventListener('click', () => this.setFontSize(this.currentFontSize + 1));
    }
    if (btnQuickDec) {
      btnQuickDec.addEventListener('click', () => this.setFontSize(this.currentFontSize - 1));
    }
    if (btnQuickInc) {
      btnQuickInc.addEventListener('click', () => this.setFontSize(this.currentFontSize + 1));
    }

    // Font family controls
    if (selectFont) {
      selectFont.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'custom') {
          if (customFontWrap) customFontWrap.classList.remove('hidden');
          if (inputCustomFont) {
            inputCustomFont.focus();
            if (inputCustomFont.value.trim()) {
              this.setFontFamily(`"${inputCustomFont.value.trim()}", monospace`);
            }
          }
        } else {
          if (customFontWrap) customFontWrap.classList.add('hidden');
          this.setFontFamily(val);
        }
      });
    }

    if (inputCustomFont) {
      inputCustomFont.addEventListener('input', (e) => {
        const name = e.target.value.trim();
        if (name) {
          this.setFontFamily(`"${name}", monospace`);
        }
      });
    }

    // Window opacity slider
    if (sliderOpacity) {
      sliderOpacity.addEventListener('input', (e) => {
        const pct = parseInt(e.target.value, 10);
        this.setWindowOpacity(pct / 100);
      });
    }

    // Opacity presets
    document.querySelectorAll('.btn-preset-opacity').forEach((btn) => {
      btn.addEventListener('click', () => {
        const op = parseFloat(btn.getAttribute('data-opacity'));
        this.setWindowOpacity(op);
      });
    });

    // Reset button
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        this.setFontSize(13);
        this.setFontFamily("JetBrains Mono, 'Fira Code', Menlo, Consolas, monospace");
        this.setWindowOpacity(1.0);
        this.syncAppearanceUI();
      });
    }

    // Initial sync
    this.syncAppearanceUI();
  }

  // =========================================================================
  // 12. Event Listeners Wiring
  // =========================================================================
  initEventListeners() {
    // Global hotkey: Cmd+Enter or Ctrl+Enter -> Push to Live Stage
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        this.pushToLiveStage();
      }
    });

    document.getElementById('btn-open-project').addEventListener('click', async () => {
      const res = await window.electronAPI.project.openFolder();
      if (res) {
        this.projectInfo = res;
        document.getElementById('label-project-name').textContent =
          res.projectPath.split(/[\\/]/).pop();
        await this.refreshFileTree();
        this.restartPreview();
      }
    });

    document.getElementById('btn-restart').addEventListener('click', () => this.restartPreview());
    document.getElementById('btn-play-pause').addEventListener('click', () => this.togglePlayPause());
    document.getElementById('btn-record-take').addEventListener('click', () => this.toggleRecordTake());
    document.getElementById('btn-open-export').addEventListener('click', () => this.openExportModal());
    document.getElementById('btn-close-export-modal').addEventListener('click', () => this.closeExportModal());
    document.getElementById('btn-start-export').addEventListener('click', () => this.startLockstepExport());
    document.getElementById('btn-cancel-export').addEventListener('click', () => {
      window.electronAPI.export.cancel();
      this.resetExportUI();
    });

    // Select Audio track button
    document.getElementById('btn-browse-audio').addEventListener('click', async () => {
      if (window.electronAPI && window.electronAPI.export.showOpenDialog) {
        const filePath = await window.electronAPI.export.showOpenDialog({
          title: 'Select Audio Track for Deterministic Export',
          filters: [
            { name: 'Audio Files (*.mp3, *.wav, *.ogg, *.flac, *.m4a, *.aac, *.aiff)', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'aiff'] }
          ],
          properties: ['openFile']
        });
        if (filePath) {
          document.getElementById('export-audio-path').value = filePath;
          if (window.electronAPI.export.getAudioDuration) {
            const dur = await window.electronAPI.export.getAudioDuration(filePath);
            if (typeof dur === 'number' && dur > 0) {
              document.getElementById('export-duration-input').value = (Math.round(dur * 10) / 10).toString();
            }
          }
        }
      }
    });

    // Select OSC take button
    document.getElementById('btn-browse-osc').addEventListener('click', async () => {
      if (window.electronAPI && window.electronAPI.export.showOpenDialog) {
        const filePath = await window.electronAPI.export.showOpenDialog({
          title: 'Select Recorded OSC Take JSON',
          filters: [{ name: 'OSC Take JSON (*.json)', extensions: ['json'] }],
          properties: ['openFile']
        });
        if (filePath) {
          document.getElementById('export-osc-path').value = filePath;
        }
      }
    });

    // In-App New File Dialog
    document.getElementById('btn-new-file').addEventListener('click', async () => {
      const filename = await this.showInputDialog('New File', 'e.g. effect.frag, helper.js');
      if (filename && window.electronAPI) {
        await window.electronAPI.project.createItem(filename, 'file');
        await this.refreshFileTree();
        this.openFile(filename);
      }
    });

    // In-App New Folder Dialog
    document.getElementById('btn-new-folder').addEventListener('click', async () => {
      const foldername = await this.showInputDialog('New Folder', 'e.g. shaders, assets');
      if (foldername && window.electronAPI) {
        await window.electronAPI.project.createItem(foldername, 'directory');
        await this.refreshFileTree();
      }
    });
  }
}

// Global error logger
window.addEventListener('error', (event) => {
  console.error('[Global UI Error]', event.error || event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Global UI Unhandled Rejection]', event.reason);
});

// Safe Startup: handles both pre-DOMContentLoaded and post-DOMContentLoaded ready states
const startApp = async () => {
  try {
    const app = new IDEApp();
    await app.init();
    console.log('[p5-Studio-PRO] IDE UI initialized successfully.');
  } catch (err) {
    console.error('[p5-Studio-PRO] Fatal error during IDE initialization:', err);
    const errBox = document.createElement('div');
    errBox.style.cssText = 'position:fixed;top:10px;left:10px;right:10px;background:#ff0055;color:#fff;padding:16px;border-radius:6px;z-index:999999;font-family:monospace;white-space:pre-wrap;box-shadow:0 8px 30px rgba(0,0,0,0.5);';
    errBox.textContent = `FATAL STARTUP ERROR: ${err.message}\n${err.stack || ''}`;
    document.body.appendChild(errBox);
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
