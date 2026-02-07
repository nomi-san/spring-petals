// Scene entry point: mounts the background + WebGL canvas and orchestrates all FX layers.
import background_img from '../assets/background.webp'
import { createFogLayer } from './layers/fog-layer'
import { createPulseMaskLayer } from './layers/pulse-mask'
import { createSakuraLayer } from './layers/petal-particles'
import { createWindLayer } from './layers/flying-layers'

const referenceSize = { width: 1920, height: 1080 }
// All FX logic is authored in 1920x1080 coordinates. This keeps positions stable when scaling.
const targetFps: 15 | 24 | 30 | 60 | null = 24

// Bootstraps the scene and starts the render loop.
export function initScene(rootSelector = '#app') {
  const app = document.querySelector<HTMLDivElement>(rootSelector)
  if (!app) throw new Error('Missing root element')

  app.innerHTML = `
    <div class="scene" role="img" aria-label="Dynamic background">
      <img class="scene__bg" src="${background_img}" alt="" />
      <canvas class="scene__fx" aria-hidden="true"></canvas>
    </div>
  `

  // Transparent WebGL canvas sits on top of the static background image.
  const canvas = app.querySelector<HTMLCanvasElement>('.scene__fx')!
  if (!canvas) throw new Error('Missing canvas')

  // WebGL2 is required for instanced drawing used by particles.
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: true })!
  if (!gl) throw new Error('WebGL2 not supported')

  // Each layer returns a draw() function; some also expose a ready Promise for async texture loading.
  const windLayer = createWindLayer(gl, referenceSize)
  const fogLayer = createFogLayer(gl, referenceSize)
  const pulseMaskLayer = createPulseMaskLayer(gl, referenceSize)
  const sakuraLayer = createSakuraLayer(gl, referenceSize)

  // Enable alpha blending so transparent sprites and fog overlay correctly.
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

  // Wait for texture-backed layers before starting the loop.
  Promise.all([windLayer.ready, pulseMaskLayer.ready, sakuraLayer.ready]).then(() => {
    const start = performance.now()
    let lastFrameTime = 0
    const minFrameTime = targetFps ? 1000 / targetFps : 0
    const render = (now: number) => {
      if (minFrameTime > 0 && now - lastFrameTime < minFrameTime) {
        requestAnimationFrame(render)
        return
      }
      lastFrameTime = now
      // Keep canvas resolution in sync with CSS size and device pixel ratio.
      resizeCanvas()
      const t = (now - start) * 0.001
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)

      // Draw order matters: wind overlays, then fog, then foreground petals.
      pulseMaskLayer.draw(t)
      fogLayer.draw(t)
      windLayer.draw(t)
      sakuraLayer.draw(t)

      requestAnimationFrame(render)
    }

    requestAnimationFrame(render)
  })

  // Update drawing buffer size to match layout size.
  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const { width, height } = canvas.getBoundingClientRect()
    const targetWidth = Math.max(1, Math.round(width * dpr))
    const targetHeight = Math.max(1, Math.round(height * dpr))
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth
      canvas.height = targetHeight
    }
  }

  window.addEventListener('resize', resizeCanvas)
}
