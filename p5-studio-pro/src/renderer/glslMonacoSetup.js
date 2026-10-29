import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

/**
 * All supported shader extensions recognized across p5-Studio-PRO
 */
export const SHADER_EXTENSIONS = new Set([
  'frag', 'vert', 'glsl', 'fs', 'vs', 'fsh', 'vsh', 'shader',
  'geom', 'comp', 'tesc', 'tese', 'glslf', 'glslv'
]);

export function isShaderFile(filenameOrExt) {
  if (!filenameOrExt) return false;
  const ext = filenameOrExt.includes('.') ? filenameOrExt.split('.').pop().toLowerCase() : filenameOrExt.toLowerCase();
  return SHADER_EXTENSIONS.has(ext);
}

/**
 * Built-in GLSL documentation dictionary for Hover and Autocomplete
 */
export const GLSL_DOCS = {
  // Built-in functions
  radians: { sig: 'float radians(float degrees)', doc: 'Converts degrees to radians: $\\text{rad} = \\text{deg} \\times \\frac{\\pi}{180}$' },
  degrees: { sig: 'float degrees(float radians)', doc: 'Converts radians to degrees: $\\text{deg} = \\text{rad} \\times \\frac{180}{\\pi}$' },
  sin: { sig: 'genType sin(genType angle)', doc: 'Returns the trigonometric sine of the angle in radians.' },
  cos: { sig: 'genType cos(genType angle)', doc: 'Returns the trigonometric cosine of the angle in radians.' },
  tan: { sig: 'genType tan(genType angle)', doc: 'Returns the tangent of the angle in radians: $\\frac{\\sin(x)}{\\cos(x)}$' },
  asin: { sig: 'genType asin(genType x)', doc: 'Arc sine: returns angle in radians whose sine is x.' },
  acos: { sig: 'genType acos(genType x)', doc: 'Arc cosine: returns angle in radians whose cosine is x.' },
  atan: { sig: 'genType atan(genType y, genType x) / atan(genType y_over_x)', doc: 'Arc tangent: returns angle in radians of vector (x, y).' },
  pow: { sig: 'genType pow(genType x, genType y)', doc: 'Returns $x$ raised to the power of $y$ ($x^y$). Result is undefined if $x < 0$.' },
  exp: { sig: 'genType exp(genType x)', doc: 'Returns the natural exponential function $e^x$.' },
  log: { sig: 'genType log(genType x)', doc: 'Returns the natural logarithm $\\ln(x)$. Undefined if $x \\le 0$.' },
  exp2: { sig: 'genType exp2(genType x)', doc: 'Returns 2 raised to the power $x$ ($2^x$).' },
  log2: { sig: 'genType log2(genType x)', doc: 'Returns the base-2 logarithm $\\log_2(x)$. Undefined if $x \\le 0$.' },
  sqrt: { sig: 'genType sqrt(genType x)', doc: 'Returns the square root $\\sqrt{x}$. Undefined if $x < 0$.' },
  inversesqrt: { sig: 'genType inversesqrt(genType x)', doc: 'Returns $\\frac{1}{\\sqrt{x}}$. Undefined if $x \\le 0$.' },
  abs: { sig: 'genType abs(genType x)', doc: 'Returns absolute value $|x|$.' },
  sign: { sig: 'genType sign(genType x)', doc: 'Returns 1.0 if $x > 0$, 0.0 if $x == 0$, and -1.0 if $x < 0$.' },
  floor: { sig: 'genType floor(genType x)', doc: 'Returns the largest integer less than or equal to $x$.' },
  ceil: { sig: 'genType ceil(genType x)', doc: 'Returns the smallest integer greater than or equal to $x$.' },
  fract: { sig: 'genType fract(genType x)', doc: 'Returns the fractional part: $x - \\lfloor x \\rfloor$.' },
  mod: { sig: 'genType mod(genType x, float/genType y)', doc: 'Modulus: $x - y \\times \\lfloor x / y \\rfloor$.' },
  min: { sig: 'genType min(genType x, genType y)', doc: 'Returns the minimum of two values.' },
  max: { sig: 'genType max(genType x, genType y)', doc: 'Returns the maximum of two values.' },
  clamp: { sig: 'genType clamp(genType x, genType minVal, genType maxVal)', doc: 'Constrains $x$ between $minVal$ and $maxVal$: $\\min(\\max(x, minVal), maxVal)$.' },
  mix: { sig: 'genType mix(genType x, genType y, genType a)', doc: 'Linear interpolation between $x$ and $y$: $x \\times (1 - a) + y \\times a$.' },
  step: { sig: 'genType step(genType edge, genType x)', doc: 'Returns 0.0 if $x < edge$, otherwise 1.0.' },
  smoothstep: { sig: 'genType smoothstep(genType edge0, genType edge1, genType x)', doc: 'Hermite interpolation between 0.0 and 1.0 if $edge0 < x < edge1$.' },
  length: { sig: 'float length(genType x)', doc: 'Returns the Euclidean length of vector $x$: $\\sqrt{x_0^2 + x_1^2 + \\dots}$.' },
  distance: { sig: 'float distance(genType p0, genType p1)', doc: 'Returns the distance between two points: $\\text{length}(p0 - p1)$.' },
  dot: { sig: 'float dot(genType x, genType y)', doc: 'Returns the scalar dot product of two vectors: $x_0 y_0 + x_1 y_1 + \\dots$.' },
  cross: { sig: 'vec3 cross(vec3 x, vec3 y)', doc: 'Returns the cross product of two 3D vectors.' },
  normalize: { sig: 'genType normalize(genType x)', doc: 'Returns vector with length 1.0 in same direction: $\\frac{x}{\\text{length}(x)}$.' },
  reflect: { sig: 'genType reflect(genType I, genType N)', doc: 'Calculates the reflection direction for an incident vector: $I - 2.0 \\times \\text{dot}(N, I) \\times N$.' },
  refract: { sig: 'genType refract(genType I, genType N, float eta)', doc: 'Calculates refraction vector using Snell\'s law.' },
  matrixCompMult: { sig: 'mat matrixCompMult(mat x, mat y)', doc: 'Component-wise multiplication of two matrices.' },
  texture2D: { sig: 'vec4 texture2D(sampler2D sampler, vec2 coord)', doc: 'Samples a 2D texture at normalized coordinates (0.0 to 1.0).' },
  textureCube: { sig: 'vec4 textureCube(samplerCube sampler, vec3 coord)', doc: 'Samples a cube map texture using a 3D direction vector.' },
  dFdx: { sig: 'genType dFdx(genType p)', doc: 'Derivative in screen x direction (standard derivative extension).' },
  dFdy: { sig: 'genType dFdy(genType p)', doc: 'Derivative in screen y direction (standard derivative extension).' },
  fwidth: { sig: 'genType fwidth(genType p)', doc: 'Sum of absolute derivatives: $|\\text{dFdx}(p)| + |\\text{dFdy}(p)|$.' },

  // Built-in Variables
  gl_Position: { sig: 'vec4 gl_Position', doc: 'Vertex shader clip-space output position.' },
  gl_PointSize: { sig: 'float gl_PointSize', doc: 'Vertex shader output point rasterization size in pixels.' },
  gl_FragColor: { sig: 'vec4 gl_FragColor', doc: 'Fragment shader output color (RGBA, 0.0 to 1.0).' },
  gl_FragCoord: { sig: 'vec4 gl_FragCoord', doc: 'Fragment window relative coordinates $(x, y, z, 1/w)$.' },
  gl_PointCoord: { sig: 'vec2 gl_PointCoord', doc: 'Fragment coordinate within a point primitive (0.0 to 1.0).' },

  // p5-Studio-PRO Standard Uniforms
  u_resolution: {
    sig: 'uniform vec2 u_resolution',
    doc: '### Canvas Dimensions in Pixels\n`u_resolution.x` = Canvas width\n`u_resolution.y` = Canvas height\n\n```glsl\nvec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);\n```'
  },
  u_time: {
    sig: 'uniform float u_time',
    doc: '### Deterministic Time in Seconds\nElapsed execution time in seconds. In lockstep video export, updates at exact $1/\\text{fps}$ intervals with zero jitter.\n\n```glsl\nfloat wave = sin(u_time * 2.0);\n```'
  },
  u_delta: {
    sig: 'uniform float u_delta',
    doc: '### Frame Delta Time\nTime elapsed since the previous frame in seconds (e.g. $0.01666$ for 60 FPS).'
  },
  u_frame: {
    sig: 'uniform int u_frame',
    doc: '### Deterministic Frame Counter\nMonotonically increasing integer frame count (0, 1, 2, ...). Strictly locked during offline video export.'
  },
  u_mouse: {
    sig: 'uniform vec4 u_mouse',
    doc: '### Mouse Coordinates and State\n- `xy`: Current mouse coordinates normalized to canvas ($0.0$ to $1.0$).\n- `z`: Mouse button state ($1.0$ when pressed, $0.0$ when released).\n- `w`: Click trigger pulse.'
  },
  u_audioTex: {
    sig: 'uniform sampler2D u_audioTex',
    doc: '### WebGL Dynamic Audio Texture ($1024 \\times 2$)\n- **Row 0 ($y = 0.25$):** 1024-bin normalized FFT frequency spectrum ($0.0$ to $1.0$).\n- **Row 1 ($y = 0.75$):** 1024-sample normalized time-domain waveform (oscilloscope).\n\n```glsl\nfloat fft = texture2D(u_audioTex, vec2(uv.x, 0.25)).r;\nfloat wave = (texture2D(u_audioTex, vec2(uv.x, 0.75)).r - 0.5) * 2.0;\n```'
  },
  u_rms: {
    sig: 'uniform float u_rms',
    doc: '### Root Mean Square Audio Loudness\nNormalized overall audio volume from $0.0$ (silent) to $1.0$ (peak saturation).'
  },
  u_sub: {
    sig: 'uniform float u_sub',
    doc: '### Sub-Bass Energy Band (20 - 60 Hz)\nNormalized energy for deep sub-bass frequencies ($0.0$ to $1.0$).'
  },
  u_bass: {
    sig: 'uniform float u_bass',
    doc: '### Bass Energy Band (60 - 250 Hz)\nNormalized energy for kick drums and basslines ($0.0$ to $1.0$).'
  },
  u_lowMid: {
    sig: 'uniform float u_lowMid',
    doc: '### Low-Mid Energy Band (250 - 500 Hz)\nNormalized energy for low-mid harmonic content ($0.0$ to $1.0$).'
  },
  u_mid: {
    sig: 'uniform float u_mid',
    doc: '### Midrange Energy Band (500 - 2000 Hz)\nNormalized energy for vocals, synths, and lead instruments ($0.0$ to $1.0$).'
  },
  u_highMid: {
    sig: 'uniform float u_highMid',
    doc: '### High-Mid Energy Band (2000 - 4000 Hz)\nNormalized energy for snare attacks and vocal harmonics ($0.0$ to $1.0$).'
  },
  u_treble: {
    sig: 'uniform float u_treble',
    doc: '### Treble Energy Band (4000 - 20000 Hz)\nNormalized energy for hi-hats, cymbals, and top-end sparkle ($0.0$ to $1.0$).'
  }
};

/**
 * Configure Monaco Editor with complete GLSL language support,
 * custom syntax highlighting, autocomplete for built-in functions & IDE uniforms,
 * hover tooltips, and live compiler error markers.
 */
export function setupGLSLSupport() {
  // Register 'glsl' language ID with all shader extensions
  monaco.languages.register({
    id: 'glsl',
    extensions: [
      '.frag', '.vert', '.glsl', '.fs', '.vs',
      '.fsh', '.vsh', '.shader', '.comp', '.geom',
      '.tesc', '.tese', '.glslf', '.glslv'
    ],
    aliases: ['GLSL', 'glsl', 'shader', 'Shader']
  });

  // GLSL Syntax Tokenizer (Monarch)
  monaco.languages.setMonarchTokensProvider('glsl', {
    defaultToken: '',
    tokenPostfix: '.glsl',

    keywords: [
      'attribute', 'const', 'uniform', 'varying', 'break', 'continue', 'do', 'for', 'while',
      'if', 'else', 'in', 'out', 'inout', 'true', 'false', 'discard', 'return',
      'precision', 'highp', 'mediump', 'lowp', 'struct', 'layout', 'centroid', 'flat',
      'smooth', 'noperspective', 'invariant', 'patch', 'sample', 'subroutine', 'coherent',
      'volatile', 'restrict', 'readonly', 'writeonly', 'atomic_uint'
    ],

    types: [
      'float', 'int', 'uint', 'void', 'bool', 'double',
      'vec2', 'vec3', 'vec4', 'dvec2', 'dvec3', 'dvec4', 'bvec2', 'bvec3', 'bvec4',
      'ivec2', 'ivec3', 'ivec4', 'uvec2', 'uvec3', 'uvec4',
      'mat2', 'mat3', 'mat4', 'mat2x2', 'mat2x3', 'mat2x4',
      'mat3x2', 'mat3x3', 'mat3x4', 'mat4x2', 'mat4x3', 'mat4x4',
      'sampler2D', 'samplerCube', 'sampler3D', 'sampler2DShadow', 'samplerCubeShadow',
      'sampler2DArray', 'sampler2DArrayShadow', 'isampler2D', 'usampler2D'
    ],

    builtins: [
      'radians', 'degrees', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
      'pow', 'exp', 'log', 'exp2', 'log2', 'sqrt', 'inversesqrt',
      'abs', 'sign', 'floor', 'ceil', 'fract', 'mod', 'min', 'max', 'clamp',
      'mix', 'step', 'smoothstep', 'length', 'distance', 'dot', 'cross',
      'normalize', 'faceforward', 'reflect', 'refract', 'matrixCompMult',
      'outerProduct', 'transpose', 'determinant', 'inverse',
      'lessThan', 'lessThanEqual', 'greaterThan', 'greaterThanEqual',
      'equal', 'notEqual', 'any', 'all', 'not',
      'texture2D', 'texture2DProj', 'texture2DLod', 'texture2DProjLod',
      'textureCube', 'textureCubeLod', 'texture',
      'dFdx', 'dFdy', 'fwidth',
      'gl_Position', 'gl_PointSize', 'gl_FragColor', 'gl_FragCoord',
      'gl_FragDepth', 'gl_FrontFacing', 'gl_PointCoord', 'gl_VertexID', 'gl_InstanceID'
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

        // Swizzles: .xyzw, .rgba, .stpq
        [/(\.)([xyzw]{1,4}|[rgba]{1,4}|[stpq]{1,4})\b/, ['delimiter', 'type']],

        // Preprocessor directives (#include, #define, #version, etc.)
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

        // Numbers (floats, scientific notation, hex, ints)
        [/\d*\.\d+([eE][\-+]?\d+)?f?/, 'number.float'],
        [/0[xX][0-9a-fA-F]+/, 'number.hex'],
        [/\d+f?/, 'number'],

        // Strings (e.g. for #include "path.glsl")
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

      const suggestions = [];

      // 1. IDE Standard Uniforms
      for (const [name, meta] of Object.entries(GLSL_DOCS)) {
        if (name.startsWith('u_')) {
          suggestions.push({
            label: name,
            kind: monaco.languages.CompletionItemKind.Variable,
            insertText: name,
            detail: meta.sig,
            documentation: { value: meta.doc },
            range
          });
        }
      }

      // 2. Built-in Math & Vector Functions with Snippet Signatures
      const functionSnippets = [
        { label: 'smoothstep', insertText: 'smoothstep(${1:edge0}, ${2:edge1}, ${3:x})', detail: 'Hermite interpolation (edge0, edge1, x)' },
        { label: 'mix', insertText: 'mix(${1:x}, ${2:y}, ${3:a})', detail: 'Linear interpolation: x * (1 - a) + y * a' },
        { label: 'clamp', insertText: 'clamp(${1:x}, ${2:minVal}, ${3:maxVal})', detail: 'Constrain x between minVal and maxVal' },
        { label: 'step', insertText: 'step(${1:edge}, ${2:x})', detail: 'Step function: 0.0 if x < edge, else 1.0' },
        { label: 'length', insertText: 'length(${1:vec})', detail: 'Euclidean vector length' },
        { label: 'distance', insertText: 'distance(${1:p0}, ${2:p1})', detail: 'Euclidean distance between p0 and p1' },
        { label: 'dot', insertText: 'dot(${1:x}, ${2:y})', detail: 'Vector scalar dot product' },
        { label: 'cross', insertText: 'cross(${1:vecA}, ${2:vecB})', detail: '3D Vector cross product' },
        { label: 'normalize', insertText: 'normalize(${1:vec})', detail: 'Normalize vector to unit length' },
        { label: 'reflect', insertText: 'reflect(${1:I}, ${2:N})', detail: 'Reflect incident vector across normal' },
        { label: 'refract', insertText: 'refract(${1:I}, ${2:N}, ${3:eta})', detail: 'Refract vector using Snell\'s law' },
        { label: 'sin', insertText: 'sin(${1:x})', detail: 'Sine (radians)' },
        { label: 'cos', insertText: 'cos(${1:x})', detail: 'Cosine (radians)' },
        { label: 'tan', insertText: 'tan(${1:x})', detail: 'Tangent (radians)' },
        { label: 'atan', insertText: 'atan(${1:y}, ${2:x})', detail: 'Arc tangent of y/x' },
        { label: 'pow', insertText: 'pow(${1:base}, ${2:exp})', detail: 'Base raised to exponent' },
        { label: 'sqrt', insertText: 'sqrt(${1:x})', detail: 'Square root' },
        { label: 'fract', insertText: 'fract(${1:x})', detail: 'Fractional part: x - floor(x)' },
        { label: 'floor', insertText: 'floor(${1:x})', detail: 'Floor function' },
        { label: 'ceil', insertText: 'ceil(${1:x})', detail: 'Ceil function' },
        { label: 'mod', insertText: 'mod(${1:x}, ${2:y})', detail: 'Modulo: x - y * floor(x/y)' },
        { label: 'min', insertText: 'min(${1:a}, ${2:b})', detail: 'Minimum of two values' },
        { label: 'max', insertText: 'max(${1:a}, ${2:b})', detail: 'Maximum of two values' },
        { label: 'texture2D', insertText: 'texture2D(${1:u_audioTex}, ${2:uv})', detail: 'Sample 2D texture' }
      ];

      for (const fn of functionSnippets) {
        const meta = GLSL_DOCS[fn.label];
        suggestions.push({
          label: fn.label,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: fn.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: fn.detail,
          documentation: meta ? { value: meta.doc } : undefined,
          range
        });
      }

      // 3. Types and Qualifiers
      const types = ['vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4', 'float', 'int', 'bool', 'sampler2D', 'uniform', 'varying', 'attribute', 'const'];
      for (const t of types) {
        suggestions.push({
          label: t,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: t,
          detail: `GLSL ${t}`,
          range
        });
      }

      // 4. Creative Coding Snippets
      const snippets = [
        {
          label: 'sampleAudioFFT',
          insertText: 'float ${1:fft} = texture2D(u_audioTex, vec2(${2:uv.x}, 0.25)).r;',
          detail: 'Sample normalized FFT frequency band from u_audioTex (0.0 to 1.0)'
        },
        {
          label: 'sampleAudioWave',
          insertText: 'float ${1:wave} = (texture2D(u_audioTex, vec2(${2:uv.x}, 0.75)).r - 0.5) * 2.0;',
          detail: 'Sample normalized waveform amplitude from u_audioTex (-1.0 to 1.0)'
        },
        {
          label: 'rot2D',
          insertText: [
            'mat2 rot2D(float angle) {',
            '  float s = sin(angle);',
            '  float c = cos(angle);',
            '  return mat2(c, -s, s, c);',
            '}'
          ].join('\n'),
          detail: '2D Rotation Matrix function'
        },
        {
          label: 'palette',
          insertText: [
            '// Inigo Quilez Cosine Palette Generator',
            'vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {',
            '  return a + b * cos(6.28318 * (c * t + d));',
            '}'
          ].join('\n'),
          detail: 'Cosine Palette Generator (Inigo Quilez)'
        },
        {
          label: 'raymarch',
          insertText: [
            '// Raymarching Distance Estimator Loop',
            'float t = 0.0;',
            'for (int i = 0; i < ${1:80}; i++) {',
            '  vec3 p = ro + rd * t;',
            '  float d = map(p);',
            '  t += d;',
            '  if (d < 0.001 || t > ${2:50.0}) break;',
            '}'
          ].join('\n'),
          detail: 'Raymarching distance loop template'
        },
        {
          label: 'sdSphere',
          insertText: [
            'float sdSphere(vec3 p, float radius) {',
            '  return length(p) - radius;',
            '}'
          ].join('\n'),
          detail: 'Signed Distance Field (SDF) Sphere'
        },
        {
          label: 'sdBox',
          insertText: [
            'float sdBox(vec3 p, vec3 b) {',
            '  vec3 q = abs(p) - b;',
            '  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);',
            '}'
          ].join('\n'),
          detail: 'Signed Distance Field (SDF) Box'
        },
        {
          label: 'hash21',
          insertText: [
            'float hash21(vec2 p) {',
            '  p = fract(p * vec2(123.34, 456.21));',
            '  p += dot(p, p + 45.32);',
            '  return fract(p.x * p.y);',
            '}'
          ].join('\n'),
          detail: 'Pseudo-random 2D to 1D hash'
        },
        {
          label: '#include',
          insertText: '#include "${1:common.glsl}"',
          detail: 'Recursive GLSL #include preprocessor directive'
        },
        {
          label: 'uv_aspect',
          insertText: 'vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);',
          detail: 'Normalized centered aspect-ratio corrected UV coordinates (-1.0 to 1.0)'
        }
      ];

      for (const snip of snippets) {
        suggestions.push({
          label: snip.label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: snip.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: snip.detail,
          range
        });
      }

      return { suggestions };
    }
  });

  // GLSL Hover Documentation Provider
  monaco.languages.registerHoverProvider('glsl', {
    provideHover: (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const meta = GLSL_DOCS[word.word];
      if (meta) {
        return {
          range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          contents: [
            { value: '```glsl\n' + meta.sig + '\n```' },
            { value: meta.doc }
          ]
        };
      }
      return null;
    }
  });

  // GLSL Signature Help Provider for Function Parameter Hints
  monaco.languages.registerSignatureHelpProvider('glsl', {
    signatureHelpTriggerCharacters: ['(', ','],
    provideSignatureHelp: (model, position) => {
      const textUntilPosition = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      });

      // Find the last function call before position
      const match = textUntilPosition.match(/([a-zA-Z_]\w*)\s*\([^()]*$/);
      if (!match) return null;

      const fnName = match[1];
      const meta = GLSL_DOCS[fnName];
      if (!meta) return null;

      // Count commas to find active parameter index
      const openParenIdx = textUntilPosition.lastIndexOf('(');
      const argsText = textUntilPosition.substring(openParenIdx + 1);
      const activeParam = (argsText.match(/,/g) || []).length;

      return {
        value: {
          signatures: [
            {
              label: meta.sig,
              documentation: meta.doc,
              parameters: meta.sig.substring(meta.sig.indexOf('(') + 1, meta.sig.indexOf(')')).split(',').map(p => ({
                label: p.trim()
              }))
            }
          ],
          activeSignature: 0,
          activeParameter: activeParam
        },
        dispose: () => {}
      };
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
