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

export {
  createMockRequest,
  parseResponse,
  type MockRequestOptions,
} from "./helpers/api-test-utils"

export {
  expectCacheHeaders,
  expectPrivateCacheHeaders,
  expectNoCacheHeaders,
} from "./helpers/cache-test-utils"

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
