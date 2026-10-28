import dgram from 'dgram';
import fs from 'fs';
import path from 'path';

/**
 * High-performance, zero-dependency binary OSC 1.0 Parser and Serializer
 * Implements the Open Sound Control 1.0 specification over UDP.
 */
export class OscBridge {
  constructor(options = {}) {
    this.rxPort = options.rxPort || 9000;
    this.txPort = options.txPort || 9001;
    this.txHost = options.txHost || '127.0.0.1';

    this.serverSocket = null;
    this.clientSocket = null;
    this.isListening = false;

    // Take recording state
    this.isRecording = false;
    this.recordingStartTime = 0;
    this.recordedEvents = [];
    this.currentTakeDir = null;

    // Listeners for incoming parsed messages
    this.messageListeners = new Set();
  }

  /**
   * Start UDP Server to listen for incoming OSC messages
   */
  start() {
    return new Promise((resolve, reject) => {
      try {
        if (this.serverSocket) {
          try { this.serverSocket.close(); } catch (e) {}
        }

        this.serverSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        this.clientSocket = dgram.createSocket('udp4');

        this.serverSocket.on('error', (err) => {
          console.error(`[OSC] Server socket error:`, err);
        });

        this.serverSocket.on('message', (msgBuffer, rinfo) => {
          this._handleIncomingPacket(msgBuffer, rinfo);
        });

        this.serverSocket.on('listening', () => {
          const addr = this.serverSocket.address();
          this.isListening = true;
          console.log(`[OSC] UDP Server listening on ${addr.address}:${addr.port}`);
          resolve(addr);
        });

        this.serverSocket.bind(this.rxPort);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Stop UDP sockets
   */
  stop() {
    this.isListening = false;
    if (this.serverSocket) {
      try {
        this.serverSocket.close();
      } catch (e) {}
      this.serverSocket = null;
    }
    if (this.clientSocket) {
      try {
        this.clientSocket.close();
      } catch (e) {}
      this.clientSocket = null;
    }
  }

  /**
   * Reconfigure RX / TX ports
   */
  async updateConfig({ rxPort, txPort, txHost }) {
    let restartNeeded = false;
    if (rxPort && rxPort !== this.rxPort) {
      this.rxPort = rxPort;
      restartNeeded = true;
    }
    if (txPort) this.txPort = txPort;
    if (txHost) this.txHost = txHost;

    if (restartNeeded && this.isListening) {
      await this.start();
    }

    return {
      rxPort: this.rxPort,
      txPort: this.txPort,
      txHost: this.txHost,
      isListening: this.isListening,
      isRecording: this.isRecording
    };
  }

  getStatus() {
    return {
      rxPort: this.rxPort,
      txPort: this.txPort,
      txHost: this.txHost,
      isListening: this.isListening,
      isRecording: this.isRecording,
      recordedEventCount: this.recordedEvents.length
    };
  }

  onMessage(callback) {
    this.messageListeners.add(callback);
    return () => this.messageListeners.delete(callback);
  }

  /**
   * Send an OSC message out via UDP
   */
  send(address, ...args) {
    if (!this.clientSocket) {
      this.clientSocket = dgram.createSocket('udp4');
    }

    const packet = this.encodeMessage(address, args);
    return new Promise((resolve, reject) => {
      this.clientSocket.send(packet, 0, packet.length, this.txPort, this.txHost, (err) => {
        if (err) {
          console.error(`[OSC] Failed to send message to ${this.txHost}:${this.txPort}:`, err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Start recording incoming OSC messages for deterministic take export
   */
  startRecording(takeDir) {
    this.isRecording = true;
    this.recordingStartTime = performance.now();
    this.recordedEvents = [];
    this.currentTakeDir = takeDir;
    console.log(`[OSC] Started recording take to ${takeDir}`);
  }

  /**
   * Stop recording take and write take_osc.json
   */
  stopRecording() {
    if (!this.isRecording) return null;
    this.isRecording = false;

    const takeDir = this.currentTakeDir;
    const events = [...this.recordedEvents];
    let savedPath = null;

    if (takeDir && events.length >= 0) {
      try {
        if (!fs.existsSync(takeDir)) {
          fs.mkdirSync(takeDir, { recursive: true });
        }
        savedPath = path.join(takeDir, 'take_osc.json');
        fs.writeFileSync(savedPath, JSON.stringify(events, null, 2), 'utf-8');
        console.log(`[OSC] Saved ${events.length} OSC events to ${savedPath}`);
      } catch (err) {
        console.error(`[OSC] Error saving take_osc.json:`, err);
      }
    }

    return {
      savedPath,
      count: events.length
    };
  }

  /**
   * Handle incoming raw UDP packet
   */
  _handleIncomingPacket(buffer, rinfo) {
    try {
      const messages = this.decodePacket(buffer);
      const now = performance.now();

      for (const msg of messages) {
        const timestampMs = this.isRecording ? (now - this.recordingStartTime) : 0;

        if (this.isRecording) {
          this.recordedEvents.push({
            timestampMs,
            address: msg.address,
            args: msg.args
          });
        }

        // Notify subscribers
        for (const listener of this.messageListeners) {
          listener({
            address: msg.address,
            args: msg.args,
            timestampMs,
            rinfo
          });
        }
      }
    } catch (err) {
      console.warn(`[OSC] Malformed packet received from ${rinfo.address}:${rinfo.port}:`, err.message);
    }
  }

  /**
   * Decode an OSC Packet (Bundle or single Message)
   */
  decodePacket(buffer) {
    if (buffer.length < 4) return [];

    const strHeader = buffer.toString('utf8', 0, Math.min(8, buffer.length));

    if (strHeader.startsWith('#bundle')) {
      return this._decodeBundle(buffer);
    } else {
      return [this._decodeMessage(buffer, 0).message];
    }
  }

  _decodeBundle(buffer) {
    const messages = [];
    let offset = 16; // Skip '#bundle\0' (8 bytes) + timetag (8 bytes)

    while (offset < buffer.length) {
      if (offset + 4 > buffer.length) break;
      const elementSize = buffer.readInt32BE(offset);
      offset += 4;

      if (elementSize <= 0 || offset + elementSize > buffer.length) break;

      const elementBuffer = buffer.subarray(offset, offset + elementSize);
      const subMessages = this.decodePacket(elementBuffer);
      messages.push(...subMessages);

      offset += elementSize;
    }

    return messages;
  }

  _decodeMessage(buffer, startOffset = 0) {
    let offset = startOffset;

    // 1. Read Address String (null-terminated, padded to 4-byte boundary)
    const addressEnd = buffer.indexOf(0, offset);
    if (addressEnd === -1) {
      throw new Error('OSC Address not null-terminated');
    }
    const address = buffer.toString('utf8', offset, addressEnd);
    offset = (addressEnd + 4) & ~3; // 4-byte align

    // 2. Read Type Tag String (starts with ',')
    let typeTags = '';
    if (offset < buffer.length && buffer[offset] === 0x2C) { // 0x2C is ','
      const tagEnd = buffer.indexOf(0, offset);
      if (tagEnd !== -1) {
        typeTags = buffer.toString('utf8', offset + 1, tagEnd);
        offset = (tagEnd + 4) & ~3;
      }
    }

    // 3. Read Arguments according to Type Tags
    const args = [];
    for (let i = 0; i < typeTags.length; i++) {
      const tag = typeTags[i];
      switch (tag) {
        case 'f': { // Float32
          const val = buffer.readFloatBE(offset);
          args.push(val);
          offset += 4;
          break;
        }
        case 'i': { // Int32
          const val = buffer.readInt32BE(offset);
          args.push(val);
          offset += 4;
          break;
        }
        case 's': { // String
          const strEnd = buffer.indexOf(0, offset);
          if (strEnd === -1) throw new Error('OSC String arg not null-terminated');
          const str = buffer.toString('utf8', offset, strEnd);
          args.push(str);
          offset = (strEnd + 4) & ~3;
          break;
        }
        case 'b': { // Blob
          const blobLen = buffer.readInt32BE(offset);
          offset += 4;
          const blob = buffer.subarray(offset, offset + blobLen);
          args.push(blob);
          offset = (offset + blobLen + 3) & ~3;
          break;
        }
        case 'T': // True
          args.push(true);
          break;
        case 'F': // False
          args.push(false);
          break;
        case 'N': // Nil
          args.push(null);
          break;
        default:
          console.warn(`[OSC] Unsupported type tag '${tag}'`);
          break;
      }
    }

    return {
      message: { address, args },
      nextOffset: offset
    };
  }

  /**
   * Encode an OSC Message into a binary Buffer
   */
  encodeMessage(address, args = []) {
    // 1. Pad string helper
    const padBuffer = (str) => {
      const strBuf = Buffer.from(str, 'utf8');
      const nullPadLen = 4 - (strBuf.length % 4);
      const padded = Buffer.alloc(strBuf.length + nullPadLen, 0);
      strBuf.copy(padded);
      return padded;
    };

    const addressBuf = padBuffer(address);

    // 2. Build Type Tags
    let typeTagStr = ',';
    const argBuffers = [];

    for (const arg of args) {
      if (typeof arg === 'number') {
        if (Number.isInteger(arg)) {
          typeTagStr += 'i';
          const buf = Buffer.alloc(4);
          buf.writeInt32BE(arg, 0);
          argBuffers.push(buf);
        } else {
          typeTagStr += 'f';
          const buf = Buffer.alloc(4);
          buf.writeFloatBE(arg, 0);
          argBuffers.push(buf);
        }
      } else if (typeof arg === 'string') {
        typeTagStr += 's';
        argBuffers.push(padBuffer(arg));
      } else if (typeof arg === 'boolean') {
        typeTagStr += arg ? 'T' : 'F';
      } else if (arg === null || arg === undefined) {
        typeTagStr += 'N';
      } else if (Buffer.isBuffer(arg) || arg instanceof Uint8Array) {
        typeTagStr += 'b';
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeInt32BE(arg.length, 0);
        const nullPadLen = (4 - (arg.length % 4)) % 4;
        const paddedBlob = Buffer.alloc(arg.length + nullPadLen, 0);
        Buffer.from(arg).copy(paddedBlob);
        argBuffers.push(Buffer.concat([lenBuf, paddedBlob]));
      } else {
        // Fallback toString
        typeTagStr += 's';
        argBuffers.push(padBuffer(String(arg)));
      }
    }

    const typeTagBuf = padBuffer(typeTagStr);
    return Buffer.concat([addressBuf, typeTagBuf, ...argBuffers]);
  }
}
