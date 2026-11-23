/**
 * p5-Studio-PRO — Esempio Minimo: Caricamento Audio Automatico & Analisi
 * Metti il tuo file 'track.mp3' nella cartella del progetto.
 */

let sound, fft, amp;

function setup() {
  createCanvas(windowWidth, windowHeight);

  // Inizializza gli hook FFT e Amplitude dell'IDE
  fft = ideAudio.createFFT(0.8, 256);
  amp = ideAudio.createAmplitude(0.8);

  // Carica il file locale ed esegue l'autoplay in loop
  sound = ideAudio.loadAudio('./track.mp3', true);
  sound.loop = true;
}

function draw() {
  background(15);

  const spectrum = fft.analyze(64);   // Spettro di frequenze (0..255)
  const waveform = fft.waveform(256); // Forma d'onda (-1.0..+1.0)
  const level = amp.getLevel();       // Ampiezza RMS (0.0..1.0)

  // 1. Cerchio centrale reattivo all'ampiezza (RMS)
  noStroke();
  fill(0, 240, 255, 60);
  circle(width / 2, height / 2, level * 350 + 50);

  // 2. Barre FFT dello spettro (in basso)
  fill(255, 0, 110);
  const barW = width / spectrum.length;
  for (let i = 0; i < spectrum.length; i++) {
    const h = map(spectrum[i], 0, 255, 0, height * 0.45);
    rect(i * barW, height - h, barW - 2, h);
  }

  // 3. Forma d'onda (oscilloscopio al centro)
  noFill();
  stroke(255, 200, 0);
  strokeWeight(2);
  beginShape();
  for (let i = 0; i < waveform.length; i++) {
    const x = map(i, 0, waveform.length - 1, 0, width);
    const y = height / 2 + waveform[i] * (height * 0.25);
    vertex(x, y);
  }
  endShape();
}

// Clicca ovunque o premi Spazio per Play / Pause
function mousePressed() {
  if (sound) sound.togglePlay();
}

function keyPressed() {
  if (key === ' ' && sound) sound.togglePlay();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
