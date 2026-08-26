/** Keyboard state, normalised into the analogue-ish values the car wants. */
export class Input {
  constructor (target = window) {
    this.keys = new Set()
    this.pressed = new Set()
    this._onDown = e => {
      if (e.repeat) return
      const k = e.key.toLowerCase()
      this.keys.add(k)
      this.pressed.add(k)
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault()
    }
    this._onUp = e => this.keys.delete(e.key.toLowerCase())
    this._onBlur = () => this.keys.clear()
    target.addEventListener('keydown', this._onDown)
    target.addEventListener('keyup', this._onUp)
    target.addEventListener('blur', this._onBlur)
  }

  down (...ks) { return ks.some(k => this.keys.has(k)) }

  /** True once per physical key press. */
  tapped (k) {
    if (this.pressed.has(k)) { this.pressed.delete(k); return true }
    return false
  }

  endFrame () { this.pressed.clear() }

  get driving () {
    const steer = (this.down('a', 'arrowleft') ? 1 : 0) - (this.down('d', 'arrowright') ? 1 : 0)
    return {
      throttle: this.down('w', 'arrowup') ? 1 : 0,
      brake: this.down('s', 'arrowdown') ? 1 : 0,
      steer,
      handbrake: this.down(' ') ? 1 : 0,
    }
  }
}
