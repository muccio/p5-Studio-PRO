| Task | Description | Status |
| --- | --- | --- |
| 1 | Create project directory structure, package.json, electron-builder/vite configuration, and dependencies | completed |
| 2 | Implement Main Process: `src/main/index.js`, `src/main/projectManager.js`, `src/main/oscBridge.js`, `src/main/ffmpegExporter.js` | completed |
| 3 | Implement Preloads: `src/preload/idePreload.js` and `src/preload/sandboxPreload.js` with full Audio/OSC/Shader APIs & WebGL hooks | completed |
| 4 | Implement Renderer UI: `src/renderer/index.html`, `src/renderer/style.css`, `src/renderer/glslMonacoSetup.js`, `src/renderer/audioWorkletRecorder.js`, `src/renderer/main.js` | completed |
| 5 | Implement Starter Template: `templates/default-sketch/` with `project.json`, `index.html`, `sketch.js`, `common.glsl`, `effect.vert`, `effect.frag` | completed |
| 6 | Verification: Check all files, syntax, dependencies, run tests/build check, and update task tracker | completed |
| 7 | Configure and compile standalone macOS application (.app & .dmg) via electron-builder | completed |
| 8 | Fix packaged app issues: CJS preloads, template path in app.asar.unpacked, in-app modal for files/folders, Monaco web workers syntax highlighting, and auto-reload on paste | completed |
| 9 | Fix deterministic video exporter: prevent duplicate runtime script overriding export APIs, fix async shader load returning Promise to p5.js, and prevent FFmpeg premature termination | completed |
| 10 | Fix native resolution rendering (exact canvas resize, pixelDensity(1), enableLargerThanScreen) and export modal UI layout (pinned footer, flex scrolling, button clipping fixes) | completed |
| 11 | Implement separate Preview Window (popout/dock) and external Live Stage Window (multi-display projector routing, F11/double-click fullscreen, unthrottled 60 FPS, synchronized shader/OSC hot-reload) | completed |
| 12 | Fix Monaco language chunk bloat (eliminate unused XML/90+ languages chunks), fix DOMContentLoaded startup race condition, add DevTools shortcuts & fatal error overlay, re-bundle macOS .app & .dmg | completed |
