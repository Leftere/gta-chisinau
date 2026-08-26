/**
 * Every surface in the city is painted here, at runtime, into a canvas.
 *
 * Photoreal rendering normally means shipping gigabytes of scanned material.
 * We have a 4GB GPU, so instead each family of surface gets a small tiling PBR
 * set — albedo, roughness and a normal map derived from a height pass — drawn
 * procedurally and repeated at true world scale. A "tile" is measured in metres,
 * so a floor really is 3.1m tall and a window bay really is ~3m wide.
 */
import * as THREE from 'three'

const TEX = 512

function canvas (size = TEX) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return c
}

// ------------------------------------------------------------------- noise

/** Deterministic hash so the city looks identical on every load. */
function hash (x, y, seed = 0) {
  let h = x * 374761393 + y * 668265263 + seed * 1442695040888963407
  h = (h ^ (h >> 13)) * 1274126177
  return ((h ^ (h >> 16)) >>> 0) / 4294967295
}

function valueNoise (x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed)
  const c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed)
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

function fbm (x, y, octaves = 4, seed = 0) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 17) * amp
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}

/** Sprays fine grain over the whole canvas — kills the "vector art" flatness. */
function grain (ctx, size, amount, scale = 1, seed = 0) {
  const img = ctx.getImageData(0, 0, size, size, { willReadFrequently: true })
  const d = img.data
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = (fbm(x / (4 * scale), y / (4 * scale), 3, seed) - 0.5) * amount * 255
      const i = (y * size + x) * 4
      d[i] = Math.max(0, Math.min(255, d[i] + n))
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n))
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n))
    }
  }
  ctx.putImageData(img, 0, 0)
}

/** Vertical dirt streaks under sills and ledges — the cheapest realism there is. */
function weather (ctx, size, strength = 0.25, seed = 3) {
  ctx.save()
  for (let i = 0; i < 120; i++) {
    const x = hash(i, 7, seed) * size
    const y = hash(i, 11, seed) * size
    const h = (0.05 + hash(i, 13, seed) * 0.35) * size
    const w = 1 + hash(i, 17, seed) * 3
    const g = ctx.createLinearGradient(0, y, 0, y + h)
    g.addColorStop(0, `rgba(40,36,30,${strength})`)
    g.addColorStop(1, 'rgba(40,36,30,0)')
    ctx.fillStyle = g
    ctx.fillRect(x, y, w, h)
  }
  ctx.restore()
}

// ------------------------------------------------------------- map plumbing

function toTexture (cv, repeatX = 1, repeatY = 1, srgb = false) {
  const t = new THREE.CanvasTexture(cv)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeatX, repeatY)
  t.anisotropy = 8
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Sobel-filters a greyscale height canvas into a tangent-space normal map. */
function normalFromHeight (heightCanvas, strength = 2.2) {
  const size = heightCanvas.width
  const src = heightCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, size, size).data
  const out = canvas(size)
  const octx = out.getContext('2d')
  const img = octx.createImageData(size, size)
  const d = img.data
  const at = (x, y) => src[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      const len = Math.hypot(dx, dy, 1)
      const i = (y * size + x) * 4
      d[i] = ((-dx / len) * 0.5 + 0.5) * 255
      d[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255
      d[i + 2] = ((1 / len) * 0.5 + 0.5) * 255
      d[i + 3] = 255
    }
  }
  octx.putImageData(img, 0, 0)
  return out
}

/** Builds a flat greyscale canvas, for painting height or roughness into. */
function greyCanvas (value, size = TEX) {
  const cv = canvas(size)
  const ctx = cv.getContext('2d')
  const v = Math.round(value * 255)
  ctx.fillStyle = `rgb(${v},${v},${v})`
  ctx.fillRect(0, 0, size, size)
  return cv
}

export { canvas, hash, fbm, valueNoise, grain, weather, toTexture, normalFromHeight, greyCanvas, TEX }
