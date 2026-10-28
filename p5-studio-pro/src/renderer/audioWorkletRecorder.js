/**
 * audioWorkletRecorder.js
 * High-performance Float32 PCM AudioWorkletProcessor.
 * Captures pristine audio buffers directly from the hardware/virtual audio input
 * without stutter or dropouts for lossless take recording.
 */
class AudioWorkletRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.isRecording = false;
    this.bufferSize = 4096;
    this.channelCount = 2;

    this.leftBuffer = new Float32Array(this.bufferSize);
    this.rightBuffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data.command === 'start') {
        this.isRecording = true;
        this.bufferIndex = 0;
      } else if (data.command === 'stop') {
        this.isRecording = false;
        // Flush remaining samples
        if (this.bufferIndex > 0) {
          this._flush(this.bufferIndex);
        }
      }
    };
  }

  _flush(length) {
    const leftChunk = new Float32Array(this.leftBuffer.subarray(0, length));
    const rightChunk = new Float32Array(this.rightBuffer.subarray(0, length));

    this.port.postMessage(
      {
        type: 'chunk',
        left: leftChunk.buffer,
        right: rightChunk.buffer,
        length
      },
      [leftChunk.buffer, rightChunk.buffer]
    );

    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    if (!this.isRecording) return true;

    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const inputLeft = input[0];
    const inputRight = input.length > 1 ? input[1] : input[0]; // Duplicate mono to stereo if needed
    const quantumLength = inputLeft.length; // usually 128

    for (let i = 0; i < quantumLength; i++) {
      this.leftBuffer[this.bufferIndex] = inputLeft[i];
      this.rightBuffer[this.bufferIndex] = inputRight[i];
      this.bufferIndex++;

      if (this.bufferIndex >= this.bufferSize) {
        this._flush(this.bufferSize);
      }
    }

    return true;
  }
}

registerProcessor('audio-worklet-recorder', AudioWorkletRecorder);
