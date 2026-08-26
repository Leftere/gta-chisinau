/**
 * Overhead trolleybus wires and traffic signals.
 *
 * Both are the kind of thing you never notice until they are missing: a
 * trolleybus with its poles reaching up into empty sky reads as a mistake, and a
 * crossroads with no signals reads as a car park.
 */
import * as THREE from 'three'
import * as BGU from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Height of the contact wires above the carriageway. */
export const WIRE_H = 5.8
const WIRE_GAP = 0.62          // spacing between the pair
const SPAN = 42                // metres between support masts

/**
 * The two contact wires the trolleybus runs under, with masts to hold them up.
 *
 * Drawn as thin boxes rather than lines: a `LineBasicMaterial` is one pixel wide
 * whatever the distance, so a wire either disappears at range or crawls. Boxes
 * behave like everything else in the scene and cost almost nothing at this
 * sampling.
 */
export function buildTrolleyWires (route, surface) {
  const group = new THREE.Group()
  group.name = 'trolleywires'
  if (!route || route.length < 2) return { group, triangles: 0 }

  const wireMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.55, metalness: 0.6 })
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x6d7175, roughness: 0.5, metalness: 0.7 })

  // Resample: the route has a vertex every ~8 m and the wires do not need that.
  const pts = []
  let acc = 0
  for (let i = 0; i < route.length; i++) {
    if (i === 0 || i === route.length - 1) { pts.push(route[i]); continue }
    acc += Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1])
    if (acc >= 24) { pts.push(route[i]); acc = 0 }
  }

  const wires = [], masts = []
  let sinceMast = SPAN
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    const dx = b[0] - a[0], dz = b[1] - a[1]
    const len = Math.hypot(dx, dz)
    if (len < 0.5) continue
    const ux = dx / len, uz = dz / len
    const nx = uz, nz = -ux                       // across the wires
    const ya = surface.height(a[0], a[1]) + WIRE_H
    const yb = surface.height(b[0], b[1]) + WIRE_H
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.045, 0.045, len)
      // Point the box along the span and lift it to wire height.
      const m = new THREE.Matrix4()
      m.makeRotationY(Math.atan2(ux, uz))
      m.setPosition(
        (a[0] + b[0]) / 2 + nx * (WIRE_GAP / 2) * s,
        (ya + yb) / 2,
        (a[1] + b[1]) / 2 + nz * (WIRE_GAP / 2) * s)
      g.applyMatrix4(m)
      wires.push(g)
    }

    sinceMast += len
    if (sinceMast >= SPAN) {
      sinceMast = 0
      // A mast on one side with an arm reaching out over both wires. Real spans
      // are hung between masts on opposite kerbs; one side is enough to explain
      // where the wires come from without doubling the geometry.
      const ground = surface.height(a[0], a[1])
      const reach = 6.4
      const mx = a[0] - nx * reach, mz = a[1] - nz * reach
      const gy = surface.height(mx, mz)
      const pole = new THREE.CylinderGeometry(0.085, 0.12, WIRE_H + 1.1, 6)
      pole.translate(0, (WIRE_H + 1.1) / 2, 0)
      pole.translate(mx, gy, mz)
      masts.push(pole)
      const arm = new THREE.BoxGeometry(reach, 0.07, 0.07)
      const am = new THREE.Matrix4()
      am.makeRotationY(Math.atan2(nx, nz) + Math.PI / 2)
      am.setPosition((mx + a[0]) / 2, ground + WIRE_H + 0.36, (mz + a[1]) / 2)
      arm.applyMatrix4(am)
      masts.push(arm)
      // The two droppers holding each wire off the arm.
      for (const s of [-1, 1]) {
        const d = new THREE.BoxGeometry(0.035, 0.36, 0.035)
        d.translate(a[0] + nx * (WIRE_GAP / 2) * s, ground + WIRE_H + 0.18, a[1] + nz * (WIRE_GAP / 2) * s)
        masts.push(d)
      }
    }
  }

  let triangles = 0
  const addMerged = (list, mat, name, shadow) => {
    if (!list.length) return
    const g = BGU.mergeGeometries(list.map(x => x.toNonIndexed()))
    const mesh = new THREE.Mesh(g, mat)
    mesh.name = name
    mesh.castShadow = shadow
    group.add(mesh)
    triangles += g.attributes.position.count / 3
  }
  addMerged(wires, wireMat, 'wires', false)      // a 4 cm wire casts no shadow worth the pass
  addMerged(masts, mastMat, 'wire-masts', true)
  return { group, triangles: Math.round(triangles) }
}

// --------------------------------------------------------------- signals

/**
 * Where roads actually meet.
 *
 * OSM ways share a node at a junction, and the world builder rounds coordinates
 * consistently, so a shared junction is simply a coordinate that appears in more
 * than one road. That beats intersecting every segment pair against every other.
 */
export function findJunctions (world, { maxRank = 5, minRoads = 2, requireRank = 99, minSep = 34 } = {}) {
  const at = new Map()
  for (const r of world.roads) {
    if (r.foot || r.rank > maxRank) continue
    for (const [x, z] of r.p) {
      const k = `${Math.round(x * 10)},${Math.round(z * 10)}`
      let e = at.get(k)
      if (!e) { e = { x, z, roads: new Set() }; at.set(k, e) }
      e.roads.add(r)
    }
  }
  const out = []
  for (const e of at.values()) {
    if (e.roads.size < minRoads) continue
    // Signals belong where a main road is involved. Every residential corner
    // qualifying gave 264 junctions and 775 masts — a quarter of a million
    // triangles of traffic light, which is not what a city looks like either.
    if (![...e.roads].some(r => r.rank <= requireRank)) continue
    // One junction per crossroads, not one per shared node: a dual carriageway
    // meeting a street shares several nodes within a few metres.
    if (out.some(o => Math.hypot(o.x - e.x, o.z - e.z) < minSep)) continue
    out.push({ x: e.x, z: e.z, roads: [...e.roads] })
  }
  return out
}

/**
 * Mast, arm and a three-lamp head — the shape you read at a distance.
 *
 * Kept deliberately cheap. These are street furniture repeated a hundred-odd
 * times, and nobody inspects a traffic light: open-ended cylinders with five
 * sides cost a fifth of what a capped sphere does and are indistinguishable past
 * about ten metres.
 */
function signalGeometry (armLen) {
  const parts = []
  const H = 5.4
  const pole = new THREE.CylinderGeometry(0.075, 0.1, H, 5, 1, true)
  pole.translate(0, H / 2, 0)
  parts.push(pole)
  if (armLen > 0.5) {
    const arm = new THREE.BoxGeometry(armLen, 0.075, 0.075)
    arm.translate(armLen / 2, H - 0.25, 0)
    parts.push(arm)
  }
  return BGU.mergeGeometries(parts.map(g => g.toNonIndexed()))
}

/**
 * Signals on the approaches to each junction.
 *
 * One mast per arm of the crossroads, on the right of the traffic coming in —
 * which is where you look for them, and which keeps them off the pavement on the
 * far side where they would mean nothing.
 */
export function buildTrafficLights (world, surface, { maxRank = 5, requireRank = 3, minSep = 46 } = {}) {
  const group = new THREE.Group()
  group.name = 'traffic-lights'
  const junctions = findJunctions(world, { maxRank, requireRank, minSep })

  const mastMat = new THREE.MeshStandardMaterial({ color: 0x53585c, roughness: 0.5, metalness: 0.65 })
  const caseMat = new THREE.MeshStandardMaterial({ color: 0x14181b, roughness: 0.8 })
  const lamp = (hex) => new THREE.MeshStandardMaterial({
    color: 0x101010, emissive: hex, emissiveIntensity: 0.9, roughness: 0.5,
  })
  const lensMats = [lamp(0xd8232a), lamp(0xe8a317), lamp(0x2fbf4c)]

  const masts = [], cases = [], lenses = [[], [], []]
  let placed = 0
  for (const j of junctions) {
    for (const r of j.roads.slice(0, 4)) {
      // Direction of the arm leaving the junction, taken from its nearest vertex.
      let best = null
      for (const [x, z] of r.p) {
        const d = Math.hypot(x - j.x, z - j.z)
        if (d > 4 && (!best || d < best.d)) best = { d, x, z }
      }
      if (!best) continue
      const ux = (best.x - j.x) / best.d, uz = (best.z - j.z) / best.d
      // Right of traffic arriving along -u is (-uz, ux) rotated; place on the
      // near-right corner, clear of the carriageway.
      const half = r.w / 2 + 1.4
      const back = r.w / 2 + 4.0
      const px = j.x + ux * back - uz * half
      const pz = j.z + uz * back + ux * half
      const gy = surface.height(px, pz)
      const yaw = Math.atan2(-ux, -uz)          // face the oncoming traffic

      const armLen = Math.min(3.2, r.w * 0.28)
      const m = new THREE.Matrix4().makeRotationY(yaw)
      m.setPosition(px, gy, pz)
      const geo = signalGeometry(armLen)
      geo.applyMatrix4(m)
      masts.push(geo)

      // The head hangs off the end of the arm.
      const hx = px + Math.sin(yaw + Math.PI / 2) * armLen
      const hz = pz + Math.cos(yaw + Math.PI / 2) * armLen
      const shell = new THREE.BoxGeometry(0.34, 1.02, 0.3)
      shell.translate(hx, gy + 4.6, hz)
      cases.push(shell)
      for (let i = 0; i < 3; i++) {
        const lens = new THREE.CylinderGeometry(0.105, 0.105, 0.05, 6, 1, true)
        lens.rotateX(Math.PI / 2)
        lens.rotateY(yaw)
        lens.translate(
          hx + Math.sin(yaw) * 0.17,
          gy + 4.6 + (1 - i) * 0.31,
          hz + Math.cos(yaw) * 0.17)
        lenses[i].push(lens)
      }
      placed++
    }
  }

  let triangles = 0
  const addMerged = (list, mat, name, shadow = true) => {
    if (!list.length) return
    const g = BGU.mergeGeometries(list.map(x => x.toNonIndexed()))
    const mesh = new THREE.Mesh(g, mat)
    mesh.name = name
    mesh.castShadow = shadow
    group.add(mesh)
    triangles += g.attributes.position.count / 3
  }
  addMerged(masts, mastMat, 'signal-masts')
  addMerged(cases, caseMat, 'signal-heads')
  const names = ['signal-red', 'signal-amber', 'signal-green']
  lenses.forEach((l, i) => addMerged(l, lensMats[i], names[i], false))

  return { group, junctions: junctions.length, signals: placed, triangles: Math.round(triangles) }
}
