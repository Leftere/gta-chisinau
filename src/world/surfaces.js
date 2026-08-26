/**
 * Ground-plane materials: asphalt, paving, grass, water.
 *
 * Road textures are drawn so that U spans the entire carriageway (0 = left kerb,
 * 1 = right kerb) and V runs along the road in metres. That means one texture
 * serves every width — the lane markings always land in the right place, whether
 * the street is 6m or 15m across.
 */
import * as THREE from 'three'
import { canvas, hash, fbm, grain, toTexture, normalFromHeight, TEX } from './textures.js'

const grey = v => `rgb(${v | 0},${v | 0},${v | 0})`
const rgb = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`
export const ROAD_TILE_LEN = 12   // metres of road per texture repeat

function asphaltBase (a, h, r, S, seed) {
  a.fillStyle = grey(64); a.fillRect(0, 0, S, S)
  h.fillStyle = grey(140); h.fillRect(0, 0, S, S)
  r.fillStyle = grey(0.82 * 255); r.fillRect(0, 0, S, S)
  // aggregate speckle
  for (let y = 0; y < S; y += 2) {
    for (let x = 0; x < S; x += 2) {
      const n = fbm(x / 6, y / 6, 3, seed)
      const v = 44 + n * 46
      a.fillStyle = `rgb(${v},${v * 0.99},${v * 0.96})`
      a.fillRect(x, y, 2, 2)
      const hv = 120 + n * 60
      h.fillStyle = grey(hv); h.fillRect(x, y, 2, 2)
    }
  }
  // repair patches
  for (let i = 0; i < 5; i++) {
    const x = hash(i, 2, seed) * S, y = hash(i, 3, seed) * S
    const w = 40 + hash(i, 4, seed) * 130, hh = 30 + hash(i, 5, seed) * 90
    a.fillStyle = `rgba(${30 + hash(i, 6, seed) * 30},${30 + hash(i, 6, seed) * 28},${30 + hash(i, 6, seed) * 26},0.5)`
    a.fillRect(x, y, w, hh)
  }
  // cracks
  a.strokeStyle = 'rgba(24,24,24,0.55)'
  for (let i = 0; i < 7; i++) {
    a.lineWidth = 0.8 + hash(i, 8, seed) * 1.6
    a.beginPath()
    let x = hash(i, 9, seed) * S, y = hash(i, 10, seed) * S
    a.moveTo(x, y)
    for (let s = 0; s < 7; s++) {
      x += (hash(i * 9 + s, 11, seed) - 0.5) * 70
      y += (hash(i * 9 + s, 12, seed) - 0.5) * 70
      a.lineTo(x, y)
    }
    a.stroke()
  }
}

/** Draws one carriageway texture for a given lane count. */
function drawRoad (lanes, oneway, seed) {
  const S = TEX
  const alb = canvas(), hgt = canvas(), rgh = canvas()
  const a = alb.getContext('2d'), h = hgt.getContext('2d'), r = rgh.getContext('2d')
  asphaltBase(a, h, r, S, seed)

  // Polished wheel tracks: two darker, smoother bands per lane.
  for (let l = 0; l < lanes; l++) {
    const c = ((l + 0.5) / lanes) * S
    const laneW = S / lanes
    for (const off of [-laneW * 0.22, laneW * 0.22]) {
      const g = a.createLinearGradient(c + off - laneW * 0.14, 0, c + off + laneW * 0.14, 0)
      g.addColorStop(0, 'rgba(30,30,32,0)')
      g.addColorStop(0.5, 'rgba(30,30,32,0.34)')
      g.addColorStop(1, 'rgba(30,30,32,0)')
      a.fillStyle = g
      a.fillRect(c + off - laneW * 0.14, 0, laneW * 0.28, S)
      r.fillStyle = 'rgba(140,140,140,0.5)'
      r.fillRect(c + off - laneW * 0.1, 0, laneW * 0.2, S)
    }
  }

  const paint = (x, w, dashed, colour = 'rgba(232,230,220,0.88)') => {
    a.fillStyle = colour
    h.fillStyle = grey(168)
    r.fillStyle = grey(0.62 * 255)
    if (!dashed) {
      a.fillRect(x - w / 2, 0, w, S)
      h.fillRect(x - w / 2, 0, w, S)
      r.fillRect(x - w / 2, 0, w, S)
    } else {
      // 4m line, 8m gap, at ROAD_TILE_LEN metres per repeat
      const dash = (4 / ROAD_TILE_LEN) * S
      a.fillRect(x - w / 2, 0, w, dash)
      h.fillRect(x - w / 2, 0, w, dash)
      r.fillRect(x - w / 2, 0, w, dash)
    }
  }

  const lineW = Math.max(2.5, S * 0.006)
  if (lanes >= 2) {
    for (let i = 1; i < lanes; i++) {
      const x = (i / lanes) * S
      const isCentre = !oneway && i === lanes / 2
      if (isCentre) {
        paint(x - lineW * 1.2, lineW, false)
        paint(x + lineW * 1.2, lineW, false)
      } else {
        paint(x, lineW, true)
      }
    }
  }
  // kerb edge lines
  paint(S * 0.022, lineW, false, 'rgba(225,223,214,0.7)')
  paint(S * 0.978, lineW, false, 'rgba(225,223,214,0.7)')

  grain(a, S, 0.07, 1, seed + 3)
  return { alb, hgt, rgh }
}

/** Unmarked surface for service roads, alleys and car parks. */
function drawPlainAsphalt (seed) {
  const S = TEX
  const alb = canvas(), hgt = canvas(), rgh = canvas()
  const a = alb.getContext('2d'), h = hgt.getContext('2d'), r = rgh.getContext('2d')
  asphaltBase(a, h, r, S, seed)
  grain(a, S, 0.08, 1, seed)
  return { alb, hgt, rgh }
}

/**
 * Paving slabs. Warm buff rather than concrete grey.
 *
 * Chisinau's central pavements are sand-coloured stone, not the neutral concrete
 * the first pass assumed — the boulevard in front of Gemeni is noticeably warmer
 * than the asphalt beside it, and that contrast is most of what separates
 * footway from carriageway at a glance.
 */
function drawPaving (seed) {
  const S = TEX
  const alb = canvas(), hgt = canvas(), rgh = canvas()
  const a = alb.getContext('2d'), h = hgt.getContext('2d'), r = rgh.getContext('2d')
  a.fillStyle = rgb(192, 163, 128); a.fillRect(0, 0, S, S)
  h.fillStyle = grey(190); h.fillRect(0, 0, S, S)
  r.fillStyle = grey(0.8 * 255); r.fillRect(0, 0, S, S)
  const n = 6, cell = S / n
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const t = hash(x, y, seed) * 22 - 11
      const v = 196 + t
      // Pushed much warmer than the target looks on paper. Measured on a sunlit
      // footway, the blue sky bounce and ACES together compress the red-blue
      // spread by roughly 3.7x, so an albedo that samples correct as buff
      // renders as plain grey stone.
      a.fillStyle = `rgb(${v},${v * 0.845},${v * 0.665})`
      a.fillRect(x * cell + 1.5, y * cell + 1.5, cell - 3, cell - 3)
      h.fillStyle = grey(205 + t * 0.4)
      h.fillRect(x * cell + 1.5, y * cell + 1.5, cell - 3, cell - 3)
    }
  }
  grain(a, S, 0.09, 1, seed + 1)
  return { alb, hgt, rgh }
}

function drawGrass (seed, dark = 0) {
  const S = TEX
  const alb = canvas(), hgt = canvas(), rgh = canvas()
  const a = alb.getContext('2d'), h = hgt.getContext('2d'), r = rgh.getContext('2d')
  r.fillStyle = grey(0.95 * 255); r.fillRect(0, 0, S, S)
  for (let y = 0; y < S; y += 2) {
    for (let x = 0; x < S; x += 2) {
      const n = fbm(x / 14, y / 14, 4, seed) * 0.6 + fbm(x / 3, y / 3, 2, seed + 9) * 0.4
      const g = (92 + n * 74) * (1 - dark * 0.28)
      a.fillStyle = `rgb(${g * 0.66},${g},${g * 0.44})`
      a.fillRect(x, y, 2, 2)
      h.fillStyle = grey(110 + n * 90); h.fillRect(x, y, 2, 2)
    }
  }
  // bare patches
  for (let i = 0; i < 14; i++) {
    const x = hash(i, 21, seed) * S, y = hash(i, 22, seed) * S
    const rad = 8 + hash(i, 23, seed) * 34
    const g = a.createRadialGradient(x, y, 0, x, y, rad)
    g.addColorStop(0, 'rgba(122,106,74,0.5)')
    g.addColorStop(1, 'rgba(122,106,74,0)')
    a.fillStyle = g; a.beginPath(); a.arc(x, y, rad, 0, 7); a.fill()
  }
  grain(a, S, 0.1, 1, seed + 4)
  return { alb, hgt, rgh }
}

function drawDirt (seed) {
  const S = TEX
  const alb = canvas(), hgt = canvas(), rgh = canvas()
  const a = alb.getContext('2d'), h = hgt.getContext('2d'), r = rgh.getContext('2d')
  r.fillStyle = grey(0.92 * 255); r.fillRect(0, 0, S, S)
  for (let y = 0; y < S; y += 2) {
    for (let x = 0; x < S; x += 2) {
      const n = fbm(x / 20, y / 20, 4, seed)
      const v = 56 + n * 40
      a.fillStyle = `rgb(${v},${v * 0.92},${v * 0.77})`
      a.fillRect(x, y, 2, 2)
      h.fillStyle = grey(120 + n * 70); h.fillRect(x, y, 2, 2)
    }
  }
  grain(a, S, 0.1, 1, seed)
  return { alb, hgt, rgh }
}

/** Inner-block courtyard: patchy asphalt with grass and worn earth showing through. */
function drawCourtyard (seed) {
  const S = TEX
  const alb = canvas(), hgt = canvas(), rgh = canvas()
  const a = alb.getContext('2d'), h = hgt.getContext('2d'), r = rgh.getContext('2d')
  r.fillStyle = grey(0.9 * 255); r.fillRect(0, 0, S, S)
  for (let y = 0; y < S; y += 2) {
    for (let x = 0; x < S; x += 2) {
      const patch = fbm(x / 46, y / 46, 4, seed)
      const fine = fbm(x / 7, y / 7, 3, seed + 11)
      let cr, cg, cb
      if (patch > 0.56) {                     // grass
        const g = 62 + fine * 46
        cr = g * 0.6; cg = g; cb = g * 0.42
      } else if (patch > 0.42) {              // trodden earth
        const g = 88 + fine * 42
        cr = g; cg = g * 0.88; cb = g * 0.7
      } else {                                // old asphalt
        const g = 66 + fine * 32
        cr = g; cg = g * 0.99; cb = g * 0.96
      }
      a.fillStyle = `rgb(${cr},${cg},${cb})`
      a.fillRect(x, y, 2, 2)
      h.fillStyle = grey(110 + fine * 70); h.fillRect(x, y, 2, 2)
    }
  }
  grain(a, S, 0.12, 1, seed)
  return { alb, hgt, rgh }
}

function make (draw, tile, extra = {}, normalStrength = 2.0) {
  const { alb, hgt, rgh } = draw
  const mat = new THREE.MeshStandardMaterial({
    map: toTexture(alb, 1, 1, true),
    normalMap: toTexture(normalFromHeight(hgt, normalStrength)),
    roughnessMap: toTexture(rgh),
    roughness: 1, metalness: 0.02,
    vertexColors: true,
    ...extra,
  })
  mat.userData.tile = tile
  return mat
}

let cache = null

export function surfaceMaterials () {
  if (cache) return cache
  const roads = {}
  for (const lanes of [2, 3, 4, 6]) {
    roads[lanes] = make(drawRoad(lanes, false, 100 + lanes), { w: 1, h: ROAD_TILE_LEN })
  }
  roads.plain = make(drawPlainAsphalt(140), { w: 1, h: ROAD_TILE_LEN })

  cache = {
    roads,
    paving: make(drawPaving(160), { w: 2.4, h: 2.4 }),
    grass: make(drawGrass(180), { w: 6, h: 6 }),
    forest: make(drawGrass(190, 1), { w: 7, h: 7 }),
    dirt: make(drawDirt(200), { w: 9, h: 9 }),
    courtyard: make(drawCourtyard(210), { w: 11, h: 11 }),
    water: new THREE.MeshPhysicalMaterial({
      color: 0x2b4a52, roughness: 0.08, metalness: 0.0,
      transmission: 0, reflectivity: 0.6, envMapIntensity: 1.6, vertexColors: true,
    }),
  }
  cache.water.userData.tile = { w: 8, h: 8 }
  return cache
}
