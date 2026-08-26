/**
 * The player's car: body mesh plus a bicycle-model vehicle simulation.
 *
 * Lateral force comes from tyre slip angles with a saturating friction curve,
 * so grip runs out progressively — lift or yank the wheel and the back steps
 * out, exactly as it should. The handbrake simply collapses rear grip.
 */
import * as THREE from 'three'
import { WallGrid, closestOnSegment } from './collision.js'

// ------------------------------------------------------------------- model
//
// VAZ-2106 "Zhiguli" — the Lada that is still everywhere in Chisinau.
// Real dimensions: 4116 x 1611 x 1440mm, 2424mm wheelbase, 13" wheels.
// Boxy three-box saloon: flat bonnet, upright glasshouse, thin pillars,
// quad round headlamps behind a chrome grille, chrome bumpers at both ends.

const LEN_FRONT = 1.86        // from the CG to the front of the body
const LEN_REAR = -2.25
const BODY_W = 1.61
const ROOF_Y = 1.44
const SILL_Y = 0.34
const WHEEL_R = 0.29          // 13" rim plus tyre
const AXLE_F = 1.14           // wheelbase 2.424, slight forward weight bias
const AXLE_R = -1.28
const TRACK = 0.68

/**
 * Wheel arch, cut into the underside of the side profile.
 *
 * Extruding the arc straight through the width leaves an open tunnel, which is
 * what an arch is from outside — and the wheel fills it. Without this the body
 * is a slab that swallows the tyres.
 */
function archTo (shape, cz, r, sill) {
  const cy = WHEEL_R
  const half = Math.sqrt(Math.max(0, r * r - (sill - cy) * (sill - cy)))
  const a0 = Math.atan2(sill - cy, half)          // where the arc meets the sill
  const a1 = Math.PI - a0
  const STEPS = 9
  for (let i = 0; i <= STEPS; i++) {
    const a = a0 + ((a1 - a0) * i) / STEPS
    shape.lineTo(cz + Math.cos(a) * r, cy + Math.sin(a) * r)
  }
  return half
}

function carBodyShape () {
  const s = new THREE.Shape()
  s.moveTo(LEN_REAR + 0.05, 0.40)
  s.lineTo(LEN_REAR, 0.62)
  s.lineTo(LEN_REAR + 0.03, 0.94)   // boot lid rear lip
  s.lineTo(-1.30, 0.99)             // flat boot lid
  s.lineTo(-0.95, 1.02)             // base of the rear screen
  s.lineTo(-0.58, 1.42)
  s.lineTo(0.52, ROOF_Y)            // flat roof
  s.lineTo(0.86, 1.06)              // windscreen base
  s.lineTo(1.10, 1.00)              // scuttle
  s.lineTo(1.80, 0.97)              // flat bonnet
  s.lineTo(LEN_FRONT, 0.86)
  s.lineTo(LEN_FRONT, 0.52)
  s.lineTo(1.80, 0.40)
  // underside, running rearward, over both arches
  const R = 0.40, SILL = 0.40
  const half = Math.sqrt(R * R - (SILL - WHEEL_R) * (SILL - WHEEL_R))
  s.lineTo(AXLE_F + half, SILL)
  archTo(s, AXLE_F, R, SILL)
  s.lineTo(AXLE_R + half, SILL)
  archTo(s, AXLE_R, R, SILL)
  s.lineTo(LEN_REAR + 0.05, SILL)
  s.closePath()
  return s
}

function greenhouseShape () {
  const s = new THREE.Shape()
  // Windscreen base dropped a little: a deeper screen is what makes the cabin
  // read as glazed rather than as a dark stripe under the roof.
  s.moveTo(0.88, 1.00)
  s.lineTo(0.54, ROOF_Y - 0.02)
  s.lineTo(-0.60, 1.40)
  s.lineTo(-0.93, 1.04)
  s.closePath()
  return s
}

/** Extrudes a side profile across the car's width and orients it along +Z. */
function extrudeAcross (shape, width, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width, bevelEnabled: bevel > 0, bevelSize: bevel,
    bevelThickness: bevel, bevelSegments: 2, curveSegments: 3,
  })
  // The profile is drawn with +x forward and extruded along +z. Rotating by
  // -90 deg maps forward onto +z (matching the physics) and leaves the width
  // spanning [-width, 0] in x, which the translate then centres on the chassis.
  g.rotateY(-Math.PI / 2)
  g.translate(width / 2, 0, 0)
  g.computeVertexNormals()
  return g
}

// Period-correct Zhiguli colours; red first.
/** Wheel contact patches in the car's own frame: [across, along]. */
const CONTACTS = [
  [TRACK, AXLE_F], [-TRACK, AXLE_F],     // right-front, left-front
  [TRACK, AXLE_R], [-TRACK, AXLE_R],     // right-rear,  left-rear
]
const WHEELBASE = AXLE_F - AXLE_R

const PAINT_COLOURS = [0xb52b1d, 0xd8d3c4, 0x2f5c86, 0x6f8f5c, 0xc9a227, 0x8d99a6, 0x6b4a35]

export function buildCarMesh (colour = PAINT_COLOURS[0]) {
  const root = new THREE.Group()
  root.name = 'car'

  // Car paint is a dielectric with a clearcoat over it, not a metal. At
  // metalness 0.55 the body acts as a coloured mirror and the bonnet blows
  // through the tonemapper into a white sheet — bright enough that it reads as
  // the windscreen, and the actual windscreen behind it disappears.
  const paint = new THREE.MeshPhysicalMaterial({
    color: colour, metalness: 0.06, roughness: 0.55,
    clearcoat: 0.30, clearcoatRoughness: 0.32, envMapIntensity: 0.55,
  })
  // Glazing, deliberately less mirror-like than it wants to be.
  //
  // At envMapIntensity 2 and roughness 0.08 the windscreen is a near-perfect
  // mirror pointed at the sky, so it blows straight through the tonemapper and
  // the car looks like it has a sheet of white card where its window should be.
  // Real automotive glass is dark and only catches highlights at a glancing
  // angle, which is what the lower reflectivity buys.
  // Automotive glazing: a dark dielectric with a soft highlight.
  //
  // `clearcoat: 1` at a low clearcoat roughness puts a mirror lobe on top of the
  // base colour strong enough to wash it out completely — rendered on its own the
  // cabin came out as a white chrome block, which is why the car looked like it
  // had no windscreen at all. Glass is not clearcoated; the paint around it is.
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0a1015, metalness: 0.0, roughness: 0.30,
    envMapIntensity: 0.30, clearcoat: 0.2, clearcoatRoughness: 0.3,
  })
  const rubber = new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.95, metalness: 0 })
  // Soviet bumpers and trim were bright chrome, and there is a lot of it.
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd2d6da, roughness: 0.14, metalness: 1, envMapIntensity: 2.2 })

  const body = new THREE.Mesh(extrudeAcross(carBodyShape(), BODY_W, 0.035), paint)
  body.castShadow = true
  body.receiveShadow = true
  root.add(body)

  const cabin = new THREE.Mesh(extrudeAcross(greenhouseShape(), BODY_W + 0.05, 0.012), glass)
  cabin.castShadow = true
  root.add(cabin)

  /**
   * Windscreen and rear screen, standing proud of the body.
   *
   * The body silhouette already includes the cabin, so the greenhouse block is
   * coplanar with the body's own screen faces and only shows where it is wider —
   * at the sides. Head on you were looking at painted metal where the glass
   * should be, which is why the car appeared to have no windscreen at all. These
   * two panels sit 2 cm out along each screen's own normal, so they win.
   */
  const screen = (za, ya, zb, yb, outward) => {
    const dz = zb - za, dy = yb - ya
    const len = Math.hypot(dz, dy)
    const nz = (dy / len) * outward, ny = (-dz / len) * outward
    const m = new THREE.Mesh(new THREE.BoxGeometry(BODY_W - 0.11, len + 0.02, 0.02), glass)
    m.position.set(0, (ya + yb) / 2 + ny * 0.02, (za + zb) / 2 + nz * 0.02)
    // Lay the panel's own +y along the screen's rake.
    m.rotation.x = Math.atan2(dz / len, dy / len)
    root.add(m)
    return m
  }
  screen(0.86, 1.06, 0.52, ROOF_Y, 1)     // windscreen
  screen(-0.95, 1.02, -0.58, 1.42, -1)    // rear screen

  const box = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    m.position.set(x, y, z)
    m.castShadow = true
    root.add(m)
    return m
  }

  // --- chrome bumpers, front and rear, with overriders ---------------------
  for (const [z, sign] of [[LEN_FRONT + 0.06, 1], [LEN_REAR - 0.06, -1]]) {
    box(BODY_W + 0.06, 0.13, 0.11, 0, 0.55, z, chrome)
    for (const sx of [-0.42, 0.42]) box(0.11, 0.30, 0.15, sx, 0.60, z + sign * 0.02, chrome)
  }

  // --- quad round headlamps and the grille between them --------------------
  const lampGeo = new THREE.CylinderGeometry(1, 1, 0.07, 16)
  lampGeo.rotateX(Math.PI / 2)
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xf4efe0, emissive: 0xffeec8, emissiveIntensity: 0.85, roughness: 0.15, metalness: 0.2,
  })
  for (const [sx, r] of [[-0.56, 0.095], [-0.33, 0.082], [0.33, 0.082], [0.56, 0.095]]) {
    const l = new THREE.Mesh(lampGeo, headMat)
    l.scale.set(r, r, 1)
    l.position.set(sx, 0.80, LEN_FRONT + 0.02)
    root.add(l)
    const ring = new THREE.Mesh(lampGeo, chrome)
    ring.scale.set(r + 0.022, r + 0.022, 0.8)
    ring.position.set(sx, 0.80, LEN_FRONT + 0.005)
    root.add(ring)
  }
  box(0.56, 0.20, 0.05, 0, 0.80, LEN_FRONT + 0.015, chrome)      // grille
  box(BODY_W - 0.04, 0.05, 0.04, 0, 0.93, LEN_FRONT + 0.01, chrome)  // bonnet lip

  // --- rear lamps ----------------------------------------------------------
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x3a0709, emissive: 0xff2418, emissiveIntensity: 1.0, roughness: 0.35, metalness: 0.1,
  })
  const amberMat = new THREE.MeshStandardMaterial({
    color: 0x6a3a06, emissive: 0xff9c1a, emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.1,
  })
  for (const sx of [-0.50, 0.50]) {
    box(0.44, 0.13, 0.05, sx, 0.84, LEN_REAR - 0.015, tailMat)
    box(0.44, 0.09, 0.05, sx, 0.71, LEN_REAR - 0.015, amberMat)
  }

  // --- side trim, rain gutters, mirrors ------------------------------------
  for (const sx of [-1, 1]) {
    box(0.03, 0.035, 3.1, sx * (BODY_W / 2 + 0.005), 0.72, -0.2, chrome)      // waist strip
    box(0.03, 0.03, 2.0, sx * (BODY_W / 2 - 0.02), ROOF_Y - 0.03, -0.05, chrome) // gutter
    const mir = box(0.09, 0.07, 0.13, sx * (BODY_W / 2 + 0.06), 1.06, 0.72, paint)
    mir.castShadow = false
  }

  // --- wheels: steel rims with hubcaps -------------------------------------
  const tyre = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.19, 20)
  tyre.rotateZ(Math.PI / 2)
  const rim = new THREE.CylinderGeometry(WHEEL_R * 0.62, WHEEL_R * 0.62, 0.20, 14)
  rim.rotateZ(Math.PI / 2)
  const cap = new THREE.CylinderGeometry(WHEEL_R * 0.34, WHEEL_R * 0.34, 0.215, 12)
  cap.rotateZ(Math.PI / 2)

  const wheels = []
  for (const [x, z] of [[TRACK, AXLE_F], [-TRACK, AXLE_F], [TRACK, AXLE_R], [-TRACK, AXLE_R]]) {
    const w = new THREE.Group()
    const t = new THREE.Mesh(tyre, rubber)
    t.castShadow = true
    w.add(t, new THREE.Mesh(rim, paint), new THREE.Mesh(cap, chrome))
    w.position.set(x, WHEEL_R, z)
    root.add(w)
    wheels.push(w)
  }

  return { root, wheels, materials: { paint, tail: tailMat, head: headMat } }
}

// ----------------------------------------------------------------- physics

// VAZ-2106: 1045kg kerb, 1.6-litre, 75hp, ~150km/h flat out. Rear-wheel drive,
// discs at the front and drums at the back, and tyres designed in the 1970s —
// so it is light, slow, rolls a lot in corners, and lets go early.
const MASS = 1060
const INERTIA = 1500
const A_FRONT = 1.14          // CG to front axle; wheelbase 2.424m
const B_REAR = 1.28
const C_FRONT = 62000         // cornering stiffness, N/rad
const C_REAR = 70000
const MU = 0.95               // peak tyre friction
const DRIVE_FORCE = 4200
const BRAKE_FORCE = 8500
const DRAG = 0.75
const ROLL = 11.0
const MAX_STEER = 0.55        // unassisted steering, and not much lock

export class Car {
  /**
   * @param surface where a wheel rests — carriageway, kerb, pavement or ground.
   *   Not the raw heightfield: graded roads are drawn from their own profile and
   *   the terrain beneath them is pushed under it, so reading the heightfield
   *   parks the car below the tarmac.
   */
  constructor (footprints, surface) {
    this.terrain = surface
    this.pos = new THREE.Vector3(0, 0, 0)
    this.yaw = 0
    this.vLong = 0             // body-frame velocity, m/s
    this.vLat = 0
    this.yawRate = 0
    this.steer = 0
    this.wheelSpin = 0
    this.grid = new WallGrid(footprints)
    this.crashImpulse = 0
    this.slipRatio = 0
    this.pitch = 0
    this.roll = 0
    this.gear = 1
    this.rpm = 900
  }

  get speed () { return Math.hypot(this.vLong, this.vLat) }
  get kmh () { return this.speed * 3.6 }

  /** input: {throttle, brake, steer, handbrake} each -1..1 or 0..1 */
  update (input, dt) {
    // Sub-step so the tyre model stays stable at high speed.
    const steps = 4
    const h = dt / steps
    for (let i = 0; i < steps; i++) this._step(input, h)
    this._collide()
    this.crashImpulse *= 0.88
  }

  _step (input, dt) {
    // Steering slows down as speed rises, which is what makes a car feel planted.
    const speedFactor = 1 / (1 + Math.max(0, this.vLong) * 0.045)
    const target = input.steer * MAX_STEER * speedFactor
    const rate = 5.0 * dt * 60 / 60
    this.steer += (target - this.steer) * Math.min(1, rate * 3.2)

    const u = this.vLong
    const v = this.vLat
    const r = this.yawRate
    const absU = Math.max(Math.abs(u), 0.8)   // keeps slip angles finite at a standstill

    // --- longitudinal ------------------------------------------------------
    let Fx = 0
    if (input.throttle > 0) {
      // Torque falls away as speed climbs, standing in for a gearbox.
      const fade = 1 / (1 + Math.max(0, u) * 0.028)
      Fx += input.throttle * DRIVE_FORCE * fade
    }
    if (input.brake > 0) {
      if (u > 0.4) Fx -= input.brake * BRAKE_FORCE
      else Fx -= input.brake * DRIVE_FORCE * 0.55   // reverse
    }
    Fx -= DRAG * u * Math.abs(u)
    Fx -= ROLL * u

    // Gravity along the slope. This is what makes a hill a hill: you lose speed
    // climbing and gather it descending, without any of it being faked. Taken
    // from the settled body attitude, so a step in the surface cannot kick the
    // car forward as well as tilting it.
    const rise = Math.tan(this.pitch)
    Fx -= MASS * 9.81 * (rise / Math.sqrt(1 + rise * rise))

    // --- weight transfer ---------------------------------------------------
    const accelEstimate = Fx / MASS
    const shift = THREE.MathUtils.clamp(accelEstimate * 0.055, -0.35, 0.35)
    const loadF = MASS * 9.81 * (B_REAR / (A_FRONT + B_REAR)) * (1 - shift)
    const loadR = MASS * 9.81 * (A_FRONT / (A_FRONT + B_REAR)) * (1 + shift)

    // --- lateral tyre forces ----------------------------------------------
    const slipF = Math.atan2(v + A_FRONT * r, absU) - Math.sign(u || 1) * this.steer
    const slipR = Math.atan2(v - B_REAR * r, absU)

    const capF = MU * loadF
    const capR = MU * loadR * (input.handbrake ? 0.32 : 1)

    let FyF = -C_FRONT * slipF
    let FyR = -C_REAR * slipR
    // How hard each tyre is leaning on its friction limit. Past 1 it has run out
    // of grip and is sliding — which is exactly when a real tyre starts to howl,
    // so the audio reads this rather than guessing from steering angle.
    this.slipRatio = Math.max(
      capF > 1 ? Math.abs(FyF) / capF : 0,
      capR > 1 ? Math.abs(FyR) / capR : 0)
    FyF = THREE.MathUtils.clamp(FyF, -capF, capF)
    FyR = THREE.MathUtils.clamp(FyR, -capR, capR)

    if (input.handbrake) Fx -= Math.sign(u) * 4200

    // --- integrate ---------------------------------------------------------
    const du = (Fx - FyF * Math.sin(this.steer)) / MASS + v * r
    const dv = (FyF * Math.cos(this.steer) + FyR) / MASS - u * r
    const dr = (A_FRONT * FyF * Math.cos(this.steer) - B_REAR * FyR) / INERTIA

    this.vLong += du * dt
    this.vLat += dv * dt
    this.yawRate += dr * dt

    // Bleed off yaw and sideslip at a crawl, so the car settles instead of jittering.
    if (Math.abs(this.vLong) < 0.6) {
      this.yawRate *= 0.86
      this.vLat *= 0.86
      if (Math.abs(this.vLong) < 0.05 && !input.throttle && !input.brake) this.vLong = 0
    }

    this.yaw += this.yawRate * dt
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw)
    this.pos.x += (this.vLong * sin + this.vLat * cos) * dt
    this.pos.z += (this.vLong * cos - this.vLat * sin) * dt

    this._settle(dt)
    this.wheelSpin += (this.vLong / WHEEL_R) * dt
    this.rpm = 900 + Math.min(6500, Math.abs(this.vLong) * 165 % 5600)
  }

  /** Pushes the car back out of any wall it has driven into. */
  _collide () {
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw)
    // Two probe circles approximate the body better than one.
    const probes = [
      { fx: 1.25, r: 0.95 },
      { fx: -1.25, r: 0.95 },
    ]
    for (const probe of probes) {
      const px = this.pos.x + sin * probe.fx
      const pz = this.pos.z + cos * probe.fx
      this.grid.near(px, pz, probe.r + 0.5, (ax, az, bx, bz) => {
        const [cx, cz, dist] = closestOnSegment(px, pz, ax, az, bx, bz)
        if (dist >= probe.r || dist < 1e-5) return
        const nx = (px - cx) / dist
        const nz = (pz - cz) / dist
        const push = probe.r - dist
        this.pos.x += nx * push
        this.pos.z += nz * push

        // Kill the velocity component heading into the wall.
        const vx = this.vLong * sin + this.vLat * cos
        const vz = this.vLong * cos - this.vLat * sin
        const into = vx * nx + vz * nz
        if (into < 0) {
          const impact = -into
          this.crashImpulse = Math.max(this.crashImpulse, impact)
          const rx = vx - (1 + 0.25) * into * nx
          const rz = vz - (1 + 0.25) * into * nz
          const damp = 0.55
          this.vLong = (rx * sin + rz * cos) * damp
          this.vLat = (rx * cos - rz * sin) * damp
          this.yawRate *= 0.4
        }
      })
    }
  }

  /**
   * Rests the body on the road under all four wheels, not on one point.
   *
   * Two graded roads meeting at a junction do not have to agree — each profile is
   * smoothed independently — so the drivable surface steps by up to a quarter of
   * a metre within half a metre of travel. Sampling a single point puts that step
   * straight into the body and the car shudders through every crossroads.
   * Averaging the four contact patches turns a step at one wheel into a quarter
   * of it at the body, and the damping below spreads what is left over a few
   * frames, which is what a suspension does.
   */
  _settle (dt) {
    const c = Math.cos(this.yaw), sn = Math.sin(this.yaw)
    const h = []
    for (const [lx, lz] of CONTACTS) {
      h.push(this.terrain.height(
        this.pos.x + sn * lz + c * lx,
        this.pos.z + c * lz - sn * lx))
    }
    // Fast enough to follow a real hill, slow enough to swallow a kerb edge.
    this.pos.y += ((h[0] + h[1] + h[2] + h[3]) / 4 - this.pos.y) * Math.min(1, dt * 16)

    // Attitude from the contact patches rather than from a gradient of the
    // surface along the world axes.
    //
    // That gradient samples 1.2 m out in x and z, so on a narrow street one of
    // its samples lands on the pavement while the car is still squarely in its
    // lane — a 14 cm kerb over a 34 cm ramp is a 41% slope, and the body lurches
    // as the sample crosses it. Front-minus-rear over the wheelbase is both the
    // real thing and inherently steadier.
    const front = (h[0] + h[1]) / 2, rear = (h[2] + h[3]) / 2
    const right = (h[0] + h[2]) / 2, left = (h[1] + h[3]) / 2
    // Suspension: a body cannot snap to a four-degree step, and the drivable
    // surface still has them where two graded roads meet.
    const k = Math.min(1, dt * 9)
    this.pitch += (Math.atan((front - rear) / WHEELBASE) - this.pitch) * k
    this.roll += (Math.atan((right - left) / (TRACK * 2)) - this.roll) * k
  }

  /** Drops the body straight onto the surface, for spawns and teleports. */
  settleNow () {
    for (let i = 0; i < 40; i++) this._settle(1 / 20)
  }

  /** Writes the simulation state onto the scene graph. */
  applyTo (mesh, wheels) {
    // Already the settled, four-wheel average — re-sampling here would put the
    // single-point step back into the visible body.
    const y = this.pos.y
    mesh.position.set(this.pos.x, y, this.pos.z)

    // YXZ so pitch and roll are taken about the car's own axes rather than the
    // world's — with the default XYZ order the pitch axis follows the heading.
    mesh.rotation.order = 'YXZ'
    const bodyRoll = THREE.MathUtils.clamp(-this.yawRate * this.vLong * 0.017, -0.13, 0.13)
    mesh.rotation.set(-this.pitch, this.yaw, bodyRoll + this.roll)
    for (let i = 0; i < wheels.length; i++) {
      wheels[i].rotation.x = this.wheelSpin
      wheels[i].rotation.y = i < 2 ? this.steer : 0
    }
  }
}

export { PAINT_COLOURS }
