/**
 * Renderer, lighting and post-processing.
 *
 * The single biggest realism win here is image-based lighting: the physical sky
 * is rendered once into an environment map, so every window, wet road and car
 * panel reflects the actual sky and picks up its bounce light. Everything else —
 * filmic tone mapping, bloom, contact shadows — is grading on top of that.
 */
import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { Clouds } from './clouds.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'

export const QUALITY = ['low', 'medium', 'high']

export class Renderer {
  constructor (canvas, scene, camera, quality = 'medium') {
    this.scene = scene
    this.camera = camera
    this.quality = quality

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,          // SMAA does this more cheaply at this resolution
      powerPreference: 'high-performance',
      stencil: false,
    })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.62
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this._buildSky()
    this._buildLights()
    this._buildComposer()
    this.setQuality(quality)
    this.resize()
  }

  // ------------------------------------------------------------------- sky

  _buildSky () {
    const sky = new Sky()
    sky.scale.setScalar(45000)
    this.scene.add(sky)
    this.sky = sky

    const u = sky.material.uniforms
    u.turbidity.value = 3.4
    u.rayleigh.value = 2.1
    u.mieCoefficient.value = 0.006
    u.mieDirectionalG.value = 0.82

    this.clouds = new Clouds(this.scene, { layers: this.quality === 'low' ? 1 : 2 })

    this.pmrem = new THREE.PMREMGenerator(this.renderer)
    this.pmrem.compileEquirectangularShader()
    this.sunPos = new THREE.Vector3()
    this._envTarget = null
  }

  /** elevation/azimuth in degrees. Rebuilds the sky, sun and environment map. */
  setSun (elevationDeg, azimuthDeg) {
    this.elevation = elevationDeg
    this.azimuth = azimuthDeg
    const phi = THREE.MathUtils.degToRad(90 - elevationDeg)
    const theta = THREE.MathUtils.degToRad(azimuthDeg)
    this.sunPos.setFromSphericalCoords(1, phi, theta)
    this.sky.material.uniforms.sunPosition.value.copy(this.sunPos)

    // Warm and dim the sun as it drops, the way real low sun does.
    const t = THREE.MathUtils.clamp(elevationDeg / 32, 0, 1)
    const warm = new THREE.Color().setHSL(
      THREE.MathUtils.lerp(0.075, 0.125, t),
      THREE.MathUtils.lerp(0.62, 0.16, t),
      THREE.MathUtils.lerp(0.60, 0.96, t))
    this.sun.color.copy(warm)
    this.sun.intensity = THREE.MathUtils.lerp(0.7, 2.6, Math.max(0, t))
    this.sun.position.copy(this.sunPos).multiplyScalar(600)

    this.hemi.intensity = THREE.MathUtils.lerp(0.18, 0.52, t)
    this.clouds.setSun(this.sunPos, warm)

    this._refreshEnv()
  }

  _refreshEnv () {
    if (this._envTarget) this._envTarget.dispose()
    // The PMREM map lights the scene; the Sky mesh itself stays visible as the
    // backdrop, which keeps a crisp sun and a real gradient behind the city.
    this._envTarget = this.pmrem.fromScene(this.sky, 0.04)
    this.scene.environment = this._envTarget.texture
    // The physical sky is very bright in linear terms. Reflections take a small
    // fraction of it, or every smooth surface — glass, car paint — clips to white.
    this.scene.environmentIntensity = 0.52

    // Enough haze to give the city depth, not enough to erase it.
    const el = this.elevation ?? 20
    const horizon = new THREE.Color().setHSL(
      THREE.MathUtils.lerp(0.075, 0.585, THREE.MathUtils.clamp(el / 26, 0, 1)),
      THREE.MathUtils.lerp(0.45, 0.20, THREE.MathUtils.clamp(el / 40, 0, 1)),
      THREE.MathUtils.lerp(0.26, 0.56, THREE.MathUtils.clamp(el / 40, 0, 1)))
    if (!this.scene.fog) this.scene.fog = new THREE.FogExp2(horizon.getHex(), 0.00028)
    else this.scene.fog.color.copy(horizon)
  }

  // ---------------------------------------------------------------- lights

  _buildLights () {
    this.sun = new THREE.DirectionalLight(0xffffff, 2.6)
    this.sun.castShadow = true
    const s = this.sun.shadow
    s.mapSize.set(2048, 2048)
    s.camera.near = 1
    s.camera.far = 900
    s.bias = -0.0006
    s.normalBias = 0.06
    this.shadowSpan = 150
    this.scene.add(this.sun)
    this.scene.add(this.sun.target)

    this.hemi = new THREE.HemisphereLight(0xbcd2ff, 0x6b6152, 0.2)
    this.scene.add(this.hemi)
  }

  /**
   * Keeps the shadow frustum tight around the player so 2048px of shadow map
   * buys sharp contact shadows instead of a blurry city-wide smear.
   */
  focusShadows (target) {
    const span = this.shadowSpan
    const cam = this.sun.shadow.camera
    // Snap to shadow-map texels, otherwise shadows crawl as the car moves.
    const texel = (span * 2) / this.sun.shadow.mapSize.x
    const sx = Math.round(target.x / texel) * texel
    const sz = Math.round(target.z / texel) * texel

    this.sun.target.position.set(sx, 0, sz)
    this.sun.position.set(sx + this.sunPos.x * 400, this.sunPos.y * 400 + 5, sz + this.sunPos.z * 400)
    if (cam.left !== -span) {
      cam.left = -span; cam.right = span; cam.top = span; cam.bottom = -span
      cam.updateProjectionMatrix()
    }
    this.sun.target.updateMatrixWorld()
  }

  // ------------------------------------------------------------- composer

  _buildComposer () {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    // Multisampled target.
    //
    // SMAA is a morphological pass: it softens an edge in a still frame and does
    // nothing about crawl. Nudging the camera a centimetre flipped 2% of the
    // frame, all of it building edges, window frames, tree silhouettes and lane
    // markings — that shimmer is what reads as the picture being unstable.
    // Only MSAA fixes it, because only MSAA has more than one sample to
    // interpolate between as an edge slides across a pixel.
    this.msaaTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType, samples: 4,
    })
    this.composer = new EffectComposer(this.renderer, this.msaaTarget)
    this.renderPass = new RenderPass(this.scene, this.camera)
    this.composer.addPass(this.renderPass)

    this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y)
    this.gtao.output = GTAOPass.OUTPUT.Default
    this.gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 2.0, thickness: 0.5, scale: 1.0, samples: 16 })
    this.gtao.blendIntensity = 0.65
    this.gtao.enabled = false
    this.composer.addPass(this.gtao)

    this.bloom = new UnrealBloomPass(size, 0.22, 0.7, 0.92)
    this.composer.addPass(this.bloom)

    this.output = new OutputPass()
    this.composer.addPass(this.output)

    this.smaa = new SMAAPass(size.x, size.y)
    this.composer.addPass(this.smaa)
  }

  setQuality (q) {
    this.quality = q
    const dpr = window.devicePixelRatio || 1
    // With every pass disabled the composer is still a render target, a full
    // screen copy and an output pass. On a phone that is a real slice of the
    // frame for no picture at all, so `low` bypasses it entirely — tone mapping
    // and the sRGB conversion are renderer settings, so the image is unchanged.
    this.direct = q === 'low'
    if (q === 'low') {
      this.renderer.setPixelRatio(Math.min(dpr, 1))
      this.sun.shadow.mapSize.set(1024, 1024)
      this.gtao.enabled = false
      this.smaa.enabled = false
      this.bloom.enabled = false
      this.shadowSpan = 110
      this.msaaTarget.samples = 0            // `low` bypasses the composer anyway
    } else if (q === 'medium') {
      this.renderer.setPixelRatio(Math.min(dpr, 1.25))
      this.sun.shadow.mapSize.set(2048, 2048)
      this.gtao.enabled = false
      this.smaa.enabled = true
      this.bloom.enabled = true
      this.shadowSpan = 150
      // 2x here rather than 4x: multisampling is bandwidth, and `medium` is the
      // tier that has to hold up on a modest GPU. `Q` reaches the 4x tier.
      this.msaaTarget.samples = 2
    } else {
      this.renderer.setPixelRatio(Math.min(dpr, 1.5))
      this.sun.shadow.mapSize.set(3072, 3072)
      this.gtao.enabled = true
      this.smaa.enabled = true
      this.bloom.enabled = true
      this.shadowSpan = 170
      this.msaaTarget.samples = 4
    }
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null }
    this.resize()
  }

  resize () {
    const w = window.innerWidth, h = window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    this.composer.setSize(w, h)
    this.gtao.setSize(size.x, size.y)
    this.bloom.setSize(size.x, size.y)
    if (this.smaa.setSize) this.smaa.setSize(size.x, size.y)
  }

  render (dt = 0) {
    // Drift the sky before drawing it. Cheap: an offset into a noise texture,
    // and the dome rides with the camera so its edge is unreachable.
    this.clouds.update(dt, this.camera.position)
    if (this.direct) this.renderer.render(this.scene, this.camera)
    else this.composer.render()
  }

  get info () { return this.renderer.info }
}
