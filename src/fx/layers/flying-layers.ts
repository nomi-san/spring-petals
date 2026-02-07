import { createProgram, loadTexture } from '../gl'

// Wind-driven overlay layer: applies subtle sway only inside defined rects per sprite.
import bridge_png from '../../assets/bridge.png'
import flying_1_png from '../../assets/flying-1.png'
import flying_2_png from '../../assets/flying-2.png'
import leaves_png from '../../assets/leaves.png'

// Sprite layer definition with per-rect wind zones.
type Layer = {
  texture: WebGLTexture
  width: number
  height: number
  x: number
  y: number
  // Wind amplitude in UV (x, y): maximum offset when swaying.
  // (biên độ gió theo UV (x, y): offset tối đa khi sway)
  amp: [number, number]
  // Wind frequency in UV (x, y): number of cycles along UV direction to form waves.
  // (tần số gió theo UV (x, y): số chu kỳ theo chiều UV để tạo sóng)
  freq: [number, number]
  // Wind speed over time (x, y): speed of wave propagation over time.
  // (tốc độ gió theo thời gian (x, y): tốc độ chạy của sóng theo thời gian)
  speed: [number, number]
  rects?: Array<{
    px: [number, number]
    size: [number, number]
    feather: number
  }>
  rectCount?: number
  rectData?: Float32Array
  rectFeatherData?: Float32Array
}

type ReferenceSize = { width: number; height: number }

// Toggle to visualize rect masks in the shader output.
const DEBUG_RECTS = false

// Vertex shader renders a fullscreen quad per sprite and passes UVs to the fragment shader.
const vertexSource =  /*glsl*/ `#version 300 es
in vec2 aPosition;
in vec2 aUv;
out vec2 vUv;
uniform vec2 uTranslate;
uniform vec2 uScale;
void main() {
  vUv = aUv;
  vec2 pos = aPosition * uScale + uTranslate;
  gl_Position = vec4(pos, 0.0, 1.0);
}
`

// Fragment shader: computes wind sway and masks it to rectangular regions.
const fragmentSource = /*glsl*/ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTexture;
uniform vec2 uAmp;
uniform vec2 uFreq;
uniform vec2 uSpeed;
uniform float uTime;
// Rects are provided in UV space (x, y, w, h), with optional feather for soft edges.
uniform int uRectCount;
uniform vec4 uRects[8];
uniform float uRectFeather[8];
uniform float uDebugRects;
uniform float uRectBorder;
uniform vec3 uDebugColor;

void main() {
  const float PI = 3.141592653589793;
  vec2 uv = vUv;
  if (uRectCount == 0 && uDebugRects < 0.5) {
    outColor = texture(uTexture, uv);
    return;
  }
  // Accumulate sway from all rects (combined by max/union).
  vec2 offset = vec2(0.0);
  float borderMask = 0.0;
  for (int i = 0; i < 8; i += 1) {
    if (i >= uRectCount) {
      break;
    }
    vec4 rect = uRects[i];
    vec2 rectMin = rect.xy;
    vec2 rectMax = rect.xy + rect.zw;
    float feather = uRectFeather[i];
    float insideX = smoothstep(rectMin.x - feather, rectMin.x + feather, uv.x) * (1.0 - smoothstep(rectMax.x - feather, rectMax.x + feather, uv.x));
    float insideY = smoothstep(rectMin.y - feather, rectMin.y + feather, uv.y) * (1.0 - smoothstep(rectMax.y - feather, rectMax.y + feather, uv.y));
    float rectMask = insideX * insideY;
    if (rectMask > 0.0001) {
      vec2 rectCenter = rect.xy + rect.zw * 0.5;
      float swayX = sin((rectCenter.y * uFreq.x * 2.0 * PI) + (uTime * uSpeed.x));
      float swayY = sin((rectCenter.x * uFreq.y * 2.0 * PI) + (uTime * uSpeed.y) + PI * 0.5);
      offset += vec2(swayX, swayY) * rectMask;
    }

    if (uDebugRects > 0.5) {
      float inside = step(rectMin.x, uv.x) * step(rectMin.y, uv.y) * step(uv.x, rectMax.x) * step(uv.y, rectMax.y);
      float distEdge = min(
        min(abs(uv.x - rectMin.x), abs(uv.x - rectMax.x)),
        min(abs(uv.y - rectMin.y), abs(uv.y - rectMax.y))
      );
      float rectBorder = inside * (1.0 - smoothstep(0.0, uRectBorder, distEdge));
      borderMask = max(borderMask, rectBorder);
    }
  }
  uv += offset * uAmp;
  outColor = texture(uTexture, uv);
  if (uDebugRects > 0.5) {
    vec3 borderColor = uDebugColor;
    outColor.rgb = mix(outColor.rgb, borderColor, borderMask);
    outColor.a = max(outColor.a, borderMask);
  }
}
`

// Creates the wind layer renderer. Rects are authored in sprite pixels and converted to UVs.
export function createWindLayer(gl: WebGL2RenderingContext, referenceSize: ReferenceSize) {
  const program = createProgram(gl, vertexSource, fragmentSource)
  const aPosition = gl.getAttribLocation(program, 'aPosition')
  const aUv = gl.getAttribLocation(program, 'aUv')
  const uTexture = gl.getUniformLocation(program, 'uTexture')
  const uAmp = gl.getUniformLocation(program, 'uAmp')
  const uFreq = gl.getUniformLocation(program, 'uFreq')
  const uSpeed = gl.getUniformLocation(program, 'uSpeed')
  const uTime = gl.getUniformLocation(program, 'uTime')
  const uTranslate = gl.getUniformLocation(program, 'uTranslate')
  const uScale = gl.getUniformLocation(program, 'uScale')
  const uRectCount = gl.getUniformLocation(program, 'uRectCount')
  const uRects = gl.getUniformLocation(program, 'uRects[0]')
  const uRectFeather = gl.getUniformLocation(program, 'uRectFeather[0]')
  const uDebugRects = gl.getUniformLocation(program, 'uDebugRects')
  const uRectBorder = gl.getUniformLocation(program, 'uRectBorder')
  const uDebugColor = gl.getUniformLocation(program, 'uDebugColor')

  // Fullscreen quad for mapping each sprite.
  const quadBuffer = gl.createBuffer()
  if (!quadBuffer) throw new Error('Unable to create buffer')

  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1, 0, 0,
      1, -1, 1, 0,
      -1, 1, 0, 1,
      1, 1, 1, 1,
    ]),
    gl.STATIC_DRAW,
  )

  let layers: Layer[] = []

  const maxRects = 8
  const buildRectUniforms = (layer: Layer) => {
    const rects = layer.rects ?? []
    const rectCount = Math.min(rects.length, maxRects)
    const rectData = new Float32Array(maxRects * 4)
    const rectFeather = new Float32Array(maxRects)

    for (let i = 0; i < maxRects; i += 1) {
      if (i < rectCount) {
        const rect = rects[i]
        const rectX = rect.px[0] / layer.width
        const rectY = 1 - (rect.px[1] + rect.size[1]) / layer.height
        const rectW = rect.size[0] / layer.width
        const rectH = rect.size[1] / layer.height
        rectData[i * 4 + 0] = rectX
        rectData[i * 4 + 1] = rectY
        rectData[i * 4 + 2] = rectW
        rectData[i * 4 + 3] = rectH
        rectFeather[i] = rect.feather
      } else {
        rectData[i * 4 + 0] = 0
        rectData[i * 4 + 1] = 0
        rectData[i * 4 + 2] = 0
        rectData[i * 4 + 3] = 0
        rectFeather[i] = 0
      }
    }

    layer.rectCount = rectCount
    layer.rectData = rectData
    layer.rectFeatherData = rectFeather
  }

  // Load textures for all wind-affected sprites.
  const ready = Promise.all([
    loadTexture(gl, bridge_png),
    loadTexture(gl, flying_1_png),
    loadTexture(gl, flying_2_png),
    loadTexture(gl, leaves_png),
  ]).then(
    ([bridge, flying_1, flying_2, leaves]) => {
      // Rects are defined in sprite pixels (top-left origin).
      layers = [
        {
          texture: bridge.texture,
          width: bridge.width,
          height: bridge.height,
          x: -20,
          y: 168,
          amp: [0.012, 0.004],
          freq: [8.0, 5.0],
          speed: [1.2, 0.6],
          rects: [
            { px: [0, 0], size: [145, 298], feather: 0.05 },
          ],
        },
        {
          texture: flying_1.texture,
          width: flying_1.width,
          height: flying_1.height,
          x: 107,
          y: 0,
          amp: [0.012, 0.006],
          freq: [10.0, 7.0],
          speed: [1.2, 1.2],
          rects: [
            { px: [870, 380], size: [10, 10], feather: 0.06 },
            { px: [1100, 90], size: [80, 110], feather: 0.08 },
            { px: [1310, 440], size: [74, 220], feather: 0.1 },
          ],
        },
        {
          texture: flying_2.texture,
          width: flying_2.width,
          height: flying_2.height,
          x: 300,
          y: 5,
          amp: [0.012, 0.006],
          freq: [10.0, 7.0],
          speed: [1.2, 1.6],
          rects: [
            { px: [48, 160], size: [72, 70], feather: 0.08 },
            { px: [1272, 77], size: [60, 80], feather: 0.1 },
            { px: [1459, 24], size: [57, 65], feather: 0.1 },
            { px: [1095, 495], size: [146, 108], feather: 0.03 },
            { px: [420, 295], size: [80, 60], feather: 0.08 },
          ],
        },
        {
          texture: leaves.texture,
          width: leaves.width,
          height: leaves.height,
          x: 1088,
          y: 614,
          amp: [0.02, 0.01],
          freq: [6.0, 4.0],
          speed: [1.2, 1.0],
          rects: [
            { px: [191, 204], size: [151, 96], feather: 0.05 },
            { px: [52, 70], size: [174, 87], feather: 0.05 },
            { px: [26, 5], size: [202, 66], feather: 0.05 },
            { px: [225, 45], size: [117, 135], feather: 0.05 },
          ],
        },
      ]

      layers.forEach(buildRectUniforms)
    },
  )

  // Draws all wind layers for the current time.
  const draw = (time: number) => {
    if (!layers.length) return
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
    gl.enableVertexAttribArray(aPosition)
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(aUv)
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8)

    layers.forEach((layer, index) => {
      const centerX = layer.x + layer.width * 0.5
      const centerY = layer.y + layer.height * 0.5
      const translateX = (centerX / referenceSize.width) * 2 - 1
      const translateY = 1 - (centerY / referenceSize.height) * 2
      const scaleX = layer.width / referenceSize.width
      const scaleY = layer.height / referenceSize.height
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, layer.texture)
      gl.uniform1i(uTexture, 0)
      gl.uniform2f(uAmp, layer.amp[0], layer.amp[1])
      gl.uniform2f(uFreq, layer.freq[0], layer.freq[1])
      gl.uniform2f(uSpeed, layer.speed[0], layer.speed[1])
      gl.uniform2f(uTranslate, translateX, translateY)
      gl.uniform2f(uScale, scaleX, scaleY)
      gl.uniform1f(uDebugRects, DEBUG_RECTS ? 1 : 0)
      gl.uniform1f(uRectBorder, 3 / Math.min(layer.width, layer.height))
      gl.uniform3f(uDebugColor, 0.15, 0.95, 0.25)
      const rectCount = layer.rectCount ?? 0
      gl.uniform1i(uRectCount, rectCount)
      if (layer.rectData && layer.rectFeatherData) {
        gl.uniform4fv(uRects, layer.rectData)
        gl.uniform1fv(uRectFeather, layer.rectFeatherData)
      }
      gl.uniform1f(uTime, time + index * 0.15)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    })
  }

  return { ready, draw }
}
