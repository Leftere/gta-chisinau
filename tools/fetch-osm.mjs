/**
 * Downloads raw OpenStreetMap geometry for the Chisinau city-centre play area.
 * Run once: `npm run fetch-map`. Output is cached so the game never needs network.
 *
 * The data is pulled as several small queries rather than one big one — the public
 * Overpass instances reject large combined requests under load.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'

// Piata Marii Adunari Nationale, the centre of the play area.
export const ORIGIN = { lat: 47.0245, lon: 28.8322 }
// ~2.2km N-S by ~2.6km E-W around the origin.
export const BBOX = { south: 47.0150, west: 28.8150, north: 47.0350, east: 28.8500 }

const B = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`

const PARTS = [
  ['buildings',  `way["building"](${B});`],
  ['buildingrel', `relation["building"](${B});`],
  ['roads',      `way["highway"](${B});`],
  ['landuse',    `way["landuse"](${B});way["leisure"](${B});`],
  // Chisinau's central park — and the cathedral garden — are multipolygon
  // relations, so a way-only query silently returns a city with no parks in it.
  ['landuserel', `relation["landuse"](${B});relation["leisure"](${B});`],
  ['nature',     `way["natural"](${B});way["waterway"](${B});`],
  ['trees',      `node["natural"="tree"](${B});`],
  // Statues and memorials. The Stefan cel Mare monument is a relation, most
  // others are nodes and a few are ways, so all three have to be asked for.
  ['monuments',  `nwr["historic"](${B});nwr["tourism"="artwork"](${B});`],
  ['barriers',   `way["barrier"](${B});`],
]

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

// Overpass answers 406 without these — the defaults Node's fetch sends are not enough.
const HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'Accept': 'application/json',
  'User-Agent': 'gta-chisinau/0.1 (hobby game project)',
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function fetchPart (name, body) {
  const query = `[out:json][timeout:180];(${body});out geom;`
  for (let attempt = 0; attempt < 9; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length]
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: HEADERS,
        body: new URLSearchParams({ data: query }),
      })
      const text = await res.text()
      if (res.ok && text.startsWith('{')) {
        const json = JSON.parse(text)
        if (json.elements) {
          console.log(`  ${name}: ${json.elements.length} elements`)
          return json.elements
        }
      }
      console.warn(`  ${name}: attempt ${attempt + 1} failed (HTTP ${res.status}), backing off`)
    } catch (err) {
      console.warn(`  ${name}: attempt ${attempt + 1} failed (${err.message})`)
    }
    await sleep(3000 + attempt * 4000)
  }
  throw new Error(`could not download "${name}" after 9 attempts`)
}

async function main () {
  mkdirSync('data-cache', { recursive: true })
  const out = 'data-cache/osm-raw.json'
  const force = process.argv.includes('--force')
  const have = existsSync(out) && !force ? JSON.parse(readFileSync(out, 'utf8')) : null

  // Adding a feature class should not mean re-downloading the city and churning
  // every inferred building. Parts already cached are kept; only new ones are
  // fetched, and the cache records which parts it holds.
  const done = new Set(have?.parts ?? [])
  const todo = PARTS.filter(([name]) => !done.has(name))
  if (have && !todo.length) {
    console.log(`${out} already has every part — pass --force to re-download.`)
    return
  }
  if (have) console.log(`extending cache with: ${todo.map(p => p[0]).join(', ')}`)

  const elements = have ? have.elements.slice() : []
  const seen = new Set(elements.map(e => `${e.type}/${e.id}`))
  for (const [name, body] of todo) {
    for (const el of await fetchPart(name, body)) {
      const key = `${el.type}/${el.id}`
      if (seen.has(key)) continue          // parts overlap; first one in wins
      seen.add(key)
      elements.push(el)
    }
    done.add(name)
    await sleep(1500) // be polite to the public instances
  }

  const payload = JSON.stringify({ origin: ORIGIN, bbox: BBOX, parts: [...done], elements })
  writeFileSync(out, payload)
  console.log(`\nOK — ${elements.length} elements, ${(payload.length / 1e6).toFixed(1)} MB -> ${out}`)
}

main().catch(err => { console.error(err.message); process.exit(1) })
