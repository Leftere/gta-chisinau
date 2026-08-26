/**
 * The 3943 — a trolleybus working Bd. Ștefan cel Mare, back and forth.
 *
 * Chisinau's trolleybuses are the most recognisable thing moving on that street,
 * and an empty boulevard is most of what makes the city read as a model rather
 * than a place. This one is scenery with a timetable: it follows the real
 * carriageway, rides the same drivable surface the player's car does, and turns
 * round at each end of the map.
 *
 * The poles are the point. A bus without them is a bus; a bus with two poles
 * reaching up and back is unmistakably a Chisinau trolleybus.
 */
import * as THREE from 'three'
import { WIRE_H } from '../world/streetgear.js'
import { shuttleLoop } from './npccar.js'

const LEN = 12.0            // a rigid 12 m low-floor, not the articulated one
const WIDTH = 2.50
const FLOOR = 0.36
const ROOF = 3.05
const WHEEL_R = 0.51
const AXLE_F = 4.05         // from the body centre
const AXLE_R = -3.30

const BLUE = 0x1f5fae
const DARK = 0x14324f

/** Body profile in side view, so the front rakes forward the way a bus does. */
function bodyShape () {
  const s = new THREE.Shape()
  const f = LEN / 2, r = -LEN / 2
  s.moveTo(r + 0.10, FLOOR)
  s.lineTo(f - 0.34, FLOOR)
  s.lineTo(f - 0.06, FLOOR + 0.55)     // raked lower front
  s.lineTo(f, FLOOR + 1.05)
  s.lineTo(f, ROOF - 0.42)
  s.quadraticCurveTo(f, ROOF, f - 0.42, ROOF)
  s.lineTo(r + 0.34, ROOF)
  s.quadraticCurveTo(r, ROOF, r, ROOF - 0.36)
  s.lineTo(r, FLOOR + 0.5)
  s.lineTo(r + 0.10, FLOOR)
  return s
}

function extrudeAcross (shape, width, bevel = 0.03) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2, bevelEnabled: bevel > 0,
    bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 8,
  })
  // Extrusion runs along +z; the bus faces +z, so turn it to run across.
  g.rotateY(-Math.PI / 2)
  g.translate(width / 2 - bevel, 0, 0)
  return g
}

export function buildTrolleybusMesh () {
  const root = new THREE.Group()
  root.name = 'trolleybus'

  const blue = new THREE.MeshPhysicalMaterial({
    color: BLUE, metalness: 0.35, roughness: 0.42,
    clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 1.1,
  })
  const white = new THREE.MeshPhysicalMaterial({
    color: 0xeef1f4, metalness: 0.25, roughness: 0.45,
    clearcoat: 0.5, envMapIntensity: 1.0,
  })
  // Same reasoning as the car: a mirror-bright windscreen reads as a blank
  // panel, not as glass. See src/game/car.js.
  // Same as the car's: a strong clearcoat lobe turns dark glass into white
  // chrome. See src/game/car.js.
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0a1218, metalness: 0.0, roughness: 0.28,
    envMapIntensity: 0.30, clearcoat: 0.2, clearcoatRoughness: 0.3,
  })
  const rubber = new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.95 })
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.4, metalness: 0.85 })

  const add = (geo, mat, cast = true) => {
    const m = new THREE.Mesh(geo, mat)
    m.castShadow = cast
    m.receiveShadow = true
    root.add(m)
    return m
  }
  const box = (w, h, d, x, y, z, mat) => {
    const m = add(new THREE.BoxGeometry(w, h, d), mat)
    m.position.set(x, y, z)
    return m
  }

  add(extrudeAcross(bodyShape(), WIDTH), blue)

  // Livery: a white band at sill height wrapping the sides, which is what makes
  // it read as Chisinau blue-and-white rather than as a generic blue bus.
  for (const sx of [-1, 1]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.52, LEN - 0.7), white)
    band.position.set(sx * (WIDTH / 2 + 0.005), FLOOR + 0.92, 0)
    band.castShadow = false
    root.add(band)
  }
  box(WIDTH * 0.92, 0.5, 0.05, 0, FLOOR + 0.92, LEN / 2 - 0.02, white)

  // --- glazing -------------------------------------------------------------
  const sillY = FLOOR + 1.30, headY = ROOF - 0.34
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.05, headY - sillY, LEN - 1.5), glass)
    side.position.set(sx * (WIDTH / 2 - 0.01), (sillY + headY) / 2, -0.15)
    root.add(side)
  }
  // Windscreen and rear window, sitting just *proud* of the bodywork.
  //
  // Set flush they land inside the extrusion and never appear at all — which is
  // why the front of the bus was a blank blue panel. Deep windscreen, taken
  // lower than the side glass, because that is what a bus looks like from in
  // front.
  const ws = new THREE.Mesh(new THREE.BoxGeometry(WIDTH - 0.18, headY - sillY + 0.42, 0.05), glass)
  ws.position.set(0, (sillY + headY) / 2 - 0.16, LEN / 2 + 0.012)
  root.add(ws)
  box(WIDTH - 0.26, headY - sillY - 0.12, 0.05, 0, (sillY + headY) / 2, -LEN / 2 - 0.012, glass)

  // Destination blind above the screen.
  box(WIDTH - 0.9, 0.26, 0.05, 0, headY + 0.02, LEN / 2 - 0.07, new THREE.MeshStandardMaterial({
    color: 0x1a1c1e, emissive: 0xffb43a, emissiveIntensity: 0.55, roughness: 0.6,
  }))

  // --- roof ----------------------------------------------------------------
  // The equipment run: resistors, the traction box, the pole bases.
  box(WIDTH - 0.5, 0.30, 5.2, 0, ROOF + 0.13, -1.0, white)
  box(WIDTH - 1.1, 0.22, 1.5, 0, ROOF + 0.32, 0.6, metal)

  // --- poles ---------------------------------------------------------------
  // Two of them, reaching up and back to where the wires would be. Angle and
  // length matter more than detail: this is the silhouette people recognise.
  {
    // Angle the poles so their tips land exactly on the wire height rather than
    // at whatever a guessed tilt produces. A real trolley pole is long and
    // shallow: about 6 m of pole for only 2.5 m of rise, which is most of why
    // the silhouette is so recognisable.
    const poleLen = 6.0
    const base = ROOF + 0.24
    const rise = Math.max(0.2, WIRE_H - base)
    const tilt = Math.acos(Math.min(0.98, rise / poleLen))
    for (const sx of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, poleLen, 6), metal)
      pole.geometry.translate(0, poleLen / 2, 0)
      pole.position.set(sx * 0.31, base, -1.6)
      pole.rotation.x = tilt
      pole.castShadow = false
      root.add(pole)
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.30), metal)
      shoe.position.set(
        sx * 0.31,
        base + Math.cos(tilt) * poleLen,
        -1.6 - Math.sin(tilt) * poleLen)
      shoe.castShadow = false
      root.add(shoe)
    }
  }

  // --- running gear --------------------------------------------------------
  const wheels = []
  const tyre = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.30, 16)
  tyre.rotateZ(Math.PI / 2)
  const hub = new THREE.CylinderGeometry(WHEEL_R * 0.5, WHEEL_R * 0.5, 0.32, 12)
  hub.rotateZ(Math.PI / 2)
  for (const [z, twin] of [[AXLE_F, false], [AXLE_R, true]]) {
    for (const sx of [-1, 1]) {
      // The rear axle is twinned, as it is on anything this heavy.
      for (const off of twin ? [0.0, 0.32] : [0.0]) {
        const w = new THREE.Group()
        const t = new THREE.Mesh(tyre, rubber); t.castShadow = true; w.add(t)
        w.add(new THREE.Mesh(hub, metal))
        // Just proud of the bodywork. Set flush, the tyre's outer face lands a
        // centimetre *inside* the skirt and there is simply no wheel to see —
        // the bus reads as a box hovering over its own shadow.
        w.position.set(sx * (WIDTH / 2 - 0.12 - off), WHEEL_R, z)
        root.add(w)
        wheels.push(w)
      }
    }
  }

  // Wheel arches: a dark recess behind each tyre, so the opening reads as an
  // opening rather than the tyre reading as something bolted to a slab.
  const arch = new THREE.MeshStandardMaterial({ color: 0x0d0f11, roughness: 1 })
  for (const [z, len] of [[AXLE_F, 1.32], [AXLE_R + 0.16, 1.95]]) {
    for (const sx of [-1, 1]) {
      box(0.06, 0.62, len, sx * (WIDTH / 2 - 0.035), FLOOR + 0.10, z, arch)
    }
  }

  box(WIDTH - 0.16, 0.30, 0.22, 0, FLOOR + 0.05, LEN / 2 - 0.05, white)   // front skirt
  box(WIDTH - 0.16, 0.30, 0.22, 0, FLOOR + 0.05, -LEN / 2 + 0.05, white)  // rear skirt

  root.userData.wheels = wheels
  return { root, wheels }
}

/**
 * Drives a fixed route at a steady speed, reversing at each end.
 *
 * No physics: it is scenery, and scenery that fights the player's car for
 * simulation time is a bad trade. It samples the same drivable surface the car
 * does, so it sits on the road rather than in it, and it leans into the camber
 * the same way.
 */
export class Trolleybus {
  /**
   * @param path  world-space [[x, z], …] along the lane it should occupy
   * @param surface  the drivable-surface index the player's car also uses
   */
  constructor (path, surface, { speed = 9.5, start = 0.35, loop = false } = {}) {
    this.path = path
    this.surface = surface
    this.speed = speed
    this.loop = loop
    this.dir = 1
    this.pitch = 0
    this.roll = 0
    this.wheelSpin = 0

    // Cumulative distance, so travel is in metres rather than in vertices.
    this.acc = [0]
    for (let i = 1; i < path.length; i++) {
      this.acc.push(this.acc[i - 1] +
        Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]))
    }
    this.total = this.acc[this.acc.length - 1]
    this.s = this.total * start
    // Long enough at each end to read as a terminus rather than a glitch.
    this.wait = 0
  }

  /** Position and heading at distance `s` along the route. */
  at (s) {
    s = Math.max(0, Math.min(this.total, s))
    let i = 1
    while (i < this.acc.length - 1 && this.acc[i] < s) i++
    const t = (s - this.acc[i - 1]) / Math.max(1e-6, this.acc[i] - this.acc[i - 1])
    const a = this.path[i - 1], b = this.path[i]
    return {
      x: a[0] + (b[0] - a[0]) * t,
      z: a[1] + (b[1] - a[1]) * t,
      yaw: Math.atan2((b[0] - a[0]) * this.dir, (b[1] - a[1]) * this.dir),
    }
  }

  update (dt, mesh, wheels) {
    if (this.loop) {
      // A closed route carries its own U-turns, so there is nothing to reverse
      // and no terminus to wait at: the bus only ever drives forwards, which is
      // what keeps a line of them out of each other's lane.
      this.s = (this.s + this.speed * dt) % this.total
      this.wheelSpin += (this.speed / WHEEL_R) * dt
    } else if (this.wait > 0) {
      this.wait -= dt
    } else {
      this.s += this.speed * this.dir * dt
      if (this.s >= this.total) { this.s = this.total; this.dir = -1; this.wait = 6 }
      if (this.s <= 0) { this.s = 0; this.dir = 1; this.wait = 6 }
      this.wheelSpin += (this.speed / WHEEL_R) * dt
    }

    const p = this.at(this.s)
    // Sit on the road under both axles, the same way the car does, so it does
    // not sink on a graded street or pitch on a kerb it never touches.
    const c = Math.cos(p.yaw), sn = Math.sin(p.yaw)
    const sample = (lz) => this.surface.height(p.x + sn * lz, p.z + c * lz)
    const front = sample(AXLE_F), rear = sample(AXLE_R)
    const y = (front + rear) / 2
    const targetPitch = Math.atan((front - rear) / (AXLE_F - AXLE_R))
    const k = Math.min(1, dt * 8)
    this.pitch += (targetPitch - this.pitch) * k

    mesh.position.set(p.x, y, p.z)
    mesh.rotation.order = 'YXZ'
    mesh.rotation.set(-this.pitch, p.yaw, 0)
    for (const w of wheels) w.rotation.x = this.wheelSpin
  }
}

/**
 * The lane a trolleybus would run in, built from the real boulevard.
 *
 * The street arrives as 31 separate OSM ways. Stitching them by shared endpoints
 * is the usual approach and unnecessary here: over 3.4 km the boulevard wanders
 * only 3.4 m off a straight line, so projecting every vertex onto its heading and
 * sorting gives the same ordering with none of the failure modes. The result is
 * offset to the right-hand carriageway, because Moldova drives on the right.
 */
export function boulevardRoute (world, { name = 'tefan cel Mare', offset = 5.0 } = {}) {
  const ways = world.roads.filter(r => r.name && r.name.includes(name) && !r.foot)
  if (!ways.length) return null
  const ux = 0.716, uz = 0.698                  // north-west to south-east
  const seen = []
  for (const r of ways) for (const [x, z] of r.p) seen.push([x * ux + z * uz, x, z])
  seen.sort((a, b) => a[0] - b[0])

  const out = []
  for (const [along, x, z] of seen) {
    if (out.length && along - out[out.length - 1][0] < 6) continue   // dedupe
    out.push([along, x, z])
  }
  // Right of travel, with x east and z south, is (-uz, ux) — Moldova drives on
  // the right, and (uz, -ux) is the oncoming lane.
  return out.map(([, x, z]) => [x - uz * offset, z + ux * offset])
}

/**
 * The same boulevard as a closed circuit: out on one carriageway, round, back
 * on the other.
 *
 * One bus can bounce end to end and nobody notices it returns down the lane it
 * left by. Seven cannot — half of them are heading the other way at any moment,
 * and on a single lane they drive straight through each other. A closed loop
 * fixes both at once: every bus is always in the correct carriageway for the
 * way it is pointing, and buses running the same loop at the same speed hold
 * their spacing forever, so they can never overlap.
 *
 * `radius` is the forward bulge of the turn at each terminus. A 12 m bus needs
 * more of it than a car does, or the manoeuvre reads as a pivot on the spot.
 */
export function boulevardLoop (world, { lane = 5.0, radius = 9.0, ...rest } = {}) {
  return shuttleLoop(world, null, null, { lane, radius, ...rest })
}

const _m = new THREE.Matrix4()

/**
 * A line of trolleybuses sharing one route, drawn as instances.
 *
 * A bus is about 33 separate meshes, and seven of them built the obvious way
 * would be 230-odd draw calls against the 33 the entire city costs. So the
 * fleet builds *one* bus as a template and turns each of its meshes into an
 * `InstancedMesh` carrying all seven copies: seven buses cost the draw calls of
 * one, and only the 1.2k triangles multiply.
 *
 * Each bus still runs its own `Trolleybus` — same route, same speed, evenly
 * spaced around it — writing into a throwaway `Object3D` whose matrix is then
 * composed into an instance. Wheels are a level below, so their spin is
 * composed in the same way.
 */
export class TrolleyFleet {
  constructor (count, path, surface, { speed = 9.5 } = {}) {
    this.count = count
    this.group = new THREE.Group()
    this.group.name = 'trolleybuses'

    const proto = buildTrolleybusMesh()
    const wheelIndex = new Map()
    proto.wheels.forEach((w, i) => wheelIndex.set(w, i))

    this.parts = []
    const part = (mesh, wheel) => {
      mesh.updateMatrix()
      const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, count)
      inst.castShadow = mesh.castShadow
      inst.receiveShadow = mesh.receiveShadow
      inst.frustumCulled = false          // nothing else in the scene is either
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.group.add(inst)
      this.parts.push({ inst, local: mesh.matrix.clone(), wheel })
    }
    for (const child of proto.root.children) {
      if (wheelIndex.has(child)) for (const leaf of child.children) part(leaf, wheelIndex.get(child))
      else part(child, -1)
    }
    this.triangles = Math.round(count * this.parts.reduce((n, p) => {
      const g = p.inst.geometry
      return n + (g.index ? g.index.count : g.attributes.position.count) / 3
    }, 0))

    this.buses = []
    this.dummies = []
    for (let i = 0; i < count; i++) {
      this.buses.push(new Trolleybus(path, surface, { speed, start: i / count, loop: true }))
      const root = new THREE.Object3D()
      const wheels = proto.wheels.map((w) => {
        const o = new THREE.Object3D()
        o.position.copy(w.position)
        return o
      })
      this.dummies.push({ root, wheels })
    }
  }

  update (dt) {
    for (let i = 0; i < this.count; i++) {
      const d = this.dummies[i]
      this.buses[i].update(dt, d.root, d.wheels)
      d.root.updateMatrix()
      for (const w of d.wheels) w.updateMatrix()
      for (const p of this.parts) {
        _m.copy(d.root.matrix)
        if (p.wheel >= 0) _m.multiply(d.wheels[p.wheel].matrix)
        _m.multiply(p.local)
        p.inst.setMatrixAt(i, _m)
      }
    }
    for (const p of this.parts) p.inst.instanceMatrix.needsUpdate = true
  }
}
