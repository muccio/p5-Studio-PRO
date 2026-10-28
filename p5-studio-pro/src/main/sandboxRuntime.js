/**
 * sandboxRuntime.js
 * Injected automatically by the project HTTP server into preview & export pages.
 * Runs directly inside the browser / iframe environment:
 * 1. WebGL parity & precision enforcement
 * 2. window.ideShader (hot-reloading, #include resolution via server API, auto-uniforms)
 * 3. window.ideAudio (hardware live input, offline FFT, WebGL u_audioTex texture)
 * 4. window.ideOSC (postMessage bridge to IDE UDP OSC server)
 */

(function () {
  if (window.__isSandboxPreloadLoaded || (window.ideAudio && window.ideShader && window.ideOSC)) {
    console.log('[sandboxRuntime] Preload already present, skipping duplicate injection');
    return;
  }
  // Check URL parameters for export mode
  const urlParams = new URLSearchParams(window.location.search);
  const isExportMode = urlParams.get('export') === 'true';
  const exportTargetW = parseInt(urlParams.get('w') || '1920', 10);
  const exportTargetH = parseInt(urlParams.get('h') || '1080', 10);
  const exportTargetFps = parseInt(urlParams.get('fps') || '60', 10);
  const exportTotalFrames = parseInt(urlParams.get('totalFrames') || '300', 10);
  const exportAudioPath = urlParams.get('audioPath') || null;
  const exportOscPath = urlParams.get('oscPath') || null;

  // =========================================================================
  // 1. WebGL Context & Precision Enforcement
  // =========================================================================
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  let activeGLContext = null;
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
        activeCanvas = this;
        hookGLContext(gl);
      }
      return gl;
    }
    const ctx = origGetContext.call(this, contextType, contextAttributes);
    if (ctx && (contextType === '2d')) {
      activeCanvas = this;
    }
    return ctx;
  };

  function hookGLContext(gl) {
    const origShaderSource = gl.shaderSource;
    gl.shaderSource = function (shader, source) {
      let finalSource = source;
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
      this.bitRev = new Uint32Array(size);
      const bits = Math.round(Math.log2(size));
      for (let i = 0; i < size; i++) {
        let rev = 0;
        for (let j = 0; j < bits; j++) {
          rev = (rev << 1) | ((i >> j) & 1);
        }
        this.bitRev[i] = rev;
      }

      this.cosTable = new Float32Array(size / 2);
      this.sinTable = new Float32Array(size / 2);
      for (let i = 0; i < size / 2; i++) {
        const angle = (-2.0 * Math.PI * i) / size;
        this.cosTable[i] = Math.cos(angle);
        this.sinTable[i] = Math.sin(angle);
      }

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
      for (let i = 0; i < N; i++) {
        const rev = this.bitRev[i];
        const sample = (i < timeDomainSamples.length ? timeDomainSamples[i] : 0.0) * this.hannWindow[i];
        this.real[rev] = sample;
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

      const halfN = N / 2;
      const norm = 2.0 / N;
      for (let i = 0; i < halfN; i++) {
        this.spectrum[i] = Math.sqrt(this.real[i] * this.real[i] + this.imag[i] * this.imag[i]) * norm;
      }

      return this.spectrum;
    }
  }

  // =========================================================================
  // 3. ideAudio Engine
  // =========================================================================
  class IdeAudioEngine {
    constructor() {
      this.fftSize = 2048;
      this.sampleRate = 48000;
      this.smoothingTimeConstant = 0.8;

      this.audioCtx = null;
      this.analyser = null;
      this.liveStream = null;
      this.liveTimeData = new Uint8Array(this.fftSize);
      this.liveFreqData = new Uint8Array(this.fftSize / 2);

      this.offlinePcm = null;
      this.offlineFFT = new CooleyTukeyFFT(this.fftSize);
      this.offlineSmoothedFreq = new Float32Array(this.fftSize / 2);
      this.peakHoldFreq = new Float32Array(1024);

      this.currentRMS = 0;
      this.bands = { sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0 };
      this.lastBeatTime = 0;
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
      } catch (err) {
        // Fallback synthetic audio for preview
      }
    }

    update(virtualFrame = 0, targetFps = 60) {
      if (isExportMode && this.offlinePcm) {
        this._updateOffline(virtualFrame, targetFps);
      } else {
        this._updateLive();
      }

      // Periodically post audio state to parent IDE window for UI visualizers
      if (window.parent && window.parent !== window && (virtualFrame % 2 === 0)) {
        window.parent.postMessage({
          type: 'audio:update',
          rms: this.currentRMS,
          bands: this.bands,
          fft: Array.from(this.liveFreqData.subarray(0, 128)),
          wave: Array.from(this.liveTimeData.subarray(0, 128))
        }, '*');
      }
    }

    _updateLive() {
      if (this.analyser) {
        this.analyser.getByteTimeDomainData(this.liveTimeData);
        this.analyser.getByteFrequencyData(this.liveFreqData);

        let sumSquares = 0;
        for (let i = 0; i < this.fftSize; i++) {
          const val = (this.liveTimeData[i] - 128) / 128.0;
          sumSquares += val * val;
        }
        this.currentRMS = Math.sqrt(sumSquares / this.fftSize);

        const binHz = (this.sampleRate / 2) / (this.fftSize / 2);
        this.bands.sub = this._calcBandLive(20, 60, binHz);
        this.bands.bass = this._calcBandLive(60, 250, binHz);
        this.bands.lowMid = this._calcBandLive(250, 500, binHz);
        this.bands.mid = this._calcBandLive(500, 2000, binHz);
        this.bands.highMid = this._calcBandLive(2000, 4000, binHz);
        this.bands.treble = this._calcBandLive(4000, 20000, binHz);
      } else {
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
      const endSample = Math.floor((frameN / fps) * this.sampleRate);
      const startSample = endSample - this.fftSize;

      const slice = new Float32Array(this.fftSize);
      for (let i = 0; i < this.fftSize; i++) {
        const idx = startSample + i;
        slice[i] = (idx >= 0 && idx < this.offlinePcm.length) ? this.offlinePcm[idx] : 0.0;
      }

      const rawSpectrum = this.offlineFFT.forward(slice);
      for (let i = 0; i < 1024; i++) {
        this.offlineSmoothedFreq[i] = this.smoothingTimeConstant * this.offlineSmoothedFreq[i] + (1.0 - this.smoothingTimeConstant) * rawSpectrum[i];
      }

      let sumSquares = 0;
      for (let i = 0; i < this.fftSize; i++) {
        sumSquares += slice[i] * slice[i];
      }
      this.currentRMS = Math.sqrt(sumSquares / this.fftSize);

      for (let i = 0; i < 1024; i++) {
        this.liveFreqData[i] = Math.min(255, Math.floor(this.offlineSmoothedFreq[i] * 255.0 * 4.0));
        const rawSample = (i < this.fftSize) ? slice[i] : 0.0;
        this.liveTimeData[i] = Math.max(0, Math.min(255, Math.floor((rawSample + 1.0) * 127.5)));
      }
    }

    getRMS() { return this.currentRMS; }
    getFFT() { return this.liveFreqData; }
    getWaveform() { return this.liveTimeData; }
    getEnergy(bandOrLowHz, highHz) {
      if (typeof bandOrLowHz === 'string') return this.bands[bandOrLowHz] || 0;
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
        this.peakHoldFreq[x] = Math.max(freqVal, this.peakHoldFreq[x] * 0.96);

        const idx = x * 4;
        d[idx] = freqVal;
        d[idx + 1] = Math.floor(this.peakHoldFreq[x]);
        d[idx + 2] = 0;
        d[idx + 3] = 255;
      }

      // Row 1: Waveform (y = 1)
      for (let x = 0; x < 1024; x++) {
        const waveVal = this.liveTimeData[x] || 128;
        const idx = (1024 + x) * 4;
        d[idx] = waveVal;
        d[idx + 1] = 0;
        d[idx + 2] = 0;
        d[idx + 3] = 255;
      }

      img.updatePixels();
      return img;
    }
  }

  // =========================================================================
  // 4. ideOSC Engine
  // =========================================================================
  class IdeOscEngine {
    constructor() {
      this.values = new Map();
      this.handlers = new Map();

      // Listen for OSC forwarded from parent IDE window
      window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'osc:message') {
          this._dispatch(event.data.address, event.data.args);
        }
      });
    }

    _dispatch(address, args) {
      this.values.set(address, args);
      const callbacks = this.handlers.get(address);
      if (callbacks) {
        for (const cb of callbacks) {
          try { cb(...(args || [])); } catch (e) {}
        }
      }
    }

    on(address, callback) {
      if (!this.handlers.has(address)) this.handlers.set(address, new Set());
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
      if (window.parent && window.parent !== window) {
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

      // Listen for hot-reload command from parent IDE
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
        isCompiling: false
      };
      this.activeShaders.add(shaderRecord);
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
        const [vertRes, fragRes] = await Promise.all([
          fetch(record.vertPath).then(r => r.text()),
          fetch(record.fragPath).then(r => r.text())
        ]);

        const gl = activeGLContext;
        if (!gl) return;

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

        // Successfully compiled: hot-swap program into existing p5.Shader
        if (record.p5Shader && record.p5Shader._glProgram) {
          gl.deleteProgram(record.p5Shader._glProgram);
          record.p5Shader._glProgram = testProgram;
          record.p5Shader._vertSrc = vertRes;
          record.p5Shader._fragSrc = fragRes;
          record.p5Shader._uniformCache = {};
        }

        this._reportCompilerSuccess(record.fragPath);
      } catch (err) {
        console.warn('[ideShader] Hot reload error:', err);
      } finally {
        record.isCompiling = false;
      }
    }

    _reportCompilerError(file, log) {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'shader:error', file, log }, '*');
      }
    }

    _reportCompilerSuccess(file) {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'shader:success', file }, '*');
      }
    }

    bindStandardUniforms(shaderObj, p5Instance) {
      if (!shaderObj || !shaderObj.setUniform || !p5Instance) return;

      shaderObj.setUniform('u_resolution', [p5Instance.width, p5Instance.height]);
      shaderObj.setUniform('u_time', p5Instance.millis() / 1000.0);
      shaderObj.setUniform('u_delta', (p5Instance.deltaTime || 16.6) / 1000.0);
      shaderObj.setUniform('u_frame', p5Instance.frameCount);

      const mx = p5Instance.mouseX / Math.max(1, p5Instance.width);
      const my = 1.0 - (p5Instance.mouseY / Math.max(1, p5Instance.height));
      shaderObj.setUniform('u_mouse', [mx, my]);

      shaderObj.setUniform('u_rms', window.ideAudio.getRMS());
      shaderObj.setUniform('u_sub', window.ideAudio.bands.sub);
      shaderObj.setUniform('u_bass', window.ideAudio.bands.bass);
      shaderObj.setUniform('u_lowMid', window.ideAudio.bands.lowMid);
      shaderObj.setUniform('u_mid', window.ideAudio.bands.mid);
      shaderObj.setUniform('u_highMid', window.ideAudio.bands.highMid);
      shaderObj.setUniform('u_treble', window.ideAudio.bands.treble);

      const audioTexture = window.ideAudio.getTexture(p5Instance);
      if (audioTexture) {
        shaderObj.setUniform('u_audioTex', audioTexture);
      }
    }
  }

  // Expose Globals
  window.ideAudio = new IdeAudioEngine();
  window.ideOSC = new IdeOscEngine();
  window.ideShader = new IdeShaderManager();

  window.addEventListener('DOMContentLoaded', () => {
    if (!isExportMode) {
      window.ideAudio.initLive();
    }
  });
})();
