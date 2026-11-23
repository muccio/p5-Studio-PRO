/**
 * p5-Studio-PRO — Esempio: Caricamento File Audio & Analisi DSP con Hook IDE
 * 
 * Questo sketch dimostra come:
 * 1. Caricare qualsiasi file audio (MP3, WAV, OGG, FLAC) sia da percorso relativo
 *    (es. './track.mp3') sia tramite selettore di file locale dal proprio computer.
 * 2. Collegare l'audio direttamente al motore DSP nativo dell'IDE (ideAudio)
 *    e ascoltarlo in cuffia/casse senza dipendere da p5.sound.
 * 3. Analizzare in tempo reale:
 *    - FFT Spectrum (fft.analyze) in 0..255
 *    - Waveform Oscilloscopio (fft.waveform) in -1.0..+1.0
 *    - RMS Amplitude (amp.getLevel) in 0.0..1.0
 *    - Bande di frequenza configurate nell'IDE (SUB, BASS, L-MID, MID, H-MID, TREBLE)
 *    - Centroide Spettrale in Hz (fft.getCentroid)
 *    - Rilevatore di Beat (ideAudio.isBeat)
 * 4. Controllare riproduzione (Play/Pause, Barra di avanzamento interattiva, Volume).
 */

let sound = null;
let fft;
let amp;
let fileInput;
let isLoaded = false;
let trackName = 'Nessun file caricato (Seleziona un file MP3/WAV o usa barra spaziatrice)';

function setup() {
  createCanvas(windowWidth, windowHeight);
  colorMode(HSB, 360, 100, 100, 100);
  textFont('monospace');

  // Inizializza gli hook compatibili 1:1 con p5.FFT e p5.Amplitude
  fft = ideAudio.createFFT(0.85, 1024);
  amp = ideAudio.createAmplitude(0.8);

  // Pulsante per selezionare un file audio direttamente dal computer
  fileInput = createFileInput(handleFileSelect);
  fileInput.position(28, 24);
  fileInput.style('color', '#00f0ff');
  fileInput.style('background', '#101622');
  fileInput.style('border', '1px solid #00f0ff');
  fileInput.style('padding', '6px 12px');
  fileInput.style('border-radius', '4px');
  fileInput.style('font-family', 'monospace');
  fileInput.style('cursor', 'pointer');

  // OPZIONALE: Se hai un file nella cartella del progetto (es. 'track.mp3'),
  // puoi caricarlo automaticamente decommentando la riga seguente:
  // loadTrack('./track.mp3', 'track.mp3');
}

function handleFileSelect(file) {
  if (file.type === 'audio' || file.name.match(/\.(mp3|wav|ogg|flac|m4a|aac)$/i)) {
    loadTrack(file.file, file.name);
  } else {
    trackName = 'Formato non supportato. Seleziona un file audio valido (.mp3, .wav, .ogg).';
  }
}

function loadTrack(src, name = 'Traccia Audio') {
  if (sound) {
    sound.stop();
  }

  // Carica il file audio e lo collega direttamente all'analizzatore nativo dell'IDE e all'uscita audio
  sound = ideAudio.loadAudio(src, false);
  sound.loop = true;

  // Collega esplicitamente la traccia a FFT e Amplitude (anche se ideAudio lo fa in automatico)
  fft.setInput(sound);
  amp.setInput(sound);

  trackName = name;
  isLoaded = true;
}

function draw() {
  background(220, 40, 8, 100);

  // 1. Dati di Analisi Audio
  const spectrum = fft.analyze(1024);
  const waveform = fft.waveform(512);
  const centroidHz = fft.getCentroid();
  const rmsLevel = amp.getLevel();
  const beat = ideAudio.isBeat(0.45, 160);

  // 2. Intestazione & Info Traccia
  drawHeader();

  // 3. Sezione Controlli Traccia & Barra di Avanzamento
  const timelineY = 72;
  const timelineH = 46;
  drawTimeline(28, timelineY, width - 56, timelineH);

  // 4. Sezione Superiore: Oscilloscopio Waveform + VU Meter Dinamico
  const topY = timelineY + timelineH + 20;
  const topH = (height - topY) * 0.42;
  const leftW = width * 0.65 - 35;
  const rightX = leftW + 42;
  const rightW = width - rightX - 28;

  drawWaveformPanel(28, topY, leftW, topH, waveform, rmsLevel);
  drawBandsPanel(rightX, topY, rightW, topH, rmsLevel, beat);

  // 5. Sezione Inferiore: Analizzatore di Spettro FFT
  const bottomY = topY + topH + 16;
  const bottomH = height - bottomY - 24;
  drawSpectrumPanel(28, bottomY, width - 56, bottomH, spectrum, centroidHz);
}

function drawHeader() {
  noStroke();
  fill(188, 90, 100);
  textSize(13);
  textAlign(RIGHT, CENTER);
  text(isLoaded ? (sound.isPlaying() ? '▶ IN RIPRODUZIONE (Spazio per Pausa)' : '⏸ IN PAUSA (Spazio per Play)') : 'Scegli un file audio ➔', width - 28, 38);
}

function drawTimeline(x, y, w, h) {
  fill(225, 30, 12, 90);
  stroke(215, 25, 25);
  strokeWeight(1);
  rect(x, y, w, h, 6);

  // Nome traccia e tempo
  noStroke();
  fill(0, 0, 95);
  textSize(11);
  textAlign(LEFT, CENTER);
  text(trackName, x + 16, y + 16);

  let curTime = sound ? sound.currentTime : 0;
  let dur = sound ? (sound.duration || 0) : 0;
  let progress = dur > 0 ? (curTime / dur) : 0;

  fill(210, 15, 75);
  textAlign(RIGHT, CENTER);
  text(`${formatTime(curTime)} / ${formatTime(dur)}`, x + w - 16, y + 16);

  // Barra di avanzamento interattiva
  const barY = y + 28;
  const barH = 8;
  const barX = x + 16;
  const barW = w - 32;

  fill(220, 20, 20);
  rect(barX, barY, barW, barH, 4);

  // Avanzamento riprodotto
  fill(188, 90, 100);
  rect(barX, barY, barW * constrain(progress, 0, 1), barH, 4);

  // Cursore
  if (isLoaded) {
    fill(0, 0, 100);
    circle(barX + barW * constrain(progress, 0, 1), barY + barH * 0.5, 12);
  }
}

function drawWaveformPanel(x, y, w, h, waveform, rms) {
  fill(225, 32, 11, 90);
  stroke(215, 25, 25);
  strokeWeight(1);
  rect(x, y, w, h, 6);

  noStroke();
  fill(190, 80, 95);
  textSize(10);
  textAlign(LEFT, TOP);
  text('WAVEFORM OSCILLOSCOPE (fft.waveform)', x + 14, y + 10);

  // Linea centrale
  stroke(215, 20, 25);
  strokeWeight(1);
  line(x + 14, y + h * 0.5, x + w - 14, y + h * 0.5);

  // Traccia della forma d'onda
  noFill();
  stroke(188, 90, 100);
  strokeWeight(2);
  beginShape();
  for (let i = 0; i < waveform.length; i++) {
    const px = map(i, 0, waveform.length - 1, x + 14, x + w - 14);
    const py = y + h * 0.5 + waveform[i] * (h * 0.38);
    vertex(px, py);
  }
  endShape();
}

function drawBandsPanel(x, y, w, h, rms, beat) {
  fill(225, 32, 11, 90);
  stroke(215, 25, 25);
  strokeWeight(1);
  rect(x, y, w, h, 6);

  noStroke();
  fill(190, 80, 95);
  textSize(10);
  textAlign(LEFT, TOP);
  text('FREQUENCY BANDS & RMS', x + 14, y + 10);

  // 6 Bande di frequenza calcolate con fft.getEnergy() in formato p5.FFT (0..255)
  const bands = [
    { label: 'SUB',   val: fft.getEnergy('sub'),     hue: 290 },
    { label: 'BASS',  val: fft.getEnergy('bass'),    hue: 340 },
    { label: 'LMID',  val: fft.getEnergy('lowMid'),  hue: 25  },
    { label: 'MID',   val: fft.getEnergy('mid'),     hue: 55  },
    { label: 'HMID',  val: fft.getEnergy('highMid'), hue: 150 },
    { label: 'TREB',  val: fft.getEnergy('treble'),  hue: 190 }
  ];

  const barAreaX = x + 14;
  const barAreaY = y + 36;
  const barAreaW = w - 28;
  const barAreaH = h - 52;
  const singleW = (barAreaW - (bands.length - 1) * 6) / bands.length;

  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    const bx = barAreaX + i * (singleW + 6);
    const norm = constrain(b.val / 255.0, 0, 1);
    const barH = norm * (barAreaH - 18);

    // Sfondo barra
    fill(225, 25, 18);
    rect(bx, barAreaY, singleW, barAreaH - 18, 2);

    // Barra attiva
    fill(b.hue, 85, 95);
    rect(bx, barAreaY + (barAreaH - 18) - barH, singleW, barH, 2);

    // Nome della banda
    fill(210, 15, 75);
    textSize(8);
    textAlign(CENTER, TOP);
    text(b.label, bx + singleW * 0.5, barAreaY + barAreaH - 12);
  }

  // Indicatore Beat pulsante
  if (beat) {
    fill(340, 90, 100);
    noStroke();
    circle(x + w - 24, y + 16, 12);
  }
}

function drawSpectrumPanel(x, y, w, h, spectrum, centroidHz) {
  fill(225, 32, 11, 90);
  stroke(215, 25, 25);
  strokeWeight(1);
  rect(x, y, w, h, 6);

  noStroke();
  fill(190, 80, 95);
  textSize(10);
  textAlign(LEFT, TOP);
  text('FFT SPECTRUM ANALYZER (fft.analyze)', x + 14, y + 10);

  const numBars = 96;
  const barStep = (w - 28) / numBars;
  const barW = Math.max(1, barStep - 2);
  const usable = Math.min(512, spectrum.length);

  for (let i = 0; i < numBars; i++) {
    const t0 = Math.pow(i / numBars, 1.7);
    const t1 = Math.pow((i + 1) / numBars, 1.7);
    const sBin = Math.floor(t0 * (usable - 1));
    const eBin = Math.max(sBin, Math.floor(t1 * (usable - 1)));

    let sum = 0;
    for (let b = sBin; b <= eBin; b++) sum += spectrum[b];
    const val = sum / (eBin - sBin + 1);
    const norm = constrain(val / 255.0, 0, 1);

    const bx = x + 14 + i * barStep;
    const barH = norm * (h - 48);
    const hue = map(i, 0, numBars - 1, 190, 340);

    fill(hue, 85, 95, 90);
    rect(bx, y + h - 16 - barH, barW, barH, 2);
  }

  // Linea del centroide spettrale
  const nyquist = (ideAudio.sampleRate || 48000) * 0.5;
  const normCentroid = constrain(centroidHz / (nyquist * 0.5), 0, 1);
  const cx = x + 14 + normCentroid * (w - 28);

  stroke(55, 95, 100, 80);
  strokeWeight(1.5);
  line(cx, y + 30, cx, y + h - 16);

  noStroke();
  fill(55, 95, 100);
  textSize(9);
  textAlign(cx > x + w - 120 ? RIGHT : LEFT, TOP);
  text(`Centroide: ${Math.round(centroidHz)} Hz`, cx + (cx > x + w - 120 ? -6 : 6), y + 34);
}

function mousePressed() {
  if (!isLoaded || !sound) return;

  // Clic sulla barra temporale per saltare la riproduzione (seek)
  const barY = 72 + 28;
  const barH = 14;
  const barX = 28 + 16;
  const barW = width - 56 - 32;

  if (mouseX >= barX && mouseX <= barX + barW && mouseY >= barY - 6 && mouseY <= barY + barH + 6) {
    const newProgress = constrain((mouseX - barX) / barW, 0, 1);
    if (sound.duration > 0) {
      sound.currentTime = newProgress * sound.duration;
    }
  }
}

function keyPressed() {
  // Spazio per avviare o mettere in pausa il brano
  if (key === ' ' && sound) {
    sound.togglePlay();
  }
}

function formatTime(sec) {
  if (isNaN(sec) || sec <= 0) return '00:00';
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
