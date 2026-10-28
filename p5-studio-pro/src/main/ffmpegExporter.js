import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { EventEmitter, once } from 'events';

// Resolve ffmpeg static binary or fallback to system ffmpeg
let ffmpegPath = null;
try {
  const ffmpegStatic = await import('ffmpeg-static');
  ffmpegPath = ffmpegStatic.default || ffmpegStatic;
} catch (e) {
  ffmpegPath = 'ffmpeg';
}

if (typeof ffmpegPath === 'string' && ffmpegPath.includes('app.asar')) {
  ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
}

if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
  const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const directUnpacked = path.join(process.resourcesPath || '', 'app.asar.unpacked/node_modules/ffmpeg-static', exeName);
  if (fs.existsSync(directUnpacked)) {
    ffmpegPath = directUnpacked;
  } else {
    ffmpegPath = exeName; // fallback to PATH
  }
}

export const EXPORT_PROFILES = {
  'h264-master': {
    name: 'H.264 Master (CRF 15, YUV420P)',
    ext: '.mp4',
    videoArgs: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '15', '-preset', 'slow'],
    audioArgs: ['-c:a', 'aac', '-b:a', '320k']
  },
  'h264-chroma-pure': {
    name: 'H.264 Chroma-Pure (CRF 14, YUV444P, Zero Bleed)',
    ext: '.mp4',
    videoArgs: ['-c:v', 'libx264', '-pix_fmt', 'yuv444p', '-crf', '14', '-preset', 'slow'],
    audioArgs: ['-c:a', 'aac', '-b:a', '320k']
  },
  'prores-4444-alpha': {
    name: 'Apple ProRes 4444 + Alpha (YUVA444P10LE, 24-bit PCM)',
    ext: '.mov',
    videoArgs: ['-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le'],
    audioArgs: ['-c:a', 'pcm_s24le']
  }
};

export class FfmpegExporter extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.isExporting = false;
    this.currentFrame = 0;
    this.totalFrames = 0;
    this.width = 1920;
    this.height = 1080;
    this.fps = 60;
    this.outputPath = null;
    this.startTime = 0;
    this.wasCancelled = false;
  }

  /**
   * Start an export session
   */
  startExport(options) {
    if (this.isExporting) {
      throw new Error('An export is already running');
    }

    const {
      width = 1920,
      height = 1080,
      fps = 60,
      totalFrames = 300,
      outputPath,
      audioPath = null,
      profile = 'h264-master'
    } = options;

    if (!outputPath) {
      throw new Error('Output path is required');
    }

    const selectedProfile = EXPORT_PROFILES[profile] || EXPORT_PROFILES['h264-master'];

    this.width = width;
    this.height = height;
    this.fps = fps;
    this.totalFrames = totalFrames;
    this.currentFrame = 0;
    this.outputPath = outputPath;
    this.startTime = performance.now();
    this.isExporting = true;
    this.wasCancelled = false;

    // Ensure output directory exists
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // Build FFmpeg command arguments
    const ffmpegArgs = [
      '-y', // Overwrite output file if exists
      '-f', 'rawvideo',
      '-vcodec', 'rawvideo',
      '-s', `${width}x${height}`,
      '-pix_fmt', 'rgba',
      '-r', `${fps}`,
      '-i', '-' // Standard input pipe for raw pixel buffers
    ];

    let hasAudio = false;
    if (audioPath && fs.existsSync(audioPath)) {
      ffmpegArgs.push('-i', audioPath);
      hasAudio = true;
    }

    // Append video encoding parameters
    ffmpegArgs.push(...selectedProfile.videoArgs);

    if (hasAudio) {
      ffmpegArgs.push(...selectedProfile.audioArgs);
      // Ensure muxing matches video duration
      ffmpegArgs.push('-shortest');
    }

    ffmpegArgs.push(outputPath);

    console.log(`[FFmpeg] Spawning: ${ffmpegPath} ${ffmpegArgs.join(' ')}`);

    this.process = spawn(ffmpegPath, ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.process.stdin.on('error', (err) => {
      if (err.code !== 'EPIPE' && !this.wasCancelled) {
        console.warn('[FFmpeg] stdin warning:', err.message);
      }
    });

    let stderrLogs = '';
    this.process.stderr.on('data', (chunk) => {
      stderrLogs += chunk.toString();
    });

    this.process.on('error', (err) => {
      console.error('[FFmpeg] Process error:', err);
      this.isExporting = false;
      this.emit('error', err);
    });

    this.process.on('close', (code, signal) => {
      this.isExporting = false;
      if (this.wasCancelled) {
        console.log('[FFmpeg] Export was cancelled by user.');
        return;
      }
      if (code === 0) {
        console.log(`[FFmpeg] Export finished successfully: ${outputPath}`);
        this.emit('complete', {
          outputPath,
          totalFrames: this.currentFrame,
          durationSec: this.currentFrame / this.fps
        });
      } else {
        const exitDetail = code !== null ? `code ${code}` : `signal ${signal || 'UNKNOWN'}`;
        const errorMsg = `FFmpeg exited with ${exitDetail}.\nLogs:\n${stderrLogs.slice(-1000)}`;
        console.error('[FFmpeg]', errorMsg);
        this.emit('error', new Error(errorMsg));
      }
    });

    return {
      status: 'started',
      width,
      height,
      fps,
      totalFrames,
      outputPath
    };
  }

  /**
   * Vertical flip in-place for raw RGBA buffer
   * WebGL gl.readPixels reads from bottom-left to top-right.
   * FFmpeg rawvideo expects top-left to bottom-right.
   */
  static flipVerticalRGBA(buffer, width, height) {
    const bytesPerRow = width * 4;
    const tempRow = new Uint8Array(bytesPerRow);
    const halfH = Math.floor(height / 2);

    for (let y = 0; y < halfH; y++) {
      const topOffset = y * bytesPerRow;
      const bottomOffset = (height - 1 - y) * bytesPerRow;

      // Copy top to temp
      tempRow.set(buffer.subarray(topOffset, topOffset + bytesPerRow));
      // Copy bottom to top
      buffer.set(buffer.subarray(bottomOffset, bottomOffset + bytesPerRow), topOffset);
      // Copy temp to bottom
      buffer.set(tempRow, bottomOffset);
    }

    return buffer;
  }

  /**
   * Push a single raw RGBA frame into FFmpeg stdin with backpressure awaiting
   */
  async pushFrame(frameBuffer, isAlreadyFlipped = false) {
    if (!this.isExporting || !this.process || !this.process.stdin) {
      throw new Error('No active export session');
    }

    const expectedSize = this.width * this.height * 4;
    if (frameBuffer.length !== expectedSize) {
      throw new Error(`Invalid frame buffer size. Expected ${expectedSize} bytes, got ${frameBuffer.length}`);
    }

    // Convert to Uint8Array if needed
    const buffer = Buffer.isBuffer(frameBuffer) ? frameBuffer : Buffer.from(frameBuffer.buffer, frameBuffer.byteOffset, frameBuffer.byteLength);

    if (!isAlreadyFlipped) {
      FfmpegExporter.flipVerticalRGBA(buffer, this.width, this.height);
    }

    // Write to ffmpeg stdin with drain backpressure handling
    const canContinue = this.process.stdin.write(buffer);
    if (!canContinue) {
      await once(this.process.stdin, 'drain');
    }

    this.currentFrame++;

    // Calculate progress and ETA
    const elapsedSec = (performance.now() - this.startTime) / 1000;
    const fpsProcessed = this.currentFrame / (elapsedSec || 0.001);
    const remainingFrames = Math.max(0, this.totalFrames - this.currentFrame);
    const etaSec = fpsProcessed > 0 ? (remainingFrames / fpsProcessed) : 0;
    const percent = Math.min(100, (this.currentFrame / this.totalFrames) * 100);

    const progressData = {
      frame: this.currentFrame,
      totalFrames: this.totalFrames,
      percent: parseFloat(percent.toFixed(1)),
      fpsProcessed: parseFloat(fpsProcessed.toFixed(1)),
      etaSec: Math.ceil(etaSec),
      elapsedSec: Math.ceil(elapsedSec)
    };

    this.emit('progress', progressData);
    return progressData;
  }

  /**
   * End the export by closing stdin and waiting for ffmpeg to finish
   */
  async finishExport() {
    if (!this.isExporting || !this.process) return;

    return new Promise((resolve, reject) => {
      this.once('complete', resolve);
      this.once('error', reject);

      if (this.process.stdin && !this.process.stdin.destroyed) {
        this.process.stdin.end();
      }
    });
  }

  /**
   * Cancel running export
   */
  cancelExport() {
    if (!this.isExporting || !this.process) return;
    this.wasCancelled = true;
    this.isExporting = false;
    try {
      this.process.kill('SIGKILL');
    } catch (e) {}
    this.emit('cancelled');
  }
}
