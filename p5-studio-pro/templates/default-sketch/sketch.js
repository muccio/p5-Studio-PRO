/**
 * sketch.js - Main p5.js Entry Point
 * Demonstrates:
 * 1. window.ideShader (multi-file stateful hot-reloading & auto uniform binding)
 * 2. window.ideAudio (hardware live input & deterministic offline DSP + u_audioTex)
 * 3. window.ideOSC (UDP OSC bindings & deterministic offline replay)
 */

let myShader = null;

function setup() {
  // Enforce pixelDensity(1) for cross-platform rendering parity
  pixelDensity(1);
  createCanvas(windowWidth, windowHeight, WEBGL);
  noStroke();

  // Expose instance globally for the deterministic export engine
  window.p5Instance = this;

  // Load and preprocess multi-file GLSL shader (resolving #include "common.glsl")
  myShader = window.ideShader.load(this, 'effect.vert', 'effect.frag');

  // Handle Play / Pause commands from the IDE header
  window.addEventListener('message', (event) => {
    if (event.data) {
      if (event.data.type === 'sketch:pause') noLoop();
      else if (event.data.type === 'sketch:resume') loop();
    }
  });

  console.log('[p5-Studio-PRO] Sketch initialized in WEBGL mode.');
}

function draw() {
  background(0);

  // 1. Update audio DSP state (live input or virtual frame slice)
  window.ideAudio.update(frameCount, 60);

  if (myShader) {
    shader(myShader);

    // 2. Automatically bind all standard uniforms:
    // u_resolution, u_time, u_delta, u_frame, u_mouse,
    // u_rms, u_sub, u_bass, u_lowMid, u_mid, u_highMid, u_treble, and u_audioTex
    window.ideShader.bindStandardUniforms(myShader, this);

    // 3. Bind OSC addresses directly to shader uniforms with fallback defaults:
    // /shader/zoom -> u_zoom (default 1.0)
    // /shader/palette -> u_palette (default 0.0)
    window.ideOSC.bindUniforms(myShader, {
      u_zoom: ['/shader/zoom', 1.0],
      u_palette: ['/shader/palette', 0.0]
    });

    // 4. Render screen-filling quad
    // In p5.js WEBGL, the coordinate origin (0, 0) is at the center of the canvas
    rect(-width / 2, -height / 2, width, height);
  }
}

function windowResized() {
  // Only resize canvas if not running in deterministic export lockstep mode
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('export') !== 'true') {
    resizeCanvas(windowWidth, windowHeight);
  }
}
