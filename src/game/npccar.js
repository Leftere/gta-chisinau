/**
 * A white Mercedes GLE Coupé working the boulevard, with a label over its roof.
 *
 * Modelled the same way as the player's Lada: a side profile extruded across the
 * width, then detail hung on it. A coupé-SUV is mostly one silhouette decision —
 * SUV ride height with a fastback roof falling away behind the front seats — and
 * getting that curve right matters more than any amount of trim.
 *
 * Unlike the trolleybus, this one does not reverse in place at the end of its
 * beat. It drives a closed loop: out along one carriageway, a real U-turn across
 * the centreline, back along the other, and a second U-turn. Reversing heading
 * on the spot reads as a mistake; swinging across the road reads as a driver.
 */
import * as THREE from 'three'

const LEN = 4.94
const WIDTH = 2.01
const WHEEL_R = 0.39         // 22-inch, which is what these wear
const AXLE_F = 1.53          // 2.94 m wheelbase
const AXLE_R = -1.41
const SILL = 0.60
// Underside height. This is the whole difference between an SUV and a coupé:
// set level with the wheel centres, half the tyre disappears behind the body and
// the car sits on the road like a saloon however tall you make the roof.
const FLOOR = 0.54

/**
 * The silhouette. Front at +z.
 *
 * The roof peaks just behind the windscreen header and then falls continuously
 * to a short rear deck — that single line is the whole point of a coupé-SUV, and
 * a flat roof with a cut-off tail would just be an estate.
 */
function bodyShape () {
  const s = new THREE.Shape()
  const f = LEN / 2, r = -LEN / 2
  s.moveTo(r + 0.14, SILL)
  s.lineTo(r + 0.02, 0.82)
  s.lineTo(r, 1.02)                       // tail lights
  s.lineTo(r + 0.20, 1.24)                // boot lip
  s.quadraticCurveTo(r + 0.75, 1.46, -0.55, 1.68)   // the fastback
  s.lineTo(0.28, 1.73)                    // roof peak
  s.lineTo(0.78, 1.70)
  s.quadraticCurveTo(1.16, 1.60, 1.34, 1.10)        // raked windscreen
  s.lineTo(1.78, 1.03)                    // long bonnet
  s.quadraticCurveTo(2.30, 0.99, f, 0.80) // nose drop
  s.lineTo(f, 0.66)
  s.lineTo(f - 0.10, FLOOR)               // front air dam
  s.lineTo(AXLE_F + 0.66, FLOOR)
  archTo(s, AXLE_F)
  s.lineTo(AXLE_R + 0.66, FLOOR)
  archTo(s, AXLE_R)
  s.lineTo(r + 0.14, SILL)
  return s
}

/** A wheel arch cut into the underside, so the tyres sit in openings. */
function archTo (s, cz) {
  const R = 0.66
  const steps = 10
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI * (i / steps)
    s.lineTo(cz + Math.cos(a) * R, FLOOR + Math.sin(a) * 0.40)
  }
}

function extrudeAcross (shape, width, bevel = 0.035) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2, bevelEnabled: true,
    bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 14,
  })
  g.rotateY(-Math.PI / 2)
  g.translate(width / 2 - bevel, 0, 0)
  return g
}

/** The daylight opening, following the same fastback line one step inboard. */
function glassShape () {
  const s = new THREE.Shape()
  s.moveTo(1.28, 1.12)
  s.quadraticCurveTo(1.02, 1.55, 0.72, 1.64)
  s.lineTo(-0.52, 1.62)
  s.quadraticCurveTo(-1.05, 1.42, -1.48, 1.20)
  s.lineTo(-0.10, 1.16)
  s.closePath()
  return s
}

export function buildGleMesh () {
  const root = new THREE.Group()
  root.name = 'npc-gle'

  const paint = new THREE.MeshPhysicalMaterial({
    color: 0xf2f4f6, metalness: 0.05, roughness: 0.34,
    clearcoat: 0.55, clearcoatRoughness: 0.14, envMapIntensity: 0.6,
  })
  // Glass is a dark dielectric, not a clearcoated mirror — see src/game/car.js.
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0a1015, metalness: 0.0, roughness: 0.28,
    envMapIntensity: 0.30, clearcoat: 0.2, clearcoatRoughness: 0.3,
  })
  const trim = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.55, metalness: 0.35 })
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.16, metalness: 1, envMapIntensity: 1.1 })
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0f1012, roughness: 0.96 })
  const alloy = new THREE.MeshStandardMaterial({ color: 0x8f959c, roughness: 0.3, metalness: 0.85, envMapIntensity: 0.9 })
  const lamp = new THREE.MeshStandardMaterial({
    color: 0x14181c, emissive: 0xdfe8ff, emissiveIntensity: 0.35, roughness: 0.25, metalness: 0.4,
  })

  const add = (geo, mat, cast = true) => {
    const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true
    root.add(m); return m
  }
  const box = (w, h, d, x, y, z, mat) => {
    const m = add(new THREE.BoxGeometry(w, h, d), mat)
    m.position.set(x, y, z); return m
  }

  add(extrudeAcross(bodyShape(), WIDTH), paint)
  // Glasshouse, standing proud of the bodyside so it is not coplanar with it.
  add(extrudeAcross(glassShape(), WIDTH + 0.02, 0.01), glass)

  // --- the grille ----------------------------------------------------------
  // The single most recognisable thing about the car: a big upright panel with
  // the star in the middle of it.
  const grille = box(WIDTH - 0.44, 0.54, 0.10, 0, 0.90, LEN / 2 - 0.05, trim)
  grille.rotation.x = -0.16
  const star = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 6, 18), chrome)
  star.position.set(0, 0.90, LEN / 2 + 0.015)
  star.rotation.x = -0.16
  root.add(star)
  for (let i = 0; i < 3; i++) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.15, 0.02), chrome)
    sp.position.set(Math.sin(i * 2.094) * 0.07, 0.90 + Math.cos(i * 2.094) * 0.07, LEN / 2 + 0.015)
    sp.rotation.set(-0.16, 0, -i * 2.094)
    root.add(sp)
  }

  // --- lamps, skirts, cladding --------------------------------------------
  for (const sx of [-1, 1]) {
    const hl = box(0.46, 0.14, 0.12, sx * 0.62, 1.04, LEN / 2 - 0.10, lamp)
    hl.rotation.y = sx * 0.12
    const tl = box(0.40, 0.11, 0.08, sx * 0.66, 1.06, -LEN / 2 + 0.03,
      new THREE.MeshStandardMaterial({ color: 0x2a0c0c, emissive: 0xcc2222, emissiveIntensity: 0.7, roughness: 0.4 }))
    void tl
    // Chrome sill strip and the dark lower cladding an SUV wears.
    box(0.05, 0.07, LEN - 1.7, sx * (WIDTH / 2 - 0.01), 0.66, 0, chrome)
    box(0.06, 0.22, LEN - 1.5, sx * (WIDTH / 2 - 0.03), 0.50, 0, trim)
    // Mirrors.
    const mir = box(0.16, 0.10, 0.24, sx * (WIDTH / 2 + 0.06), 1.20, 0.86, trim)
    mir.rotation.y = sx * 0.1
  }
  box(WIDTH - 0.5, 0.10, 0.16, 0, 0.58, LEN / 2 - 0.02, chrome)      // front skid plate
  box(WIDTH - 0.5, 0.10, 0.16, 0, 0.58, -LEN / 2 + 0.02, chrome)     // rear

  // --- wheels --------------------------------------------------------------
  // Big multi-spoke alloys: the spokes are what make a 21-inch wheel read as one
  // rather than as a black disc.
  const wheels = []
  const tyre = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.30, 20)
  tyre.rotateZ(Math.PI / 2)
  const face = new THREE.CylinderGeometry(WHEEL_R * 0.74, WHEEL_R * 0.74, 0.32, 18)
  face.rotateZ(Math.PI / 2)
  for (const z of [AXLE_F, AXLE_R]) {
    for (const sx of [-1, 1]) {
      const w = new THREE.Group()
      const t = new THREE.Mesh(tyre, rubber); t.castShadow = true; w.add(t)
      w.add(new THREE.Mesh(face, alloy))
      for (let i = 0; i < 10; i++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.06, WHEEL_R * 1.34, 0.05), alloy)
        spoke.rotation.z = Math.PI / 2
        spoke.rotation.x = (i / 10) * Math.PI * 2
        spoke.position.x = sx * 0.16
        w.add(spoke)
      }
      w.position.set(sx * (WIDTH / 2 - 0.14), WHEEL_R, z)
      root.add(w)
      wheels.push(w)
    }
  }

  return { root, wheels }
}

// ------------------------------------------------------------------- the tag

/**
 * A map-pin label that hangs over the roof and always faces you.
 *
 * A Sprite rather than a plane: it needs to stay readable from every angle, and
 * turning a quad toward the camera by hand every frame is the same thing done
 * worse.
 */
export function buildTag (text, { width = 2.6 } = {}) {
  const W = 512, H = 256
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const c = cv.getContext('2d')

  const padX = 26, boxH = 150, tail = 34
  c.clearRect(0, 0, W, H)
  c.fillStyle = '#ffffff'
  c.strokeStyle = 'rgba(0,0,0,0.18)'
  c.lineWidth = 3
  const r = 26, x0 = 12, y0 = 14, x1 = W - 12, y1 = y0 + boxH
  c.beginPath()
  c.moveTo(x0 + r, y0)
  c.lineTo(x1 - r, y0); c.quadraticCurveTo(x1, y0, x1, y0 + r)
  c.lineTo(x1, y1 - r); c.quadraticCurveTo(x1, y1, x1 - r, y1)
  // the pin's tail, pointing down at the roof
  c.lineTo(W / 2 + tail, y1)
  c.lineTo(W / 2, y1 + tail)
  c.lineTo(W / 2 - tail, y1)
  c.lineTo(x0 + r, y1); c.quadraticCurveTo(x0, y1, x0, y1 - r)
  c.lineTo(x0, y0 + r); c.quadraticCurveTo(x0, y0, x0 + r, y0)
  c.closePath()
  c.fill(); c.stroke()

  c.fillStyle = '#000000'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  // Shrink to fit rather than overflow the plate.
  let size = 74
  do {
    c.font = `600 ${size}px ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif`
    size -= 2
  } while (c.measureText(text).width > W - padX * 2 - 24 && size > 20)
  c.fillText(text, W / 2, y0 + boxH / 2)

  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
    // Unlit: a label is signage, not a surface in the scene.
    fog: false, sizeAttenuation: true,
  }))
  sprite.scale.set(width, width * (H / W), 1)
  sprite.name = 'npc-tag'
  return sprite
}

// ----------------------------------------------------------------- the beat

/**
 * Follows a closed path at a steady speed.
 *
 * The path already contains its own U-turns, so there is no reversing logic
 * here: heading comes from the tangent, and the turns happen because the road
 * does. Height and pitch come from the same drivable surface the player uses.
 */
export class NpcCar {
  constructor (path, surface, { speed = 33.3, start = 0 } = {}) {
    this.path = path
    this.surface = surface
    this.speed = speed
    this.pitch = 0
    this.roll = 0
    this.wheelSpin = 0
    this.acc = [0]
    for (let i = 1; i < path.length; i++) {
      this.acc.push(this.acc[i - 1] +
        Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]))
    }
    this.total = this.acc[this.acc.length - 1]
    this.s = this.total * start
  }

  at (s) {
    s = ((s % this.total) + this.total) % this.total
    let i = 1
    while (i < this.acc.length - 1 && this.acc[i] < s) i++
    const t = (s - this.acc[i - 1]) / Math.max(1e-6, this.acc[i] - this.acc[i - 1])
    const a = this.path[i - 1], b = this.path[i]
    return {
      x: a[0] + (b[0] - a[0]) * t,
      z: a[1] + (b[1] - a[1]) * t,
      yaw: Math.atan2(b[0] - a[0], b[1] - a[1]),
    }
  }

  update (dt, mesh, wheels, tag) {
    this.s = (this.s + this.speed * dt) % this.total
    this.wheelSpin += (this.speed / WHEEL_R) * dt
    const p = this.at(this.s)

    const c = Math.cos(p.yaw), sn = Math.sin(p.yaw)
    const h = []
    for (const [lx, lz] of [[0.86, AXLE_F], [-0.86, AXLE_F], [0.86, AXLE_R], [-0.86, AXLE_R]]) {
      h.push(this.surface.height(p.x + sn * lz + c * lx, p.z + c * lz - sn * lx))
    }
    const y = (h[0] + h[1] + h[2] + h[3]) / 4
    const k = Math.min(1, dt * 9)
    this.pitch += (Math.atan(((h[0] + h[1]) / 2 - (h[2] + h[3]) / 2) / (AXLE_F - AXLE_R)) - this.pitch) * k
    this.roll += (Math.atan(((h[0] + h[2]) / 2 - (h[1] + h[3]) / 2) / 1.72) - this.roll) * k

    mesh.position.set(p.x, y, p.z)
    mesh.rotation.order = 'YXZ'
    mesh.rotation.set(-this.pitch, p.yaw, this.roll)
    for (const w of wheels) w.rotation.x = this.wheelSpin
    if (tag) tag.position.set(p.x, y + 2.75, p.z)
  }
}

/**
 * A there-and-back beat between two points on a street, with a U-turn at each.
 *
 * Out along the right-hand side, a semicircle across the centreline, back along
 * what is now the right-hand side, and another semicircle. The arcs are swept
 * *forward* past each end point rather than pivoted on the spot, which is the
 * difference between a car turning round and a car teleporting.
 */
export function shuttleLoop (world, from, to, { name = 'tefan cel Mare', lane = 5.0, radius = 5.0 } = {}) {
  const ways = world.roads.filter(r => r.name && r.name.includes(name) && !r.foot)
  if (!ways.length) return null
  const ux = 0.716, uz = 0.698
  const along = ([x, z]) => x * ux + z * uz
  // No bounds means the whole street, which is what a trolleybus route wants.
  const a0 = from && to ? Math.min(along(from), along(to)) : -Infinity
  const a1 = from && to ? Math.max(along(from), along(to)) : Infinity

  const spine = []
  for (const r of ways) for (const p of r.p) {
    const a = along(p)
    if (a >= a0 - 1 && a <= a1 + 1) spine.push([a, p[0], p[1]])
  }
  if (spine.length < 2) return null
  spine.sort((p, q) => p[0] - q[0])
  const centre = []
  for (const [a, x, z] of spine) {
    if (centre.length && a - centre[centre.length - 1][0] < 6) continue
    centre.push([a, x, z])
  }

  // Right of travel, x east and z south, heading (ux, uz), is (-uz, ux).
  const nx = -uz, nz = ux
  const out = []
  for (const [, x, z] of centre) out.push([x + nx * lane, z + nz * lane])
  const endC = centre[centre.length - 1], startC = centre[0]
  /**
   * Half a circle from `+off` round to `-off` about (cx, cz), bulging along f.
   *
   * The bulge is what makes it a manoeuvre: the apex sits `radius` *beyond* the
   * end of the beat, so the car sweeps out past the junction and comes back on
   * the other side instead of pivoting on its own axis.
   */
  const arc = (cx, cz, offx, offz, fx, fz) => {
    const pts = []
    for (let i = 1; i < 12; i++) {
      const th = (i / 12) * Math.PI
      pts.push([
        cx + offx * Math.cos(th) + fx * radius * Math.sin(th),
        cz + offz * Math.cos(th) + fz * radius * Math.sin(th),
      ])
    }
    return pts
  }
  // U-turn at the far end: arrive on the right-hand side heading +u, leave on
  // the far side heading -u.
  out.push(...arc(endC[1], endC[2], nx * lane, nz * lane, ux, uz))
  for (let i = centre.length - 1; i >= 0; i--) {
    out.push([centre[i][1] - nx * lane, centre[i][2] - nz * lane])
  }
  // And the mirror of it at the near end, closing the loop.
  out.push(...arc(startC[1], startC[2], -nx * lane, -nz * lane, -ux, -uz))
  return out
}
