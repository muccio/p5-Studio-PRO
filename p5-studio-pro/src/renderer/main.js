import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import 'monaco-editor/esm/vs/language/html/monaco.contribution';
import 'monaco-editor/esm/vs/language/css/monaco.contribution';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import { setupGLSLSupport, setModelDiagnostics, clearModelDiagnostics, isShaderFile } from './glslMonacoSetup.js';
import { setupWebAndScriptSupport } from './ideLanguageService.js';

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
  }

  async init() {
    setupGLSLSupport();
    setupWebAndScriptSupport();
    this.initMonaco();
    this.initEventListeners();
    this.initAudioMeters();
    this.initLiveWindowControls();
    this.initPreviewPopoutControls();

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
      fontSize: 13,
      fontFamily: 'JetBrains Mono, Fira Code, Menlo, Consolas, monospace',
      automaticLayout: true,
      minimap: { enabled: true },
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      tabSize: 2
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
            if (window.electronAPI.live) window.electronAPI.live.notifyShaderHotReload();
            if (window.electronAPI.preview) window.electronAPI.preview.notifyShaderHotReload();
          }
        } else if (['js', 'jsx', 'ts', 'tsx', 'html', 'htm', 'css', 'json'].includes(ext)) {
          this.restartPreview();
          if (window.electronAPI) {
            if (window.electronAPI.live) window.electronAPI.live.reload();
            if (window.electronAPI.preview) window.electronAPI.preview.reload();
          }
        }
      }, 250);
    });

    // Window resize handler
    window.addEventListener('resize', () => {
      this.editor.layout();
    });
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

    document.getElementById('status-file-info').textContent = relativePath;
    this.renderTabs();
    this.highlightActiveTreeItem();
    this.validateActiveShader();
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
      diagSpan.className = 'diagnostic-clean';
      diagSpan.textContent = 'Ready';
      clearModelDiagnostics(this.editor);
      return;
    }

    try {
      if (window.electronAPI) {
        const res = await window.electronAPI.project.loadShader(this.activeFilePath);
        diagSpan.className = 'diagnostic-clean';
        diagSpan.textContent = `GLSL: OK (#includes resolved: ${res.sourceTable.length} modules)`;
        clearModelDiagnostics(this.editor);
      }
    } catch (err) {
      diagSpan.className = 'diagnostic-error';
      diagSpan.textContent = `GLSL Error: ${err.message}`;
      setModelDiagnostics(this.editor, [{ line: 1, message: err.message }]);
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
      } else if (data.type === 'audio:update') {
        this.latestAudioMetrics = data;
      }
    });
  }

  restartPreview() {
    const frame = document.getElementById('preview-frame');
    if (frame) {
      if (this.projectInfo && this.projectInfo.serverUrl) {
        frame.src = `${this.projectInfo.serverUrl}/index.html?t=${Date.now()}`;
      } else {
        frame.src = frame.src;
      }
    }
    if (window.electronAPI) {
      if (window.electronAPI.live) window.electronAPI.live.reload();
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

    // Populate display selector
    await this.loadLiveDisplays();

    // Toggle live output window
    if (btnToggle) {
      btnToggle.addEventListener('click', async () => {
        const displayId = selectDisplay ? selectDisplay.value : 'auto';
        await window.electronAPI.live.toggle({ displayId });
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

    if (!btnToggle || !label) return;

    if (status && status.isOpen) {
      btnToggle.classList.add('active');
      label.textContent = status.isFullscreen ? 'LIVE (FULL)' : 'LIVE ON';
      if (btnFs) btnFs.classList.remove('hidden');
    } else {
      btnToggle.classList.remove('active');
      label.textContent = 'Live Stage';
      if (btnFs) btnFs.classList.add('hidden');
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
  // 11. Event Listeners Wiring
  // =========================================================================
  initEventListeners() {
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
          title: 'Select Lossless Audio WAV Track',
          filters: [{ name: 'Audio WAV (*.wav)', extensions: ['wav'] }],
          properties: ['openFile']
        });
        if (filePath) {
          document.getElementById('export-audio-path').value = filePath;
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
