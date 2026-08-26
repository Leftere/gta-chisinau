/**
 * The car, synthesised.
 *
 * Everything else in this project is generated rather than shipped — textures,
 * geometry, the city itself — and audio is no different. A recorded engine loop
 * would be a megabyte that only ever plays one RPM convincingly; an oscillator
 * bank driven by the actual gearbox ratios costs nothing and rises and falls
 * with the car because it is derived from it.
 *
 * Four voices:
 *   engine  — sawtooth bank at the firing frequency, opened up by throttle
 *   road    — filtered noise, the thing that actually conveys speed
 *   tyres   — howl, driven by how far past its friction limit a tyre is
 *   brakes  — pad squeal, high and thin, only under real pressure
 */

// VAZ-2106 five-speed, and the 4.10 final drive. Real ratios: the gearbox is
// most of what an engine note *is*, and inventing them gets the shifts wrong.
const GEARS = [3.24, 1.99, 1.36, 1.00, 0.82]
const FINAL = 4.10
const WHEEL_R = 0.29

const IDLE_RPM = 850
const MAX_RPM = 6000
const SHIFT_UP = 5000
const SHIFT_DOWN = 2150
const SHIFT_LIFT = 0.26        // seconds the note drops away across a gearchange

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

/**
 * The engine's harmonic recipe.
 *
 * A sawtooth carries every harmonic at 1/n, which is why an oscillator-stack
 * engine buzzes like a wasp: at full throttle the filter is wide open and all of
 * that upper content comes straight through. A real exhaust note is dominated by
 * the low orders and falls away fast, so the harmonics are specified directly and
 * the series stops at the tenth.
 */
function engineWave (ctx) {
  //          DC   1     2     3     4     5     6     7     8     9    10
  const imag = [0, 0.55, 1.00, 0.62, 0.30, 0.16, 0.10, 0.06, 0.035, 0.02, 0.012]
  return ctx.createPeriodicWave(new Float32Array(imag.length), Float32Array.from(imag),
    { disableNormalization: false })
}

/** Two seconds of white noise, looped. One buffer feeds every noise voice. */
function noiseBuffer (ctx) {
  const len = ctx.sampleRate * 2
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {
    // Slightly brown-tinted: pure white is hissy and reads as static rather
    // than as road and tyre.
    last = (last + Math.random() * 2 - 1) * 0.5
    d[i] = last * 0.9
  }
  return buf
}

export class CarAudio {
  constructor () {
    this.ctx = null
    this.ready = false
    this.muted = false
    this.gear = 0
    this.rpm = IDLE_RPM
    this._wobble = 0
    this._drift = 0
    this.shift = 0
    this._lastCrash = 0
    try { this.muted = localStorage.getItem('mute') === '1' } catch { /* private mode */ }
  }

  /**
   * Browsers refuse to start audio without a user gesture, so this is called
   * from the first key or tap rather than at load. Safe to call repeatedly.
   */
  unlock () {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return
      try { this.ctx = new AC() } catch { return }
      this._build()
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})
  }

  _build () {
    const ctx = this.ctx
    const now = ctx.currentTime

    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 0.9
    this.master.connect(ctx.destination)

    // A gentle limiter: four voices at full tilt would otherwise clip.
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 6
    comp.attack.value = 0.004
    comp.release.value = 0.18
    comp.connect(this.master)
    this.bus = comp

    const noise = ctx.createBufferSource()
    noise.buffer = noiseBuffer(ctx)
    noise.loop = true
    noise.start()
    this.noise = noise

    // --- engine ------------------------------------------------------------
    this.engineLPF = ctx.createBiquadFilter()
    this.engineLPF.type = 'lowpass'
    this.engineLPF.frequency.value = 520
    this.engineLPF.Q.value = 0.6

    // Body. The firing fundamental at idle is 28 Hz, which a laptop speaker
    // simply does not reproduce — without lifting the range just above it, an
    // idling car is silent on most machines.
    this.engineShelf = ctx.createBiquadFilter()
    this.engineShelf.type = 'lowshelf'
    this.engineShelf.frequency.value = 260
    this.engineShelf.gain.value = 9

    this.engineGain = ctx.createGain()
    this.engineGain.gain.value = 0
    this.engineLPF.connect(this.engineShelf).connect(this.engineGain).connect(comp)

    // Half-order and firing order. The half-order is what makes a four-cylinder
    // lumpy, and it is genuinely there rather than a detune trick.
    const wave = engineWave(ctx)
    this.oscs = [
      { mul: 0.5, gain: 0.30 },
      { mul: 1.0, gain: 0.55 },
    ].map(cfg => {
      const o = ctx.createOscillator()
      o.setPeriodicWave(wave)
      o.frequency.value = 30
      const g = ctx.createGain()
      g.gain.value = cfg.gain
      o.connect(g).connect(this.engineLPF)
      o.start()
      return { osc: o, mul: cfg.mul }
    })

    // Combustion, as a pulse train rather than a drone.
    //
    // Noise gated open once per firing event is what an engine actually is, and
    // it is the difference between a chuffing motor and a synth holding a note.
    // The oscillator swings +/-1 into a gain whose base is 1, giving 0..2.
    this.intakeBP = ctx.createBiquadFilter()
    this.intakeBP.type = 'bandpass'
    this.intakeBP.frequency.value = 220
    this.intakeBP.Q.value = 1.1
    this.pulseGain = ctx.createGain()
    this.pulseGain.gain.value = 1
    this.amOsc = ctx.createOscillator()
    this.amOsc.type = 'sawtooth'
    this.amOsc.frequency.value = 30
    this.amDepth = ctx.createGain()
    this.amDepth.gain.value = 0.85
    this.amOsc.connect(this.amDepth).connect(this.pulseGain.gain)
    this.amOsc.start()
    this.intakeGain = ctx.createGain()
    this.intakeGain.gain.value = 0
    noise.connect(this.intakeBP).connect(this.pulseGain).connect(this.intakeGain).connect(comp)

    // --- road --------------------------------------------------------------
    this.roadLPF = ctx.createBiquadFilter()
    this.roadLPF.type = 'lowpass'
    this.roadLPF.frequency.value = 320
    this.roadGain = ctx.createGain()
    this.roadGain.gain.value = 0
    noise.connect(this.roadLPF).connect(this.roadGain).connect(comp)

    // --- tyres -------------------------------------------------------------
    this.tyreBP = ctx.createBiquadFilter()
    this.tyreBP.type = 'bandpass'
    this.tyreBP.frequency.value = 1150
    this.tyreBP.Q.value = 7
    this.tyreGain = ctx.createGain()
    this.tyreGain.gain.value = 0
    noise.connect(this.tyreBP).connect(this.tyreGain).connect(comp)

    // --- brakes ------------------------------------------------------------
    // Pad squeal is a resonance, not a tone: very high Q on noise, not an
    // oscillator, or it sounds like a doorbell.
    this.brakeBP = ctx.createBiquadFilter()
    this.brakeBP.type = 'bandpass'
    this.brakeBP.frequency.value = 2850
    this.brakeBP.Q.value = 24
    this.brakeGain = ctx.createGain()
    this.brakeGain.gain.value = 0
    noise.connect(this.brakeBP).connect(this.brakeGain).connect(comp)

    this.ready = true
    void now
  }

  setMuted (m) {
    this.muted = m
    try { localStorage.setItem('mute', m ? '1' : '0') } catch { /* private mode */ }
    if (this.ready) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05)
  }

  toggle () { this.setMuted(!this.muted); return this.muted }

  /** Picks a gear that keeps the engine in its range, with hysteresis. */
  _shift (speed) {
    const rpmIn = g => (speed / WHEEL_R) * FINAL * GEARS[g] * 60 / (2 * Math.PI)
    const was = this.gear
    if (rpmIn(this.gear) > SHIFT_UP && this.gear < GEARS.length - 1) this.gear++
    else if (rpmIn(this.gear) < SHIFT_DOWN && this.gear > 0) this.gear--
    // A shift is a lift: the note drops away for a moment and comes back lower.
    // Without it a long acceleration is one unbroken ramp, which is most of what
    // makes synthesised engines tiring to listen to.
    if (this.gear !== was) this.shift = SHIFT_LIFT
    return clamp(rpmIn(this.gear), IDLE_RPM, MAX_RPM)
  }

  /**
   * @param car    the Car, for speed, slip and crash impulse
   * @param input  {throttle, brake, handbrake}
   * @param dt     seconds since the last call
   */
  update (car, input, dt) {
    if (!this.ready || this.muted) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const k = 0.06                       // smoothing time-constant for every ramp
    const set = (param, v) => param.setTargetAtTime(v, t, k)

    const speed = Math.abs(car.vLong)
    const throttle = input.throttle ?? 0
    const brake = input.brake ?? 0

    // --- engine ------------------------------------------------------------
    const target = this._shift(speed)
    this.shift = Math.max(0, this.shift - dt)
    const lift = this.shift / SHIFT_LIFT               // 1 at the change, 0 after
    const pedal = throttle * (1 - lift)                // the pedal is up mid-shift

    // Revs chase the gearbox, but blip up on throttle and fall away off it, so
    // the note responds to the pedal and not only to road speed.
    const want = clamp(target + pedal * 900 - (1 - pedal) * 180, IDLE_RPM, MAX_RPM)
    this.rpm += (want - this.rpm) * Math.min(1, dt * 6)

    // A carburetted engine never holds a steady idle: a fast tremble from the
    // firing pulses, and a slow drift as the mixture wanders. Without both it is
    // a synth holding a note.
    this._wobble += dt * (2.1 + Math.random() * 0.8)
    this._drift += dt * 0.37
    const idleness = 1 - clamp((this.rpm - IDLE_RPM) / 900, 0, 1)
    const jitter = 1 + (Math.sin(this._wobble) * 0.014 + Math.sin(this._drift * 2.3) * 0.02) * idleness

    const firing = (this.rpm / 30) * jitter      // 4-stroke four: two per rev
    for (const o of this.oscs) set(o.osc.frequency, firing * o.mul)
    set(this.amOsc.frequency, firing)

    const rev = (this.rpm - IDLE_RPM) / (MAX_RPM - IDLE_RPM)
    // Ceiling kept low deliberately. Everything above about 1.6 kHz here is
    // harmonic buzz rather than engine, and it is what made this tiring.
    set(this.engineLPF.frequency, 370 + pedal * 700 + rev * 380)
    set(this.engineGain.gain, (0.105 + pedal * 0.058 + rev * 0.032) * (1 - lift * 0.6))
    // The pulse train carries the texture, so it leads on throttle while the
    // tonal part stays back — that is what keeps it from droning.
    set(this.intakeBP.frequency, clamp(220 + firing * 1.6, 160, 900))
    set(this.intakeGain.gain, (0.026 + pedal * 0.038 + rev * 0.015) * (1 - lift * 0.7))

    // --- road --------------------------------------------------------------
    set(this.roadLPF.frequency, 300 + speed * 46)
    set(this.roadGain.gain, clamp(speed / 30, 0, 1) * 0.13)

    // --- tyres -------------------------------------------------------------
    // Only once a tyre is actually past its limit, and only at a speed where
    // rubber would howl — otherwise every gentle corner chirps.
    const slide = clamp((car.slipRatio - 0.88) / 0.30, 0, 1)
    const moving = clamp((speed - 2.5) / 5, 0, 1)
    const howl = slide * moving * (input.handbrake ? 1 : 0.85)
    set(this.tyreGain.gain, howl * 0.22)
    set(this.tyreBP.frequency, 980 + howl * 520 + Math.sin(this._wobble * 3) * 40)

    // --- brakes ------------------------------------------------------------
    // Squeal belongs to firm braking at moderate speed. Hard stops from high
    // speed are tyre noise, and a crawl is silent.
    const band = clamp((speed - 1.6) / 3, 0, 1) * clamp((16 - speed) / 6, 0, 1)
    set(this.brakeGain.gain, clamp((brake - 0.35) / 0.65, 0, 1) * band * 0.055)

    // --- impact ------------------------------------------------------------
    if (car.crashImpulse > this._lastCrash + 0.6) this._thump(car.crashImpulse)
    this._lastCrash = car.crashImpulse
  }

  /** One-shot body impact: a filtered noise burst over a low thud. */
  _thump (impulse) {
    const ctx = this.ctx
    const t = ctx.currentTime
    const level = clamp(impulse / 9, 0.06, 0.5)

    const src = ctx.createBufferSource()
    src.buffer = this.noise.buffer
    src.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 320
    bp.Q.value = 1.1
    const g = ctx.createGain()
    g.gain.setValueAtTime(level, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28)
    src.connect(bp).connect(g).connect(this.bus)
    src.start(t)
    src.stop(t + 0.3)

    const thud = ctx.createOscillator()
    thud.type = 'sine'
    thud.frequency.setValueAtTime(90, t)
    thud.frequency.exponentialRampToValueAtTime(38, t + 0.18)
    const tg = ctx.createGain()
    tg.gain.setValueAtTime(level * 0.9, t)
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
    thud.connect(tg).connect(this.bus)
    thud.start(t)
    thud.stop(t + 0.24)
  }
}
