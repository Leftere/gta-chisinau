/**
 * The heightfield the whole city sits on.
 *
 * `height()` deliberately interpolates over the *same* triangulation the ground
 * mesh is built from, rather than bilinearly. Bilinear sampling disagrees with a
 * triangulated quad everywhere except the corners, which would let roads and
 * props sink through the ground between grid points. Matching the triangles
 * means everything agrees exactly and roads only need a few centimetres of lift.
 */
import * as THREE from 'three'

export class Terrain {
  constructor (data) {
    this.x0 = data.x0
    this.z0 = data.z0
    this.step = data.step
    this.nx = data.nx
    this.nz = data.nz
    this.originH = data.originH
    this.h = Float32Array.from(data.h)
  }

  /** Raw grid height, clamped at the edges. */
  _at (i, j) {
    const a = Math.max(0, Math.min(this.nx - 1, i))
    const b = Math.max(0, Math.min(this.nz - 1, j))
    return this.h[b * this.nx + a]
  }

  /** Terrain height at a world position, matching the rendered triangles. */
  height (x, z) {
    const fx = (x - this.x0) / this.step
    const fz = (z - this.z0) / this.step
    const i = Math.max(0, Math.min(this.nx - 2, Math.floor(fx)))
    const j = Math.max(0, Math.min(this.nz - 2, Math.floor(fz)))
    const u = Math.max(0, Math.min(1, fx - i))
    const v = Math.max(0, Math.min(1, fz - j))
    const h00 = this._at(i, j), h10 = this._at(i + 1, j)
    const h01 = this._at(i, j + 1), h11 = this._at(i + 1, j + 1)
    // Same diagonal the mesh uses: (00,10,01) and (11,01,10).
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v)
  }

  /** Downhill gradient [dh/dx, dh/dz] in metres per metre. */
  gradient (x, z) {
    const d = this.step * 0.5
    return [
      (this.height(x + d, z) - this.height(x - d, z)) / (2 * d),
      (this.height(x, z + d) - this.height(x, z - d)) / (2 * d),
    ]
  }

  /**
   * Ground statistics under a footprint. The median is what a builder would
   * level the pad to; the minimum is how far the foundation has to reach on the
   * downhill side to avoid leaving a gap.
   */
  underRing (ring) {
    const hs = ring.map(([x, z]) => this.height(x, z))
    let min = Infinity, sum = 0
    for (const h of hs) { if (h < min) min = h; sum += h }
    const sorted = [...hs].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    return { min, mean: sum / hs.length, median, spread: sorted[sorted.length - 1] - sorted[0] }
  }

  /** The displaced ground surface itself. */
  buildMesh (material, tile = 9) {
    const { nx, nz, step, x0, z0 } = this
    const pos = new Float32Array(nx * nz * 3)
    const uv = new Float32Array(nx * nz * 2)
    const col = new Float32Array(nx * nz * 3).fill(1)
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i
        const x = x0 + i * step, z = z0 + j * step
        pos[k * 3] = x
        pos[k * 3 + 1] = this.h[k]
        pos[k * 3 + 2] = z
        uv[k * 2] = x / tile
        uv[k * 2 + 1] = z / tile
      }
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6)
    let p = 0
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1
        idx[p++] = a; idx[p++] = c; idx[p++] = b       // (00, 01, 10)
        idx[p++] = d; idx[p++] = b; idx[p++] = c       // (11, 10, 01)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.setIndex(new THREE.BufferAttribute(idx, 1))
    g.computeVertexNormals()
    const mesh = new THREE.Mesh(g, material)
    mesh.name = 'terrain'
    mesh.receiveShadow = true
    mesh.castShadow = false
    mesh.matrixAutoUpdate = false
    return mesh
  }
}

/** A flat stand-in, so the game still runs if terrain.json is missing. */
export const FLAT = {
  height: () => 0,
  gradient: () => [0, 0],
  underRing: () => ({ min: 0, mean: 0, median: 0, spread: 0 }),
  buildMesh: () => null,
}
