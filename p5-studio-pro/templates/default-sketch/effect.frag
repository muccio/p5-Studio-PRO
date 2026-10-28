#ifdef GL_ES
precision highp float;
precision highp int;
#endif

// Include shared SDFs, transformations, noise & color palettes
#include "common.glsl"

varying vec2 vTexCoord;

// Standard IDE Uniforms
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_delta;
uniform int u_frame;
uniform vec2 u_mouse;

// Audio-Reactive Uniforms from ideAudio
uniform float u_rms;
uniform float u_sub;
uniform float u_bass;
uniform float u_lowMid;
uniform float u_mid;
uniform float u_highMid;
uniform float u_treble;

// 1024x2 WebGL Audio Data Texture
// Row 0 (y=0.25): FFT Frequency Bins (0.0 to 1.0)
// Row 1 (y=0.75): Waveform Oscilloscope (-1.0 to 1.0)
uniform sampler2D u_audioTex;

// OSC Mapped Uniforms
uniform float u_zoom;    // Controlled via /shader/zoom (default 1.0)
uniform float u_palette; // Controlled via /shader/palette (0.0 to 3.0)

// Scene Signed Distance Function
float mapScene(vec3 p) {
  // Rotate scene slowly over time modulated by mouse
  float rotSpeed = u_time * 0.2;
  p.xz *= rot2D(rotSpeed + (u_mouse.x - 0.5) * 2.0);
  p.yz *= rot2D(sin(u_time * 0.15) * 0.4 + (u_mouse.y - 0.5) * 2.0);

  // Sample audio waveform to warp space
  float waveOffset = (texture2D(u_audioTex, vec2(abs(p.y) * 0.2, 0.75)).r - 0.5) * 0.3;
  p += waveOffset;

  // Primary Gyroid Lattice modulated by bass
  float gyroidScale = 2.0 + u_bass * 1.5;
  float gyroidThickness = 0.03 + u_rms * 0.08;
  float dGyroid = sdGyroid(p, gyroidScale, gyroidThickness, sin(u_time * 0.5) * 0.3);

  // Central Pulsing Orb modulated by sub & bass
  float sphereRadius = 0.8 + u_bass * 0.5 + u_sub * 0.3;
  float dSphere = sdSphere(p, sphereRadius);

  // Morphing Torus ring
  vec2 torusDims = vec2(1.8 + u_mid * 0.4, 0.15 + u_treble * 0.2);
  vec3 pTorus = p;
  pTorus.xy *= rot2D(u_time * 0.5);
  float dTorus = sdTorus(pTorus, torusDims);

  // Organic smooth union
  float dMorph = smin(dSphere, dTorus, 0.4);
  float dScene = smin(dGyroid, dMorph, 0.3);

  return dScene;
}

// Estimate surface normal via tetrahedron / finite difference
vec3 calcNormal(vec3 p) {
  const float h = 0.001;
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * mapScene(p + k.xyy * h) +
    k.yyx * mapScene(p + k.yyx * h) +
    k.yxy * mapScene(p + k.yxy * h) +
    k.xxx * mapScene(p + k.xxx * h)
  );
}

void main() {
  // Normalize screen coordinates centered at origin (-1 to 1, aspect corrected)
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);

  // Sample FFT spectrum at uv radius for audio-driven background & dispersion
  float fftRadial = texture2D(u_audioTex, vec2(clamp(length(uv) * 0.6, 0.0, 1.0), 0.25)).r;

  // Camera setup
  float zoom = max(0.2, u_zoom);
  vec3 ro = vec3(0.0, 0.0, -3.8 / zoom); // Ray Origin
  vec3 rd = normalize(vec3(uv, 1.3));     // Ray Direction

  // Chromatic Dispersion: slightly separate ray directions for R, G, B
  float dispersion = 0.02 * (u_bass * 1.5 + fftRadial * 0.8);
  vec3 col = vec3(0.0);

  // Raymarching Loop
  float t = 0.0;
  const float maxDist = 20.0;
  const int maxSteps = 90;
  int hitSteps = 0;

  for (int i = 0; i < maxSteps; i++) {
    vec3 p = ro + rd * t;
    float d = mapScene(p);

    if (d < 0.001) {
      hitSteps = i;
      break;
    }
    if (t > maxDist) break;
    t += d * 0.8; // Step forward with conservative factor
  }

  // Shading & Lighting
  if (t < maxDist) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);

    // Directional light & specular highlight
    vec3 lightDir = normalize(vec3(1.0, 2.0, -1.5));
    float diff = max(dot(n, lightDir), 0.0);
    vec3 ref = reflect(rd, n);
    float spec = pow(max(dot(ref, lightDir), 0.0), 32.0);

    // Ambient Occlusion estimate from step count
    float ao = clamp(1.0 - float(hitSteps) / float(maxSteps), 0.0, 1.0);

    // Fresnel Rim Glow
    float fresnel = pow(1.0 - max(dot(-rd, n), 0.0), 3.0);

    // Audio-driven Color Palette selection via OSC u_palette
    float colorCoord = length(p) * 0.3 + u_time * 0.1 + fftRadial * 0.5;
    vec3 baseColor;
    if (u_palette < 1.0) {
      baseColor = paletteCyber(colorCoord);
    } else if (u_palette < 2.0) {
      baseColor = paletteNeon(colorCoord);
    } else if (u_palette < 3.0) {
      baseColor = paletteAmber(colorCoord);
    } else {
      baseColor = paletteElectric(colorCoord);
    }

    // Combine diffuse, specular, AO, and audio-reactive emissive glow
    vec3 emissive = baseColor * (u_bass * 1.2 + fftRadial * 2.0);
    col = baseColor * (diff * 0.8 + 0.2) * ao + vec3(spec) * 0.7 + emissive * fresnel;
  } else {
    // Deep Space Background with audio-reactive star nebula
    float bgGradient = length(uv);
    float waveVal = (texture2D(u_audioTex, vec2(abs(uv.x), 0.75)).r - 0.5) * 2.0;

    vec3 bgBase = mix(vec3(0.02, 0.03, 0.06), vec3(0.08, 0.02, 0.12), bgGradient);
    vec3 auraColor = paletteCyber(u_time * 0.05 + bgGradient * 0.5);
    col = bgBase + auraColor * (fftRadial * 0.4 + abs(waveVal) * 0.2);
  }

  // Post-processing: Vignette and tone mapping
  float vignette = 1.0 - smoothstep(0.5, 1.5, length(uv));
  col *= vignette;

  // ACES Filmic Tone Mapping approximation
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
