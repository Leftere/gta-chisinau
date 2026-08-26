/**
 * Uniform-grid broadphase over every building wall segment.
 *
 * 4600 footprints come to roughly 40k wall segments; bucketing them by 12m cell
 * means a collision query only ever tests a handful.
 */
const CELL = 12

export class WallGrid {
  constructor (footprints) {
    this.cells = new Map()
    this.segments = []
    for (const fp of footprints) {
      const ring = fp.ring
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % ring.length]
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.15) continue
        const idx = this.segments.length
        this.segments.push([a[0], a[1], b[0], b[1]])
        this._insert(idx, a, b)
      }
    }
  }

  _key (cx, cz) { return cx * 100003 + cz }

  _insert (idx, a, b) {
    const minX = Math.floor(Math.min(a[0], b[0]) / CELL)
    const maxX = Math.floor(Math.max(a[0], b[0]) / CELL)
    const minZ = Math.floor(Math.min(a[1], b[1]) / CELL)
    const maxZ = Math.floor(Math.max(a[1], b[1]) / CELL)
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const k = this._key(cx, cz)
        let arr = this.cells.get(k)
        if (!arr) { arr = []; this.cells.set(k, arr) }
        arr.push(idx)
      }
    }
  }

  /** Calls fn(x1,z1,x2,z2) for every segment near (x,z). */
  near (x, z, radius, fn) {
    const minX = Math.floor((x - radius) / CELL)
    const maxX = Math.floor((x + radius) / CELL)
    const minZ = Math.floor((z - radius) / CELL)
    const maxZ = Math.floor((z + radius) / CELL)
    const seen = new Set()
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const arr = this.cells.get(this._key(cx, cz))
        if (!arr) continue
        for (const idx of arr) {
          if (seen.has(idx)) continue
          seen.add(idx)
          const s = this.segments[idx]
          fn(s[0], s[1], s[2], s[3])
        }
      }
    }
  }
}

/** Closest point on segment ab to point p, returned as [x, z, distance]. */
export function closestOnSegment (px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az
  const len2 = dx * dx + dz * dz
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx, cz = az + t * dz
  return [cx, cz, Math.hypot(px - cx, pz - cz)]
}
