/**
 * Barrel file — maintained for convenience, but prefer direct imports
 * (e.g. `import { useAuthStore } from "@/store/auth"`) for better tree-shaking.
 */
export { useAuthStore, type AuthUser, type UserRole } from "./auth"
export { useGeoStore, type GeoStatus } from "./geo"
export { useViewStore, type ViewParams } from "./view"
export {
  useUIStore,
  type AuthModalMode,
  type AuthModalRole,
} from "./ui"
export { useRecentlyViewedStore } from "./recently-viewed"
export { useCompareStore, MAX_COMPARE } from "./compare"
