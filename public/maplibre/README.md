# MapLibre worker servido pelo app

Estes arquivos são **copiados automaticamente** de `node_modules/maplibre-gl/dist/`
pelo `scripts/sync-maplibre-worker.mjs` (hook `postinstall`). **Não edite manualmente.**

- `maplibre-gl-worker.js` — worker standalone do MapLibre (import do shared
  reescrito de `.mjs` para `.js`).
- `maplibre-gl-shared.js` — chunk compartilhado importado pelo worker.
- `VERSION.txt` — versão do `maplibre-gl` de origem.

Por quê: em dev (Turbopack) e alguns deploys, o `import.meta.url` usado pelo
MapLibre para derivar a URL do worker é reescrito e o fallback blob falha
silenciosamente (mapa sem tiles). `src/lib/maplibre-worker.ts` aponta
`maplibreConfig.WORKER_URL` para `/maplibre/maplibre-gl-worker.js`.

CSP: `worker-src 'self' blob:` já cobre (`src/lib/csp.ts`).

Para atualizar após um upgrade do maplibre-gl:

```bash
node scripts/sync-maplibre-worker.mjs
```

O CI roda o mesmo comando com `--check` e falha se os arquivos desalinharem.
