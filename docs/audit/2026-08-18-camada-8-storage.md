# Auditoria — Camada 8: Storage (S3/R2 + Fallback Local)

**Data:** 2026-08-18
**Auditor:** Buffy (Codebuff)
**Status Geral:** 🟢 Saudável (Multi-provider with graceful fallback)

---

## Resumo Executivo

A camada de storage é **bem projetada** com suporte a S3-compatible (Cloudflare R2, MinIO, AWS S3), upload com validação, compressão client-side de imagens, e fallback local graceful. Identificadas **0 vulnerabilidades P0**, **1 melhoria P1** e **2 melhorias P2/P3**.

---

## Itens Verificados

### 1. S3 Client (`s3.ts`)

- ✅ **Singleton**: `getS3Client()` cria cliente lazy com retry
- ✅ **Multi-provider**: R2, MinIO, AWS S3
- ✅ **Credentials**: `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_ENDPOINT`, `S3_BUCKET` via env
- ✅ **Path style**: `forcePathStyle` desabilitado para R2 (virtual-hosted), habilitado para MinIO
- ✅ **Timeout**: 30s para uploads
- ✅ **Content-Type detection**: `guessContentType()` por extensão

### 2. Upload Operations

- ✅ **`uploadToS3()`**: Buffer → S3 com prefixo configurável
- ✅ **Filename sanitization**: `/[^a-zA-Z0-9._-]/g → _`
- ✅ **Key format**: `{prefix}{timestamp}-{sanitizedName}`
- ✅ **ACL**: `public-read` como default
- ✅ **URL construction**: `NEXT_PUBLIC_UPLOADS_BASE_URL` ou fallback
- ✅ **`uploadBase64()`**: Data URL → Buffer → S3
- ✅ **Error handling**: Log + throw com mensagem amigável

### 3. Delete Operations

- ✅ **`deleteFromS3()`**: Remove objeto por key
- ✅ **Error handling**: Log sem throw (best-effort)

### 4. Signed URLs

- ✅ **`getSignedUrlForObject()`**: URL temporária com expiração (default 3600s)
- ✅ **Presigner**: `@aws-sdk/s3-request-presigner` (optional import)
- ✅ **Graceful**: Erro claro se presigner não instalado

### 5. List Objects

- ✅ **`listObjects()`**: Lista até 100 objetos por prefixo
- ✅ **Returns**: key, size, lastModified, etag

### 6. Upload Route (`/api/upload`)

- ✅ **Auth**: `requireUser()` — apenas usuários autenticados
- ✅ **Rate limit**: 10/min (conservador para uploads pesados)
- ✅ **File size**: Max 10MB (configurável via `MAX_UPLOAD_SIZE`)
- ✅ **MIME validation**: Whitelist de 8 tipos (images, PDF, DOC, DOCX)
- ✅ **Error responses**: 400 (missing file), 413 (too large), 415 (wrong type)
- ✅ **GET endpoint**: Retorna info sobre tipos e limites permitidos

### 7. Client-Side Image Compression (`client-image-compressor.ts`)

- ✅ **WebP conversion**: Compressão 10-15MB → ~200KB
- ✅ **Canvas API**: createImageBitmap + canvas.toBlob
- ✅ **Proportional resize**: Max 1920x1920 mantendo aspect ratio
- ✅ **Quality**: 0.82 default (configurável)
- ✅ **Graceful fallback**: Retorna original se canvas não disponível
- ✅ **Metrics**: `computeCompressionMetrics()` estima savings

### 8. Image Optimization (Next.js)

- ✅ **Formats**: AVIF e WebP
- ✅ **Device sizes**: 640, 750, 828, 1080, 1200, 1920
- ✅ **Remote patterns**: MinIO, severinno.com.br, R2, Cloudflare, Gravatar, UI Avatars, Picsum, Pravatar

### 9. Docker MinIO

- ✅ **Pinned version**: `minio/minio:RELEASE.2024-12-18T13-15-44Z`
- ✅ **Healthcheck**: `curl -f http://localhost:9000/minio/health/live`
- ✅ **Init container**: `minio-init` cria bucket automaticamente
- ✅ **Console**: Porta 9001 para admin UI
- ✅ **Resource limits**: 0.5 CPU, 512MB

### 10. Fallback Behavior

- ✅ **`storage.ts`**: Fallback local quando S3 não configurado
- ✅ **`s3.ts`**: Erros de upload logados e re-throw com mensagem amigável
- ✅ **Client compressor**: Retorna original se Canvas não disponível

---

## Findings Detalhados

### F-001: Upload não valida extensão do arquivo vs Content-Type

- **Severidade:** P1 (Atenção)
- **Camada:** 8
- **Descrição:** A rota `/api/upload` valida `Content-Type` MIME mas não valida a extensão do arquivo. Um arquivo com extensão `.exe` mas Content-Type `image/jpeg` passaria. O `guessContentType()` no S3 usa extensão para detectar, mas o upload não valida extensão vs MIME consistency.
- **Impacto**: Upload de arquivos maliciosos com MIME spoofing
- **Recomendação:** Adicionar validação de extensão (whitelist de extensões permitidas) além do MIME
- **Esfroço:** 1h

### F-002: `storage.ts` e `s3.ts` são dois módulos sobrepostos

- **Severidade:** P2 (Melhoria)
- **Camada:** 8
- **Descrição:** Existem dois módulos de storage: `s3.ts` (completo, com upload/delete/signed URLs) e `storage.ts` (simplificado, com fallback local). Ambos fazem upload para S3 mas com APIs diferentes.
- **Impacto**: Confusão sobre qual módulo usar, código duplicado
- **Recomendação:** Consolidar em um único módulo (`s3.ts`) e remover `storage.ts`
- **Esfroço:** 2h

### F-003: Signed URLs não têm validação de path traversal

- **Severidade:** P3 (Baixa)
- **Camada:** 8
- **Descrição:** `getSignedUrlForObject(key)` aceita qualquer key sem validação. Se um usuário malicioso passar `../../etc/passwd` como key, o S3 retornaria 403 (inexistente), mas o endpoint não valida antes de gerar a URL.
- **Impacto**: Baixo — S3 retorna 403 para keys inexistentes
- **Recomendação:** Validar key contra pattern `^[a-zA-Z0-9._-]+$` antes de gerar URL
- **Esfroço:** 0.5h

---

## Resumo por Prioridade

### P0 (Imediato)

- Nenhum finding P0 identificado

### P1 (Próxima sprint)

1. **F-001:** Adicionar validação de extensão no upload

### P2 (Backlog)

2. **F-002:** Consolidar s3.ts e storage.ts

### P3 (Melhoria contínua)

3. **F-003:** Validar key em signed URLs

---

## Estatísticas

| Métrica            | Valor                                  |
| ------------------ | -------------------------------------- |
| Storage providers  | 3 (R2, MinIO, S3)                      |
| Upload operations  | 3 (uploadToS3, uploadBase64, GET info) |
| Allowed MIME types | 8                                      |
| Max file size      | 10MB (configurable)                    |
| Client compression | WebP, max 1920x1920, quality 0.82      |

## Padrões Positivos

1. **Multi-provider**: R2, MinIO, S3 com fallback automático
2. **Client compression**: WebP conversion antes de upload (10MB → 200KB)
3. **Upload validation**: Auth + rate limit + size + MIME
4. **Filename sanitization**: Previne path traversal e caracteres especiais
5. **Docker MinIO**: Pinned version, healthcheck, auto bucket init
6. **Graceful fallback**: Canvas não disponível → upload original
7. **Signed URLs**: Com expiração configurável
8. **Image optimization**: AVIF/WebP via Next.js Image component
