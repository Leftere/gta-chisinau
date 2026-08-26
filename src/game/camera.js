/**
 * Chase camera.
 *
 * The camera lags the car on a critically-damped spring and aims at a point
 * ahead of it, so fast corners feel fast. Field of view opens up with speed —
 * the oldest trick there is for conveying velocity, and it still works.
 */
import * as THREE from 'three'

export const MODES = ['chase', 'hood', 'far', 'orbit']

/**
 * How far along car -> desired the camera can travel before it meets a wall.
 *
 * Without this the camera happily sits inside buildings, and since every wall is
 * back-facing from within, the building appears to vanish: you see straight out
 * through the facade while the car is still solidly blocked outside it. Reads
 * exactly like a transparent wall.
 */
function wallClamp (grid, ax, az, bx, bz, margin = 0.6) {
  if (!grid) return 1
  const dx = bx - ax, dz = bz - az
  const len = Math.hypot(dx, dz)
  if (len < 1e-3) return 1
  let best = 1
  grid.near((ax + bx) / 2, (az + bz) / 2, len / 2 + 2, (x1, z1, x2, z2) => {
    const ex = x2 - x1, ez = z2 - z1
    const den = dx * ez - dz * ex
    if (Math.abs(den) < 1e-9) return          // parallel
    const t = ((x1 - ax) * ez - (z1 - az) * ex) / den   // along car -> camera
    const u = ((x1 - ax) * dz - (z1 - az) * dx) / den   // along the wall
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      const pulled = Math.max(0, t - margin / len)
      if (pulled < best) best = pulled
    }
  })
  return best
}

export class ChaseCamera {
  constructor (camera) {
    this.camera = camera
    this.mode = 'chase'
    this.pos = new THREE.Vector3(0, 5, -10)
    this.look = new THREE.Vector3()
    this.orbitAngle = 0
    this._desired = new THREE.Vector3()
    this._lookTarget = new THREE.Vector3()
  }

  cycle () {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]
  }

  update (car, dt) {
    const speed = Math.abs(car.vLong)
    const cos = Math.cos(car.yaw), sin = Math.sin(car.yaw)

    // Everything vertical is relative to the ground under the car.
    const gy = car.pos.y || 0

    if (this.mode === 'hood') {
      this._desired.set(car.pos.x + sin * 0.25, gy + 1.32, car.pos.z + cos * 0.25)
      this._lookTarget.set(car.pos.x + sin * 24, gy + 1.35, car.pos.z + cos * 24)
      this.pos.copy(this._desired)
      this.look.lerp(this._lookTarget, 1 - Math.pow(0.0001, dt))
      this.camera.fov = 68 + Math.min(speed * 0.32, 12)
    } else if (this.mode === 'orbit') {
      this.orbitAngle += dt * 0.22
      const r = 14
      this._desired.set(
        car.pos.x + Math.sin(this.orbitAngle) * r,
        gy + 5.5,
        car.pos.z + Math.cos(this.orbitAngle) * r)
      const to = wallClamp(car.grid, car.pos.x, car.pos.z, this._desired.x, this._desired.z)
      if (to < 1) {
        this._desired.x = car.pos.x + (this._desired.x - car.pos.x) * to
        this._desired.z = car.pos.z + (this._desired.z - car.pos.z) * to
      }
      this.pos.lerp(this._desired, 1 - Math.pow(0.02, dt))
      this._lookTarget.copy(car.pos).setY(gy + 1.0)
      this.look.lerp(this._lookTarget, 1 - Math.pow(0.001, dt))
      this.camera.fov = 55
    } else {
      const far = this.mode === 'far'
      const dist = (far ? 13.5 : 8.2) + Math.min(speed * 0.10, 2.4)
      const height = far ? 6.2 : 3.35

      // Sit behind the car's heading, but drift toward its actual direction of
      // travel when sliding, so a drift is framed from the outside.
      const driftYaw = car.yaw - THREE.MathUtils.clamp(Math.atan2(car.vLat, Math.max(1, Math.abs(car.vLong))), -0.5, 0.5) * 0.55
      const dsin = Math.sin(driftYaw), dcos = Math.cos(driftYaw)

      this._desired.set(
        car.pos.x - dsin * dist,
        gy + height + Math.min(speed * 0.02, 0.9),
        car.pos.z - dcos * dist)

      // Keep the ideal position on this side of any wall...
      const t = wallClamp(car.grid, car.pos.x, car.pos.z, this._desired.x, this._desired.z)
      if (t < 1) {
        this._desired.x = car.pos.x + (this._desired.x - car.pos.x) * t
        this._desired.z = car.pos.z + (this._desired.z - car.pos.z) * t
      }

      const follow = 1 - Math.pow(0.0015, dt)
      this.pos.lerp(this._desired, follow)

      // ...and again after smoothing, so the lag never carries it through one.
      const t2 = wallClamp(car.grid, car.pos.x, car.pos.z, this.pos.x, this.pos.z)
      if (t2 < 1) {
        this.pos.x = car.pos.x + (this.pos.x - car.pos.x) * t2
        this.pos.z = car.pos.z + (this.pos.z - car.pos.z) * t2
      }

      const lead = 6 + Math.min(speed * 0.55, 16)
      this._lookTarget.set(car.pos.x + sin * lead, gy + 1.35, car.pos.z + cos * lead)
      this.look.lerp(this._lookTarget, 1 - Math.pow(0.0006, dt))

      this.camera.fov = 58 + Math.min(speed * 0.38, 15)
    }

    this.camera.position.copy(this.pos)
    this.camera.lookAt(this.look)
    this.camera.updateProjectionMatrix()
  }
}
