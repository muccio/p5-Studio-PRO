import { app, BrowserWindow, ipcMain, dialog, screen, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { ProjectManager } from './projectManager.js';
import { OscBridge } from './oscBridge.js';
import { FfmpegExporter } from './ffmpegExporter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =========================================================================
// A. Force Cross-Platform Pixel-Perfect Parity for 2D & WebGL (macOS & Windows)
// =========================================================================
app.commandLine.appendSwitch('force-color-profile', 'srgb');
app.commandLine.appendSwitch('disable-lcd-text');
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('allow-file-access-from-files');

let mainWindow = null;
let exportWindow = null;
let liveWindow = null;
let previewWindow = null;
let projectManager = null;
let oscBridge = null;
let ffmpegExporter = null;

function getProdPath() {
  const candidates = [
    path.join(__dirname, '../../dist/renderer/index.html'),
    path.join(app.getAppPath(), 'dist/renderer/index.html'),
    path.join(process.resourcesPath || '', 'app.asar/dist/renderer/index.html')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function resolveDefaultSketchPath() {
  const candidateTemplateDirs = [
    path.join(process.resourcesPath || '', 'app.asar.unpacked/templates/default-sketch'),
    path.resolve(__dirname, '../../templates/default-sketch'),
    path.resolve(app.getAppPath(), 'templates/default-sketch'),
    path.join(process.resourcesPath || '', 'templates/default-sketch'),
    path.resolve(__dirname, '../../../templates/default-sketch')
  ];

  let templateDir = null;
  for (const c of candidateTemplateDirs) {
    if (c && fs.existsSync(c) && fs.existsSync(path.join(c, 'sketch.js'))) {
      templateDir = c;
      break;
    }
  }

  // When packaged, copy default sketch to userData so it is writable and persistent
  if (app.isPackaged || (templateDir && templateDir.includes('app.asar'))) {
    const userSketchDir = path.join(app.getPath('userData'), 'projects/default-sketch');
    const sketchFile = path.join(userSketchDir, 'sketch.js');

    // Check if userData already has a populated default sketch
    const isPopulated = fs.existsSync(userSketchDir) && fs.existsSync(sketchFile);
    if (!isPopulated && templateDir) {
      try {
        fs.mkdirSync(userSketchDir, { recursive: true });
        fs.cpSync(templateDir, userSketchDir, { recursive: true });
        console.log(`[Main] Copied default sketch from ${templateDir} to ${userSketchDir}`);
      } catch (e) {
        console.warn('[Main] Could not copy default sketch to userData:', e);
      }
    }

    if (fs.existsSync(sketchFile)) {
      return userSketchDir;
    }
  }

  return templateDir || path.resolve(__dirname, '../../templates/default-sketch');
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    backgroundColor: '#0d0f12',
    title: 'p5-Studio-PRO',
    frame: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/idePreload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      webSecurity: false,
      allowRunningInsecureContent: true,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Toggle DevTools with F12 or Cmd+Option+I (macOS) / Ctrl+Shift+I (Windows)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i') || (input.meta && input.alt && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Main] MainWindow failed to load: ${errorDescription} (${errorCode}) at ${validatedURL}`);
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error(`[Main] Render process gone:`, details);
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer ${level}] ${message} (${sourceId}:${line})`);
  });

  // Load from Vite dev server if in development, otherwise load production build
  const devServerUrl = (!app.isPackaged && process.env.NODE_ENV !== 'production')
    ? (process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173')
    : null;

  if (devServerUrl) {
    try {
      await mainWindow.loadURL(devServerUrl);
    } catch (e) {
      console.log('[Main] Dev server not up yet or connecting to dist fallback:', e.message);
      const prodPath = getProdPath();
      if (fs.existsSync(prodPath)) {
        await mainWindow.loadFile(prodPath);
      } else {
        await mainWindow.loadURL(devServerUrl);
      }
    }
  } else {
    const prodPath = getProdPath();
    await mainWindow.loadFile(prodPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (liveWindow && !liveWindow.isDestroyed()) liveWindow.close();
    if (previewWindow && !previewWindow.isDestroyed()) previewWindow.close();
  });
}

// =========================================================================
// Multi-Display & External Window Management (Live Stage & Popout Preview)
// =========================================================================

function getDisplays() {
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  return displays.map((d, idx) => ({
    id: d.id,
    index: idx,
    label: `${d.id === primaryId ? '★ ' : ''}Display ${idx + 1} (${d.bounds.width}x${d.bounds.height})`,
    bounds: d.bounds,
    isPrimary: d.id === primaryId
  }));
}

/**
 * Open or focus the dedicated external Live Stage output window
 */
async function openLiveWindow(options = {}) {
  if (liveWindow && !liveWindow.isDestroyed()) {
    if (options.displayId !== undefined && options.displayId !== null) {
      moveLiveWindowToDisplay(options.displayId, options.fullscreen);
    }
    liveWindow.focus();
    notifyLiveStatus();
    return getLiveWindowStatus();
  }

  let bounds = null;
  const displays = screen.getAllDisplays();
  if (options.displayId !== undefined && options.displayId !== null && options.displayId !== 'auto') {
    const d = displays.find(disp => String(disp.id) === String(options.displayId));
    if (d) bounds = d.bounds;
  } else if (displays.length > 1) {
    // Automatically select secondary display for live stage projection if available!
    const secondary = displays.find(d => d.id !== screen.getPrimaryDisplay().id);
    if (secondary) bounds = secondary.bounds;
  }

  liveWindow = new BrowserWindow({
    title: 'p5-Studio-PRO - Live Stage Output',
    width: bounds ? bounds.width : 1280,
    height: bounds ? bounds.height : 720,
    x: bounds ? bounds.x : undefined,
    y: bounds ? bounds.y : undefined,
    fullscreen: !!options.fullscreen,
    simpleFullScreen: process.platform === 'darwin',
    fullscreenable: true,
    alwaysOnTop: !!options.alwaysOnTop,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/sandboxPreload.cjs'),
      contextIsolation: false,
      nodeIntegration: false,
      backgroundThrottling: false, // Critical: uninterrupted 60 FPS while typing in IDE!
      webSecurity: false
    }
  });

  liveWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[LiveWin ${level}] ${message} (${sourceId}:${line})`);
  });

  const liveUrl = `${projectManager.getServerUrl()}/index.html?live=true&t=${Date.now()}`;
  await liveWindow.loadURL(liveUrl);
  liveWindow.show();

  liveWindow.on('enter-full-screen', () => {
    liveWindow.setMenuBarVisibility(false);
    notifyLiveStatus();
  });
  liveWindow.on('leave-full-screen', () => notifyLiveStatus());
  liveWindow.on('always-on-top-changed', () => notifyLiveStatus());

  liveWindow.on('closed', () => {
    liveWindow = null;
    notifyLiveStatus();
  });

  notifyLiveStatus();
  return getLiveWindowStatus();
}

function closeLiveWindow() {
  if (liveWindow && !liveWindow.isDestroyed()) {
    liveWindow.close();
    liveWindow = null;
    notifyLiveStatus();
  }
  return { isOpen: false, isFullscreen: false, isAlwaysOnTop: false };
}

function toggleLiveWindow(options = {}) {
  if (liveWindow && !liveWindow.isDestroyed()) {
    return closeLiveWindow();
  } else {
    return openLiveWindow(options);
  }
}

function moveLiveWindowToDisplay(displayId, fullscreen = false) {
  if (!liveWindow || liveWindow.isDestroyed()) return;
  const displays = screen.getAllDisplays();
  const d = displays.find(disp => String(disp.id) === String(displayId));
  if (d) {
    if (liveWindow.isFullScreen() || (process.platform === 'darwin' && liveWindow.isSimpleFullScreen())) {
      exitLiveFullscreen();
    }
    liveWindow.setBounds(d.bounds);
    if (fullscreen) {
      if (process.platform === 'darwin') {
        liveWindow.setSimpleFullScreen(true);
      } else {
        liveWindow.setFullScreen(true);
      }
    }
    notifyLiveStatus();
  }
}

function toggleLiveFullscreen() {
  if (liveWindow && !liveWindow.isDestroyed()) {
    const isFs = process.platform === 'darwin' ? liveWindow.isSimpleFullScreen() : liveWindow.isFullScreen();
    const nextState = !isFs;
    if (process.platform === 'darwin') {
      liveWindow.setSimpleFullScreen(nextState);
    } else {
      liveWindow.setFullScreen(nextState);
    }
    liveWindow.setMenuBarVisibility(!nextState);
    notifyLiveStatus();
    return nextState;
  }
  return false;
}

function exitLiveFullscreen() {
  if (liveWindow && !liveWindow.isDestroyed()) {
    if (process.platform === 'darwin') {
      liveWindow.setSimpleFullScreen(false);
    } else {
      liveWindow.setFullScreen(false);
    }
    notifyLiveStatus();
    return false;
  }
  return false;
}

function toggleLiveAlwaysOnTop() {
  if (liveWindow && !liveWindow.isDestroyed()) {
    const nextState = !liveWindow.isAlwaysOnTop();
    liveWindow.setAlwaysOnTop(nextState);
    notifyLiveStatus();
    return nextState;
  }
  return false;
}

function getLiveWindowStatus() {
  const isOpen = !!liveWindow && !liveWindow.isDestroyed();
  const isFullscreen = isOpen
    ? (process.platform === 'darwin' ? liveWindow.isSimpleFullScreen() : liveWindow.isFullScreen())
    : false;
  return {
    isOpen,
    isFullscreen,
    isAlwaysOnTop: isOpen ? liveWindow.isAlwaysOnTop() : false
  };
}

function notifyLiveStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('live:statusChanged', getLiveWindowStatus());
  }
}

/**
 * Open or focus the separate / popout Preview Sandbox window
 */
async function openPreviewWindow() {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.focus();
    notifyPreviewStatus();
    return getPreviewWindowStatus();
  }

  previewWindow = new BrowserWindow({
    title: 'p5-Studio-PRO - Preview Sandbox',
    width: 960,
    height: 600,
    minWidth: 400,
    minHeight: 300,
    backgroundColor: '#0a0d14',
    autoHideMenuBar: true,
    simpleFullScreen: process.platform === 'darwin',
    fullscreenable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/sandboxPreload.cjs'),
      contextIsolation: false,
      nodeIntegration: false,
      backgroundThrottling: false,
      webSecurity: false
    }
  });

  previewWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[PreviewWin ${level}] ${message} (${sourceId}:${line})`);
  });

  const previewUrl = `${projectManager.getServerUrl()}/index.html?popout=true&t=${Date.now()}`;
  await previewWindow.loadURL(previewUrl);
  previewWindow.show();

  previewWindow.on('enter-full-screen', () => {
    previewWindow.setMenuBarVisibility(false);
    notifyPreviewStatus();
  });
  previewWindow.on('leave-full-screen', () => notifyPreviewStatus());

  previewWindow.on('closed', () => {
    previewWindow = null;
    notifyPreviewStatus();
  });

  notifyPreviewStatus();
  return getPreviewWindowStatus();
}

function togglePreviewFullscreen() {
  if (previewWindow && !previewWindow.isDestroyed()) {
    const isFs = process.platform === 'darwin' ? previewWindow.isSimpleFullScreen() : previewWindow.isFullScreen();
    const nextState = !isFs;
    if (process.platform === 'darwin') {
      previewWindow.setSimpleFullScreen(nextState);
    } else {
      previewWindow.setFullScreen(nextState);
    }
    previewWindow.setMenuBarVisibility(!nextState);
    notifyPreviewStatus();
    return nextState;
  }
  return false;
}

function exitPreviewFullscreen() {
  if (previewWindow && !previewWindow.isDestroyed()) {
    if (process.platform === 'darwin') {
      previewWindow.setSimpleFullScreen(false);
    } else {
      previewWindow.setFullScreen(false);
    }
    notifyPreviewStatus();
    return false;
  }
  return false;
}

function closePreviewWindow() {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.close();
    previewWindow = null;
    notifyPreviewStatus();
  }
  return { isOpen: false };
}

function togglePreviewWindow() {
  if (previewWindow && !previewWindow.isDestroyed()) {
    return closePreviewWindow();
  } else {
    return openPreviewWindow();
  }
}

function getPreviewWindowStatus() {
  return {
    isOpen: !!previewWindow && !previewWindow.isDestroyed()
  };
}

function notifyPreviewStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('preview:statusChanged', getPreviewWindowStatus());
  }
}

/**
 * Setup All IPC handlers between Renderer UI, Main Process, and Sandbox
 */
function setupIPC() {
  // --- Window Controls ---
  ipcMain.handle('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });
  ipcMain.handle('window:maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    }
  });
  ipcMain.handle('window:close', () => {
    if (mainWindow) mainWindow.close();
  });

  // --- Project Management ---
  ipcMain.handle('project:getInfo', () => {
    return {
      projectPath: projectManager.getProjectPath(),
      serverUrl: projectManager.getServerUrl()
    };
  });

  ipcMain.handle('project:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open p5.js / GLSL Project Folder',
      properties: ['openDirectory', 'createDirectory']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const selected = result.filePaths[0];
      await projectManager.setProjectPath(selected);
      return {
        projectPath: projectManager.getProjectPath(),
        serverUrl: projectManager.getServerUrl(),
        files: projectManager.listFiles()
      };
    }
    return null;
  });

  ipcMain.handle('project:listFiles', () => {
    return projectManager.listFiles();
  });

  ipcMain.handle('project:readFile', (event, relativePath) => {
    return projectManager.readFile(relativePath);
  });

  ipcMain.handle('project:writeFile', (event, { relativePath, content }) => {
    return projectManager.writeFile(relativePath, content);
  });

  ipcMain.handle('project:createItem', (event, { relativePath, type }) => {
    return projectManager.createItem(relativePath, type);
  });

  ipcMain.handle('project:deleteItem', (event, relativePath) => {
    return projectManager.deleteItem(relativePath);
  });

  ipcMain.handle('project:renameItem', (event, { oldPath, newPath }) => {
    return projectManager.renameItem(oldPath, newPath);
  });

  ipcMain.handle('project:loadShader', (event, { filePath }) => {
    return projectManager.preprocessShader(filePath);
  });

  ipcMain.handle('project:mapCompilerErrors', (event, { infoLog, sourceTable }) => {
    return projectManager.mapCompilerErrors(infoLog, sourceTable);
  });

  ipcMain.handle('project:getP5Version', () => {
    return projectManager.getP5Version();
  });

  ipcMain.handle('project:setP5Version', (event, version) => {
    return projectManager.setP5Version(version);
  });

  ipcMain.handle('project:getP5Libraries', () => {
    return projectManager.getP5Libraries();
  });

  ipcMain.handle('project:toggleP5Library', (event, { libId, enabled }) => {
    return projectManager.toggleP5Library(libId, enabled);
  });

  // --- System External Browser IPC ---
  ipcMain.handle('system:openExternal', async (event, url) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
      await shell.openExternal(url);
      return true;
    }
    return false;
  });

  // --- OSC Bridge ---
  ipcMain.handle('osc:getStatus', () => {
    return oscBridge.getStatus();
  });

  ipcMain.handle('osc:updateConfig', async (event, config) => {
    return await oscBridge.updateConfig(config);
  });

  ipcMain.handle('osc:send', (event, { address, args }) => {
    return oscBridge.send(address, ...(args || []));
  });

  ipcMain.handle('osc:startRecordTake', (event, { takeName }) => {
    const takesDir = path.join(projectManager.getProjectPath(), '.takes');
    const folder = takeName || `take_${Date.now()}`;
    const targetDir = path.join(takesDir, folder);
    oscBridge.startRecording(targetDir);
    return { status: 'recording', takeDir: targetDir };
  });

  ipcMain.handle('osc:stopRecordTake', () => {
    return oscBridge.stopRecording();
  });

  // Forward incoming OSC messages to renderer, export, live stage, and preview
  oscBridge.onMessage((msg) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('osc:message', msg);
    }
    if (exportWindow && !exportWindow.isDestroyed()) {
      exportWindow.webContents.send('osc:message', msg);
    }
    if (liveWindow && !liveWindow.isDestroyed()) {
      liveWindow.webContents.send('osc:message', msg);
    }
    if (previewWindow && !previewWindow.isDestroyed()) {
      previewWindow.webContents.send('osc:message', msg);
    }
  });

  // --- Audio Take Saving ---
  ipcMain.handle('audio:saveTakeWav', async (event, { takeDir, channelData, sampleRate }) => {
    try {
      if (!fs.existsSync(takeDir)) {
        fs.mkdirSync(takeDir, { recursive: true });
      }
      const wavPath = path.join(takeDir, 'take_audio.wav');

      // Encode 32-bit Float PCM to WAV file Buffer
      const numChannels = channelData.length;
      const numSamples = channelData[0].length;
      const bytesPerSample = 4; // 32-bit float
      const blockAlign = numChannels * bytesPerSample;
      const byteRate = sampleRate * blockAlign;
      const dataSize = numSamples * blockAlign;
      const buffer = Buffer.alloc(44 + dataSize);

      // RIFF header
      buffer.write('RIFF', 0);
      buffer.writeUInt32LE(36 + dataSize, 4);
      buffer.write('WAVE', 8);

      // fmt subchunk (3 = IEEE Float)
      buffer.write('fmt ', 12);
      buffer.writeUInt32LE(16, 16); // Subchunk1Size
      buffer.writeUInt16LE(3, 20);  // AudioFormat 3 = IEEE float
      buffer.writeUInt16LE(numChannels, 22);
      buffer.writeUInt32LE(sampleRate, 24);
      buffer.writeUInt32LE(byteRate, 28);
      buffer.writeUInt16LE(blockAlign, 32);
      buffer.writeUInt16LE(32, 34); // BitsPerSample

      // data subchunk
      buffer.write('data', 36);
      buffer.writeUInt32LE(dataSize, 40);

      // Interleave samples
      let offset = 44;
      for (let i = 0; i < numSamples; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
          const sample = channelData[ch][i];
          buffer.writeFloatLE(sample, offset);
          offset += 4;
        }
      }

      fs.writeFileSync(wavPath, buffer);
      console.log(`[Audio] Saved 32-bit Float WAV to ${wavPath} (${numSamples} samples)`);
      return { success: true, path: wavPath };
    } catch (err) {
      console.error('[Audio] Error saving WAV:', err);
      throw err;
    }
  });

  // --- Video Exporter ---
  ipcMain.handle('dialog:showSaveDialog', async (event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, options);
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle('dialog:showOpenDialog', async (event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, options);
    return (result.canceled || result.filePaths.length === 0) ? null : result.filePaths[0];
  });

  ipcMain.handle('export:start', async (event, options) => {
    return await startDeterministicExport(options);
  });

  ipcMain.handle('export:cancel', () => {
    if (ffmpegExporter) {
      ffmpegExporter.cancelExport();
    }
    if (exportWindow && !exportWindow.isDestroyed()) {
      exportWindow.destroy();
      exportWindow = null;
    }
    return { status: 'cancelled' };
  });

  // IPC from export sandbox window to push frame pixels
  ipcMain.handle('export:pushFrame', async (event, rawPixelArray) => {
    if (!ffmpegExporter || !ffmpegExporter.isExporting) {
      throw new Error('Export not active');
    }
    const buffer = Buffer.from(rawPixelArray);
    return await ffmpegExporter.pushFrame(buffer, true); // true = already flipped vertically
  });

  ipcMain.handle('export:finish', async () => {
    if (ffmpegExporter) {
      return await ffmpegExporter.finishExport();
    }
  });

  // --- Live Stage Output Window IPC ---
  ipcMain.handle('live:open', (event, options) => openLiveWindow(options));
  ipcMain.handle('live:close', () => closeLiveWindow());
  ipcMain.handle('live:toggle', (event, options) => toggleLiveWindow(options));
  ipcMain.handle('live:getStatus', () => getLiveWindowStatus());
  ipcMain.handle('live:getDisplays', () => getDisplays());
  ipcMain.handle('live:moveToDisplay', (event, { displayId, fullscreen }) => moveLiveWindowToDisplay(displayId, fullscreen));
  ipcMain.handle('live:toggleFullscreen', () => toggleLiveFullscreen());
  ipcMain.handle('live:exitFullscreen', () => exitLiveFullscreen());
  ipcMain.handle('live:toggleAlwaysOnTop', () => toggleLiveAlwaysOnTop());
  ipcMain.handle('live:pushStage', () => {
    if (liveWindow && !liveWindow.isDestroyed()) {
      liveWindow.webContents.send('shader:hotReload');
      liveWindow.webContents.reload();
      return true;
    }
    return false;
  });
  ipcMain.handle('live:reload', () => {
    if (liveWindow && !liveWindow.isDestroyed()) {
      liveWindow.webContents.reload();
      return true;
    }
    return false;
  });
  ipcMain.handle('live:notifyShaderHotReload', () => {
    if (liveWindow && !liveWindow.isDestroyed()) {
      liveWindow.webContents.send('shader:hotReload');
      return true;
    }
    return false;
  });

  // --- Separate / Popout Preview Window IPC ---
  ipcMain.handle('preview:open', () => openPreviewWindow());
  ipcMain.handle('preview:close', () => closePreviewWindow());
  ipcMain.handle('preview:toggle', () => togglePreviewWindow());
  ipcMain.handle('preview:toggleFullscreen', () => togglePreviewFullscreen());
  ipcMain.handle('preview:exitFullscreen', () => exitPreviewFullscreen());
  ipcMain.handle('preview:getStatus', () => getPreviewWindowStatus());
  ipcMain.handle('preview:reload', () => {
    if (previewWindow && !previewWindow.isDestroyed()) {
      previewWindow.webContents.reload();
      return true;
    }
    return false;
  });
  ipcMain.handle('preview:notifyShaderHotReload', () => {
    if (previewWindow && !previewWindow.isDestroyed()) {
      previewWindow.webContents.send('shader:hotReload');
      return true;
    }
    return false;
  });

  // --- Compiler Diagnostics Relay to Main Editor ---
  ipcMain.handle('shader:reportDiagnostics', (event, { errors }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('shader:diagnostics', { errors });
    }
  });
  ipcMain.handle('shader:reportSuccess', (event, { file }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('shader:success', { file });
    }
  });

  // Forward Export events to main window
  ffmpegExporter.on('progress', (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('export:progress', progress);
    }
  });

  ffmpegExporter.on('complete', (result) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('export:complete', result);
    }
    if (exportWindow && !exportWindow.isDestroyed()) {
      exportWindow.destroy();
      exportWindow = null;
    }
  });

  ffmpegExporter.on('error', (err) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('export:error', { message: err.message });
    }
    if (exportWindow && !exportWindow.isDestroyed()) {
      exportWindow.destroy();
      exportWindow = null;
    }
  });
}

/**
 * Deterministic Non-Real-Time Frame-by-Frame Video Exporter
 * Spawns a dedicated offscreen BrowserWindow running the sketch in lockstep.
 */
async function startDeterministicExport(options) {
  const {
    width = 1920,
    height = 1080,
    fps = 60,
    durationSec = 5,
    outputPath,
    audioPath = null,
    oscPath = null,
    profile = 'h264-master'
  } = options;

  const totalFrames = Math.round(durationSec * fps);

  // If a previous export window exists, close it
  if (exportWindow && !exportWindow.isDestroyed()) {
    exportWindow.destroy();
    exportWindow = null;
  }

  // Initialize FFmpeg Exporter process
  ffmpegExporter.startExport({
    width,
    height,
    fps,
    totalFrames,
    outputPath,
    audioPath,
    profile
  });

  // Create isolated offscreen BrowserWindow for lockstep frame generation
  exportWindow = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    show: false,
    frame: false,
    enableLargerThanScreen: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/sandboxPreload.cjs'),
      contextIsolation: false, // Allows seamless sketch hooks
      nodeIntegration: false,
      backgroundThrottling: false,
      webSecurity: false
    }
  });

  exportWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[ExportWin ${level}] ${message} (${sourceId}:${line})`);
  });

  // Query parameters instruct sandboxPreload to run in deterministic offline export mode
  const exportUrl = `${projectManager.getServerUrl()}/index.html?export=true&w=${width}&h=${height}&fps=${fps}&totalFrames=${totalFrames}&audioPath=${encodeURIComponent(audioPath || '')}&oscPath=${encodeURIComponent(oscPath || '')}`;

  console.log(`[Export] Loading offline lockstep sketch: ${exportUrl}`);
  await exportWindow.loadURL(exportUrl);

  return {
    status: 'exporting',
    totalFrames,
    width,
    height,
    fps
  };
}

// =========================================================================
// App Lifecycle
// =========================================================================
app.whenReady().then(async () => {
  // Initialize Services
  const defaultSketchPath = resolveDefaultSketchPath();
  projectManager = new ProjectManager(defaultSketchPath);
  await projectManager.startServer();

  oscBridge = new OscBridge({ rxPort: 9000, txPort: 9001 });
  await oscBridge.start();

  ffmpegExporter = new FfmpegExporter();

  // Watch for project file changes and notify renderer / preview / live stage
  projectManager.on('file:changed', (change) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('project:fileChanged', change);
    }
    if (liveWindow && !liveWindow.isDestroyed()) {
      liveWindow.webContents.send('project:fileChanged', change);
      if (!change.isShader) {
        liveWindow.webContents.reload();
      }
    }
    if (previewWindow && !previewWindow.isDestroyed()) {
      previewWindow.webContents.send('project:fileChanged', change);
      if (!change.isShader) {
        previewWindow.webContents.reload();
      }
    }
  });

  // Listen for display changes (e.g., projector or monitor plugged / unplugged)
  screen.on('display-added', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('displays:changed', getDisplays());
    }
  });
  screen.on('display-removed', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('displays:changed', getDisplays());
    }
  });

  setupIPC();
  await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (oscBridge) oscBridge.stop();
  if (projectManager) projectManager.stopServer();
  if (ffmpegExporter) ffmpegExporter.cancelExport();
  if (liveWindow && !liveWindow.isDestroyed()) liveWindow.destroy();
  if (previewWindow && !previewWindow.isDestroyed()) previewWindow.destroy();
});
