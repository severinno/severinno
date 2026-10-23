// Ponto de entrada do runtime CLIENTE, auto-carregado pelo Next.js (convenção
// `instrumentation-client.ts`, estável desde o 15). O `sentry.client.config.ts`
// chama `Sentry.init` quando o DSN público existe, mas NINGUÉM o importava — e
// o `withSentryConfig` não é usado (decisão do GlitchTip self-hosted, ver
// next.config.ts). Sem este arquivo, o rastreio de erros no CLIENTE nunca
// inicia: o servidor rastreia (lib/sentry + instrumentation.ts) e o navegador
// fica cego para os erros que só acontecem lá.
import "./sentry.client.config"
