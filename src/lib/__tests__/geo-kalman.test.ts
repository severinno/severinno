import { describe, it, expect, beforeEach } from "vitest"
import { KalmanFilter2D } from "../geo-kalman"

describe("KalmanFilter2D (src/lib/geo-kalman.ts)", () => {
  let kalman: KalmanFilter2D

  beforeEach(() => {
    kalman = new KalmanFilter2D({ processNoiseMps: 2.0 })
  })

  it("initializes with first reading as identity", () => {
    expect(kalman.isInitialized()).toBe(false)
    expect(kalman.getState()).toBeNull()

    const fix = kalman.update(-23.55052, -46.633308, 10.0, 1000)
    expect(kalman.isInitialized()).toBe(true)
    expect(fix.lat).toBe(-23.55052)
    expect(fix.lng).toBe(-46.633308)
    expect(fix.accuracyMeters).toBe(10.0)
    expect(fix.timestampMs).toBe(1000)
  })

  it("smooths noisy high-jitter readings towards central trajectory", () => {
    // Initial reading
    kalman.update(-23.55, -46.63, 5.0, 1000)

    // Jitter reading: sudden spike of +0.001 with lower accuracy (25m error) 1 second later
    const jitter = kalman.update(-23.549, -46.629, 25.0, 2000)

    // The Kalman estimate should temper the spike and stay closer to initial state (-23.550000) than the raw spike (-23.549000)
    const rawDelta = Math.abs(-23.549 - -23.55) // 0.001
    const smoothedDelta = Math.abs(jitter.lat - -23.55)
    expect(smoothedDelta).toBeLessThan(rawDelta / 2)
  })

  it("converges quickly when high-accuracy readings arrive", () => {
    kalman.update(-23.55, -46.63, 15.0, 1000)

    // A series of highly accurate (2m) fixes arrives
    let state = kalman.update(-23.5501, -46.6301, 2.0, 2000)
    state = kalman.update(-23.5502, -46.6302, 2.0, 3000)

    expect(state.lat).toBeCloseTo(-23.5502, 4)
    expect(state.lng).toBeCloseTo(-46.6302, 4)
    expect(state.accuracyMeters).toBeLessThan(5.0)
  })

  it("resets state properly", () => {
    kalman.update(-23.55, -46.63, 5.0, 1000)
    expect(kalman.isInitialized()).toBe(true)

    kalman.reset()
    expect(kalman.isInitialized()).toBe(false)
    expect(kalman.getState()).toBeNull()
  })

  it("handles out-of-order timestamps without corrupting state", () => {
    kalman.update(-23.55, -46.63, 5.0, 5000)

    // Delayed old packet arrives with timestamp 3000 (< 5000)
    const delayed = kalman.update(-23.54, -46.62, 5.0, 3000)

    // Timestamp must remain the latest known (5000), not reverted
    expect(delayed.timestampMs).toBe(5000)
    expect(delayed.lat).toBeCloseTo(-23.55, 4)
  })

  it("dampens physical teleportation / multipath jumps exceeding maxVelocityMps", () => {
    // Start at -23.55, -46.63
    kalman.update(-23.55, -46.63, 5.0, 1000)

    // Huge teleportation jump of ~2.2 km in 1 second (~8,000 km/h)
    const jump = kalman.update(-23.53, -46.63, 5.0, 2000)

    // Because speed exceeded maxVelocityMps, effective accuracy was inflated, damping the jump
    const jumpDistanceRaw = Math.abs(-23.53 - -23.55) // 0.02 deg
    const actualDelta = Math.abs(jump.lat - -23.55)
    expect(actualDelta).toBeLessThan(jumpDistanceRaw * 0.3)
  })
})
