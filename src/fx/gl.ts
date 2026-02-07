export type LoadedTexture = {
  texture: WebGLTexture
  width: number
  height: number
}

export function createShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Unable to create shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(log ?? 'Shader compile error')
  }
  return shader
}

export function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const program = gl.createProgram()
  if (!program) throw new Error('Unable to create program')
  const vShader = createShader(gl, gl.VERTEX_SHADER, vs)
  const fShader = createShader(gl, gl.FRAGMENT_SHADER, fs)
  gl.attachShader(program, vShader)
  gl.attachShader(program, fShader)
  gl.linkProgram(program)
  gl.deleteShader(vShader)
  gl.deleteShader(fShader)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(log ?? 'Program link error')
  }
  return program
}

export function loadTexture(gl: WebGL2RenderingContext, url: string) {
  return new Promise<LoadedTexture>((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      const texture = gl.createTexture()
      if (!texture) {
        reject(new Error('Unable to create texture'))
        return
      }
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
      gl.bindTexture(gl.TEXTURE_2D, null)
      resolve({ texture, width: image.width, height: image.height })
    }
    image.onerror = () => reject(new Error(`Failed to load ${url}`))
    image.src = url
  })
}
