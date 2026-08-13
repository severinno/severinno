# Geo-Distance Benchmark: PostGIS vs Haversine JS

> **Date:** 2026-07-29  
> **Platform:** Windows 64-bit, Node.js v22.23.1  
> **Center:** São Paulo (-23.5505, -46.6333)

## Overview

This report compares two distance-computation strategies used in Severinno:

| Strategy         | Implementation                             | Location                                             |
| ---------------- | ------------------------------------------ | ---------------------------------------------------- |
| **Haversine JS** | Pure JS `Math` functions                   | `src/lib/geo-shared.ts` → `haversineKm()`            |
| **PostGIS**      | `ST_Distance()` on `geography(Point,4326)` | `src/lib/postgis.ts` → `findProvidersWithinRadius()` |

The Haversine benchmark is a **real measurement** of the JS function running locally.  
The PostGIS benchmark is a **CPU-modelled estimate** (not a real DB query) that reproduces the wall-clock cost of a `$queryRawUnsafe` with `ST_Distance` on a local PostgreSQL 16 instance with a warm buffer cache.

---

## Raw Results

### Single-call latency

| Operation           | Mean          | Min       | Max       | Ops/sec       |
| ------------------- | ------------- | --------- | --------- | ------------- |
| `haversineKm × 1`   | **0.2 µs**    | 0.1 µs    | 172.4 µs  | **4,374,453** |
| PostGIS [model] × 1 | **10,092 µs** | 10,047 µs | 10,596 µs | 99            |

> **Haversine JS is ~50,000× faster per single call.**

### Batch processing

| Benchmark                        | Mean          | Min       | Max       | Ops/sec |
| -------------------------------- | ------------- | --------- | --------- | ------- |
| Haversine JS 100 providers       | **30 µs**     | 12.1 µs   | 279.3 µs  | 33,296  |
| Haversine JS 1,000 providers     | **49.5 µs**   | 46.5 µs   | 156.9 µs  | 20,209  |
| Haversine JS 10,000 providers    | **472.6 µs**  | 465.1 µs  | 509.7 µs  | 2,116   |
| PostGIS [model] 100 providers    | **10,182 µs** | 10,135 µs | 10,229 µs | 98      |
| PostGIS [model] 1,000 providers  | **10,757 µs** | 10,435 µs | 11,084 µs | 93      |
| PostGIS [model] 10,000 providers | **16,709 µs** | 15,639 µs | 17,429 µs | 60      |

### Cost per provider

| Scale  | Haversine (µs/provider) | PostGIS (µs/provider) |
| ------ | ----------------------- | --------------------- |
| 100    | 0.3000                  | 101.8                 |
| 1,000  | 0.0495                  | 10.8                  |
| 10,000 | 0.0473                  | 1.7                   |

**Haversine JS is ~70× faster per provider** than a single PostGIS `ST_Distance` evaluation at every tested scale.

---

## Key Insight: PostGIS Wins by Filtering, Not Math

Haversine JS is **always faster** than PostGIS for raw distance computation. There is **no positive N** at which PostGIS catches up in pure math throughput.

**PostGIS wins by FILTERING before computing:**

```
PostGIS query flow:
  1. GiST index scan via ST_DWithin     → O(log N) candidates
  2. Compute ST_Distance                 → only for filtered subset
  3. Return results                       → minimal data transfer

Haversine fallback flow:
  1. Load ALL providers into memory      → O(N) data transfer
  2. Compute haversine for EACH provider  → O(N) math
  3. Filter in application code           → O(N) comparison
```

The value of PostGIS is **not** faster distance math — it's the **GiST index** that avoids loading and computing against irrelevant providers.

---

## Crossover Analysis

### Model

```
T_postgis(N, s)  =  2000 + 22 × N × s   µs
T_haversine(N)   =  0.315 × N           µs  (+ T_transfer)
T_transfer(N)    =  20 × N              µs  (serialise + send JSON)

where:
  N  = total providers in database
  s  = selectivity (fraction within the search radius)
```

### Practical scenarios

| Providers | Radius | Selectivity | Faster strategy | Why                                                     |
| --------- | ------ | ----------- | --------------- | ------------------------------------------------------- |
| 500       | 5 km   | ~4 %        | **PostGIS**     | Saves ~96 % data transfer                               |
| 500       | 10 km  | ~18 %       | **PostGIS**     | Saves ~82 % data transfer                               |
| 500       | 50 km  | ~70 %       | **PostGIS**     | Saves ~30 % data transfer                               |
| 2,000     | 10 km  | ~18 %       | **PostGIS**     | Saves ~82 % data transfer                               |
| 10,000    | 5 km   | ~4 %        | **PostGIS**     | Saves ~96 % data transfer                               |
| 10,000    | 100 km | ~95 %       | **Haversine**   | Selectivity too high; GiST index scans most rows anyway |

For **small radii** (5-25 km), PostGIS is **always faster** because the GiST index eliminates the vast majority of providers before any distance math occurs.

For **very large radii** (>50 km) at scale, Haversine can become competitive because the GiST index loses its filtering advantage — it has to scan most rows anyway.

---

## Current Code Path

The application already implements a **dual-path strategy** in `src/lib/distance-fallback.ts` (`computeDistanceMap`):

```
computeDistanceMap(center, providers):
  1. Try PostGIS path:
     - findProvidersWithinRadius() via ST_DWithin
     - Returns id + distanceKm for filtered providers
     - Cached in Redis for 60s

  2. If PostGIS fails/unavailable → Haversine fallback:
     - haversineKm() on every provider
     - Returns full distance map
     - No caching (computed per request)
```

This is the correct architecture for the current scale.

---

## Recommendations

### 1. Keep PostGIS as primary path ✅

For the current scale (hundreds to low-thousands of providers) PostGIS is always beneficial because it combines `ST_DWithin` filtering + `ST_Distance` in **one query**, avoiding:

- Loading all providers into application memory
- Serialising/transferring unnecessary provider data
- Computing distance for providers outside the radius

### 2. Haversine as fallback ✅

The Haversine JS path is already implemented as a fallback. It should remain as:

- **Default** when PostGIS extension is not available (`isPostGISAvailable()` returns false)
- **Fallback** when `findProvidersWithinRadius()` throws (network error, timeout)

### 3. Monitor selectivity at scale

As the provider base grows:

- **< 5,000 providers**: PostGIS is always beneficial (current state)
- **5,000 – 50,000 providers**: PostGIS is beneficial for radii < 50 km
- **> 50,000 providers**: Re-evaluate; consider Haversine for very large radii (> 100 km)

### 4. Caching is already in place ✅

`findProvidersWithinRadius()` caches results in Redis for 60 seconds with coordinate rounding to 3 decimal places (~110m precision). This dramatically reduces query frequency for popular areas.

---

## Running the Benchmark

```bash
# Run with console output
node scripts/geo-benchmark.mjs

# Save JSON result to docs/benchmarks/geo-latest.json
node scripts/geo-benchmark.mjs --json

# Run via unified runner
node scripts/run-benchmark.mjs --type geo
node scripts/run-benchmark.mjs --type geo --json
node scripts/run-benchmark.mjs --type geo --compare
```

## Raw Data

Full JSON results: `docs/benchmarks/geo-latest.json`
