import { createProgram, loadTexture, type LoadedTexture } from '../gl'
import { rand, randRange, randSigned } from '../utils'

// Sakura petal particle layer rendered via instanced drawing.
import sakuraPetal1Url from '../../assets/petal-1.png'
import sakuraPetal2Url from '../../assets/petal-2.png'
import sakuraPetal3Url from '../../assets/petal-3.png'
import sakuraPetal4Url from '../../assets/petal-4.png'

// Per-texture particle batch rendered via instancing.
type ParticleGroup = {
  texture: WebGLTexture
  count: number
  vao: WebGLVertexArrayObject
}

type ReferenceSize = { width: number; height: number }

// Public API for the sakura particle layer.
type SakuraRenderer = {
  ready: Promise<void>
  draw: (time: number) => void
}

// Global wind settings for the petals.
const windSettings = { dir: [1, 0.15] as [number, number], amp: 18, freq: 6.0, speed: 1.4 }
// Controls spawn region, travel direction, speed, and depth-based scale boost.
const flowSettings = {
  origin: [280, 0] as [number, number],
  spread: [450, 260] as [number, number],
  direction: [1, 0.9] as [number, number],
  distance: 2000,
  speedRange: [0.035, 0.08] as [number, number],
  depthRange: [120, 760] as [number, number],
}

// Vertex shader: moves each instance along a flow path and applies 3-axis rotation.
const particleVertexSource =  /*glsl*/ `#version 300 es
in vec2 aPosition;
in vec2 aUv;
in vec2 aInstancePos;
in vec2 aInstanceVel;
in vec2 aInstanceSize;
in vec3 aInstanceRot;
in vec3 aInstanceRotSpeed;
in float aInstanceSpeed;
in float aInstanceDepth;
in float aInstanceSeed;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uWind;
uniform float uWindFreq;
uniform float uWindSpeed;
uniform float uWindAmp;
out vec2 vUv;
out float vAlpha;
out float vLife;

void main() {
  vUv = aUv;
  float progress = fract(uTime * aInstanceSpeed + aInstanceSeed);
  vec2 pos = aInstancePos + aInstanceVel * progress;

  float wind = sin((pos.y / uResolution.y) * uWindFreq + uTime * uWindSpeed + aInstanceSeed);
  pos += uWind * wind * uWindAmp;

  float scaleBoost = mix(0.6, 1.3, progress);
  vec3 local = vec3(aPosition * aInstanceSize * scaleBoost, -aInstanceDepth * progress);
  vec3 rot = aInstanceRot + aInstanceRotSpeed * uTime;

  float cx = cos(rot.x);
  float sx = sin(rot.x);
  float cy = cos(rot.y);
  float sy = sin(rot.y);
  float cz = cos(rot.z);
  float sz = sin(rot.z);

  local = vec3(local.x, local.y * cx - local.z * sx, local.y * sx + local.z * cx);
  local = vec3(local.x * cy + local.z * sy, local.y, -local.x * sy + local.z * cy);
  local = vec3(local.x * cz - local.y * sz, local.x * sz + local.y * cz, local.z);

  float perspective = 1.0 / (1.0 + local.z * 0.002);
  vec2 offset = local.xy * perspective;

  vec2 ndc = vec2((pos.x / uResolution.x) * 2.0 - 1.0, 1.0 - (pos.y / uResolution.y) * 2.0);
  vec2 ndcOffset = vec2(offset.x / uResolution.x * 2.0, -offset.y / uResolution.y * 2.0);
  gl_Position = vec4(ndc + ndcOffset, 0.0, 1.0);
  vAlpha = clamp(perspective, 0.45, 1.0);
  vLife = progress;
}
`

// Fragment shader: sample texture and apply alpha from pseudo-depth.
const particleFragmentSource = /*glsl*/ `#version 300 es
precision highp float;
in vec2 vUv;
in float vAlpha;
in float vLife;
out vec4 outColor;
uniform sampler2D uTexture;

void main() {
  vec4 color = texture(uTexture, vUv);
  float fadeOut = 1.0 - smoothstep(0.78, 0.98, vLife);
  float edgeFeather = smoothstep(0.05, 0.7, color.a);
  float alpha = color.a * edgeFeather * vAlpha * fadeOut;
  outColor = vec4(color.rgb, alpha);
}
`

// Creates the sakura particle layer. Instances are authored in 1920x1080 space.
export function createSakuraLayer(gl: WebGL2RenderingContext, referenceSize: ReferenceSize): SakuraRenderer {
  const particleProgram = createProgram(gl, particleVertexSource, particleFragmentSource)
  const pPosition = gl.getAttribLocation(particleProgram, 'aPosition')
  const pUv = gl.getAttribLocation(particleProgram, 'aUv')
  const pInstancePos = gl.getAttribLocation(particleProgram, 'aInstancePos')
  const pInstanceVel = gl.getAttribLocation(particleProgram, 'aInstanceVel')
  const pInstanceSize = gl.getAttribLocation(particleProgram, 'aInstanceSize')
  const pInstanceRot = gl.getAttribLocation(particleProgram, 'aInstanceRot')
  const pInstanceRotSpeed = gl.getAttribLocation(particleProgram, 'aInstanceRotSpeed')
  const pInstanceSpeed = gl.getAttribLocation(particleProgram, 'aInstanceSpeed')
  const pInstanceDepth = gl.getAttribLocation(particleProgram, 'aInstanceDepth')
  const pInstanceSeed = gl.getAttribLocation(particleProgram, 'aInstanceSeed')
  const uPTexture = gl.getUniformLocation(particleProgram, 'uTexture')
  const uPResolution = gl.getUniformLocation(particleProgram, 'uResolution')
  const uPTime = gl.getUniformLocation(particleProgram, 'uTime')
  const uPWind = gl.getUniformLocation(particleProgram, 'uWind')
  const uPWindFreq = gl.getUniformLocation(particleProgram, 'uWindFreq')
  const uPWindSpeed = gl.getUniformLocation(particleProgram, 'uWindSpeed')
  const uPWindAmp = gl.getUniformLocation(particleProgram, 'uWindAmp')

  // Quad used for each instanced sprite.
  const particleQuadBuffer = gl.createBuffer()
  if (!particleQuadBuffer) throw new Error('Unable to create particle buffer')

  gl.bindBuffer(gl.ARRAY_BUFFER, particleQuadBuffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -0.5, -0.5, 0, 0,
      0.5, -0.5, 1, 0,
      -0.5, 0.5, 0, 1,
      0.5, 0.5, 1, 1,
    ]),
    gl.STATIC_DRAW,
  )

  let particleGroups: ParticleGroup[] = []

  // Build a single particle group with per-instance attributes.
  function createParticleGroup(texture: LoadedTexture, options: { count: number; scale: number }) {
    const vao = gl.createVertexArray()
    const instanceBuffer = gl.createBuffer()
    if (!vao || !instanceBuffer) throw new Error('Unable to create particle buffers')

    const floatsPerInstance = 15
    const data = new Float32Array(options.count * floatsPerInstance)
    const baseSize = Math.max(18, Math.min(texture.width, texture.height) * options.scale)
    const dirLength = Math.hypot(flowSettings.direction[0], flowSettings.direction[1]) || 1
    const dir = [flowSettings.direction[0] / dirLength, flowSettings.direction[1] / dirLength]
    const travel = [dir[0] * flowSettings.distance, dir[1] * flowSettings.distance]

    for (let i = 0; i < options.count; i += 1) {
      const size = baseSize * randRange(0.7, 1.3)
      const posX = flowSettings.origin[0] + rand() * flowSettings.spread[0]
      const posY = flowSettings.origin[1] + rand() * flowSettings.spread[1]
      const velX = travel[0] + randSigned(120)
      const velY = travel[1] + randSigned(120)
      const rotX = randRange(0, Math.PI * 2)
      const rotY = randRange(0, Math.PI * 2)
      const rotZ = randRange(0, Math.PI * 2)
      const rotSpeedX = randSigned(1.6)
      const rotSpeedY = randSigned(1.6)
      const rotSpeedZ = randSigned(2.6)
      const speed = randRange(flowSettings.speedRange[0], flowSettings.speedRange[1])
      const depth = randRange(flowSettings.depthRange[0], flowSettings.depthRange[1])
      const seed = randRange(0, Math.PI * 2)

      const baseIndex = i * floatsPerInstance
      data[baseIndex + 0] = posX
      data[baseIndex + 1] = posY
      data[baseIndex + 2] = velX
      data[baseIndex + 3] = velY
      data[baseIndex + 4] = size
      data[baseIndex + 5] = size
      data[baseIndex + 6] = rotX
      data[baseIndex + 7] = rotY
      data[baseIndex + 8] = rotZ
      data[baseIndex + 9] = rotSpeedX
      data[baseIndex + 10] = rotSpeedY
      data[baseIndex + 11] = rotSpeedZ
      data[baseIndex + 12] = speed
      data[baseIndex + 13] = depth
      data[baseIndex + 14] = seed
    }

    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, particleQuadBuffer)
    gl.enableVertexAttribArray(pPosition)
    gl.vertexAttribPointer(pPosition, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(pUv)
    gl.vertexAttribPointer(pUv, 2, gl.FLOAT, false, 16, 8)

    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    const stride = floatsPerInstance * 4
    gl.enableVertexAttribArray(pInstancePos)
    gl.vertexAttribPointer(pInstancePos, 2, gl.FLOAT, false, stride, 0)
    gl.vertexAttribDivisor(pInstancePos, 1)
    gl.enableVertexAttribArray(pInstanceVel)
    gl.vertexAttribPointer(pInstanceVel, 2, gl.FLOAT, false, stride, 8)
    gl.vertexAttribDivisor(pInstanceVel, 1)
    gl.enableVertexAttribArray(pInstanceSize)
    gl.vertexAttribPointer(pInstanceSize, 2, gl.FLOAT, false, stride, 16)
    gl.vertexAttribDivisor(pInstanceSize, 1)
    gl.enableVertexAttribArray(pInstanceRot)
    gl.vertexAttribPointer(pInstanceRot, 3, gl.FLOAT, false, stride, 24)
    gl.vertexAttribDivisor(pInstanceRot, 1)
    gl.enableVertexAttribArray(pInstanceRotSpeed)
    gl.vertexAttribPointer(pInstanceRotSpeed, 3, gl.FLOAT, false, stride, 36)
    gl.vertexAttribDivisor(pInstanceRotSpeed, 1)
    gl.enableVertexAttribArray(pInstanceSpeed)
    gl.vertexAttribPointer(pInstanceSpeed, 1, gl.FLOAT, false, stride, 48)
    gl.vertexAttribDivisor(pInstanceSpeed, 1)
    gl.enableVertexAttribArray(pInstanceDepth)
    gl.vertexAttribPointer(pInstanceDepth, 1, gl.FLOAT, false, stride, 52)
    gl.vertexAttribDivisor(pInstanceDepth, 1)
    gl.enableVertexAttribArray(pInstanceSeed)
    gl.vertexAttribPointer(pInstanceSeed, 1, gl.FLOAT, false, stride, 56)
    gl.vertexAttribDivisor(pInstanceSeed, 1)

    gl.bindVertexArray(null)
    return { texture: texture.texture, count: options.count, vao }
  }

  // Load all petal/flower textures and build instanced batches.
  const ready = Promise.all([
    loadTexture(gl, sakuraPetal1Url),
    loadTexture(gl, sakuraPetal2Url),
    loadTexture(gl, sakuraPetal3Url),
    loadTexture(gl, sakuraPetal4Url),
  ]).then(
    ([sakuraPetal1, sakuraPetal2, sakuraPetal3, sakuraPetal4]) => {
      particleGroups = [
        createParticleGroup(sakuraPetal1, { count: 10, scale: 0.05 }),
        createParticleGroup(sakuraPetal2, { count: 10, scale: 0.05 }),
        createParticleGroup(sakuraPetal3, { count: 10, scale: 0.05 }),
        createParticleGroup(sakuraPetal4, { count: 10, scale: 0.05 }),
      ]
    },
  )

  // Draw all particle batches for the current time.
  const draw = (time: number) => {
    if (!particleGroups.length) return
    gl.useProgram(particleProgram)
    gl.uniform2f(uPResolution, referenceSize.width, referenceSize.height)
    gl.uniform1f(uPTime, time)
    gl.uniform2f(uPWind, windSettings.dir[0], windSettings.dir[1])
    gl.uniform1f(uPWindFreq, windSettings.freq)
    gl.uniform1f(uPWindSpeed, windSettings.speed)
    gl.uniform1f(uPWindAmp, windSettings.amp)

    particleGroups.forEach((group) => {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, group.texture)
      gl.uniform1i(uPTexture, 0)
      gl.bindVertexArray(group.vao)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, group.count)
    })

    gl.bindVertexArray(null)
  }

  return { ready, draw }
}
