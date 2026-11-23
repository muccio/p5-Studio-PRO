/**
 * p5-Studio-PRO — Sample: Analizzatore di Spettro (FFT), Waveform & Ampiezza
 * Usa gli hook nativi dell'IDE compatibili 1:1 con p5.FFT e p5.Amplitude
 * (nessuna dipendenza da p5.sound, funziona in Live e in Export Video Deterministico).
 */

let fft;
let amp;
let peakHold = [];
let levelHistory = [];
const NUM_BINS = 128; // Numero di bande visualizzate nello spettro

function setup() {
  createCanvas(windowWidth, windowHeight);
  colorMode(HSB, 360, 100, 100, 100);
  textFont('monospace');

  // Hook IDE compatibili 1:1 con p5.FFT e p5.Amplitude
  fft = ideAudio.createFFT(0.82, 1024);
  amp = ideAudio.createAmplitude(0.85);

  for (let i = 0; i < NUM_BINS; i++) {
    peakHold[i] = 0;
  }
}

function draw() {
  background(225, 35, 6, 100);

  // 1. Analisi FFT (0..255), Waveform (-1..+1), Centroide (Hz) e Ampiezza (0..1)
  const spectrum = fft.analyze(1024);
  const waveform = fft.waveform(512);
  const centroidHz = fft.getCentroid();
  const level = amp.getLevel();
  const beat = ideAudio.isBeat(0.48, 180);

  levelHistory.push(level);
  if (levelHistory.length > 240) levelHistory.shift();

  // Energie per banda (0..255) calcolate sugli intervalli Hz configurati nell'IDE
  const bands = [
    { name: 'SUB',    val: fft.getEnergy('sub'),     hue: 290 },
    { name: 'BASS',   val: fft.getEnergy('bass'),    hue: 340 },
    { name: 'L-MID',  val: fft.getEnergy('lowMid'),  hue: 25  },
    { name: 'MID',    val: fft.getEnergy('mid'),     hue: 55  },
    { name: 'H-MID',  val: fft.getEnergy('highMid'), hue: 150 },
    { name: 'TREBLE', val: fft.getEnergy('treble'),  hue: 190 }
  ];

  const pad = 28;
  const topH = height * 0.44;
  const bottomY = topH + pad * 1.5;
  const bottomH = height - bottomY - pad;

  // --- SEZIONE SUPERIORE SINISTRA: OSCILLOSCOPIO WAVEFORM + STORICO AMPIEZZA ---
  const waveW = width * 0.62 - pad * 1.5;
  drawPanel(pad, pad, waveW, topH - pad, 'WAVEFORM & AMPLITUDE ENVELOPE');
  drawWaveformAndEnvelope(pad + 14, pad + 34, waveW - 28, topH - pad - 48, waveform, level);

  // --- SEZIONE SUPERIORE DESTRA: RADAR AMPIEZZA RMS + 6 BANDE ---
  const rightX = pad + waveW + pad;
  const rightW = width - rightX - pad;
  drawPanel(rightX, pad, rightW, topH - pad, 'AMPLITUDE & IDE FREQUENCY BANDS');
  drawAmplitudeAndBands(rightX + 16, pad + 34, rightW - 32, topH - pad - 48, level, beat, bands);

  // --- SEZIONE INFERIORE: ANALIZZATORE DI SPETTRO FFT + PEAK HOLD + CENTROIDE ---
  drawPanel(pad, bottomY, width - pad * 2, bottomH, 'FFT SPECTRUM ANALYZER (0..255)');
  drawSpectrumAnalyzer(
    pad + 16,
    bottomY + 36,
    width - pad * 2 - 32,
    bottomH - 52,
    spectrum,
    centroidHz
  );
}

function drawWaveformAndEnvelope(x, y, w, h, waveform, level) {
  // Griglia centrale
  stroke(215, 25, 22);
  strokeWeight(1);
  line(x, y + h * 0.5, x + w, y + h * 0.5);

  // Invilluppo storico dell'ampiezza (area riempita in basso)
  noStroke();
  fill(190, 85, 95, 16);
  beginShape();
  vertex(x, y + h);
  for (let i = 0; i < levelHistory.length; i++) {
    const px = map(i, 0, Math.max(1, levelHistory.length - 1), x, x + w);
    const py = y + h - constrain(levelHistory[i] * 1.6, 0, 1) * (h * 0.45);
    vertex(px, py);
  }
  vertex(x + w, y + h);
  endShape(CLOSE);

  // Traccia Waveform nel dominio del tempo (-1.0 .. +1.0)
  noFill();
  stroke(188, 90, 100);
  strokeWeight(2);
  beginShape();
  for (let i = 0; i < waveform.length; i++) {
    const px = map(i, 0, waveform.length - 1, x, x + w);
    const py = y + h * 0.5 + waveform[i] * (h * 0.42);
    vertex(px, py);
  }
  endShape();

  // Etichetta livello corrente e dB
  const db = level > 0.0001 ? (20 * Math.log10(level)).toFixed(1) : '-inf';
  noStroke();
  fill(190, 30, 90);
  textSize(11);
  textAlign(LEFT, TOP);
  text(`RMS Level: ${(level * 100).toFixed(1)}% (${db} dBFS)`, x + 4, y + 2);
}

function drawAmplitudeAndBands(x, y, w, h, level, beat, bands) {
  // Cerchio pulsante per l'ampiezza a sinistra
  const gaugeW = Math.min(w * 0.38, h);
  const cx = x + gaugeW * 0.5;
  const cy = y + h * 0.5;
  const maxR = gaugeW * 0.42;

  noFill();
  stroke(220, 25, 28);
  strokeWeight(2);
  circle(cx, cy, maxR * 2);

  const pulseR = map(constrain(level * 1.8, 0, 1), 0, 1, maxR * 0.18, maxR);
  fill(beat ? 340 : 188, 85, 100, beat ? 45 : 28);
  stroke(beat ? 340 : 188, 90, 100);
  strokeWeight(beat ? 3 : 2);
  circle(cx, cy, pulseR * 2);

  noStroke();
  fill(0, 0, 95);
  textAlign(CENTER, CENTER);
  textSize(12);
  text(`${Math.round(level * 100)}%`, cx, cy - 5);
  textSize(9);
  fill(210, 20, 70);
  text(beat ? 'BEAT!' : 'AMP', cx, cy + 10);

  // Barre per le 6 bande di frequenza dell'IDE a destra
  const barsX = x + gaugeW + 14;
  const barsW = w - gaugeW - 14;
  const barGap = 8;
  const singleW = (barsW - barGap * (bands.length - 1)) / bands.length;
  const barMaxH = h - 22;

  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    const bx = barsX + i * (singleW + barGap);
    const norm = constrain(b.val / 255.0, 0, 1);
    const bh = norm * barMaxH;

    // Sfondo barra
    fill(225, 30, 14);
    rect(bx, y, singleW, barMaxH, 3);

    // Barra attiva
    fill(b.hue, 85, 95);
    rect(bx, y + barMaxH - bh, singleW, bh, 3);

    // Nome banda
    fill(210, 15, 78);
    textSize(9);
    textAlign(CENTER, TOP);
    text(b.name, bx + singleW * 0.5, y + barMaxH + 6);
  }
}

function drawSpectrumAnalyzer(x, y, w, h, spectrum, centroidHz) {
  const barStep = w / NUM_BINS;
  const barW = Math.max(1, barStep - 2);

  // Campionamento logaritmico dei primi 512 bin per una resa musicale bilanciata
  const usableBins = Math.min(512, spectrum.length);

  for (let i = 0; i < NUM_BINS; i++) {
    const t0 = Math.pow(i / NUM_BINS, 1.65);
    const t1 = Math.pow((i + 1) / NUM_BINS, 1.65);
    const startBin = Math.floor(t0 * (usableBins - 1));
    const endBin = Math.max(startBin, Math.floor(t1 * (usableBins - 1)));

    let sum = 0;
    for (let b = startBin; b <= endBin; b++) {
      sum += spectrum[b];
    }
    const val = sum / (endBin - startBin + 1); // 0..255
    const norm = val / 255.0;

    // Aggiorna Peak Hold con decadimento morbido
    if (norm >= peakHold[i]) {
      peakHold[i] = norm;
    } else {
      peakHold[i] = Math.max(0, peakHold[i] - 0.008);
    }

    const bx = x + i * barStep;
    const bh = norm * (h - 18);
    const hue = map(i, 0, NUM_BINS - 1, 185, 335);

    // Barra FFT
    noStroke();
    fill(hue, 85, 95, 88);
    rect(bx, y + h - 18 - bh, barW, bh, 2);

    // Tacca Peak-Hold
    const peakY = y + h - 18 - peakHold[i] * (h - 18);
    fill(hue, 35, 100);
    rect(bx, peakY - 2, barW, 2);
  }

  // Indicatore del Centroide Spettrale (Hz)
  const nyquist = (ideAudio.sampleRate || 48000) * 0.5;
  const maxShownHz = nyquist * 0.5;
  const normCentroid = constrain(Math.pow(constrain(centroidHz / maxShownHz, 0, 1), 1 / 1.65), 0, 1);
  const cx = x + normCentroid * w;

  stroke(55, 95, 100, 80);
  strokeWeight(1.5);
  line(cx, y, cx, y + h - 18);

  noStroke();
  fill(55, 95, 100);
  textSize(10);
  textAlign( cx > x + w - 130 ? RIGHT : LEFT, TOP);
  text(`Centroide: ${Math.round(centroidHz)} Hz`, cx + (cx > x + w - 130 ? -6 : 6), y + 4);
}

function drawPanel(x, y, w, h, title) {
  fill(225, 32, 10, 92);
  stroke(215, 30, 22);
  strokeWeight(1);
  rect(x, y, w, h, 6);

  noStroke();
  fill(190, 75, 95);
  textSize(10);
  textAlign(LEFT, TOP);
  text(title, x + 12, y + 10);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
