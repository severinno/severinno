/**
 * Subtle coin sound effect using the Web Audio API.
 *
 * Synthesises a short ascending two-tone "coin" sound programmatically,
 * so it requires no external audio files and works in all modern browsers.
 *
 * The AudioContext is created lazily on the first user interaction that
 * triggers the sound, respecting browser autoplay policies.
 */

let _ctx: AudioContext | null = null

function getCtx(): AudioContext {
  if (!_ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext
    _ctx = new Ctor()
  }
  return _ctx
}

/**
 * Trigger a subtle vibration on supported mobile devices.
 *
 * Uses `navigator.vibrate()` — available on most modern mobile browsers.
 * Silently ignored when the API is not available (desktop, unsupported
 * browsers, or if the user has disabled vibration in accessibility settings).
 *
 * @param pattern Vibration pattern passed directly to `navigator.vibrate`.
 *                A single number is vibration duration in ms.
 *                An array alternates vibration and pause: [vibrate, pause, vibrate, …]
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate
 */
export function tryVibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(pattern)
    }
  } catch {
    // Vibration is a progressive enhancement — silence failures gracefully.
  }
}

/**
 * Play a short "coin drop" sound.
 *
 * The sound is a quick ascending two-tone (C5 → E5) sine wave
 * with a fast decay, roughly 200 ms total — subtle enough not to annoy.
 *
 * @param options.vibrate — set to `false` to skip vibration (default `true`).
 */
export function playCoinSound(options?: { vibrate?: boolean }): void {
  if (options?.vibrate !== false) tryVibrate([30, 50, 30, 50, 30])
  try {
    const ctx = getCtx()
    const now = ctx.currentTime

    // ---- First tone (C5 ~523 Hz) — slightly louder --------------------------
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = "sine"
    osc1.frequency.value = 523.25
    gain1.gain.setValueAtTime(0.15, now)
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15)
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(now)
    osc1.stop(now + 0.15)

    // ---- Second tone (E5 ~659 Hz) — slightly quieter, delayed ---------------
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = "sine"
    osc2.frequency.value = 659.25
    gain2.gain.setValueAtTime(0.12, now + 0.06)
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.2)
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(now + 0.06)
    osc2.stop(now + 0.2)
  } catch {
    // Audio is a progressive enhancement — silence failures gracefully.
  }
}

/**
 * Play a soft "completion chime" sound.
 *
 * A gentle single-tone chime (G4 ~392 Hz) with a slow fade-in and long
 * decay, roughly 400 ms total. Softer and more delicate than the coin
 * sound — suitable for client-side notifications like "Serviço concluído".
 *
 * @param options.vibrate — set to `false` to skip vibration (default `true`).
 */
export function playCompletionSound(options?: { vibrate?: boolean }): void {
  if (options?.vibrate !== false) tryVibrate([80])
  try {
    const ctx = getCtx()
    const now = ctx.currentTime

    // Single tone (G4 ~392 Hz) — triangle wave for a softer timbre
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = "triangle"
    osc.frequency.value = 392.0
    // Gradual attack + slow release
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(0.08, now + 0.04)
    gain.gain.setValueAtTime(0.08, now + 0.2)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.42)
  } catch {
    // Audio is a progressive enhancement — silence failures gracefully.
  }
}

/**
 * Play a short "star sparkle" sound for new reviews.
 *
 * A quick ascending three-note arpeggio (C5 → E5 → G5) like a star
 * rating appearing. Bright, cheerful, and very short (~180 ms).
 *
 * @param options.vibrate — set to `false` to skip vibration (default `true`).
 */
export function playReviewSound(options?: { vibrate?: boolean }): void {
  if (options?.vibrate !== false) tryVibrate([20, 30, 20, 30, 20])
  try {
    const ctx = getCtx()
    const now = ctx.currentTime

    const notes = [
      { freq: 523.25, time: 0, vol: 0.10 },    // C5
      { freq: 659.25, time: 0.05, vol: 0.08 },   // E5
      { freq: 783.99, time: 0.1, vol: 0.06 },    // G5
    ]

    for (const { freq, time, vol } of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "sine"
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, now + time)
      gain.gain.linearRampToValueAtTime(vol, now + time + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + time + 0.08)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + time)
      osc.stop(now + time + 0.1)
    }
  } catch {
    // Audio is a progressive enhancement — silence failures gracefully.
  }
}

/**
 * Play a welcoming "hello" sound for when the user first enters their panel.
 *
 * A bright ascending four-note arpeggio (C4 → E4 → G4 → C5) like a
 * cheerful major chord being strummed. Roughly 500 ms total — welcoming
 * but not intrusive.
 *
 * @param options.vibrate — set to `false` to skip vibration (default `true`).
 */
export function playWelcomeSound(options?: { vibrate?: boolean }): void {
  if (options?.vibrate !== false) tryVibrate([40, 50, 50, 60])
  try {
    const ctx = getCtx()
    const now = ctx.currentTime

    const notes = [
      { freq: 261.63, time: 0, vol: 0.08 },     // C4
      { freq: 329.63, time: 0.08, vol: 0.07 },   // E4
      { freq: 392.00, time: 0.16, vol: 0.06 },   // G4
      { freq: 523.25, time: 0.28, vol: 0.08 },   // C5
    ]

    for (const { freq, time, vol } of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "sine"
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, now + time)
      gain.gain.linearRampToValueAtTime(vol, now + time + 0.02)
      gain.gain.linearRampToValueAtTime(vol * 0.6, now + time + 0.08)
      gain.gain.exponentialRampToValueAtTime(0.001, now + time + 0.15)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + time)
      osc.stop(now + time + 0.18)
    }
  } catch {
    // Audio is a progressive enhancement — silence failures gracefully.
  }
}

/**
 * Play a short "error" sound for cancelled / rejected transactions.
 *
 * A descending minor two-tone (E5 → C5) using a sawtooth wave for a
 * slightly buzzy, unmistakable "something went wrong" feel.
 * Roughly 300 ms total — short enough not to be annoying.
 *
 * @param options.vibrate — set to `false` to skip vibration (default `true`).
 */
export function playErrorSound(options?: { vibrate?: boolean }): void {
  if (options?.vibrate !== false) tryVibrate([40, 60, 40])
  try {
    const ctx = getCtx()
    const now = ctx.currentTime

    // First tone (E5 ~659 Hz) — slightly buzzy sawtooth
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = "sawtooth"
    osc1.frequency.value = 659.25
    gain1.gain.setValueAtTime(0.08, now)
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15)
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(now)
    osc1.stop(now + 0.15)

    // Second tone (C5 ~523 Hz) — descending, sad interval
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = "sawtooth"
    osc2.frequency.value = 523.25
    gain2.gain.setValueAtTime(0.06, now + 0.1)
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3)
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(now + 0.1)
    osc2.stop(now + 0.3)
  } catch {
    // Audio is a progressive enhancement — silence failures gracefully.
  }
}
