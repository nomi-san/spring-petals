import { createProgram } from '../gl'

type ReferenceSize = { width: number; height: number }

type FogFlow = {
  start: [number, number]
  end: [number, number]
  height: number
  speed?: number
  density?: number
  feather?: number
}

type FogRenderer = {
  draw: (time: number) => void
  setFlow: (flow: Partial<FogFlow>) => void
}

const vertexSource = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

const fragmentSource = `#version 300 es
precision mediump float;
in vec2 vUv;
out vec4 outColor;
uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uStart;
uniform vec2 uEnd;
uniform float uHeight;
uniform float uSpeed;
uniform float uDensity;
uniform float uFeather;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
  vec2 p = vec2(vUv.x * uResolution.x, vUv.y * uResolution.y);
  float minX = min(uStart.x, uEnd.x);
  float maxX = max(uStart.x, uEnd.x);
  float spanX = max(maxX - minX, 1.0);
  float t = clamp((p.x - minX) / spanX, 0.0, 1.0);
  float centerY = mix(uStart.y, uEnd.y, 0.5);
  float dist = abs(p.y - centerY);
  float halfH = uHeight * 0.5;
  float band = 1.0 - smoothstep(halfH, halfH + uFeather, dist);
  float endFade = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.92, 1.0, t));

  float flowCoord = p.x - minX;
  float n = noise(vec2(flowCoord * 0.02 - uTime * uSpeed, p.y * 0.015 + uTime * 0.04));
  float mist = smoothstep(0.35, 0.75, n);

  float alpha = mist * band * endFade * uDensity;
  vec3 color = mix(vec3(0.85, 0.9, 0.95), vec3(0.7, 0.8, 0.9), mist);
  outColor = vec4(color, alpha);
}
`

export function createFogLayer(
  gl: WebGL2RenderingContext,
  referenceSize: ReferenceSize,
  flow: FogFlow = { start: [0, 0], end: [940, 0], height: 260, speed: 0.45, density: 0.2, feather: 300 },
): FogRenderer {
  const program = createProgram(gl, vertexSource, fragmentSource)
  const aPosition = gl.getAttribLocation(program, 'aPosition')
  const uTime = gl.getUniformLocation(program, 'uTime')
  const uResolution = gl.getUniformLocation(program, 'uResolution')
  const uStart = gl.getUniformLocation(program, 'uStart')
  const uEnd = gl.getUniformLocation(program, 'uEnd')
  const uHeight = gl.getUniformLocation(program, 'uHeight')
  const uSpeed = gl.getUniformLocation(program, 'uSpeed')
  const uDensity = gl.getUniformLocation(program, 'uDensity')
  const uFeather = gl.getUniformLocation(program, 'uFeather')

  const quadBuffer = gl.createBuffer()
  if (!quadBuffer) throw new Error('Unable to create fog buffer')

  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      1, 1,
    ]),
    gl.STATIC_DRAW,
  )

  const draw = (time: number) => {
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
    gl.enableVertexAttribArray(aPosition)
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 8, 0)
    gl.uniform1f(uTime, time)
    gl.uniform2f(uResolution, referenceSize.width, referenceSize.height)
    gl.uniform2f(uStart, flow.start[0], flow.start[1])
    gl.uniform2f(uEnd, flow.end[0], flow.end[1])
    gl.uniform1f(uHeight, flow.height)
    gl.uniform1f(uSpeed, flow.speed ?? 0.45)
    gl.uniform1f(uDensity, flow.density ?? 0.35)
    gl.uniform1f(uFeather, flow.feather ?? flow.height * 0.5)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  const setFlow = (next: Partial<FogFlow>) => {
    flow = {
      ...flow,
      ...next,
    }
  }

  return { draw, setFlow }
}
