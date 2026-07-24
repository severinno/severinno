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

import * as React from "react"

export function useBalancePulse(
  balance: number | undefined,
  onIncrease?: () => void,
  pulseMs = 800,
): { isPulsing: boolean } {
  const prevRef = React.useRef(balance)
  const [isPulsing, setIsPulsing] = React.useState(false)

  React.useEffect(() => {
    if (balance === undefined) return

    const prev = prevRef.current

    if (prev !== undefined && balance > prev) {
      // Balance increased → pulse
      setIsPulsing(true)
      onIncrease?.()
      const timer = setTimeout(() => setIsPulsing(false), pulseMs)
      prevRef.current = balance
      return () => clearTimeout(timer)
    }

    if (prev !== undefined && balance < prev) {
      // Balance decreased → update ref silently
      prevRef.current = balance
      return
    }

    prevRef.current = balance
  }, [balance, onIncrease, pulseMs])

  return { isPulsing }
}
