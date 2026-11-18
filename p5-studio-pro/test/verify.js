import assert from 'assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { ProjectManager, P5_SOUND_V2_CDN_URL } from '../src/main/projectManager.js';
import { PerformanceManager } from '../src/main/performanceManager.js';
import { OscBridge } from '../src/main/oscBridge.js';
import { FfmpegExporter, EXPORT_PROFILES, decodeAudioFileToFloat32, getAudioDurationSec } from '../src/main/ffmpegExporter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const defaultSketchDir = path.resolve(projectRoot, 'templates/default-sketch');

console.log('====================================================');
console.log('p5-Studio-PRO Verification & Test Suite');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

function test(description, fn) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${description}`);
    console.error(err);
  }
}

async function asyncTest(description, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`[PASS] ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${description}`);
    console.error(err);
  }
}

// ----------------------------------------------------
// 1. Verify Directory Tree & Files
// ----------------------------------------------------
test('1. Verify all expected project files exist and are non-empty', () => {
  const expectedFiles = [
    'package.json',
    'vite.config.js',
    'src/main/index.js',
    'src/main/projectManager.js',
    'src/main/oscBridge.js',
    'src/main/ffmpegExporter.js',
    'src/preload/idePreload.cjs',
    'src/preload/sandboxPreload.cjs',
    'src/renderer/index.html',
    'src/renderer/style.css',
    'src/renderer/main.js',
    'src/renderer/glslMonacoSetup.js',
    'src/renderer/audioWorkletRecorder.js',
    'templates/default-sketch/project.json',
    'templates/default-sketch/index.html',
    'templates/default-sketch/sketch.js',
    'templates/default-sketch/common.glsl',
    'templates/default-sketch/effect.vert',
    'templates/default-sketch/effect.frag'
  ];

  for (const relPath of expectedFiles) {
    const fullPath = path.join(projectRoot, relPath);
    assert.ok(fs.existsSync(fullPath), `File missing: ${relPath}`);
    const stat = fs.statSync(fullPath);
    assert.ok(stat.size > 0, `File is empty: ${relPath}`);
  }
});

// ----------------------------------------------------
// 2. Test GLSL #include Preprocessor & Error Line Mapper
// ----------------------------------------------------
test('2. GLSL Preprocessor resolves #include "common.glsl" recursively and injects #line', () => {
  const pm = new ProjectManager(defaultSketchDir);
  const result = pm.preprocessShader('effect.frag');

  assert.ok(result.code, 'Preprocessed code should not be empty');
  assert.ok(result.code.includes('sdGyroid'), 'Preprocessed code should include functions from common.glsl');
  assert.ok(result.code.includes('paletteCyber'), 'Preprocessed code should include color palettes from common.glsl');
  assert.ok(result.code.includes('#line 1'), 'Preprocessed code should inject #line directives');
  assert.ok(result.sourceTable.length >= 2, 'sourceTable should contain at least effect.frag and common.glsl');

  // Test WebGL Error Mapping
  const mockInfoLog = 'ERROR: 1:42: \'undefined_variable\' : undeclared identifier';
  const errors = pm.mapCompilerErrors(mockInfoLog, result.sourceTable);
  assert.strictEqual(errors.length, 1);
  assert.strictEqual(errors[0].line, 42);
  assert.strictEqual(errors[0].sourceId, 1);
  assert.ok(errors[0].file.includes('common.glsl'));
});

// ----------------------------------------------------
// 3. Test Binary OSC 1.0 Parser, Serializer & Take Recording
// ----------------------------------------------------
test('3. OSC Bridge binary encoding and decoding (floats, ints, strings, blobs)', () => {
  const bridge = new OscBridge();
  const address = '/shader/zoom';
  const args = [1.5, 42, 'cyberpunk'];

  const encoded = bridge.encodeMessage(address, args);
  assert.ok(Buffer.isBuffer(encoded));
  assert.strictEqual(encoded.length % 4, 0, 'OSC packet must be 4-byte aligned');

  const decoded = bridge.decodePacket(encoded);
  assert.strictEqual(decoded.length, 1);
  assert.strictEqual(decoded[0].address, address);
  assert.strictEqual(decoded[0].args.length, 3);
  assert.ok(Math.abs(decoded[0].args[0] - 1.5) < 0.0001);
  assert.strictEqual(decoded[0].args[1], 42);
  assert.strictEqual(decoded[0].args[2], 'cyberpunk');
});

test('4. OSC Bridge Take Recording flushes take_osc.json correctly', () => {
  const bridge = new OscBridge();
  const tempTakeDir = path.join(projectRoot, '.test_take');

  bridge.startRecording(tempTakeDir);
  assert.strictEqual(bridge.isRecording, true);

  // Simulate incoming OSC packets
  const packet1 = bridge.encodeMessage('/shader/zoom', [2.0]);
  const packet2 = bridge.encodeMessage('/shader/palette', [1.0]);
  bridge._handleIncomingPacket(packet1, { address: '127.0.0.1', port: 9000 });
  bridge._handleIncomingPacket(packet2, { address: '127.0.0.1', port: 9000 });

  const result = bridge.stopRecording();
  assert.strictEqual(result.count, 2);
  assert.ok(fs.existsSync(result.savedPath));

  const jsonContent = JSON.parse(fs.readFileSync(result.savedPath, 'utf-8'));
  assert.strictEqual(jsonContent.length, 2);
  assert.strictEqual(jsonContent[0].address, '/shader/zoom');
  assert.strictEqual(jsonContent[1].address, '/shader/palette');

  // Clean up
  fs.rmSync(tempTakeDir, { recursive: true, force: true });
});

// ----------------------------------------------------
// 4. Test FFmpeg Exporter Profiles & Vertical Flip
// ----------------------------------------------------
test('5. FfmpegExporter profiles and vertical flip logic', () => {
  assert.ok(EXPORT_PROFILES['h264-master']);
  assert.ok(EXPORT_PROFILES['h264-chroma-pure']);
  assert.ok(EXPORT_PROFILES['prores-4444-alpha']);

  // Test in-memory vertical flip
  const width = 2;
  const height = 2;
  // Row 0: Red, Green
  // Row 1: Blue, Yellow
  const buf = new Uint8Array([
    255, 0, 0, 255,   0, 255, 0, 255, // Row 0
    0, 0, 255, 255,   255, 255, 0, 255 // Row 1
  ]);

  FfmpegExporter.flipVerticalRGBA(buf, width, height);

  // After flip, Row 0 should be Blue, Yellow
  assert.strictEqual(buf[0], 0);
  assert.strictEqual(buf[1], 0);
  assert.strictEqual(buf[2], 255);
  // Row 1 should be Red, Green
  assert.strictEqual(buf[8], 255);
  assert.strictEqual(buf[9], 0);
  assert.strictEqual(buf[10], 0);
});

// ----------------------------------------------------
// 5. Test Live Raw Frame Encoding to MP4 via FFmpeg
// ----------------------------------------------------
await asyncTest('6. Live FFmpeg rawvideo RGBA pipe encoding produces valid MP4', async () => {
  const exporter = new FfmpegExporter();
  const testOutput = path.join(projectRoot, '.test_render.mp4');

  exporter.startExport({
    width: 320,
    height: 240,
    fps: 30,
    totalFrames: 10,
    outputPath: testOutput,
    profile: 'h264-master'
  });

  const frameSize = 320 * 240 * 4;
  const frameBuf = Buffer.alloc(frameSize, 128); // Grey frame

  for (let f = 0; f < 10; f++) {
    await exporter.pushFrame(frameBuf, true);
  }

  const result = await exporter.finishExport();
  assert.ok(result);
  assert.strictEqual(result.totalFrames, 10);
  assert.ok(fs.existsSync(testOutput));
  assert.ok(fs.statSync(testOutput).size > 100);

  // Clean up
  fs.rmSync(testOutput, { force: true });
});

// ----------------------------------------------------
// 7. Test Live Stage & Popout Preview Structure & APIs
// ----------------------------------------------------
test('7. Verify Live Stage and Popout Preview structures, preloads, and UI components', () => {
  const idePreloadSrc = fs.readFileSync(path.join(projectRoot, 'src/preload/idePreload.cjs'), 'utf-8');
  assert.ok(idePreloadSrc.includes('live:'), 'idePreload must expose live namespace');
  assert.ok(idePreloadSrc.includes('live:toggle'), 'idePreload must support live:toggle');
  assert.ok(idePreloadSrc.includes('live:getDisplays'), 'idePreload must support live:getDisplays');
  assert.ok(idePreloadSrc.includes('live:moveToDisplay'), 'idePreload must support live:moveToDisplay');
  assert.ok(idePreloadSrc.includes('live:toggleFullscreen'), 'idePreload must support live:toggleFullscreen');
  assert.ok(idePreloadSrc.includes('preview:'), 'idePreload must expose preview namespace');
  assert.ok(idePreloadSrc.includes('preview:toggle'), 'idePreload must support preview:toggle');

  const sandboxPreloadSrc = fs.readFileSync(path.join(projectRoot, 'src/preload/sandboxPreload.cjs'), 'utf-8');
  assert.ok(sandboxPreloadSrc.includes('isLiveMode'), 'sandboxPreload must handle isLiveMode');
  assert.ok(sandboxPreloadSrc.includes('isPopoutMode'), 'sandboxPreload must handle isPopoutMode');
  assert.ok(sandboxPreloadSrc.includes('live:toggleFullscreen'), 'sandboxPreload must support double-click fullscreen in live mode');

  const htmlSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf-8');
  assert.ok(htmlSrc.includes('btn-toggle-live-window'), 'index.html must include btn-toggle-live-window');
  assert.ok(htmlSrc.includes('select-live-display'), 'index.html must include select-live-display');
  assert.ok(htmlSrc.includes('btn-live-fullscreen'), 'index.html must include btn-live-fullscreen');
  assert.ok(htmlSrc.includes('btn-popout-preview'), 'index.html must include btn-popout-preview');
  assert.ok(htmlSrc.includes('preview-docked-notice'), 'index.html must include preview-docked-notice');

  const mainJsSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/main.js'), 'utf-8');
  assert.ok(mainJsSrc.includes('initLiveWindowControls'), 'main.js must implement initLiveWindowControls');
  assert.ok(mainJsSrc.includes('initPreviewPopoutControls'), 'main.js must implement initPreviewPopoutControls');

  const mainIndexSrc = fs.readFileSync(path.join(projectRoot, 'src/main/index.js'), 'utf-8');
  assert.ok(mainIndexSrc.includes('openLiveWindow'), 'src/main/index.js must implement openLiveWindow');
  assert.ok(mainIndexSrc.includes('openPreviewWindow'), 'src/main/index.js must implement openPreviewWindow');
  assert.ok(mainIndexSrc.includes('backgroundThrottling: false'), 'live window must enforce backgroundThrottling: false');
});

// ----------------------------------------------------
// 8. Test Monaco Syntax Highlighting & Code Hints for HTML, CSS, & All Shaders
// ----------------------------------------------------
test('8. Verify Syntax Highlighting and Code Hints for HTML, CSS, and universal Shaders', () => {
  const glslSetupSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/glslMonacoSetup.js'), 'utf-8');
  assert.ok(glslSetupSrc.includes('SHADER_EXTENSIONS'), 'glslMonacoSetup must export SHADER_EXTENSIONS');
  assert.ok(glslSetupSrc.includes('isShaderFile'), 'glslMonacoSetup must export isShaderFile');
  assert.ok(glslSetupSrc.includes('registerHoverProvider'), 'glslMonacoSetup must register hover documentation for GLSL');
  assert.ok(glslSetupSrc.includes('registerSignatureHelpProvider'), 'glslMonacoSetup must register signature parameter hints for GLSL');
  assert.ok(glslSetupSrc.includes('raymarch'), 'glslMonacoSetup must include raymarching code snippet');
  assert.ok(glslSetupSrc.includes('sampleAudioFFT'), 'glslMonacoSetup must include audio FFT helper snippet');
  assert.ok(glslSetupSrc.includes('GLSL_DOCS'), 'glslMonacoSetup must provide rich GLSL documentation');

  const langServiceSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/ideLanguageService.js'), 'utf-8');
  assert.ok(langServiceSrc.includes('setupWebAndScriptSupport'), 'ideLanguageService must export setupWebAndScriptSupport');
  assert.ok(langServiceSrc.includes('registerHoverProvider(\'html\''), 'ideLanguageService must provide HTML hover docs');
  assert.ok(langServiceSrc.includes('registerHoverProvider(\'css\''), 'ideLanguageService must provide CSS hover docs');
  assert.ok(langServiceSrc.includes('registerCompletionItemProvider(\'html\''), 'ideLanguageService must provide HTML snippets/hints');
  assert.ok(langServiceSrc.includes('registerCompletionItemProvider(\'css\''), 'ideLanguageService must provide CSS snippets/hints');
  assert.ok(langServiceSrc.includes('addExtraLib'), 'ideLanguageService must inject p5.js and ide* TypeScript typings for JS autocompletion');

  const mainJsSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/main.js'), 'utf-8');
  assert.ok(mainJsSrc.includes('setupWebAndScriptSupport'), 'main.js must invoke setupWebAndScriptSupport');
  assert.ok(mainJsSrc.includes('tag.html'), 'main.js must define HTML token syntax colors');
  assert.ok(mainJsSrc.includes('property.name.css'), 'main.js must define CSS token syntax colors');
  assert.ok(mainJsSrc.includes('isShaderFile(ext)'), 'main.js must use isShaderFile for universal shader support');

  const projMgrSrc = fs.readFileSync(path.join(projectRoot, 'src/main/projectManager.js'), 'utf-8');
  assert.ok(projMgrSrc.includes('SHADER_EXTENSIONS'), 'projectManager must declare SHADER_EXTENSIONS');
  assert.ok(projMgrSrc.includes('.fsh'), 'projectManager MIME_TYPES must support .fsh');
  assert.ok(projMgrSrc.includes('.vsh'), 'projectManager MIME_TYPES must support .vsh');
});

// ----------------------------------------------------
// 9. Test p5.js Version Selector, Libraries Catalog, Reference Search & Live Push
// ----------------------------------------------------
test('9. Verify p5.js Version Selector, Libraries Catalog, Reference Links and Live Stage Push', () => {
  const pm = new ProjectManager(defaultSketchDir);
  const v = pm.getP5Version();
  assert.ok(typeof v === 'string' && v.length > 0, 'getP5Version must return valid version string');

  const swapRes = pm.commitToLiveBuffer();
  assert.ok(swapRes && swapRes.success, 'commitToLiveBuffer must succeed');
  assert.ok(fs.existsSync(path.join(defaultSketchDir, '.live_buffer/sketch.js')), '.live_buffer/sketch.js must exist after swap commit');

  const libs = pm.getP5Libraries();
  assert.ok(Array.isArray(libs.catalog) && libs.catalog.length >= 10, 'getP5Libraries must provide rich catalog');
  assert.ok(libs.catalog.some(l => l.id === 'ml5'), 'catalog must contain ml5');
  assert.ok(libs.catalog.some(l => l.id === 'tweakpane'), 'catalog must contain tweakpane');
  assert.ok(libs.catalog.some(l => l.id === 'p5.sound'), 'catalog must contain p5.sound');

  const idePreloadSrc = fs.readFileSync(path.join(projectRoot, 'src/preload/idePreload.cjs'), 'utf-8');
  assert.ok(idePreloadSrc.includes('system: {'), 'idePreload must expose system namespace');
  assert.ok(idePreloadSrc.includes('openExternal'), 'idePreload must expose openExternal');
  assert.ok(idePreloadSrc.includes('setP5Version'), 'idePreload must expose setP5Version');
  assert.ok(idePreloadSrc.includes('getP5Libraries'), 'idePreload must expose getP5Libraries');
  assert.ok(idePreloadSrc.includes('toggleP5Library'), 'idePreload must expose toggleP5Library');
  assert.ok(idePreloadSrc.includes('pushStage'), 'idePreload must expose live pushStage');

  const langServiceSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/ideLanguageService.js'), 'utf-8');
  assert.ok(langServiceSrc.includes('p5-search-reference'), 'ideLanguageService must register p5 reference search action');
  assert.ok(langServiceSrc.includes('glsl-search-reference'), 'ideLanguageService must register glsl reference search action');
  assert.ok(langServiceSrc.includes('P5_REFERENCE_DOCS'), 'ideLanguageService must have P5_REFERENCE_DOCS');

  const mainJsSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/main.js'), 'utf-8');
  assert.ok(mainJsSrc.includes('pushToLiveStage'), 'main.js must implement pushToLiveStage');
  assert.ok(mainJsSrc.includes('initP5VersionControls'), 'main.js must implement initP5VersionControls');
  assert.ok(mainJsSrc.includes('initP5LibrariesModal'), 'main.js must implement initP5LibrariesModal');
  assert.ok(mainJsSrc.includes('quickSuggestions'), 'main.js must configure VSCode-like quickSuggestions');

  const indexHtmlSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf-8');
  assert.ok(indexHtmlSrc.includes('select-p5-version'), 'index.html must have select-p5-version');
  assert.ok(indexHtmlSrc.includes('btn-open-libraries'), 'index.html must have btn-open-libraries');
  assert.ok(indexHtmlSrc.includes('btn-push-live-stage'), 'index.html must have btn-push-live-stage');
  assert.ok(indexHtmlSrc.includes('libraries-modal'), 'index.html must have libraries-modal');

  const mainIndexSrc = fs.readFileSync(path.join(projectRoot, 'src/main/index.js'), 'utf-8');
  assert.ok(mainIndexSrc.includes('simpleFullScreen'), 'index.js must configure simpleFullScreen for clean barless fullscreen on macOS');
  assert.ok(mainIndexSrc.includes('live:pushStage'), 'index.js must handle live:pushStage');
  assert.ok(mainIndexSrc.includes('/__live/index.html'), 'index.js must load Live Stage from isolated /__live/ buffer');
});

// ----------------------------------------------------
// 10. Test Fault-Tolerant Hot Swap, JS Syntax Validation & VSCode IntelliSense
// ----------------------------------------------------
test('10. Verify Fault-Tolerant Hot Swap, JS Syntax Guard and VSCode IntelliSense Completion', () => {
  const mainJsSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/main.js'), 'utf-8');
  assert.ok(mainJsSrc.includes('validateActiveScript'), 'main.js must implement validateActiveScript');
  assert.ok(mainJsSrc.includes('hasJsErrors'), 'main.js must track hasJsErrors state');
  assert.ok(!mainJsSrc.includes('window.electronAPI.live.reload()'), 'restartPreview must NEVER automatically reload live window');
  assert.ok(mainJsSrc.includes('runtime:error'), 'main.js must handle runtime:error message from sandbox');

  const langServiceSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/ideLanguageService.js'), 'utf-8');
  assert.ok(langServiceSrc.includes('buildP5CompletionItems'), 'ideLanguageService must implement buildP5CompletionItems');
  assert.ok(langServiceSrc.includes('circle'), 'P5_REFERENCE_DOCS must contain circle');
  assert.ok(langServiceSrc.includes('rect'), 'P5_REFERENCE_DOCS must contain rect');
  assert.ok(langServiceSrc.includes('createCanvas'), 'P5_REFERENCE_DOCS must contain createCanvas');
  assert.ok(langServiceSrc.includes('triggerCharacters'), 'completion providers must define triggerCharacters');

  const glslSetupSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/glslMonacoSetup.js'), 'utf-8');
  assert.ok(glslSetupSrc.includes('triggerCharacters'), 'glslMonacoSetup must define triggerCharacters for auto-trigger');

  const runtimeSrc = fs.readFileSync(path.join(projectRoot, 'src/main/sandboxRuntime.js'), 'utf-8');
  assert.ok(runtimeSrc.includes('studio-sandbox-error-overlay'), 'sandboxRuntime must implement floating error HUD');
  assert.ok(runtimeSrc.includes('runtime:error'), 'sandboxRuntime must post runtime:error');

  const preloadSrc = fs.readFileSync(path.join(projectRoot, 'src/preload/sandboxPreload.cjs'), 'utf-8');
  assert.ok(preloadSrc.includes('studio-sandbox-error-overlay'), 'sandboxPreload must implement floating error HUD');
});

// ----------------------------------------------------
// 11. Test p5.js Reference Explorer, Dynamic Context Menu & Ghost Error Marker Fix
// ----------------------------------------------------
test('11. Verify p5.js Reference Modal, Dynamic Context Menu Search & Error Clearing', () => {
  const htmlSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf-8');
  assert.ok(htmlSrc.includes('id="btn-open-reference"'), 'index.html must have btn-open-reference trigger');
  assert.ok(htmlSrc.includes('id="reference-modal"'), 'index.html must have reference-modal markup');
  assert.ok(htmlSrc.includes('id="input-search-reference"'), 'index.html must have input-search-reference');
  assert.ok(htmlSrc.includes('id="reference-results-grid"'), 'index.html must have reference-results-grid');

  const mainJsSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/main.js'), 'utf-8');
  assert.ok(mainJsSrc.includes('initP5ReferenceModal'), 'main.js must implement initP5ReferenceModal');
  assert.ok(mainJsSrc.includes('openReferenceModal'), 'main.js must expose openReferenceModal');
  assert.ok(mainJsSrc.includes("monaco.editor.setModelMarkers(model, 'p5-runtime', [])"), 'validateActiveScript must clear p5-runtime markers on valid syntax');
  assert.ok(mainJsSrc.includes('isGenericScriptError'), 'main.js must detect generic script errors to prevent false line markers');

  const langServiceSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/ideLanguageService.js'), 'utf-8');
  assert.ok(langServiceSrc.includes('p5-search-reference-inapp'), 'ideLanguageService must register p5-search-reference-inapp action');
  assert.ok(langServiceSrc.includes('p5-search-reference-online'), 'ideLanguageService must register p5-search-reference-online action');
  assert.ok(langServiceSrc.includes('editor.onContextMenu'), 'ideLanguageService must dynamically update context menu label on right-click');
  assert.ok(langServiceSrc.includes('P5_CATEGORIES'), 'ideLanguageService must export P5_CATEGORIES');
  assert.ok(langServiceSrc.includes('getCategoryForSymbol'), 'ideLanguageService must export getCategoryForSymbol');

  const styleSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/style.css'), 'utf-8');
  assert.ok(styleSrc.includes('.reference-modal-card'), 'style.css must style .reference-modal-card');
  assert.ok(styleSrc.includes('.reference-card'), 'style.css must style .reference-card');
  assert.ok(styleSrc.includes('.btn-insert-code'), 'style.css must style .btn-insert-code');

  const projMgrSrc = fs.readFileSync(path.join(projectRoot, 'src/main/projectManager.js'), 'utf-8');
  assert.ok(projMgrSrc.includes('credentialless'), 'projectManager must use credentialless for Cross-Origin-Embedder-Policy');
  assert.ok(projMgrSrc.includes('crossorigin="anonymous"'), 'projectManager must inject crossorigin="anonymous" on CDN scripts');
});

// ----------------------------------------------------
// 12. Test Editor Appearance Controls (Font Size, Font Family, Window Opacity)
// ----------------------------------------------------
test('12. Verify Editor Font Size, Font Family, and Window Opacity Controls', () => {
  const htmlSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf-8');
  assert.ok(htmlSrc.includes('id="btn-open-appearance"'), 'index.html must have btn-open-appearance trigger');
  assert.ok(htmlSrc.includes('id="appearance-modal"'), 'index.html must have appearance-modal markup');
  assert.ok(htmlSrc.includes('id="slider-font-size"'), 'index.html must have slider-font-size');
  assert.ok(htmlSrc.includes('id="select-font-family"'), 'index.html must have select-font-family');
  assert.ok(htmlSrc.includes('id="slider-window-opacity"'), 'index.html must have slider-window-opacity');
  assert.ok(htmlSrc.includes('id="status-font-size"'), 'index.html status bar must show status-font-size');
  assert.ok(htmlSrc.includes('id="status-window-opacity"'), 'index.html status bar must show status-window-opacity');
  assert.ok(htmlSrc.includes('id="font-preview-box"'), 'index.html must have live font preview box');

  const mainSrc = fs.readFileSync(path.join(projectRoot, 'src/main/index.js'), 'utf-8');
  assert.ok(mainSrc.includes("ipcMain.handle('window:setOpacity'"), 'main/index.js must handle window:setOpacity');
  assert.ok(mainSrc.includes("ipcMain.handle('window:getOpacity'"), 'main/index.js must handle window:getOpacity');

  const preloadSrc = fs.readFileSync(path.join(projectRoot, 'src/preload/idePreload.cjs'), 'utf-8');
  assert.ok(preloadSrc.includes("setOpacity: (opacity) => ipcRenderer.invoke('window:setOpacity'"), 'idePreload must expose setOpacity');
  assert.ok(preloadSrc.includes("getOpacity: () => ipcRenderer.invoke('window:getOpacity')"), 'idePreload must expose getOpacity');

  const mainJsSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/main.js'), 'utf-8');
  assert.ok(mainJsSrc.includes('initAppearanceControls'), 'main.js must implement initAppearanceControls');
  assert.ok(mainJsSrc.includes('openAppearanceModal'), 'main.js must implement openAppearanceModal');
  assert.ok(mainJsSrc.includes('setFontSize'), 'main.js must implement setFontSize');
  assert.ok(mainJsSrc.includes('setFontFamily'), 'main.js must implement setFontFamily');
  assert.ok(mainJsSrc.includes('setWindowOpacity'), 'main.js must implement setWindowOpacity');
  assert.ok(mainJsSrc.includes('p5_studio_font_size'), 'main.js must persist p5_studio_font_size');
  assert.ok(mainJsSrc.includes('p5_studio_font_family'), 'main.js must persist p5_studio_font_family');
  assert.ok(mainJsSrc.includes('p5_studio_window_opacity'), 'main.js must persist p5_studio_window_opacity');

  const styleSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/style.css'), 'utf-8');
  assert.ok(styleSrc.includes('.appearance-modal-card'), 'style.css must style .appearance-modal-card');
  assert.ok(styleSrc.includes('.font-preview-box'), 'style.css must style .font-preview-box');
  assert.ok(styleSrc.includes('.btn-preset-opacity'), 'style.css must style .btn-preset-opacity');
  assert.ok(styleSrc.includes('.status-badge-interactive'), 'style.css must style .status-badge-interactive');
});

// ----------------------------------------------------
// 13. Test Deterministic Audio-Reactive Export (Universal Audio Decode + p5.sound Lockstep)
// ----------------------------------------------------
await asyncTest('13. Verify universal FFmpeg audio decoding (WAV/MP3) and p5.sound lockstep export hooks', async () => {
  // Generate a 0.25s 440Hz sine wave WAV and verify decodeAudioFileToFloat32 decodes it accurately
  const testWavPath = path.join(projectRoot, '.test_tone.wav');
  const sr = 48000;
  const numSamples = 12000;
  const wavBuf = Buffer.alloc(44 + numSamples * 2);
  wavBuf.write('RIFF', 0);
  wavBuf.writeUInt32LE(36 + numSamples * 2, 4);
  wavBuf.write('WAVE', 8);
  wavBuf.write('fmt ', 12);
  wavBuf.writeUInt32LE(16, 16);
  wavBuf.writeUInt16LE(1, 20); // PCM 16-bit
  wavBuf.writeUInt16LE(1, 22); // Mono
  wavBuf.writeUInt32LE(sr, 24);
  wavBuf.writeUInt32LE(sr * 2, 28);
  wavBuf.writeUInt16LE(2, 32);
  wavBuf.writeUInt16LE(16, 34);
  wavBuf.write('data', 36);
  wavBuf.writeUInt32LE(numSamples * 2, 40);
  for (let i = 0; i < numSamples; i++) {
    const val = Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 16384);
    wavBuf.writeInt16LE(val, 44 + i * 2);
  }
  fs.writeFileSync(testWavPath, wavBuf);

  try {
    const decoded = await decodeAudioFileToFloat32(testWavPath, { sampleRate: 48000, maxDurationSec: 2 });
    assert.ok(decoded && Buffer.isBuffer(decoded.pcmBuffer), 'decodeAudioFileToFloat32 must return pcmBuffer');
    assert.strictEqual(decoded.sampleRate, 48000);
    assert.ok(decoded.numSamples >= 11900, 'Decoded sample count must match input audio');

    const floats = new Float32Array(decoded.pcmBuffer.buffer, decoded.pcmBuffer.byteOffset, decoded.numSamples);
    let peak = 0;
    for (let i = 0; i < floats.length; i++) peak = Math.max(peak, Math.abs(floats[i]));
    assert.ok(peak > 0.45 && peak < 0.55, `Decoded 440Hz sine peak should be ~0.5, got ${peak}`);
  } finally {
    fs.rmSync(testWavPath, { force: true });
  }

  const preloadSrc = fs.readFileSync(path.join(projectRoot, 'src/preload/sandboxPreload.cjs'), 'utf-8');
  assert.ok(preloadSrc.includes('installP5ExportHooks'), 'sandboxPreload must install universal p5 export hooks');
  assert.ok(preloadSrc.includes('installP5SoundExportHooks'), 'sandboxPreload must hook p5.FFT / p5.Amplitude / p5.SoundFile');
  assert.ok(preloadSrc.includes('WebAudioOfflineFFT'), 'sandboxPreload must implement W3C Web Audio Blackman offline FFT');
  assert.ok(preloadSrc.includes("ipcRenderer.invoke('export:decodeAudio'"), 'sandboxPreload must decode export audio via IPC');

  const mainSrc = fs.readFileSync(path.join(projectRoot, 'src/main/index.js'), 'utf-8');
  assert.ok(mainSrc.includes("ipcMain.handle('export:decodeAudio'"), 'main/index.js must handle export:decodeAudio');
  assert.ok(mainSrc.includes('setAudioMuted(true)'), 'exportWindow must mute speaker output during offline export');

  const rendererSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/main.js'), 'utf-8');
  assert.ok(rendererSrc.includes("'mp3'"), 'Export audio selector must allow .mp3 files');
});

// ----------------------------------------------------
// 14. Test Full-Length Audio Muxing Without Premature Truncation
// ----------------------------------------------------
await asyncTest('14. Verify exported MP4 retains full-length audio stream without x264 lookahead truncation', async () => {
  const testWavPath = path.join(projectRoot, '.test_long_audio.wav');
  const testMp4Path = path.join(projectRoot, '.test_full_audio_render.mp4');
  const sr = 48000;
  const wavDurationSec = 15;
  const numSamples = sr * wavDurationSec;
  const wavBuf = Buffer.alloc(44 + numSamples * 2);
  wavBuf.write('RIFF', 0);
  wavBuf.writeUInt32LE(36 + numSamples * 2, 4);
  wavBuf.write('WAVE', 8);
  wavBuf.write('fmt ', 12);
  wavBuf.writeUInt32LE(16, 16);
  wavBuf.writeUInt16LE(1, 20);
  wavBuf.writeUInt16LE(1, 22);
  wavBuf.writeUInt32LE(sr, 24);
  wavBuf.writeUInt32LE(sr * 2, 28);
  wavBuf.writeUInt16LE(2, 32);
  wavBuf.writeUInt16LE(16, 34);
  wavBuf.write('data', 36);
  wavBuf.writeUInt32LE(numSamples * 2, 40);
  for (let i = 0; i < numSamples; i++) {
    wavBuf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 330 * i) / sr) * 12000), 44 + i * 2);
  }
  fs.writeFileSync(testWavPath, wavBuf);

  try {
    const probedWavDur = await getAudioDurationSec(testWavPath);
    assert.ok(probedWavDur >= 14.9 && probedWavDur <= 15.1, `Expected ~15s WAV duration, got ${probedWavDur}`);

    const exporter = new FfmpegExporter();
    exporter.startExport({
      width: 160,
      height: 120,
      fps: 60,
      totalFrames: 600, // 10.0 seconds (triggers x264 50-frame lookahead buffer)
      outputPath: testMp4Path,
      audioPath: testWavPath,
      profile: 'h264-master'
    });

    const frameBuf = Buffer.alloc(160 * 120 * 4, 90);
    for (let f = 0; f < 600; f++) {
      await exporter.pushFrame(frameBuf, true);
    }
    await exporter.finishExport();

    // Decode audio stream of the rendered MP4 to verify it was NOT truncated at ~2.94s
    const decodedMp4Audio = await decodeAudioFileToFloat32(testMp4Path, { sampleRate: 48000 });
    const actualAudioSec = decodedMp4Audio.numSamples / 48000;
    assert.ok(
      actualAudioSec >= 9.9,
      `Exported MP4 audio stream was truncated (${actualAudioSec.toFixed(2)}s instead of 10.00s)!`
    );
  } finally {
    fs.rmSync(testWavPath, { force: true });
    fs.rmSync(testMp4Path, { force: true });
  }
});

// ----------------------------------------------------
// 15. Test Collapsible Panels (Audio DSP Engine & OSC Monitor)
// ----------------------------------------------------
test('15. Verify Collapsible Audio DSP Engine and OSC Monitor Panels', () => {
  const htmlSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf-8');
  assert.ok(htmlSrc.includes('id="panel-audio"'), 'index.html must have panel-audio id');
  assert.ok(htmlSrc.includes('id="panel-osc"'), 'index.html must have panel-osc id');
  assert.ok(htmlSrc.includes('id="header-audio-panel"'), 'index.html must have header-audio-panel id');
  assert.ok(htmlSrc.includes('id="header-osc-panel"'), 'index.html must have header-osc-panel id');
  assert.ok(htmlSrc.includes('id="body-audio-panel"'), 'index.html must have body-audio-panel id');
  assert.ok(htmlSrc.includes('id="body-osc-panel"'), 'index.html must have body-osc-panel id');
  assert.ok(htmlSrc.includes('panel-header-collapsible'), 'index.html must have panel-header-collapsible class');
  assert.ok(htmlSrc.includes('panel-collapse-icon'), 'index.html must have panel-collapse-icon elements');

  // Verify internal DSP and OSC elements remain intact in the DOM
  assert.ok(htmlSrc.includes('id="canvas-fft"'), 'index.html must preserve canvas-fft');
  assert.ok(htmlSrc.includes('id="canvas-waveform"'), 'index.html must preserve canvas-waveform');
  assert.ok(htmlSrc.includes('id="rms-badge"'), 'index.html must preserve rms-badge');
  assert.ok(htmlSrc.includes('id="osc-rate-badge"'), 'index.html must preserve osc-rate-badge');
  assert.ok(htmlSrc.includes('id="osc-log"'), 'index.html must preserve osc-log');

  const mainJsSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/main.js'), 'utf-8');
  assert.ok(mainJsSrc.includes('initCollapsiblePanels'), 'main.js must implement and call initCollapsiblePanels');
  assert.ok(mainJsSrc.includes('p5_studio_audio_panel_collapsed'), 'main.js must persist p5_studio_audio_panel_collapsed');
  assert.ok(mainJsSrc.includes('p5_studio_osc_panel_collapsed'), 'main.js must persist p5_studio_osc_panel_collapsed');

  const styleSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/style.css'), 'utf-8');
  assert.ok(styleSrc.includes('.panel-header-collapsible'), 'style.css must style .panel-header-collapsible');
  assert.ok(styleSrc.includes('.panel-collapse-icon'), 'style.css must style .panel-collapse-icon');
  assert.ok(styleSrc.includes('.audio-panel.collapsed .panel-body'), 'style.css must hide audio body when collapsed');
  assert.ok(styleSrc.includes('.osc-panel.collapsed .panel-body'), 'style.css must hide osc body when collapsed');
  assert.ok(styleSrc.includes('.preview-panel'), 'style.css must define .preview-panel with flex expansion');
});

// ----------------------------------------------------
// 16. Test Clean Project Switching & File Tree Synchronization
// ----------------------------------------------------
test('16. Verify Clean Project Switching, File Tree Rebuilding and State Persistence', () => {
  const mainJsSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/main.js'), 'utf-8');
  assert.ok(mainJsSrc.includes('switchProject('), 'main.js must implement switchProject');
  assert.ok(mainJsSrc.includes('model.dispose()'), 'main.js must dispose old Monaco models when switching project');
  assert.ok(mainJsSrc.includes('this.openFiles.clear()'), 'main.js must clear openFiles map when switching project');
  assert.ok(mainJsSrc.includes('onProjectSwitched'), 'main.js must listen for onProjectSwitched');
  assert.ok(mainJsSrc.includes("key === 'o' || e.key === 'O'"), 'main.js must support Cmd+O / Ctrl+O for open project');

  const mainIndexSrc = fs.readFileSync(path.join(projectRoot, 'src/main/index.js'), 'utf-8');
  assert.ok(mainIndexSrc.includes('switchActiveProject('), 'main/index.js must implement switchActiveProject');
  assert.ok(mainIndexSrc.includes('saveLastProjectPath('), 'main/index.js must implement saveLastProjectPath');
  assert.ok(mainIndexSrc.includes('getSavedLastProjectPath()'), 'main/index.js must implement getSavedLastProjectPath');
  assert.ok(mainIndexSrc.includes("app.on('open-file'"), 'main/index.js must handle macOS open-file event');
  assert.ok(mainIndexSrc.includes("project:switched"), 'main/index.js must broadcast project:switched');

  const preloadCjsSrc = fs.readFileSync(path.join(projectRoot, 'src/preload/idePreload.cjs'), 'utf-8');
  assert.ok(preloadCjsSrc.includes('onProjectSwitched'), 'idePreload.cjs must expose onProjectSwitched');
});

// ----------------------------------------------------
// 17. Test New Project, Audio Input Gain / Device Selector & Complete p5 Releases
// ----------------------------------------------------
test('17. Verify New Project Boilerplate, Audio Input Gain Engine, and Latest p5.js 2.x/1.x Releases', () => {
  // 17.1 New Project IPC and Preload
  const mainIndexSrc = fs.readFileSync(path.join(projectRoot, 'src/main/index.js'), 'utf-8');
  assert.ok(mainIndexSrc.includes("'project:newProject'"), 'main/index.js must implement ipcMain.handle project:newProject');

  const preloadCjs = fs.readFileSync(path.join(projectRoot, 'src/preload/idePreload.cjs'), 'utf-8');
  assert.ok(preloadCjs.includes('newProject:'), 'idePreload.cjs must expose project.newProject');

  const preloadJs = fs.readFileSync(path.join(projectRoot, 'src/preload/idePreload.js'), 'utf-8');
  assert.ok(preloadJs.includes('newProject:'), 'idePreload.js must expose project.newProject');

  const htmlSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf-8');
  assert.ok(htmlSrc.includes('id="btn-new-project"'), 'index.html must include btn-new-project button');

  // 17.2 Audio Input Gain & CoreAudio Hardware Compatibility
  const sandboxRuntime = fs.readFileSync(path.join(projectRoot, 'src/main/sandboxRuntime.js'), 'utf-8');
  assert.ok(sandboxRuntime.includes('setGain('), 'sandboxRuntime.js must implement setGain method');
  assert.ok(sandboxRuntime.includes('setDevice('), 'sandboxRuntime.js must implement setDevice method');
  assert.ok(sandboxRuntime.includes("'audio:setGain'"), 'sandboxRuntime.js must listen for audio:setGain');
  assert.ok(sandboxRuntime.includes("'audio:setDevice'"), 'sandboxRuntime.js must listen for audio:setDevice');
  assert.ok(!sandboxRuntime.includes('sampleRate: 48000'), 'sandboxRuntime.js must not force rigid sampleRate 48000 to avoid iMac CoreAudio OverconstrainedError');

  const sandboxPreload = fs.readFileSync(path.join(projectRoot, 'src/preload/sandboxPreload.cjs'), 'utf-8');
  assert.ok(sandboxPreload.includes('setGain('), 'sandboxPreload.cjs must implement setGain method');
  assert.ok(sandboxPreload.includes('setDevice('), 'sandboxPreload.cjs must implement setDevice method');

  assert.ok(htmlSrc.includes('id="slider-audio-gain"'), 'index.html must include topbar slider-audio-gain');
  assert.ok(htmlSrc.includes('id="panel-slider-audio-gain"'), 'index.html must include panel-slider-audio-gain');
  assert.ok(htmlSrc.includes('id="input-vu-fill"'), 'index.html must include input-vu-fill meter');
  assert.ok(htmlSrc.includes('class="btn-gain-preset"'), 'index.html must include gain preset buttons');

  const mainJsSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/main.js'), 'utf-8');
  assert.ok(mainJsSrc.includes('initAudioGainControls'), 'main.js must implement initAudioGainControls');
  assert.ok(mainJsSrc.includes('sendAudioGainToPreview'), 'main.js must implement sendAudioGainToPreview');
  assert.ok(mainJsSrc.includes('sendAudioDeviceToPreview'), 'main.js must implement sendAudioDeviceToPreview');
  assert.ok(mainJsSrc.includes('p5_studio_audio_gain'), 'main.js must persist p5_studio_audio_gain in localStorage');
  assert.ok(mainJsSrc.includes('p5_studio_audio_device'), 'main.js must persist p5_studio_audio_device in localStorage');
  assert.ok(mainJsSrc.includes("key === 'n' || e.key === 'N'"), 'main.js must support Cmd+Shift+N / Ctrl+Shift+N for new project');

  // 17.3 Complete p5.js Version Support (2.3.4 down to 2.0.0 and 1.11.13)
  assert.ok(htmlSrc.includes('value="2.3.4"'), 'index.html must include 2.3.4 (Latest)');
  assert.ok(htmlSrc.includes('value="2.3.2"'), 'index.html must include 2.3.2');
  assert.ok(htmlSrc.includes('value="2.2.0"'), 'index.html must include 2.2.0');
  assert.ok(htmlSrc.includes('value="2.0.0"'), 'index.html must include 2.0.0');
  assert.ok(htmlSrc.includes('value="1.11.13"'), 'index.html must include 1.11.13 (Not Maintained)');
  assert.ok(htmlSrc.includes('value="1.11.12"'), 'index.html must include 1.11.12');

  const projectManagerSrc = fs.readFileSync(path.join(projectRoot, 'src/main/projectManager.js'), 'utf-8');
  assert.ok(projectManagerSrc.includes("version.startsWith('2.')"), 'projectManager.js must resolve p5 2.x versions from unpkg CDN');
});

// ----------------------------------------------------
// 18. Test macOS Microphone Hardware Entitlements & Continuous DSP Loop
// ----------------------------------------------------
test('18. Verify macOS Microphone TCC Description, Continuous DSP Loop and Live VU Meters', () => {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
  assert.ok(pkgJson.build.mac.extendInfo.NSMicrophoneUsageDescription, 'package.json must declare NSMicrophoneUsageDescription for macOS TCC');

  const mainIndexSrc = fs.readFileSync(path.join(projectRoot, 'src/main/index.js'), 'utf-8');
  assert.ok(mainIndexSrc.includes('setPermissionRequestHandler'), 'main/index.js must configure setPermissionRequestHandler for media');
  assert.ok(mainIndexSrc.includes('system:requestMicrophoneAccess'), 'main/index.js must implement system:requestMicrophoneAccess');

  const sandboxRuntime = fs.readFileSync(path.join(projectRoot, 'src/main/sandboxRuntime.js'), 'utf-8');
  assert.ok(sandboxRuntime.includes('_startLiveLoop('), 'sandboxRuntime.js must implement _startLiveLoop');
  assert.ok(sandboxRuntime.includes('this.silentGain'), 'sandboxRuntime.js must connect analyser to silent destination gain to pump CoreAudio buffers');

  const sandboxPreload = fs.readFileSync(path.join(projectRoot, 'src/preload/sandboxPreload.cjs'), 'utf-8');
  assert.ok(sandboxPreload.includes('_startLiveLoop('), 'sandboxPreload.cjs must implement _startLiveLoop');
  assert.ok(sandboxPreload.includes('this.silentGain'), 'sandboxPreload.cjs must connect analyser to silent destination gain');

  const htmlSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf-8');
  assert.ok(htmlSrc.includes('id="header-vu-fill"'), 'index.html must have header-vu-fill');
  assert.ok(htmlSrc.includes('id="header-vu-db"'), 'index.html must have header-vu-db');
  assert.ok(htmlSrc.includes('id="panel-vu-db"'), 'index.html must have panel-vu-db');
  assert.ok(htmlSrc.includes('id="btn-reconnect-audio"'), 'index.html must have btn-reconnect-audio');

  const styleSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/style.css'), 'utf-8');
  assert.ok(styleSrc.includes('.header-vu-track'), 'style.css must style .header-vu-track');
  assert.ok(styleSrc.includes('.header-vu-fill'), 'style.css must style .header-vu-fill');
  assert.ok(styleSrc.includes('.btn-mic-reconnect'), 'style.css must style .btn-mic-reconnect');
});

// ----------------------------------------------------
// 19. Test Anti-Cursor-Jump Watcher Guard & Integrated Debug Console
// ----------------------------------------------------
test('19. Verify Anti-Cursor-Jump Watcher Guard & Integrated Console Debug Panel', () => {
  const projectManagerSrc = fs.readFileSync(path.join(projectRoot, 'src/main/projectManager.js'), 'utf-8');
  assert.ok(projectManagerSrc.includes('recentInternalWrites'), 'projectManager.js must track recentInternalWrites to suppress self-save fs.watch echoes');

  const mainJsSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/main.js'), 'utf-8');
  assert.ok(mainJsSrc.includes('lastUserEditTime'), 'main.js must track lastUserEditTime to prevent external watcher resets during active typing');
  assert.ok(mainJsSrc.includes('pushEditOperations'), 'main.js must use pushEditOperations instead of destructive setValue on external file updates');
  assert.ok(mainJsSrc.includes('initConsoleControls'), 'main.js must implement initConsoleControls');
  assert.ok(mainJsSrc.includes('appendConsoleBatch'), 'main.js must implement appendConsoleBatch');
  assert.ok(mainJsSrc.includes('renderConsoleEntries'), 'main.js must implement renderConsoleEntries');

  const sandboxRuntime = fs.readFileSync(path.join(projectRoot, 'src/main/sandboxRuntime.js'), 'utf-8');
  assert.ok(sandboxRuntime.includes("'console:batch'"), 'sandboxRuntime.js must batch and post console:batch messages');
  assert.ok(sandboxRuntime.includes("'console:eval'"), 'sandboxRuntime.js must handle console:eval messages');

  const sandboxPreload = fs.readFileSync(path.join(projectRoot, 'src/preload/sandboxPreload.cjs'), 'utf-8');
  assert.ok(sandboxPreload.includes("'console:batch'"), 'sandboxPreload.cjs must batch and post console:batch messages');
  assert.ok(sandboxPreload.includes("'console:eval'"), 'sandboxPreload.cjs must handle console:eval messages');

  const htmlSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf-8');
  assert.ok(htmlSrc.includes('id="panel-console"'), 'index.html must include panel-console');
  assert.ok(htmlSrc.includes('id="console-log-list"'), 'index.html must include console-log-list');
  assert.ok(htmlSrc.includes('id="console-eval-input"'), 'index.html must include console-eval-input');
  assert.ok(htmlSrc.includes('id="btn-clear-console"'), 'index.html must include btn-clear-console');
});

// ----------------------------------------------------
// 20. Test p5.js 2.x + p5.sound Compatibility, MIME Types & Live HTTP Upgrade
// ----------------------------------------------------
await asyncTest('20. Verify p5.js 2.x + p5.sound@0.4.2 Auto-Resolution, Toggle & Font MIME Types', async () => {
  const tmpProjDir = path.join(projectRoot, '.test_p5v2_sound_proj');
  fs.rmSync(tmpProjDir, { recursive: true, force: true });
  fs.mkdirSync(tmpProjDir, { recursive: true });

  const initialHtml = `<!DOCTYPE html>
<html>
<head>
  <script src="https://unpkg.com/p5@2.3.4/lib/p5.min.js" crossorigin="anonymous"></script>
</head>
<body>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.11.2/addons/p5.sound.min.js" crossorigin="anonymous"></script>
  <script src="./sketch.js"></script>
</body>
</html>`;
  fs.writeFileSync(path.join(tmpProjDir, 'index.html'), initialHtml, 'utf-8');
  fs.writeFileSync(path.join(tmpProjDir, 'project.json'), JSON.stringify({ p5Version: '2.3.4', libraries: ['p5.sound'] }, null, 2), 'utf-8');
  fs.writeFileSync(path.join(tmpProjDir, 'sketch.js'), 'function setup() { createCanvas(100, 100); }', 'utf-8');
  fs.writeFileSync(path.join(tmpProjDir, 'st.ttf'), Buffer.from([0x00, 0x01, 0x00, 0x00]));

  const pm = new ProjectManager(tmpProjDir);
  await pm.startServer(0);

  try {
    // 1. Live HTTP serve auto-upgrades legacy p5.sound 1.x when p5 2.x is loaded
    const baseUrl = pm.getServerUrl();
    const htmlRes = await fetch(`${baseUrl}/index.html`);
    assert.strictEqual(htmlRes.status, 200);
    const servedHtml = await htmlRes.text();
    assert.ok(servedHtml.includes(P5_SOUND_V2_CDN_URL), 'Served HTML must auto-upgrade legacy p5.sound 1.x to p5.sound@0.4.2 for p5 2.x');
    assert.ok(!servedHtml.includes('1.11.2/addons/p5.sound.min.js'), 'Served HTML must not contain incompatible p5.sound 1.x alongside p5 2.x');

    // 2. Font .ttf MIME type check
    const fontRes = await fetch(`${baseUrl}/st.ttf`);
    assert.strictEqual(fontRes.status, 200);
    assert.strictEqual(fontRes.headers.get('content-type'), 'font/ttf', 'Project HTTP server must serve .ttf with font/ttf Content-Type');

    // 3. setP5Version switches p5.sound back and forth cleanly
    pm.setP5Version('1.11.2');
    const htmlV1 = fs.readFileSync(path.join(tmpProjDir, 'index.html'), 'utf-8');
    assert.ok(htmlV1.includes('1.11.2/addons/p5.sound.min.js'), 'setP5Version(1.11.2) must switch p5.sound to 1.11.2 addon');

    pm.setP5Version('2.3.4');
    const htmlV2 = fs.readFileSync(path.join(tmpProjDir, 'index.html'), 'utf-8');
    assert.ok(htmlV2.includes(P5_SOUND_V2_CDN_URL), 'setP5Version(2.3.4) must switch p5.sound to p5.sound@0.4.2');

    // 4. toggleP5Library disables and re-enables with the compatible v2 URL
    const libsDetected = pm.getP5Libraries();
    assert.ok(libsDetected.enabledLibraries.includes('p5.sound'), 'getP5Libraries must detect active p5.sound v2');

    pm.toggleP5Library('p5.sound', false);
    const htmlRemoved = fs.readFileSync(path.join(tmpProjDir, 'index.html'), 'utf-8');
    assert.ok(!htmlRemoved.includes('p5.sound'), 'toggleP5Library(p5.sound, false) must cleanly remove p5.sound script tag even with crossorigin');

    pm.toggleP5Library('p5.sound', true);
    const htmlReAdded = fs.readFileSync(path.join(tmpProjDir, 'index.html'), 'utf-8');
    assert.ok(htmlReAdded.includes(P5_SOUND_V2_CDN_URL), 'toggleP5Library(p5.sound, true) under p5 2.3.4 must inject p5.sound@0.4.2');
  } finally {
    pm.stopServer();
    fs.rmSync(tmpProjDir, { recursive: true, force: true });
  }
});

// ----------------------------------------------------
// 21. Test Editable Frequency Band Ranges & Floating AI Chatbot Browser (Always On Top)
// ----------------------------------------------------
test('21. Verify Configurable Audio Frequency Band Ranges & Floating AI Chatbot Browser', () => {
  // 21.1 Frequency Band Ranges
  const sandboxRuntime = fs.readFileSync(path.join(projectRoot, 'src/main/sandboxRuntime.js'), 'utf-8');
  assert.ok(sandboxRuntime.includes('setBandRanges('), 'sandboxRuntime.js must implement setBandRanges');
  assert.ok(sandboxRuntime.includes("'audio:setBandRanges'"), 'sandboxRuntime.js must listen for audio:setBandRanges');

  const sandboxPreload = fs.readFileSync(path.join(projectRoot, 'src/preload/sandboxPreload.cjs'), 'utf-8');
  assert.ok(sandboxPreload.includes('setBandRanges('), 'sandboxPreload.cjs must implement setBandRanges');
  assert.ok(sandboxPreload.includes("'audio:setBandRanges'"), 'sandboxPreload.cjs must listen for audio:setBandRanges');

  const htmlSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf-8');
  assert.ok(htmlSrc.includes('id="btn-toggle-freq-ranges"'), 'index.html must include btn-toggle-freq-ranges');
  assert.ok(htmlSrc.includes('id="freq-sub-min"'), 'index.html must include freq-sub-min input');
  assert.ok(htmlSrc.includes('id="freq-treble-max"'), 'index.html must include freq-treble-max input');
  assert.ok(htmlSrc.includes('id="select-freq-preset"'), 'index.html must include select-freq-preset');
  assert.ok(htmlSrc.includes('id="btn-open-chatbot"'), 'index.html must include btn-open-chatbot');

  const mainJsSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/main.js'), 'utf-8');
  assert.ok(mainJsSrc.includes('initAudioBandRangesControls'), 'main.js must implement initAudioBandRangesControls');
  assert.ok(mainJsSrc.includes('sendAudioBandRangesToPreview'), 'main.js must implement sendAudioBandRangesToPreview');
  assert.ok(mainJsSrc.includes('p5_studio_audio_band_ranges'), 'main.js must persist p5_studio_audio_band_ranges');
  assert.ok(mainJsSrc.includes('initChatbotBrowserControls'), 'main.js must implement initChatbotBrowserControls');
  assert.ok(mainJsSrc.includes('__ideApplyChatbotCode'), 'main.js must expose __ideApplyChatbotCode');

  // 21.2 Floating AI Chatbot Browser & Always On Top
  const mainIndexSrc = fs.readFileSync(path.join(projectRoot, 'src/main/index.js'), 'utf-8');
  assert.ok(mainIndexSrc.includes('openChatbotWindow'), 'main/index.js must implement openChatbotWindow');
  assert.ok(mainIndexSrc.includes("'chatbot:toggleAlwaysOnTop'"), 'main/index.js must handle chatbot:toggleAlwaysOnTop');
  assert.ok(mainIndexSrc.includes("'chatbot:applyCode'"), 'main/index.js must handle chatbot:applyCode');
  assert.ok(mainIndexSrc.includes("'audio:setBandRanges'"), 'main/index.js must handle audio:setBandRanges');

  const chatbotPreloadPath = path.join(projectRoot, 'src/preload/chatbotPreload.cjs');
  assert.ok(fs.existsSync(chatbotPreloadPath), 'chatbotPreload.cjs must exist');
  const chatbotHtmlPath = path.join(projectRoot, 'src/main/chatbotBrowser.html');
  assert.ok(fs.existsSync(chatbotHtmlPath), 'chatbotBrowser.html must exist');
  const chatbotHtml = fs.readFileSync(chatbotHtmlPath, 'utf-8');
  assert.ok(chatbotHtml.includes('btn-always-on-top'), 'chatbotBrowser.html must include btn-always-on-top toggle');
  assert.ok(chatbotHtml.includes('<webview'), 'chatbotBrowser.html must embed Chromium webview for external chatbots');
  assert.ok(chatbotHtml.includes('btn-extract-apply'), 'chatbotBrowser.html must include btn-extract-apply');
  assert.ok(chatbotHtml.includes('btn-copy-code'), 'chatbotBrowser.html must include btn-copy-code');

  const idePreloadCjs = fs.readFileSync(path.join(projectRoot, 'src/preload/idePreload.cjs'), 'utf-8');
  assert.ok(idePreloadCjs.includes('chatbot:'), 'idePreload.cjs must expose chatbot API');
  assert.ok(idePreloadCjs.includes('setBandRanges:'), 'idePreload.cjs must expose audio.setBandRanges');
});

// ----------------------------------------------------
// 22. Test Monaco Editor Full Contribs (Find & Find/Replace Widget + Actions + Hotkeys)
// ----------------------------------------------------
test('22. Verify Monaco Editor Find & Find/Replace Support (edcore.main + UI Buttons + Hotkeys)', () => {
  const mainJsSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/main.js'), 'utf-8');
  assert.ok(mainJsSrc.includes("monaco-editor/esm/vs/editor/edcore.main"), 'main.js must import monaco edcore.main so Find/Replace controller, multi-cursor, folding, and comments are bundled');
  assert.ok(mainJsSrc.includes('triggerEditorFind'), 'main.js must implement triggerEditorFind');
  assert.ok(mainJsSrc.includes('triggerEditorReplace'), 'main.js must implement triggerEditorReplace');
  assert.ok(mainJsSrc.includes("getAction('actions.find')"), 'main.js must invoke Monaco actions.find');
  assert.ok(mainJsSrc.includes("getAction('editor.action.startFindReplaceAction')"), 'main.js must invoke Monaco editor.action.startFindReplaceAction');

  const htmlSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf-8');
  assert.ok(htmlSrc.includes('id="btn-editor-find"'), 'index.html must include btn-editor-find button');
  assert.ok(htmlSrc.includes('id="btn-editor-replace"'), 'index.html must include btn-editor-replace button');
});

// ----------------------------------------------------
// 23. Test Flush-Save Guarantee, Fullscreen Stability & Isolated Performance Recording / Replay Hooks
// ----------------------------------------------------
await asyncTest('23. Verify Atomic Flush-Save, Cache-Busting, Fullscreen Fix & Performance Hook Replay', async () => {
  // 23.1 Flush-Save & Cache-Busting
  const mainJsSrc = fs.readFileSync(path.join(projectRoot, 'src/renderer/main.js'), 'utf-8');
  assert.ok(mainJsSrc.includes('async flushPendingSave()'), 'main.js must implement flushPendingSave()');
  assert.ok(mainJsSrc.includes('this.dirtyFiles'), 'main.js must track dirtyFiles per model');
  assert.ok(mainJsSrc.includes('toggleInlinePreviewFullscreen'), 'main.js must implement toggleInlinePreviewFullscreen');

  const projMgrSrc = fs.readFileSync(path.join(projectRoot, 'src/main/projectManager.js'), 'utf-8');
  assert.ok(projMgrSrc.includes('?v=${cbVersion}'), 'projectManager.js must cache-bust local relative scripts/styles on HTML serve');

  // 23.2 Fullscreen & WebGL Shader Guard in All Modes
  const mainIndexSrc = fs.readFileSync(path.join(projectRoot, 'src/main/index.js'), 'utf-8');
  assert.ok(mainIndexSrc.includes('disable-renderer-backgrounding'), 'main/index.js must use app commandLine switch instead of per-window backgroundThrottling:false that freezes macOS simpleFullScreen');
  assert.ok(mainIndexSrc.includes("'performance:start'"), 'main/index.js must handle performance:start IPC');
  assert.ok(mainIndexSrc.includes("'performance:readStream'"), 'main/index.js must handle performance:readStream IPC');

  const sandboxPreloadSrc = fs.readFileSync(path.join(projectRoot, 'src/preload/sandboxPreload.cjs'), 'utf-8');
  assert.ok(sandboxPreloadSrc.includes('(!s._vertSrc || !s._fragSrc) && !s._glProgram'), 'sandboxPreload.cjs must guard shader() when either vertSrc OR fragSrc is still loading');
  assert.ok(sandboxPreloadSrc.includes('IdePerformanceReplayEngine'), 'sandboxPreload.cjs must implement isolated IdePerformanceReplayEngine');

  // 23.3 Isolated PerformanceManager Round-Trip Test
  const tmpProj = path.join(projectRoot, '.test_perf_proj');
  fs.rmSync(tmpProj, { recursive: true, force: true });
  fs.mkdirSync(tmpProj, { recursive: true });
  const pm = new ProjectManager(tmpProj);
  const perfMgr = new PerformanceManager(pm);

  try {
    const startRes = perfMgr.startSession({ takeName: 'unit_perf', meta: { fps: 60 } });
    assert.strictEqual(startRes.status, 'recording');

    perfMgr.appendChunk({
      frames: [
        { tMs: 0, frame: 0, mouseX: 100, mouseY: 150, nMouseX: 0.25, nMouseY: 0.5, mouseIsPressed: false, rms: 0.12 },
        { tMs: 16.67, frame: 1, mouseX: 200, mouseY: 250, nMouseX: 0.5, nMouseY: 0.75, mouseIsPressed: true, rms: 0.45 }
      ],
      events: [
        { tMs: 10, type: 'mousePressed', button: 'left' },
        { tMs: 15, type: 'keyPressed', key: 'a', keyCode: 65 }
      ]
    });

    const stopRes = perfMgr.stopSession({ durationSec: 1.5 });
    assert.strictEqual(stopRes.status, 'saved');
    assert.strictEqual(stopRes.frameCount, 2);
    assert.strictEqual(stopRes.eventCount, 2);
    assert.ok(fs.existsSync(stopRes.streamPath), 'perf_stream.json must be written to disk');

    const loaded = await perfMgr.readStreamFile(stopRes.streamPath);
    assert.strictEqual(loaded.type, 'p5-studio-performance-stream');
    assert.strictEqual(loaded.frames.length, 2);
    assert.strictEqual(loaded.events[1].key, 'a');
  } finally {
    fs.rmSync(tmpProj, { recursive: true, force: true });
  }
});

// ----------------------------------------------------
// Summary
// ----------------------------------------------------
setTimeout(() => {
  console.log('\n====================================================');
  console.log(`Results: ${passedTests} / ${totalTests} tests passed`);
  console.log('====================================================');
  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}, 100);
