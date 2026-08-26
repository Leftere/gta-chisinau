/**
 * Drifting cloud layers.
 *
 * Two domes that follow the camera, each shading a *flat cloud plane* rather
 * than the dome itself: for a view direction of elevation e, the sightline meets
 * a horizontal layer at horizontal distance 1/tan(e), so sampling the texture at
 * `dir.xz / dir.y` gives real perspective — puffs spread out overhead and crowd
 * together towards the horizon. Mapping the texture straight onto the dome
 * instead makes every cloud the same apparent size wherever you look, which
 * reads as wallpaper.
 *
 * Both layers are procedural, like every other surface here. Movement is an
 * offset into the noise, so nothing is regenerated per frame.
 */
import * as THREE from 'three'
import { canvas, fbm, TEX } from '../world/textures.js'

/**
 * Coverage map for one layer.
 *
 * Red is coverage. Green is the same field sampled slightly along the light
 * direction, which the shader differences against red to fake self-shadowing —
 * a cloud lit from one side has a bright flank and a grey base, and without that
 * the whole thing is a flat white stain.
 */
function cloudMap (seed, { octaves = 5, freq = 3.4, gain = 1.0 } = {}) {
  const S = TEX
  const cv = canvas(S)
  const ctx = cv.getContext('2d')
  const img = ctx.createImageData(S, S)
  const d = img.data
  const shadow = 16                      // pixels to offset the shading sample
  const field = new Float32Array(S * S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // Sampled on a torus so the tile repeats without a seam in either axis.
      const u = (x / S) * Math.PI * 2, v = (y / S) * Math.PI * 2
      const n = fbm(
        (Math.cos(u) + 1.5) * freq + Math.cos(v) * 0.4,
        (Math.sin(v) + 1.5) * freq + Math.sin(u) * 0.4,
        octaves, seed)
      field[y * S + x] = n
    }
  }
  // Normalise to the full range before quantising.
  //
  // fbm sums octaves at halving amplitude, so over this sampling pattern it
  // spans about 0.06..0.42 and clusters near 0.27 — it never reaches the
  // threshold a coverage dial would naively be set to, and the sky comes out
  // completely empty. Stretching the measured range is what makes `cover`
  // mean what it says.
  let lo = Infinity, hi = -Infinity
  for (const v of field) { if (v < lo) lo = v; if (v > hi) hi = v }
  const span = hi - lo || 1
  const at = i => Math.max(0, Math.min(255, ((field[i] - lo) / span) * 255 * gain))
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4
      const sx = (x + shadow) % S, sy = (y + shadow) % S
      d[i] = at(y * S + x)
      d[i + 1] = at(sy * S + sx)
      d[i + 2] = 0
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  // The plane projection stretches the texture hard towards the horizon; without
  // anisotropy that whole band turns to mush.
  tex.anisotropy = 8
  return tex
}

const VERT = /* glsl */`
  varying vec3 vDir;
  void main () {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAG = /* glsl */`
  uniform sampler2D map;
  uniform vec3 sunDir;
  uniform vec3 sunTint;
  uniform vec2 offset;
  uniform float scale;
  uniform float cover;      // 0 = clear sky, 1 = overcast
  uniform float softness;
  uniform float opacity;
  varying vec3 vDir;

  void main () {
    vec3 dir = normalize(vDir);
    // Below the horizon there is no cloud layer to see.
    if (dir.y <= 0.015) discard;

    // Where this sightline meets a flat layer overhead.
    vec2 plane = dir.xz / dir.y;
    vec2 uv = plane * scale + offset;

    vec2 c = texture2D(map, uv).rg;
    // Soft edges, deliberately. A steep threshold makes the alpha near-binary,
    // and a near-binary edge crawls: a one-centimetre camera move flipped 2% of
    // the frame because every cloud outline was a hard aliased boundary. The
    // gradient has to be wide enough to cover several pixels.
    float a = smoothstep(1.0 - cover, 1.0 - cover + softness, c.r);

    // Thin out towards the horizon. A flat layer seen edge-on is both hundreds
    // of kilometres away and stretched into streaks by the projection, so the
    // bottom of the sky has to fade or it reads as smeared cloud rather than as
    // distance.
    a *= smoothstep(0.055, 0.34, dir.y);

    // Self-shadowing: the side away from the sun is the darker one.
    float lit = clamp((c.r - c.g) * 3.2 + 0.58, 0.0, 1.0);
    float glow = pow(max(dot(dir, sunDir), 0.0), 8.0);

    // Deliberately over 1. A sunlit cloud is brighter than the sky behind it,
    // and this is graded through ACES at 0.62 exposure — a cloud authored at
    // white comes out of the tonemapper as grey smoke.
    vec3 base = mix(vec3(0.78, 0.81, 0.90), vec3(1.85), lit);
    vec3 col = base * sunTint + glow * 0.7 * sunTint;
    gl_FragColor = vec4(col, a * opacity);
  }
`

export class Clouds {
  constructor (scene, { radius = 3200, layers = 2 } = {}) {
    this.group = new THREE.Group()
    this.group.name = 'clouds'
    // renderOrder keeps them behind everything solid; they never write depth.
    this.group.renderOrder = -1
    this.layers = []

    const dome = new THREE.SphereGeometry(radius, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.52)

    const make = (seedOpts, uniforms, speed) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        // Depth-tested, so the city occludes the sky. Without this the clouds
        // paint straight over the buildings in front of them.
        depthTest: true,
        side: THREE.BackSide,
        fog: false,
        uniforms: {
          map: { value: cloudMap(seedOpts.seed, seedOpts) },
          sunDir: { value: new THREE.Vector3(0, 1, 0) },
          sunTint: { value: new THREE.Color(1, 1, 1) },
          offset: { value: new THREE.Vector2() },
          ...uniforms,
        },
      })
      const mesh = new THREE.Mesh(dome, mat)
      mesh.frustumCulled = false
      this.group.add(mesh)
      this.layers.push({ mat, speed })
      return mesh
    }

    // Low cumulus: small, well separated, the ones that read as weather.
    make({ seed: 7, octaves: 5, freq: 3.6, gain: 1.0 }, {
      scale: { value: 0.075 }, cover: { value: 0.36 },
      softness: { value: 0.26 }, opacity: { value: 1.0 },
    }, new THREE.Vector2(0.0042, 0.0016))

    // High cirrus: broad, faint, drifting faster and in a different direction.
    // Dropped on a phone — a second full-sky transparent pass is pure fill rate
    // for a layer you can barely see.
    if (layers > 1) make({ seed: 23, octaves: 4, freq: 1.5, gain: 1.0 }, {
      scale: { value: 0.024 }, cover: { value: 0.26 },
      softness: { value: 0.40 }, opacity: { value: 0.30 },
    }, new THREE.Vector2(0.0071, -0.0030))

    scene.add(this.group)
  }

  setSun (dir, colour) {
    for (const { mat } of this.layers) {
      mat.uniforms.sunDir.value.copy(dir)
      // Clouds are lit by the same sun as everything else, so they warm and
      // redden with it rather than staying white into the evening.
      mat.uniforms.sunTint.value.copy(colour)
    }
  }

  /** Weather dial: 0 leaves a clear sky, 1 closes it over. */
  setCover (t) {
    const to = [[0.18, 0.78], [0.12, 0.55]]
    this.layers.forEach(({ mat }, i) => {
      mat.uniforms.cover.value = THREE.MathUtils.lerp(to[i][0], to[i][1], t)
    })
  }

  update (dt, cameraPos) {
    // The dome is a backdrop: it travels with the viewer so you can never reach
    // its edge, and the drift is in the texture rather than in the geometry.
    this.group.position.copy(cameraPos)
    for (const { mat, speed } of this.layers) {
      mat.uniforms.offset.value.x += speed.x * dt
      mat.uniforms.offset.value.y += speed.y * dt
    }
  }

  dispose () {
    for (const { mat } of this.layers) { mat.uniforms.map.value.dispose(); mat.dispose() }
  }
}
