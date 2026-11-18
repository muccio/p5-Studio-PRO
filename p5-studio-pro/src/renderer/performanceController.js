/**
 * performanceController.js
 * Isolated Renderer Controller for Live Performance Recording
 * (Audio + Mouse/Keyboard Interaction + Audio DSP Metrics + OSC Stream)
 * for Deterministic Hook-Based Video Export.
 */

export class PerformanceController {
  constructor(ideApp) {
    this.app = ideApp;
    this.isRecording = false;
    this.recordStartTime = 0;
    this.timerInterval = null;
    this.currentPerfDir = null;

    this.audioContext = null;
    this.mediaStream = null;
    this.workletNode = null;
    this.gainNode = null;
    this.recordedAudioChunks = [];
    this.recordedSampleCount = 0;

    this._onWindowMessage = this._handleWindowMessage.bind(this);
    window.addEventListener('message', this._onWindowMessage);
  }

  initUI() {
    const btnRecPerf = document.getElementById('btn-record-performance');
    if (btnRecPerf) {
      btnRecPerf.addEventListener('click', () => this.toggleRecording());
    }

    const btnBrowsePerf = document.getElementById('btn-browse-perf');
    if (btnBrowsePerf) {
      btnBrowsePerf.addEventListener('click', async () => {
        if (window.electronAPI && window.electronAPI.export && window.electronAPI.export.showOpenDialog) {
          const filePath = await window.electronAPI.export.showOpenDialog({
            title: 'Seleziona Performance Stream JSON (perf_stream.json)',
            filters: [{ name: 'Performance Stream JSON (*.json)', extensions: ['json'] }],
            properties: ['openFile']
          });
          if (filePath) {
            const perfInput = document.getElementById('export-perf-path');
            if (perfInput) perfInput.value = filePath;
            await this.applyPerformanceMetadataToExportModal(filePath);
          }
        }
      });
    }

    const btnClearPerf = document.getElementById('btn-clear-perf');
    if (btnClearPerf) {
      btnClearPerf.addEventListener('click', () => {
        const perfInput = document.getElementById('export-perf-path');
        if (perfInput) perfInput.value = '';
      });
    }
  }

  async applyPerformanceMetadataToExportModal(streamPath) {
    if (!streamPath || !window.electronAPI || !window.electronAPI.performance) return;
    try {
      const streamData = await window.electronAPI.performance.readStream(streamPath);
      if (streamData && typeof streamData.durationSec === 'number' && streamData.durationSec > 0) {
        const durInput = document.getElementById('export-duration-input');
        if (durInput) durInput.value = String(Math.round(streamData.durationSec * 10) / 10);
      }
      // If perf_audio.wav exists in the same folder and export-audio-path is empty, auto-fill it
      const dir = streamPath.replace(/[\\/][^\\/]+$/, '');
      const candidateWav = `${dir}/perf_audio.wav`;
      const audioInput = document.getElementById('export-audio-path');
      if (audioInput && !audioInput.value.trim()) {
        const dur = await window.electronAPI.export.getAudioDuration(candidateWav);
        if (typeof dur === 'number' && dur > 0) {
          audioInput.value = candidateWav;
        }
      }
    } catch (e) {
      console.warn('[PerformanceController] Could not read performance stream metadata:', e);
    }
  }

  async toggleRecording() {
    if (!this.isRecording) {
      await this.startRecording();
    } else {
      await this.stopRecording();
    }
  }

  async startRecording() {
    if (this.isRecording) return;
    const btn = document.getElementById('btn-record-performance');
    const label = document.getElementById('label-record-performance');
    const timer = document.getElementById('record-timer');

    await this.app.flushPendingSave();

    this.isRecording = true;
    this.recordStartTime = performance.now();

    if (btn) btn.classList.add('recording');
    if (label) label.textContent = 'Stop Perf';
    if (timer) {
      timer.classList.remove('hidden');
      timer.textContent = '00:00.0';
    }

    this.timerInterval = setInterval(() => {
      const elapsed = (performance.now() - this.recordStartTime) / 1000;
      const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
      const secs = (elapsed % 60).toFixed(1).padStart(4, '0');
      if (timer) timer.textContent = `${mins}:${secs}`;
    }, 100);

    const takeName = `perf_${Date.now()}`;
    if (window.electronAPI && window.electronAPI.performance) {
      const res = await window.electronAPI.performance.start({
        takeName,
        meta: {
          bandRanges: this.app.currentBandRanges,
          audioGain: this.app.currentAudioGain
        }
      });
      this.currentPerfDir = res ? res.perfDir : null;
    }

    await this._startLiveAudioCapture();

    // Instruct preview sandbox to start streaming performance frames & events
    const frame = document.getElementById('preview-frame');
    if (frame && frame.contentWindow) {
      frame.contentWindow.postMessage({
        type: 'perf:startRecord',
        startTimeMs: Date.now()
      }, '*');
    }
  }

  async stopRecording() {
    if (!this.isRecording) return;
    this.isRecording = false;

    const btn = document.getElementById('btn-record-performance');
    const label = document.getElementById('label-record-performance');
    const timer = document.getElementById('record-timer');

    if (btn) btn.classList.remove('recording');
    if (label) label.textContent = 'Rec Performance';
    if (timer) timer.classList.add('hidden');
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    const elapsedSec = Math.max(0.5, Math.round(((performance.now() - this.recordStartTime) / 1000) * 10) / 10);

    // Ask preview sandbox to flush remaining frames & stop
    const frame = document.getElementById('preview-frame');
    if (frame && frame.contentWindow) {
      frame.contentWindow.postMessage({ type: 'perf:stopRecord' }, '*');
    }

    // Small wait so the final postMessage chunk from iframe arrives
    await new Promise(r => setTimeout(r, 80));

    const wavSaved = await this._stopLiveAudioCapture();
    let result = null;
    if (window.electronAPI && window.electronAPI.performance) {
      result = await window.electronAPI.performance.stop({
        durationSec: elapsedSec,
        meta: {
          hasAudioWav: wavSaved,
          bandRanges: this.app.currentBandRanges,
          audioGain: this.app.currentAudioGain
        }
      });
    }

    if (result && result.streamPath) {
      const perfInput = document.getElementById('export-perf-path');
      if (perfInput) perfInput.value = result.streamPath;

      const audioInput = document.getElementById('export-audio-path');
      if (audioInput && wavSaved && result.audioPath) {
        audioInput.value = result.audioPath;
      }

      const durInput = document.getElementById('export-duration-input');
      if (durInput && result.durationSec > 0) {
        durInput.value = String(result.durationSec);
      }

      const diagSpan = document.getElementById('status-diagnostics');
      if (diagSpan) {
        diagSpan.className = 'diagnostic-clean';
        diagSpan.textContent = `Performance salvata (${result.frameCount} frame, ${result.eventCount} eventi, ${result.durationSec}s) — pronta per Export`;
      }

      this.app.appendConsoleBatch([{
        level: 'info',
        text: `[Performance Recorder] Flusso salvato: ${result.frameCount} frame, ${result.eventCount} eventi interattivi (${result.durationSec}s) in ${result.streamPath}`,
        count: 1,
        timestamp: Date.now()
      }]);
    }
  }

  _handleWindowMessage(event) {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'perf:chunk' && this.isRecording) {
      if (window.electronAPI && window.electronAPI.performance) {
        window.electronAPI.performance.appendChunk({
          frames: data.frames || [],
          events: data.events || [],
          meta: data.meta || null
        });
      }
    }
  }

  async _startLiveAudioCapture() {
    try {
      this.recordedAudioChunks = [];
      this.recordedSampleCount = 0;

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      // Use native hardware sampleRate for full compatibility with iMac Intel & Apple Silicon
      this.audioContext = new AudioContextClass();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume().catch(() => {});
      }

      await this.audioContext.audioWorklet.addModule('./audioWorkletRecorder.js');

      const audioConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      };
      if (this.app.currentAudioDeviceId && this.app.currentAudioDeviceId !== 'default') {
        audioConstraints.deviceId = { ideal: this.app.currentAudioDeviceId };
      }

      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      } catch (devErr) {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.app.currentAudioGain || 1.0;

      this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-worklet-recorder');
      this.workletNode.port.onmessage = (event) => {
        if (event.data.type === 'chunk') {
          const left = new Float32Array(event.data.left);
          const right = new Float32Array(event.data.right);
          this.recordedAudioChunks.push({ left, right, length: event.data.length });
          this.recordedSampleCount += event.data.length;
        }
      };

      const silentDest = this.audioContext.createGain();
      silentDest.gain.value = 0.0;

      source.connect(this.gainNode);
      this.gainNode.connect(this.workletNode);
      this.workletNode.connect(silentDest);
      silentDest.connect(this.audioContext.destination);

      this.workletNode.port.postMessage({ command: 'start' });
    } catch (err) {
      console.warn('[PerformanceController] Audio capture unavailable during performance recording:', err);
    }
  }

  async _stopLiveAudioCapture() {
    let saved = false;
    try {
      if (this.workletNode) {
        this.workletNode.port.postMessage({ command: 'stop' });
      }

      if (this.currentPerfDir && this.recordedSampleCount > 0 && window.electronAPI && window.electronAPI.performance) {
        const leftFull = new Float32Array(this.recordedSampleCount);
        const rightFull = new Float32Array(this.recordedSampleCount);
        let offset = 0;

        for (const chunk of this.recordedAudioChunks) {
          leftFull.set(chunk.left, offset);
          rightFull.set(chunk.right, offset);
          offset += chunk.length;
        }

        const sr = (this.audioContext && this.audioContext.sampleRate) ? this.audioContext.sampleRate : 48000;
        await window.electronAPI.performance.saveWav(this.currentPerfDir, [leftFull, rightFull], sr);
        saved = true;
      }
    } catch (err) {
      console.warn('[PerformanceController] Error saving perf_audio.wav:', err);
    } finally {
      if (this.mediaStream) {
        try { this.mediaStream.getTracks().forEach(t => t.stop()); } catch (e) {}
        this.mediaStream = null;
      }
      if (this.audioContext) {
        try { await this.audioContext.close(); } catch (e) {}
        this.audioContext = null;
      }
      this.workletNode = null;
      this.gainNode = null;
    }
    return saved;
  }
}
