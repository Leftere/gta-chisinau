/**
 * Downloads elevation for the play area and bakes it into a heightfield.
 *
 * Source is the AWS "terrarium" terrain tiles (Mapzen/Tilezen, hosted on AWS
 * Open Data) — no API key, and elevation is packed into the RGB channels as
 *   metres = R*256 + G + B/256 - 32768
 * The underlying data is ~30m SRTM, served resampled; at zoom 14 that is about
 * 6.5m per pixel at this latitude, far finer than we need.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const ORIGIN = { lat: 47.0245, lon: 28.8322 }
const ZOOM = 14
const TILE = 256

// Local metric grid, padded well past the play area so the horizon has ground.
const X0 = -1800, X1 = 1800
const Z0 = -1700, Z1 = 1600
const STEP = 8                       // metres between samples

const M_PER_DEG_LAT = 110574
const M_PER_DEG_LON = 111320 * Math.cos(ORIGIN.lat * Math.PI / 180)

const n = 2 ** ZOOM
const lonToFx = lon => ((lon + 180) / 360) * n
const latToFy = lat => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n
}

const HEADERS = { 'User-Agent': 'gta-chisinau/0.1 (hobby game project)' }

async function tilePixels (tx, ty) {
  mkdirSync('data-cache/dem', { recursive: true })
  const png = `data-cache/dem/${ZOOM}_${tx}_${ty}.png`
  const raw = `data-cache/dem/${ZOOM}_${tx}_${ty}.rgb`
  if (!existsSync(raw)) {
    if (!existsSync(png)) {
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${tx}/${ty}.png`
      const res = await fetch(url, { headers: HEADERS })
      if (!res.ok) throw new Error(`tile ${tx},${ty}: HTTP ${res.status}`)
      writeFileSync(png, Buffer.from(await res.arrayBuffer()))
    }
    // ImageMagick avoids pulling in a PNG decoder dependency.
    execFileSync('convert', [png, '-depth', '8', `rgb:${raw}`])
  }
  return readFileSync(raw)
}

async function main () {
  // Which tiles does the padded grid touch?
  const corners = [[X0, Z0], [X1, Z0], [X0, Z1], [X1, Z1]]
  let minTx = Infinity, maxTx = -Infinity, minTy = Infinity, maxTy = -Infinity
  for (const [x, z] of corners) {
    const lat = ORIGIN.lat - z / M_PER_DEG_LAT
    const lon = ORIGIN.lon + x / M_PER_DEG_LON
    const tx = Math.floor(lonToFx(lon)), ty = Math.floor(latToFy(lat))
    minTx = Math.min(minTx, tx); maxTx = Math.max(maxTx, tx)
    minTy = Math.min(minTy, ty); maxTy = Math.max(maxTy, ty)
  }
  console.log(`tiles x ${minTx}..${maxTx}  y ${minTy}..${maxTy}  (zoom ${ZOOM})`)

  const tiles = new Map()
  for (let tx = minTx; tx <= maxTx; tx++) {
    for (let ty = minTy; ty <= maxTy; ty++) {
      tiles.set(`${tx},${ty}`, await tilePixels(tx, ty))
      process.stdout.write('.')
    }
  }
  console.log(`\n${tiles.size} tiles ready`)

  /** Elevation at a global pixel coordinate, nearest tile pixel. */
  const at = (gx, gy) => {
    const tx = Math.floor(gx / TILE), ty = Math.floor(gy / TILE)
    const buf = tiles.get(`${tx},${ty}`)
    if (!buf) return null
    const px = Math.min(TILE - 1, Math.max(0, Math.floor(gx) - tx * TILE))
    const py = Math.min(TILE - 1, Math.max(0, Math.floor(gy) - ty * TILE))
    const i = (py * TILE + px) * 3
    return buf[i] * 256 + buf[i + 1] + buf[i + 2] / 256 - 32768
  }

  /** Bilinear sample, so the baked grid is smooth rather than stair-stepped. */
  const sample = (lat, lon) => {
    const gx = lonToFx(lon) * TILE, gy = latToFy(lat) * TILE
    const x0 = Math.floor(gx), y0 = Math.floor(gy)
    const fx = gx - x0, fy = gy - y0
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1)
    if (a === null || b === null || c === null || d === null) return a ?? 0
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
  }

  const nx = Math.round((X1 - X0) / STEP) + 1
  const nz = Math.round((Z1 - Z0) / STEP) + 1
  const h = new Array(nx * nz)
  let min = Infinity, max = -Infinity
  for (let j = 0; j < nz; j++) {
    const z = Z0 + j * STEP
    const lat = ORIGIN.lat - z / M_PER_DEG_LAT
    for (let i = 0; i < nx; i++) {
      const x = X0 + i * STEP
      const lon = ORIGIN.lon + x / M_PER_DEG_LON
      const e = sample(lat, lon)
      h[j * nx + i] = Math.round(e * 10) / 10
      if (e < min) min = e
      if (e > max) max = e
    }
  }

  // Heights are stored relative to the origin, so the play area sits near y=0.
  const originH = h[Math.floor(nz / 2) * nx + Math.floor(nx / 2)]
  for (let i = 0; i < h.length; i++) h[i] = Math.round((h[i] - originH) * 10) / 10

  const out = { x0: X0, z0: Z0, step: STEP, nx, nz, originH: Math.round(originH * 10) / 10, h }
  const json = JSON.stringify(out)
  // Raw DEM stays in the cache. `carve-terrain` grades it to the road network
  // and writes the version the game actually loads.
  mkdirSync('data-cache', { recursive: true })
  writeFileSync('data-cache/terrain-raw.json', json)

  console.log(`grid ${nx} x ${nz} @ ${STEP}m`)
  console.log(`elevation ${min.toFixed(1)}..${max.toFixed(1)} m ASL  (relief ${(max - min).toFixed(1)} m)`)
  console.log(`origin is ${originH.toFixed(1)} m ASL; stored heights are relative to it`)
  console.log(`-> data-cache/terrain-raw.json (${(json.length / 1e6).toFixed(2)} MB)`)
  console.log('now run: npm run build-world')
}

main().catch(e => { console.error(e.message); process.exit(1) })
