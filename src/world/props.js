/**
 * Street furniture and greenery.
 *
 * Chisinau is one of the greenest cities in Europe, so trees carry a lot of the
 * look. OSM maps ~2200 individual trees in the centre; the rest are scattered
 * inside park and forest polygons by rejection sampling. Everything here is
 * instanced, so thousands of props cost a handful of draw calls.
 */
import * as THREE from 'three'
import * as BGU from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { canvas, toTexture } from './textures.js'

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

function ringBounds (ring) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const [x, z] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }
  return { minX, maxX, minZ, maxZ }
}

// How far past the edge of a way a scattered tree has to stand.
const PATH_CLEAR = 2.75    // a footway: 2 m of path becomes a 7.5 m corridor
const ROAD_CLEAR = 3.5     // a street: past the kerb and its pavement
// A landmark stands in an apron: its own half-frontage plus a fixed set-back.
// Scaling the whole radius with the frontage looked fine on an 11 m arch and
// stripped a 118 m circle of Cathedral Park the moment a 39.5 m cathedral
// became a landmark — an apron is a set-back from the walls, not a multiple of
// the building.
const PLAZA_SETBACK = 24.0
const MONUMENT_CLEAR = 6.0
// Minimum spacing, by what is being planted. A park is planted and wants to
// read as spaced; woodland wants to read as dense, and Dendrariu is scenery a
// kilometre and a half from anywhere you drive.
const TREE_GAP = { park: 5.0, grass: 5.0, forest: 3.0 }

const GRID = 24

/**
 * Where a tree may not stand.
 *
 * Rejection sampling inside a park ring is blind to what is drawn on top of the
 * ring, and a park is mostly *paths*: Cathedral Park is 96,000 m2 with 173
 * footway segments through it, so a third of the trees scattered into it landed
 * on a walkway or close enough to crowd one. A formal park does not look like
 * that. Its planting reads as blocks with clear corridors between them, and the
 * corridors are most of what makes it read as designed rather than as woodland.
 *
 * The clearance is measured from the way's own edge, so it widens with the way:
 * a 2 m path keeps a 6 m corridor, the 6 m promenade keeps 10 m.
 */
function keepOut (world) {
  const cells = new Map()
  const segs = []
  const put = (idx, a, b, pad) => {
    const x0 = Math.floor((Math.min(a[0], b[0]) - pad) / GRID)
    const x1 = Math.floor((Math.max(a[0], b[0]) + pad) / GRID)
    const z0 = Math.floor((Math.min(a[1], b[1]) - pad) / GRID)
    const z1 = Math.floor((Math.max(a[1], b[1]) + pad) / GRID)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = cx * 100003 + cz
        let arr = cells.get(k)
        if (!arr) { arr = []; cells.set(k, arr) }
        arr.push(idx)
      }
    }
  }
  for (const r of world.roads ?? []) {
    if (!r.p || r.p.length < 2) continue
    const pad = r.w / 2 + (r.foot ? PATH_CLEAR : ROAD_CLEAR)
    for (let i = 0; i < r.p.length - 1; i++) {
      put(segs.length, r.p[i], r.p[i + 1], pad)
      segs.push({
        ax: r.p[i][0], az: r.p[i][1], bx: r.p[i + 1][0], bz: r.p[i + 1][1],
        half: r.w / 2, pad,
      })
    }
  }
  /** `corridor` also clears the margin; without it, only the paving itself. */
  const hit = (x, z, corridor) => {
    const list = cells.get(Math.floor(x / GRID) * 100003 + Math.floor(z / GRID))
    if (!list) return false
    for (let n = 0; n < list.length; n++) {
      const s = segs[list[n]]
      const dx = s.bx - s.ax, dz = s.bz - s.az
      const len2 = dx * dx + dz * dz
      let t = len2 ? ((x - s.ax) * dx + (z - s.az) * dz) / len2 : 0
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const d = Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t))
      if (d <= (corridor ? s.pad : s.half)) return true
    }
    return false
  }
  return {
    onWay: (x, z) => hit(x, z, false),
    inCorridor: (x, z) => hit(x, z, true),
  }
}

/**
 * The apron a landmark stands in.
 *
 * A monument is *sited*: it is given ground to be looked at from, and the open
 * ground is as much a part of it as the stone. Arcul de Triumf stands in a
 * paved apron with lawn wedges and the nearest trees set well back, so trees
 * within 34 m of it are wrong however carefully they avoid the paths — the
 * corridor rules have nothing to say about a space that is open on purpose.
 *
 * A landmark clears mapped trees too, which the path rules deliberately do not:
 * its apron is the one place where a surveyed tree position is more likely to
 * be a stray node than a real tree. The 42 smaller monuments are statues rather
 * than plazas, so they clear only the scattered guesses around them.
 */
function plazas (world) {
  const discs = []
  for (const l of world.landmarks ?? []) {
    discs.push({
      x: l.x, z: l.z,
      r: Math.max(l.width ?? 0, l.depth ?? 0) / 2 + PLAZA_SETBACK,
      mapped: true,
    })
  }
  for (const m of world.monuments ?? []) {
    discs.push({ x: m.x, z: m.z, r: MONUMENT_CLEAR, mapped: false })
  }
  return (x, z, isMapped) => {
    for (const d of discs) {
      if (isMapped && !d.mapped) continue
      if (Math.hypot(x - d.x, z - d.z) < d.r) return true
    }
    return false
  }
}

/**
 * Keeps scattered trees off each other.
 *
 * Uniform random sampling clumps: 101 of the 630 trees Cathedral Park used to
 * get had a neighbour within 4 m, which renders as a blob rather than as two
 * trees. Seeded with the mapped trees first, so a scattered one cannot land on
 * top of a real one either.
 */
function spacing () {
  // One cell is the widest gap asked for, so a three-by-three neighbourhood
  // always covers the query circle whatever gap the caller passes.
  const CELL = 5.0
  const cells = new Map()
  const key = (cx, cz) => cx * 100003 + cz
  return {
    add (x, z) {
      const k = key(Math.floor(x / CELL), Math.floor(z / CELL))
      let arr = cells.get(k)
      if (!arr) { arr = []; cells.set(k, arr) }
      arr.push(x, z)
    },
    free (x, z, gap) {
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL)
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          const arr = cells.get(key(cx + i, cz + j))
          if (!arr) continue
          for (let n = 0; n < arr.length; n += 2) {
            if (Math.hypot(x - arr[n], z - arr[n + 1]) < gap) return false
          }
        }
      }
      return true
    },
  }
}

/**
 * Trunk plus a canopy of three overlapping blobs — cheap, but reads as a tree.
 *
 * The subdivision level is the single most expensive number in the whole scene:
 * at detail 1 the canopy is 240 triangles and the ~3800 trees alone are 920k of
 * them, more than the entire building stock. Detail 0 costs 60, and at the size
 * a tree occupies on a phone screen the two are indistinguishable.
 */
function treeGeometries (lowDetail = false) {
  const trunk = new THREE.CylinderGeometry(0.13, 0.21, 1, 6, 1)
  trunk.translate(0, 0.5, 0)

  const blobs = []
  const spec = [
    [0, 0.62, 0, 0.52], [0.26, 0.44, 0.14, 0.36], [-0.2, 0.5, -0.18, 0.34],
  ]
  for (const [x, y, z, r] of spec) {
    const g = new THREE.IcosahedronGeometry(r, lowDetail ? 0 : 1)
    g.translate(x, y, z)
    blobs.push(g)
  }
  const canopy = BGU.mergeGeometries(blobs)
  canopy.computeVertexNormals()
  return { trunk, canopy }
}

const TRUNK_COLS = ['#5b4a3a', '#6a5744', '#4e4033']
const LEAF_COLS = ['#4e6b32', '#5c7a38', '#43602c', '#67854a', '#3d5a2b', '#6d8340']

export function buildProps (world, terrain, { lowDetail = false } = {}) {
  const group = new THREE.Group()
  group.name = 'props'

  // ---------------------------------------------------------------- trees
  const spots = []
  const ways = keepOut(world)
  const sited = plazas(world)
  const gaps = spacing()

  // Mapped trees are surveyed positions, so they keep them — a tree hard against
  // the edge of a path is an avenue, and that is what the corridor is *for*. The
  // only ones dropped are the handful standing in the paving itself, which no
  // clearance rule would put there and which read as a mistake wherever you see
  // them.
  let paved = 0
  for (const [x, z] of world.trees) {
    if (ways.onWay(x, z) || sited(x, z, true)) { paved++; continue }
    spots.push([x, z, 1])
    gaps.add(x, z)
  }

  // Fill out parks and woods, which OSM maps as areas rather than points.
  const DENSITY = { park: 1 / 190, forest: 1 / 70, grass: 1 / 420 }
  let seed = 1
  for (const area of world.areas) {
    const per = DENSITY[area.k]
    if (!per) continue
    const gap = TREE_GAP[area.k] ?? 4.0
    const b = ringBounds(area.r)
    const boxArea = (b.maxX - b.minX) * (b.maxZ - b.minZ)
    const want = Math.min(600, Math.floor(boxArea * per))
    for (let i = 0; i < want * 2 && i < 2400; i++) {
      const x = b.minX + rand(seed++) * (b.maxX - b.minX)
      const z = b.minZ + rand(seed++) * (b.maxZ - b.minZ)
      if (!pointInRing(x, z, area.r)) continue
      if (ways.inCorridor(x, z) || sited(x, z, false)) continue
      if (!gaps.free(x, z, gap)) continue
      gaps.add(x, z)
      spots.push([x, z, area.k === 'forest' ? 1.15 : 1])
    }
  }

  // Two canopy resolutions, split by distance from the centre.
  //
  // The map reaches Valea Morilor and Dendrariu at its corners, and those two
  // parks alone hold about 4,600 trees — more than the rest of the city put
  // together, all of it a kilometre and a half from anywhere you drive. Merging
  // is per-mesh, so nothing here is frustum-culled and every one of those
  // canopies is submitted every frame. Splitting the fleet keeps the streets you
  // actually use lush without paying full price out at the edges.
  const FAR = 700
  const near = [], far = []
  for (const sp of spots) (Math.hypot(sp[0], sp[1]) > FAR ? far : near).push(sp)
  spots.length = 0
  spots.push(...near, ...far)
  const nearCount = near.length

  const { trunk, canopy } = treeGeometries(lowDetail)
  const { canopy: canopyFar } = treeGeometries(true)
  const count = spots.length
  const trunkMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 })
  const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0, flatShading: true })

  const trunks = new THREE.InstancedMesh(trunk, trunkMat, count)
  const canopies = new THREE.InstancedMesh(canopy, leafMat, nearCount)
  const canopiesFar = new THREE.InstancedMesh(canopyFar, leafMat, count - nearCount)
  trunks.castShadow = canopies.castShadow = true
  canopiesFar.castShadow = false        // nobody reads a shadow 900 m away
  canopies.receiveShadow = true

  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const colT = new THREE.Color()
  const colL = new THREE.Color()

  for (let i = 0; i < count; i++) {
    const [x, z, boost] = spots[i]
    const h = (5.4 + rand(i * 3 + 1) * 6.2) * boost
    const spread = h * (0.42 + rand(i * 5 + 2) * 0.2)
    const gy = terrain.height(x, z)
    pos.set(x, gy, z)
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(i * 7 + 3) * Math.PI * 2)

    scl.set(spread * 0.34, h * 0.62, spread * 0.34)
    m.compose(pos, q, scl)
    trunks.setMatrixAt(i, m)

    pos.set(x, gy + h * 0.5, z)
    scl.set(spread, h * 0.62, spread)
    m.compose(pos, q, scl)
    const mesh = i < nearCount ? canopies : canopiesFar
    const slot = i < nearCount ? i : i - nearCount
    mesh.setMatrixAt(slot, m)

    colT.set(TRUNK_COLS[Math.floor(rand(i * 11 + 4) * TRUNK_COLS.length)])
    colL.set(LEAF_COLS[Math.floor(rand(i * 13 + 5) * LEAF_COLS.length)])
    const v = 0.86 + rand(i * 17 + 6) * 0.28
    trunks.setColorAt(i, colT)
    mesh.setColorAt(slot, colL.multiplyScalar(v))
  }
  trunks.instanceMatrix.needsUpdate = true
  canopies.instanceMatrix.needsUpdate = true
  canopiesFar.instanceMatrix.needsUpdate = true
  if (trunks.instanceColor) trunks.instanceColor.needsUpdate = true
  if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true
  group.add(trunks, canopies, canopiesFar)

  // ------------------------------------------------------------ streetlights
  const lampSpots = []
  /**
   * Is this point inside somebody's carriageway?
   *
   * A lamp is placed 1.1 m beyond the edge of the road it belongs to, which is
   * the pavement — unless that road is a side street crossing a boulevard, in
   * which case 1.1 m past its kerb is the middle of the boulevard. 17% of them
   * were standing in traffic, the worst 9.9 m into Stefan cel Mare.
   */
  const inCarriageway = (x, z) => {
    for (const r of world.roads) {
      if (r.foot) continue
      const half = r.w / 2 + 0.4
      for (let i = 0; i < r.p.length - 1; i++) {
        const a = r.p[i], b = r.p[i + 1]
        const dx = b[0] - a[0], dz = b[1] - a[1]
        const L2 = dx * dx + dz * dz
        if (L2 < 1e-6) continue
        let t = ((x - a[0]) * dx + (z - a[1]) * dz) / L2
        t = t < 0 ? 0 : t > 1 ? 1 : t
        if (Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t)) < half) return true
      }
    }
    return false
  }
  for (const road of world.roads) {
    if (road.rank > 3 || road.foot) continue      // main roads only
    const halfW = road.w / 2 + 1.1
    let carry = 0
    for (let i = 0; i < road.p.length - 1; i++) {
      const a = road.p[i], b = road.p[i + 1]
      const dx = b[0] - a[0], dz = b[1] - a[1]
      const len = Math.hypot(dx, dz)
      if (len < 0.01) continue
      const ux = dx / len, uz = dz / len
      const nx = uz, nz = -ux
      for (let d = carry; d < len; d += 32) {
        const side = ((lampSpots.length % 2) * 2 - 1)
        const lx = a[0] + ux * d + nx * halfW * side
        const lz = a[1] + uz * d + nz * halfW * side
        if (inCarriageway(lx, lz)) continue
        lampSpots.push([lx, lz, Math.atan2(nx * side, nz * side)])
      }
      carry = (carry - len) % 32
      if (carry < 0) carry += 32
    }
  }

  if (lampSpots.length) {
    const pole = new THREE.CylinderGeometry(0.09, 0.13, 8.2, 6)
    pole.translate(0, 4.1, 0)
    const arm = new THREE.CylinderGeometry(0.06, 0.06, 1.5, 5)
    arm.rotateZ(Math.PI / 2.6)
    arm.translate(0.62, 8.35, 0)
    const head = new THREE.BoxGeometry(0.62, 0.16, 0.3)
    head.translate(1.2, 8.1, 0)
    const lampGeo = BGU.mergeGeometries([pole, arm, head])
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x6d7175, roughness: 0.5, metalness: 0.7 })
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, lampSpots.length)
    lamps.castShadow = true
    for (let i = 0; i < lampSpots.length; i++) {
      const [x, z, rot] = lampSpots[i]
      pos.set(x, terrain.height(x, z), z)
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot)
      scl.set(1, 1, 1)
      m.compose(pos, q, scl)
      lamps.setMatrixAt(i, m)
    }
    lamps.instanceMatrix.needsUpdate = true
    group.add(lamps)
  }

  return {
    group, trees: count, treesFar: count - nearCount, treesOffPaving: paved,
    lamps: lampSpots.length, drawCalls: 4,
  }
}

// ------------------------------------------------------------------ fences

/**
 * Iron railing, drawn as an alpha-tested strip rather than modelled.
 *
 * The park railings alone run to kilometres. Modelling balusters would cost
 * hundreds of thousands of triangles for something you mostly see edge-on from a
 * moving car; a cut-out texture gives denser detail than geometry would, at two
 * triangles per segment.
 */
function railingTexture () {
  const cv = canvas(256)
  const c = cv.getContext('2d')
  const S = 256
  c.clearRect(0, 0, S, S)
  const iron = 'rgb(38,40,42)'
  c.fillStyle = iron
  c.fillRect(0, 18, S, 13)                       // top rail
  c.fillRect(0, 196, S, 11)                      // bottom rail
  c.fillRect(0, 92, S, 8)                        // mid rail
  const bars = 12
  for (let i = 0; i < bars; i++) {
    const x = (i + 0.5) * (S / bars)
    c.fillRect(x - 3, 18, 6, 189)                // baluster
    c.beginPath()                                // spear finial
    c.moveTo(x - 7, 18); c.lineTo(x, 0); c.lineTo(x + 7, 18)
    c.closePath(); c.fill()
  }
  // heavier post every fourth bay
  for (let i = 0; i <= 2; i++) {
    const x = i * (S / 2)
    c.fillRect(x - 8, 0, 16, 210)
  }
  return cv
}

/**
 * Fences, walls and hedges. A park that is fenced in reality reads as a lawn
 * you can drive across without them.
 */
export function buildFences (world, terrain) {
  const group = new THREE.Group()
  group.name = 'fences'
  const list = world.fences ?? []
  if (!list.length) return { group, count: 0, drawCalls: 0, triangles: 0 }

  const railTex = toTexture(railingTexture(), 1, 1, true)
  const MATS = {
    fence: new THREE.MeshStandardMaterial({
      map: railTex, alphaTest: 0.42, side: THREE.DoubleSide,
      roughness: 0.62, metalness: 0.45, envMapIntensity: 0.7,
    }),
    wall: new THREE.MeshStandardMaterial({ color: 0xb9b2a4, roughness: 0.94, side: THREE.DoubleSide }),
    hedge: new THREE.MeshStandardMaterial({ color: 0x405a2f, roughness: 0.98, side: THREE.DoubleSide }),
  }
  const buckets = { fence: [], wall: [], hedge: [] }
  const TILE = 2.4                               // metres per texture repeat

  for (const f of list) {
    const pts = f.p
    const h = f.h ?? 1.8
    const bucket = buckets[f.k] ?? buckets.fence
    let run = 0
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1]
      const len = Math.hypot(bx - ax, bz - az)
      if (len < 0.2) continue
      // Follow the ground: a fence bridging a dip in one long span floats.
      const n = Math.max(1, Math.ceil(len / 4))
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n
        const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0
        const x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1
        const y0 = terrain.height(x0, z0) - 0.15  // bury the foot slightly
        const y1 = terrain.height(x1, z1) - 0.15
        const u0 = run / TILE
        run += len / n
        const u1 = run / TILE
        bucket.push({ x0, y0, z0, x1, y1, z1, h, u0, u1 })
      }
    }
  }

  let triangles = 0, drawCalls = 0
  for (const [kind, segs] of Object.entries(buckets)) {
    if (!segs.length) continue
    const pos = new Float32Array(segs.length * 6 * 3)
    const uv = new Float32Array(segs.length * 6 * 2)
    const nor = new Float32Array(segs.length * 6 * 3)
    let p = 0, q = 0, r = 0
    for (const s of segs) {
      const dx = s.x1 - s.x0, dz = s.z1 - s.z0
      const l = Math.hypot(dx, dz) || 1
      const nx = -dz / l, nz = dx / l
      const corners = [
        [s.x0, s.y0, s.z0, s.u0, 0], [s.x1, s.y1, s.z1, s.u1, 0], [s.x1, s.y1 + s.h, s.z1, s.u1, 1],
        [s.x0, s.y0, s.z0, s.u0, 0], [s.x1, s.y1 + s.h, s.z1, s.u1, 1], [s.x0, s.y0 + s.h, s.z0, s.u0, 1],
      ]
      for (const [x, y, z, u, v] of corners) {
        pos[p++] = x; pos[p++] = y; pos[p++] = z
        uv[q++] = u; uv[q++] = v
        nor[r++] = nx; nor[r++] = 0; nor[r++] = nz
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
    const mesh = new THREE.Mesh(geo, MATS[kind])
    mesh.name = `fence-${kind}`
    mesh.castShadow = kind !== 'fence'   // a cut-out railing's shadow is not worth a depth pass
    mesh.receiveShadow = true
    group.add(mesh)
    triangles += segs.length * 2
    drawCalls++
  }
  return { group, count: list.length, drawCalls, triangles }
}
