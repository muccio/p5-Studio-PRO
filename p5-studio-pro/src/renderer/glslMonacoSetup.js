import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

/**
 * Configure Monaco Editor with complete GLSL language support,
 * custom syntax highlighting, autocomplete for built-in functions & IDE uniforms,
 * and live compiler error markers.
 */
export function setupGLSLSupport() {
  // Register 'glsl' language ID
  monaco.languages.register({
    id: 'glsl',
    extensions: ['.frag', '.vert', '.glsl', '.fs', '.vs'],
    aliases: ['GLSL', 'glsl', 'shader']
  });

  // GLSL Syntax Tokenizer
  monaco.languages.setMonarchTokensProvider('glsl', {
    defaultToken: '',
    tokenPostfix: '.glsl',

    keywords: [
      'attribute', 'const', 'uniform', 'varying', 'break', 'continue', 'do', 'for', 'while',
      'if', 'else', 'in', 'out', 'inout', 'true', 'false', 'discard', 'return',
      'precision', 'highp', 'mediump', 'lowp', 'struct'
    ],

    types: [
      'float', 'int', 'void', 'bool', 'mat2', 'mat3', 'mat4',
      'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'bvec2', 'bvec3', 'bvec4',
      'sampler2D', 'samplerCube', 'sampler3D', 'sampler2DShadow'
    ],

    builtins: [
      'radians', 'degrees', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
      'pow', 'exp', 'log', 'exp2', 'log2', 'sqrt', 'inversesqrt',
      'abs', 'sign', 'floor', 'ceil', 'fract', 'mod', 'min', 'max', 'clamp',
      'mix', 'step', 'smoothstep', 'length', 'distance', 'dot', 'cross',
      'normalize', 'faceforward', 'reflect', 'refract', 'matrixCompMult',
      'lessThan', 'lessThanEqual', 'greaterThan', 'greaterThanEqual',
      'equal', 'notEqual', 'any', 'all', 'not', 'texture2D', 'texture2DProj',
      'texture2DLod', 'texture2DProjLod', 'textureCube', 'textureCubeLod',
      'dFdx', 'dFdy', 'fwidth'
    ],

    ideUniforms: [
      'u_resolution', 'u_time', 'u_delta', 'u_frame', 'u_mouse',
      'u_rms', 'u_sub', 'u_bass', 'u_lowMid', 'u_mid', 'u_highMid', 'u_treble',
      'u_audioTex'
    ],

    operators: [
      '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=',
      '&&', '||', '++', '--', '+', '-', '*', '/', '&', '|', '^', '%',
      '<<', '>>', '+=', '-=', '*=', '/=', '&=', '|=', '^=', '%=', '<<=', '>>='
    ],

    symbols: /[=><!~?:&|+\-*\/\^%]+/,

    tokenizer: {
      root: [
        // Identifiers & Keywords
        [/[a-zA-Z_]\w*/, {
          cases: {
            '@keywords': 'keyword',
            '@types': 'type',
            '@builtins': 'predefined',
            '@ideUniforms': 'variable.predefined',
            '@default': 'identifier'
          }
        }],

        // Preprocessor (#include, #define, etc.)
        [/^\s*#\s*\w+/, 'meta.preprocessor'],

        // Whitespace & Comments
        { include: '@whitespace' },

        // Delimiters and operators
        [/[{}()\[\]]/, '@brackets'],
        [/@symbols/, {
          cases: {
            '@operators': 'operator',
            '@default': ''
          }
        }],

        // Numbers
        [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
        [/0[xX][0-9a-fA-F]+/, 'number.hex'],
        [/\d+/, 'number'],

        // Strings (for #include "path.glsl")
        [/"([^"\\]|\\.)*"/, 'string'],
        [/'([^'\\]|\\.)*'/, 'string']
      ],

      whitespace: [
        [/[ \t\r\n]+/, 'white'],
        [/\/\*/, 'comment', '@comment'],
        [/\/\/.*$/, 'comment']
      ],

      comment: [
        [/[^\/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[\/*]/, 'comment']
      ]
    }
  });

  // GLSL Autocomplete Provider
  monaco.languages.registerCompletionItemProvider('glsl', {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      };

      const suggestions = [
        // IDE Standard Uniforms
        {
          label: 'u_audioTex',
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: 'u_audioTex',
          detail: 'uniform sampler2D u_audioTex (1024x2 Audio FFT & Waveform)',
          documentation: 'Row 0 (y=0.25): FFT Frequency Spectrum\nRow 1 (y=0.75): Waveform Oscilloscope',
          range
        },
        {
          label: 'u_resolution',
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: 'u_resolution',
          detail: 'uniform vec2 u_resolution (width, height in pixels)',
          range
        },
        {
          label: 'u_time',
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: 'u_time',
          detail: 'uniform float u_time (seconds elapsed)',
          range
        },
        {
          label: 'u_delta',
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: 'u_delta',
          detail: 'uniform float u_delta (frame delta time in seconds)',
          range
        },
        {
          label: 'u_frame',
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: 'u_frame',
          detail: 'uniform int u_frame (current frameCount)',
          range
        },
        {
          label: 'u_mouse',
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: 'u_mouse',
          detail: 'uniform vec2 u_mouse (normalized mouse coords 0.0 - 1.0)',
          range
        },
        {
          label: 'u_bass',
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: 'u_bass',
          detail: 'uniform float u_bass (60 - 250 Hz energy: 0.0 to 1.0)',
          range
        },
        {
          label: 'u_rms',
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: 'u_rms',
          detail: 'uniform float u_rms (Root Mean Square overall audio volume: 0.0 to 1.0)',
          range
        },
        {
          label: 'u_mid',
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: 'u_mid',
          detail: 'uniform float u_mid (500 - 2000 Hz energy: 0.0 to 1.0)',
          range
        },
        {
          label: 'u_treble',
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: 'u_treble',
          detail: 'uniform float u_treble (4000 - 20000 Hz energy: 0.0 to 1.0)',
          range
        },
        // Common Snippets
        {
          label: 'sampleAudioFFT',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'float fftVal = texture2D(u_audioTex, vec2(${1:uv.x}, 0.25)).r;',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Sample FFT frequency bin from u_audioTex (0.0 - 1.0)',
          range
        },
        {
          label: 'sampleAudioWave',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'float waveVal = (texture2D(u_audioTex, vec2(${1:uv.x}, 0.75)).r - 0.5) * 2.0;',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Sample Waveform amplitude from u_audioTex (-1.0 to 1.0)',
          range
        },
        {
          label: '#include',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: '#include "${1:common.glsl}"',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Include external GLSL module',
          range
        }
      ];

      return { suggestions };
    }
  });
}

/**
 * Update Monaco Editor model markers for live GLSL compiler diagnostics
 */
export function setModelDiagnostics(editor, errors = []) {
  const model = editor.getModel();
  if (!model) return;

  const markers = errors.map((err) => {
    const line = Math.max(1, Math.min(model.getLineCount(), err.line || 1));
    const maxCol = model.getLineMaxColumn(line);

    return {
      severity: monaco.MarkerSeverity.Error,
      message: err.message || 'Shader compilation error',
      startLineNumber: line,
      startColumn: 1,
      endLineNumber: line,
      endColumn: maxCol
    };
  });

  monaco.editor.setModelMarkers(model, 'glsl-compiler', markers);
}

export function clearModelDiagnostics(editor) {
  const model = editor.getModel();
  if (model) {
    monaco.editor.setModelMarkers(model, 'glsl-compiler', []);
  }
}
