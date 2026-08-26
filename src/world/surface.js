/**
 * The height of whatever you can actually drive on.
 *
 * The car used to stand on `terrain.height()`, which was fine until the roads
 * were graded. A carved road is drawn from its own stored profile, and the
 * terrain beneath it is deliberately pushed *under* that profile so the ground
 * cannot poke up through the tarmac — so reading the heightfield put the car
 * below the road on every graded street in the city, a quarter of a metre down
 * on average and three metres at worst.
 *
 * This returns the surface a wheel would rest on: carriageway, kerb, pavement,
 * footpath, or bare ground where there is no road. Kerbs are ramped rather than
 * stepped so you can drive up onto a pavement instead of bouncing off it.
 */
import { KERB_H, WALK_W, roadLift } from './roads.js'

const CELL = 28                  // metres; roads are long, so bigger than the wall grid
const KERB_RAMP = 0.34           // the kerb face, climbed rather than teleported
const EDGE_RAMP = 0.8            // pavement back edge easing down to the ground

export class SurfaceIndex {
  constructor (world, terrain) {
    this.terrain = terrain
    this.cells = new Map()
    this.segs = []
    for (const road of world.roads ?? []) {
      const pts = road.p
      if (!pts || pts.length < 2) continue
      const half = road.w / 2
      // Only the ranks that actually get a pavement drawn beside them, or the
      // car would climb a kerb that is not there.
      const walk = !road.foot && road.rank <= 5 && !road.bridge && !road.tunnel
      const lift = roadLift(road)     // exactly what roads.js draws
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1]
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.2) continue
        const idx = this.segs.length
        this.segs.push({
          ax: a[0], az: a[1], bx: b[0], bz: b[1],
          half, walk, lift,
          // Carved roads carry a graded profile; everything else drapes.
          h0: road.h ? road.h[i] : null,
          h1: road.h ? road.h[i + 1] : null,
        })
        this._insert(idx, a, b, half + (walk ? WALK_W : 0) + EDGE_RAMP)
      }
    }
  }

  _insert (idx, a, b, pad) {
    const x0 = Math.floor((Math.min(a[0], b[0]) - pad) / CELL)
    const x1 = Math.floor((Math.max(a[0], b[0]) + pad) / CELL)
    const z0 = Math.floor((Math.min(a[1], b[1]) - pad) / CELL)
    const z1 = Math.floor((Math.max(a[1], b[1]) + pad) / CELL)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = cx * 100003 + cz
        let arr = this.cells.get(k)
        if (!arr) { arr = []; this.cells.set(k, arr) }
        arr.push(idx)
      }
    }
  }

  /**
   * Drivable surface at a point.
   *
   * Carriageway first, then pavement, then bare ground — and only the highest
   * *within* whichever of those you are actually standing on. Taking a plain
   * maximum across everything nearby seems reasonable and is not: a road's
   * pavement reaches three metres past its kerb, so a street running alongside
   * or above another lifts the car off the one it is driving on. That put the
   * kerb of a 19.8 m boulevard at 6.3 m from its centreline instead of 9.9 m,
   * and rode 39% of road vertices above their own tarmac.
   */
  height (x, z) {
    const ground = this.terrain.height(x, z)
    const list = this.cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL))
    if (!list) return ground
    let onRoad = -Infinity        // inside a carriageway
    let onWalk = -Infinity        // on a pavement
    let onRamp = -Infinity        // in the run-off just past one
    for (let n = 0; n < list.length; n++) {
      const s = this.segs[list[n]]
      const dx = s.bx - s.ax, dz = s.bz - s.az
      const len2 = dx * dx + dz * dz
      let t = ((x - s.ax) * dx + (z - s.az) * dz) / len2
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const px = s.ax + dx * t, pz = s.az + dz * t
      const d = Math.hypot(x - px, z - pz)

      const outer = s.half + (s.walk ? WALK_W : 0)
      if (d > outer + EDGE_RAMP) continue

      // The carriageway itself: a graded profile if it has one, else the ground.
      const road = (s.h0 !== null ? s.h0 + (s.h1 - s.h0) * t : this.terrain.height(px, pz)) + s.lift
      let y
      if (!s.walk) {
        // No pavement: ease straight back down to the ground off the edge.
        y = d <= s.half ? road : mix(road, ground, (d - s.half) / EDGE_RAMP)
      } else if (d <= s.half - KERB_RAMP / 2) {
        y = road
      } else if (d <= s.half + KERB_RAMP / 2) {
        // The kerb face, as a short ramp. A hard 14 cm step launches the car.
        y = mix(road, road + KERB_H, (d - (s.half - KERB_RAMP / 2)) / KERB_RAMP)
      } else if (d <= outer) {
        y = road + KERB_H
      } else {
        y = mix(road + KERB_H, ground, (d - outer) / EDGE_RAMP)
      }
      if (d <= s.half) { if (y > onRoad) onRoad = y }
      else if (d <= outer) { if (y > onWalk) onWalk = y }
      else if (y > onRamp) onRamp = y
    }
    // A carriageway or a pavement is a built surface laid *on* the ground, so it
    // wins outright. Maxing against the terrain instead let the bank beside a
    // cutting stand 37 cm proud of the pavement it supports, which the car then
    // climbed as an invisible hump at the kerb.
    if (onRoad > -Infinity) return onRoad
    if (onWalk > -Infinity) return onWalk
    return onRamp > ground ? onRamp : ground
  }

  /** Slope of the drivable surface, for the gravity term in the car. */
  gradient (x, z) {
    const e = 1.2
    return [
      (this.height(x + e, z) - this.height(x - e, z)) / (2 * e),
      (this.height(x, z + e) - this.height(x, z - e)) / (2 * e),
    ]
  }
}

const mix = (a, b, t) => a + (b - a) * (t < 0 ? 0 : t > 1 ? 1 : t)
