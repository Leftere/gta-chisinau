/** Footprint geometry helpers used to infer what an untagged building actually is. */

export function centroid (ring) {
  let x = 0, z = 0, a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
    a += cross
    x += (ring[j][0] + ring[i][0]) * cross
    z += (ring[j][1] + ring[i][1]) * cross
  }
  if (Math.abs(a) < 1e-9) {
    const n = ring.length
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n]
  }
  return [x / (3 * a), z / (3 * a)]
}

export function convexHull (pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  lower.pop(); upper.pop()
  return lower.concat(upper)
}

/**
 * Smallest-area enclosing rectangle, found by testing every hull edge direction.
 * Returns the short and long side in metres plus the long side's bearing —
 * enough to tell a slab apart from a tower or a cottage.
 */
export function minAreaRect (ring) {
  const hull = convexHull(ring)
  if (hull.length < 3) return { short: 0, long: 0, angle: 0, area: 0 }
  let best = null
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length]
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
    const cos = Math.cos(-ang), sin = Math.sin(-ang)
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
    for (const [x, z] of hull) {
      const u = x * cos - z * sin
      const v = x * sin + z * cos
      if (u < minU) minU = u; if (u > maxU) maxU = u
      if (v < minV) minV = v; if (v > maxV) maxV = v
    }
    const w = maxU - minU, h = maxV - minV
    const area = w * h
    if (!best || area < best.area) {
      best = { area, short: Math.min(w, h), long: Math.max(w, h), angle: ang }
    }
  }
  return best
}
