/**
 * A small write API for the building workbench, served only by `npm run dev`.
 *
 * The workbench used to hand you a JSON snippet to paste into overrides.json by
 * hand. That is fine for one building and miserable for fifty: every edit means
 * leaving the browser, finding the right key, pasting, saving, reloading. Since
 * the workbench is a development tool that only ever runs against the dev
 * server, it can simply write the file.
 *
 * `apply: 'serve'` keeps every route below out of the production build — there
 * is no version of the deployed site that can write to anything.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'

const OVERRIDES = 'overrides.json'

const read = () => JSON.parse(readFileSync(OVERRIDES, 'utf8'))

/** Writes back with the `_readme` block first, so the file still explains itself. */
function write (obj) {
  const { _readme, ...rest } = obj
  const ordered = _readme ? { _readme, ...rest } : rest
  writeFileSync(OVERRIDES, JSON.stringify(ordered, null, 2) + '\n')
}

const json = (res, code, body) => {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const body = req => new Promise((ok, fail) => {
  const parts = []
  let size = 0
  req.on('data', c => {
    size += c.length
    if (size > 1e6) { fail(new Error('payload too large')); req.destroy() }
    parts.push(c)
  })
  req.on('end', () => { try { ok(JSON.parse(Buffer.concat(parts).toString('utf8'))) } catch (e) { fail(e) } })
  req.on('error', fail)
})

export function overridesApi () {
  return {
    name: 'workbench-overrides-api',
    apply: 'serve',
    configureServer (server) {
      server.middlewares.use('/__wb', async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost')
        const path = url.pathname.replace(/\/$/, '')
        try {
          // ---- read every override, so the workbench can show what is done ---
          if (req.method === 'GET' && (path === '' || path === '/overrides')) {
            return json(res, 200, read())
          }

          // ---- upsert one building ------------------------------------------
          if (req.method === 'POST' && path === '/override') {
            const { id, patch } = await body(req)
            if (!id) return json(res, 400, { error: 'missing id' })
            const all = read()
            // A patch of only `_note` and nothing else is a deletion in disguise;
            // treat an empty patch as "remove this override" so the button that
            // clears the form actually clears the file.
            const keys = Object.keys(patch ?? {}).filter(k => patch[k] !== undefined && patch[k] !== '')
            if (!keys.length) delete all[id]
            else all[id] = { ...(all[id] ?? {}), ...patch }
            for (const k of Object.keys(all[id] ?? {})) {
              if (all[id][k] === undefined || all[id][k] === null) delete all[id][k]
            }
            write(all)
            return json(res, 200, { ok: true, override: all[id] ?? null, count: Object.keys(all).length - 1 })
          }

          // ---- delete one building's override --------------------------------
          if (req.method === 'POST' && path === '/forget') {
            const { id } = await body(req)
            const all = read()
            delete all[id]
            write(all)
            return json(res, 200, { ok: true })
          }

          // ---- rebuild the world so the game reflects the edits ---------------
          if (req.method === 'POST' && path === '/build') {
            const out = await new Promise(ok => {
              execFile('node', ['tools/build-world.mjs'], { cwd: resolve('.'), timeout: 180000 },
                (err, stdout, stderr) => ok({ err: err?.message ?? null, stdout, stderr }))
            })
            return json(res, out.err ? 500 : 200, out)
          }
        } catch (e) {
          return json(res, 500, { error: e.message })
        }
        next()
      })
    },
  }
}


