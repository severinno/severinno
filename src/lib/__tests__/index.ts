/**
 * index.ts
 *
 * Barrel export for test utility helpers under src/lib/__tests__/.
 *
 * Provides a single entry point for importing shared test utilities:
 *
 *   Functions:
 *     fuzz-utils           — seeded PRNG, fuzz generators, validators
 *     api-test-utils       — createMockRequest, parseResponse
 *     cache-test-utils     — expectCacheHeaders, expectNoCacheHeaders
 *     crlf-git-fixture     — makeRepo/commitCrlfFile/commitLfFile/blobHasCr
 *                            (fixture git temporário com blobs CRLF/LF)
 *
 * Test files should import from this barrel instead of reaching into
 * implementation modules directly, keeping the public API surface
 * explicit and making future refactoring easier.
 *
 * @example
 * ```ts
 * import {
 *   seededRandom, pick,
 *   createMockRequest, parseResponse,
 *   expectCacheHeaders, expectNoCacheHeaders,
 * } from "@/lib/__tests__"
 * ```
 */

export {
  seed,
  setSeed,
  seededRandom,
  randFloat,
  randInt,
  pick,
  fuzzLat,
  fuzzLng,
  fuzzRadius,
  fuzzCategoryIds,
  fuzzQuery,
  validateCacheKey,
  fuzzRadiusValue,
  validateRadii,
} from "./fuzz-utils"

export { createMockRequest, parseResponse, type MockRequestOptions } from "./helpers/api-test-utils"

export {
  expectCacheHeaders,
  expectPrivateCacheHeaders,
  expectNoCacheHeaders,
} from "./helpers/cache-test-utils"

export {
  makeRepo,
  cleanupTmpDirs,
  commitCrlfFile,
  commitLfFile,
  writeGitattributes,
  blobHasCr,
} from "./helpers/crlf-git-fixture"

// Re-export from the vitrine barrel instead of reaching into
// the implementation module directly.
export {
  mockGeoStore,
  mockFetchGeoSearch,
  mockFetchReverseGeo,
  getMockToast,
  resetCommonMocks,
  MOCK_RESULTS,
  flushDebounce,
} from "../../components/vitrine/__tests__"
