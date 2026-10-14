/**
 * geo-kalman.ts — 2D Kalman Filter for High-Precision GPS Telemetry Smoothing
 *
 * Problem Solved:
 * Raw mobile GNSS / GPS chips produce continuous stochastic jitter (±5m to ±25m)
 * even when a user is completely stationary, as well as multipath reflections
 * in dense urban environments (urban canyons / tall buildings).
 *
 * Algorithm:
 * Implements a discrete-time linear Kalman filter over geographic coordinates (lat, lng),
 * modeling position and sensor uncertainty (variance = accuracy^2).
 *
 * 1. Time Update (Predict):
 *    variance = variance + (timeDeltaSec * qMetersPerSecond^2)
 * 2. Measurement Update (Correct):
 *    kalmanGain = variance / (variance + measurementAccuracy^2)
 *    lat = lat + kalmanGain * (measuredLat - lat)
 *    lng = lng + kalmanGain * (measuredLng - lng)
 *    variance = (1 - kalmanGain) * variance
 */

export interface KalmanFilterOptions {
  /**
   * Process noise in meters per second (expected physical velocity uncertainty).
   * Default: 3.0 m/s (~11 km/h walking / urban movement speed variance).
   */
  processNoiseMps?: number
  /**
   * Minimum measurement accuracy in meters to prevent division by zero or overconfidence.
   * Default: 1.0 meter.
   */
  minAccuracyMeters?: number
}

export interface FilteredPosition {
  lat: number
  lng: number
  accuracyMeters: number
  timestampMs: number
}

export class KalmanFilter2D {
  private lat: number = 0
  private lng: number = 0
  private variance: number = -1 // < 0 signifies uninitialized state
  private timestampMs: number = 0
  private readonly qMetersPerSecond: number
  private readonly minAccuracyMeters: number

  constructor(options: KalmanFilterOptions = {}) {
    this.qMetersPerSecond = options.processNoiseMps ?? 3.0
    this.minAccuracyMeters = Math.max(0.1, options.minAccuracyMeters ?? 1.0)
  }

  /**
   * Resets the filter state to uninitialized.
   */
  public reset(): void {
    this.variance = -1
    this.lat = 0
    this.lng = 0
    this.timestampMs = 0
  }

  /**
   * Returns whether the filter has received at least one valid coordinate fix.
   */
  public isInitialized(): boolean {
    return this.variance >= 0
  }

  /**
   * Processes a raw GPS measurement and returns the smoothed, optimal estimate.
   *
   * @param lat Measured latitude in degrees (-90 to 90)
   * @param lng Measured longitude in degrees (-180 to 180)
   * @param accuracyMeters 68% confidence radius reported by the GNSS device in meters
   * @param timestampMs Epoch timestamp in milliseconds (defaults to Date.now())
   */
  public update(
    lat: number,
    lng: number,
    accuracyMeters: number,
    timestampMs: number = Date.now(),
  ): FilteredPosition {
    // Sanitize raw inputs
    const safeAccuracy = Math.max(accuracyMeters, this.minAccuracyMeters)

    // First measurement initialization
    if (this.variance < 0) {
      this.lat = lat
      this.lng = lng
      this.variance = safeAccuracy * safeAccuracy
      this.timestampMs = timestampMs
      return {
        lat: this.lat,
        lng: this.lng,
        accuracyMeters: safeAccuracy,
        timestampMs: this.timestampMs,
      }
    }

    // Compute elapsed time in seconds
    const timeDeltaSec = Math.max(0.001, (timestampMs - this.timestampMs) / 1000.0)
    this.timestampMs = timestampMs

    // ── 1. Predict Step ───────────────────────────────────────────────────
    // Increase estimated variance based on elapsed time and process noise
    this.variance += timeDeltaSec * (this.qMetersPerSecond * this.qMetersPerSecond)

    // ── 2. Update Step ────────────────────────────────────────────────────
    const measurementVariance = safeAccuracy * safeAccuracy
    const kalmanGain = this.variance / (this.variance + measurementVariance)

    // Update coordinates toward measurement scaled by Kalman gain
    this.lat += kalmanGain * (lat - this.lat)
    this.lng += kalmanGain * (lng - this.lng)

    // Update posteriori error covariance
    this.variance = (1 - kalmanGain) * this.variance

    const estimatedAccuracy = Math.sqrt(Math.max(this.variance, this.minAccuracyMeters))

    return {
      lat: Math.round(this.lat * 1e7) / 1e7,
      lng: Math.round(this.lng * 1e7) / 1e7,
      accuracyMeters: Math.round(estimatedAccuracy * 10) / 10,
      timestampMs: this.timestampMs,
    }
  }

  /**
   * Returns current internal state estimate without updating.
   */
  public getState(): FilteredPosition | null {
    if (this.variance < 0) return null
    return {
      lat: this.lat,
      lng: this.lng,
      accuracyMeters: Math.sqrt(this.variance),
      timestampMs: this.timestampMs,
    }
  }
}
