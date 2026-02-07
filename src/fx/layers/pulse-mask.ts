import { createProgram, loadTexture } from '../gl'
// Mask texture for the pulse effect.
import pulseMaskUrl from '../../assets/pulse_mask.png'

// Reference size (canvas/viewport) used to map coordinates and scale.
type ReferenceSize = { width: number; height: number }

// Internal state for the mask layer.
type PulseMaskLayer = {
  // Loaded mask texture.
  texture: WebGLTexture
  // Actual texture size.
  width: number
  height: number
  // Position in reference coordinates (top-left corner).
  x: number
  y: number
}

// Vertex shader: draw a quad and translate/scale to center the mask.
const vertexSource = /*glsl*/ `#version 300 es
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

// Fragment shader: sample mask, generate pulses and flicker for color/alpha.
const fragmentSource = /*glsl*/ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uMask;
uniform float uTime;

// Base pulse: sin -> [0..1] -> smoothstep for soft transitions.
float pulse(float t, float speed, float bias) {
  float s = sin(t * speed + bias) * 0.5 + 0.5;
  return smoothstep(0.35, 1.0, s);
}

void main() {
  float mask = texture(uMask, vUv).r;
  float maskAlpha = smoothstep(0.25, 0.95, mask);
  float basePulse = pulse(uTime, 3.2, 0.0);
  float accentPulse = pulse(uTime, 6.4, 1.6) * 0.6;
  float flicker = 0.85 + 0.15 * sin(uTime * 19.0 + vUv.y * 8.0);
  float pulseMix = clamp(basePulse + accentPulse, 0.0, 1.0);

  // Dark base color and a soft yellow glow.
  vec3 darkColor = vec3(0.0, 0.0, 0.0);
  vec3 glowColor = vec3(1.0, 0.86, 0.2);
  vec3 color = mix(darkColor, glowColor, pulseMix);
  // Alpha depends on mask, pulse intensity, and flicker.
  float alpha = maskAlpha * mix(0.18, 0.75, pulseMix) * flicker;

  outColor = vec4(color, alpha);
}
`

// Create a pulse mask layer centered in the reference space.
export function createPulseMaskLayer(gl: WebGL2RenderingContext, referenceSize: ReferenceSize) {
  const program = createProgram(gl, vertexSource, fragmentSource)
  const aPosition = gl.getAttribLocation(program, 'aPosition')
  const aUv = gl.getAttribLocation(program, 'aUv')
  const uTranslate = gl.getUniformLocation(program, 'uTranslate')
  const uScale = gl.getUniformLocation(program, 'uScale')
  const uMask = gl.getUniformLocation(program, 'uMask')
  const uTime = gl.getUniformLocation(program, 'uTime')

  // Quad as a triangle strip with UVs.
  const quadBuffer = gl.createBuffer()
  if (!quadBuffer) throw new Error('Unable to create pulse mask buffer')

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

  // Mask state after texture load.
  let layer: PulseMaskLayer | null = null

  // Load the mask texture and compute centered placement.
  const ready = loadTexture(gl, pulseMaskUrl).then((mask) => {
    layer = {
      texture: mask.texture,
      width: mask.width,
      height: mask.height,
      x: (referenceSize.width - mask.width) * 0.5,
      y: (referenceSize.height - mask.height) * 0.5,
    }
  })

  // Render one frame: set program, buffers, uniforms, then draw.
  const draw = (time: number) => {
    if (!layer) return
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
    gl.enableVertexAttribArray(aPosition)
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(aUv)
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8)

    // Compute translate/scale in NDC to center the quad.
    const centerX = layer.x + layer.width * 0.5
    const centerY = layer.y + layer.height * 0.5
    const translateX = (centerX / referenceSize.width) * 2 - 1
    const translateY = 1 - (centerY / referenceSize.height) * 2
    const scaleX = layer.width / referenceSize.width
    const scaleY = layer.height / referenceSize.height

    // Bind texture and set uniforms.
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, layer.texture)
    gl.uniform1i(uMask, 0)
    gl.uniform1f(uTime, time)
    gl.uniform2f(uTranslate, translateX, translateY)
    gl.uniform2f(uScale, scaleX, scaleY)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  return { ready, draw }
}
