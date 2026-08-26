/**
 * On-screen driving controls for touch devices.
 *
 * Steering is an analogue strip, not a pair of left/right buttons. The car takes
 * `input.steer * MAX_STEER`, and at any real speed the difference between a
 * little lock and full lock is the difference between changing lane and spinning
 * — binary buttons throw that away and make the Lada undriveable. The strip is
 * absolute rather than relative to where the thumb lands, so it self-centres and
 * you can find it without looking.
 *
 * Emits the same {throttle, brake, steer, handbrake} shape as the keyboard
 * Input, so the loop merges the two without caring which is in use.
 */

const DEAD = 0.09          // middle of the strip that still counts as straight
const RETURN = 7.5         // how fast the knob springs back, per second

/** True on phones and tablets: a primary pointer that cannot hover precisely. */
export const isCoarse = () =>
  (window.matchMedia?.('(pointer: coarse)').matches ?? false) ||
  navigator.maxTouchPoints > 1

export class TouchControls {
  constructor (root, actions = {}) {
    this.actions = actions
    this.enabled = false
    this.steer = 0
    this._steerTarget = 0
    this._throttle = 0
    this._brake = 0
    this._handbrake = 0
    this._steerPointer = null

    const el = document.createElement('div')
    el.id = 'touch'
    el.innerHTML = `
      <div class="tc-steer" id="tcSteer">
        <div class="tc-track"></div>
        <div class="tc-notch"></div>
        <div class="tc-knob" id="tcKnob"></div>
        <div class="tc-label">steer</div>
      </div>
      <div class="tc-pedals">
        <button class="tc-btn tc-brake" id="tcBrake" aria-label="Brake and reverse">
          <span>BRAKE</span>
        </button>
        <button class="tc-btn tc-gas" id="tcGas" aria-label="Throttle">
          <span>GO</span>
        </button>
      </div>
      <button class="tc-btn tc-hand" id="tcHand" aria-label="Handbrake"><span>HAND<br>BRAKE</span></button>
      <div class="tc-utils">
        <button class="tc-mini" id="tcCam" aria-label="Change camera">CAM</button>
        <button class="tc-mini" id="tcMap" aria-label="Toggle map">MAP</button>
        <button class="tc-mini" id="tcSound" aria-label="Toggle sound">SOUND</button>
        <button class="tc-mini" id="tcRespawn" aria-label="Respawn">RESET</button>
        <button class="tc-mini" id="tcFull" aria-label="Fullscreen">FULL</button>
      </div>`
    root.appendChild(el)
    this.el = el
    this.knob = el.querySelector('#tcKnob')
    this.soundBtn = el.querySelector('#tcSound')

    this._wireSteer(el.querySelector('#tcSteer'))
    this._wireHold(el.querySelector('#tcGas'), v => { this._throttle = v })
    this._wireHold(el.querySelector('#tcBrake'), v => { this._brake = v })
    this._wireHold(el.querySelector('#tcHand'), v => { this._handbrake = v })
    this._wireTap(el.querySelector('#tcCam'), () => actions.camera?.())
    this._wireTap(el.querySelector('#tcMap'), () => actions.map?.())
    this._wireTap(el.querySelector('#tcSound'), () => actions.sound?.())
    this._wireTap(el.querySelector('#tcRespawn'), () => actions.respawn?.())
    this._wireTap(el.querySelector('#tcFull'), () => this.toggleFullscreen())

    // A held pedal is a long press, which Android offers to select or share.
    el.addEventListener('contextmenu', ev => ev.preventDefault())

    // Fullscreen is not available for arbitrary elements on iOS Safari, so the
    // button would be a dead control there. Drop it rather than lie.
    if (!document.documentElement.requestFullscreen) {
      el.querySelector('#tcFull').remove()
    }
  }

  // --------------------------------------------------------------- wiring

  /**
   * Absolute horizontal position within the strip, tracked by pointer id.
   *
   * Capturing the pointer matters: without it, sliding a thumb off the strip
   * mid-corner silently drops the input and the car snaps straight.
   */
  _wireSteer (pad) {
    const update = ev => {
      const r = pad.getBoundingClientRect()
      const k = ((ev.clientX - r.left) / r.width) * 2 - 1        // -1 left … +1 right
      const clamped = Math.max(-1, Math.min(1, k))
      const dead = Math.abs(clamped) < DEAD
        ? 0
        : Math.sign(clamped) * ((Math.abs(clamped) - DEAD) / (1 - DEAD))
      this._steerTarget = dead
      // 40% of the track each way keeps the knob inside the rounded ends.
      this.knob.style.left = `${50 + clamped * 40}%`
      this.knob.classList.add('on')
    }
    pad.addEventListener('pointerdown', ev => {
      ev.preventDefault()
      this._steerPointer = ev.pointerId
      pad.setPointerCapture(ev.pointerId)
      update(ev)
    })
    pad.addEventListener('pointermove', ev => {
      if (ev.pointerId !== this._steerPointer) return
      ev.preventDefault()
      update(ev)
    })
    const release = ev => {
      if (ev.pointerId !== this._steerPointer) return
      this._steerPointer = null
      this._steerTarget = 0
      this.knob.style.left = '50%'
      this.knob.classList.remove('on')
    }
    pad.addEventListener('pointerup', release)
    pad.addEventListener('pointercancel', release)
  }

  /** A button that reads 1 while held. Each tracks its own pointer id. */
  _wireHold (btn, set) {
    let id = null
    btn.addEventListener('pointerdown', ev => {
      ev.preventDefault()
      id = ev.pointerId
      btn.setPointerCapture(ev.pointerId)
      btn.classList.add('on')
      set(1)
    })
    const off = ev => {
      if (ev.pointerId !== id) return
      id = null
      btn.classList.remove('on')
      set(0)
    }
    btn.addEventListener('pointerup', off)
    btn.addEventListener('pointercancel', off)
    // Losing capture (a system gesture, a call) must release the pedal, or the
    // car drives away on its own.
    btn.addEventListener('lostpointercapture', off)
  }

  _wireTap (btn, fn) {
    btn.addEventListener('pointerup', ev => { ev.preventDefault(); fn() })
    btn.addEventListener('pointerdown', ev => ev.preventDefault())
  }

  // ---------------------------------------------------------------- state

  /**
   * Eases the wheel toward the thumb, and back to centre on release.
   *
   * Held tracking is much faster than the return: the target already follows the
   * thumb exactly, so smoothing there only takes the stair-steps off a dragged
   * finger, whereas letting go should feel like a wheel self-centring.
   */
  update (dt) {
    const rate = this._steerPointer === null ? RETURN : 22
    this.steer += (this._steerTarget - this.steer) * (1 - Math.exp(-rate * dt))
    if (Math.abs(this.steer - this._steerTarget) < 0.002) this.steer = this._steerTarget
  }

  get driving () {
    return {
      throttle: this._throttle,
      brake: this._brake,
      steer: -this.steer,        // knob right (+1) must steer right, which is -1
      handbrake: this._handbrake,
    }
  }

  /** Folds touch state into the keyboard's, so both work on a hybrid device. */
  merge (drive) {
    if (!this.enabled) return drive
    const t = this.driving
    return {
      throttle: Math.max(drive.throttle, t.throttle),
      brake: Math.max(drive.brake, t.brake),
      steer: drive.steer || t.steer,
      handbrake: Math.max(drive.handbrake, t.handbrake),
    }
  }

  setEnabled (on) {
    if (this.enabled === on) return
    this.enabled = on
    this.el.classList.toggle('on', on)
    if (!on) {
      this._throttle = this._brake = this._handbrake = 0
      this._steerTarget = this.steer = 0
    }
  }

  /** Reflects the audio state on the button, so it is never a lying control. */
  setSound (on) {
    if (!this.soundBtn) return
    this.soundBtn.textContent = on ? 'SOUND' : 'MUTED'
    this.soundBtn.classList.toggle('off', !on)
  }

  async toggleFullscreen () {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      // Locking to landscape is best-effort: it needs fullscreen, and Safari
      // does not implement it at all.
      if (document.fullscreenElement && screen.orientation?.lock) {
        await screen.orientation.lock('landscape').catch(() => {})
      }
    } catch { /* user gesture rejected, or unsupported — no worse than before */ }
  }
}
