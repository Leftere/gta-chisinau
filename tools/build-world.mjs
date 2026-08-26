/**
 * Turns the raw OSM dump into a compact, game-ready world file.
 *
 * Everything is projected onto a local tangent plane in metres, centred on
 * Piata Marii Adunari Nationale:  +x = east, +y = up, -z = north.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { centroid, minAreaRect } from './shape.mjs'

/**
 * Hand-authored per-building corrections, keyed by OSM id (e.g. "way/762704772").
 * These win over anything inferred from the footprint, and survive re-downloads.
 * See overrides.json for the supported fields.
 */
const OVERRIDES = existsSync('overrides.json')
  ? JSON.parse(readFileSync('overrides.json', 'utf8'))
  : {}
const overridesApplied = new Set()
// Buildings replaced by hand-modelled geometry. A multipolygon offers several
// outer rings; the largest is the one that best describes the structure.
const landmarkCandidates = new Map()

const raw = JSON.parse(readFileSync('data-cache/osm-raw.json', 'utf8'))
const { origin, bbox, elements } = raw

const M_PER_DEG_LAT = 110574
const M_PER_DEG_LON = 111320 * Math.cos(origin.lat * Math.PI / 180)

const project = (lat, lon) => [
  (lon - origin.lon) * M_PER_DEG_LON,
  -(lat - origin.lat) * M_PER_DEG_LAT,
]

const round = n => Math.round(n * 100) / 100

/** Douglas–Peucker: drops points that sit within `eps` metres of the line they span. */
function simplify (pts, eps) {
  if (pts.length < 3) return pts
  let maxD = 0, idx = 0
  const [ax, az] = pts[0]
  const [bx, bz] = pts[pts.length - 1]
  const dx = bx - ax, dz = bz - az
  const len2 = dx * dx + dz * dz
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, pz] = pts[i]
    let d
    if (len2 === 0) {
      d = Math.hypot(px - ax, pz - az)
    } else {
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2))
      d = Math.hypot(px - (ax + t * dx), pz - (az + t * dz))
    }
    if (d > maxD) { maxD = d; idx = i }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]]
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)]
}

const ringOf = geometry => geometry.map(g => project(g.lat, g.lon))

function signedArea (ring) {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1])
  }
  return a / 2
}

// ---------------------------------------------------------------- buildings

const LEVEL_HEIGHT = 3.1

function parseLength (v) {
  if (!v) return null
  const m = String(v).match(/-?[\d.]+/)
  if (!m) return null
  const n = parseFloat(m[0])
  return Number.isFinite(n) ? n : null
}

const DEFAULT_HEIGHT = {
  apartments: 16, residential: 12, house: 6.5, detached: 6.5, terrace: 7,
  commercial: 13, retail: 6, office: 18, industrial: 9, warehouse: 8,
  church: 17, cathedral: 24, chapel: 9, school: 11, university: 16,
  hospital: 18, hotel: 20, garage: 3, garages: 3, kiosk: 3, shed: 3,
  civic: 12, government: 15, train_station: 12, yes: 10,
}

/**
 * Only ~12% of Chisinau's footprints carry building:levels, so for the rest we
 * infer storeys and type from the footprint itself. The shapes are diagnostic:
 * Soviet mass housing was built as long narrow slabs (~10-16m deep, 45m+ long),
 * private houses are small and compact, and civic blocks are big and bulky.
 */
function inferForm (tags, ring, area, rnd) {
  const rect = minAreaRect(ring)
  const [cx, cz] = centroid(ring)
  const distFromCentre = Math.hypot(cx, cz)
  const b = tags.building || 'yes'
  const slab = rect.short >= 9 && rect.short <= 20 && rect.long >= 45

  // An explicit tag always wins over any guess.
  const taggedLevels = parseInt(tags['building:levels'] ?? '', 10)
  if (Number.isFinite(taggedLevels) && taggedLevels > 0) {
    return { levels: Math.min(taggedLevels, 40), kind: familyFor(b, tags, Math.min(taggedLevels, 40), area, slab, distFromCentre) }
  }

  let levels
  if (area < 55) levels = 1
  else if (b === 'garage' || b === 'garages' || b === 'shed' || b === 'kiosk') levels = 1
  else if (b === 'house' || b === 'detached' || b === 'bungalow') levels = 1 + (rnd < 0.45 ? 1 : 0)
  else if (b === 'apartments' || b === 'residential') levels = slab ? (rect.long > 70 ? 9 : 5) : (4 + Math.floor(rnd * 4))
  else if (slab) levels = rect.long > 75 ? 9 : 5              // panel block
  else if (area < 150) levels = 1 + (rnd < 0.4 ? 1 : 0)       // courtyard house
  else if (area > 2200) levels = 3 + Math.floor(rnd * 3)      // civic / mall bulk
  else if (distFromCentre < 650) levels = 2 + Math.floor(rnd * 3)
  else levels = 2 + Math.floor(rnd * 4)

  return { levels, kind: familyFor(b, tags, levels, area, slab, distFromCentre) }
}

/** Picks the facade family used to texture the building. */
function familyFor (b, tags, levels, area, slab, distFromCentre) {
  if (b === 'garage' || b === 'garages' || b === 'shed' || b === 'kiosk' || area < 55) return 'small'
  if (b === 'church' || b === 'cathedral' || b === 'chapel' || b === 'monastery') return 'church'
  if (b === 'industrial' || b === 'warehouse' || b === 'hangar') return 'industrial'
  if (b === 'civic' || b === 'government' || b === 'public' || b === 'school' ||
      b === 'university' || b === 'hospital' || b === 'train_station') return 'civic'
  if (b === 'retail' || b === 'commercial' || b === 'office' || b === 'hotel' || tags.shop) {
    return levels >= 8 ? 'glass' : 'commercial'
  }
  if (slab && levels >= 5) return 'panel'
  if (levels >= 5) return rndPick(area, ['panel', 'plain'])
  if (b === 'house' || b === 'detached' || area < 150) return 'house'
  // Low-rise near the centre is the surviving pre-war and interwar fabric.
  if (levels <= 3 && distFromCentre < 900) return 'historic'
  return 'plain'
}

function rndPick (seed, list) {
  return list[Math.floor((Math.sin(seed * 12.9898) * 43758.5453 % 1 + 1) % 1 * list.length)]
}

const buildings = []
const seenBuilding = new Set()

/**
 * Clips a polygon to the left of the directed line a->b (Sutherland-Hodgman).
 *
 * "Left" is the side where the cross product of (b-a) with (p-a) is positive,
 * with x running east and z running south. Reverse the two points to keep the
 * other half.
 */
function clipLeft (ring, [ax, az], [bx, bz]) {
  const dx = bx - ax, dz = bz - az
  const side = ([px, pz]) => dx * (pz - az) - dz * (px - ax)
  const cross = (p, q) => {
    const sp = side(p), sq = side(q)
    const t = sp / (sp - sq)
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]
  }
  const out = []
  for (let i = 0; i < ring.length; i++) {
    const cur = ring[i], nxt = ring[(i + 1) % ring.length]
    const sc = side(cur) >= 0, sn = side(nxt) >= 0
    if (sc) out.push(cur)
    if (sc !== sn) out.push(cross(cur, nxt))
  }
  return out
}

/**
 * Splits one footprint into separately-extruded parts.
 *
 * OSM says `building:levels=6;2;4` when a block steps — Gemeni is a six-storey
 * tower on the corner with a two-storey shop wing beside it — but a semicolon
 * list has nowhere to say *which* part is which, and extruding the whole ring to
 * the first number gives one flat-topped slab. Each part here is the footprint
 * clipped to the left of every line in its `keep` list, which is enough to carve
 * a plan into towers and wings without hand-typing rings.
 */
function partsOf (r, ov) {
  return ov.parts.map((part, i) => {
    let piece = r
    for (const [a, b] of part.keep ?? []) {
      piece = clipLeft(piece, a, b)
      if (piece.length < 3) break
    }
    return { piece, part, i }
  }).filter(p => p.piece.length >= 3 && Math.abs(signedArea(p.piece)) >= 12)
}

function addBuilding (key, osmId, tags, ring) {
  if (ring.length < 4) return
  if (seenBuilding.has(key)) return
  const ov = OVERRIDES[osmId] ?? {}
  if (ov.drop) { seenBuilding.add(key); overridesApplied.add(osmId); return }

  let r = simplify(ring, 0.4)
  if (r.length > 2 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop()
  if (r.length < 3) return

  const area = Math.abs(signedArea(r))
  if (area < 12) return                       // drop noise
  if (signedArea(r) < 0) r.reverse()          // normalise winding to counter-clockwise

  // Stable per-building randomness, so the skyline never reshuffles between runs.
  const rnd = ((Math.sin(Number(String(key).replace(/\D/g, '').slice(-9)) * 0.0001) + 1) / 2) % 1

  if (ov.model) {
    const rect = minAreaRect(r)
    const c = centroid(r)
    const prev = landmarkCandidates.get(osmId)
    if (!prev || area > prev.area) {
      landmarkCandidates.set(osmId, {
        id: osmId,
        model: ov.model,
        x: round(c[0]), z: round(c[1]),
        // The long side of the footprint is the frontage; the short side is the
        // depth. `angle` (degrees) overrides that, because a square or regular
        // plan has no long side: the cathedral's octagon measures 38.29 x 38.35,
        // so minAreaRect picks between its cardinal and its diagonal faces on a
        // 6 cm tie-break, and an Orthodox church is oriented altar-east whatever
        // the footprint happens to measure.
        angle: round(ov.angle !== undefined ? ov.angle * Math.PI / 180 : rect.angle),
        width: ov.width ?? round(rect.long),
        depth: ov.depth ?? round(rect.short),
        height: ov.height ?? 13,
        colour: ov.colour,
        name: ov.name ?? tags.name ?? undefined,
        area,
      })
    }
    seenBuilding.add(key)
    overridesApplied.add(osmId)
    return
  }

  // A stepped block becomes several buildings, one per part, each with its own
  // storey count. They keep the parent id with a suffix so the picker, the
  // workbench and overrides.json all still resolve to something meaningful.
  if (ov.parts?.length) {
    seenBuilding.add(key)
    overridesApplied.add(osmId)
    for (const { piece, part, i } of partsOf(r, ov)) {
      const sub = { ...ov, ...part }
      delete sub.parts
      delete sub.keep
      // Register before recursing: addBuilding reads OVERRIDES on entry. Anything
      // already written against the part's own id wins, so a part edited in the
      // workbench survives the next build.
      OVERRIDES[`${osmId}#${i}`] = { ...sub, ...(OVERRIDES[`${osmId}#${i}`] ?? {}) }
      addBuilding(`${key}#${i}`, `${osmId}#${i}`, { ...tags, 'building:levels': String(part.levels ?? '') },
        piece.map(([x, z]) => [round(x), round(z)]))
    }
    return
  }

  const inferred = inferForm(tags, r, area, rnd)
  const levels = ov.levels ?? inferred.levels
  const kind = ov.kind ?? inferred.kind
  const rect = minAreaRect(r)

  // An overridden storey count feeds the default height; an explicit height
  // override has to land after that default or it would be overwritten.
  let height = parseLength(tags.height) ?? parseLength(tags['building:height'])
  if (ov.levels !== undefined && ov.height === undefined) height = null
  if (!height) height = levels * LEVEL_HEIGHT + (kind === 'house' || kind === 'small' ? 0.9 : 0.6)
  if (ov.height !== undefined) height = ov.height
  height = Math.max(2.6, Math.min(height, 260))

  const minLevel = parseInt(tags['building:min_level'] ?? '', 10)
  const base = parseLength(tags.min_height) ?? (Number.isFinite(minLevel) ? minLevel * LEVEL_HEIGHT : 0)

  seenBuilding.add(key)
  if (Object.keys(ov).length) overridesApplied.add(osmId)
  buildings.push({
    id: osmId,
    r: r.map(([x, z]) => [round(x), round(z)]),
    h: round(height),
    b: round(base),
    l: levels,
    k: kind,
    // Oriented bounding box: lets the renderer put a ridged roof on a house
    // pointing the right way, and tells a slab apart from a tower.
    ra: round(rect.angle),
    rs: round(rect.short),
    rl: round(rect.long),
    n: ov.name ?? tags.name ?? undefined,
    // Renderer-side overrides: explicit paint colour, roof style, and a
    // bespoke entrance (door count, spacing, and the stair in front of it).
    c: ov.colour ?? undefined,
    roof: ov.roof ?? undefined,
    entrance: ov.entrance ?? undefined,
    // Metres of real window recess. Opt-in: it costs a few hundred triangles a
    // facade, worth it on a building you stand next to and not on all 4,600.
    reveal: ov.reveal ?? undefined,
  })
}

// ------------------------------------------------------------------- roads

const ROAD_WIDTH = {
  motorway: 15, motorway_link: 8, trunk: 13, trunk_link: 7,
  primary: 12.5, primary_link: 7, secondary: 10.5, secondary_link: 6,
  tertiary: 8.5, tertiary_link: 6, unclassified: 6.5, residential: 6.5,
  living_street: 5.5, service: 4, track: 3.5, pedestrian: 6,
  footway: 2, path: 1.8, steps: 2, cycleway: 2.5, construction: 5,
}
const RANK = {
  motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4,
  unclassified: 5, residential: 5, living_street: 6, service: 7,
}
const FOOT = new Set(['footway', 'path', 'steps', 'cycleway', 'pedestrian', 'track'])

const roads = []

function addRoad (tags, line) {
  const type = tags.highway
  if (!type || type === 'proposed' || type === 'raceway') return
  const pts = simplify(line, 0.6)
  if (pts.length < 2) return

  const lanes = parseInt(tags.lanes ?? '', 10)
  let width = ROAD_WIDTH[type] ?? 5
  if (Number.isFinite(lanes) && lanes > 0) width = Math.max(width, Math.min(lanes, 8) * 3.3)
  const explicit = parseLength(tags.width)
  if (explicit && explicit > 1.5 && explicit < 40) width = explicit

  roads.push({
    p: pts.map(([x, z]) => [round(x), round(z)]),
    w: round(width),
    t: type,
    rank: FOOT.has(type) ? 9 : (RANK[type.replace(/_link$/, '')] ?? 6),
    foot: FOOT.has(type) ? 1 : 0,
    lanes: Number.isFinite(lanes) ? lanes : (FOOT.has(type) ? 0 : Math.max(2, Math.round(width / 3.3))),
    oneway: tags.oneway === 'yes' ? 1 : 0,
    bridge: tags.bridge && tags.bridge !== 'no' ? 1 : 0,
    tunnel: tags.tunnel && tags.tunnel !== 'no' ? 1 : 0,
    layer: parseInt(tags.layer ?? '0', 10) || 0,
    name: tags.name || undefined,
  })
}

// ------------------------------------------------------- ground / greenery

const GREEN = {
  park: 'park', garden: 'park', grass: 'grass', meadow: 'grass', village_green: 'grass',
  forest: 'forest', wood: 'forest', scrub: 'grass', cemetery: 'grass',
  pitch: 'pitch', playground: 'pitch', sports_centre: 'pitch', stadium: 'pitch',
  water: 'water', reservoir: 'water', basin: 'water', riverbank: 'water',
  parking: 'parking', residential: 'courtyard', commercial: 'courtyard',
  retail: 'courtyard', education: 'courtyard', institutional: 'courtyard',
  industrial: 'industrial_land',
  farmland: 'grass', farmyard: 'grass', orchard: 'forest', recreation_ground: 'grass',
}

const areas = []
const trees = []
const monuments = []
const fences = []

/**
 * Joins a multipolygon relation's outer members into closed rings.
 *
 * A relation's members are not rings — the central park arrives as 26 separate
 * two-node fragments. Treating each as its own polygon (which is what the
 * building path does, because building relations happen to use closed ways)
 * yields 26 slivers of zero area, every one of them discarded, and a city whose
 * biggest park simply is not there.
 */
function stitchRings (members) {
  const open = members
    .filter(m => m.role === 'outer' && m.geometry && m.geometry.length >= 2)
    .map(m => ringOf(m.geometry))
  const rings = []
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5
  while (open.length) {
    let cur = open.pop()
    let joined = true
    while (joined && !near(cur[0], cur[cur.length - 1])) {
      joined = false
      for (let i = 0; i < open.length; i++) {
        const seg = open[i]
        const end = cur[cur.length - 1]
        if (near(end, seg[0])) { cur = cur.concat(seg.slice(1)); open.splice(i, 1); joined = true; break }
        if (near(end, seg[seg.length - 1])) { cur = cur.concat(seg.slice(0, -1).reverse()); open.splice(i, 1); joined = true; break }
      }
    }
    if (cur.length >= 4) rings.push(cur)
  }
  return rings
}

/**
 * Statues and memorials, but not every `historic` tag.
 *
 * `historic=monument` also lands on ordinary houses ("the house where X lived"),
 * and `tourism=artwork` covers murals and street art. Both would become stone
 * figures standing in the road, so the typed tags decide and an untyped
 * `historic=monument` is not enough on its own.
 */
const STATUE_KINDS = new Set(['statue', 'bust', 'sculpture', 'obelisk', 'stele', 'war_memorial'])
function isMonument (tags) {
  if (tags.building || tags['building:part']) return false
  const kind = tags.memorial || tags.artwork_type
  if (kind) return STATUE_KINDS.has(kind)
  return tags.historic === 'memorial'
}

function addMonument (id, tags, ring, point) {
  let x, z, w = 2.4, d = 2.4, angle = 0
  if (ring && ring.length >= 3) {
    const r = ring.slice()
    if (Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < 0.5) r.pop()
    if (r.length < 3) return
    ;[x, z] = centroid(r)
    const rect = minAreaRect(r)
    w = Math.max(1.2, rect.short)
    d = Math.max(1.2, rect.long)
    angle = rect.angle ?? 0
  } else if (point) {
    ;[x, z] = point
  } else return
  const kind = tags.memorial || tags.artwork_type || 'statue'
  // Height from footprint: a memorial standing on 36 m2 of granite is a city
  // monument, one on a 2 m plinth is a bust. An explicit height tag wins.
  const area = w * d
  const tagged = parseFloat(tags.height)
  const height = Number.isFinite(tagged) ? Math.min(40, tagged)
    : area >= 16 ? 11 : area >= 6 ? 6.5 : 3.4
  monuments.push({
    id, model: 'statue', kind,
    x: round(x), z: round(z), width: round(w), depth: round(d),
    angle: round(angle), height,
    name: tags.name || undefined,
  })
}

/** Fences, walls and hedges — the things that make a park read as enclosed. */
const FENCE_KINDS = new Set(['fence', 'wall', 'hedge', 'railing', 'guard_rail', 'city_wall'])
function addFence (tags, line) {
  if (!FENCE_KINDS.has(tags.barrier)) return
  const p = simplify(line, 0.6)
  if (p.length < 2) return
  let len = 0
  for (let i = 1; i < p.length; i++) len += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])
  if (len < 4) return
  fences.push({
    p: p.map(([x, z]) => [round(x), round(z)]),
    k: tags.barrier === 'hedge' ? 'hedge' : (tags.barrier === 'wall' || tags.barrier === 'city_wall' ? 'wall' : 'fence'),
    h: Math.min(3, Math.max(0.6, parseFloat(tags.height) || (tags.barrier === 'hedge' ? 1.4 : 1.8))),
  })
}

function addArea (tags, ring) {
  const key = tags.leisure || tags.landuse || tags.natural || tags.amenity
  const kind = GREEN[key]
  if (!kind) return
  let r = simplify(ring, 1.2)
  if (r.length > 2 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop()
  if (r.length < 3) return
  if (Math.abs(signedArea(r)) < 60) return
  if (signedArea(r) < 0) r.reverse()
  areas.push({ r: r.map(([x, z]) => [round(x), round(z)]), k: kind })
}

// ------------------------------------------------------------------- sweep

for (const el of elements) {
  const tags = el.tags || {}

  if (el.type === 'node') {
    if (tags.natural === 'tree') {
      const [x, z] = project(el.lat, el.lon)
      trees.push([round(x), round(z)])
    } else if (isMonument(tags)) {
      addMonument(`node/${el.id}`, tags, null, project(el.lat, el.lon))
    }
    continue
  }

  if (el.type === 'relation') {
    if (tags.building || tags['building:part']) {
      for (const m of el.members || []) {
        if (m.role === 'outer' && m.geometry) {
          addBuilding(`r${el.id}_${m.ref}`, `relation/${el.id}`, tags, ringOf(m.geometry))
        }
      }
      continue
    }
    if (isMonument(tags)) { addMonument(`relation/${el.id}`, tags, stitchRings(el.members || [])[0]); continue }
    if (tags.leisure || tags.landuse || tags.natural) {
      for (const ring of stitchRings(el.members || [])) addArea(tags, ring)
    }
    continue
  }

  if (el.type !== 'way' || !el.geometry) continue
  const line = ringOf(el.geometry)
  const closed = line.length > 3 &&
    Math.hypot(line[0][0] - line[line.length - 1][0], line[0][1] - line[line.length - 1][1]) < 0.5

  if (tags.barrier) { addFence(tags, line); continue }
  if (tags.highway) { addRoad(tags, line); continue }
  if (tags.building || tags['building:part']) { addBuilding(`w${el.id}`, `way/${el.id}`, tags, line); continue }
  if (isMonument(tags)) { addMonument(`way/${el.id}`, tags, line); continue }
  if (closed) addArea(tags, line)
}

// Draw the widest roads last so junctions layer correctly.
roads.sort((a, b) => b.rank - a.rank)

const extent = {
  x: [round((bbox.west - origin.lon) * M_PER_DEG_LON), round((bbox.east - origin.lon) * M_PER_DEG_LON)],
  z: [round(-(bbox.north - origin.lat) * M_PER_DEG_LAT), round(-(bbox.south - origin.lat) * M_PER_DEG_LAT)],
}

const landmarks = [...landmarkCandidates.values()].map(({ area, ...rest }) => rest)
const world = { origin, extent, buildings, roads, areas, trees, landmarks, monuments, fences }
const json = JSON.stringify(world)
writeFileSync('public/data/world.json', json)

const byKind = buildings.reduce((a, b) => (a[b.k] = (a[b.k] || 0) + 1, a), {})
console.log(`buildings ${buildings.length}   roads ${roads.length}   areas ${areas.length}   trees ${trees.length}`)
console.log(`monuments ${monuments.length}   fences ${fences.length}`)
for (const lm of landmarks) {
  console.log(`landmark: ${lm.name ?? lm.model}  model=${lm.model}  ` +
    `${lm.width}x${lm.depth}m  h=${lm.height}m  at ${lm.x},${lm.z}  ${(lm.angle * 180 / Math.PI).toFixed(0)}deg`)
}
const overrideCount = Object.keys(OVERRIDES).filter(k => !k.startsWith('_')).length
const unmatched = Object.keys(OVERRIDES).filter(k => !k.startsWith('_') && !overridesApplied.has(k))
console.log(`overrides: ${overridesApplied.size}/${overrideCount} matched` +
  (unmatched.length ? `  <-- no building for: ${unmatched.join(', ')}` : ''))
console.log('facade families:', byKind)
console.log(`extent  x ${extent.x.join(' .. ')} m   z ${extent.z.join(' .. ')} m`)
console.log(`-> public/data/world.json  (${(json.length / 1e6).toFixed(1)} MB)`)
