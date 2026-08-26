/**
 * Entry point: loads the city, wires up the loop, drives the HUD.
 */
import * as THREE from 'three'
import { buildCity } from './world/buildings.js'
import { cityMaterials } from './world/materials.js'
import { buildRoads, buildGround } from './world/roads.js'
import { buildProps, buildFences } from './world/props.js'
import { buildLandmarks } from './world/landmarks.js'
import { buildDetails } from './world/details.js'
import { Terrain, FLAT } from './world/terrain.js'
import { SurfaceIndex } from './world/surface.js'
import { Renderer, QUALITY } from './render/pipeline.js'
import { Car, buildCarMesh, PAINT_COLOURS } from './game/car.js'
import { Input } from './game/input.js'
import { TouchControls, isCoarse } from './game/touch.js'
import { ChaseCamera } from './game/camera.js'
import { CarAudio } from './game/audio.js'
import { boulevardRoute, boulevardLoop, TrolleyFleet } from './game/trolleybus.js'
import { buildTrolleyWires, buildTrafficLights } from './world/streetgear.js'
import { buildGleMesh, buildTag, NpcCar, shuttleLoop } from './game/npccar.js'
import { inject } from '@vercel/analytics'

// Vercel Web Analytics.
//
// Gated on the build flag rather than left on `mode: 'auto'`, which resolves by
// reading process.env.NODE_ENV — a variable that does not exist in a Vite
// browser bundle. The lookup throws, the package swallows it, and every
// environment is treated as production, so the dev server spends its life
// 404ing on /_vercel/insights/script.js.
//
// Injected at module scope, before main() runs, so a device that cannot start
// WebGL still counts as a visit. That is the visit you most want to know about.
if (import.meta.env.PROD) inject({ mode: 'production', debug: false })

const $ = id => document.getElementById(id)
const loader = $('loader')

function stage (text, pct) {
  $('stage').textContent = text
  $('bar').firstElementChild.style.width = `${pct}%`
  // Yield to the browser so the loading screen actually repaints.
  return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))
}

function fail (err) {
  console.error(err)
  $('err').style.display = 'grid'
  $('errmsg').textContent = err?.stack || String(err)
  loader.classList.add('done')
}

// --------------------------------------------------------------- street names

/** Nearest named road to a point, for the "Now on" readout. */
class StreetIndex {
  constructor (roads) {
    this.cell = 40
    this.cells = new Map()
    this.segs = []
    for (const r of roads) {
      if (!r.name || r.foot) continue
      for (let i = 0; i < r.p.length - 1; i++) {
        const idx = this.segs.length
        this.segs.push([r.p[i][0], r.p[i][1], r.p[i + 1][0], r.p[i + 1][1], r.name])
        const minX = Math.floor(Math.min(r.p[i][0], r.p[i + 1][0]) / this.cell)
        const maxX = Math.floor(Math.max(r.p[i][0], r.p[i + 1][0]) / this.cell)
        const minZ = Math.floor(Math.min(r.p[i][1], r.p[i + 1][1]) / this.cell)
        const maxZ = Math.floor(Math.max(r.p[i][1], r.p[i + 1][1]) / this.cell)
        for (let x = minX; x <= maxX; x++) {
          for (let z = minZ; z <= maxZ; z++) {
            const k = x * 73856093 + z
            if (!this.cells.has(k)) this.cells.set(k, [])
            this.cells.get(k).push(idx)
          }
        }
      }
    }
  }

  at (x, z) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell)
    let best = null, bestD = 45 * 45
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const arr = this.cells.get((cx + i) * 73856093 + (cz + j))
        if (!arr) continue
        for (const idx of arr) {
          const [ax, az, bx, bz, name] = this.segs[idx]
          const dx = bx - ax, dz = bz - az
          const l2 = dx * dx + dz * dz
          let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0
          t = Math.max(0, Math.min(1, t))
          const px = ax + t * dx - x, pz = az + t * dz - z
          const d = px * px + pz * pz
          if (d < bestD) { bestD = d; best = name }
        }
      }
    }
    return best
  }
}

// -------------------------------------------------------------------- minimap

class Minimap {
  constructor (canvas, roads) {
    this.cv = canvas
    this.ctx = canvas.getContext('2d')
    this.roads = roads.filter(r => !r.foot)
    this.range = 260
  }

  draw (car) {
    const ctx = this.ctx
    const S = this.cv.width
    const half = S / 2
    const scale = half / this.range

    ctx.clearRect(0, 0, S, S)
    ctx.save()
    ctx.translate(half, half)
    ctx.rotate(car.yaw)          // rotate the world so the car always points up
    ctx.scale(scale, -scale)     // flip z so north reads upward
    ctx.translate(-car.pos.x, -car.pos.z)

    ctx.lineCap = 'round'
    for (const r of this.roads) {
      const p = r.p
      if (Math.abs(p[0][0] - car.pos.x) > this.range + 300 &&
          Math.abs(p[0][1] - car.pos.z) > this.range + 300) continue
      ctx.beginPath()
      ctx.moveTo(p[0][0], p[0][1])
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1])
      ctx.strokeStyle = r.rank <= 3 ? 'rgba(255,236,190,0.92)' : 'rgba(255,255,255,0.34)'
      ctx.lineWidth = Math.max(1.6 / scale, r.rank <= 3 ? 7 : 3.4)
      ctx.stroke()
    }
    ctx.restore()

    // player arrow
    ctx.save()
    ctx.translate(half, half)
    ctx.fillStyle = '#5ac8ff'
    ctx.beginPath()
    ctx.moveTo(0, -11); ctx.lineTo(7.5, 9); ctx.lineTo(0, 4.5); ctx.lineTo(-7.5, 9)
    ctx.closePath(); ctx.fill()
    ctx.restore()
  }
}

// ----------------------------------------------------------------------- boot

async function main () {
  await stage('downloading Chișinău…', 6)
  const world = await (await fetch('data/world.json')).json()

  // The heightfield is optional: without it the city renders dead flat rather
  // than failing to start.
  let terrain = FLAT
  try {
    const res = await fetch('data/terrain.json')
    if (res.ok) terrain = new Terrain(await res.json())
  } catch { /* keep flat */ }

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.35, 4200)

  await stage('starting renderer…', 14)
  // A phone gets `low` from the first frame. Nothing here is draw-call bound —
  // the city is merged into ~16 batches and every triangle is submitted every
  // frame regardless — so pixels and post-processing are the only real levers,
  // and a 3x device pixel ratio is what actually kills a handset.
  const touchMode = isCoarse()
  let renderer
  try {
    renderer = new Renderer($('view'), scene, camera, touchMode ? 'low' : 'medium')
  } catch (e) { return fail(e) }

  await stage('drawing facades…', 24)
  const city = buildCity(world, terrain)
  scene.add(city.group)

  await stage('paving streets…', 52)
  const ground = buildGround(world, terrain)
  scene.add(ground.group)
  const roads = buildRoads(world, terrain, { lowDetail: touchMode })
  scene.add(roads.group)

  await stage('adding balconies and doorways…', 66)
  const details = buildDetails(world, city.footprints, terrain, { lowDetail: touchMode })
  scene.add(details.group)

  await stage('raising landmarks…', 70)
  const landmarks = buildLandmarks(world, terrain)
  scene.add(landmarks.group)

  await stage('planting trees…', 74)
  const props = buildProps(world, terrain, { lowDetail: touchMode })
  const fences = buildFences(world, terrain)
  scene.add(fences.group)
  scene.add(props.group)

  await stage('lighting the sky…', 88)
  // Late afternoon: a low sun rakes across the facades and makes the relief read.
  let hour = 17.4
  const setHour = h => {
    hour = (h + 24) % 24
    // Rough solar path for Chisinau in summer: up at 05:30, down at 21:00.
    const t = (hour - 5.5) / 15.5
    const elevation = Math.sin(Math.max(0, Math.min(1, t)) * Math.PI) * 62 - 1.5
    const azimuth = -95 + t * 190
    renderer.setSun(elevation, azimuth)
  }
  setHour(hour)

  await stage('warming up the engine…', 95)

  // --- spawn ---------------------------------------------------------------
  // Landmark piers collide; their archways deliberately do not.
  // The car stands on the drivable surface, not the bare heightfield.
  const surface = new SurfaceIndex(world, terrain)
  const car = new Car([...city.footprints, ...landmarks.footprints], surface)
  // Bd. Stefan cel Mare, heading south-east past the Arcul de Triumf: the arch
  // stands about 30 m ahead and 14 m off the left, with the boulevard running
  // away to the horizon. A named place beats the rule this replaced — first
  // vertex of whichever trunk road happened to start nearest the origin — which
  // put the car somewhere arbitrary and re-picked it whenever the map was
  // re-fetched. `R` respawns here too.
  const SPAWN = { x: 0.41, z: -34.85, yaw: 0.798 }
  const resetCar = () => {
    car.pos.set(SPAWN.x, surface.height(SPAWN.x, SPAWN.z), SPAWN.z)
    car.yaw = SPAWN.yaw
    car.vLong = car.vLat = car.yawRate = 0
    car.settleNow()
  }

  const { root: carMesh, wheels, materials: carMats } = buildCarMesh(PAINT_COLOURS[0])
  scene.add(carMesh)

  // A line of trolleybuses working Stefan cel Mare. Scenery with a timetable:
  // they ride the same drivable surface the player does, so they sit on the road
  // rather than in it, but they have no physics and nothing to collide with.
  const busRoute = boulevardRoute(world)
  const busBack = boulevardRoute(world, { offset: -5.0 })
  // Overhead wires and signals. Both carriageways are wired, because the loop
  // runs buses up one and back down the other and a bus with its poles in empty
  // sky reads as a mistake.
  const wires = busRoute ? buildTrolleyWires(busRoute, surface) : null
  const wiresBack = busBack ? buildTrolleyWires(busBack, surface) : null
  if (wires) scene.add(wires.group)
  if (wiresBack) scene.add(wiresBack.group)
  const signals = buildTrafficLights(world, surface)
  scene.add(signals.group)

  // A white GLE Coupé shuttling Stefan cel Mare between Armeneasca and
  // Banulescu-Bodoni, U-turning at each end, with a label over its roof.
  const gleRoute = shuttleLoop(world, [553.3, 511.5], [-92.8, -118.8])
  let gle = null, gleMesh = null, gleWheels = null, gleTag = null
  if (gleRoute && gleRoute.length > 4) {
    const built = buildGleMesh()
    gleMesh = built.root
    gleWheels = built.wheels
    gleTag = buildTag('om uspeșnâi')
    scene.add(gleMesh, gleTag)
    gle = new NpcCar(gleRoute, surface)
  }

  const busLoop = boulevardLoop(world)
  let fleet = null, bus = null
  if (busLoop && busLoop.length > 4) {
    fleet = new TrolleyFleet(7, busLoop, surface)
    scene.add(fleet.group)
    bus = fleet.buses[0]
  }
  resetCar()

  const audio = new CarAudio()
  // Browsers will not start an AudioContext without a gesture, and the game is
  // driven by held keys rather than clicks — so unlock on the first of either,
  // in the capture phase, before anything can stop the event.
  const unlock = () => audio.unlock()
  for (const ev of ['keydown', 'pointerdown', 'touchstart']) {
    addEventListener(ev, unlock, { capture: true, passive: true })
  }

  const input = new Input()
  const chase = new ChaseCamera(camera)
  chase.pos.set(car.pos.x, car.pos.y + 4, car.pos.z - 10)
  const streets = new StreetIndex(world.roads)
  const minimap = new Minimap($('mapcv'), world.roads)

  // Headlights, so the car reads at dusk.
  const beamL = new THREE.SpotLight(0xfff0d5, 0, 70, 0.5, 0.45, 1.4)
  const beamR = beamL.clone()
  scene.add(beamL, beamL.target, beamR, beamR.target)

  // ----------------------------------------------------------- touch input
  /** Keeps the touch button and the help list agreeing with the audio state. */
  const setMuted = m => {
    touch.setSound?.(!m)
    const el = $('sndState')
    if (el) el.textContent = m ? 'sound off' : 'sound on'
  }

  const touch = new TouchControls($('hud'), {
    camera: () => chase.cycle(),
    map: () => $('map').classList.toggle('off'),
    respawn: () => resetCar(),
    sound: () => { audio.unlock(); setMuted(audio.toggle()) },
  })
  setMuted(audio.muted)

  /**
   * Which control scheme is showing.
   *
   * Media queries alone get this wrong at both ends: a touchscreen laptop
   * reports a coarse pointer and does not want a thumb pad over the city, and a
   * tablet with a keyboard case wants to switch back. So the pointer query only
   * decides the *initial* state, and after that the last input actually used
   * wins.
   */
  const setTouchMode = on => {
    touch.setEnabled(on)
    document.body.classList.toggle('touch', on)
    $('help').classList.toggle('off', on || !showHelp)
  }
  addEventListener('touchstart', () => setTouchMode(true), { passive: true })
  addEventListener('keydown', () => setTouchMode(false))

  // ------------------------------------------------------ portrait notice
  const rotate = $('rotate')
  let rotateDismissed = false
  const checkOrientation = () => {
    const portrait = innerHeight > innerWidth
    rotate.classList.toggle('on', touch.enabled && portrait && !rotateDismissed)
  }
  $('rotateAnyway').onclick = () => { rotateDismissed = true; checkOrientation() }

  let quality = touchMode ? 0 : 1
  let showHelp = true
  let lastStreet = null
  setTouchMode(touchMode)
  checkOrientation()

  // ------------------------------------------------------------- picking
  // Buildings are merged per material, so the hit face tells us nothing on its
  // own; the pickIndex attribute maps it back to a building record.
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const outline = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x5ac8ff, depthTest: false, transparent: true, opacity: 0.95 }))
  outline.renderOrder = 999
  outline.visible = false
  scene.add(outline)

  const highlightRing = (ring, yTop) => {
    const pts = []
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length]
      pts.push(a[0], yTop + 0.15, a[1], b[0], yTop + 0.15, b[1])   // roof edge
      pts.push(a[0], 0.1, a[1], b[0], 0.1, b[1])                   // ground edge
      pts.push(a[0], 0.1, a[1], a[0], yTop + 0.15, a[1])           // vertical
    }
    outline.geometry.dispose()
    outline.geometry = new THREE.BufferGeometry()
    outline.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    outline.visible = true
  }

  /** Fills the inspector panel. `rows` and `snippet` differ per kind of thing. */
  const showPanel = ({ name, id, rows, snippet }) => {
    $('pick').classList.add('on')
    $('pkName').textContent = name
    $('pkId').textContent = id
    $('pkTable').innerHTML = rows
      .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')
    $('pkSnippet').textContent = snippet
    $('pkCopy').onclick = () => {
      navigator.clipboard?.writeText(snippet)
      $('pkCopy').textContent = 'Copied'
      setTimeout(() => { $('pkCopy').textContent = 'Copy override' }, 1200)
    }
    $('pkOsm').href = `https://www.openstreetmap.org/${id}`
    $('pkBench').href = `building.html?id=${encodeURIComponent(id)}`
  }

  const showBuilding = bd => {
    highlightRing(bd.r, bd.h)
    showPanel({
      name: bd.n || '(unnamed building)',
      id: bd.id,
      rows: [
        ['facade', bd.k + (bd.c !== undefined ? ' <span class="ov">· fixed colour</span>' : '')],
        ['storeys', bd.l],
        ['height', bd.h + ' m'],
        ['roof', bd.roof ?? (bd.k === 'house' || bd.k === 'small' ? 'gable (inferred)' : 'flat')],
        ['footprint', `${Math.round(bd.rs)} × ${Math.round(bd.rl)} m`],
      ],
      snippet: `  "${bd.id}": { "kind": "${bd.k}", "levels": ${bd.l}, "height": ${bd.h} },`,
    })
  }

  const showLandmark = lm => {
    // Outline the model's oriented footprint rather than an OSM ring.
    const cos = Math.cos(-lm.angle), sin = Math.sin(-lm.angle)
    const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
      const lx = sx * lm.width / 2, lz = sz * lm.depth / 2
      return [lm.x + lx * cos + lz * sin, lm.z - lx * sin + lz * cos]
    })
    highlightRing(ring, lm.height)
    showPanel({
      name: lm.name || lm.model,
      id: lm.id,
      rows: [
        ['model', `<span class="ov">${lm.model}</span> · hand-modelled`],
        ['size', `${lm.width} × ${lm.depth} m`],
        ['height', lm.height + ' m'],
        ['bearing', `${Math.round(lm.angle * 180 / Math.PI)}°`],
      ],
      snippet: `  "${lm.id}": { "model": "${lm.model}", "height": ${lm.height},` +
               ` "width": ${lm.width}, "depth": ${lm.depth} },`,
    })
  }

  const clearPick = () => { $('pick').classList.remove('on'); outline.visible = false }

  // A tap, not a click. On touch, `click` also fires at the end of a drag and at
  // the end of a long press, so inspecting a building would fight the steering.
  let tapFrom = null
  $('view').addEventListener('pointerdown', ev => {
    tapFrom = { x: ev.clientX, y: ev.clientY, t: performance.now() }
  })
  $('view').addEventListener('pointerup', ev => {
    const from = tapFrom
    tapFrom = null
    if (!from) return
    if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) > 12) return
    if (performance.now() - from.t > 600) return
    ndc.x = (ev.clientX / innerWidth) * 2 - 1
    ndc.y = -(ev.clientY / innerHeight) * 2 + 1
    raycaster.setFromCamera(ndc, camera)
    // Landmarks are separate meshes outside city.group, so include them here or
    // hand-modelled buildings become unclickable.
    const targets = [...city.group.children, ...landmarks.group.children]
    const hits = raycaster.intersectObjects(targets, false)
    for (const hit of hits) {
      if (hit.object.userData.landmark) { showLandmark(hit.object.userData.landmark); return }
      const attr = hit.object.geometry.getAttribute('pickIndex')
      if (!attr || !hit.face) continue
      const bd = world.buildings[attr.getX(hit.face.a)]
      if (bd) { showBuilding(bd); return }
    }
    clearPick()
  })

  await stage('ready', 100)
  loader.classList.add('done')
  setTimeout(() => loader.remove(), 700)

  // --- loop ----------------------------------------------------------------
  const clock = new THREE.Clock()
  let acc = 0
  const STEP = 1 / 120
  let frames = 0, fps = 0, fpsClock = performance.now()
  const totalDraws = city.drawCalls + roads.drawCalls + ground.drawCalls + props.drawCalls + landmarks.count + details.drawCalls
  const totalTris = city.triangles + roads.triangles + ground.triangles

  function frame () {
    requestAnimationFrame(frame)
    const dt = Math.min(clock.getDelta(), 0.05)

    // keys
    if (input.tapped('c')) chase.cycle()
    if (input.tapped('r')) resetCar()
    if (input.tapped('h')) { showHelp = !showHelp; $('help').classList.toggle('off', !showHelp) }
    if (input.tapped('m')) $('map').classList.toggle('off')
    if (input.tapped('v')) setMuted(audio.toggle())
    if (input.tapped('escape')) clearPick()
    if (input.tapped('q')) {
      quality = (quality + 1) % QUALITY.length
      renderer.setQuality(QUALITY[quality])
    }
    if (input.down('[')) setHour(hour - dt * 1.6)
    if (input.down(']')) setHour(hour + dt * 1.6)

    touch.update(dt)
    const drive = touch.merge(input.driving)
    acc += dt
    let guard = 0
    while (acc >= STEP && guard++ < 8) { car.update(drive, STEP); acc -= STEP }

    car.applyTo(carMesh, wheels)
    if (fleet) fleet.update(dt)
    if (gle) gle.update(dt, gleMesh, gleWheels, gleTag)
    audio.update(car, drive, dt)
    chase.update(car, dt)
    renderer.focusShadows(car.pos)

    // brake lights + headlights
    carMats.tail.emissiveIntensity = drive.brake ? 3.4 : 1.0
    const night = hour < 6.6 || hour > 19.4
    const beamPower = night ? 55 : 0
    const cos = Math.cos(car.yaw), sin = Math.sin(car.yaw)
    for (const [b, sx] of [[beamL, -0.56], [beamR, 0.56]]) {
      b.intensity = beamPower
      b.position.set(car.pos.x + sin * 1.9 + cos * sx, car.pos.y + 0.80, car.pos.z + cos * 1.9 - sin * sx)
      const tx = car.pos.x + sin * 40, tz = car.pos.z + cos * 40
      b.target.position.set(tx, terrain.height(tx, tz) + 0.1, tz)
      b.target.updateMatrixWorld()
    }

    if (car.crashImpulse > 4) {
      const f = $('flash')
      f.style.opacity = Math.min(0.5, car.crashImpulse / 40)
      requestAnimationFrame(() => { f.style.opacity = 0 })
    }

    minimap.draw(car)

    // HUD
    $('kmh').textContent = Math.round(car.kmh)
    const name = streets.at(car.pos.x, car.pos.z)
    if (name !== lastStreet) {
      lastStreet = name
      const el = $('street')
      el.classList.toggle('on', !!name)
      if (name) $('streetname').textContent = name
    }

    // Measured against the wall clock — the physics dt is clamped, so timing
    // anything with it reports a frame rate the machine is not achieving.
    frames++
    const nowMs = performance.now()
    if (nowMs - fpsClock > 500) {
      fps = Math.round((frames * 1000) / (nowMs - fpsClock))
      frames = 0
      fpsClock = nowMs
      const hh = Math.floor(hour), mm = Math.floor((hour % 1) * 60)
      $('stats').innerHTML =
        `<b>${fps}</b> fps<br>` +
        `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}<br>` +
        `<b>${QUALITY[quality]}</b> quality<br>` +
        `${totalDraws} batches &middot; ${(totalTris / 1000).toFixed(0)}k tris`
    }

    renderer.render(dt)
    input.endFrame()
  }

  const onResize = () => { renderer.resize(); checkOrientation() }
  addEventListener('resize', onResize)
  addEventListener('orientationchange', () => setTimeout(onResize, 250))
  // Mobile browsers collapse and re-show their chrome without firing `resize`,
  // which otherwise leaves the canvas the wrong height with a strip of page
  // showing under it.
  visualViewport?.addEventListener('resize', onResize)

  // Debug handle: lets the dev console (and the screenshot harness) drop the
  // car anywhere in the city without driving there.
  /** Nearest drivable road point to (x,z), with the road's bearing. */
  const snapToRoad = (x, z) => {
    let best = null, bestD = Infinity
    for (const r of world.roads) {
      if (r.foot || r.rank > 6) continue
      for (let i = 0; i < r.p.length - 1; i++) {
        const [ax, az] = r.p[i], [bx, bz] = r.p[i + 1]
        const dx = bx - ax, dz = bz - az
        const l2 = dx * dx + dz * dz
        if (l2 < 1e-6) continue
        let t = ((x - ax) * dx + (z - az) * dz) / l2
        t = Math.max(0, Math.min(1, t))
        const px = ax + t * dx, pz = az + t * dz
        const d = (px - x) ** 2 + (pz - z) ** 2
        if (d < bestD) { bestD = d; best = { x: px, z: pz, yaw: Math.atan2(dx, dz) } }
      }
    }
    return best
  }

  window.__game = {
    car, world, renderer, chase, setHour, snapToRoad, terrain, surface, audio, bus, fleet, gle, mats: cityMaterials(),
    /** Drops the car on the nearest road to the given point, optionally facing a bearing. */
    teleport (x, z, yaw) {
      const s = snapToRoad(x, z) || { x, z, yaw: 0 }
      if (yaw !== undefined) s.yaw = yaw
      car.pos.set(s.x, surface.height(s.x, s.z), s.z)
      car.yaw = s.yaw
      car.vLong = car.vLat = car.yawRate = 0
      car.settleNow()
      const gy = surface.height(s.x, s.z)
      chase.pos.set(s.x - Math.sin(s.yaw) * 9, gy + 4, s.z - Math.cos(s.yaw) * 9)
      chase.look.set(s.x, gy + 1.3, s.z)
    },
  }

  frame()

  console.log('city built:', {
    buildings: world.buildings.length,
    roads: world.roads.length,
    trees: props.trees,
    streetlights: props.lamps,
    trolleybuses: fleet
      ? `${fleet.count} on a ${Math.round(bus.total)} m loop, ${fleet.triangles} tris`
      : 'none',
    trolleyWires: `${(wires?.triangles ?? 0) + (wiresBack?.triangles ?? 0)} tris`,
    npcCarLoop: gle ? `${Math.round(gle.total)} m` : 'none',
    trafficSignals: `${signals.signals} at ${signals.junctions} junctions, ${signals.triangles} tris`,
    fences: fences.count,
    monuments: world.monuments?.length ?? 0,
    details: details.counts,
    triangles: city.triangles + roads.triangles + ground.triangles,
  })
}

main().catch(fail)
