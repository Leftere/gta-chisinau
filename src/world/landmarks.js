/**
 * Hand-modelled landmarks.
 *
 * Footprint extrusion can never produce an arch: the opening is a feature of the
 * elevation, not the plan. Buildings tagged with a `model` in overrides.json are
 * dropped from the extruder and built here instead, from real proportions.
 */
import * as THREE from 'three'
import * as BGU from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { cityMaterials } from './materials.js'

/**
 * Planar-projects UVs from position and normal so masonry keeps a constant
 * real-world scale across every face, whatever primitive produced it.
 */
function worldUV (geo, tileW, tileH) {
  const pos = geo.attributes.position
  const nor = geo.attributes.normal
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i))
    let u, v
    if (ny >= nx && ny >= nz) { u = pos.getX(i); v = pos.getZ(i) }
    else if (nx >= nz) { u = pos.getZ(i); v = pos.getY(i) }
    else { u = pos.getX(i); v = pos.getY(i) }
    uv[i * 2] = u / tileW
    uv[i * 2 + 1] = v / tileH
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return geo
}

/** Box spanning the given extents, in the model's local frame. */
function box (w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y + h / 2, z)
  return g
}

/**
 * A wall pierced by a round-headed opening: the elevation is drawn as a shape
 * with a hole, then extruded through the depth. This is what makes it an arch
 * rather than a block.
 */
function piercedWall (w, h, d, openW, springH, yBase) {
  const shape = new THREE.Shape()
  shape.moveTo(-w / 2, 0)
  shape.lineTo(w / 2, 0)
  shape.lineTo(w / 2, h)
  shape.lineTo(-w / 2, h)
  shape.closePath()

  const r = openW / 2
  const hole = new THREE.Path()
  hole.moveTo(-r, 0)
  hole.lineTo(-r, springH)
  hole.absarc(0, springH, r, Math.PI, 0, true)   // semicircular head, over the top
  hole.lineTo(r, 0)
  hole.closePath()
  shape.holes.push(hole)

  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false, curveSegments: 18 })
  g.translate(0, yBase, -d / 2)
  g.computeVertexNormals()
  return g
}

/** A solid shaped like a round-headed opening — used as the back of a niche. */
function archPanel (w, springH, thickness, yBase) {
  const shape = new THREE.Shape()
  const r = w / 2
  shape.moveTo(-r, 0)
  shape.lineTo(-r, springH)
  shape.absarc(0, springH, r, Math.PI, 0, true)
  shape.lineTo(r, 0)
  shape.closePath()
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 18 })
  g.translate(0, yBase, -thickness / 2)
  g.computeVertexNormals()
  return g
}

/** A dome of revolution from an explicit profile, in metres from its springing. */
function lathe (profile, y0, seg = 20) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y))
  const g = new THREE.LatheGeometry(pts, seg)
  g.translate(0, y0, 0)
  return g
}

/**
 * A regular prism or frustum standing between two heights.
 *
 * `sides` of 8 with a 22.5-degree twist puts flats on the axes, which is what
 * makes an octagon read as a chamfered square rather than as a turret.
 */
function prism (rTop, rBot, y0, y1, sides, twist = 0) {
  const g = new THREE.CylinderGeometry(rTop, rBot, y1 - y0, sides, 1)
  if (twist) g.rotateY(twist)
  g.translate(0, (y0 + y1) / 2, 0)
  return g
}

/** A cylinder standing between two heights. */
function cyl (rTop, rBot, y0, y1, x, z, seg = 14) {
  const g = new THREE.CylinderGeometry(rTop, rBot, y1 - y0, seg, 1)
  g.translate(x, (y0 + y1) / 2, z)
  return g
}

/**
 * Arcul de Triumf, Chisinau (1840).
 *
 * Four corner piers faced with paired Corinthian columns, open on both axes.
 * The lower passage is trabeated — flat-topped, spanned by a deep entablature —
 * and the semicircular arch is the upper tier, a coffered vault holding the bell.
 */
function arcDeTriomphe ({ width = 11.2, depth = 7.0, height = 13.0 }) {
  const W = width, D = depth
  const s = height / 13.0          // proportions authored against the real 13m

  const PLINTH_T  = 0.65 * s       // top of the stepped base
  const PED_T     = 1.05 * s       // top of the column pedestals
  const SHAFT_T   = 5.95 * s
  const CAP_T     = 6.65 * s       // capitals = underside of the architrave
  const ARCH_T    = 7.20 * s       // architrave
  const FRIEZE_T  = 8.10 * s
  const CORNICE_T = 8.85 * s       // top of the lower tier
  const ATTIC_T   = 12.35 * s

  const PIER_W = W * 0.28
  const PIER_D = D * 0.37
  const ATTIC_W = W * 0.78
  const ATTIC_D = D * 0.79
  const COL_R = 0.46 * s

  const parts = []
  const px = (W - PIER_W) / 2      // pier centre offsets
  const pz = (D - PIER_D) / 2

  // stepped base
  parts.push(box(W + 0.75, PLINTH_T * 0.55, D + 0.75, 0, 0, 0))
  parts.push(box(W + 0.35, PLINTH_T * 0.45, D + 0.35, 0, PLINTH_T * 0.55, 0))

  // four corner piers — the openings between them are simply the gaps
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(box(PIER_W, CAP_T - PLINTH_T, PIER_D, sx * px, PLINTH_T, sz * pz))
    }
  }

  // paired columns on both main faces of every pier
  const colOffset = PIER_W * 0.24
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (const pair of [-1, 1]) {
        const cx = sx * px + pair * colOffset
        const cz = sz * (D / 2 + COL_R * 0.62)
        parts.push(box(COL_R * 2.5, PED_T - PLINTH_T, COL_R * 2.5, cx, PLINTH_T, cz))
        parts.push(cyl(COL_R * 0.92, COL_R, PED_T, SHAFT_T, cx, cz))
        // Corinthian capital: a flared bell under a square abacus.
        parts.push(cyl(COL_R * 1.5, COL_R * 0.95, SHAFT_T, CAP_T - 0.18 * s, cx, cz))
        parts.push(box(COL_R * 3.1, 0.18 * s, COL_R * 3.1, cx, CAP_T - 0.18 * s, cz))
      }
    }
  }

  // entablature: architrave, ornamented frieze, heavy projecting cornice
  parts.push(box(W + 0.3, ARCH_T - CAP_T, D + 0.3, 0, CAP_T, 0))
  parts.push(box(W + 0.16, FRIEZE_T - ARCH_T, D + 0.16, 0, ARCH_T, 0))
  parts.push(box(W + 0.95, CORNICE_T - FRIEZE_T, D + 0.95, 0, FRIEZE_T, 0))

  // the entablature breaks forward over each column pair
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(box(PIER_W * 0.92, CORNICE_T - CAP_T, 0.34 * s,
        sx * px, CAP_T, sz * (D / 2 + 0.30 * s)))
    }
  }

  // wreath medallions along the frieze, dentils beneath the cornice
  const friezeY = (ARCH_T + FRIEZE_T) / 2
  for (const sz of [-1, 1]) {
    for (const t of [-0.16, 0.16]) {
      const g = new THREE.CylinderGeometry(0.24 * s, 0.24 * s, 0.11 * s, 14)
      g.rotateX(Math.PI / 2)
      g.translate(t * W, friezeY, sz * (D / 2 + 0.13))
      parts.push(g)
    }
  }
  const dentils = Math.round(W / 0.58)
  for (let i = 0; i < dentils; i++) {
    const x = -W / 2 + (i + 0.5) * (W / dentils)
    for (const sz of [-1, 1]) {
      parts.push(box(0.24 * s, 0.24 * s, 0.22 * s, x, FRIEZE_T - 0.26 * s, sz * (D / 2 + 0.2)))
    }
  }

  // Attic: two deep arched niches with a solid core between, so the vault reads
  // as a recess from either side rather than a hole straight through.
  const nicheW = 4.7 * s
  const slab = 1.95 * s
  const core = ATTIC_D - slab * 2
  for (const sz of [-1, 1]) {
    const wall = piercedWall(ATTIC_W, ATTIC_T - CORNICE_T, slab, nicheW, 0.80 * s, CORNICE_T)
    wall.translate(0, 0, sz * (core / 2 + slab / 2))
    parts.push(wall)
  }
  parts.push(box(ATTIC_W, ATTIC_T - CORNICE_T, core, 0, CORNICE_T, 0))
  parts.push(box(ATTIC_W + 0.95, height - ATTIC_T, ATTIC_D + 0.95, 0, ATTIC_T, 0))

  const geo = BGU.mergeGeometries(parts.map(g => g.toNonIndexed()))
  geo.computeVertexNormals()

  // The bell hanging in the vault — the focal point of the upper tier.
  const bellY = CORNICE_T + (ATTIC_T - CORNICE_T) * 0.62
  const bell = BGU.mergeGeometries([
    cyl(0.30 * s, 0.62 * s, bellY - 0.95 * s, bellY, 0, 0, 16).toNonIndexed(),
    cyl(0.10 * s, 0.10 * s, bellY, bellY + 0.30 * s, 0, 0, 8).toNonIndexed(),
  ])
  bell.computeVertexNormals()

  // The back of each vault, tinted down — a shallow recess otherwise reads as a
  // flat panel however deep it actually is.
  const vaultBacks = []
  for (const sz of [-1, 1]) {
    const panel = archPanel(nicheW - 0.05, 0.80 * s, 0.10, CORNICE_T)
    panel.translate(0, 0, sz * (core / 2 - 0.06))
    vaultBacks.push(panel.toNonIndexed())
  }
  const vault = BGU.mergeGeometries(vaultBacks)
  vault.computeVertexNormals()

  return {
    geo,
    extras: [
      { geo: vault, colour: '#6a6053', roughness: 0.95, metalness: 0 },
      { geo: bell, colour: '#3a2f22', roughness: 0.42, metalness: 0.85 },
    ],
  }
}

/**
 * A statue on a pedestal — the shape almost every memorial in the city takes.
 *
 * Proportions come from the Stefan cel Mare monument (Plamadeala, 1928): a broad
 * stepped platform, a tall inscribed die, a moulded cap, and a bronze figure a
 * little over a third of the total height with one arm raised. The masonry and
 * the figure are returned separately so the bronze can carry its own material —
 * a stone-textured statue reads as a garden ornament.
 */
function statue ({ width = 6, depth = 6, height = 11 }) {
  const H = height
  const W = Math.max(2.2, Math.min(width, depth))
  const parts = []

  // stepped platform
  const stepH = H * 0.020
  for (let i = 0; i < 3; i++) {
    const w = W * (1 - i * 0.15)
    parts.push(box(w, stepH, w, 0, i * stepH, 0))
  }
  let y = stepH * 3

  // Base, die and cap. The pedestal carries about 58% of the height — the
  // figure reads as monumental because it is held up, not because it is big.
  const baseW = W * 0.55
  parts.push(box(baseW, H * 0.09, baseW, 0, y, 0)); y += H * 0.09
  const dieW = W * 0.36
  parts.push(box(dieW * 1.12, H * 0.03, dieW * 1.12, 0, y, 0)); y += H * 0.03   // base moulding
  parts.push(box(dieW, H * 0.35, dieW, 0, y, 0)); y += H * 0.35                 // inscribed die
  parts.push(box(dieW * 1.16, H * 0.045, dieW * 1.16, 0, y, 0)); y += H * 0.045 // cap

  // --- the figure, in bronze --------------------------------------------
  const figH = H - y
  const bronze = []
  const s = figH / 4.2                       // authored against a 4.2 m figure
  // robe: a tapered column, which is what a standing draped figure reads as
  bronze.push(cyl(0.42 * s, 0.62 * s, y, y + 2.0 * s, 0, 0, 10))
  bronze.push(box(0.86 * s, 1.15 * s, 0.52 * s, 0, y + 2.0 * s, 0))     // torso
  bronze.push(box(0.30 * s, 0.34 * s, 0.30 * s, 0, y + 3.15 * s, 0))    // head
  bronze.push(box(0.52 * s, 0.16 * s, 0.34 * s, 0, y + 3.49 * s, 0))    // crown
  // right arm raised, holding the cross aloft
  bronze.push(box(0.20 * s, 1.15 * s, 0.20 * s, 0.52 * s, y + 2.25 * s, 0))
  const cy = y + 3.55 * s
  bronze.push(box(0.10 * s, 1.05 * s, 0.10 * s, 0.52 * s, cy, 0))       // cross shaft
  bronze.push(box(0.44 * s, 0.10 * s, 0.10 * s, 0.52 * s, cy + 0.62 * s, 0))
  // left arm down, resting on a sword
  bronze.push(box(0.18 * s, 1.25 * s, 0.18 * s, -0.50 * s, y + 1.85 * s, 0))
  bronze.push(box(0.10 * s, 1.30 * s, 0.10 * s, -0.50 * s, y + 0.55 * s, 0))

  return {
    geo: BGU.mergeGeometries(parts.map(g => g.toNonIndexed())),
    extras: [{
      geo: BGU.mergeGeometries(bronze.map(g => g.toNonIndexed())),
      colour: 0x55684f, roughness: 0.58, metalness: 0.66,   // weathered bronze patina
    }],
  }
}

/**
 * Clopotnita — the Nativity Cathedral bell tower, Chisinau (1836, rebuilt 1997).
 *
 * A freestanding campanile is a *telescope*: three square stages, each set back
 * from the one below and each capped by its own projecting cornice, then a
 * copper cupola. That stepping is the whole silhouette. Extruding the footprint
 * gives a 20 m flat-topped box, which is what this was before — the plan says
 * nothing about it, because every set-back is a fact of the elevation.
 *
 * The footprint is the give-away: an 11.3 m square standing at 45 degrees to the
 * street grid with a small porch projecting from the centre of each face, so the
 * plan is a Greek cross on a square. `minAreaRect` picks up those faces, which
 * is why the model needs no angle of its own.
 *
 * Openings differ by stage and it matters which is which. The bottom stage is
 * *closed*: a tall round-headed window recessed in the wall over the entrance
 * porch. The middle stage is genuinely *open* — that is where the bells hang and
 * you can see daylight through it. The top stage is an open arcade behind a
 * railing. Give the bottom stage the open arch and it reads as a gatehouse.
 */
function bellTower ({ width = 11.3, depth = 11.3, height = 28.0 }) {
  const W = width, D = depth, H = height

  // Authored as fractions of the total height, so the tower keeps its
  // proportions if OSM's 20 m is ever corrected.
  const STEPS_T = 0.045 * H
  const S1_T    = 0.400 * H       // top of the bottom stage's wall
  const C1_T    = 0.445 * H       // top of its cornice
  const S2_T    = 0.615 * H
  const C2_T    = 0.660 * H
  const S3_T    = 0.800 * H
  const C3_T    = 0.840 * H
  const DOME_T  = 0.955 * H

  const W2 = 0.72 * W, D2 = 0.72 * D
  const W3 = 0.54 * W, D3 = 0.54 * D

  const parts = []
  const backs = []                // recess backs, tinted down
  const metal = []                // bell and cross

  // --- podium ---------------------------------------------------------------
  parts.push(box(W + 1.5, STEPS_T * 0.45, D + 1.5, 0, 0, 0))
  parts.push(box(W + 0.7, STEPS_T * 0.55, D + 0.7, 0, STEPS_T * 0.45, 0))

  // --- bottom stage ---------------------------------------------------------
  // A hollow skin with a solid core behind it, so the arched window is a real
  // recess. A dark panel painted on a flat wall reads as a poster.
  const t1 = 0.55                                  // wall thickness
  // The window is a window: about a third of the face, with real wall left both
  // beside it and above it. Sized to fill the face it becomes a gatehouse arch,
  // which is what the first pass looked like.
  const winW = 0.30 * W
  const sill = 0.200 * H, spring = 0.050 * H
  for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const faceW = sx ? W : D
    const wall = piercedWall(faceW, S1_T - STEPS_T, t1, winW, sill - STEPS_T + spring, STEPS_T)
    if (sx) wall.rotateY(Math.PI / 2)   // piercedWall faces +z natively
    wall.translate(sx * (W / 2 - t1 / 2), 0, sz * (D / 2 - t1 / 2))
    parts.push(wall)
    // The opening is a window, not a doorway: fill it back in below the sill.
    parts.push(box(sz ? winW : t1, sill - STEPS_T, sz ? t1 : winW,
      sx * (W / 2 - t1 / 2), STEPS_T, sz * (D / 2 - t1 / 2)))
    // The back of the recess, a hand's width behind the skin.
    const back = archPanel(winW - 0.06, spring, 0.12, sill)
    if (sx) back.rotateY(Math.PI / 2)   // piercedWall faces +z natively
    back.translate(sx * (W / 2 - t1 - 0.05), 0, sz * (D / 2 - t1 - 0.05))
    backs.push(back)
  }
  parts.push(box(W - t1 * 2, S1_T - STEPS_T, D - t1 * 2, 0, STEPS_T, 0))
  // corner pilaster strips
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(box(1.15, S1_T - STEPS_T, 1.15, sx * (W / 2 - 0.5), STEPS_T, sz * (D / 2 - 0.5)))
    }
  }
  parts.push(box(W + 0.9, C1_T - S1_T, D + 0.9, 0, S1_T, 0))

  // --- the four entrance porches -------------------------------------------
  // One on the centre of each face, which is what turns the square plan into
  // the Greek cross the footprint actually draws.
  const porchT = 0.160 * H, porchW = 0.46 * W, porchP = 1.9
  const colR = 0.30
  for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const across = sx ? porchW : porchW
    const cx = sx * (W / 2 + porchP / 2), cz = sz * (D / 2 + porchP / 2)
    for (const side of [-1, 1]) {
      const ox = sz ? side * across * 0.36 : sx * (W / 2 + porchP - colR * 1.6)
      const oz = sx ? side * across * 0.36 : sz * (D / 2 + porchP - colR * 1.6)
      parts.push(box(colR * 2.4, 0.5, colR * 2.4, ox, STEPS_T, oz))
      parts.push(cyl(colR * 0.9, colR, STEPS_T + 0.5, porchT - 0.55, ox, oz))
      parts.push(box(colR * 2.6, 0.28, colR * 2.6, ox, porchT - 0.55, oz))
    }
    // entablature slab over the columns, and the wall the doorway sits in
    parts.push(box(sx ? porchP + 0.3 : across + 0.7, 0.62, sz ? porchP + 0.3 : across + 0.7,
      cx, porchT - 0.27, cz))
    const doorW = 0.16 * W
    const door = archPanel(doorW, 0.05 * H, 0.10, STEPS_T)
    if (sx) door.rotateY(Math.PI / 2)   // piercedWall faces +z natively
    door.translate(sx * (W / 2 - 0.02), 0, sz * (D / 2 - 0.02))
    backs.push(door)
  }

  // --- middle stage: the belfry, genuinely open ----------------------------
  const t2 = 0.5
  const belW = 0.48 * W2, belSpring = 0.07 * H
  for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const faceW = sx ? W2 : D2
    const wall = piercedWall(faceW, S2_T - C1_T, t2, belW, belSpring, C1_T)
    if (sx) wall.rotateY(Math.PI / 2)   // piercedWall faces +z natively
    wall.translate(sx * (W2 / 2 - t2 / 2), 0, sz * (D2 / 2 - t2 / 2))
    parts.push(wall)
  }
  // A corner pier at each corner, so the stage reads as a frame carrying the
  // cornice rather than as a tube with four holes punched in it.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(box(1.0, S2_T - C1_T, 1.0,
        sx * (W2 / 2 - 0.5), C1_T, sz * (D2 / 2 - 0.5)))
    }
  }
  parts.push(box(W2 + 0.75, C2_T - S2_T, D2 + 0.75, 0, S2_T, 0))

  // The bell, hanging where you can see it through the openings.
  const bellY = C1_T + (S2_T - C1_T) * 0.62
  metal.push(cyl(0.34, 0.72, bellY - 1.15, bellY, 0, 0, 16))
  metal.push(cyl(0.11, 0.11, bellY, bellY + 0.34, 0, 0, 8))

  // --- top stage: an open arcade behind a railing ---------------------------
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(box(0.8, S3_T - C2_T, 0.8, sx * (W3 / 2 - 0.4), C2_T, sz * (D3 / 2 - 0.4)))
      parts.push(cyl(0.26, 0.29, C2_T + 0.55, S3_T - 0.55,
        sx * (W3 / 2 - 0.42), sz * (D3 / 2 - 0.42), 10))
    }
  }
  for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    parts.push(box(sz ? W3 - 0.4 : 0.34, 0.85, sx ? D3 - 0.4 : 0.34,
      sx * (W3 / 2 - 0.17), C2_T, sz * (D3 / 2 - 0.17)))          // railing
  }
  parts.push(box(W3 + 0.8, C3_T - S3_T, D3 + 0.8, 0, S3_T, 0))

  const geo = BGU.mergeGeometries(parts.map(g => g.toNonIndexed()))
  geo.computeVertexNormals()

  // --- cupola ---------------------------------------------------------------
  // A shallow segmental dome on a short drum. Faceted rather than smooth: the
  // real one is ribbed, and 20 segments is what makes the ribs read at all.
  const dr = 0.255 * W
  const rise = DOME_T - C3_T
  const profile = []
  for (let i = 0; i <= 8; i++) {
    const u = i / 8
    profile.push([dr * Math.cos(u * Math.PI / 2) ** 0.72, rise * Math.sin(u * Math.PI / 2)])
  }
  const domeParts = [
    cyl(dr * 1.02, dr * 1.06, C3_T - 0.35, C3_T + 0.25, 0, 0, 20).toNonIndexed(),
    lathe(profile, C3_T + 0.25, 20).toNonIndexed(),
  ]
  const dome = BGU.mergeGeometries(domeParts)
  dome.computeVertexNormals()

  // finial: a ball, a stem and a cross
  const fy = C3_T + 0.25 + rise
  metal.push(cyl(0.18, 0.18, fy - 0.1, fy + 0.28, 0, 0, 10))
  metal.push(cyl(0.07, 0.07, fy + 0.28, H, 0, 0, 8))
  metal.push(box(0.62, 0.10, 0.10, 0, H - 0.62, 0))

  const bronze = BGU.mergeGeometries(metal.map(g => g.toNonIndexed()))
  bronze.computeVertexNormals()
  const recess = BGU.mergeGeometries(backs.map(g => g.toNonIndexed()))
  recess.computeVertexNormals()

  return {
    geo,
    extras: [
      { geo: recess, colour: '#6a6053', roughness: 0.95, metalness: 0 },
      // Weathered copper, authored greener than it measures: ACES at this
      // exposure pulls the saturation out of everything that is not the sky.
      { geo: dome, colour: '#5f9179', roughness: 0.55, metalness: 0.30 },
      { geo: bronze, colour: '#3a3128', roughness: 0.42, metalness: 0.70 },
    ],
  }
}

/**
 * Catedrala Mitropolitana "Nasterea Domnului", Chisinau (1836).
 *
 * Neoclassical Greek cross: a regular octagon body — a square with its corners
 * chamfered — carrying a drum and a ribbed dome over the crossing, with a
 * pedimented portico on each of the four cardinal faces. `building=cathedral`
 * and `height=10` were both already right, which is exactly why it was left
 * alone for so long: nothing about the tags is wrong, and the extrusion still
 * produced a 10 m octagonal drum of a building with a flat lid. The dome is 24 m
 * of the elevation and none of the plan.
 *
 * OSM's 10 m is kept, as the height of the main cornice — the walls really are
 * that low, and it is the dome above them that makes the building. Everything
 * above the cornice is proportioned from the photograph.
 *
 * Orientation is stated rather than measured, and it is stated from the
 * *ensemble*, not from the building. The footprint is 38.29 x 38.35 m, so
 * `minAreaRect` is choosing between the octagon's cardinal and diagonal faces on
 * a 6 cm tie-break — it has no real answer to give. What settles it is that the
 * cathedral, the Clopotnita and Arcul de Triumf are collinear: 135 deg from the
 * cathedral to the bell tower, 134 deg on to the arch. That line is the axis the
 * whole square was laid out on, and the main portico faces down it. Hence
 * `"angle": 45` in the override, which puts a portico on the bell tower.
 *
 * Altar-east is the wrong rule to reach for here and it cost a round: a
 * nineteenth-century planned composition is set out on its own axis, and
 * Chisinau's grid runs at 45 degrees to the compass.
 */
function cathedral ({ width = 39.5, depth = 39.5, height = 34.0 }) {
  const W = Math.max(width, depth), H = height
  // Across-flats to circumradius for a regular octagon.
  const R = W / (2 * Math.cos(Math.PI / 8))
  const TWIST = Math.PI / 8

  const STEP_T  = 0.9
  const EAVES   = 10.0                   // OSM's own height=10, the main cornice
  const CORN_T  = EAVES + 1.0
  const ROOF_T  = CORN_T + 3.4
  const ATTIC_T = ROOF_T + 1.6
  const DRUM_T  = 0.605 * H
  const DOME_T  = 0.815 * H
  const LANT_T  = 0.925 * H

  const stone = []
  const roofing = []          // sheet-metal roof planes, mid grey-green
  const domeShell = []        // the dome proper, much darker than the roof
  const darkGlass = []
  const gilt = []

  // --- stylobate ------------------------------------------------------------
  stone.push(prism(R + 2.2, R + 2.2, 0, STEP_T * 0.5, 8, TWIST))
  stone.push(prism(R + 1.3, R + 1.3, STEP_T * 0.5, STEP_T, 8, TWIST))

  // --- body -----------------------------------------------------------------
  stone.push(prism(R, R, STEP_T, EAVES, 8, TWIST))
  stone.push(prism(R + 0.75, R + 0.6, EAVES, CORN_T, 8, TWIST))

  // Low hipped roof over the octagon, pulled in to the attic it carries.
  roofing.push(prism(R * 0.52, R + 0.55, CORN_T, ROOF_T, 8, TWIST))

  // --- porticos -------------------------------------------------------------
  // Built once facing +z and rotated onto the other three faces. The face is at
  // the octagon's inradius, which is half the across-flats measure.
  const faceZ = W / 2
  const colH = EAVES - STEP_T - 1.6
  const colR = 0.82
  const bay = 2.7
  const proj = 6.2
  const half = bay * 2.5
  {
    const p = []
    // steps up to the porch
    for (let i = 0; i < 4; i++) {
      p.push(box(half * 2 + 3.4 - i * 0.5, 0.30, 1.5 + i * 0.9,
        0, i * 0.30, faceZ + proj + 1.4 - i * 0.45))
    }
    p.push(box(half * 2 + 1.8, STEP_T, proj + 1.0, 0, 0.9, faceZ + proj / 2))
    for (let i = -2.5; i <= 2.5; i++) {
      const cx = i * bay
      p.push(box(colR * 2.6, 0.4, colR * 2.6, cx, STEP_T + 0.9, faceZ + proj - 1.1))
      p.push(cyl(colR * 0.88, colR, STEP_T + 1.3, STEP_T + 1.3 + colH, cx, faceZ + proj - 1.1, 12))
      p.push(box(colR * 2.9, 0.34, colR * 2.9, cx, STEP_T + 1.3 + colH, faceZ + proj - 1.1))
    }
    // entablature and pediment
    const entY = STEP_T + 1.64 + colH
    p.push(box(half * 2 + 1.6, 1.35, proj + 0.8, 0, entY, faceZ + proj / 2))
    // Triglyphs, one over each column and one over each gap. A Doric
    // entablature without them is just a beam, and the alternation is most of
    // what identifies the order at any distance.
    const frontZ = faceZ + proj + 0.45
    for (let i = -5; i <= 5; i++) {
      p.push(box(0.44, 0.78, 0.16, i * (bay / 2), entY + 0.18, frontZ))
    }
    const ped = new THREE.Shape()
    ped.moveTo(-(half + 0.8), 0)
    ped.lineTo(half + 0.8, 0)
    ped.lineTo(0, 3.1)
    ped.closePath()
    const pg = new THREE.ExtrudeGeometry(ped, { depth: 1.7, bevelEnabled: false })
    pg.translate(0, entY + 1.35, faceZ + proj - 0.55)
    p.push(pg)
    const one = BGU.mergeGeometries(p.map(g => g.toNonIndexed()))
    // The semicircular light in the tympanum — small, and the only thing
    // breaking the pediment, so it carries more than its size.
    const fan = archPanel(2.6, 0.15, 0.12, entY + 1.55)
    fan.translate(0, 0, faceZ + proj + 1.1)
    for (let k = 0; k < 4; k++) {
      const c = one.clone(); c.rotateY(k * Math.PI / 2); stone.push(c)
      const f = fan.clone(); f.rotateY(k * Math.PI / 2); darkGlass.push(f)
    }
  }

  // --- attic and drum -------------------------------------------------------
  const dR = 0.192 * W
  stone.push(prism(dR + 1.5, dR + 1.9, ROOF_T - 0.4, ATTIC_T, 8, TWIST))
  stone.push(prism(dR, dR, ATTIC_T, DRUM_T, 24))
  // Round-headed windows with pilasters between them, all the way round: the
  // drum is what the building is recognised by, and a blank cylinder kills it.
  const WINDOWS = 12
  for (let i = 0; i < WINDOWS; i++) {
    const th = (i / WINDOWS) * Math.PI * 2
    const sinT = Math.sin(th), cosT = Math.cos(th)
    const wY = ATTIC_T + 1.5
    const pane = archPanel(2.0, 1.0, 0.5, wY)
    pane.rotateY(th)
    pane.translate(sinT * (dR - 0.12), 0, cosT * (dR - 0.12))
    darkGlass.push(pane)
    const th2 = ((i + 0.5) / WINDOWS) * Math.PI * 2
    const pil = box(0.85, DRUM_T - ATTIC_T - 0.5, 0.5, 0, ATTIC_T, 0)
    pil.rotateY(th2)
    pil.translate(Math.sin(th2) * (dR + 0.12), 0, Math.cos(th2) * (dR + 0.12))
    stone.push(pil)
  }
  stone.push(prism(dR + 1.1, dR + 0.85, DRUM_T, DRUM_T + 0.9, 24))

  // --- dome -----------------------------------------------------------------
  // Ribbed and very dark: this one is not a gilded onion, it is a lead-grey
  // hemisphere, and it is the single most recognisable thing about the building.
  const domeR = dR + 0.9
  const rise = DOME_T - (DRUM_T + 0.9)
  const prof = []
  for (let i = 0; i <= 10; i++) {
    const u = i / 10
    prof.push([domeR * Math.cos(u * Math.PI / 2) ** 0.85, rise * Math.sin(u * Math.PI / 2)])
  }
  domeShell.push(lathe(prof, DRUM_T + 0.9, 24))

  // --- lantern and cross ----------------------------------------------------
  stone.push(cyl(1.5, 1.6, DOME_T - 0.3, LANT_T - 1.1, 0, 0, 12))
  roofing.push(lathe([[1.5, 0], [1.1, 0.5], [0.5, 0.95], [0.05, 1.1]], LANT_T - 1.1, 12))
  gilt.push(cyl(0.13, 0.13, LANT_T, H - 1.5, 0, 0, 8))
  gilt.push(box(0.14, H - LANT_T, 0.14, 0, LANT_T, 0))
  gilt.push(box(1.5, 0.16, 0.14, 0, H - 1.6, 0))
  gilt.push(box(0.95, 0.14, 0.13, 0, H - 0.55, 0))

  const merge = (list) => {
    const g = BGU.mergeGeometries(list.map(x => x.toNonIndexed()))
    g.computeVertexNormals()
    return g
  }

  return {
    geo: merge(stone),
    extras: [
      // Sheet metal, and the metalness is the dial that matters, not the hex.
      // At 0.35 it came out near-black and swallowed the roof into the dome;
      // lightening the colour to compensate turned it pale blue instead, because
      // what a metal reflects here is a cool sky. Dropping metalness lets the
      // authored green survive, and the dome stays the darker of the two.
      { geo: merge(roofing), colour: '#636d64', roughness: 0.66, metalness: 0.05 },
      { geo: merge(domeShell), colour: '#4a4844', roughness: 0.55, metalness: 0.08 },
      { geo: merge(darkGlass), colour: '#2b2c30', roughness: 0.5, metalness: 0 },
      { geo: merge(gilt), colour: '#c9a227', roughness: 0.35, metalness: 0.55 },
    ],
  }
}

const MODELS = { arch: arcDeTriomphe, statue, belltower: bellTower, cathedral }



/**
 * Builds every modelled landmark and the collision footprints they need.
 * The arch's piers block the car; its passage deliberately does not, so you can
 * drive straight through it.
 */
export function buildLandmarks (world, terrain) {
  const group = new THREE.Group()
  group.name = 'landmarks'
  const footprints = []
  // Monuments come from OSM rather than from overrides.json, but they are built
  // and picked exactly the same way.
  const all = [...(world.landmarks ?? []), ...(world.monuments ?? [])]
  if (!all.length) return { group, footprints, count: 0 }

  const mats = cityMaterials()
  const stone = mats.facades.stone
  const tile = stone.userData.tile

  for (const lm of all) {
    const build = MODELS[lm.model]
    if (!build) { console.warn(`unknown landmark model "${lm.model}"`); continue }

    // A model returns either bare masonry, or masonry plus parts that need
    // their own material (the arch's bronze bell).
    const built = build(lm)
    const geo = built.geo ?? built
    const extras = built.extras ?? []
    worldUV(geo, tile.w, tile.h)

    const tint = (g, hex) => {
      const col = new THREE.Color(hex)
      const n = g.attributes.position.count
      const colours = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) colours.set([col.r, col.g, col.b], i * 3)
      g.setAttribute('color', new THREE.BufferAttribute(colours, 3))
    }
    tint(geo, lm.colour || '#d9cfb6')

    const mesh = new THREE.Mesh(geo, stone)
    mesh.castShadow = true
    mesh.receiveShadow = true
    // The arch sits on the origin, where the ground is 0 by definition; a
    // monument three streets away is not so lucky.
    const groundY = terrain ? terrain.height(lm.x, lm.z) : 0
    mesh.position.set(lm.x, groundY, lm.z)
    mesh.rotation.y = -lm.angle
    mesh.name = lm.name || lm.model
    // Landmarks aren't in world.buildings, so the picker resolves them from here.
    mesh.userData.landmark = lm
    group.add(mesh)

    for (const ex of extras) {
      worldUV(ex.geo, tile.w, tile.h)
      const m = new THREE.Mesh(ex.geo, new THREE.MeshStandardMaterial({
        color: ex.colour, roughness: ex.roughness ?? 0.6, metalness: ex.metalness ?? 0,
        envMapIntensity: 0.8,
      }))
      m.castShadow = true
      m.position.copy(mesh.position)
      m.rotation.copy(mesh.rotation)
      m.userData.landmark = lm      // clicking the bell selects the arch
      group.add(m)
    }

    // Collision: the four corner piers. Both axes stay open, so you can drive
    // through the arch either way and only hit stone if you clip a corner.
    if (lm.model === 'arch') {
      const pierW = lm.width * 0.28
      const pierD = lm.depth * 0.37
      const cx0 = (lm.width - pierW) / 2
      const cz0 = (lm.depth - pierD) / 2
      const cos = Math.cos(-lm.angle), sin = Math.sin(-lm.angle)
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const ring = [
            [-pierW / 2, -pierD / 2], [pierW / 2, -pierD / 2],
            [pierW / 2, pierD / 2], [-pierW / 2, pierD / 2],
          ].map(([qx, qz]) => {
            const lx = qx + sx * cx0
            const lz = qz + sz * cz0
            return [lm.x + lx * cos + lz * sin, lm.z - lx * sin + lz * cos]
          })
          footprints.push({ ring, top: lm.height, base: groundY })
        }
      }
    }

    // A tower is solid to its full footprint — unlike the arch, there is
    // nothing to drive through.
    if (lm.model === 'belltower' || lm.model === 'cathedral') {
      const hw = lm.width / 2, hd = lm.depth / 2
      const cos = Math.cos(-lm.angle), sin = Math.sin(-lm.angle)
      const ring = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) =>
        [lm.x + lx * cos + lz * sin, lm.z - lx * sin + lz * cos])
      footprints.push({ ring, top: groundY + lm.height, base: groundY })
    }

    // A statue is solid: the plinth blocks the car, sized to the die rather
    // than the platform so you can drive up to the steps.
    if (lm.model === 'statue') {
      const r = Math.max(1.1, Math.min(lm.width, lm.depth) * 0.30)
      const cos = Math.cos(-lm.angle), sin = Math.sin(-lm.angle)
      const ring = [[-r, -r], [r, -r], [r, r], [-r, r]].map(([lx, lz]) =>
        [lm.x + lx * cos + lz * sin, lm.z - lx * sin + lz * cos])
      footprints.push({ ring, top: groundY + lm.height * 0.5, base: groundY })
    }
  }

  return { group, footprints, count: all.length }
}
