# p5-Studio-PRO

**p5-Studio-PRO** is a production-ready, cross-platform desktop IDE engineered specifically for **p5.js & GLSL Shaders** (macOS & Windows).

It unites professional audio-reactive creative coding, multi-file GLSL shader development, bidirectional UDP OSC control, and deterministic non-real-time frame-by-frame video export via FFmpeg with 100% audio and visual lockstep synchronization.

---

## ⚡ Key Architecture & Features

### 1. Multi-File GLSL & p5.js Projects with Monaco Editor
- **Recursive `#include` Preprocessor:** Split complex shaders into modular files (e.g. `common.glsl`, SDF libraries, rotation matrices, noise functions).
- **Line Number Preservation:** Injects `#line` preprocessor directives and maps WebGL compiler errors back to the exact source file and line in Monaco with red squiggly diagnostics.
- **Stateful Live Hot-Reloading:** Edit `.vert`, `.frag`, or included `.glsl` files with live re-compilation in WebGL on save without resetting `frameCount`, `millis()`, audio streams, or OSC state.
- **Fail-Safe Compiler Protection:** If shader syntax is invalid, keeps the last valid compiled program running on screen to prevent visual blackouts.

### 2. Dual-Mode Audio-Reactive Engine + WebGL Audio Texture (`u_audioTex`)
- **Mode 1: Real-Time Live Input:**
  - Connects to hardware or virtual audio inputs (BlackHole, Loopback, VB-Cable, audio interfaces) with zero DSP filtering (`echoCancellation: false`, `noiseSuppression: false`, `sampleRate: 48000`).
  - AnalyserNode (`fftSize = 2048`, `smoothingTimeConstant = 0.8`).
  - Lossless Float32 PCM Take Recorder via `AudioWorkletNode` writing 32-bit float `.wav` files into `.takes/`.
- **Mode 2: Deterministic Offline DSP Mode:**
  - Loads 32-bit Float PCM from recorded `take_audio.wav` or external audio.
  - Slices 2048 samples at exact frame timestamps: $\lfloor \frac{N}{\text{fps}} \times \text{sampleRate} \rfloor$.
  - Executes a pure JavaScript in-place Radix-2 Cooley-Tukey FFT with Hann windowing and exponential smoothing matching real-time playback identically.
- **WebGL Audio Data Texture (`sampler2D u_audioTex`):**
  - Maintained as a dynamic $1024 \times 2$ WebGL texture updated every frame:
    - **Row 0 ($y = 0.25$):** 1024 normalized FFT frequency bins in R channel (smoothed peak-hold in G channel).
    - **Row 1 ($y = 0.75$):** 1024 time-domain Waveform samples mapped $0..255$ in R channel ($128 = 0.0$ center crossing).
  - Shaders can sample seamlessly:
    ```glsl
    float fftVal = texture2D(u_audioTex, vec2(uv.x, 0.25)).r;
    float waveVal = (texture2D(u_audioTex, vec2(uv.x, 0.75)).r - 0.5) * 2.0;
    ```
- **Unified Audio Helper API (`window.ideAudio`):**
  - `ideAudio.getRMS()`, `ideAudio.getFFT()`, `ideAudio.getWaveform()`, `ideAudio.getEnergy(bandOrLowHz, highHz)`, `ideAudio.isBeat()`, `ideAudio.getTexture(p5)`.

### 3. Bidirectional OSC (Open Sound Control) Engine (`window.ideOSC`)
- Built-in binary OSC 1.0 parser & serializer over UDP (`dgram`).
- Configurable RX port (default `9000`) and TX port (default `9001`).
- **Timestamped Take Recording:** Records incoming OSC packets `{ timestampMs, address, args }` into `take_osc.json`.
- **Direct Shader Uniform Binding:**
  ```javascript
  window.ideOSC.bindUniforms(myShader, {
    u_zoom: ['/shader/zoom', 1.0],
    u_palette: ['/shader/palette', 0.0]
  });
  ```
- **Deterministic Replay:** Replays recorded OSC messages at virtual frame time $t_N = \frac{N}{\text{fps}} \times 1000$ ms during video export.

### 4. Cross-Platform Pixel-Perfect Parity & Video Exporter (`ffmpegExporter.js`)
- Enforces strict Skia, ANGLE, and WebGL rendering parity on macOS and Windows:
  - `force-color-profile: srgb`
  - `disable-lcd-text`
  - `high-dpi-support: 1`
  - `force-device-scale-factor: 1`
  - WebGL context enforcement: `preserveDrawingBuffer: true`, `antialias: true`, `premultipliedAlpha: false`.
  - Auto-injection of `#ifdef GL_ES precision highp float; #endif` on fragment shaders.
- **Deterministic Non-Real-Time Lockstep Exporter:**
  - Freezes real-time timers and steps virtual frame clock $N = 0 \dots \text{totalFrames} - 1$.
  - In-place vertical row swap in memory for WebGL `readPixels` bottom-left to top-left coordinate matching.
  - Raw RGBA pixel pipe to FFmpeg stdin with backpressure awaiting.
  - Codec Profiles:
    1. **H.264 Master:** CRF 15, YUV420P, AAC 320k.
    2. **H.264 Chroma-Pure:** CRF 14, YUV444P (zero chroma subsampling bleeding on sharp shader edges).
    3. **Apple ProRes 4444 + Alpha:** YUVA444P10LE, 24-bit PCM audio (transparent background shader export).

---

## 🚀 Installation & Running

### Prerequisites
- Node.js 18+ (tested on Node 24)
- npm 9+

### Commands

To install and run from within `p5-studio-pro`:
```bash
cd p5-studio-pro
npm install
npm run dev
```

Or from the workspace root:
```bash
npm install
npm run dev
```

### Production Build
```bash
cd p5-studio-pro
npm run build
npm start
```

### Run Test Suite
```bash
cd p5-studio-pro
npm test
```

---

## 📁 Directory Structure

```text
p5-studio-pro/
├── package.json
├── vite.config.js               # Renderer build config & worker configuration
├── electron.vite.config.js      # Alias config
├── src/
│   ├── main/
│   │   ├── index.js             # Electron Main Process & Chromium parity flags
│   │   ├── projectManager.js    # Multi-file FS manager, GLSL #include preprocessor & HTTP server
│   │   ├── oscBridge.js         # UDP OSC Server/Client & Take Recorder
│   │   └── ffmpegExporter.js    # FFmpeg stdin raw-pixel pipe (WebGL Y-flip) & WAV muxer
│   ├── preload/
│   │   ├── idePreload.js        # IPC bridge for main IDE UI
│   │   └── sandboxPreload.js    # Injected into Preview: ideAudio, ideOSC, ideShader, Virtual Clock
│   └── renderer/
│       ├── index.html           # IDE Main Layout (Editor, Preview, Meters, Exporter)
│       ├── style.css            # Dark pro-audio/shader aesthetic UI
│       ├── main.js              # Monaco setup, File Tree, Diagnostics, Exporter UI
│       ├── glslMonacoSetup.js   # Custom GLSL tokenizer, autocomplete & error highlighter
│       └── audioWorkletRecorder.js # Float32 PCM stereo recorder
└── templates/
    └── default-sketch/
        ├── project.json         # Sketch config & OSC uniform bindings
        ├── index.html           # Sketch host HTML
        ├── p5.min.js            # Bundled p5.js library (offline ready)
        ├── sketch.js            # Main p5.js WEBGL entry point using ideShader, ideAudio, ideOSC
        ├── common.glsl          # Shared GLSL module (SDFs, rotations, noise, palettes)
        ├── effect.vert          # Vertex shader
        └── effect.frag          # Audio-reactive & OSC-reactive Fragment Shader
```
