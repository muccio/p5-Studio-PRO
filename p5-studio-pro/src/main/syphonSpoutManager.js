import { BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

let textureBridge = null;
let loadError = null;
try {
  textureBridge = require('@napolab/texture-bridge');
} catch (err) {
  loadError = err;
  console.warn('[SyphonSpout] Native texture bridge unavailable:', err.message);
}

/**
 * Hardware-Accelerated Zero-Copy GPU Syphon (macOS Metal IOSurface) &
 * Spout (Windows DirectX 11 DXGI NT Handle) Live Stage Transmitter.
 */
export class SyphonSpoutManager {
  constructor({ projectManager, getAudioBandRanges, onStatusChanged } = {}) {
    this.projectManager = projectManager;
    this.getAudioBandRanges = getAudioBandRanges || (() => null);
    this.onStatusChanged = onStatusChanged || (() => {});

    this.protocolName = process.platform === 'darwin'
      ? 'Syphon'
      : (process.platform === 'win32' ? 'Spout' : 'Syphon/Spout');

    this.isActive = false;
    this.senderName = 'p5-Studio-PRO Live Stage';
    this.width = 1920;
    this.height = 1080;
    this.fps = 60;
    this.framesSent = 0;
    this.lastFrameTime = 0;

    this.sender = null;
    this.offscreenWindow = null;
    this.keepAliveTimer = null;
  }

  isSupported() {
    return Boolean(textureBridge && (process.platform === 'darwin' || process.platform === 'win32'));
  }

  getStatus() {
    let nativePlatform = 'unsupported';
    if (textureBridge && typeof textureBridge.getPlatform === 'function') {
      try {
        nativePlatform = textureBridge.getPlatform();
      } catch (e) {}
    }
    return {
      supported: this.isSupported(),
      protocol: this.protocolName,
      nativePlatform,
      isActive: this.isActive,
      senderName: this.senderName,
      width: this.width,
      height: this.height,
      fps: this.fps,
      framesSent: this.framesSent,
      error: loadError ? loadError.message : null
    };
  }

  listAvailableServers() {
    if (!textureBridge || typeof textureBridge.listSenders !== 'function') {
      return [];
    }
    try {
      return textureBridge.listSenders() || [];
    } catch (e) {
      return [];
    }
  }

  async start(options = {}) {
    if (!this.isSupported()) {
      throw new Error(`${this.protocolName} non è disponibile su questa piattaforma.`);
    }

    const nextName = (typeof options.senderName === 'string' && options.senderName.trim())
      ? options.senderName.trim()
      : this.senderName;
    const nextW = Math.max(64, Math.min(7680, Number(options.width) || this.width || 1920));
    const nextH = Math.max(64, Math.min(4320, Number(options.height) || this.height || 1080));
    const nextFps = Math.max(15, Math.min(120, Number(options.fps) || this.fps || 60));

    // If already active with same settings, return current status
    if (
      this.isActive &&
      this.sender &&
      this.offscreenWindow &&
      !this.offscreenWindow.isDestroyed() &&
      this.senderName === nextName &&
      this.width === nextW &&
      this.height === nextH
    ) {
      this._emitStatus();
      return this.getStatus();
    }

    // Stop any previous session cleanly before starting new configuration
    this.stop(false);

    this.senderName = nextName;
    this.width = nextW;
    this.height = nextH;
    this.fps = nextFps;
    this.framesSent = 0;
    this.lastFrameTime = Date.now();

    // 1. Instantiate native GPU Syphon Metal Server (macOS) or Spout2 D3D11 Sender (Windows)
    this.sender = new textureBridge.TextureSender(this.senderName, this.width, this.height);
    this.isActive = true;

    // 2. Ensure Live Stage buffer has latest committed files
    if (this.projectManager) {
      this.projectManager.commitToLiveBuffer();
    }

    // 3. Create dedicated offscreen shared-texture GPU renderer for Live Stage
    this.offscreenWindow = new BrowserWindow({
      title: `p5-Studio-PRO - ${this.protocolName} Transmitter (${this.senderName})`,
      width: this.width,
      height: this.height,
      useContentSize: true,
      show: false,
      frame: false,
      backgroundColor: '#000000',
      webPreferences: {
        preload: path.join(__dirname, '../preload/sandboxPreload.cjs'),
        contextIsolation: false,
        nodeIntegration: false,
        webSecurity: false,
        offscreen: {
          useSharedTexture: true
        }
      }
    });

    this.offscreenWindow.webContents.setFrameRate(this.fps);
    this.offscreenWindow.webContents.setAudioMuted(true);

    this.offscreenWindow.webContents.on('paint', (event, dirty, image) => {
      try {
        if (!this.isActive || !this.sender) return;
        const tex = event.texture;
        if (tex && tex.textureInfo) {
          const info = tex.textureInfo;
          const handleBuf =
            info.sharedTextureHandle ||
            (info.handle && (info.handle.ioSurface || info.handle.ntHandle));
          const w = (info.codedSize && info.codedSize.width) || this.width;
          const h = (info.codedSize && info.codedSize.height) || this.height;

          if (handleBuf && Buffer.isBuffer(handleBuf)) {
            if (process.platform === 'darwin') {
              this.sender.sendSurface(handleBuf, w, h);
              this.framesSent++;
              this.lastFrameTime = Date.now();
            } else if (process.platform === 'win32') {
              const handleVal = Number(handleBuf.readBigInt64LE(0));
              this.sender.send(handleVal, w, h);
              this.framesSent++;
              this.lastFrameTime = Date.now();
            }
          }
        } else if (image && process.platform === 'darwin') {
          const bmp = image.toBitmap();
          const sz = image.getSize();
          if (bmp && sz.width > 0 && sz.height > 0) {
            this.sender.sendRgbaBuffer(bmp, sz.width, sz.height);
            this.framesSent++;
            this.lastFrameTime = Date.now();
          }
        }
      } catch (err) {
        // Ignore transient paint errors during resize/stop
      } finally {
        if (event.texture && typeof event.texture.release === 'function') {
          try {
            event.texture.release();
          } catch (e) {}
        }
      }
    });

    // Keep-alive repaint pulse so static sketches (or newly connected VJ clients) always receive frames
    this.keepAliveTimer = setInterval(() => {
      if (!this.isActive || !this.offscreenWindow || this.offscreenWindow.isDestroyed()) return;
      if (Date.now() - this.lastFrameTime > 200) {
        try {
          this.offscreenWindow.webContents.invalidate();
        } catch (e) {}
      }
    }, 250);

    const bandRanges = this.getAudioBandRanges();
    const bandParam = bandRanges ? `&bandRanges=${encodeURIComponent(JSON.stringify(bandRanges))}` : '';
    const serverUrl = this.projectManager ? this.projectManager.getServerUrl() : '';
    if (serverUrl) {
      const liveUrl = `${serverUrl}/__live/index.html?live=true&syphon=true${bandParam}&t=${Date.now()}`;
      await this.offscreenWindow.loadURL(liveUrl);
    }

    console.log(`[${this.protocolName}] Started broadcasting "${this.senderName}" (${this.width}x${this.height} @ ${this.fps}fps)`);
    this._emitStatus();
    return this.getStatus();
  }

  stop(emit = true) {
    this.isActive = false;

    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }

    if (this.offscreenWindow) {
      try {
        if (!this.offscreenWindow.isDestroyed()) {
          this.offscreenWindow.destroy();
        }
      } catch (e) {}
      this.offscreenWindow = null;
    }

    if (this.sender) {
      try {
        this.sender.stop();
      } catch (e) {}
      this.sender = null;
    }

    if (emit) {
      console.log(`[${this.protocolName}] Stopped broadcasting "${this.senderName}"`);
      this._emitStatus();
    }
    return this.getStatus();
  }

  async toggle(options = {}) {
    if (this.isActive) {
      return this.stop(true);
    }
    return await this.start(options);
  }

  async updateConfig(options = {}) {
    const wasActive = this.isActive;
    if (typeof options.senderName === 'string' && options.senderName.trim()) {
      this.senderName = options.senderName.trim();
    }
    if (options.width) {
      this.width = Math.max(64, Math.min(7680, Number(options.width) || 1920));
    }
    if (options.height) {
      this.height = Math.max(64, Math.min(4320, Number(options.height) || 1080));
    }
    if (options.fps) {
      this.fps = Math.max(15, Math.min(120, Number(options.fps) || 60));
    }

    if (wasActive) {
      return await this.start({
        senderName: this.senderName,
        width: this.width,
        height: this.height,
        fps: this.fps
      });
    }
    this._emitStatus();
    return this.getStatus();
  }

  reload() {
    if (!this.isActive || !this.offscreenWindow || this.offscreenWindow.isDestroyed()) {
      return false;
    }
    try {
      const bandRanges = this.getAudioBandRanges();
      const bandParam = bandRanges ? `&bandRanges=${encodeURIComponent(JSON.stringify(bandRanges))}` : '';
      const serverUrl = this.projectManager ? this.projectManager.getServerUrl() : '';
      if (serverUrl) {
        const liveUrl = `${serverUrl}/__live/index.html?live=true&syphon=true${bandParam}&t=${Date.now()}`;
        this.offscreenWindow.loadURL(liveUrl);
      } else {
        this.offscreenWindow.webContents.reload();
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  notifyShaderHotReload() {
    if (!this.isActive || !this.offscreenWindow || this.offscreenWindow.isDestroyed()) {
      return false;
    }
    try {
      this.offscreenWindow.webContents.send('shader:hotReload');
      return true;
    } catch (e) {
      return false;
    }
  }

  forwardIPC(channel, payload) {
    if (!this.isActive || !this.offscreenWindow || this.offscreenWindow.isDestroyed()) {
      return;
    }
    try {
      this.offscreenWindow.webContents.send(channel, payload);
    } catch (e) {}
  }

  _emitStatus() {
    try {
      this.onStatusChanged(this.getStatus());
    } catch (e) {}
  }
}
