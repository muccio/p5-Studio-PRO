/**
 * p5-Studio-PRO — Esempio Minimo OSC (Ricezione & Invio con ideOSC)
 *
 * - Riceve messaggi OSC sulla porta RX configurata nell'IDE (default: 9000):
 *     /x     (0.0 .. 1.0) -> posizione X
 *     /y     (0.0 .. 1.0) -> posizione Y
 *     /size  (10 .. 400)  -> dimensione cerchio
 *     /hue   (0 .. 360)   -> colore HSB
 *     /pulse              -> trigger impulso visivo
 * - Invia messaggi OSC sulla porta TX dell'IDE (default: 127.0.0.1:9001)
 *   quando muovi o trascini il mouse sul canvas.
 */

let pulse = 0;

function setup() {
  createCanvas(windowWidth, windowHeight);
  colorMode(HSB, 360, 100, 100, 100);

  // 1. Hook per eventi discreti / trigger OSC in ingresso
  ideOSC.on('/pulse', (strength = 1.0) => {
    pulse = Number(strength) || 1.0;
  });
}

function draw() {
  background(230, 30, 8, 25);

  // 2. Lettura diretta degli ultimi valori OSC ricevuti (con valore di default)
  const normX = ideOSC.get('/x', 0.5);
  const normY = ideOSC.get('/y', 0.5);
  const baseSize = ideOSC.get('/size', 140);
  const hue = ideOSC.get('/hue', 190);

  const x = normX * width;
  const y = normY * height;
  const r = baseSize + pulse * 160;
  pulse *= 0.9; // decadimento morbido dell'impulso

  // Disegna cursore reattivo ai parametri OSC
  noStroke();
  fill(hue, 85, 100, 85);
  circle(x, y, r);

  // HUD informativo essenziale
  fill(0, 0, 90);
  textFont('monospace', 13);
  text(`OSC RX -> /x: ${Number(normX).toFixed(2)}  /y: ${Number(normY).toFixed(2)}  /size: ${Math.round(baseSize)}  /hue: ${Math.round(hue)}`, 20, 30);
  text('Trascina il mouse per inviare OSC (/mouse/x, /mouse/y) e clicca per /pulse', 20, 50);
}

// 3. Invio messaggi OSC in uscita (TX) trascinando o cliccando col mouse
function mouseDragged() {
  const nx = constrain(mouseX / width, 0, 1);
  const ny = constrain(mouseY / height, 0, 1);
  ideOSC.send('/mouse/x', nx);
  ideOSC.send('/mouse/y', ny);
}

function mousePressed() {
  pulse = 1.0;
  ideOSC.send('/pulse', 1.0);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
