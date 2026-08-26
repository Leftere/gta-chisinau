/** Collects triangles destined for one material, then bakes them into one mesh. */
import * as THREE from 'three'

export class Batch {
  constructor (material) {
    this.material = material
    this.pos = []; this.nor = []; this.uv = []; this.col = []
    // Which source object each vertex belongs to. Buildings are merged into one
    // mesh per material, so a raycast hit alone cannot say what was clicked —
    // this attribute maps a hit face back to its building.
    this.idx = []
    this.current = -1
  }

  /** Adds a quad a->b->c->d with an explicit outward normal. */
  quad (a, b, c, d, n, uvs, col) {
    const t = [a, b, c, a, c, d]
    const u = [uvs[0], uvs[1], uvs[2], uvs[0], uvs[2], uvs[3]]
    for (let i = 0; i < 6; i++) {
      this.pos.push(t[i][0], t[i][1], t[i][2])
      this.nor.push(n[0], n[1], n[2])
      this.uv.push(u[i][0], u[i][1])
      this.col.push(col.r, col.g, col.b)
      this.idx.push(this.current)
    }
  }

  tri (a, b, c, n, uvs, col) {
    const t = [a, b, c]
    for (let i = 0; i < 3; i++) {
      this.pos.push(t[i][0], t[i][1], t[i][2])
      this.nor.push(n[0], n[1], n[2])
      this.uv.push(uvs[i][0], uvs[i][1])
      this.col.push(col.r, col.g, col.b)
      this.idx.push(this.current)
    }
  }

  get triangles () { return this.pos.length / 9 }

  mesh (name, { castShadow = true, receiveShadow = true } = {}) {
    if (!this.pos.length) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    if (this.idx.some(v => v >= 0)) {
      g.setAttribute('pickIndex', new THREE.Float32BufferAttribute(this.idx, 1))
    }
    g.computeBoundingSphere()
    const m = new THREE.Mesh(g, this.material)
    m.name = name
    m.castShadow = castShadow
    m.receiveShadow = receiveShadow
    m.matrixAutoUpdate = false
    return m
  }
}

/** Keeps one Batch per material and hands them out on demand. */
export class BatchSet {
  constructor () { this.map = new Map() }
  for (material) {
    if (!this.map.has(material)) this.map.set(material, new Batch(material))
    return this.map.get(material)
  }
  addTo (group, opts) {
    let tris = 0
    for (const [, b] of this.map) {
      const m = b.mesh('surface', opts)
      if (m) { group.add(m); tris += b.triangles }
    }
    return { drawCalls: this.map.size, triangles: Math.round(tris) }
  }
}
