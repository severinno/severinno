"use client"

/**
 * `useBalancePulse` — tracks a numeric balance and triggers a temporary
 * "pulse" flag whenever the value *increases*.
 *
 * Use case: a wallet balance indicator that should visually pulse (and
 * optionally play a sound) every time new revenue arrives.
 *
 * @param balance    The current balance value (may be `undefined` on first
 *                   load — the hook will silently seed its internal ref).
 * @param onIncrease Optional callback invoked when the balance increases.
 *                   Useful for playing a sound effect without coupling the
 *                   hook to any particular sound library.
 * @param pulseMs    Duration of the pulse flag in ms (default 800).
 *
 * @returns `{ isPulsing }` — `true` for `pulseMs` milliseconds whenever
 *          `balance` increases, then resets to `false`.
 *
 * @example
 * ```tsx
 * const { isPulsing } = useBalancePulse(data?.balance, () => playCoin())
 *
 * <motion.button
 *   animate={isPulsing ? { scale: [1, 1.12, 1] } : { scale: 1 }}
 * >
 *   {formatBRL(data.balance)}
 * </motion.button>
 * ```
 */

import { useRef, useState, useEffect } from "react"

export function useBalancePulse(
  balance: number | undefined,
  onIncrease?: () => void,
  pulseMs = 800,
): { isPulsing: boolean } {
  const [prevBalance, setPrevBalance] = useState(balance)
  const [isPulsing, setIsPulsing] = useState(false)
  // Incremented on every increase so the pulse effect can restart its timer
  // even when `isPulsing` is already `true`.
  const [pulseNonce, setPulseNonce] = useState(0)
  const onIncreaseRef = useRef(onIncrease)

  // Keep the callback ref fresh without re-running the pulse effect when the
  // consumer passes a new inline function on unrelated re-renders.
  useEffect(() => {
    onIncreaseRef.current = onIncrease
  }, [onIncrease])

  // "Adjusting state when props change" (render phase) — detects increases
  // without a state-setting effect (react-hooks/set-state-in-effect). This is
  // the documented React pattern: setState during render is legal as long as
  // it's conditional, and the re-render converges because `prevBalance` is
  // updated in the same pass.
  if (balance !== undefined && prevBalance !== undefined && balance > prevBalance) {
    // Balance increased → pulse + restart timer
    setPrevBalance(balance)
    setIsPulsing(true)
    setPulseNonce((n) => n + 1)
  } else if (balance !== undefined && balance !== prevBalance) {
    // Balance decreased or changed → track the new base silently
    setPrevBalance(balance)
  }

  // Fire the callback and schedule the pulse end. Re-runs on a new increase
  // (nonce) so a rapid increase restarts the timer.
  useEffect(() => {
    if (!isPulsing) return

    onIncreaseRef.current?.()
    const timer = setTimeout(() => setIsPulsing(false), pulseMs)
    return () => clearTimeout(timer)
  }, [isPulsing, pulseMs, pulseNonce])

  return { isPulsing }
}
