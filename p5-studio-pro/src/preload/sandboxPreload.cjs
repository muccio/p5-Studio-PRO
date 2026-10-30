/**
 * sandboxPreload.js
 * Injected into the Preview Sandbox and Deterministic Export Window.
 * Implements:
 * 1. Pixel-Perfect Cross-OS Rendering Parity (macOS & Windows) & WebGL Context Enforcer
 * 2. ideShader: Stateful Hot-Reloading, Recursive #include Resolution & Auto-Uniform Binding
 * 3. ideAudio: Dual-Mode Audio Engine (Hardware Live Input + Deterministic Offline Radix-2 Cooley-Tukey FFT) & 1024x2 WebGL Audio Texture
 * 4. ideOSC: Real-time UDP OSC + Deterministic Offline Replay & Direct Shader Uniform Mapping
 * 5. Virtual Clock & Non-Real-Time Frame-by-Frame Lockstep Exporter
 */

let ipcRenderer = null;
try {
  const electron = require('electron');
  ipcRenderer = electron.ipcRenderer;
} catch (e) {
  // If running in an iframe without direct electron require, IPC will fallback to postMessage
}

window.__isSandboxPreloadLoaded = true;

// Check URL query parameters for offline export mode, live stage, and popout preview
const urlParams = new URLSearchParams(window.location.search);
const isExportMode = urlParams.get('export') === 'true';
const isLiveMode = urlParams.get('live') === 'true';
const isPopoutMode = urlParams.get('popout') === 'true';
const exportTargetW = parseInt(urlParams.get('w') || '1920', 10);
const exportTargetH = parseInt(urlParams.get('h') || '1080', 10);
const exportTargetFps = parseInt(urlParams.get('fps') || '60', 10);
const exportTotalFrames = parseInt(urlParams.get('totalFrames') || '300', 10);
const exportAudioPath = urlParams.get('audioPath') || null;
const exportOscPath = urlParams.get('oscPath') || null;

if (isLiveMode) {
  // Live Stage Presentation Output styling: zero margins, clean canvas, cursor auto-hiding
  window.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = `
      html, body {
        width: 100vw !important;
        height: 100vh !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        background: #000000 !important;
        user-select: none !important;
      }
      canvas {
        width: 100vw !important;
        height: 100vh !important;
        display: block !important;
        object-fit: contain !important;
      }
      body.hide-cursor {
        cursor: none !important;
      }
    `;
    document.head.appendChild(style);

    // Auto-hide cursor on live stage after 2.5s inactivity
    let cursorTimer = null;
    const resetCursor = () => {
      document.body.classList.remove('hide-cursor');
      if (cursorTimer) clearTimeout(cursorTimer);
      cursorTimer = setTimeout(() => {
        document.body.classList.add('hide-cursor');
      }, 2500);
    };
    window.addEventListener('mousemove', resetCursor);
    resetCursor();
  });

  // Double click or F11 toggles Fullscreen on Live Stage window
  window.addEventListener('dblclick', () => {
    if (ipcRenderer) {
      ipcRenderer.invoke('live:toggleFullscreen');
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'F11') {
      e.preventDefault();
      if (ipcRenderer) ipcRenderer.invoke('live:toggleFullscreen');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (ipcRenderer) ipcRenderer.invoke('live:exitFullscreen');
    }
  });
}

if (isPopoutMode) {
  // Popout preview styling: full viewport scaling
  window.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = `
      html, body {
        width: 100vw !important;
        height: 100vh !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        background: #0a0d14 !important;
      }
      canvas {
        width: 100vw !important;
        height: 100vh !important;
        display: block !important;
        object-fit: contain !important;
      }
    `;
    document.head.appendChild(style);
  });

  // Double click or F11 toggles Fullscreen on Popout Preview window
  window.addEventListener('dblclick', () => {
    if (ipcRenderer) ipcRenderer.invoke('preview:toggleFullscreen');
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'F11') {
      e.preventDefault();
      if (ipcRenderer) ipcRenderer.invoke('preview:toggleFullscreen');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (ipcRenderer) ipcRenderer.invoke('preview:exitFullscreen');
    }
  });
}

// =========================================================================
// Sandbox Error Boundary for Electron Preload Environment
// =========================================================================
if (!isExportMode && !isLiveMode) {
  function showSandboxErrorOverlay(msg, source, line, col) {
    let overlay = document.getElementById('studio-sandbox-error-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'studio-sandbox-error-overlay';
      overlay.style.cssText = `
        position: fixed;
        bottom: 16px;
        left: 16px;
        right: 16px;
        max-width: 580px;
        z-index: 9999999;
        background: rgba(30, 8, 12, 0.95);
        backdrop-filter: blur(8px);
        border: 1px solid #ff0055;
        border-radius: 6px;
        padding: 10px 14px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
        color: #ff99bb;
        font-family: Menlo, Monaco, Consolas, monospace;
        font-size: 12px;
        line-height: 1.5;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        pointer-events: auto;
      `;
      const content = document.createElement('div');
      content.id = 'studio-sandbox-error-content';
      overlay.appendChild(content);

      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = '&times;';
      closeBtn.title = 'Chiudi notifica errore';
      closeBtn.style.cssText = `
        background: none;
        border: none;
        color: #ff0055;
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
        padding: 0 0 0 12px;
        margin: 0;
      `;
      closeBtn.onclick = () => {
        overlay.remove();
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'runtime:success' }, '*');
        }
      };
      overlay.appendChild(closeBtn);

      const parent = document.body || document.documentElement;
      if (parent) parent.appendChild(overlay);
    }

    const content = document.getElementById('studio-sandbox-error-content');
    if (content) {
      let displaySource = source ? source.split('/').pop() : 'sketch.js';
      let displayMsg = msg;
      if (msg === 'Script error.' && (!line || line === 0)) {
        displaySource = 'CDN / Script Esterno';
        displayMsg = 'Possibile incompatibilità o errore di caricamento nella versione p5.js selezionata. Seleziona una versione stabile (es. 1.11.2) dal menu a tendina.';
      }
      const loc = line && line > 0 ? `:${line}${col ? `:${col}` : ''}` : '';
      content.innerHTML = `
        <div style="font-weight: bold; color: #ff3366; margin-bottom: 2px;">
          ⚠️ Errore Runtime / Sintassi (${displaySource}${loc})
        </div>
        <div style="color: #ffe6ec; word-break: break-word;">${displayMsg}</div>
      `;
    }
  }

  function clearSandboxErrorOverlay() {
    const overlay = document.getElementById('studio-sandbox-error-overlay');
    if (overlay) overlay.remove();
  }

  clearSandboxErrorOverlay();

  window.addEventListener('error', (event) => {
    const msg = event.message || 'Script execution error';
    const source = event.filename || (msg === 'Script error.' ? 'CDN' : 'sketch.js');
    const line = event.lineno || 0;
    const col = event.colno || 0;

    showSandboxErrorOverlay(msg, source, line, col);

    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'runtime:error',
        message: msg,
        filename: source.split('/').pop(),
        lineno: line,
        colno: col
      }, '*');
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    const msg = event.reason ? (event.reason.message || String(event.reason)) : 'Unhandled Promise Rejection';
    showSandboxErrorOverlay(msg, 'async', 0, 0);

    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'runtime:error',
        message: msg,
        filename: 'async',
        lineno: 0,
        colno: 0
      }, '*');
    }
  });

  window.addEventListener('DOMContentLoaded', () => {
    clearSandboxErrorOverlay();
  });
}

if (isExportMode) {
  // Override window inner dimensions to exact export resolution
  try {
    Object.defineProperty(window, 'innerWidth', { get: () => exportTargetW });
    Object.defineProperty(window, 'innerHeight', { get: () => exportTargetH });
  } catch (e) {}

  // Inject exact pixel sizing styles to avoid any CSS stretching or letterboxing
  window.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = `
      html, body { width: ${exportTargetW}px !important; height: ${exportTargetH}px !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
      canvas { width: ${exportTargetW}px !important; height: ${exportTargetH}px !important; display: block !important; object-fit: fill !important; }
    `;
    document.head.appendChild(style);
  });

  // Double click or F11 toggles Fullscreen on Popout Preview window
  window.addEventListener('dblclick', () => {
    if (ipcRenderer) ipcRenderer.invoke('preview:toggleFullscreen');
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'F11') {
      e.preventDefault();
      if (ipcRenderer) ipcRenderer.invoke('preview:toggleFullscreen');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (ipcRenderer) ipcRenderer.invoke('preview:exitFullscreen');
    }
  });
}

let currentExportFrame = 0;
let currentExportTimeMs = 0;
const trackedExportSoundFiles = new Set();

function installP5SoundExportHooks(P5) {
  if (!isExportMode || !P5) return;

  // 1. Hook p5.SoundFile so isPlaying() / currentTime() / buffer tracking work deterministically offline
  if (P5.SoundFile && P5.SoundFile.prototype && !P5.SoundFile.__studioExportHooked) {
    P5.SoundFile.__studioExportHooked = true;
    const sfProto = P5.SoundFile.prototype;

    if (typeof P5.prototype.loadSound === 'function') {
      const origLoadSound = P5.prototype.loadSound;
      P5.prototype.loadSound = function () {
        const sf = origLoadSound.apply(this, arguments);
        if (sf) trackedExportSoundFiles.add(sf);
        return sf;
      };
    }

    const origPlay = sfProto.play;
    sfProto.play = function () {
      trackedExportSoundFiles.add(this);
      this._exportPlaying = true;
      try {
        return origPlay ? origPlay.apply(this, arguments) : undefined;
      } catch (e) {
        return undefined;
      }
    };

    const origLoop = sfProto.loop;
    sfProto.loop = function () {
      trackedExportSoundFiles.add(this);
      this._exportPlaying = true;
      this._exportLooping = true;
      try {
        return origLoop ? origLoop.apply(this, arguments) : undefined;
      } catch (e) {
        return undefined;
      }
    };

    const origStop = sfProto.stop;
    sfProto.stop = function () {
      this._exportPlaying = false;
      try {
        return origStop ? origStop.apply(this, arguments) : undefined;
      } catch (e) {
        return undefined;
      }
    };

    const origPause = sfProto.pause;
    sfProto.pause = function () {
      this._exportPlaying = false;
      try {
        return origPause ? origPause.apply(this, arguments) : undefined;
      } catch (e) {
        return undefined;
      }
    };

    const origIsPlaying = sfProto.isPlaying;
    sfProto.isPlaying = function () {
      if (this._exportPlaying !== undefined) return Boolean(this._exportPlaying);
      return origIsPlaying ? origIsPlaying.apply(this, arguments) : true;
    };

    const origCurrentTime = sfProto.currentTime;
    sfProto.currentTime = function () {
      const tSec = currentExportTimeMs / 1000.0;
      const dur = (this.buffer && this.buffer.duration) ? this.buffer.duration : 0;
      if (dur > 0) {
        return this._exportLooping ? (tSec % dur) : Math.min(tSec, dur);
      }
      return origCurrentTime ? tSec : tSec;
    };
  }

  // 2. Hook p5.FFT for sample-accurate W3C Web Audio AnalyserNode lockstep rendering
  if (P5.FFT && P5.FFT.prototype && !P5.FFT.__studioExportHooked) {
    P5.FFT.__studioExportHooked = true;
    const fftProto = P5.FFT.prototype;

    const origSetInput = fftProto.setInput;
    fftProto.setInput = function (snd) {
      this._exportInput = snd || null;
      if (snd && snd.buffer) trackedExportSoundFiles.add(snd);
      try {
        return origSetInput ? origSetInput.apply(this, arguments) : undefined;
      } catch (e) {
        return undefined;
      }
    };

    const origSmooth = fftProto.smooth;
    fftProto.smooth = function (s) {
      if (typeof s === 'number') {
        this.smoothing = Math.max(0.0, Math.min(0.999, s));
      }
      return origSmooth ? origSmooth.apply(this, arguments) : this.smoothing;
    };

    fftProto.analyze = function () {
      let requestedScale = null;
      for (let i = 0; i < arguments.length; i++) {
        if (typeof arguments[i] === 'number' && arguments[i] >= 16) {
          this.bins = arguments[i];
          if (this.analyser) {
            try { this.analyser.fftSize = this.bins * 2; } catch (e) {}
          }
        } else if (typeof arguments[i] === 'string') {
          requestedScale = arguments[i].toLowerCase();
        }
      }

      const bins = Math.max(16, Math.min(16384, this.bins || (this.analyser ? this.analyser.frequencyBinCount : 1024)));
      const fftSize = bins * 2;
      const smoothing = (typeof this.smoothing === 'number')
        ? Math.max(0.0, Math.min(0.999, this.smoothing))
        : (this.analyser ? this.analyser.smoothingTimeConstant : 0.8);
      const minDb = (this.analyser && typeof this.analyser.minDecibels === 'number') ? this.analyser.minDecibels : -100.0;
      const maxDb = (this.analyser && typeof this.analyser.maxDecibels === 'number') ? this.analyser.maxDecibels : -30.0;
      const dbRange = Math.max(1.0, maxDb - minDb);

      if (!this._exportSmoothedMag || this._exportSmoothedMag.length !== bins) {
        this._exportSmoothedMag = new Float32Array(bins);
        this._exportLastFrame = -1;
      }

      if (this._exportLastFrame !== currentExportFrame) {
        this._exportLastFrame = currentExportFrame;
        const src = resolveExportAudioSource(this._exportInput);
        const slice = sliceExportPcmWindow(src, fftSize, currentExportTimeMs);
        const rawMag = getWebAudioOfflineFFT(fftSize).forwardMagnitudes(slice);

        for (let k = 0; k < bins; k++) {
          this._exportSmoothedMag[k] = smoothing * this._exportSmoothedMag[k] + (1.0 - smoothing) * rawMag[k];
        }
      }

      if (requestedScale === 'db') {
        if (!(this.freqDomain instanceof Float32Array) || this.freqDomain.length !== bins) {
          this.freqDomain = new Float32Array(bins);
        }
        for (let k = 0; k < bins; k++) {
          const mag = this._exportSmoothedMag[k];
          this.freqDomain[k] = mag > 1e-20 ? (20.0 * Math.log10(mag)) : -140.0;
        }
        return this.freqDomain;
      }

      if (!(this.freqDomain instanceof Uint8Array) || this.freqDomain.length !== bins) {
        this.freqDomain = new Uint8Array(bins);
      }
      const resultArray = new Array(bins);
      for (let k = 0; k < bins; k++) {
        const mag = this._exportSmoothedMag[k];
        const db = mag > 1e-20 ? (20.0 * Math.log10(mag)) : -1000.0;
        const byteVal = Math.max(0, Math.min(255, Math.floor(((db - minDb) / dbRange) * 255.0)));
        this.freqDomain[k] = byteVal;
        resultArray[k] = byteVal;
      }
      return resultArray;
    };

    const origGetEnergy = fftProto.getEnergy;
    if (typeof origGetEnergy === 'function') {
      fftProto.getEnergy = function () {
        if (this._exportLastFrame !== currentExportFrame || !this.freqDomain || !this.freqDomain.length) {
          this.analyze();
        }
        return origGetEnergy.apply(this, arguments);
      };
    }

    const origGetCentroid = fftProto.getCentroid;
    if (typeof origGetCentroid === 'function') {
      fftProto.getCentroid = function () {
        if (this._exportLastFrame !== currentExportFrame || !this.freqDomain || !this.freqDomain.length) {
          this.analyze();
        }
        return origGetCentroid.apply(this, arguments);
      };
    }

    fftProto.waveform = function () {
      let bins = this.bins || (this.analyser ? this.analyser.frequencyBinCount : 1024);
      let precisionStr = null;
      for (let i = 0; i < arguments.length; i++) {
        if (typeof arguments[i] === 'number' && arguments[i] >= 16) {
          bins = arguments[i];
        } else if (typeof arguments[i] === 'string') {
          precisionStr = arguments[i];
        }
      }

      const src = resolveExportAudioSource(this._exportInput);
      const slice = sliceExportPcmWindow(src, bins, currentExportTimeMs);

      if (precisionStr) {
        if (!(this.timeDomain instanceof Float32Array) || this.timeDomain.length !== bins) {
          this.timeDomain = new Float32Array(bins);
        }
        this.timeDomain.set(slice);
        return this.timeDomain;
      }

      if (!(this.timeDomain instanceof Uint8Array) || this.timeDomain.length !== bins) {
        this.timeDomain = new Uint8Array(bins);
      }
      const out = new Array(bins);
      for (let i = 0; i < bins; i++) {
        const s = Math.max(-1.0, Math.min(1.0, slice[i]));
        const byteVal = Math.max(0, Math.min(255, Math.round((s + 1.0) * 127.5)));
        this.timeDomain[i] = byteVal;
        out[i] = (byteVal / 255.0) * 2.0 - 1.0;
      }
      return out;
    };
  }

  // 3. Hook p5.Amplitude for deterministic offline RMS level analysis
  if (P5.Amplitude && P5.Amplitude.prototype && !P5.Amplitude.__studioExportHooked) {
    P5.Amplitude.__studioExportHooked = true;
    const ampProto = P5.Amplitude.prototype;

    const origAmpSetInput = ampProto.setInput;
    ampProto.setInput = function (snd) {
      this._exportInput = snd || null;
      if (snd && snd.buffer) trackedExportSoundFiles.add(snd);
      try {
        return origAmpSetInput ? origAmpSetInput.apply(this, arguments) : undefined;
      } catch (e) {
        return undefined;
      }
    };

    const origAmpSmooth = ampProto.smooth;
    ampProto.smooth = function (s) {
      if (typeof s === 'number') {
        this.smoothing = Math.max(0.0, Math.min(0.999, s));
      }
      return origAmpSmooth ? origAmpSmooth.apply(this, arguments) : this.smoothing;
    };

    const origToggleNormalize = ampProto.toggleNormalize;
    ampProto.toggleNormalize = function (boolean) {
      if (typeof boolean === 'boolean') {
        this.normalize = boolean;
      } else {
        this.normalize = !this.normalize;
      }
      return origToggleNormalize ? origToggleNormalize.apply(this, arguments) : undefined;
    };

    ampProto.getLevel = function () {
      const windowSize = this.bufferSize || 2048;
      const smoothing = (typeof this.smoothing === 'number') ? Math.max(0.0, Math.min(0.999, this.smoothing)) : 0.0;

      if (this._exportLastFrame !== currentExportFrame) {
        this._exportLastFrame = currentExportFrame;
        const src = resolveExportAudioSource(this._exportInput);
        const slice = sliceExportPcmWindow(src, windowSize, currentExportTimeMs);
        let sumSq = 0.0;
        for (let i = 0; i < slice.length; i++) {
          sumSq += slice[i] * slice[i];
        }
        const rms = Math.sqrt(sumSq / Math.max(1, slice.length));
        const prevVol = this._exportVol || 0.0;
        const vol = Math.max(rms, prevVol * smoothing);
        this._exportVol = vol;
        this.volMax = Math.max(this.volMax || 0.001, vol);
      }

      const vol = this._exportVol || 0.0;
      if (this.normalize) {
        return Math.max(0.0, Math.min(1.0, vol / (this.volMax || 0.001)));
      }
      return vol;
    };
  }
}

function installP5ExportHooks(P5) {
  if (!isExportMode || !P5) return;
  installP5SoundExportHooks(P5);

  if (P5.__studioCoreExportHooked) return;
  P5.__studioCoreExportHooked = true;

  if (P5.prototype && typeof P5.prototype.registerMethod === 'function') {
    P5.prototype.registerMethod('init', function () {
      window.__capturedP5Instance = this;
      installP5SoundExportHooks(window.p5 || P5);
    });
  }

  if (P5.prototype && typeof P5.prototype.createCanvas === 'function') {
    const origCreateCanvas = P5.prototype.createCanvas;
    P5.prototype.createCanvas = function (w, h, renderer) {
      window.__capturedP5Instance = this;
      if (typeof this.pixelDensity === 'function') {
        this.pixelDensity(1);
      }
      console.log(`[Export] Forcing canvas creation to exact export preset: ${exportTargetW}x${exportTargetH} (sketch requested ${w}x${h})`);
      return origCreateCanvas.call(this, exportTargetW, exportTargetH, renderer);
    };
  }

  if (P5.prototype && typeof P5.prototype._setup === 'function') {
    const origInternalSetup = P5.prototype._setup;
    P5.prototype._setup = function () {
      window.__capturedP5Instance = this;
      installP5SoundExportHooks(window.p5 || P5);
      const res = origInternalSetup.apply(this, arguments);
      if (typeof this.noLoop === 'function') {
        this.noLoop();
      }
      return res;
    };
  }
}

if (isExportMode) {
  // Intercept window.p5 assignment so both Global Mode and Instance Mode sketches are captured immediately
  let _globalP5Constructor = window.p5;
  try {
    Object.defineProperty(window, 'p5', {
      configurable: true,
      enumerable: true,
      get() {
        return _globalP5Constructor;
      },
      set(val) {
        _globalP5Constructor = val;
        if (val) {
          installP5ExportHooks(val);
        }
      }
    });
  } catch (e) {}

  window.addEventListener('DOMContentLoaded', () => {
    if (window.p5) {
      installP5ExportHooks(window.p5);
    }
  });

  // Guard p5's shader() to prevent crashes if called before shader sources have finished downloading
  let _p5Shader = null;
  Object.defineProperty(window, 'shader', {
    configurable: true,
    enumerable: true,
    get() {
      return _p5Shader;
    },
    set(fn) {
      _p5Shader = function (s) {
        if (!s || (s._vertSrc === undefined && s._fragSrc === undefined && !s._glProgram)) {
          return this;
        }
        return fn.apply(this, arguments);
      };
    }
  });
}

// =========================================================================
// 1. Pixel-Perfect WebGL Context & Precision Enforcement
// =========================================================================
const origGetContext = HTMLCanvasElement.prototype.getContext;
let activeGLContext = null;
let activeGLCanvas = null;
let activeCanvas = null;

HTMLCanvasElement.prototype.getContext = function (contextType, contextAttributes) {
  if (contextType === 'webgl' || contextType === 'webgl2') {
    const enforcedAttributes = Object.assign(
      {
        preserveDrawingBuffer: true,
        antialias: true,
        premultipliedAlpha: false,
        powerPreference: 'high-performance'
      },
      contextAttributes || {}
    );

    const gl = origGetContext.call(this, contextType, enforcedAttributes);
    if (gl) {
      activeGLContext = gl;
      activeGLCanvas = this;
      activeCanvas = this;
      if (isExportMode && (!this.className || this.classList.contains('p5Canvas') || !document.querySelector('canvas.p5Canvas'))) {
        gl.viewport(0, 0, this.width || exportTargetW, this.height || exportTargetH);
      }
      hookGLContext(gl);
    }
    return gl;
  }
  const attrs2d = (isExportMode && contextType === '2d')
    ? Object.assign({ willReadFrequently: true }, contextAttributes || {})
    : contextAttributes;
  const ctx = origGetContext.call(this, contextType, attrs2d);
  if (ctx && contextType === '2d') {
    if (!activeCanvas || (this.classList && this.classList.contains('p5Canvas'))) {
      activeCanvas = this;
    }
  }
  return ctx;
};

function hookGLContext(gl) {
  const origShaderSource = gl.shaderSource;
  gl.shaderSource = function (shader, source) {
    let finalSource = source;
    // Check if shader is fragment shader and ensure highp precision is prepended
    const shaderType = gl.getShaderParameter(shader, gl.SHADER_TYPE);
    if (shaderType === gl.FRAGMENT_SHADER) {
      if (!/precision\s+(highp|mediump|lowp)\s+float;/i.test(source)) {
        finalSource = '#ifdef GL_ES\nprecision highp float;\nprecision highp int;\n#endif\n' + source;
      }
    }
    return origShaderSource.call(this, shader, finalSource);
  };
}

// =========================================================================
// 2. Pure JS Radix-2 Cooley-Tukey FFT & Offline DSP Math
// =========================================================================
class CooleyTukeyFFT {
  constructor(size = 2048) {
    this.size = size;
    // Precompute bit-reversal table and twiddle factors
    this.bitRev = new Uint32Array(size);
    const bits = Math.round(Math.log2(size));
    for (let i = 0; i < size; i++) {
      let rev = 0;
      for (let j = 0; j < bits; j++) {
        rev = (rev << 1) | ((i >> j) & 1);
      }
      this.bitRev[i] = rev;
    }

    // Precompute twiddle factors (cos & sin)
    this.cosTable = new Float32Array(size / 2);
    this.sinTable = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      const angle = (-2.0 * Math.PI * i) / size;
      this.cosTable[i] = Math.cos(angle);
      this.sinTable[i] = Math.sin(angle);
    }

    // Precompute Hann window
    this.hannWindow = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      this.hannWindow[i] = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / (size - 1)));
    }

    this.real = new Float32Array(size);
    this.imag = new Float32Array(size);
    this.spectrum = new Float32Array(size / 2);
  }

  forward(timeDomainSamples) {
    const N = this.size;
    // 1. Apply Hann window and bit-reversal ordering
    for (let i = 0; i < N; i++) {
      const rev = this.bitRev[i];
      const sample = (i < timeDomainSamples.length ? timeDomainSamples[i] : 0.0) * this.hannWindow[i];
      this.real[rev] = sample;
      this.imag[rev] = 0.0;
    }

    // 2. Cooley-Tukey Radix-2 decimation-in-time
    for (let len = 2; len <= N; len <<= 1) {
      const halfLen = len >> 1;
      const step = N / len;
      for (let i = 0; i < N; i += len) {
        let tableIdx = 0;
        for (let j = 0; j < halfLen; j++) {
          const c = this.cosTable[tableIdx];
          const s = this.sinTable[tableIdx];
          tableIdx += step;

          const uR = this.real[i + j];
          const uI = this.imag[i + j];
          const vR = this.real[i + j + halfLen] * c - this.imag[i + j + halfLen] * s;
          const vI = this.real[i + j + halfLen] * s + this.imag[i + j + halfLen] * c;

          this.real[i + j] = uR + vR;
          this.imag[i + j] = uI + vI;
          this.real[i + j + halfLen] = uR - vR;
          this.imag[i + j + halfLen] = uI - vI;
        }
      }
    }

    // 3. Compute magnitude spectrum normalized 0..1
    const halfN = N / 2;
    const norm = 2.0 / N;
    for (let i = 0; i < halfN; i++) {
      const mag = Math.sqrt(this.real[i] * this.real[i] + this.imag[i] * this.imag[i]) * norm;
      this.spectrum[i] = mag;
    }

    return this.spectrum;
  }
}

/**
 * W3C Web Audio API RealtimeAnalyser-compatible FFT (Blackman window, 1/N scaling, power-of-2 size)
 * Used in offline deterministic export so p5.FFT.analyze() matches live Web Audio 1:1.
 */
class WebAudioOfflineFFT {
  constructor(size = 2048) {
    let pow2 = 32;
    while (pow2 < size && pow2 < 32768) pow2 <<= 1;
    this.size = pow2;

    const bits = Math.round(Math.log2(this.size));
    this.bitRev = new Uint32Array(this.size);
    for (let i = 0; i < this.size; i++) {
      let rev = 0;
      for (let j = 0; j < bits; j++) {
        rev = (rev << 1) | ((i >> j) & 1);
      }
      this.bitRev[i] = rev;
    }

    this.cosTable = new Float32Array(this.size / 2);
    this.sinTable = new Float32Array(this.size / 2);
    for (let i = 0; i < this.size / 2; i++) {
      const angle = (-2.0 * Math.PI * i) / this.size;
      this.cosTable[i] = Math.cos(angle);
      this.sinTable[i] = Math.sin(angle);
    }

    // W3C Web Audio AnalyserNode Blackman window (alpha = 0.16)
    this.blackmanWindow = new Float32Array(this.size);
    for (let i = 0; i < this.size; i++) {
      this.blackmanWindow[i] =
        0.42 -
        0.5 * Math.cos((2.0 * Math.PI * i) / this.size) +
        0.08 * Math.cos((4.0 * Math.PI * i) / this.size);
    }

    this.real = new Float32Array(this.size);
    this.imag = new Float32Array(this.size);
    this.magnitudes = new Float32Array(this.size / 2);
  }

  forwardMagnitudes(timeDomainSamples) {
    const N = this.size;
    for (let i = 0; i < N; i++) {
      const rev = this.bitRev[i];
      const s = i < timeDomainSamples.length ? timeDomainSamples[i] : 0.0;
      this.real[rev] = s * this.blackmanWindow[i];
      this.imag[rev] = 0.0;
    }

    for (let len = 2; len <= N; len <<= 1) {
      const halfLen = len >> 1;
      const step = N / len;
      for (let i = 0; i < N; i += len) {
        let tableIdx = 0;
        for (let j = 0; j < halfLen; j++) {
          const c = this.cosTable[tableIdx];
          const s = this.sinTable[tableIdx];
          tableIdx += step;

          const uR = this.real[i + j];
          const uI = this.imag[i + j];
          const vR = this.real[i + j + halfLen] * c - this.imag[i + j + halfLen] * s;
          const vI = this.real[i + j + halfLen] * s + this.imag[i + j + halfLen] * c;

          this.real[i + j] = uR + vR;
          this.imag[i + j] = uI + vI;
          this.real[i + j + halfLen] = uR - vR;
          this.imag[i + j + halfLen] = uI - vI;
        }
      }
    }

    const halfN = N >> 1;
    const invN = 1.0 / N;
    for (let k = 0; k < halfN; k++) {
      this.magnitudes[k] = Math.hypot(this.real[k], this.imag[k]) * invN;
    }
    return this.magnitudes;
  }
}

const webAudioOfflineFFTCache = new Map();
function getWebAudioOfflineFFT(fftSize) {
  let pow2 = 32;
  while (pow2 < fftSize && pow2 < 32768) pow2 <<= 1;
  let inst = webAudioOfflineFFTCache.get(pow2);
  if (!inst) {
    inst = new WebAudioOfflineFFT(pow2);
    webAudioOfflineFFTCache.set(pow2, inst);
  }
  return inst;
}

function extractAudioBufferMonoPcm(audioBuffer) {
  if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function' || !audioBuffer.length) {
    return null;
  }
  if (audioBuffer.__cachedExportMono) {
    return audioBuffer.__cachedExportMono;
  }
  const channels = Math.max(1, audioBuffer.numberOfChannels || 1);
  const length = audioBuffer.length;
  const mono = new Float32Array(length);
  for (let ch = 0; ch < channels; ch++) {
    const chData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      mono[i] += chData[i];
    }
  }
  if (channels > 1) {
    const invCh = 1.0 / channels;
    for (let i = 0; i < length; i++) {
      mono[i] *= invCh;
    }
  }
  const cached = { pcm: mono, sampleRate: audioBuffer.sampleRate || 48000 };
  audioBuffer.__cachedExportMono = cached;
  return cached;
}

function resolveExportAudioSource(inputObj) {
  // Multi-stem support: if >1 distinct SoundFiles exist and a specific SoundFile was passed to setInput()
  if (trackedExportSoundFiles.size > 1 && inputObj && inputObj.buffer) {
    const stem = extractAudioBufferMonoPcm(inputObj.buffer);
    if (stem) {
      return { pcm: stem.pcm, sampleRate: stem.sampleRate, looping: Boolean(inputObj._exportLooping) };
    }
  }

  // Primary: decoded audio file explicitly selected in Export Video modal (synced 1:1 with FFmpeg muxing)
  if (window.ideAudio && window.ideAudio.offlinePcm && window.ideAudio.offlinePcm.length > 0) {
    return {
      pcm: window.ideAudio.offlinePcm,
      sampleRate: window.ideAudio.sampleRate || 48000,
      looping: Boolean(inputObj && inputObj._exportLooping)
    };
  }

  // Fallback 1: SoundFile explicitly connected via setInput(sound)
  if (inputObj && inputObj.buffer) {
    const connected = extractAudioBufferMonoPcm(inputObj.buffer);
    if (connected) {
      return { pcm: connected.pcm, sampleRate: connected.sampleRate, looping: Boolean(inputObj._exportLooping) };
    }
  }

  // Fallback 2: Any p5.SoundFile loaded in preload()/setup()
  for (const sf of trackedExportSoundFiles) {
    if (sf && sf.buffer) {
      const extracted = extractAudioBufferMonoPcm(sf.buffer);
      if (extracted) {
        return { pcm: extracted.pcm, sampleRate: extracted.sampleRate, looping: Boolean(sf._exportLooping) };
      }
    }
  }

  return null;
}

function sliceExportPcmWindow(source, windowSize, timeMs) {
  const slice = new Float32Array(windowSize);
  if (!source || !source.pcm || source.pcm.length === 0) {
    return slice;
  }
  const pcm = source.pcm;
  const total = pcm.length;
  const endSample = Math.floor((timeMs / 1000.0) * source.sampleRate);
  const startSample = endSample - windowSize;

  for (let i = 0; i < windowSize; i++) {
    let idx = startSample + i;
    if (idx < 0) {
      slice[i] = 0.0;
    } else if (idx >= total) {
      slice[i] = source.looping ? pcm[idx % total] : 0.0;
    } else {
      slice[i] = pcm[idx];
    }
  }
  return slice;
}

// =========================================================================
// 3. ideAudio Engine (Unified Live Input & Offline Deterministic DSP)
// =========================================================================
class IdeAudioEngine {
  constructor() {
    this.fftSize = 2048;
    this.sampleRate = 48000;
    this.smoothingTimeConstant = 0.8;

    // Live mode Web Audio nodes
    this.audioCtx = null;
    this.analyser = null;
    this.liveStream = null;
    this.liveTimeData = new Uint8Array(this.fftSize);
    this.liveFreqData = new Uint8Array(this.fftSize / 2);

    // Offline DSP mode data
    this.offlinePcm = null;
    this.offlineFFT = new CooleyTukeyFFT(this.fftSize);
    this.offlineSmoothedFreq = new Float32Array(this.fftSize / 2);

    // Peak hold buffers for Green channel in Audio Texture
    this.peakHoldFreq = new Float32Array(1024);

    // Metrics
    this.currentRMS = 0;
    this.bands = {
      sub: 0,
      bass: 0,
      lowMid: 0,
      mid: 0,
      highMid: 0,
      treble: 0
    };

    // Beat detection state
    this.lastBeatTime = 0;
    this.energyHistory = [];

    // WebGL Audio Texture cache (p5.Image)
    this.p5AudioTexture = null;
  }

  async initLive() {
    if (this.audioCtx) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass({ sampleRate: 48000 });

      this.liveStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 48000
        }
      });

      const source = this.audioCtx.createMediaStreamSource(this.liveStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = this.fftSize;
      this.analyser.smoothingTimeConstant = this.smoothingTimeConstant;
      source.connect(this.analyser);
      console.log('[ideAudio] Live audio initialized');
    } catch (err) {
      console.warn('[ideAudio] Audio input not accessible, using synthetic audio fallback:', err.message);
    }
  }

  loadOfflineWav(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const numChannels = view.getUint16(22, true);
    this.sampleRate = view.getUint32(24, true);
    const bitsPerSample = view.getUint16(34, true);

    // Locate 'data' subchunk
    let offset = 12;
    while (offset < view.byteLength) {
      const chunkId = String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3)
      );
      const chunkSize = view.getUint32(offset + 4, true);
      if (chunkId === 'data') {
        offset += 8;
        break;
      }
      offset += 8 + chunkSize;
    }

    const dataBytes = view.byteLength - offset;
    const bytesPerSample = bitsPerSample / 8;
    const totalSamples = Math.floor(dataBytes / (bytesPerSample * numChannels));
    this.offlinePcm = new Float32Array(totalSamples);

    for (let i = 0; i < totalSamples; i++) {
      let sampleSum = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        const sampleOffset = offset + (i * numChannels + ch) * bytesPerSample;
        if (sampleOffset + bytesPerSample <= view.byteLength) {
          if (bitsPerSample === 32) {
            sampleSum += view.getFloat32(sampleOffset, true);
          } else if (bitsPerSample === 16) {
            sampleSum += view.getInt16(sampleOffset, true) / 32768.0;
          }
        }
      }
      this.offlinePcm[i] = sampleSum / numChannels;
    }

    console.log(`[ideAudio] Loaded offline WAV: ${totalSamples} samples @ ${this.sampleRate}Hz`);
    this._lastOfflineFrame = -1;
  }

  setOfflinePcm(pcmFloat32, sampleRate = 48000) {
    if (!pcmFloat32 || !pcmFloat32.length) return;
    this.offlinePcm = pcmFloat32 instanceof Float32Array ? pcmFloat32 : new Float32Array(pcmFloat32);
    this.sampleRate = sampleRate || 48000;
    this.offlineSmoothedFreq.fill(0);
    this.peakHoldFreq.fill(0);
    this._lastOfflineFrame = -1;
    console.log(`[ideAudio] Loaded offline PCM: ${this.offlinePcm.length} samples @ ${this.sampleRate}Hz`);
  }

  update(virtualFrame, targetFps) {
    if (isExportMode) {
      if (!this.offlinePcm) {
        const fallback = resolveExportAudioSource(null);
        if (fallback && fallback.pcm) {
          this.setOfflinePcm(fallback.pcm, fallback.sampleRate);
        }
      }
      if (this.offlinePcm) {
        const frameToUse = typeof virtualFrame === 'number' ? virtualFrame : currentExportFrame;
        const fpsToUse = typeof targetFps === 'number' ? targetFps : exportTargetFps;
        this._updateOffline(frameToUse, fpsToUse);
        return;
      }
    }
    this._updateLive();
  }

  _updateLive() {
    if (this.analyser) {
      this.analyser.getByteTimeDomainData(this.liveTimeData);
      this.analyser.getByteFrequencyData(this.liveFreqData);

      // Compute RMS
      let sumSquares = 0;
      for (let i = 0; i < this.fftSize; i++) {
        const val = (this.liveTimeData[i] - 128) / 128.0;
        sumSquares += val * val;
      }
      this.currentRMS = Math.sqrt(sumSquares / this.fftSize);

      // Compute standard frequency bands (0..1)
      const binHz = (this.sampleRate / 2) / (this.fftSize / 2);
      this.bands.sub = this._calcBandLive(20, 60, binHz);
      this.bands.bass = this._calcBandLive(60, 250, binHz);
      this.bands.lowMid = this._calcBandLive(250, 500, binHz);
      this.bands.mid = this._calcBandLive(500, 2000, binHz);
      this.bands.highMid = this._calcBandLive(2000, 4000, binHz);
      this.bands.treble = this._calcBandLive(4000, 20000, binHz);
    } else {
      // Synthetic fallback generator for preview when mic is disabled
      const t = performance.now() / 1000;
      const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2)), 4);
      this.bands.bass = 0.3 + 0.7 * beat;
      this.bands.mid = 0.2 + 0.4 * Math.sin(t * 3.5);
      this.bands.treble = 0.1 + 0.3 * Math.cos(t * 5.0);
      this.currentRMS = 0.2 + 0.5 * beat;
      for (let i = 0; i < 1024; i++) {
        this.liveFreqData[i] = Math.min(255, Math.floor((this.bands.bass * Math.exp(-i / 80) + 0.1 * Math.sin(i * 0.1 + t * 4)) * 255));
        this.liveTimeData[i] = Math.floor(128 + 120 * Math.sin((i / 1024) * Math.PI * 8 + t * 10) * this.currentRMS);
      }
    }
  }

  _calcBandLive(lowHz, highHz, binHz) {
    const startBin = Math.max(0, Math.floor(lowHz / binHz));
    const endBin = Math.min(this.liveFreqData.length - 1, Math.ceil(highHz / binHz));
    if (endBin <= startBin) return this.liveFreqData[startBin] / 255.0;

    let sum = 0;
    for (let i = startBin; i <= endBin; i++) {
      sum += this.liveFreqData[i];
    }
    return sum / ((endBin - startBin + 1) * 255.0);
  }

  _updateOffline(frameN, fps) {
    if (this._lastOfflineFrame === frameN) return;
    this._lastOfflineFrame = frameN;

    const endSample = Math.floor((frameN / fps) * this.sampleRate);
    const startSample = endSample - this.fftSize;

    const slice = new Float32Array(this.fftSize);
    for (let i = 0; i < this.fftSize; i++) {
      const idx = startSample + i;
      slice[i] = (idx >= 0 && idx < this.offlinePcm.length) ? this.offlinePcm[idx] : 0.0;
    }

    // Run Blackman Web Audio-compatible FFT (matches live AnalyserNode dB scale)
    const rawSpectrum = getWebAudioOfflineFFT(this.fftSize).forwardMagnitudes(slice);

    // Exponential smoothing relative to frame N-1
    for (let i = 0; i < 1024; i++) {
      this.offlineSmoothedFreq[i] = this.smoothingTimeConstant * this.offlineSmoothedFreq[i] + (1.0 - this.smoothingTimeConstant) * rawSpectrum[i];
    }

    // RMS
    let sumSquares = 0;
    for (let i = 0; i < this.fftSize; i++) {
      sumSquares += slice[i] * slice[i];
    }
    this.currentRMS = Math.sqrt(sumSquares / this.fftSize);

    // Update time & freq data buffers using W3C Web Audio dB range [-100dB, -30dB] -> [0..255]
    for (let i = 0; i < 1024; i++) {
      const mag = this.offlineSmoothedFreq[i];
      const db = mag > 1e-20 ? (20.0 * Math.log10(mag)) : -1000.0;
      const byteFreq = Math.max(0, Math.min(255, Math.floor(((db - (-100.0)) / 70.0) * 255.0)));
      this.liveFreqData[i] = byteFreq;

      const rawSample = (i < this.fftSize) ? slice[i] : 0.0;
      this.liveTimeData[i] = Math.max(0, Math.min(255, Math.floor((rawSample + 1.0) * 127.5)));
    }

    // Compute normalized frequency bands (0..1) directly from liveFreqData so live and offline match 1:1
    const binHz = (this.sampleRate / 2) / 1024;
    this.bands.sub = this._calcBandLive(20, 60, binHz);
    this.bands.bass = this._calcBandLive(60, 250, binHz);
    this.bands.lowMid = this._calcBandLive(250, 500, binHz);
    this.bands.mid = this._calcBandLive(500, 2000, binHz);
    this.bands.highMid = this._calcBandLive(2000, 4000, binHz);
    this.bands.treble = this._calcBandLive(4000, 20000, binHz);
  }

  _calcBandOffline(lowHz, highHz, binHz) {
    const startBin = Math.max(0, Math.floor(lowHz / binHz));
    const endBin = Math.min(1023, Math.ceil(highHz / binHz));
    if (endBin <= startBin) return Math.min(1.0, this.offlineSmoothedFreq[startBin] * 4.0);

    let sum = 0;
    for (let i = startBin; i <= endBin; i++) {
      sum += this.offlineSmoothedFreq[i];
    }
    return Math.min(1.0, (sum / (endBin - startBin + 1)) * 4.0);
  }

  getRMS() { return this.currentRMS; }
  getFFT() { return this.liveFreqData; }
  getWaveform() { return this.liveTimeData; }
  getEnergy(bandOrLowHz, highHz) {
    if (typeof bandOrLowHz === 'string') {
      return this.bands[bandOrLowHz] || 0;
    }
    const binHz = (this.sampleRate / 2) / (this.fftSize / 2);
    return this._calcBandLive(bandOrLowHz, highHz, binHz);
  }

  isBeat(threshold = 0.5, minIntervalMs = 200) {
    const now = performance.now();
    const energy = this.bands.bass * 0.7 + this.currentRMS * 0.3;
    if (energy > threshold && (now - this.lastBeatTime) > minIntervalMs) {
      this.lastBeatTime = now;
      return true;
    }
    return false;
  }

  /**
   * 1024x2 WebGL Audio Data Texture
   * Row 0: 1024 FFT frequency bins (R = current bin, G = smoothed peak-hold)
   * Row 1: 1024 time-domain Waveform samples (R = waveform mapped 0..255, 128 = zero)
   */
  getTexture(p5Instance) {
    if (!this.p5AudioTexture && p5Instance && p5Instance.createImage) {
      this.p5AudioTexture = p5Instance.createImage(1024, 2);
    }
    if (!this.p5AudioTexture) return null;

    const img = this.p5AudioTexture;
    img.loadPixels();
    const d = img.pixels;

    // Row 0: FFT Frequency Spectrum
    for (let x = 0; x < 1024; x++) {
      const freqVal = this.liveFreqData[x] || 0;
      // Peak hold decay
      this.peakHoldFreq[x] = Math.max(freqVal, this.peakHoldFreq[x] * 0.96);

      const idx = x * 4;
      d[idx] = freqVal;                         // R: Frequency amplitude
      d[idx + 1] = Math.floor(this.peakHoldFreq[x]); // G: Peak-hold
      d[idx + 2] = 0;                           // B: Unused
      d[idx + 3] = 255;                         // A: 255
    }

    // Row 1: Waveform (y = 1)
    for (let x = 0; x < 1024; x++) {
      const waveVal = this.liveTimeData[x] || 128;
      const idx = (1024 + x) * 4;
      d[idx] = waveVal; // R: Time-domain sample (128 = zero)
      d[idx + 1] = 0;
      d[idx + 2] = 0;
      d[idx + 3] = 255;
    }

    img.updatePixels();
    return img;
  }
}

// =========================================================================
// 4. ideOSC Engine (UDP OSC Bridge + Deterministic Offline Replay)
// =========================================================================
class IdeOscEngine {
  constructor() {
    this.values = new Map();
    this.handlers = new Map();
    this.recordedEvents = [];
    this.playbackIndex = 0;

    // Listen for live OSC messages from main process
    if (ipcRenderer) {
      ipcRenderer.on('osc:message', (event, msg) => {
        this._dispatch(msg.address, msg.args);
      });
    }

    // Also support window postMessage from parent IDE
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'osc:message') {
        this._dispatch(event.data.address, event.data.args);
      }
    });
  }

  loadOfflineEvents(eventsArray) {
    this.recordedEvents = Array.isArray(eventsArray) ? eventsArray : [];
    this.recordedEvents.sort((a, b) => a.timestampMs - b.timestampMs);
    this.playbackIndex = 0;
    console.log(`[ideOSC] Loaded ${this.recordedEvents.length} offline OSC events for export`);
  }

  updateOfflineTime(virtualTimeMs) {
    while (
      this.playbackIndex < this.recordedEvents.length &&
      this.recordedEvents[this.playbackIndex].timestampMs <= virtualTimeMs
    ) {
      const event = this.recordedEvents[this.playbackIndex];
      this._dispatch(event.address, event.args);
      this.playbackIndex++;
    }
  }

  _dispatch(address, args) {
    this.values.set(address, args);
    const callbacks = this.handlers.get(address);
    if (callbacks) {
      for (const cb of callbacks) {
        try { cb(...(args || [])); } catch (e) { console.error(e); }
      }
    }
  }

  on(address, callback) {
    if (!this.handlers.has(address)) {
      this.handlers.set(address, new Set());
    }
    this.handlers.get(address).add(callback);
    return () => this.handlers.get(address)?.delete(callback);
  }

  get(address, defaultValue = null) {
    if (!this.values.has(address)) return defaultValue;
    const args = this.values.get(address);
    if (!args || args.length === 0) return defaultValue;
    return args.length === 1 ? args[0] : args;
  }

  send(address, ...args) {
    if (ipcRenderer) {
      ipcRenderer.invoke('osc:send', { address, args });
    } else {
      window.parent.postMessage({ type: 'osc:send', address, args }, '*');
    }
  }

  bindUniforms(shaderObj, mappingObject) {
    if (!shaderObj || !shaderObj.setUniform) return;
    for (const [uniformName, oscConfig] of Object.entries(mappingObject)) {
      const address = Array.isArray(oscConfig) ? oscConfig[0] : oscConfig;
      const defaultVal = Array.isArray(oscConfig) ? oscConfig[1] : 0.0;
      const currentVal = this.get(address, defaultVal);
      try {
        shaderObj.setUniform(uniformName, currentVal);
      } catch (e) {}
    }
  }
}

// =========================================================================
// 5. ideShader: Stateful Hot-Reload & Uniform Helper
// =========================================================================
class IdeShaderManager {
  constructor() {
    this.activeShaders = new Set();
    this.lastValidShaders = new Map();

    // Listen for file change notifications for live hot-reloading
    if (ipcRenderer) {
      ipcRenderer.on('project:fileChanged', (event, change) => {
        // In Live Stage mode, never auto-reload from un-swapped working files!
        if (isLiveMode) return;
        if (change.isShader) {
          this.hotReloadAll();
        }
      });
      ipcRenderer.on('shader:hotReload', () => {
        this.hotReloadAll();
      });
      ipcRenderer.on('sketch:pause', () => {
        if (typeof window.noLoop === 'function') window.noLoop();
      });
      ipcRenderer.on('sketch:resume', () => {
        if (typeof window.loop === 'function') window.loop();
      });
    }

    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'shader:hotReload') {
        this.hotReloadAll();
      }
    });
  }

  load(p5Instance, vertPath, fragPath) {
    const p5Shader = p5Instance.loadShader(vertPath, fragPath);
    const shaderRecord = {
      p5Instance,
      p5Shader,
      vertPath,
      fragPath,
      isCompiling: false,
      isReady: false
    };
    this.activeShaders.add(shaderRecord);

    // Pre-fetch shader sources immediately to guarantee synchronous availability during export
    Promise.all([
      fetch(vertPath).then(r => r.text()),
      fetch(fragPath).then(r => r.text())
    ]).then(([vText, fText]) => {
      p5Shader._vertSrc = vText;
      p5Shader._fragSrc = fText;
      shaderRecord.isReady = true;
    }).catch(err => {
      console.warn('[ideShader] Prefetch error:', err);
    });

    return p5Shader;
  }

  async hotReloadAll() {
    for (const record of this.activeShaders) {
      await this.reloadShader(record);
    }
  }

  async reloadShader(record) {
    if (record.isCompiling) return;
    record.isCompiling = true;

    try {
      // Re-fetch preprocessed shader sources from local server
      const [vertRes, fragRes] = await Promise.all([
        fetch(record.vertPath).then(r => r.text()),
        fetch(record.fragPath).then(r => r.text())
      ]);

      const gl = activeGLContext;
      if (!gl) return;

      // Compile and test in WebGL context
      const vertShader = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vertShader, vertRes);
      gl.compileShader(vertShader);

      if (!gl.getShaderParameter(vertShader, gl.COMPILE_STATUS)) {
        const infoLog = gl.getShaderInfoLog(vertShader);
        this._reportCompilerError(record.vertPath, infoLog);
        gl.deleteShader(vertShader);
        return;
      }

      const fragShader = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fragShader, fragRes);
      gl.compileShader(fragShader);

      if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
        const infoLog = gl.getShaderInfoLog(fragShader);
        this._reportCompilerError(record.fragPath, infoLog);
        gl.deleteShader(vertShader);
        gl.deleteShader(fragShader);
        return;
      }

      // Link program
      const testProgram = gl.createProgram();
      gl.attachShader(testProgram, vertShader);
      gl.attachShader(testProgram, fragShader);
      gl.linkProgram(testProgram);

      if (!gl.getProgramParameter(testProgram, gl.LINK_STATUS)) {
        const infoLog = gl.getProgramInfoLog(testProgram);
        this._reportCompilerError(record.fragPath, infoLog);
        gl.deleteProgram(testProgram);
        return;
      }

      // Successful compilation: hot swap into p5.Shader
      if (record.p5Shader && record.p5Shader._glProgram) {
        gl.deleteProgram(record.p5Shader._glProgram);
        record.p5Shader._glProgram = testProgram;
        record.p5Shader._vertSrc = vertRes;
        record.p5Shader._fragSrc = fragRes;
        // Invalidate uniform cache
        record.p5Shader._uniformCache = {};
      }

      console.log(`[ideShader] Hot-reloaded shader successfully: ${record.fragPath}`);
      this._reportCompilerSuccess(record.fragPath);
    } catch (err) {
      console.warn('[ideShader] Hot-reload error:', err);
    } finally {
      record.isCompiling = false;
    }
  }

  _reportCompilerError(file, log) {
    console.error(`[ideShader] Compile error in ${file}:\n${log}`);
    const msg = { type: 'shader:error', file, log };
    if (ipcRenderer) {
      ipcRenderer.invoke('project:mapCompilerErrors', { infoLog: log, sourceTable: [file] }).then(errors => {
        window.parent.postMessage({ type: 'shader:diagnostics', errors }, '*');
        ipcRenderer.invoke('shader:reportDiagnostics', { errors });
      });
    } else {
      window.parent.postMessage(msg, '*');
    }
  }

  _reportCompilerSuccess(file) {
    const msg = { type: 'shader:success', file };
    window.parent.postMessage(msg, '*');
    if (ipcRenderer) {
      ipcRenderer.invoke('shader:reportSuccess', { file });
    }
  }

  bindStandardUniforms(shaderObj, p5Instance) {
    if (!shaderObj || !shaderObj.setUniform || !p5Instance) return;

    // In export mode, strictly enforce target resolution
    const resW = isExportMode ? exportTargetW : (p5Instance.width || window.innerWidth);
    const resH = isExportMode ? exportTargetH : (p5Instance.height || window.innerHeight);

    // Resolution
    shaderObj.setUniform('u_resolution', [resW, resH]);

    // Deterministic Time
    shaderObj.setUniform('u_time', p5Instance.millis() / 1000.0);
    shaderObj.setUniform('u_delta', (p5Instance.deltaTime || 16.6) / 1000.0);
    shaderObj.setUniform('u_frame', p5Instance.frameCount);

    // Mouse normalized (0..1, Y flipped for GL standard)
    const mx = p5Instance.mouseX / Math.max(1, resW);
    const my = 1.0 - (p5Instance.mouseY / Math.max(1, resH));
    shaderObj.setUniform('u_mouse', [mx, my]);

    // Audio Metrics
    shaderObj.setUniform('u_rms', window.ideAudio.getRMS());
    shaderObj.setUniform('u_sub', window.ideAudio.bands.sub);
    shaderObj.setUniform('u_bass', window.ideAudio.bands.bass);
    shaderObj.setUniform('u_lowMid', window.ideAudio.bands.lowMid);
    shaderObj.setUniform('u_mid', window.ideAudio.bands.mid);
    shaderObj.setUniform('u_highMid', window.ideAudio.bands.highMid);
    shaderObj.setUniform('u_treble', window.ideAudio.bands.treble);

    // Audio Texture (1024x2)
    const audioTexture = window.ideAudio.getTexture(p5Instance);
    if (audioTexture) {
      shaderObj.setUniform('u_audioTex', audioTexture);
    }
  }
}

// =========================================================================
// 6. Instantiate and Expose Globals
// =========================================================================
window.ideAudio = new IdeAudioEngine();
window.ideOSC = new IdeOscEngine();
window.ideShader = new IdeShaderManager();

// Automatically start live audio when user clicks or runs sketch
window.addEventListener('DOMContentLoaded', () => {
  if (!isExportMode) {
    window.ideAudio.initLive();
  }
});

// =========================================================================
// 7. Deterministic Non-Real-Time Frame Exporter Engine
// =========================================================================
if (isExportMode) {
  console.log('[Sandbox] Running in Deterministic Offline Export Mode');

  const frameIntervalMs = 1000.0 / exportTargetFps;
  const origPerfNow = window.performance.now.bind(window.performance);
  const origDateNow = Date.now.bind(Date);
  let lockstepClockActive = false;

  window.performance.now = () => (lockstepClockActive ? currentExportTimeMs : origPerfNow());
  Date.now = () => (lockstepClockActive ? (1700000000000 + Math.floor(currentExportTimeMs)) : origDateNow());

  const getExportP5Instance = () =>
    window.__capturedP5Instance ||
    window._p5Instance ||
    window.p5Instance ||
    (window.p5 && window.p5.instance) ||
    null;

  window.addEventListener('load', async () => {
    if (window.p5) {
      installP5ExportHooks(window.p5);
    }

    // Poll until p5 preload() (e.g. loadSound('audio.mp3')) and setup() have fully completed (up to 15s)
    let p5Instance = getExportP5Instance();
    for (let i = 0; i < 300; i++) {
      if (window.p5) {
        installP5ExportHooks(window.p5);
      }
      p5Instance = getExportP5Instance();
      if (p5Instance && p5Instance._setupDone) {
        break;
      }
      if (!p5Instance && i > 40 && document.querySelector('canvas') && typeof window.redraw === 'function') {
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    // Match sampleRate to p5.sound's AudioContext if present so p5.FFT.getEnergy() Nyquist bins align 1:1
    let targetAudioRate = 48000;
    try {
      if (typeof window.getAudioContext === 'function') {
        const ctx = window.getAudioContext();
        if (ctx && ctx.sampleRate) targetAudioRate = ctx.sampleRate;
      } else if (window.p5 && window.p5.soundOut && window.p5.soundOut.audiocontext) {
        targetAudioRate = window.p5.soundOut.audiocontext.sampleRate || 48000;
      }
    } catch (e) {}

    // Decode offline audio track (MP3, WAV, OGG, FLAC, M4A, AAC, AIFF) via FFmpeg IPC
    if (exportAudioPath) {
      let decodedOk = false;
      if (ipcRenderer) {
        try {
          const decoded = await ipcRenderer.invoke('export:decodeAudio', {
            audioPath: exportAudioPath,
            sampleRate: targetAudioRate,
            maxDurationSec: Math.ceil(exportTotalFrames / exportTargetFps)
          });
          if (decoded && decoded.pcmBuffer) {
            const u8 = decoded.pcmBuffer instanceof Uint8Array
              ? decoded.pcmBuffer
              : new Uint8Array(decoded.pcmBuffer);
            const sampleCount = Math.floor(u8.byteLength / 4);
            const pcmFloat32 = (u8.byteOffset % 4 === 0)
              ? new Float32Array(u8.buffer, u8.byteOffset, sampleCount)
              : new Float32Array(u8.slice().buffer, 0, sampleCount);
            window.ideAudio.setOfflinePcm(pcmFloat32, decoded.sampleRate || targetAudioRate);
            decodedOk = true;
          }
        } catch (err) {
          console.warn('[Sandbox] IPC FFmpeg audio decode failed, trying Web Audio fallback:', err);
        }
      }

      if (!decodedOk) {
        try {
          const audioBuffer = await fetch(exportAudioPath).then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.arrayBuffer();
          });
          const AudioContextClass = window.OfflineAudioContext || window.AudioContext || window.webkitAudioContext;
          if (AudioContextClass) {
            const tmpCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: targetAudioRate });
            const decodedBuf = await tmpCtx.decodeAudioData(audioBuffer.slice(0));
            const extracted = extractAudioBufferMonoPcm(decodedBuf);
            if (extracted) {
              window.ideAudio.setOfflinePcm(extracted.pcm, extracted.sampleRate);
            }
            try { await tmpCtx.close(); } catch (e) {}
          } else {
            window.ideAudio.loadOfflineWav(audioBuffer);
          }
        } catch (err) {
          console.warn('[Sandbox] Failed to load export audio track:', err);
        }
      }
    }

    // Load offline OSC events if provided (via IPC for absolute OS paths, with fetch fallback)
    if (exportOscPath) {
      try {
        let oscJson = null;
        if (ipcRenderer) {
          oscJson = await ipcRenderer.invoke('export:readOscFile', exportOscPath);
        }
        if (!oscJson) {
          oscJson = await fetch(exportOscPath).then((r) => r.json());
        }
        if (oscJson) {
          window.ideOSC.loadOfflineEvents(oscJson);
        }
      } catch (err) {
        console.warn('[Sandbox] Failed to load export OSC JSON:', err);
      }
    }

    // Ensure all registered shaders have finished downloading their GLSL sources
    if (window.ideShader && window.ideShader.activeShaders) {
      for (const record of window.ideShader.activeShaders) {
        let attempts = 0;
        while ((!record.p5Shader._vertSrc || !record.p5Shader._fragSrc) && attempts < 40) {
          try {
            const [vText, fText] = await Promise.all([
              fetch(record.vertPath).then((r) => r.text()),
              fetch(record.fragPath).then((r) => r.text())
            ]);
            record.p5Shader._vertSrc = vText;
            record.p5Shader._fragSrc = fText;
            break;
          } catch (e) {
            await new Promise((r) => setTimeout(r, 50));
            attempts++;
          }
        }
      }
    }

    // Lockstep Frame Export Loop
    setTimeout(async () => {
      p5Instance = getExportP5Instance();
      await runLockstepExport(p5Instance);
    }, 100);
  });

  async function runLockstepExport(p5Instance) {
    const W = exportTargetW;
    const H = exportTargetH;
    const rawBuffer = new Uint8Array(W * H * 4);
    const flippedBuffer = new Uint8Array(W * H * 4);
    const bytesPerRow = W * 4;

    if (window.p5) {
      installP5ExportHooks(window.p5);
    }

    // Force p5 instance to strictly W x H native resolution with pixelDensity(1)
    if (p5Instance) {
      if (typeof p5Instance.noLoop === 'function') {
        p5Instance.noLoop();
      }
      if (typeof p5Instance.pixelDensity === 'function' && p5Instance._pixelDensity !== 1) {
        p5Instance.pixelDensity(1);
      }
      if (typeof p5Instance.resizeCanvas === 'function' && (p5Instance.width !== W || p5Instance.height !== H)) {
        p5Instance.resizeCanvas(W, H, false);
      }
      if (typeof p5Instance._setProperty === 'function') {
        p5Instance._setProperty('width', W);
        p5Instance._setProperty('height', H);
      } else {
        p5Instance.width = W;
        p5Instance.height = H;
      }
    } else if (typeof window.noLoop === 'function') {
      window.noLoop();
    }

    const mainCanvas =
      (p5Instance && p5Instance.canvas) ||
      document.querySelector('canvas.p5Canvas') ||
      document.querySelector('main canvas') ||
      activeCanvas ||
      document.querySelector('canvas');

    if (mainCanvas) {
      // Only resize DOM bitmap if dimensions differ so 2D CanvasRenderingContext2D state is preserved
      if (mainCanvas.width !== W) mainCanvas.width = W;
      if (mainCanvas.height !== H) mainCanvas.height = H;
      mainCanvas.style.width = `${W}px`;
      mainCanvas.style.height = `${H}px`;
    }

    const gl =
      (p5Instance && p5Instance._renderer && p5Instance._renderer.GL) ||
      (mainCanvas && mainCanvas === activeGLCanvas ? activeGLContext : null);

    if (gl) {
      gl.viewport(0, 0, W, H);
    }

    // Activate deterministic virtual clock
    currentExportFrame = 0;
    currentExportTimeMs = 0;
    lockstepClockActive = true;

    // Warmup frame ONLY for WebGL canvases to pre-compile shaders & textures
    if (gl && p5Instance && typeof p5Instance.redraw === 'function') {
      currentExportFrame = -1;
      currentExportTimeMs = 0;
      p5Instance.redraw();
      gl.finish();
      // Reset audio smoothing state after shader warmup so Frame 0 starts cleanly
      window.ideAudio.offlineSmoothedFreq.fill(0);
      window.ideAudio.peakHoldFreq.fill(0);
      window.ideAudio._lastOfflineFrame = -1;
    }

    const ctx2d = (!gl && mainCanvas) ? mainCanvas.getContext('2d') : null;

    for (let f = 0; f < exportTotalFrames; f++) {
      currentExportFrame = f;
      currentExportTimeMs = f * frameIntervalMs;

      // 1. Advance virtual time and audio DSP
      window.ideAudio.update(currentExportFrame, exportTargetFps);

      // 2. Replay OSC events for this virtual time
      window.ideOSC.updateOfflineTime(currentExportTimeMs);

      // 3. Trigger deterministic frame redraw
      if (p5Instance) {
        if (typeof p5Instance._setProperty === 'function') {
          p5Instance._setProperty('width', W);
          p5Instance._setProperty('height', H);
          p5Instance._setProperty('frameCount', currentExportFrame);
          p5Instance._setProperty('deltaTime', frameIntervalMs);
        } else {
          p5Instance.width = W;
          p5Instance.height = H;
          p5Instance.frameCount = currentExportFrame;
          p5Instance.deltaTime = frameIntervalMs;
        }
        if (typeof p5Instance.redraw === 'function') {
          p5Instance.redraw();
        }
      } else if (typeof window.redraw === 'function') {
        window.frameCount = currentExportFrame;
        window.deltaTime = frameIntervalMs;
        window.redraw();
      }

      // 4. Capture Frame Pixels (WebGL vs 2D)
      if (gl) {
        gl.viewport(0, 0, W, H);
        gl.finish();
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, rawBuffer);

        // Fast Vertical Flip in Memory (WebGL bottom-left to top-left)
        for (let y = 0; y < H; y++) {
          const srcOffset = y * bytesPerRow;
          const dstOffset = (H - 1 - y) * bytesPerRow;
          flippedBuffer.set(rawBuffer.subarray(srcOffset, srcOffset + bytesPerRow), dstOffset);
        }
      } else if (ctx2d) {
        const imgData = ctx2d.getImageData(0, 0, W, H);
        flippedBuffer.set(imgData.data);
      }

      // 5. Send raw frame buffer to Electron Main FFmpeg pipeline
      if (ipcRenderer) {
        await ipcRenderer.invoke('export:pushFrame', flippedBuffer);
      }
    }

    // 6. Signal completion
    if (ipcRenderer) {
      await ipcRenderer.invoke('export:finish');
    }
  }
}
