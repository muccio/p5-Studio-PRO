import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { conf as htmlConf, language as htmlLanguage } from 'monaco-editor/esm/vs/basic-languages/html/html.js';
import { conf as cssConf, language as cssLanguage } from 'monaco-editor/esm/vs/basic-languages/css/css.js';

/**
 * Configure Monaco Editor with complete HTML, CSS, JavaScript, and p5.js
 * syntax highlighting, autocomplete suggestions, hover hints, and type definitions.
 */
export function setupWebAndScriptSupport() {
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
          detail: 'Embedded style tag',
          range
        },
        {
          label: 'link:css',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: '<link rel="stylesheet" href="${1:style.css}">',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'External stylesheet link',
          range
        }
      ];

      return { suggestions };
    }
  });

  monaco.languages.registerHoverProvider('html', {
    provideHover: (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const tagDocs = {
        canvas: '**`<canvas>`**: Container used to draw graphics on the fly via JavaScript (2D or WebGL context).',
        script: '**`<script>`**: Used to embed or reference executable client-side code.',
        style: '**`<style>`**: Contains style information and CSS rules for a document.',
        head: '**`<head>`**: Machine-readable information (metadata) container including scripts and styles.',
        body: '**`<body>`**: Represents the content of an HTML document.'
      };

      const doc = tagDocs[word.word.toLowerCase()];
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
            '  width: 100vw;',
            '  height: 100vh;',
            '  margin: 0;',
            '  padding: 0;',
            '  overflow: hidden;',
            '  background: #000000;',
            '}',
            'canvas {',
            '  width: 100vw !important;',
            '  height: 100vh !important;',
            '  display: block !important;',
            '  object-fit: contain !important;',
            '}'
          ].join('\n'),
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Full-viewport centered responsive canvas CSS',
          range
        },
        {
          label: 'flex-center',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'display: flex;\nalign-items: center;\njustify-content: center;',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Flexbox center alignment',
          range
        },
        {
          label: 'absolute-fill',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'position: absolute;\ntop: 0;\nleft: 0;\nwidth: 100%;\nheight: 100%;',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Absolute positioning fill parent',
          range
        },
        {
          label: 'no-scrollbar',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'scrollbar-width: none;\n-ms-overflow-style: none;\n&::-webkit-scrollbar { display: none; }',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Hide scrollbar across browsers',
          range
        }
      ];

      return { suggestions };
    }
  });

  monaco.languages.registerHoverProvider('css', {
    provideHover: (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const cssDocs = {
        'display': '**`display`**: Sets whether an element is treated as a block or inline box and the layout used for its children.',
        'position': '**`position`**: Sets how an element is positioned in a document (`static`, `relative`, `absolute`, `fixed`, `sticky`).',
        'overflow': '**`overflow`**: Sets the desired behavior for an element\'s content overflow (`visible`, `hidden`, `clip`, `scroll`, `auto`).',
        'object-fit': '**`object-fit`**: Sets how the content of a replaced element, such as an `<img>` or `<video>` or `<canvas>`, should be resized to fit its container (`contain`, `cover`, `fill`, `none`).'
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
    target: ts.ScriptTarget.ES2020,
    allowNonTsExtensions: true,
    alwaysStrict: false
  });

  // Type definitions for p5.js and p5-Studio-PRO Runtime
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

/** p5.js Core Lifecycle and Rendering Functions */
declare function setup(): void;
declare function draw(): void;
declare function preload(): void;
declare function windowResized(): void;
declare function mousePressed(): void;
declare function mouseReleased(): void;
declare function keyPressed(): void;

declare function createCanvas(w: number, h: number, renderer?: string): any;
declare function resizeCanvas(w: number, h: number): void;
declare function background(r: number | string, g?: number, b?: number, a?: number): void;
declare function clear(): void;
declare function fill(r: number | string, g?: number, b?: number, a?: number): void;
declare function noFill(): void;
declare function stroke(r: number | string, g?: number, b?: number, a?: number): void;
declare function noStroke(): void;
declare function strokeWeight(weight: number): void;
declare function rect(x: number, y: number, w: number, h: number): void;
declare function ellipse(x: number, y: number, w: number, h: number): void;
declare function circle(x: number, y: number, d: number): void;
declare function line(x1: number, y1: number, x2: number, y2: number): void;
declare function push(): void;
declare function pop(): void;
declare function translate(x: number, y: number, z?: number): void;
declare function rotate(angle: number): void;
declare function scale(s: number | any): void;
declare function shader(s: any): void;
declare function resetShader(): void;
declare function loadShader(vertFilename: string, fragFilename: string): any;

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
declare const mouseIsPressed: boolean;
declare const key: string;
declare const keyCode: number;
declare const WEBGL: string;
declare const P2D: string;
`;

  ts.javascriptDefaults.addExtraLib(studioTypeDefs, 'ts:p5-studio-pro.d.ts');

  // Register JavaScript completions for p5-Studio-PRO features
  monaco.languages.registerCompletionItemProvider('javascript', {
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
          range
        },
        {
          label: 'ideShader.bindStandardUniforms',
          kind: monaco.languages.CompletionItemKind.Method,
          insertText: 'ideShader.bindStandardUniforms(${1:myShader}, this);',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Bind u_resolution, u_time, u_delta, u_audioTex, u_rms, u_bass...',
          range
        },
        {
          label: 'ideAudio.getRMS',
          kind: monaco.languages.CompletionItemKind.Method,
          insertText: 'ideAudio.getRMS()',
          detail: 'Get overall audio volume (0.0 to 1.0)',
          range
        },
        {
          label: 'ideAudio.getEnergy',
          kind: monaco.languages.CompletionItemKind.Method,
          insertText: "ideAudio.getEnergy('${1|sub,bass,lowMid,mid,highMid,treble|}')",
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Get frequency band energy (0.0 to 1.0)',
          range
        },
        {
          label: 'ideOSC.on',
          kind: monaco.languages.CompletionItemKind.Method,
          insertText: "ideOSC.on('${1:/param}', (${2:val}) => {\n  ${3}\n});",
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Listen for OSC message',
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

  // Register Hover Documentation for ideAudio, ideShader, ideOSC in JavaScript
  monaco.languages.registerHoverProvider('javascript', {
    provideHover: (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const jsDocs = {
        ideAudio: [
          '### `ideAudio` (Dual-Mode Audio Reactive Engine)',
          'Provides hardware live microphone/loopback input + deterministic offline FFT analysis.',
          '',
          '- `ideAudio.getRMS()`: Overall volume (0.0 - 1.0)',
          '- `ideAudio.getEnergy(band)`: Specific frequency energy (`sub`, `bass`, `lowMid`, `mid`, `highMid`, `treble`)',
          '- `ideAudio.getFFT()`: 1024-bin frequency spectrum',
          '- `ideAudio.getWaveform()`: 1024-sample time-domain oscilloscope',
          '- `ideAudio.isBeat()`: Beat detection trigger',
          '- `ideAudio.getTexture(p5)`: WebGL dynamic 1024x2 audio data texture'
        ].join('\n'),
        ideShader: [
          '### `ideShader` (Stateful GLSL Hot-Reloader & Uniform Helper)',
          '',
          '- `ideShader.load(p5, vert, frag)`: Loads, resolves `#include` directives recursively, and registers for stateful hot-reloading.',
          '- `ideShader.bindStandardUniforms(shader, p5)`: Automatically binds `u_resolution`, `u_time`, `u_delta`, `u_frame`, `u_mouse`, `u_audioTex`, `u_rms`, `u_bass`, `u_mid`, `u_treble` every frame.'
        ].join('\n'),
        ideOSC: [
          '### `ideOSC` (Bidirectional UDP Open Sound Control Engine)',
          '',
          '- `ideOSC.on(address, callback)`: Listen to OSC messages in real-time.',
          '- `ideOSC.bindUniforms(shader, mapping)`: Directly bind OSC addresses to shader uniform variables.',
          '- `ideOSC.send(address, ...args)`: Send OSC message over UDP.'
        ].join('\n')
      };

      const doc = jsDocs[word.word];
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
