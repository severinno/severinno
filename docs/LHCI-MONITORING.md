# Lighthouse CI — Flake Monitoring Runbook

The Lighthouse CI workflow (`lighthouse-ci.yml`) is now a **release gate**: on
`v*` tags it runs via `workflow_call` from `release-deploy.yml` (desktop +
mobile matrix) and the docker build only fires with green Core Web Vitals on
the 3 public routes. The LCP error thresholds were calibrated against real
runs (see the CALIBRATION comment in the workflow), but a **shared GitHub
runner has more CPU/network noise than the local machine** — so the first ~10
CI executions must be monitored before we trust the gate to be stable.

## 1. Monitor the first 10 executions

Use the monitor script — it downloads the last N runs of BOTH workflows
(`lighthouse-ci.yml` for push-to-main/PR, `release-deploy.yml` for the v*
release runs where LHCI runs via workflow_call), aggregates the per-URL runs,
and compares the 5 CWV metrics against the lighthouserc thresholds:

```bash
gh auth login                                   # one-time
node scripts/lhci-monitor.mjs --fetch 10        # last 10 runs
node scripts/lhci-monitor.mjs --fetch 10 --quiet
```

The `--branch` filter (default `main`) applies **only to `lighthouse-ci.yml`**
runs. `release-deploy.yml` runs are always fetched without a branch filter,
because tag-triggered runs have `head_branch: null` in the GitHub API — a
branch filter would silently exclude exactly the v* release runs this monitor
exists to watch.

Run it after every few CI executions. The verdict semantics match `lhci
assert` (which asserts on the **representative run** = median performance
score per URL):

| Verdict | Meaning |
|---|---|
| `GATE-FAIL` | representative run above an ERROR limit — the gate **would have failed** |
| `SPIKE` | an individual run over the limit, representative OK — gate passed, early flake evidence |
| `NEAR` | per-URL max within `--margin` % (default 20) of an ERROR limit — risk zone |

Exit codes: `0` no gate-fail · `1` gate-fail found (usable as a gate) · `2`
no reports found.

> **Local note:** `lhci autorun` locally may fail with `NO_FCP` on this
> Windows session (headless Chrome cannot paint under Lighthouse — proven
> environmental, not the app). The monitor's `--fetch` mode reads the CI
> artifacts instead, so it is unaffected.

## 2. Current risk (calibrated 2026-08-07)

Desktop headroom measured from 9 real runs of the current build (3/URL):
`med` is the per-URL median, `max` the worst run, `headroom` = `(limit −
max)/limit`.

| URL | metric | limit | median | max | headroom | risk |
|---|---|---|---|---|---|---|
| `/` | LCP (error) | 4.50s | 2.24s | 2.86s | +36% | OK |
| `/` | TBT (warn) | 1.50s | 0.75s | 1.19s | +21% | **tightest** |
| `/` | SI (warn) | 6.00s | 3.23s | 4.37s | +27% | tight |
| `/` | CLS (error) | 0.25 | 0.089 | 0.089 | +64% | OK |
| `/categoria/limpeza` | LCP (error) | 4.50s | 1.00s | 1.09s | +76% | OK |
| `/categoria/limpeza` | TBT (warn) | 1.50s | 0.04s | 0.12s | +92% | OK |
| `/u/carlos-encanador` | LCP (error) | 4.50s | 0.78s | 1.04s | +77% | OK |
| `/u/carlos-encanador` | TBT (warn) | 1.50s | 0.02s | 0.12s | +92% | OK |

**Desktop analysis:** the ERROR gates (LCP 4.5s, CLS 0.25) have +36% or better
headroom — low flake risk. The tightest desktop metric is **TBT on `/`** at
+21%, but TBT is a **warn**-level assertion (1500ms), so it cannot fail the
gate — it only adds noise to the log.

**Mobile (provisional):** thresholds were calibrated against 2 runs of a
**pre-ISR** build (LCP 4.67s / TBT 998ms worst case). The current build (ISR +
lazy-map + hero) should be faster, but CI noise is unknown. **Mobile is the
most likely to flake** — LCP error 5500ms has only ~15% margin over the stale
baseline ((5500−4670)/5500 = 15.1%). The first green mobile leg on the current
build must be measured and the limits re-tightened.

## 3. Decision rule (after ~10 CI executions)

Count GATE-FAILs, SPIKEs and NEARs across the 10 runs:

- **≥1 GATE-FAIL** on the same metric/URL → the gate is flaking → **apply
  mitigation now**.
- **≥2 SPIKEs** on the same metric/URL (gate passed but runs exceeded) →
  flake evidence on a 3-run median → **apply mitigation now**.
- **≥3 NEARs** on the same metric/URL → the metric lives in the risk zone →
  **prepare mitigation** (apply at the next release).
- Otherwise → thresholds are holding; keep monitoring each 5–10 runs and
  re-run after any meaningful perf change.

## 4. Mitigations (apply in order, verify with the monitor after each)

### M1 — `numberOfRuns: 3 → 5` (median stability)

The most effective and lowest-cost fix: a median of 5 runs is far more stable
than a median of 3 on a noisy runner. Edit **both** configs:

- `lighthouserc.json` → `ci.collect.numberOfRuns: 3` → `5`
- `lighthouserc.mobile.json` → same

Cost: 9 → 15 audits per leg (~+67% CI time per leg, still inside the 45-min
timeout). Verify: `node scripts/lhci-monitor.mjs --fetch 10` → fewer SPIKEs.

### M2 — Consistent network/CPU throttling (verify-only)

Both configs already use deterministic **simulate** throttling (`settings`
→ `throttlingMethod: "simulate"`; desktop preset also sets it). Network is
simulated, so the dominant noise source is **CPU contention on the shared
runner** (desktop runs at `cpuSlowdownMultiplier: 1`). No code change needed —
but if you want it explicit, add to both configs' `settings`:

```json
"throttlingMethod": "simulate",
"throttling": {
  "rttMs": 40,
  "throughputKbps": 10240,
  "cpuSlowdownMultiplier": 1
}
```

### M3 — Larger runner `ubuntu-latest-4-cores` (CPU headroom)

Directly attacks the dominant flake source (CPU contention). Edit
`lighthouse-ci.yml`:

```yaml
    runs-on: ubuntu-latest-4-cores
```

(one line in the `lhci` job — applies to both matrix legs). Requires GitHub
**larger runners to be enabled + billed** on the org; verify availability
before relying on it. Cheapest flake fix if M1 is not enough.

## 5. Re-tightening (after the gate is stable)

Once the gate is green and stable on the current build:

- Re-measure mobile: `node scripts/lhci-monitor.mjs --fetch 10 --quiet`
- If actual headroom is comfortably > 30%, tighten the thresholds in
  `lighthouserc.mobile.json` (e.g. LCP 5500 → 5000, TBT 1200 → 1000) so the
  gate catches real regressions instead of only gross ones.
- Update the CALIBRATION comment in `lighthouse-ci.yml` with the new numbers.
