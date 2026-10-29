import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { conf as htmlConf, language as htmlLanguage } from 'monaco-editor/esm/vs/basic-languages/html/html.js';
import { conf as cssConf, language as cssLanguage } from 'monaco-editor/esm/vs/basic-languages/css/css.js';

/**
 * Configure Monaco Editor with complete HTML, CSS, JavaScript, and p5.js
 * syntax highlighting, autocomplete suggestions, hover hints, and type definitions.
 */
export function setupWebAndScriptSupport(editor = null) {
  // 1. Direct Monarch Tokenization & Configuration for HTML
  monaco.languages.register({
    id: 'html',
    extensions: ['.html', '.htm', '.shtml', '.xhtml'],
    aliases: ['HTML', 'htm', 'html']
  });
  monaco.languages.setLanguageConfiguration('html', htmlConf);
  monaco.languages.setMonarchTokensProvider('html', htmlLanguage);

  // 2. Direct Monarch Tokenization & Configuration for CSS
  monaco.languages.register({
    id: 'css',
    extensions: ['.css'],
    aliases: ['CSS', 'css']
  });
  monaco.languages.setLanguageConfiguration('css', cssConf);
  monaco.languages.setMonarchTokensProvider('css', cssLanguage);

  // 3. HTML Code Hints, Snippets & Hover Documentation
  setupHtmlCodeHints();

  // 4. CSS Code Hints, Snippets & Hover Documentation
  setupCssCodeHints();

  // 5. JavaScript / p5.js / ideAudio / ideShader / ideOSC IntelliSense & Type Definitions
  setupJavaScriptLanguageService();

  // 6. External Link Opener for Reference Links
  setupReferenceLinkOpener();

  // 7. Context Menu Reference Search
  if (editor) {
    setupEditorReferenceContextMenu(editor);
  }
}

/**
 * Register Link Opener to open https:// reference links in the external browser
 */
function setupReferenceLinkOpener() {
  if (monaco.editor.registerOpener) {
    try {
      monaco.editor.registerOpener({
        open: (resource) => {
          const url = typeof resource === 'string' ? resource : resource.toString();
          if (url.startsWith('http://') || url.startsWith('https://')) {
            if (window.electronAPI && window.electronAPI.system) {
              window.electronAPI.system.openExternal(url);
              return true;
            }
            window.open(url, '_blank');
            return true;
          }
          return false;
        }
      });
    } catch (e) {
      // Opener might already be registered
    }
  }
}

/**
 * Register Context Menu Actions for direct Reference lookup
 */
export function setupEditorReferenceContextMenu(editor) {
  if (!editor) return;

  // Context Menu: Search p5.js Reference
  editor.addAction({
    id: 'p5-search-reference',
    label: 'Cerca nel Reference di p5.js (Online)',
    keybindings: [
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyR,
      monaco.KeyMod.Shift | monaco.KeyCode.F1
    ],
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1.5,
    run: (ed) => {
      const position = ed.getPosition();
      const model = ed.getModel();
      if (!position || !model) return;

      const selection = ed.getSelection();
      let query = '';
      if (selection && !selection.isEmpty()) {
        query = model.getValueInRange(selection).trim();
      } else {
        const word = model.getWordAtPosition(position);
        query = word ? word.word : '';
      }

      let refUrl = 'https://p5js.org/reference/';
      if (query) {
        if (P5_REFERENCE_DOCS[query]) {
          refUrl = `https://p5js.org/reference/#/p5/${query}`;
        } else {
          refUrl = `https://p5js.org/reference/p5/${encodeURIComponent(query)}`;
        }
      }

      if (window.electronAPI && window.electronAPI.system) {
        window.electronAPI.system.openExternal(refUrl);
      } else {
        window.open(refUrl, '_blank');
      }
    }
  });

  // Context Menu: Search GLSL Reference
  editor.addAction({
    id: 'glsl-search-reference',
    label: 'Cerca nella Reference GLSL / Shaders (Online)',
    keybindings: [
      monaco.KeyMod.Alt | monaco.KeyCode.F1
    ],
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1.6,
    run: (ed) => {
      const position = ed.getPosition();
      const model = ed.getModel();
      if (!position || !model) return;

      const selection = ed.getSelection();
      let query = '';
      if (selection && !selection.isEmpty()) {
        query = model.getValueInRange(selection).trim();
      } else {
        const word = model.getWordAtPosition(position);
        query = word ? word.word : '';
      }

      let refUrl = 'https://thebookofshaders.com/glossary/';
      if (query) {
        refUrl = `https://thebookofshaders.com/glossary/?search=${encodeURIComponent(query)}`;
      }

      if (window.electronAPI && window.electronAPI.system) {
        window.electronAPI.system.openExternal(refUrl);
      } else {
        window.open(refUrl, '_blank');
      }
    }
  });
}

/**
 * Register HTML Completion Items and Snippets
 */
function setupHtmlCodeHints() {
  monaco.languages.registerCompletionItemProvider('html', {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      };

      const suggestions = [
        {
          label: 'html5',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: [
            '<!DOCTYPE html>',
            '<html lang="en">',
            '<head>',
            '  <meta charset="UTF-8">',
            '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
            '  <title>${1:p5-Studio-PRO Sketch}</title>',
            '  <style>',
            '    * { margin: 0; padding: 0; box-sizing: border-box; }',
            '    html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }',
            '    canvas { display: block; width: 100% !important; height: 100% !important; object-fit: contain; }',
            '  </style>',
            '  <script src="/sandboxRuntime.js"></script>',
            '  <script src="./p5.min.js"></script>',
            '</head>',
            '<body>',
            '  <script src="./sketch.js"></script>',
            '</body>',
            '</html>'
          ].join('\n'),
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Full HTML5 Sketch Template with runtime and p5.js',
          range
        },
        {
          label: 'canvas',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: '<canvas id="${1:mainCanvas}" width="${2:1920}" height="${3:1080}"></canvas>',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'HTML Canvas Element',
          range
        },
        {
          label: 'script:src',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: '<script src="${1:sketch.js}"></script>',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'External script inclusion',
          range
        },
        {
          label: 'style',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: '<style>\n  ${1}\n</style>',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Inline CSS stylesheet block',
          range
        },
        {
          label: 'link:css',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: '<link rel="stylesheet" href="${1:style.css}">',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'External CSS stylesheet link',
          range
        }
      ];

      return { suggestions };
    }
  });

  // HTML Hover Documentation
  monaco.languages.registerHoverProvider('html', {
    provideHover: (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const htmlDocs = {
        canvas: '### `<canvas>`\nHTML5 bitmap canvas element used by **p5.js** for 2D graphics and **WebGL** shaders.',
        script: '### `<script>`\nLoads executable JavaScript code or external libraries into the document.',
        style: '### `<style>`\nContains inline CSS styling rules for formatting the document and canvas viewport.',
        meta: '### `<meta>`\nProvides metadata about the HTML document (viewport, character set, etc.).',
        head: '### `<head>`\nContainer for metadata, scripts, stylesheets, and titles.',
        body: '### `<body>`\nDocument body hosting the canvas and script entry points.'
      };

      const doc = htmlDocs[word.word.toLowerCase()];
      if (doc) {
        return {
          range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          contents: [{ value: doc }]
        };
      }
      return null;
    }
  });
}

/**
 * Register CSS Completion Items and Snippets
 */
function setupCssCodeHints() {
  monaco.languages.registerCompletionItemProvider('css', {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      };

      const suggestions = [
        {
          label: 'full-canvas',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: [
            'html, body {',
            '  margin: 0;',
            '  padding: 0;',
            '  width: 100vw;',
            '  height: 100vh;',
            '  overflow: hidden;',
            '  background: #000;',
            '}',
            'canvas {',
            '  display: block;',
            '  width: 100vw !important;',
            '  height: 100vh !important;',
            '  object-fit: contain;',
            '}'
          ].join('\n'),
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Full window responsive canvas setup',
          range
        },
        {
          label: 'flex-center',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: [
            'display: flex;',
            'align-items: center;',
            'justify-content: center;'
          ].join('\n'),
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Flexbox center alignment',
          range
        },
        {
          label: 'absolute-fill',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: [
            'position: absolute;',
            'top: 0;',
            'left: 0;',
            'width: 100%;',
            'height: 100%;'
          ].join('\n'),
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Absolute position full fill',
          range
        },
        {
          label: 'no-scrollbar',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: [
            'overflow: hidden;',
            'scrollbar-width: none;',
            '&::-webkit-scrollbar { display: none; }'
          ].join('\n'),
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Hide scrollbars across all browsers',
          range
        }
      ];

      return { suggestions };
    }
  });

  // CSS Hover Documentation
  monaco.languages.registerHoverProvider('css', {
    provideHover: (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const cssDocs = {
        'object-fit': '### `object-fit`\nSpecifies how canvas or image content should resize to fit its container (`contain`, `cover`, `fill`).',
        'overflow': '### `overflow`\nControls what happens to content that is too big to fit into an area (`hidden`, `visible`, `scroll`, `auto`).',
        'display': '### `display`\nDefines how the element is treated in the document layout (`flex`, `grid`, `block`, `none`).'
      };

      const doc = cssDocs[word.word.toLowerCase()];
      if (doc) {
        return {
          range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          contents: [{ value: doc }]
        };
      }
      return null;
    }
  });
}

/**
 * Configure JavaScript / p5.js / ideAudio / ideShader / ideOSC IntelliSense
 */
function setupJavaScriptLanguageService() {
  const ts = monaco.languages.typescript;
  if (!ts || !ts.javascriptDefaults) return;

  ts.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false
  });

  ts.javascriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ES2022,
    allowNonTsExtensions: true,
    alwaysStrict: false,
    checkJs: false
  });

  // Comprehensive TypeScript definitions for p5.js and p5-Studio-PRO Runtime
  const studioTypeDefs = `
/**
 * p5-Studio-PRO IDE Audio Engine API
 */
declare interface IdeAudioEngine {
  /** Get current RMS overall audio loudness (0.0 to 1.0) */
  getRMS(): number;
  /** Get 1024-bin normalized FFT frequency spectrum */
  getFFT(): Float32Array;
  /** Get 1024-sample normalized time-domain waveform (-1.0 to 1.0) */
  getWaveform(): Float32Array;
  /** Get normalized energy for a named frequency band or frequency range */
  getEnergy(band: 'sub' | 'bass' | 'lowMid' | 'mid' | 'highMid' | 'treble'): number;
  getEnergy(lowHz: number, highHz: number): number;
  /** True when transient peak energy exceeds dynamic threshold */
  isBeat(): boolean;
  /** Returns the dynamic 1024x2 WebGL audio texture updated every frame */
  getTexture(p5Instance?: any): any;
  /** Current sample rate in Hz (e.g. 48000) */
  sampleRate: number;
}

/**
 * p5-Studio-PRO IDE Shader Manager API
 */
declare interface IdeShaderManager {
  /**
   * Load and preprocess vertex & fragment shaders with recursive #include support.
   * Registers shader for stateful hot-reloading.
   */
  load(p5Instance: any, vertPath: string, fragPath: string): Promise<any>;
  /**
   * Automatically bind standard uniforms every frame:
   * u_resolution, u_time, u_delta, u_frame, u_mouse, u_rms, u_sub, u_bass, u_lowMid, u_mid, u_highMid, u_treble, u_audioTex
   */
  bindStandardUniforms(shaderObj: any, p5Instance: any): void;
  /** Force re-compilation of all active shaders */
  hotReloadAll(): void;
}

/**
 * p5-Studio-PRO Bidirectional UDP OSC Engine API
 */
declare interface IdeOscBridge {
  /** Listen for incoming OSC messages at address */
  on(address: string, callback: (...args: any[]) => void): void;
  /** Remove OSC listener */
  off(address: string, callback?: Function): void;
  /** Bind OSC message addresses directly to shader uniform names */
  bindUniforms(shaderObj: any, mapping: Record<string, [string, any]>): void;
  /** Send an outgoing OSC message over UDP */
  send(address: string, ...args: any[]): Promise<boolean>;
  /** Get latest received value for OSC address */
  get(address: string, defaultValue?: any): any;
}

/** Global Audio Engine provided by p5-Studio-PRO */
declare const ideAudio: IdeAudioEngine;
/** Global Shader Helper provided by p5-Studio-PRO */
declare const ideShader: IdeShaderManager;
/** Global OSC Bridge provided by p5-Studio-PRO */
declare const ideOSC: IdeOscBridge;

/**
 * p5.js 2D and 3D Vectors
 */
declare class p5Vector {
  x: number;
  y: number;
  z: number;
  set(x?: number | number[] | p5Vector, y?: number, z?: number): p5Vector;
  copy(): p5Vector;
  add(x: number | p5Vector, y?: number, z?: number): p5Vector;
  sub(x: number | p5Vector, y?: number, z?: number): p5Vector;
  mult(n: number): p5Vector;
  div(n: number): p5Vector;
  mag(): number;
  magSq(): number;
  dot(x: number | p5Vector, y?: number, z?: number): number;
  cross(v: p5Vector): p5Vector;
  dist(v: p5Vector): number;
  normalize(): p5Vector;
  limit(max: number): p5Vector;
  setMag(len: number): p5Vector;
  heading(): number;
  rotate(angle: number): p5Vector;
  lerp(x: number | p5Vector, y?: number, z?: number, amt?: number): p5Vector;
  array(): number[];
  equals(x: number | p5Vector, y?: number, z?: number): boolean;
}

declare function createVector(x?: number, y?: number, z?: number): p5Vector;

/**
 * p5.js Core Lifecycle and Rendering Functions
 */
declare function setup(): void;
declare function draw(): void;
declare function preload(): void;
declare function windowResized(): void;
declare function mousePressed(): void;
declare function mouseReleased(): void;
declare function mouseClicked(): void;
declare function doubleClicked(): void;
declare function mouseMoved(): void;
declare function mouseDragged(): void;
declare function mouseWheel(event: any): void;
declare function touchStarted(): void;
declare function touchMoved(): void;
declare function touchEnded(): void;
declare function keyPressed(): void;
declare function keyReleased(): void;
declare function keyTyped(): void;

// Canvas & Environment
declare function createCanvas(w: number, h: number, renderer?: 'webgl' | 'p2d' | string): any;
declare function resizeCanvas(w: number, h: number): void;
declare function pixelDensity(val?: number): number;
declare function displayDensity(): number;
declare function frameRate(fps?: number): number;
declare function getFrameRate(): number;
declare function fullscreen(val?: boolean): boolean;
declare function cursor(type?: string): void;
declare function noCursor(): void;

// Color & Styling
declare function background(r: number | string, g?: number, b?: number, a?: number): void;
declare function clear(): void;
declare function fill(r: number | string, g?: number, b?: number, a?: number): void;
declare function noFill(): void;
declare function stroke(r: number | string, g?: number, b?: number, a?: number): void;
declare function noStroke(): void;
declare function strokeWeight(weight: number): void;
declare function strokeCap(cap: string): void;
declare function strokeJoin(join: string): void;
declare function colorMode(mode: string, max1?: number, max2?: number, max3?: number, maxA?: number): void;
declare function color(r: number | string, g?: number, b?: number, a?: number): any;
declare function red(c: any): number;
declare function green(c: any): number;
declare function blue(c: any): number;
declare function alpha(c: any): number;
declare function hue(c: any): number;
declare function saturation(c: any): number;
declare function brightness(c: any): number;
declare function lightness(c: any): number;
declare function lerpColor(c1: any, c2: any, amt: number): any;

// 2D Primitives
declare function arc(x: number, y: number, w: number, h: number, start: number, stop: number, mode?: string): void;
declare function ellipse(x: number, y: number, w: number, h?: number): void;
declare function circle(x: number, y: number, d: number): void;
declare function line(x1: number, y1: number, x2: number, y2: number): void;
declare function point(x: number, y: number, z?: number): void;
declare function quad(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): void;
declare function rect(x: number, y: number, w: number, h: number, tl?: number, tr?: number, br?: number, bl?: number): void;
declare function square(x: number, y: number, s: number): void;
declare function triangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void;

// Curves & Custom Shapes
declare function beginShape(kind?: string): void;
declare function endShape(mode?: string): void;
declare function vertex(x: number, y: number, z?: number, u?: number, v?: number): void;
declare function curveVertex(x: number, y: number, z?: number): void;
declare function bezierVertex(x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): void;
declare function quadraticVertex(cx: number, cy: number, x3: number, y3: number): void;
declare function curve(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): void;
declare function bezier(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): void;

// Transforms & Matrix
declare function push(): void;
declare function pop(): void;
declare function translate(x: number, y: number, z?: number): void;
declare function rotate(angle: number, axis?: number[]): void;
declare function rotateX(rad: number): void;
declare function rotateY(rad: number): void;
declare function rotateZ(rad: number): void;
declare function scale(s: number | number[] | any, y?: number, z?: number): void;
declare function shearX(angle: number): void;
declare function shearY(angle: number): void;
declare function resetMatrix(): void;
declare function applyMatrix(...args: number[]): void;

// 3D / WebGL Primitives & Materials
declare function plane(width?: number, height?: number): void;
declare function box(width?: number, height?: number, depth?: number): void;
declare function sphere(radius?: number, detailX?: number, detailY?: number): void;
declare function cylinder(radius?: number, height?: number, detailX?: number, detailY?: number): void;
declare function cone(radius?: number, height?: number, detailX?: number, detailY?: number): void;
declare function torus(radius?: number, tubeRadius?: number, detailX?: number, detailY?: number): void;
declare function orbitControl(sensitivityX?: number, sensitivityY?: number, sensitivityZ?: number): void;
declare function camera(x?: number, y?: number, z?: number, cx?: number, cy?: number, cz?: number, upX?: number, upY?: number, upZ?: number): void;
declare function perspective(fovy?: number, aspect?: number, near?: number, far?: number): void;
declare function ortho(left?: number, right?: number, bottom?: number, top?: number, near?: number, far?: number): void;
declare function ambientLight(v1: number | string, v2?: number, v3?: number, a?: number): void;
declare function directionalLight(v1: number | string, v2: number, v3: number, x: number, y: number, z: number): void;
declare function pointLight(v1: number | string, v2: number, v3: number, x: number, y: number, z: number): void;
declare function normalMaterial(): void;
declare function ambientMaterial(v1: number | string, v2?: number, v3?: number, a?: number): void;
declare function specularMaterial(v1: number | string, v2?: number, v3?: number, a?: number): void;
declare function shininess(p: number): void;

// Shaders
declare function shader(s: any): void;
declare function resetShader(): void;
declare function loadShader(vertFilename: string, fragFilename: string): any;
declare function createShader(vertSrc: string, fragSrc: string): any;
declare function createGraphics(w: number, h: number, renderer?: string): any;
declare function createFramebuffer(options?: any): any;
declare function blendMode(mode: string): void;

// Math & Random
declare function map(value: number, start1: number, stop1: number, start2: number, stop2: number, withinBounds?: boolean): number;
declare function lerp(start: number, stop: number, amt: number): number;
declare function constrain(n: number, low: number, high: number): number;
declare function dist(x1: number, y1: number, x2: number, y2: number): number;
declare function norm(value: number, start: number, stop: number): number;
declare function sq(n: number): number;
declare function sqrt(n: number): number;
declare function random(min?: number | any[], max?: number): any;
declare function randomSeed(seed: number): void;
declare function randomGaussian(mean?: number, sd?: number): number;
declare function noise(x: number, y?: number, z?: number): number;
declare function noiseSeed(seed: number): void;
declare function noiseDetail(lod: number, falloff?: number): void;
declare function sin(angle: number): number;
declare function cos(angle: number): number;
declare function tan(angle: number): number;
declare function asin(value: number): number;
declare function acos(value: number): number;
declare function atan(value: number): number;
declare function atan2(y: number, x: number): number;
declare function degrees(radians: number): number;
declare function radians(degrees: number): number;
declare function min(...args: number[]): number;
declare function max(...args: number[]): number;
declare function abs(n: number): number;
declare function floor(n: number): number;
declare function ceil(n: number): number;
declare function round(n: number): number;
declare function mag(x: number, y: number): number;
declare function exp(n: number): number;
declare function log(n: number): number;
declare function pow(n: number, e: number): number;

// Typography & Images
declare function text(str: string | number, x: number, y: number, x2?: number, y2?: number): void;
declare function textSize(size: number): void;
declare function textAlign(horizAlign: string, vertAlign?: string): void;
declare function textLeading(leading: number): void;
declare function textWidth(str: string): number;
declare function textAscent(): number;
declare function textDescent(): number;
declare function textFont(font: any | string, size?: number): void;
declare function loadFont(path: string): any;
declare function loadImage(path: string): any;
declare function image(img: any, x: number, y: number, w?: number, h?: number): void;
declare function tint(v1: number | string, v2?: number, v3?: number, a?: number): void;
declare function noTint(): void;
declare function imageMode(mode: string): void;
declare function loadPixels(): void;
declare function updatePixels(): void;
declare const pixels: Uint8ClampedArray;
declare function get(x?: number, y?: number, w?: number, h?: number): any;
declare function set(x: number, y: number, c: any): void;
declare function saveCanvas(filename?: string, extension?: string): void;
declare function saveGif(filename: string, duration: number, options?: any): void;

// Globals & Constants
declare const width: number;
declare const height: number;
declare const windowWidth: number;
declare const windowHeight: number;
declare const frameCount: number;
declare const deltaTime: number;
declare function millis(): number;
declare const mouseX: number;
declare const mouseY: number;
declare const pmouseX: number;
declare const pmouseY: number;
declare const movedX: number;
declare const movedY: number;
declare const mouseIsPressed: boolean;
declare const mouseButton: string;
declare const key: string;
declare const keyCode: number;
declare const keyIsPressed: boolean;
declare const focused: boolean;

declare const WEBGL: string;
declare const P2D: string;
declare const CENTER: string;
declare const CORNER: string;
declare const CORNERS: string;
declare const RADIUS: string;
declare const RGB: string;
declare const HSB: string;
declare const HSL: string;
declare const CLOSE: string;
declare const POINTS: string;
declare const LINES: string;
declare const TRIANGLES: string;
declare const TRIANGLE_STRIP: string;
declare const TRIANGLE_FAN: string;
declare const QUADS: string;
declare const QUAD_STRIP: string;
declare const BLEND: string;
declare const ADD: string;
declare const DARKEST: string;
declare const LIGHTEST: string;
declare const DIFFERENCE: string;
declare const EXCLUSION: string;
declare const MULTIPLY: string;
declare const SCREEN: string;
declare const OVERLAY: string;
declare const HARD_LIGHT: string;
declare const SOFT_LIGHT: string;
declare const DODGE: string;
declare const BURN: string;
declare const PI: number;
declare const TWO_PI: number;
declare const HALF_PI: number;
declare const QUARTER_PI: number;
declare const TAU: number;
`;

  ts.javascriptDefaults.addExtraLib(studioTypeDefs, 'ts:p5-studio-pro.d.ts');

  // Register VSCode-grade JavaScript completion items
  monaco.languages.registerCompletionItemProvider('javascript', {
    triggerCharacters: ['.', '(', '"', "'", ' '],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      };

      const suggestions = [
        {
          label: 'ideShader.load',
          kind: monaco.languages.CompletionItemKind.Method,
          insertText: 'await ideShader.load(this, "${1:effect.vert}", "${2:effect.frag}");',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Load & pre-process shader with live hot-reloading',
          documentation: {
            value: 'Carica e pre-processa file `.vert` e `.frag`, risolvendo ricorsivamente tutte le inclusioni `#include "module.glsl"` con hot-reloading automatico.'
          },
          range
        },
        {
          label: 'ideShader.bindStandardUniforms',
          kind: monaco.languages.CompletionItemKind.Method,
          insertText: 'ideShader.bindStandardUniforms(${1:myShader}, this);',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Bind u_resolution, u_time, u_delta, u_audioTex, u_rms...',
          documentation: {
            value: 'Invia automaticamente allo shader gli uniform di sistema: `u_resolution`, `u_time`, `u_delta`, `u_frame`, `u_mouse`, `u_audioTex`, `u_rms`, `u_bass`, `u_mid`, `u_treble`.'
          },
          range
        },
        {
          label: 'ideAudio.getRMS',
          kind: monaco.languages.CompletionItemKind.Method,
          insertText: 'ideAudio.getRMS()',
          detail: 'Get overall audio volume (0.0 to 1.0)',
          documentation: { value: 'Restituisce il livello RMS complessivo del segnale audio (normalizzato da 0.0 a 1.0).' },
          range
        },
        {
          label: 'ideAudio.getEnergy',
          kind: monaco.languages.CompletionItemKind.Method,
          insertText: "ideAudio.getEnergy('${1|sub,bass,lowMid,mid,highMid,treble|}')",
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Get frequency band energy (0.0 to 1.0)',
          documentation: { value: 'Calcola l\'energia normalizzata in una specifica banda spettrale (`sub`, `bass`, `lowMid`, `mid`, `highMid`, `treble`).' },
          range
        },
        {
          label: 'ideAudio.isBeat',
          kind: monaco.languages.CompletionItemKind.Method,
          insertText: 'ideAudio.isBeat()',
          detail: 'Transient beat detector',
          documentation: { value: 'True quando l\'energia transiente nei bassi supera la soglia dinamica di beat detection.' },
          range
        },
        {
          label: 'ideOSC.on',
          kind: monaco.languages.CompletionItemKind.Method,
          insertText: "ideOSC.on('${1:/param}', (${2:val}) => {\n  ${3}\n});",
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Listen for OSC message',
          documentation: { value: 'Registra un callback per messaggi Open Sound Control in arrivo via UDP.' },
          range
        },
        {
          label: 'ideOSC.send',
          kind: monaco.languages.CompletionItemKind.Method,
          insertText: "ideOSC.send('${1:/synth/freq}', ${2:440.0});",
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Send OSC message over UDP',
          documentation: { value: 'Invia un pacchetto binario OSC su rete UDP verso Max/MSP, PureData, Ableton Live o SuperCollider.' },
          range
        },
        {
          label: 'p5-webgl-shader-sketch',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: [
            'let myShader;',
            '',
            'async function preload() {',
            '  myShader = await ideShader.load(this, "effect.vert", "effect.frag");',
            '}',
            '',
            'function setup() {',
            '  createCanvas(1280, 720, WEBGL);',
            '  pixelDensity(1);',
            '  noStroke();',
            '}',
            '',
            'function draw() {',
            '  shader(myShader);',
            '  ideShader.bindStandardUniforms(myShader, this);',
            '  rect(-width / 2, -height / 2, width, height);',
            '}'
          ].join('\n'),
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Full audio-reactive WebGL Shader sketch boilerplate',
          range
        }
      ];

      return { suggestions };
    }
  });

  // Register Hover Documentation with Direct Official Reference Links
  monaco.languages.registerHoverProvider('javascript', {
    provideHover: (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const w = word.word;

      // 1. Check IDE APIs
      const ideDocs = {
        ideAudio: [
          '### `ideAudio` (Dual-Mode Audio Reactive Engine)',
          'Fornisce acquisizione audio hardware da microfono/loopback e analisi FFT offline deterministica sincronizzata frame-by-frame.',
          '',
          '- `ideAudio.getRMS()`: Livello RMS globale (0.0 - 1.0)',
          '- `ideAudio.getEnergy(band)`: Energia per bande (`sub`, `bass`, `lowMid`, `mid`, `highMid`, `treble`)',
          '- `ideAudio.getFFT()`: Spettro delle frequenze a 1024 bin',
          '- `ideAudio.getWaveform()`: Forma d\'onda temporale oscilloscopio a 1024 campioni',
          '- `ideAudio.isBeat()`: Rilevatore di beat e picchi transienti',
          '- `ideAudio.getTexture(p5)`: Texture WebGL audio 1024x2 per shader'
        ].join('\n'),
        ideShader: [
          '### `ideShader` (GLSL Shader Hot-Reloader & Uniform Helper)',
          '',
          '- `ideShader.load(p5, vert, frag)`: Carica, risolve `#include` ricorsivi e registra per l\'hot-reloading senza riavviare la pagina.',
          '- `ideShader.bindStandardUniforms(shader, p5)`: Associa automaticamente tutti gli uniform standard (`u_resolution`, `u_time`, `u_delta`, `u_frame`, `u_mouse`, `u_audioTex`, `u_rms`, `u_bass`, etc.).',
          '- `ideShader.hotReloadAll()`: Forza la ricompilazione immediata di tutti gli shader attivi.'
        ].join('\n'),
        ideOSC: [
          '### `ideOSC` (Bidirectional UDP Open Sound Control Engine)',
          '',
          '- `ideOSC.on(address, callback)`: Ascolta messaggi OSC via UDP in tempo reale.',
          '- `ideOSC.bindUniforms(shader, mapping)`: Mappa automaticamente indirizzi OSC a uniform dello shader.',
          '- `ideOSC.send(address, ...args)`: Invia messaggi OSC su porta UDP esterna.'
        ].join('\n')
      };

      if (ideDocs[w]) {
        return {
          range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          contents: [{ value: ideDocs[w] }]
        };
      }

      // 2. Check p5.js Reference Documentation
      const ref = P5_REFERENCE_DOCS[w];
      if (ref) {
        const markdown = [
          `### \`p5.${w}\``,
          ref.desc,
          '',
          `**Sintassi:** \`${ref.syntax}\``,
          '',
          `[📖 Apri Reference Ufficiale p5.js (Online)](https://p5js.org/reference/#/p5/${w})`
        ].join('\n');

        return {
          range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          contents: [{ value: markdown }]
        };
      }

      return null;
    }
  });
}

/**
 * Curated dictionary of p5.js functions with official documentation, syntax and reference URLs
 */
export const P5_REFERENCE_DOCS = {
  createCanvas: {
    syntax: 'createCanvas(width, height, [renderer])',
    desc: 'Crea l\'elemento `<canvas>` principale nel documento e ne imposta le dimensioni in pixel e la modalità di rendering (`P2D` o `WEBGL`).'
  },
  resizeCanvas: {
    syntax: 'resizeCanvas(width, height)',
    desc: 'Ridimensiona la tela del canvas senza distruggere lo stato p5.js corrente.'
  },
  pixelDensity: {
    syntax: 'pixelDensity([val])',
    desc: 'Imposta o restituisce la densità dei pixel per schermi ad alta risoluzione Retina / HiDPI.'
  },
  frameRate: {
    syntax: 'frameRate([fps])',
    desc: 'Imposta o restituisce il frame rate target dell\'animazione per secondo (default 60).'
  },
  background: {
    syntax: 'background(color, [a]) | background(r, g, b, [a])',
    desc: 'Imposta il colore di sfondo per il canvas di disegno e cancella i frame precedenti.'
  },
  clear: {
    syntax: 'clear()',
    desc: 'Cancella tutti i pixel del canvas rendendolo completamente trasparente.'
  },
  fill: {
    syntax: 'fill(v1, [v2], [v3], [a])',
    desc: 'Imposta il colore di riempimento per tutte le forme geometriche e testi disegnati successivamente.'
  },
  noFill: {
    syntax: 'noFill()',
    desc: 'Disabilita il riempimento geometrico delle forme.'
  },
  stroke: {
    syntax: 'stroke(v1, [v2], [v3], [a])',
    desc: 'Imposta il colore del bordo/tratto per linee e perimetri delle forme.'
  },
  noStroke: {
    syntax: 'noStroke()',
    desc: 'Disabilita il disegno del contorno per tutte le forme successive.'
  },
  strokeWeight: {
    syntax: 'strokeWeight(weight)',
    desc: 'Imposta lo spessore della linea e dei contorni in pixel.'
  },
  circle: {
    syntax: 'circle(x, y, d)',
    desc: 'Disegna un cerchio date le coordinate del centro `(x, y)` e il diametro `d`.'
  },
  rect: {
    syntax: 'rect(x, y, w, h, [tl], [tr], [br], [bl])',
    desc: 'Disegna un rettangolo alle coordinate `(x, y)` con larghezza `w` e altezza `h` e raggio degli angoli opzionale.'
  },
  square: {
    syntax: 'square(x, y, s)',
    desc: 'Disegna un quadrato alle coordinate `(x, y)` con lato di lunghezza `s`.'
  },
  ellipse: {
    syntax: 'ellipse(x, y, w, [h])',
    desc: 'Disegna un\'ellisse alle coordinate `(x, y)` con larghezza `w` e altezza `h`.'
  },
  line: {
    syntax: 'line(x1, y1, x2, y2)',
    desc: 'Traccia un segmento lineare tra due punti `(x1, y1)` e `(x2, y2)`.'
  },
  point: {
    syntax: 'point(x, y, [z])',
    desc: 'Disegna un singolo punto nello spazio 2D o 3D.'
  },
  triangle: {
    syntax: 'triangle(x1, y1, x2, y2, x3, y3)',
    desc: 'Disegna un triangolo collegando tre vertici.'
  },
  quad: {
    syntax: 'quad(x1, y1, x2, y2, x3, y3, x4, y4)',
    desc: 'Disegna un quadrilatero collegando quattro vertici bidimensionali.'
  },
  arc: {
    syntax: 'arc(x, y, w, h, start, stop, [mode])',
    desc: 'Disegna un arco lungo il perimetro di un\'ellisse.'
  },
  beginShape: {
    syntax: 'beginShape([kind])',
    desc: 'Inizia la registrazione di una forma geometrica complessa definita da vertici multipli.'
  },
  endShape: {
    syntax: 'endShape([mode])',
    desc: 'Conclude la definizione della forma custom; passando `CLOSE` chiude il perimetro tornando al vertice iniziale.'
  },
  vertex: {
    syntax: 'vertex(x, y, [z], [u], [v])',
    desc: 'Aggiunge un vertice alla forma corrente in coordinate 2D o 3D, opzionalmente con coordinate UV di texture.'
  },
  curveVertex: {
    syntax: 'curveVertex(x, y, [z])',
    desc: 'Specifica le coordinate per una spline Catmull-Rom continua tra vertici.'
  },
  push: {
    syntax: 'push()',
    desc: 'Salva lo stato corrente delle trasformazioni matriciali, degli stili di disegno e delle impostazioni di colore sullo stack.'
  },
  pop: {
    syntax: 'pop()',
    desc: 'Ripristina il precedente stato di trasformazione e stile salvato con `push()`.'
  },
  translate: {
    syntax: 'translate(x, y, [z])',
    desc: 'Trasla l\'origine del sistema di coordinate cartesiane.'
  },
  rotate: {
    syntax: 'rotate(angle, [axis])',
    desc: 'Ruota il sistema di coordinate dell\'angolo specificato.'
  },
  rotateX: {
    syntax: 'rotateX(rad)',
    desc: 'Ruota la matrice intorno all\'asse X (solo in modalità WEBGL).'
  },
  rotateY: {
    syntax: 'rotateY(rad)',
    desc: 'Ruota la matrice intorno all\'asse Y (solo in modalità WEBGL).'
  },
  rotateZ: {
    syntax: 'rotateZ(rad)',
    desc: 'Ruota la matrice intorno all\'asse Z.'
  },
  scale: {
    syntax: 'scale(s, [y], [z])',
    desc: 'Ridimensiona le coordinate del canvas lungo gli assi.'
  },
  shader: {
    syntax: 'shader(s)',
    desc: 'Attiva un vertex/fragment shader personalizzato per il rendering WebGL.'
  },
  resetShader: {
    syntax: 'resetShader()',
    desc: 'Disattiva lo shader personalizzato e ripristina il renderer WebGL predefinito di p5.js.'
  },
  loadShader: {
    syntax: 'loadShader(vertFilename, fragFilename)',
    desc: 'Carica file vertex e fragment shader asincronamente (generalmente dentro `preload()`).'
  },
  createShader: {
    syntax: 'createShader(vertSrc, fragSrc)',
    desc: 'Compila direttamente una coppia di codice sorgente vertex e fragment shader da stringa in memoria.'
  },
  createGraphics: {
    syntax: 'createGraphics(w, h, [renderer])',
    desc: 'Crea un buffer grafico offscreen (FBO / render target) separato dal canvas principale.'
  },
  createFramebuffer: {
    syntax: 'createFramebuffer([options])',
    desc: 'Crea un WebGL Framebuffer ad alte prestazioni per post-processing e multipass rendering.'
  },
  orbitControl: {
    syntax: 'orbitControl([sensitivityX], [sensitivityY], [sensitivityZ])',
    desc: 'Consente la rotazione, pan e zoom interattivo della telecamera 3D tramite mouse o trackpad.'
  },
  box: {
    syntax: 'box([width], [height], [depth])',
    desc: 'Disegna un cubo o parallelepipedo tridimensionale 3D (WEBGL).'
  },
  sphere: {
    syntax: 'sphere([radius], [detailX], [detailY])',
    desc: 'Disegna una sfera tridimensionale 3D (WEBGL).'
  },
  plane: {
    syntax: 'plane([width], [height])',
    desc: 'Disegna un piano bidimensionale nello spazio 3D (WEBGL).'
  },
  torus: {
    syntax: 'torus([radius], [tubeRadius], [detailX], [detailY])',
    desc: 'Disegna un toro tridimensionale 3D (WEBGL).'
  },
  map: {
    syntax: 'map(value, start1, stop1, start2, stop2, [withinBounds])',
    desc: 'Rimappa un valore numerico da un intervallo di origine `[start1, stop1]` a un intervallo di destinazione `[start2, stop2]`.'
  },
  lerp: {
    syntax: 'lerp(start, stop, amt)',
    desc: 'Esegue un\'interpolazione lineare tra due numeri in base al fattore `amt` (0.0 - 1.0).'
  },
  constrain: {
    syntax: 'constrain(n, low, high)',
    desc: 'Limita un valore numerico all\'interno dell\'intervallo `[low, high]`.'
  },
  dist: {
    syntax: 'dist(x1, y1, x2, y2)',
    desc: 'Calcola la distanza euclidea tra due punti nello spazio cartesiano.'
  },
  random: {
    syntax: 'random([min], [max])',
    desc: 'Genera un numero pseudo-casuale float distribuito uniformemente.'
  },
  noise: {
    syntax: 'noise(x, [y], [z])',
    desc: 'Restituisce il valore del rumore coerente di Perlin alle coordinate fornite.'
  },
  sin: {
    syntax: 'sin(angle)',
    desc: 'Calcola il seno trigonometrico dell\'angolo fornito.'
  },
  cos: {
    syntax: 'cos(angle)',
    desc: 'Calcola il coseno trigonometrico dell\'angolo fornito.'
  },
  radians: {
    syntax: 'radians(degrees)',
    desc: 'Converte un angolo espresso in gradi nel corrispondente valore in radianti.'
  },
  degrees: {
    syntax: 'degrees(radians)',
    desc: 'Converte un valore in radianti nel corrispondente angolo in gradi.'
  },
  createVector: {
    syntax: 'createVector([x], [y], [z])',
    desc: 'Crea una nuova istanza di vettore `p5.Vector` euclideo.'
  },
  width: {
    syntax: 'width',
    desc: 'Variabile di sistema contenente la larghezza attuale del canvas in pixel.'
  },
  height: {
    syntax: 'height',
    desc: 'Variabile di sistema contenente l\'altezza attuale del canvas in pixel.'
  },
  frameCount: {
    syntax: 'frameCount',
    desc: 'Variabile di sistema che conta il numero di frame renderizzati dall\'avvio dello sketch.'
  },
  deltaTime: {
    syntax: 'deltaTime',
    desc: 'Millisecondi trascorsi tra il frame precedente e il frame corrente.'
  },
  mouseX: {
    syntax: 'mouseX',
    desc: 'Coordinata orizzontale X corrente del puntatore del mouse rispetto al canvas.'
  },
  mouseY: {
    syntax: 'mouseY',
    desc: 'Coordinata verticale Y corrente del puntatore del mouse rispetto al canvas.'
  },
  mouseIsPressed: {
    syntax: 'mouseIsPressed',
    desc: 'Variabile booleana di sistema: `true` quando un pulsante del mouse è premuto.'
  }
};
