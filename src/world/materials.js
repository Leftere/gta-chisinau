/**
 * Draws every facade family Chisinau is built from, as tiling PBR material sets.
 *
 * One tile is exactly one storey tall and a whole number of window bays wide, so
 * the texture repeats at true scale and a nine-storey block really shows nine
 * rows of windows. Albedo is kept close to neutral — per-building colour comes
 * from vertex tints, which lets 4600 buildings share ten materials.
 */
import * as THREE from 'three'
import { canvas, hash, fbm, grain, weather, toTexture, normalFromHeight, TEX } from './textures.js'

const rgb = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`
const grey = v => rgb(v, v, v)

/**
 * Shared facade drawing routine. Everything is expressed in tile-space
 * fractions so the same code paints a panel block and a merchant's house.
 */
function drawFacade (cfg) {
  const {
    bays = 2, wallTone = 186, wallVary = 10, seed = 1,
    winW = 0.52, winH = 0.58, winTop = 0.16,   // window size/placement within a bay
    sill = true, lintel = false, frameW = 0.055,
    slabSeam = 0, recess = 0.35, balcony = 0,
    roughWall = 0.88, roughGlass = 0.30, brick = 0, mullions = 0,
    centreMullion = true,       // vertical bar splitting each opening
    panels = null,              // [width, height] of cladding panels, in metres
    panelInk = 1,               // joint strength; fine tilework needs far less
    tileW = 1, tileH = 1,       // the tile's real size, needed to place them
  } = cfg

  const alb = canvas(), hgt = canvas(), rgh = canvas()
  const a = alb.getContext('2d'), h = hgt.getContext('2d'), r = rgh.getContext('2d')
  const S = TEX

  // --- base wall -----------------------------------------------------------
  a.fillStyle = grey(wallTone); a.fillRect(0, 0, S, S)
  h.fillStyle = grey(140); h.fillRect(0, 0, S, S)
  r.fillStyle = grey(roughWall * 255); r.fillRect(0, 0, S, S)

  // Broad patchiness so large walls never look like flat paint.
  for (let y = 0; y < S; y += 8) {
    for (let x = 0; x < S; x += 8) {
      const n = fbm(x / 90, y / 90, 4, seed) - 0.5
      a.fillStyle = `rgba(${n > 0 ? 255 : 0},${n > 0 ? 255 : 0},${n > 0 ? 250 : 0},${Math.abs(n) * wallVary / 60})`
      a.fillRect(x, y, 8, 8)
    }
  }

  if (brick) {
    const bh = S / 26
    for (let row = 0; row * bh < S; row++) {
      const off = (row % 2) * bh
      for (let bx = -bh; bx < S; bx += bh * 2.2) {
        const t = hash(bx | 0, row, seed) * 18 - 9
        a.fillStyle = `rgba(${150 + t},${104 + t * 0.6},${88 + t * 0.5},${brick})`
        a.fillRect(bx + off + 1, row * bh + 1, bh * 2.2 - 2, bh - 2)
        h.fillStyle = `rgba(190,190,190,${brick * 0.8})`
        h.fillRect(bx + off + 1, row * bh + 1, bh * 2.2 - 2, bh - 2)
      }
    }
  }

  // --- stone cladding panels ------------------------------------------------
  // Large dry-clad panels with fine joints — the 1990s recladding that a lot of
  // late-Soviet commercial buildings here were given.
  if (panels) {
    const [pw, ph] = panels
    const cols = Math.max(1, Math.round(tileW / pw))
    const rows = Math.max(1, Math.round(tileH / ph))
    // Fine tilework needs a much lighter touch than dry-clad stone: at 30 cm the
    // joints are three times as dense, and full-strength lines read as a grille.
    const jw = panelInk >= 1 ? 3 : 1.5
    for (let i = 0; i <= cols; i++) {
      const x = (i / cols) * S
      a.fillStyle = `rgba(0,0,0,${0.26 * panelInk})`; a.fillRect(x - jw / 2, 0, jw, S)
      a.fillStyle = `rgba(255,255,255,${0.16 * panelInk})`; a.fillRect(x + jw / 2, 0, jw / 2, S)
      h.fillStyle = grey(112); h.fillRect(x - 1, 0, 2, S)
    }
    for (let j = 0; j <= rows; j++) {
      const y = (j / rows) * S
      a.fillStyle = `rgba(0,0,0,${0.28 * panelInk})`; a.fillRect(0, y - jw / 2, S, jw)
      a.fillStyle = `rgba(255,255,255,${0.18 * panelInk})`; a.fillRect(0, y + jw / 2, S, jw / 2)
      h.fillStyle = grey(112); h.fillRect(0, y - 1, S, 2)
    }
    // faint per-panel tonal variation, as real stone has
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const t = hash(i, j, seed + 77) * 16 - 8
        a.fillStyle = `rgba(${t > 0 ? 255 : 20},${t > 0 ? 253 : 20},${t > 0 ? 245 : 18},${Math.abs(t) * panelInk / 150})`
        a.fillRect((i / cols) * S + 1, (j / rows) * S + 1, S / cols - 2, S / rows - 2)
      }
    }
  }

  // --- storey slab seam ----------------------------------------------------
  if (slabSeam > 0) {
    const t = S * slabSeam
    a.fillStyle = `rgba(0,0,0,0.18)`; a.fillRect(0, 0, S, t)
    a.fillStyle = `rgba(255,255,255,0.10)`; a.fillRect(0, t, S, 2)
    h.fillStyle = grey(90); h.fillRect(0, 0, S, t)
    // vertical panel joints, the giveaway of prefabricated construction
    for (let i = 0; i <= bays; i++) {
      const x = (i / bays) * S
      a.fillStyle = 'rgba(0,0,0,0.13)'; a.fillRect(x - 1.5, 0, 3, S)
      h.fillStyle = grey(105); h.fillRect(x - 1.5, 0, 3, S)
    }
  }

  // --- windows -------------------------------------------------------------
  const bayW = S / bays
  for (let i = 0; i < bays; i++) {
    const isBalcony = balcony > 0 && hash(i, 3, seed) < balcony
    const bx = i * bayW
    const w = bayW * winW
    const hh = S * winH
    const x = bx + (bayW - w) / 2
    const y = S * winTop

    if (isBalcony) {
      // Recessed loggia: dark void, slab lip, simple railing.
      const lw = bayW * 0.78, lx = bx + (bayW - lw) / 2
      a.fillStyle = 'rgba(30,28,26,0.72)'; a.fillRect(lx, y * 0.7, lw, S * 0.72)
      h.fillStyle = grey(60); h.fillRect(lx, y * 0.7, lw, S * 0.72)
      r.fillStyle = grey(0.95 * 255); r.fillRect(lx, y * 0.7, lw, S * 0.72)
      a.fillStyle = grey(wallTone + 14); a.fillRect(lx, y * 0.7 + S * 0.44, lw, S * 0.2)
      h.fillStyle = grey(200); h.fillRect(lx, y * 0.7 + S * 0.44, lw, S * 0.2)
      for (let b = 0; b < 7; b++) {
        a.fillStyle = 'rgba(70,70,68,0.5)'
        a.fillRect(lx + 3 + b * (lw - 6) / 7, y * 0.7 + S * 0.44, 2, S * 0.2)
      }
      continue
    }

    // reveal (window sits deeper than the wall plane)
    h.fillStyle = grey(140 - recess * 90)
    h.fillRect(x - 2, y - 2, w + 4, hh + 4)

    // glass
    const gl = 26 + hash(i, 5, seed) * 20
    a.fillStyle = rgb(gl * 0.72, gl * 0.82, gl * 0.95); a.fillRect(x, y, w, hh)
    r.fillStyle = grey(roughGlass * 255); r.fillRect(x, y, w, hh)
    h.fillStyle = grey(80); h.fillRect(x, y, w, hh)
    // a soft sky gradient in the pane so it is not a dead black hole
    const g = a.createLinearGradient(x, y, x, y + hh)
    g.addColorStop(0, 'rgba(150,175,205,0.26)')
    g.addColorStop(0.5, 'rgba(90,110,135,0.07)')
    g.addColorStop(1, 'rgba(14,17,22,0.34)')
    a.fillStyle = g; a.fillRect(x, y, w, hh)

    // frame + glazing bars
    const fw = bayW * frameW
    a.fillStyle = grey(214); a.lineWidth = fw
    a.strokeStyle = grey(214); a.strokeRect(x + fw / 2, y + fw / 2, w - fw, hh - fw)
    if (centreMullion) {
      a.fillRect(x + w / 2 - fw / 2, y, fw, hh)
      r.fillStyle = grey(0.45 * 255)
      r.fillRect(x + w / 2 - fw / 2, y, fw, hh)
    }
    r.fillStyle = grey(0.45 * 255)
    r.strokeStyle = grey(0.45 * 255); r.lineWidth = fw; r.strokeRect(x + fw / 2, y + fw / 2, w - fw, hh - fw)
    h.fillStyle = grey(175); h.fillRect(x + w / 2 - fw / 2, y, fw, hh)
    h.strokeStyle = grey(175); h.lineWidth = fw; h.strokeRect(x + fw / 2, y + fw / 2, w - fw, hh - fw)

    if (mullions) {
      for (let m = 1; m < 3; m++) {
        a.fillStyle = grey(200); a.fillRect(x, y + (hh * m) / 3, w, fw * 0.6)
        h.fillStyle = grey(170); h.fillRect(x, y + (hh * m) / 3, w, fw * 0.6)
      }
    }

    if (sill) {
      a.fillStyle = grey(wallTone + 30); a.fillRect(x - 4, y + hh, w + 8, S * 0.035)
      h.fillStyle = grey(215); h.fillRect(x - 4, y + hh, w + 8, S * 0.035)
    }
    if (lintel) {
      a.fillStyle = grey(wallTone + 26); a.fillRect(x - 6, y - S * 0.045, w + 12, S * 0.035)
      h.fillStyle = grey(210); h.fillRect(x - 6, y - S * 0.045, w + 12, S * 0.035)
    }
  }

  grain(a, S, 0.10, 1, seed)
  grain(h, S, 0.06, 1, seed + 5)
  weather(a, S, 0.16, seed)

  return { alb, hgt, rgh }
}

/**
 * Post-war modernist institutional facade: continuous vertical piers running the
 * full height with recessed glazing between them. No sills, no lintels, no
 * punched openings — the wall reads as structure and infill, not as masonry with
 * holes in it. This is what most of Chisinau's Soviet-era civic blocks look like.
 */
function drawModernist (cfg) {
  const { wallTone = 208, seed = 21, pier = 0.19, spandrel = 0.11,
          panes = 4, roughGlass = 0.26 } = cfg
  const alb = canvas(), hgt = canvas(), rgh = canvas()
  const a = alb.getContext('2d'), h = hgt.getContext('2d'), r = rgh.getContext('2d')
  const S = TEX

  // warm precast concrete, not white
  a.fillStyle = rgb(wallTone, wallTone * 0.985, wallTone * 0.945)
  a.fillRect(0, 0, S, S)
  h.fillStyle = grey(214); h.fillRect(0, 0, S, S)     // piers stand well proud
  r.fillStyle = grey(0.86 * 255); r.fillRect(0, 0, S, S)

  for (let y = 0; y < S; y += 8) {
    for (let x = 0; x < S; x += 8) {
      const n = fbm(x / 70, y / 70, 4, seed) - 0.5
      a.fillStyle = `rgba(${n > 0 ? 255 : 40},${n > 0 ? 255 : 40},${n > 0 ? 248 : 38},${Math.abs(n) * 0.12})`
      a.fillRect(x, y, 8, 8)
    }
  }

  // --- the recessed glazed bay ---------------------------------------------
  const x0 = S * pier, w = S * (1 - pier * 2)
  // Blue-green tinted glass, deeply set back behind the piers.
  a.fillStyle = rgb(34, 54, 58); a.fillRect(x0, 0, w, S)
  h.fillStyle = grey(58); h.fillRect(x0, 0, w, S)
  r.fillStyle = grey(roughGlass * 255); r.fillRect(x0, 0, w, S)

  const g = a.createLinearGradient(0, 0, 0, S)
  g.addColorStop(0, 'rgba(126,178,182,0.34)')
  g.addColorStop(0.55, 'rgba(58,104,112,0.14)')
  g.addColorStop(1, 'rgba(10,24,28,0.34)')
  a.fillStyle = g; a.fillRect(x0, 0, w, S)

  // Hard shadow down the left reveal — the giveaway that the bay is set back.
  const sh = a.createLinearGradient(x0, 0, x0 + w * 0.16, 0)
  sh.addColorStop(0, 'rgba(0,0,0,0.5)')
  sh.addColorStop(1, 'rgba(0,0,0,0)')
  a.fillStyle = sh; a.fillRect(x0, 0, w * 0.16, S)

  // --- mullions: several narrow vertical panes per bay ----------------------
  for (let i = 1; i < panes; i++) {
    const mx = x0 + (w * i) / panes
    a.fillStyle = 'rgba(28,34,36,0.92)'; a.fillRect(mx - 1.5, 0, 3, S)
    h.fillStyle = grey(88); h.fillRect(mx - 1.5, 0, 3, S)
    r.fillStyle = grey(0.6 * 255); r.fillRect(mx - 1.5, 0, 3, S)
    // thin highlight on the frame edge
    a.fillStyle = 'rgba(190,205,205,0.30)'; a.fillRect(mx + 1.5, 0, 1, S)
  }

  // --- floor line -----------------------------------------------------------
  // A slab edge inside the glazing: muted grey, not a bright concrete spandrel,
  // but light enough that storeys still read at close range.
  const sp = S * spandrel
  a.fillStyle = 'rgba(104,110,108,0.88)'; a.fillRect(x0, S - sp, w, sp)
  h.fillStyle = grey(120); h.fillRect(x0, S - sp, w, sp)
  r.fillStyle = grey(0.72 * 255); r.fillRect(x0, S - sp, w, sp)
  a.fillStyle = 'rgba(0,0,0,0.42)'; a.fillRect(x0, S - sp, w, 2)          // shadow above
  a.fillStyle = 'rgba(200,206,202,0.35)'; a.fillRect(x0, S - 2, w, 2)     // lit lower lip

  // --- pier edges -----------------------------------------------------------
  a.fillStyle = 'rgba(255,255,255,0.20)'; a.fillRect(x0 - 5, 0, 5, S)
  a.fillStyle = 'rgba(0,0,0,0.20)'; a.fillRect(x0 + w, 0, 5, S)
  // shallow reveal groove down each pier
  for (const gx of [x0 * 0.45, x0 + w + (S - x0 - w) * 0.55]) {
    a.fillStyle = 'rgba(0,0,0,0.10)'; a.fillRect(gx, 0, 2, S)
    h.fillStyle = grey(186); h.fillRect(gx, 0, 2, S)
  }

  grain(a, S, 0.06, 1, seed)
  weather(a, S, 0.12, seed + 6)
  return { alb, hgt, rgh }
}

/**
 * Late-Soviet commercial pavilion: a low freestanding box of plain rendered
 * concrete whose upper storey is one wide, deeply recessed glazed band between
 * heavy piers. No sills, no lintels, no ornament of any kind — the shadow in the
 * reveal is the only modelling the facade has, so it is drawn hard. Chisinau's
 * centre is full of these, dropped into gaps in the pre-war street line in the
 * 1970s and 80s and reclad since.
 */
function drawPavilion (cfg) {
  const { wallTone = 212, seed = 33, pier = 0.16,
          head = 0.20, sill = 0.20, panes = 4, roughGlass = 0.24 } = cfg
  const alb = canvas(), hgt = canvas(), rgh = canvas()
  const a = alb.getContext('2d'), h = hgt.getContext('2d'), r = rgh.getContext('2d')
  const S = TEX

  // Plain rendered concrete: warm off-white, patchy, never flat paint.
  a.fillStyle = rgb(wallTone, wallTone * 0.99, wallTone * 0.955)
  a.fillRect(0, 0, S, S)
  h.fillStyle = grey(212); h.fillRect(0, 0, S, S)      // the wall plane stands proud
  r.fillStyle = grey(0.87 * 255); r.fillRect(0, 0, S, S)

  for (let y = 0; y < S; y += 8) {
    for (let x = 0; x < S; x += 8) {
      const n = fbm(x / 80, y / 80, 4, seed) - 0.5
      a.fillStyle = `rgba(${n > 0 ? 255 : 40},${n > 0 ? 255 : 40},${n > 0 ? 248 : 38},${Math.abs(n) * 0.13})`
      a.fillRect(x, y, 8, 8)
    }
  }

  const x0 = S * pier, w = S * (1 - pier * 2)
  const y0 = S * head, hh = S * (1 - head - sill)

  // --- spandrel under the opening -------------------------------------------
  // Drawn before the reveal so the sill lip highlight lands on top of it.
  a.fillStyle = 'rgba(122,122,116,0.16)'; a.fillRect(0, y0 + hh, S, S - y0 - hh)

  // --- the recessed glazed band ---------------------------------------------
  a.fillStyle = rgb(46, 53, 60); a.fillRect(x0, y0, w, hh)
  h.fillStyle = grey(52); h.fillRect(x0, y0, w, hh)     // sits a long way back
  r.fillStyle = grey(roughGlass * 255); r.fillRect(x0, y0, w, hh)

  const g = a.createLinearGradient(0, y0, 0, y0 + hh)
  g.addColorStop(0, 'rgba(158,182,206,0.34)')
  g.addColorStop(0.45, 'rgba(84,104,124,0.12)')
  g.addColorStop(1, 'rgba(16,20,26,0.34)')
  a.fillStyle = g; a.fillRect(x0, y0, w, hh)

  // Jamb and head shadows. These are the two that read from the street with the
  // sun anywhere south of overhead, and they are what makes the band a hole
  // rather than a dark rectangle painted on a wall.
  const sh = a.createLinearGradient(x0, 0, x0 + w * 0.22, 0)
  sh.addColorStop(0, 'rgba(0,0,0,0.55)'); sh.addColorStop(1, 'rgba(0,0,0,0)')
  a.fillStyle = sh; a.fillRect(x0, y0, w * 0.22, hh)
  const sv = a.createLinearGradient(0, y0, 0, y0 + hh * 0.32)
  sv.addColorStop(0, 'rgba(0,0,0,0.50)'); sv.addColorStop(1, 'rgba(0,0,0,0)')
  a.fillStyle = sv; a.fillRect(x0, y0, w, hh * 0.32)

  // --- glazing bars ----------------------------------------------------------
  for (let i = 1; i < panes; i++) {
    const mx = x0 + (w * i) / panes
    a.fillStyle = 'rgba(168,176,180,0.62)'; a.fillRect(mx - 2, y0, 4, hh)
    h.fillStyle = grey(96); h.fillRect(mx - 2, y0, 4, hh)
    r.fillStyle = grey(0.52 * 255); r.fillRect(mx - 2, y0, 4, hh)
    a.fillStyle = 'rgba(30,34,38,0.45)'; a.fillRect(mx + 2, y0, 1.5, hh)
  }
  const ty = y0 + hh * 0.24                               // transom under the head
  a.fillStyle = 'rgba(176,182,184,0.62)'; a.fillRect(x0, ty, w, 3)
  h.fillStyle = grey(88); h.fillRect(x0, ty, w, 3)

  // --- reveal edges ----------------------------------------------------------
  a.fillStyle = 'rgba(255,255,255,0.22)'; a.fillRect(x0 - 4, y0, 4, hh)      // lit left pier
  a.fillStyle = 'rgba(0,0,0,0.22)'; a.fillRect(x0 + w, y0, 4, hh)            // shaded right pier
  a.fillStyle = 'rgba(0,0,0,0.28)'; a.fillRect(x0, y0 - 4, w, 4)             // shadow off the head
  a.fillStyle = 'rgba(255,255,255,0.28)'; a.fillRect(x0, y0 + hh, w, 4)      // sill lip catches light
  h.fillStyle = grey(232); h.fillRect(x0, y0 + hh, w, 4)

  grain(a, S, 0.07, 1, seed)
  grain(h, S, 0.05, 1, seed + 3)
  weather(a, S, 0.12, seed + 6)                           // rain streaks off the sill
  return { alb, hgt, rgh }
}

/** Street-level band: shopfronts, doorways, the odd shuttered unit. */
function drawGroundBand (cfg) {
  const { bays = 2, wallTone = 180, seed = 9, plinth = 0.16 } = cfg
  const alb = canvas(), hgt = canvas(), rgh = canvas()
  const a = alb.getContext('2d'), h = hgt.getContext('2d'), r = rgh.getContext('2d')
  const S = TEX

  a.fillStyle = grey(wallTone); a.fillRect(0, 0, S, S)
  h.fillStyle = grey(140); h.fillRect(0, 0, S, S)
  r.fillStyle = grey(0.85 * 255); r.fillRect(0, 0, S, S)

  const bayW = S / bays
  for (let i = 0; i < bays; i++) {
    const bx = i * bayW
    const kind = hash(i, 21, seed)
    const x = bx + bayW * 0.09, w = bayW * 0.82
    const y = S * 0.12, hh = S * (1 - plinth) - y

    if (kind < 0.62) {
      // glazed shopfront
      a.fillStyle = rgb(26, 31, 37); a.fillRect(x, y, w, hh)
      const g = a.createLinearGradient(x, y, x, y + hh)
      g.addColorStop(0, 'rgba(150,175,200,0.28)')
      g.addColorStop(1, 'rgba(18,22,28,0.35)')
      a.fillStyle = g; a.fillRect(x, y, w, hh)
      r.fillStyle = grey(0.34 * 255); r.fillRect(x, y, w, hh)
      h.fillStyle = grey(85); h.fillRect(x, y, w, hh)
      // fascia / sign board above
      a.fillStyle = rgb(60 + hash(i, 31, seed) * 120, 55 + hash(i, 37, seed) * 110, 60 + hash(i, 41, seed) * 110)
      a.fillRect(x - 4, y - S * 0.10, w + 8, S * 0.09)
      h.fillStyle = grey(200); h.fillRect(x - 4, y - S * 0.10, w + 8, S * 0.09)
      // mullions
      a.fillStyle = grey(190)
      for (let m = 1; m < 3; m++) a.fillRect(x + (w * m) / 3, y, 3, hh)
    } else if (kind < 0.82) {
      // doorway
      a.fillStyle = rgb(64, 50, 40); a.fillRect(x + w * 0.24, y + hh * 0.16, w * 0.5, hh * 0.84)
      h.fillStyle = grey(95); h.fillRect(x + w * 0.24, y + hh * 0.16, w * 0.5, hh * 0.84)
      r.fillStyle = grey(0.6 * 255); r.fillRect(x + w * 0.24, y + hh * 0.16, w * 0.5, hh * 0.84)
    } else {
      // roller shutter
      a.fillStyle = grey(120); a.fillRect(x, y, w, hh)
      for (let s = 0; s < 26; s++) {
        a.fillStyle = `rgba(0,0,0,${s % 2 ? 0.16 : 0.06})`
        a.fillRect(x, y + (hh * s) / 26, w, hh / 26)
      }
      h.fillStyle = grey(120); h.fillRect(x, y, w, hh)
      r.fillStyle = grey(0.55 * 255); r.fillRect(x, y, w, hh)
    }
  }

  // plinth — darker, scuffed stone at pavement level
  a.fillStyle = 'rgba(0,0,0,0.26)'; a.fillRect(0, S * (1 - plinth), S, S * plinth)
  h.fillStyle = grey(178); h.fillRect(0, S * (1 - plinth), S, S * plinth)

  grain(a, S, 0.11, 1, seed)
  weather(a, S, 0.30, seed + 2)
  return { alb, hgt, rgh }
}

// ------------------------------------------------------------------ families

/** tw / th are the tile's real size in metres — the whole scale anchor. */
const FAMILIES = {
  panel:      { tw: 6.4, th: 3.0, cfg: { bays: 2, wallTone: 188, seed: 1, slabSeam: 0.10, balcony: 0, winW: 0.56, winH: 0.55, winTop: 0.24, sill: true } },
  historic:   { tw: 4.6, th: 3.9, cfg: { bays: 2, wallTone: 196, seed: 2, winW: 0.42, winH: 0.60, winTop: 0.16, sill: true, lintel: true, mullions: 1, recess: 0.5, roughWall: 0.9 } },
  house:      { tw: 4.2, th: 3.1, cfg: { bays: 2, wallTone: 200, seed: 3, winW: 0.44, winH: 0.5, winTop: 0.22, sill: true, recess: 0.4 } },
  plain:      { tw: 5.0, th: 3.1, cfg: { bays: 2, wallTone: 190, seed: 4, winW: 0.5, winH: 0.55, winTop: 0.2, sill: true } },
  commercial: { tw: 5.4, th: 3.6, cfg: { bays: 2, wallTone: 205, seed: 5, winW: 0.74, winH: 0.62, winTop: 0.16, sill: false, frameW: 0.04, roughGlass: 0.22 } },
  glass:      { tw: 3.8, th: 3.6, cfg: { bays: 1, wallTone: 150, seed: 6, winW: 0.9, winH: 0.86, winTop: 0.07, sill: false, frameW: 0.05, roughGlass: 0.12, roughWall: 0.3, mullions: 1 } },
  civic:      { tw: 4.4, th: 3.5, cfg: { bays: 2, wallTone: 202, seed: 7, winW: 0.46, winH: 0.62, winTop: 0.16, sill: true, lintel: true, recess: 0.55 } },
  industrial: { tw: 6.2, th: 4.0, cfg: { bays: 2, wallTone: 168, seed: 8, winW: 0.62, winH: 0.34, winTop: 0.12, sill: false, brick: 0.5, roughWall: 0.95 } },
  small:      { tw: 4.0, th: 3.0, cfg: { bays: 2, wallTone: 172, seed: 9, winW: 0.3, winH: 0.3, winTop: 0.24, sill: false, brick: 0.28 } },
  stone:      { tw: 3.6, th: 2.4, stone: true },
  stoneclad:  { tw: 3.2, th: 3.3, cfg: { bays: 1, wallTone: 200, seed: 11, winW: 0.44, winH: 0.40, winTop: 0.26, sill: false, lintel: false, frameW: 0.06, recess: 0.5, roughWall: 0.82, roughGlass: 0.26, centreMullion: false, panels: [1.6, 1.1], tileW: 3.2, tileH: 3.3 } },
  modernist:  { tw: 3.4, th: 3.6, modern: true, cfg: { wallTone: 208, seed: 21, pier: 0.19, spandrel: 0.13, panes: 4 } },
  pavilion:   { tw: 6.4, th: 3.6, pavilion: true, cfg: { wallTone: 212, seed: 33, pier: 0.16, head: 0.24, sill: 0.20, panes: 4 } },
  // Fine beige tile cladding with white-framed windows — the 1990s-2000s reclad
  // that Chisinau's commercial towers wear. Tiles are 30 x 15 cm, so the joint
  // grid is drawn faint or it reads as a grille rather than as a surface.
  tiled:      { tw: 3.9, th: 3.3, cfg: { bays: 1, wallTone: 216, seed: 41, winW: 0.46, winH: 0.50, winTop: 0.22, sill: false, lintel: false, frameW: 0.09, recess: 0.6, roughWall: 0.78, roughGlass: 0.22, centreMullion: true, panels: [0.30, 0.15], panelInk: 0.28, tileW: 3.9, tileH: 3.3 } },
  church:     { tw: 4.0, th: 4.2, cfg: { bays: 1, wallTone: 226, seed: 10, winW: 0.28, winH: 0.62, winTop: 0.14, sill: true, lintel: true, recess: 0.6 } },
}

/** Families that meet the street with shops rather than with living rooms. */
const HAS_SHOPFRONT = new Set(['panel', 'historic', 'plain', 'commercial', 'civic', 'glass', 'pavilion', 'tiled'])
export const GROUND_BAND_H = 4.2

function buildMaterial ({ alb, hgt, rgh }, tw, th, extra = {}, cfg = null) {
  const map = toTexture(alb, 1, 1, true)
  const normalMap = toTexture(normalFromHeight(hgt, 2.4))
  const roughnessMap = toTexture(rgh)
  const mat = new THREE.MeshStandardMaterial({
    map, normalMap, roughnessMap,
    roughness: 1, metalness: 0.06,
    normalScale: new THREE.Vector2(1.35, 1.35),
    vertexColors: true,
    envMapIntensity: 1.0,
    ...extra,
  })
  mat.userData.tile = { w: tw, h: th }
  // The window grid, so the extruder can cut real openings on the same layout
  // the texture paints them on.
  mat.userData.cfg = cfg
  return mat
}

/**
 * Coursed ashlar masonry — no windows at all.
 * Monuments, arches and towers need a wall that is simply wall; every other
 * family here is built around a window grid and looks absurd on an arch.
 */
function drawStone (seed = 31) {
  const alb = canvas(), hgt = canvas(), rgh = canvas()
  const a = alb.getContext('2d'), h = hgt.getContext('2d'), r = rgh.getContext('2d')
  const S = TEX
  a.fillStyle = grey(206); a.fillRect(0, 0, S, S)
  h.fillStyle = grey(150); h.fillRect(0, 0, S, S)
  r.fillStyle = grey(0.86 * 255); r.fillRect(0, 0, S, S)

  const courses = 4
  const ch = S / courses
  for (let row = 0; row < courses; row++) {
    const blocks = 3
    const off = (row % 2) * (S / (blocks * 2))
    for (let i = -1; i <= blocks; i++) {
      const bx = off + i * (S / blocks)
      const t = hash(i, row, seed) * 22 - 11
      const v = 204 + t
      a.fillStyle = `rgb(${v},${v * 0.985},${v * 0.945})`
      a.fillRect(bx + 1.5, row * ch + 1.5, S / blocks - 3, ch - 3)
      h.fillStyle = grey(196 + t * 0.5)
      h.fillRect(bx + 1.5, row * ch + 1.5, S / blocks - 3, ch - 3)
      // slight bevel at each block's lower edge
      a.fillStyle = 'rgba(0,0,0,0.10)'
      a.fillRect(bx + 1.5, row * ch + ch - 5, S / blocks - 3, 3)
    }
  }
  grain(a, S, 0.09, 1, seed)
  weather(a, S, 0.22, seed + 4)
  return { alb, hgt, rgh }
}

/**
 * Plain rendered wall, no openings. Used for trim that must not inherit a
 * window grid: cornices, door surrounds, steps, balcony slabs.
 */
function drawTrim (seed = 53) {
  const alb = canvas(), hgt = canvas(), rgh = canvas()
  const a = alb.getContext('2d'), h = hgt.getContext('2d'), r = rgh.getContext('2d')
  const S = TEX
  a.fillStyle = grey(202); a.fillRect(0, 0, S, S)
  h.fillStyle = grey(150); h.fillRect(0, 0, S, S)
  r.fillStyle = grey(0.88 * 255); r.fillRect(0, 0, S, S)
  for (let y = 0; y < S; y += 6) {
    for (let x = 0; x < S; x += 6) {
      const n = fbm(x / 60, y / 60, 4, seed) - 0.5
      a.fillStyle = `rgba(${n > 0 ? 255 : 30},${n > 0 ? 255 : 30},${n > 0 ? 250 : 28},${Math.abs(n) * 0.16})`
      a.fillRect(x, y, 6, 6)
    }
  }
  grain(a, S, 0.09, 1, seed)
  weather(a, S, 0.2, seed + 3)
  return { alb, hgt, rgh }
}

/** Flat roof: bitumen sheet, gravel ballast, seams and the odd patch. */
function drawFlatRoof () {
  const alb = canvas(), hgt = canvas(), rgh = canvas()
  const a = alb.getContext('2d'), h = hgt.getContext('2d'), r = rgh.getContext('2d')
  const S = TEX
  a.fillStyle = grey(74); a.fillRect(0, 0, S, S)
  h.fillStyle = grey(140); h.fillRect(0, 0, S, S)
  r.fillStyle = grey(0.93 * 255); r.fillRect(0, 0, S, S)
  for (let y = 0; y < S; y += 4) {
    for (let x = 0; x < S; x += 4) {
      const n = fbm(x / 22, y / 22, 4, 71)
      a.fillStyle = `rgba(${120 * n},${116 * n},${108 * n},0.5)`
      a.fillRect(x, y, 4, 4)
    }
  }
  // felt roll seams
  for (let i = 0; i < 6; i++) {
    const y = (i / 6) * S
    a.fillStyle = 'rgba(30,30,30,0.5)'; a.fillRect(0, y, S, 3)
    h.fillStyle = grey(178); h.fillRect(0, y, S, 3)
  }
  grain(a, S, 0.16, 1, 71)
  return { alb, hgt, rgh }
}

/** Pitched roof: the corrugated metal sheeting on most Chisinau houses. */
function drawMetalRoof () {
  const alb = canvas(), hgt = canvas(), rgh = canvas()
  const a = alb.getContext('2d'), h = hgt.getContext('2d'), r = rgh.getContext('2d')
  const S = TEX
  a.fillStyle = grey(180); a.fillRect(0, 0, S, S)
  r.fillStyle = grey(0.42 * 255); r.fillRect(0, 0, S, S)
  h.fillStyle = grey(128); h.fillRect(0, 0, S, S)
  // corrugation ribs running down the slope
  const ribs = 16
  for (let i = 0; i < ribs; i++) {
    const x = (i / ribs) * S
    const w = S / ribs
    const g = a.createLinearGradient(x, 0, x + w, 0)
    g.addColorStop(0, 'rgba(255,255,255,0.16)')
    g.addColorStop(0.5, 'rgba(0,0,0,0.0)')
    g.addColorStop(1, 'rgba(0,0,0,0.22)')
    a.fillStyle = g; a.fillRect(x, 0, w, S)
    const gh = h.createLinearGradient(x, 0, x + w, 0)
    gh.addColorStop(0, grey(200)); gh.addColorStop(0.5, grey(150)); gh.addColorStop(1, grey(80))
    h.fillStyle = gh; h.fillRect(x, 0, w, S)
  }
  // sheet overlaps across the slope
  for (let i = 0; i < 4; i++) {
    a.fillStyle = 'rgba(0,0,0,0.14)'; a.fillRect(0, (i / 4) * S, S, 3)
  }
  grain(a, S, 0.09, 1, 83)
  weather(a, S, 0.2, 91)
  return { alb, hgt, rgh }
}

let cache = null

/** Builds (once) every material the city needs. */
export function cityMaterials () {
  if (cache) return cache
  const facades = {}, ground = {}

  for (const [name, f] of Object.entries(FAMILIES)) {
    const draw = f.stone ? drawStone()
      : f.modern ? drawModernist(f.cfg)
      : f.pavilion ? drawPavilion(f.cfg)
      : drawFacade(f.cfg)
    facades[name] = buildMaterial(draw, f.tw, f.th,
      name === 'glass' ? { metalness: 0.5, envMapIntensity: 1.5 } : {},
      f.stone || f.modern || f.pavilion ? null : f.cfg)
    if (HAS_SHOPFRONT.has(name)) {
      ground[name] = buildMaterial(
        drawGroundBand({ bays: 2, wallTone: f.cfg.wallTone - 8, seed: f.cfg.seed + 40 }),
        f.tw, GROUND_BAND_H, { metalness: 0.08, envMapIntensity: 0.35 })
    }
  }

  const trim = buildMaterial(drawTrim(), 2.6, 2.6, { metalness: 0.02 })
  const flatRoof = buildMaterial(drawFlatRoof(), 8, 8, { metalness: 0.02 })
  const metalRoof = buildMaterial(drawMetalRoof(), 3.2, 3.2, { metalness: 0.55, envMapIntensity: 1.2 })

  cache = { facades, ground, trim, flatRoof, metalRoof, hasShopfront: HAS_SHOPFRONT }
  return cache
}

export { FAMILIES }
