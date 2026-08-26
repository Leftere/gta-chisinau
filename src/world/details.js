/**
 * Instanced building details: balconies, entrances, steps, roof plant, drainpipes.
 *
 * A facade texture alone reads flat because nothing breaks the wall plane. These
 * props all project from it, so they catch light and cast shadows, which is what
 * actually makes a building look built rather than printed. Everything here is
 * instanced — tens of thousands of props cost a handful of draw calls.
 */
import * as THREE from 'three'
import * as BGU from 'three/examples/jsm/utils/BufferGeometryUtils.js'

function rand (n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

function pointInRing (x, z, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/** Outward normal of edge p0->p1, resolved by stepping off and testing containment. */
function outward (p0, p1, ring) {
  let nx = p1[1] - p0[1]
  let nz = -(p1[0] - p0[0])
  const l = Math.hypot(nx, nz) || 1
  nx /= l; nz /= l
  const mx = (p0[0] + p1[0]) / 2, mz = (p0[1] + p1[1]) / 2
  if (pointInRing(mx + nx * 0.02, mz + nz * 0.02, ring)) { nx = -nx; nz = -nz }
  return [nx, nz]
}

/** Coarse grid of road sample points, for finding which way a building faces. */
function roadIndex (world, step = 6) {
  const cell = 40
  const cells = new Map()
  const add = (x, z) => {
    const k = Math.floor(x / cell) * 73856093 + Math.floor(z / cell)
    let a = cells.get(k)
    if (!a) { a = []; cells.set(k, a) }
    a.push([x, z])
  }
  for (const r of world.roads) {
    if (r.rank > 7) continue
    for (let i = 0; i < r.p.length - 1; i++) {
      const a = r.p[i], b = r.p[i + 1]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const n = Math.max(1, Math.round(len / step))
      for (let s = 0; s <= n; s++) add(a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n)
    }
  }
  return {
    nearest (x, z) {
      const cx = Math.floor(x / cell), cz = Math.floor(z / cell)
      let best = null, bd = Infinity
      for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) {
          const arr = cells.get((cx + i) * 73856093 + (cz + j))
          if (!arr) continue
          for (const p of arr) {
            const d = (p[0] - x) ** 2 + (p[1] - z) ** 2
            if (d < bd) { bd = d; best = p }
          }
        }
      }
      return best
    },
  }
}

// ------------------------------------------------------------------ geometry

function balconyGeometry () {
  const slab = new THREE.BoxGeometry(2.6, 0.16, 1.05)
  slab.translate(0, 0.08, 0.525)
  const front = new THREE.BoxGeometry(2.6, 0.92, 0.1)
  front.translate(0, 0.54, 1.0)
  const left = new THREE.BoxGeometry(0.1, 0.92, 1.05)
  left.translate(-1.25, 0.54, 0.525)
  const right = left.clone()
  right.translate(2.5, 0, 0)
  return BGU.mergeGeometries([slab, front, left, right].map(g => g.toNonIndexed()))
}

/** Three steps up to a small landing. */
function stoopGeometry () {
  const parts = []
  for (let i = 0; i < 3; i++) {
    const d = 1.35 - i * 0.32
    const g = new THREE.BoxGeometry(2.1, 0.17, d)
    g.translate(0, 0.085 + i * 0.17, d / 2)
    parts.push(g.toNonIndexed())
  }
  return BGU.mergeGeometries(parts)
}

function doorGeometry () {
  const leaf = new THREE.BoxGeometry(1.5, 2.35, 0.12)
  leaf.translate(0, 1.175, 0)
  return leaf
}

function canopyGeometry () {
  const slab = new THREE.BoxGeometry(2.5, 0.16, 1.1)
  slab.translate(0, 0.08, 0.55)
  const a = new THREE.BoxGeometry(0.09, 0.09, 1.1)
  a.rotateX(0.5)
  a.translate(-1.1, -0.28, 0.5)
  const b = a.clone(); b.translate(2.2, 0, 0)
  return BGU.mergeGeometries([slab, a, b].map(g => g.toNonIndexed()))
}

/**
 * One metre of roof-terrace railing: two horizontal rails, no posts.
 *
 * The posts are deliberately left out. They would have to stretch with the rail
 * when the instance is scaled to an edge's length, and at any distance you would
 * ever see this from, a railing reads as a pair of thin lines against the sky —
 * which is exactly what two rails give, for two boxes per building edge.
 */
function roofRailGeometry () {
  const top = new THREE.BoxGeometry(1, 0.05, 0.05)
  top.translate(0.5, 0.94, 0)
  const mid = new THREE.BoxGeometry(1, 0.035, 0.035)
  mid.translate(0.5, 0.5, 0)
  return BGU.mergeGeometries([top, mid].map(g => g.toNonIndexed()))
}

function roofUnitGeometry () {
  const box = new THREE.BoxGeometry(1.5, 0.9, 1.1)
  box.translate(0, 0.45, 0)
  const vent = new THREE.CylinderGeometry(0.22, 0.22, 0.5, 8)
  vent.translate(0.9, 0.25, 0)
  return BGU.mergeGeometries([box, vent].map(g => g.toNonIndexed()))
}

// --------------------------------------------------------------------- build

export function buildDetails (world, footprints, terrain, { lowDetail = false } = {}) {
  const group = new THREE.Group()
  group.name = 'details'
  const roads = roadIndex(world)

  const concrete = new THREE.MeshStandardMaterial({ color: 0xc9c4b8, roughness: 0.92, metalness: 0 })
  const railing = new THREE.MeshStandardMaterial({ color: 0xb9b6ad, roughness: 0.8, metalness: 0.1 })
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x4b3b2c, roughness: 0.55, metalness: 0.15 })
  const metal = new THREE.MeshStandardMaterial({ color: 0x8d9195, roughness: 0.55, metalness: 0.7 })
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x7d7a74, roughness: 0.7, metalness: 0.35 })

  const balconies = [], stoops = [], doors = [], canopies = [], roofUnits = [], pipes = []
  const roofRails = []
  // Bespoke entrances are unique per building, so they are merged rather than instanced.
  const customStone = [], customDoors = [], customPortal = []

  /** Box in an entrance's local frame: +x along the wall, +z out from it, y up. */
  const placeBox = (w, h, d, lx, ly, lz, cx, cz, yaw) => {
    const g = new THREE.BoxGeometry(w, h, d)
    g.translate(lx, ly + h / 2, lz)
    const m = new THREE.Matrix4().makeRotationY(yaw)
    m.setPosition(cx, 0, cz)
    g.applyMatrix4(m)
    return g.toNonIndexed()
  }

  footprints.forEach((fp, fi) => {
    const { ring, top, base, bd, tileH, bandTop, pitched, family } = fp
    const height = top - base
    if (!ring || ring.length < 3) return

    // Longest edges, used for balconies and to pick an entrance wall.
    const edges = []
    for (let i = 0; i < ring.length; i++) {
      const p0 = ring[i], p1 = ring[(i + 1) % ring.length]
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
      if (len < 1.5) continue
      edges.push({ p0, p1, len, i })
    }
    if (!edges.length) return

    // ---------------------------------------------------------- balconies
    // Prefabricated blocks carry rows of them; it is most of their silhouette.
    if (family === 'panel' && bd.l >= 4) {
      const long = [...edges].sort((a, b) => b.len - a.len).slice(0, 2).filter(e => e.len >= 12)
      for (const e of long) {
        const [nx, nz] = outward(e.p0, e.p1, ring)
        const ux = (e.p1[0] - e.p0[0]) / e.len, uz = (e.p1[1] - e.p0[1]) / e.len
        const per = Math.floor(e.len / 6.4)
        const yaw = Math.atan2(nx, nz)
        for (let k = 0; k < per; k++) {
          const t = ((k + 0.5) / per) * e.len
          for (let f = 1; f < bd.l; f++) {
            const y = bandTop + f * tileH
            if (y + 1.2 > top) break
            balconies.push({
              x: e.p0[0] + ux * t + nx * 0.05,
              z: e.p0[1] + uz * t + nz * 0.05,
              y, yaw,
            })
          }
        }
      }
    }

    // ---------------------------------------------------------- entrance
    // One per building, on whichever wall actually faces a street.
    if (height > 3.2 && !pitched) {
      {
        let best = null, bestScore = -Infinity
        for (const e of edges) {
          if (e.len <= 3.2) continue
          const mx = (e.p0[0] + e.p1[0]) / 2, mz = (e.p0[1] + e.p1[1]) / 2
          // Query per edge. Asking once from ring[0] biases a long building's
          // entrance towards whichever corner happens to sit nearest a street.
          const near = roads.nearest(mx, mz)
          if (!near) continue
          const [nx, nz] = outward(e.p0, e.p1, ring)
          const dx = near[0] - mx, dz = near[1] - mz
          const dist = Math.hypot(dx, dz) || 1
          // Favour walls that both face the road and are close to it.
          let score = (nx * dx + nz * dz) / dist - dist / 220
          // A monumental stair belongs on the main frontage, not an end wall.
          if (bd.entrance) score += Math.min(e.len, 60) / 90
          // ...except when the frontage *is* the end wall. A tower sliced off a
          // long block is 15 m wide and 61 m deep, so "longest edge" points the
          // front door down the side street. An explicit facing settles it.
          if (bd.entrance?.facing) {
            const [fx, fz] = bd.entrance.facing
            const fl = Math.hypot(fx, fz) || 1
            score += 6 * ((nx * fx + nz * fz) / fl)
          }
          if (score > bestScore) { bestScore = score; best = { e, nx, nz, mx, mz } }
        }
        if (best && bestScore > 0.25) {
          const { e, nx, nz } = best
          const ux = (e.p1[0] - e.p0[0]) / e.len, uz = (e.p1[1] - e.p0[1]) / e.len
          const yaw = Math.atan2(nx, nz)
          const en = bd.entrance

          if (en) {
            // A monumental entrance: a broad flight up to a landing, with several
            // doors on it. Centred on the wall rather than placed at random.
            const cx = e.p0[0] + ux * (e.len * 0.5)
            const cz = e.p0[1] + uz * (e.len * 0.5)
            const steps = en.steps ?? 6
            const rise = en.rise ?? 0.16
            const tread = en.tread ?? 0.55
            const landing = en.landing ?? 2.0
            const wide = Math.min(en.stairWidth ?? 12, e.len * 0.9)
            const groundY = terrain.height(cx, cz)
            const deckY = groundY + steps * rise

            // landing slab against the wall
            customStone.push(placeBox(wide, steps * rise, landing, 0, groundY, landing / 2, cx, cz, yaw))
            // flight, widest step furthest from the building
            for (let i = 0; i < steps; i++) {
              const z0 = landing + (steps - 1 - i) * tread
              customStone.push(placeBox(wide, (i + 1) * rise, tread, 0, groundY, z0 + tread / 2, cx, cz, yaw))
            }

            // A polished stone portal: jambs, a lintel and a cornice standing
            // proud of the wall. It is what makes a commercial entrance read as
            // the front door rather than as another shopfront.
            if (en.portal) {
              const po = en.portal
              const pw = po.width ?? 8.0            // overall opening width
              const ph = po.height ?? 6.2           // to the underside of the lintel
              const pt = po.thickness ?? 1.0        // how broad the frame members are
              const pd = po.depth ?? 0.38           // how far it stands out
              for (const sx of [-1, 1]) {
                customPortal.push(placeBox(pt, ph, pd, sx * (pw - pt) / 2, deckY, pd / 2, cx, cz, yaw))
              }
              customPortal.push(placeBox(pw, pt * 0.85, pd, 0, deckY + ph, pd / 2, cx, cz, yaw))
              const cH = 0.30, cD = pd + 0.28
              customPortal.push(placeBox(pw + 0.55, cH, cD, 0, deckY + ph + pt * 0.85, cD / 2, cx, cz, yaw))
              // The dark sign panel the portal frames.
              customDoors.push(placeBox(pw - pt * 2 - 0.1, ph - (po.doorTop ?? 3.0), 0.1,
                0, deckY + (po.doorTop ?? 3.0), 0.05, cx, cz, yaw))
            }

            const n = en.doors ?? 1
            const dw = en.doorWidth ?? 2.0
            const dh = en.doorHeight ?? 2.6
            const sp = en.spacing ?? 4.0
            for (let k = 0; k < n; k++) {
              const lx = (k - (n - 1) / 2) * sp
              customDoors.push(placeBox(dw, dh, 0.14, lx, deckY, 0.07, cx, cz, yaw))
              // frame surround, so the opening reads against the glazing
              customStone.push(placeBox(dw + 0.34, 0.16, 0.22, lx, deckY + dh, 0.1, cx, cz, yaw))
            }
          } else {
            const t = e.len * (0.3 + rand(fi) * 0.4)
            const x = e.p0[0] + ux * t, z = e.p0[1] + uz * t
            const riser = 0.51                    // three 0.17m steps
            const gy = terrain.height(x, z)
            doors.push({ x: x + nx * 0.07, z: z + nz * 0.07, y: gy + riser, yaw })
            stoops.push({ x, z, y: gy, yaw })
            canopies.push({ x, z, y: gy + riser + 2.5, yaw })
          }
        }
      }
    }

    // ------------------------------------------------- roof terrace rail
    // Low commercial pavilions here are flat-roofed with an accessible terrace,
    // and the railing around it is most of what breaks their roofline.
    if (family === 'pavilion' && !pitched) {
      for (const e of edges) {
        const [nx, nz] = outward(e.p0, e.p1, ring)
        const ux = (e.p1[0] - e.p0[0]) / e.len, uz = (e.p1[1] - e.p0[1]) / e.len
        const inset = 0.35                     // sit inboard of the cornice, not on it
        // The rail runs from its origin along local +x, so yaw has to map +x onto
        // the edge direction — not onto the wall normal, which is the convention
        // the entrance and balcony placements use.
        roofRails.push({
          x: e.p0[0] - nx * inset + ux * inset,
          z: e.p0[1] - nz * inset + uz * inset,
          y: top,
          yaw: Math.atan2(-uz, ux),
          len: Math.max(0.5, e.len - inset * 2),
        })
      }
    }

    // -------------------------------------------------------- roof plant
    if (!pitched && height > 6 && !lowDetail) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (const [x, z] of ring) {
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
      }
      const area = (maxX - minX) * (maxZ - minZ)
      const want = Math.min(4, Math.floor(area / 420))
      let placed = 0
      for (let a = 0; a < want * 6 && placed < want; a++) {
        const x = minX + rand(fi * 31 + a) * (maxX - minX)
        const z = minZ + rand(fi * 37 + a + 7) * (maxZ - minZ)
        if (!pointInRing(x, z, ring)) continue
        roofUnits.push({ x, z, y: top, yaw: rand(fi + a) * Math.PI })
        placed++
      }
    }

    // -------------------------------------------------------- drainpipes
    if (height > 5 && !pitched && !lowDetail) {
      const picks = [...edges].sort((a, b) => b.len - a.len).slice(0, 2)
      for (const e of picks) {
        const [nx, nz] = outward(e.p0, e.p1, ring)
        const px = e.p1[0] + nx * 0.12, pz = e.p1[1] + nz * 0.12
        const gy = terrain.height(px, pz)
        pipes.push({ x: px, z: pz, y: gy, h: Math.max(1, top - gy) })
      }
    }
  })

  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3(1, 1, 1)

  // Shadow casting is per-instance work in the depth pass, so props that are
  // small, numerous, and cast nothing anyone will notice stay out of it.
  const place = (geo, mat, list, name, scaleFn, castShadow = true) => {
    if (!list.length) return null
    const mesh = new THREE.InstancedMesh(geo, mat, list.length)
    mesh.name = name
    mesh.castShadow = castShadow
    mesh.receiveShadow = true
    for (let i = 0; i < list.length; i++) {
      const it = list[i]
      pos.set(it.x, it.y, it.z)
      q.setFromAxisAngle(up, it.yaw ?? 0)
      scl.set(1, 1, 1)
      if (scaleFn) scaleFn(scl, it, i)
      m.compose(pos, q, scl)
      mesh.setMatrixAt(i, m)
    }
    mesh.instanceMatrix.needsUpdate = true
    group.add(mesh)
    return mesh
  }

  // Small props are drawn a second time into the shadow map, and balconies alone
  // are 750k triangles. On a phone the buildings and trees carry the shadowing;
  // a balcony's own shadow lands on the wall right behind it and is not missed.
  const detailShadow = !lowDetail
  place(balconyGeometry(), railing, balconies, 'balconies', null, detailShadow)
  place(stoopGeometry(), concrete, stoops, 'steps', null, detailShadow)
  place(doorGeometry(), doorMat, doors, 'doors', null, detailShadow)
  place(canopyGeometry(), concrete, canopies, 'canopies', null, detailShadow)
  place(roofUnitGeometry(), metal, roofUnits, 'roofplant', null, false)
  place(roofRailGeometry(), railing, roofRails, 'roofrails', (sc, it) => sc.set(it.len, 1, 1), false)
  const pipeGeo = new THREE.CylinderGeometry(0.075, 0.075, 1, 6)
  pipeGeo.translate(0, 0.5, 0)
  place(pipeGeo, pipeMat, pipes, 'drainpipes', (s, it) => s.set(1, it.h, 1), false)

  const merged = (list, mat, name) => {
    if (!list.length) return
    const g = BGU.mergeGeometries(list)
    g.computeVertexNormals()
    const mesh = new THREE.Mesh(g, mat)
    mesh.name = name
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  merged(customStone, concrete, 'entrance-steps')
  merged(customDoors, doorMat, 'entrance-doors')
  merged(customPortal, new THREE.MeshStandardMaterial({
    color: 0x6b3b2e, roughness: 0.32, metalness: 0.12, envMapIntensity: 1.1,
  }), 'entrance-portal')

  return {
    group,
    drawCalls: group.children.length,
    counts: {
      balconies: balconies.length, doors: doors.length,
      roofPlant: roofUnits.length, drainpipes: pipes.length, roofRails: roofRails.length,
      bespokeEntrances: customDoors.length, portals: customPortal.length,
    },
  }
}
