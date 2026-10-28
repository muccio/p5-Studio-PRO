import assert from 'assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { ProjectManager } from '../src/main/projectManager.js';
import { OscBridge } from '../src/main/oscBridge.js';
import { FfmpegExporter, EXPORT_PROFILES } from '../src/main/ffmpegExporter.js';

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
