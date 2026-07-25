/**
 * Next.js 16.2.11 renamed InstantConfigForTypeCheckInternal → PrefetchForTypeCheckInternal
 * but the type generator still references the old name.
 * This augmentation bridges the gap so the build type-check passes.
 */
import type { PrefetchForTypeCheckInternal } from "next/dist/build/segment-config/app/app-segment-config"

declare module "next/dist/build/segment-config/app/app-segment-config.js" {
  export type InstantConfigForTypeCheckInternal = PrefetchForTypeCheckInternal
}
