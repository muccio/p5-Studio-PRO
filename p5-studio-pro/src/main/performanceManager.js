import fs from 'fs';
import path from 'path';

/**
 * PerformanceManager
 * Isolated service for recording and loading Live Performance streams
 * (mouse, keyboard, discrete input events, audio DSP metrics, OSC, and live WAV audio)
 * for deterministic offline hook-based video export.
 */
export class PerformanceManager {
  constructor(projectManager) {
    this.projectManager = projectManager;
    this.activeSession = null;
  }

  startSession({ takeName, meta = {} } = {}) {
    const projectPath = this.projectManager.getProjectPath();
    const perfsDir = path.join(projectPath, '.performances');
    const folder = takeName || `perf_${Date.now()}`;
    const targetDir = path.join(perfsDir, folder);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    this.activeSession = {
      folder,
      targetDir,
      startedAt: Date.now(),
      meta: {
        version: '1.0',
        recordedAt: new Date().toISOString(),
        ...meta
      },
      frames: [],
      events: []
    };

    return {
      status: 'recording',
      perfDir: targetDir,
      folder
    };
  }

  appendChunk({ frames = [], events = [], meta = null } = {}) {
    if (!this.activeSession) {
      return { status: 'idle', frameCount: 0, eventCount: 0 };
    }
    if (meta && typeof meta === 'object') {
      Object.assign(this.activeSession.meta, meta);
    }
    if (Array.isArray(frames) && frames.length > 0) {
      this.activeSession.frames.push(...frames);
    }
    if (Array.isArray(events) && events.length > 0) {
      this.activeSession.events.push(...events);
    }
    return {
      status: 'recording',
      frameCount: this.activeSession.frames.length,
      eventCount: this.activeSession.events.length
    };
  }

  stopSession({ durationSec = 0, meta = {} } = {}) {
    if (!this.activeSession) {
      return null;
    }

    const session = this.activeSession;
    this.activeSession = null;

    Object.assign(session.meta, meta);

    // Sort frames and events chronologically by tMs
    session.frames.sort((a, b) => (a.tMs || 0) - (b.tMs || 0));
    session.events.sort((a, b) => (a.tMs || 0) - (b.tMs || 0));

    const lastFrameMs = session.frames.length > 0
      ? session.frames[session.frames.length - 1].tMs
      : 0;
    const computedDurationSec = durationSec > 0
      ? durationSec
      : Math.max(0.5, Math.round((lastFrameMs / 1000) * 10) / 10);

    const payload = {
      version: '1.0',
      type: 'p5-studio-performance-stream',
      durationSec: computedDurationSec,
      meta: session.meta,
      frameCount: session.frames.length,
      eventCount: session.events.length,
      frames: session.frames,
      events: session.events
    };

    const streamPath = path.join(session.targetDir, 'perf_stream.json');
    const audioPath = path.join(session.targetDir, 'perf_audio.wav');
    fs.writeFileSync(streamPath, JSON.stringify(payload, null, 2), 'utf-8');

    console.log(`[Performance] Saved performance stream (${payload.frameCount} frames, ${payload.eventCount} events, ${computedDurationSec}s) to ${streamPath}`);

    return {
      status: 'saved',
      perfDir: session.targetDir,
      streamPath,
      audioPath,
      durationSec: computedDurationSec,
      frameCount: payload.frameCount,
      eventCount: payload.eventCount
    };
  }

  async readStreamFile(streamPath) {
    if (!streamPath || !fs.existsSync(streamPath)) {
      return null;
    }
    const raw = await fs.promises.readFile(streamPath, 'utf-8');
    return JSON.parse(raw);
  }
}
