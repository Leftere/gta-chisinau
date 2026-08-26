/**
 * Single-building workbench.
 *
 * Iterating on a facade inside the full city means a 30-second load, then
 * driving to the building, then finding an angle you can actually judge it
 * from. This loads one footprint, on its real patch of ground with its real
 * street in front, and lets you orbit it — so a facade family can be checked
 * against a photograph in a couple of seconds instead of a couple of minutes.
 *
 * It deliberately reuses the game's own builders and renderer rather than a
 * simplified preview. A workbench that lights or extrudes buildings differently
 * from the game would send you off tuning against the wrong picture.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Renderer } from './render/pipeline.js'
import { Terrain, FLAT } from './world/terrain.js'
import { buildCity } from './world/buildings.js'
import { buildDetails } from './world/details.js'
import { buildRoads } from './world/roads.js'
import { buildLandmarks } from './world/landmarks.js'
import { surfaceMaterials } from './world/surfaces.js'
import { FAMILIES } from './world/materials.js'

const $ = id => document.getElementById(id)

/** Everything within this radius is built, so the building has a street to meet. */
const CONTEXT_R = 95
/**
 * Ground patch radius, as a multiple of the building's own span.
 *
 * A fixed radius runs out from under Casa Guvernului, which is 177 m long: the
 * camera pulls back far enough to frame it and the ground simply stops partway.
 */
const GROUND_SPAN = 3.2
const GROUND_MIN = 110

let world, terrain, renderer, scene, camera, controls
let current = null           // the building record as it came from the map
let edits = {}               // live experiment, layered on top
let content = null           // the group holding everything rebuilt per change
let spin = false
let saved = {}               // overrides.json as it stands on disk
let hasApi = false           // false when served from a build rather than `npm run dev`
let worklist = []            // biggest-first, for working through the city

// ------------------------------------------------------------------- the api
// Present only under `npm run dev` (see tools/vite-overrides.mjs). Everything
// that writes degrades to copy-the-snippet when it is missing.

async function api (path, payload) {
  const res = await fetch('/__wb' + path, payload
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    : undefined)
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
  return res.json()
}

async function loadOverrides () {
  try {
    saved = await api('/overrides')
    hasApi = true
  } catch {
    saved = {}
    hasApi = false
  }
}

/** Fields the workbench writes. Anything else already on the entry is kept. */
function patchFor (bd) {
  const p = {}
  if (edits.k && edits.k !== current.k) p.kind = edits.k
  if (edits.l && edits.l !== current.l) { p.levels = edits.l; p.height = bd.h }
  if (edits.roof) p.roof = edits.roof
  if (edits.c) p.colour = edits.c
  const note = $('note').value.trim()
  if (note) p._note = note
  return p
}

// --------------------------------------------------------------------- data

async function load () {
  world = await (await fetch('data/world.json')).json()
  terrain = FLAT
  try {
    const res = await fetch('data/terrain.json')
    if (res.ok) terrain = new Terrain(await res.json())
  } catch { /* flat is a usable fallback */ }
}

const centreOf = ring => {
  let x = 0, z = 0
  for (const p of ring) { x += p[0]; z += p[1] }
  return [x / ring.length, z / ring.length]
}

/** Radius of the footprint from its centre — what the camera has to frame. */
function spanOf (ring, cx, cz) {
  let r = 0
  for (const p of ring) r = Math.max(r, Math.hypot(p[0] - cx, p[1] - cz))
  return r
}

const spanOfBd = (bd, cx, cz) =>
  bd.r ? spanOf(bd.r, cx, cz) : Math.max(bd.width, bd.depth) * 0.7

// ------------------------------------------------------------------ ground

/**
 * A disc of the real heightfield under the building.
 *
 * `terrain.buildMesh` would hand back the whole 2.6 km city — 370k triangles to
 * look at one house. This samples the same function on the same grid, so the
 * building still sits on exactly the ground it sits on in the game.
 */
function groundPatch (cx, cz, radius) {
  const mats = surfaceMaterials()
  const step = 4
  const n = Math.ceil((radius * 2) / step)
  const x0 = cx - radius, z0 = cz - radius
  const pos = [], uv = [], idx = []
  const tile = mats.courtyard.userData.tile
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = x0 + i * step, z = z0 + j * step
      pos.push(x, terrain.height(x, z), z)
      uv.push(x / tile.w, z / tile.h)
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1
      // Same diagonal Terrain.height() interpolates over, so the surface the
      // eye sees and the surface everything is placed on are the same surface.
      idx.push(a, c, b, d, b, c)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, mats.courtyard)
  mesh.receiveShadow = true
  return mesh
}

// ------------------------------------------------------------------- build

/** The building as the game would read it, with any live experiment applied. */
function effective () {
  const bd = { ...current, ...edits }
  if (edits.l && edits.l !== current.l && !('h' in edits)) {
    // Height follows storeys unless it was overridden too, or a 9-storey
    // experiment silently keeps the 2-storey height and looks like nothing
    // happened.
    bd.h = +(edits.l * (current.h / current.l)).toFixed(1)
  }
  return bd
}

function rebuild () {
  if (content) {
    scene.remove(content)
    content.traverse(o => { if (o.geometry) o.geometry.dispose() })
    content = null
  }
  const bd = effective()
  const isLm = !bd.r                      // hand-modelled landmarks have no ring
  const [cx, cz] = isLm ? [bd.x, bd.z] : centreOf(bd.r)

  const group = new THREE.Group()
  group.add(groundPatch(cx, cz, Math.max(GROUND_MIN, spanOfBd(bd, cx, cz) * GROUND_SPAN)))

  // Nearby roads, so the entrance lands on the wall that actually faces a
  // street and you can see how the building meets the pavement.
  const near = world.roads.filter(r =>
    r.p.some(p => Math.hypot(p[0] - cx, p[1] - cz) < CONTEXT_R))
  const mini = {
    buildings: isLm ? [] : [bd], roads: near, areas: [], trees: [],
    landmarks: isLm ? [bd] : [], monuments: [], fences: [],
  }

  const city = buildCity(mini, terrain)
  group.add(city.group)
  group.add(buildRoads(mini, terrain).group)
  group.add(buildDetails(mini, city.footprints, terrain).group)
  const lms = buildLandmarks(mini, terrain)
  group.add(lms.group)

  scene.add(group)
  content = group

  const span = spanOfBd(bd, cx, cz)
  const top = terrain.height(cx, cz) + (bd.h ?? bd.height ?? 10)
  controls.target.set(cx, top * 0.45, cz)
  renderer.focusShadows?.(new THREE.Vector3(cx, top * 0.5, cz))

  $('hud').innerHTML = isLm
    ? `<b>${bd.name || bd.model}</b><br>hand-modelled · ${bd.model} · ${bd.height} m<br>` +
      `${lms.group.children.length} mesh(es)`
    : `<b>${bd.n || bd.id}</b><br>${bd.k} · ${bd.l} storeys · ${bd.h} m<br>` +
      `${city.triangles.toLocaleString()} triangles`
  return { cx, cz, span, top }
}

/** Frames the building: pull back until its whole height fits in the view. */
function frame ({ cx, cz, span, top }) {
  const fit = Math.max(span * 1.9, top * 1.5, 22)
  const a = -0.9
  camera.position.set(cx + Math.sin(a) * fit, top * 0.85 + 4, cz + Math.cos(a) * fit)
  controls.minDistance = Math.max(6, span * 0.7)
  controls.maxDistance = fit * 5
  controls.update()
}

// --------------------------------------------------------------------- ui

function fillInfo () {
  const bd = effective()
  if (!bd.r) {
    $('info').innerHTML = [
      ['id', bd.id], ['name', bd.name || '—'], ['model', bd.model],
      ['height', `${bd.height} m`], ['size', `${bd.width} × ${bd.depth} m`],
    ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')
    $('snippet').textContent = `  "${bd.id}": { "model": "${bd.model}", "height": ${bd.height} },`
    $('osm').href = `https://www.openstreetmap.org/${bd.id}`
    return
  }
  const rows = [
    ['id', bd.id],
    ['name', bd.n || '—'],
    ['family', bd.k],
    ['storeys', bd.l],
    ['height', `${bd.h} m`],
    ['footprint', `${bd.rs} × ${bd.rl} m`],
    ['corners', bd.r.length],
  ]
  $('info').innerHTML = rows.map(([k, v]) => {
    const changed = ({ family: 'k', storeys: 'l', height: 'h' })[k]
    const on = changed && edits[changed] !== undefined && edits[changed] !== current[changed]
    return `<tr class="${on ? 'ov' : ''}"><td>${k}</td><td>${v}</td></tr>`
  }).join('')

  const p = patchFor(bd)
  const body = Object.entries(p).map(([k, v]) => `"${k}": ${JSON.stringify(v)}`).join(', ')
  $('snippet').textContent = `  "${bd.id}": { ${body || `"kind": "${bd.k}"`} },`
  $('osm').href = `https://www.openstreetmap.org/${bd.id}`
  $('side').classList.toggle('edited', !!saved[bd.id])

  // Stepped blocks: say so, and offer the siblings.
  const sibs = partsOf(bd.id)
  const bar = $('siblings')
  if (sibs.length > 1) {
    bar.innerHTML = 'part of a stepped block: ' + sibs.map(sb =>
      `<a href="?id=${encodeURIComponent(sb.id)}"${sb.id === bd.id ? ' class="on"' : ''}>${sb.id.split('#')[1] ?? 'whole'} · ${sb.l}f</a>`).join(' ')
  } else bar.innerHTML = ''
}

/** Buildings first, then the hand-modelled landmarks and OSM monuments. */
function lookup (id) {
  const hit = world.buildings.find(b => b.id === id)
    ?? world.landmarks?.find(l => l.id === id)
    ?? world.monuments?.find(m => m.id === id)
  if (hit) return hit
  // A stepped block is emitted as `id#0`, `id#1`… so the bare OSM id no longer
  // names anything. Land on the first part rather than reporting it missing.
  return world.buildings.find(b => b.id.startsWith(id + '#')) ?? null
}

/** Sibling parts of a stepped block, so you can step between them. */
const partsOf = id => {
  const stem = id.split('#')[0]
  return world.buildings.filter(b => b.id === stem || b.id.startsWith(stem + '#'))
}

function show (id, { keepCamera = false } = {}) {
  const bd = lookup(id)
  if (!bd) { $('err').textContent = `nothing in the map with id "${id}"`; return false }
  $('err').textContent = ''
  current = bd
  edits = {}
  $('id').value = bd.id
  // The experiment controls only mean anything for an extruded building.
  const modelled = !bd.r
  for (const el of ['kind', 'levels', 'roof', 'colour', 'reset']) $(el).disabled = modelled
  if (modelled) { $('kind').value = FAMILIES[bd.model] ? bd.model : $('kind').value; return finish(bd, keepCamera) }
  $('kind').value = bd.k
  $('levels').value = bd.l
  $('roof').value = ''
  $('colour').value = bd.c || '#c9c4b8'
  // Start from what is already on disk, so opening a building you edited last
  // week shows that edit rather than the raw inference.
  const ov = saved[bd.id]
  if (ov) {
    if (ov.kind) { edits.k = ov.kind; $('kind').value = ov.kind }
    if (ov.levels) { edits.l = ov.levels; $('levels').value = ov.levels }
    if (ov.height) edits.h = ov.height
    if (ov.roof) { edits.roof = ov.roof; $('roof').value = ov.roof }
    if (ov.colour) { edits.c = ov.colour; $('colour').value = ov.colour }
  }
  $('note').value = ov?._note ?? ''
  return finish(bd, keepCamera)
}

function finish (bd, keepCamera) {
  const box = rebuild()
  if (!keepCamera) frame(box)
  fillInfo()
  history.replaceState(null, '', `?id=${encodeURIComponent(bd.id)}`)
  return true
}

function apply () {
  const box = rebuild()
  void box
  fillInfo()
}

/** Transient status line under a group of buttons. */
const note = (el, msg, ok) => {
  const n = $(el)
  n.textContent = msg
  n.className = ok ? 'ok' : 'bad'
  if (ok) setTimeout(() => { if (n.textContent === msg) { n.textContent = ''; n.className = '' } }, 4000)
}

// --------------------------------------------------------------- worklist

/**
 * Biggest first, skipping anything already decided.
 *
 * A city has 4,640 buildings and you are never going to photograph all of them,
 * so the order matters: the large ones on the boulevard are what people see.
 */
function buildWorklist () {
  worklist = world.buildings
    .map(b => ({ id: b.id, score: (b.rs ?? 0) * (b.rl ?? 0) * Math.max(1, b.l ?? 1) }))
    .sort((a, b) => b.score - a.score)
    .map(b => b.id)
}

function refreshProgress () {
  const done = Object.keys(saved).filter(k => !k.startsWith('_')).length
  const left = worklist.findIndex(id => !saved[id])
  $('progress').textContent = hasApi
    ? `${done} building${done === 1 ? '' : 's'} overridden · next unedited is #${left < 0 ? '—' : left + 1} by size`
    : 'read-only: run `npm run dev` to save from here'
}

function nextTodo () {
  const from = worklist.indexOf(current?.id ?? '')
  for (let i = 1; i <= worklist.length; i++) {
    const id = worklist[(Math.max(0, from) + i) % worklist.length]
    if (!saved[id]) return show(id)
  }
  note('saved', 'every building has an override', true)
}

// ------------------------------------------------------------------- main

async function main () {
  $('busy').classList.add('on')
  await load()
  await loadOverrides()
  buildWorklist()

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(46, 1, 0.2, 3000)
  renderer = new Renderer($('view'), scene, camera, 'high')

  controls = new OrbitControls(camera, $('view'))
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxPolarAngle = Math.PI * 0.495     // stop just short of underground
  controls.screenSpacePanning = false

  // family dropdown, straight from the material table so it cannot drift
  $('kind').innerHTML = Object.keys(FAMILIES)
    .map(k => `<option value="${k}">${k}</option>`).join('')

  const setHour = h => {
    const t = (h - 5.5) / 15.5
    renderer.setSun(Math.sin(Math.max(0, Math.min(1, t)) * Math.PI) * 62 - 1.5, -95 + t * 190)
    $('hourlbl').textContent =
      `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`
  }
  // Midday by default. A low sun looks better but throws half the facade into
  // shadow, and you cannot judge a window grid you cannot see.
  setHour(13)

  const first = new URLSearchParams(location.search).get('id')
  if (!(first && show(first))) {
    // Fall back to something, but keep the complaint — silently showing a
    // different building is how you spend ten minutes tuning the wrong one.
    const why = first ? $('err').textContent : ''
    show(world.buildings[Math.floor(world.buildings.length / 2)].id)
    $('err').textContent = why
  }
  refreshProgress()
  $('busy').classList.remove('on')

  // --- controls ------------------------------------------------------------
  $('idform').addEventListener('submit', e => { e.preventDefault(); show($('id').value.trim()) })
  const step = d => {
    const i = world.buildings.findIndex(b => b.id === current.id)
    show(world.buildings[(i + d + world.buildings.length) % world.buildings.length].id)
  }
  $('prev').onclick = () => step(-1)
  $('next').onclick = () => step(1)
  $('rand').onclick = () => show(world.buildings[Math.floor(Math.random() * world.buildings.length)].id)
  $('todo').onclick = () => nextTodo()

  // --- writing -------------------------------------------------------------
  $('save').onclick = async () => {
    if (!hasApi) return note('saved', 'needs `npm run dev` — copy the snippet instead', false)
    try {
      const r = await api('/override', { id: current.id, patch: patchFor(effective()) })
      await loadOverrides()
      fillInfo(); refreshProgress()
      note('saved', r.override ? 'saved to overrides.json' : 'no changes — override removed', true)
    } catch (e) { note('saved', e.message, false) }
  }
  $('forget').onclick = async () => {
    if (!hasApi) return note('saved', 'needs `npm run dev`', false)
    try {
      await api('/forget', { id: current.id })
      await loadOverrides()
      show(current.id, { keepCamera: true })
      refreshProgress()
      note('saved', 'override removed', true)
    } catch (e) { note('saved', e.message, false) }
  }
  $('rebuild').onclick = async () => {
    if (!hasApi) return note('built', 'needs `npm run dev`', false)
    note('built', 'rebuilding world.json…', true)
    $('rebuild').disabled = true
    try {
      const r = await api('/build', {})
      // The workbench reads world.json at load, so it has to re-read it to see
      // the edit it just caused.
      world = await (await fetch('data/world.json?t=' + Date.now())).json()
      buildWorklist()
      show(current.id, { keepCamera: true })
      const line = (r.stdout || '').split('\n').find(l => l.startsWith('buildings')) || 'done'
      note('built', line.trim(), true)
    } catch (e) { note('built', e.message, false) }
    $('rebuild').disabled = false
  }

  $('kind').onchange = e => { edits.k = e.target.value; apply() }
  $('levels').onchange = e => { edits.l = Math.max(1, +e.target.value | 0); apply() }
  $('roof').onchange = e => { edits.roof = e.target.value || undefined; apply() }
  $('colour').oninput = e => { edits.c = e.target.value; apply() }
  $('reset').onclick = () => show(current.id, { keepCamera: true })
  $('copy').onclick = () => navigator.clipboard?.writeText($('snippet').textContent)
  $('hour').oninput = e => setHour(+e.target.value)

  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return
    if (e.key.toLowerCase() === 'r') spin = !spin
  })


  // --- loop ----------------------------------------------------------------
  const resize = () => {
    const el = $('stage')
    camera.aspect = el.clientWidth / el.clientHeight
    camera.updateProjectionMatrix()
    renderer.resize()
  }
  addEventListener('resize', resize)
  resize()

  const frameLoop = () => {
    requestAnimationFrame(frameLoop)
    if (spin) {
      const t = controls.target
      const dx = camera.position.x - t.x, dz = camera.position.z - t.z
      const a = 0.004
      camera.position.x = t.x + dx * Math.cos(a) - dz * Math.sin(a)
      camera.position.z = t.z + dx * Math.sin(a) + dz * Math.cos(a)
    }
    controls.update()
    renderer.render(1 / 60)
  }
  frameLoop()

  window.__wb = {
    show, nextTodo, api, buildWorklist,
    get current () { return current }, get saved () { return saved }, get hasApi () { return hasApi },
    edits, terrain, camera, controls,
    get world () { return world },
  }
}

main().catch(e => {
  $('busy').classList.add('on')
  $('busy').textContent = `failed: ${e.message}`
  console.error(e)
})
