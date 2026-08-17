"use client"

// Instala o piso global de fetch timeout no BROWSER: todo fetch sem signal
// explícito ganha AbortSignal.timeout(GLOBAL_FETCH_TIMEOUT_MS, default 60s).
// Signal explícito (envTimeoutSignal por chamada) VENCE. Idempotente.
//
// No client, env não-NEXT_PUBLIC não chega ao bundle → o valor efetivo é o
// fallback (60s). Para tunar por chamada, use envTimeoutSignal no init.
//
// O server instala o mesmo piso em src/instrumentation.ts (register()).
import { installGlobalFetchTimeoutFloor } from "./fetch-timeout"

installGlobalFetchTimeoutFloor()
