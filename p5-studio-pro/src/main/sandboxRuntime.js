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
  // 0. IDE Console Debug Bridge (console.log, warn, error, info, clear, print)
  // =========================================================================
  const _origConsole = {
    log: console.log.bind(console),
    info: console.info ? console.info.bind(console) : console.log.bind(console),
    warn: console.warn ? console.warn.bind(console) : console.log.bind(console),
    error: console.error ? console.error.bind(console) : console.log.bind(console),
    debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
    clear: console.clear ? console.clear.bind(console) : () => {}
  };

  function formatConsoleArg(arg, depth = 0) {
    if (arg === null) return 'null';
    if (arg === undefined) return 'undefined';
    if (typeof arg === 'string') return depth === 0 ? arg : JSON.stringify(arg);
    if (typeof arg === 'number' || typeof arg === 'boolean' || typeof arg === 'bigint') return String(arg);
    if (typeof arg === 'function') return `[Function: ${arg.name || 'anonymous'}]`;
    if (arg instanceof Error) return `${arg.name || 'Error'}: ${arg.message}`;
    if (typeof arg === 'object') {
      if (
        typeof arg.x === 'number' &&
        typeof arg.y === 'number' &&
        typeof arg.z === 'number' &&
        arg.constructor &&
        (arg.constructor.name === 'Vector' || arg.isPInst)
      ) {
        return `p5.Vector(${Number(arg.x).toFixed(2)}, ${Number(arg.y).toFixed(2)}, ${Number(arg.z).toFixed(2)})`;
      }
      if (depth > 2) return Array.isArray(arg) ? `[Array(${arg.length})]` : '[Object]';
      try {
        if (Array.isArray(arg)) {
          const preview = arg.slice(0, 20).map(item => formatConsoleArg(item, depth + 1)).join(', ');
          return `[${preview}${arg.length > 20 ? `, ... (${arg.length} items)` : ''}]`;
        }
        const seen = new WeakSet();
        const json = JSON.stringify(arg, (key, val) => {
          if (typeof val === 'object' && val !== null) {
            if (seen.has(val)) return '[Circular]';
            seen.add(val);
          }
          if (typeof val === 'function') return `[Function: ${val.name || 'anonymous'}]`;
          return val;
        });
        if (json && json.length > 500) {
          return json.slice(0, 500) + '... }';
        }
        return json || String(arg);
      } catch (e) {
        return String(arg);
      }
    }
    return String(arg);
  }

  let _consoleQueue = [];
  let _consoleFlushScheduled = false;

  function flushConsoleQueue() {
    _consoleFlushScheduled = false;
    if (_consoleQueue.length === 0) return;
    const batch = _consoleQueue.splice(0, 100);
    _consoleQueue.length = 0;
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'console:batch',
        entries: batch
      }, '*');
    }
  }

  function pushConsoleEntry(level, args) {
    if (isExportMode) return;
    if (args.length > 0 && typeof args[0] === 'string') {
      const first = args[0];
      if (
        first.startsWith('[ideAudio]') ||
        first.startsWith('[sandboxRuntime]') ||
        first.startsWith('[Sandbox]') ||
        first.startsWith('[ideShader]') ||
        first.startsWith('[ideOSC]')
      ) {
        return;
      }
    }
    const text = args.map(a => formatConsoleArg(a, 0)).join(' ');
    const last = _consoleQueue[_consoleQueue.length - 1];
    if (last && last.level === level && last.text === text) {
      last.count = (last.count || 1) + 1;
      last.timestamp = Date.now();
    } else if (_consoleQueue.length < 120) {
      _consoleQueue.push({
        level,
        text,
        count: 1,
        timestamp: Date.now()
      });
    }
    if (!_consoleFlushScheduled) {
      _consoleFlushScheduled = true;
      setTimeout(flushConsoleQueue, 32);
    }
  }

  console.log = function (...args) {
    _origConsole.log(...args);
    pushConsoleEntry('log', args);
  };
  console.info = function (...args) {
    _origConsole.info(...args);
    pushConsoleEntry('info', args);
  };
  console.warn = function (...args) {
    _origConsole.warn(...args);
    pushConsoleEntry('warn', args);
  };
  console.error = function (...args) {
    _origConsole.error(...args);
    pushConsoleEntry('error', args);
  };
  console.debug = function (...args) {
    _origConsole.debug(...args);
    pushConsoleEntry('log', args);
  };
  console.clear = function () {
    _origConsole.clear();
    _consoleQueue.length = 0;
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'console:clear' }, '*');
    }
  };

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
      this.bandRanges = {
        sub: [20, 60],
        bass: [60, 250],
        lowMid: [250, 500],
        mid: [500, 2000],
        highMid: [2000, 4000],
        treble: [4000, 20000]
      };
      this.bands = { sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0 };
      this.lastBeatTime = 0;
      this.p5AudioTexture = null;

      // Audio Input Gain & Device state
      this.inputGain = 1.0;
      this.currentDeviceId = 'default';
      this.gainNode = null;
      this.sourceNode = null;
      this.silentGain = null;
      this._loopRunning = false;
    }

    async initLive(preferredDeviceId = null) {
      if (preferredDeviceId) {
        this.currentDeviceId = preferredDeviceId;
      }
      try {
        if (!this.audioCtx) {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          this.audioCtx = new AudioContextClass();
        }
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
          await this.audioCtx.resume().catch(() => {});
        }
        this.sampleRate = this.audioCtx.sampleRate || 44100;

        // Cleanup existing stream & source node
        if (this.liveStream) {
          try { this.liveStream.getTracks().forEach(t => t.stop()); } catch (e) {}
          this.liveStream = null;
        }
        if (this.sourceNode) {
          try { this.sourceNode.disconnect(); } catch (e) {}
          this.sourceNode = null;
        }

        let stream = null;
        const requestedDevice = this.currentDeviceId;

        // 1. First attempt: specific device if selected
        if (requestedDevice && requestedDevice !== 'default') {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                deviceId: { ideal: requestedDevice },
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
              }
            });
          } catch (e1) {
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                audio: { deviceId: { ideal: requestedDevice } }
              });
            } catch (e2) {}
          }
        }

        // 2. Second attempt: system default with low-latency DSP flags
        if (!stream) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
              }
            });
          } catch (e3) {}
        }

        // 3. Third attempt: standard permissive audio constraint
        if (!stream) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }

        this.liveStream = stream;
        this.sourceNode = this.audioCtx.createMediaStreamSource(this.liveStream);

        if (!this.gainNode) {
          this.gainNode = this.audioCtx.createGain();
        }
        this.gainNode.gain.value = this.inputGain;

        if (!this.analyser) {
          this.analyser = this.audioCtx.createAnalyser();
          this.analyser.fftSize = this.fftSize;
          this.analyser.smoothingTimeConstant = this.smoothingTimeConstant;
        }

        this.sourceNode.connect(this.gainNode);
        this.gainNode.connect(this.analyser);

        // Connect analyser to a zero-gain destination node to force Chromium's CoreAudio render pump
        if (!this.silentGain) {
          this.silentGain = this.audioCtx.createGain();
          this.silentGain.gain.value = 0.0;
          this.analyser.connect(this.silentGain);
          this.silentGain.connect(this.audioCtx.destination);
        }

        // Start continuous live analysis & postMessage loop
        this._startLiveLoop();

        const trackLabel = this.liveStream.getAudioTracks().map(t => t.label).join(', ') || 'Microphone Active';
        console.log('[ideAudio] Live audio stream active. Tracks:', trackLabel);
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'audio:connected', track: trackLabel, deviceId: this.currentDeviceId }, '*');
        }
      } catch (err) {
        console.warn('[ideAudio] Audio input not accessible, using synthetic audio fallback:', err.message);
        this._startLiveLoop();
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'audio:error', message: err.message }, '*');
        }
      }
    }

    _startLiveLoop() {
      if (this._loopRunning || isExportMode) return;
      this._loopRunning = true;
      let frameCount = 0;
      const tick = () => {
        if (!this._loopRunning) return;
        frameCount++;
        this.update(frameCount, 60);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    setGain(multiplier) {
      if (typeof multiplier === 'number' && !isNaN(multiplier)) {
        this.inputGain = Math.max(0, multiplier);
        if (this.gainNode && this.audioCtx) {
          this.gainNode.gain.setTargetAtTime(this.inputGain, this.audioCtx.currentTime, 0.02);
        }
      }
    }

    async setDevice(deviceId) {
      this.currentDeviceId = deviceId || 'default';
      await this.initLive(this.currentDeviceId);
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
        const r = this.bandRanges;
        this.bands.sub = this._calcBandLive(r.sub[0], r.sub[1], binHz);
        this.bands.bass = this._calcBandLive(r.bass[0], r.bass[1], binHz);
        this.bands.lowMid = this._calcBandLive(r.lowMid[0], r.lowMid[1], binHz);
        this.bands.mid = this._calcBandLive(r.mid[0], r.mid[1], binHz);
        this.bands.highMid = this._calcBandLive(r.highMid[0], r.highMid[1], binHz);
        this.bands.treble = this._calcBandLive(r.treble[0], r.treble[1], binHz);
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

    setBandRanges(ranges) {
      if (!ranges || typeof ranges !== 'object') return this.bandRanges;
      const keys = ['sub', 'bass', 'lowMid', 'mid', 'highMid', 'treble'];
      for (const k of keys) {
        const pair = ranges[k];
        if (Array.isArray(pair) && pair.length >= 2) {
          const lo = Math.max(0, Math.min(24000, Number(pair[0]) || 0));
          const hi = Math.max(lo + 1, Math.min(24000, Number(pair[1]) || (lo + 1)));
          this.bandRanges[k] = [lo, hi];
        }
      }
      return this.bandRanges;
    }

    getBandRanges() {
      return JSON.parse(JSON.stringify(this.bandRanges));
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
        isCompiling: false,
        isReady: false
      };
      this.activeShaders.add(shaderRecord);

      // Pre-fetch shader sources immediately to guarantee availability
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

  // =========================================================================
  // Sandbox Error Boundary & Visual HUD Overlay with Auto-Recovery
  // =========================================================================
  function showSandboxErrorOverlay(msg, source, line, col) {
    if (isExportMode) return;
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

  // Clear any existing overlay immediately on load
  clearSandboxErrorOverlay();

  // Auto-recovery: when animation frame executes cleanly, remove error overlay
  let hasSignaledSuccess = false;
  const origRAF = window.requestAnimationFrame;
  if (origRAF) {
    window.requestAnimationFrame = function (cb) {
      return origRAF.call(window, function (timestamp) {
        try {
          cb(timestamp);
          if (!hasSignaledSuccess) {
            clearSandboxErrorOverlay();
            if (window.parent && window.parent !== window) {
              window.parent.postMessage({ type: 'runtime:success' }, '*');
            }
            hasSignaledSuccess = true;
          }
        } catch (err) {
          showSandboxErrorOverlay(err.message, err.fileName || 'sketch.js', err.lineNumber || 0, err.columnNumber || 0);
          throw err;
        }
      });
    };
  }

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
    if (!isExportMode) {
      window.ideAudio.initLive();
    }
    // Post initial success if no error occurred
    setTimeout(() => {
      const overlay = document.getElementById('studio-sandbox-error-overlay');
      if (!overlay && window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'runtime:success' }, '*');
      }
    }, 250);
  });

  // Handle messages from IDE parent window (audio gain, device switch, playback control)
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'audio:setGain' && typeof data.gain === 'number') {
      if (window.ideAudio) window.ideAudio.setGain(data.gain);
    } else if (data.type === 'audio:setDevice' && typeof data.deviceId === 'string') {
      if (window.ideAudio) window.ideAudio.setDevice(data.deviceId);
    } else if (data.type === 'audio:setBandRanges' && data.ranges) {
      if (window.ideAudio) window.ideAudio.setBandRanges(data.ranges);
    } else if (data.type === 'audio:resume') {
      if (window.ideAudio && window.ideAudio.audioCtx && window.ideAudio.audioCtx.state === 'suspended') {
        window.ideAudio.audioCtx.resume().catch(() => {});
      }
    } else if (data.type === 'audio:reconnect') {
      if (window.ideAudio) {
        window.ideAudio.initLive(window.ideAudio.currentDeviceId);
      }
    } else if (data.type === 'sketch:pause') {
      if (window.noLoop && typeof window.noLoop === 'function') window.noLoop();
    } else if (data.type === 'sketch:resume') {
      if (window.loop && typeof window.loop === 'function') window.loop();
    } else if (data.type === 'console:eval' && typeof data.expr === 'string') {
      try {
        const result = (0, eval)(data.expr);
        pushConsoleEntry('result', [`← ${formatConsoleArg(result, 0)}`]);
      } catch (err) {
        pushConsoleEntry('error', [`${err.name || 'Error'}: ${err.message}`]);
      }
    }
  });

  // Global user interaction unblocks suspended Web Audio contexts
  const resumeLiveAudio = () => {
    if (window.ideAudio && window.ideAudio.audioCtx && window.ideAudio.audioCtx.state === 'suspended') {
      window.ideAudio.audioCtx.resume().catch(() => {});
    }
  };
  ['click', 'keydown', 'mousedown', 'touchstart'].forEach(eType => {
    window.addEventListener(eType, resumeLiveAudio, { passive: true });
  });
})();
