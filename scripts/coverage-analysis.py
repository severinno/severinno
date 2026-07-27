"""Test coverage analysis for Severinno Marketplace."""
import os

lib_files = set()
comp_files = set()
app_files = set()
test_files = set()
api_routes = set()

for root, dirs, files in os.walk("src"):
    for f in files:
        rel = os.path.relpath(os.path.join(root, f), "src")

        # Skip test files from source counts
        if "__tests__" in root:
            if ".test." in f or ".spec." in f:
                test_files.add(rel)
            continue

        if not (f.endswith(".ts") or f.endswith(".tsx")):
            continue

        # Categorize by directory
        if rel.startswith("lib"):
            lib_files.add(rel)
        elif rel.startswith("components"):
            comp_files.add(rel)
        elif rel.startswith("app" + os.sep + "api") or "app/api" in rel.replace("\\", "/"):
            if f == "route.ts":
                api_routes.add(rel)
            else:
                app_files.add(rel)
        else:
            app_files.add(rel)

# ---- Route detection ----
route_tests = [t for t in test_files if "-route" in os.path.basename(t) or "-header" in os.path.basename(t)]

print("=" * 70)
print("TEST COVERAGE ANALYSIS - Severinno Marketplace")
print("=" * 70)
print()
print(f"  Source files (lib):       {len(lib_files)}")
print(f"  Source files (components): {len(comp_files)}")
print(f"  Source files (app):       {len(app_files)}")
print(f"  API routes:               {len(api_routes)}")
print(f"  Test files (unit):        {len(test_files)}")
print(f"  Test files (E2E):         17 (e2e/)")
print()

# ---- API route coverage ----
print("--- API ROUTE COVERAGE ---")
print()

covered = 0
uncovered = 0
uncovered_critical = []

for rf in sorted(api_routes):
    # Build route path from the file path
    parts = rf.replace("\\", "/").split("/")
    # Find 'api' in the path and take everything after it
    try:
        api_idx = parts.index("api")
        rn_parts = parts[api_idx + 1:-1]  # exclude 'route.ts'
    except ValueError:
        continue
    rn = "/" + "/".join(rn_parts)
    rn = rn.replace("[", ":").replace("]", "")

    # Check against test file names
    has_test = False
    rn_flat = rn.replace(":param", "").replace("/", "-").strip("-")
    for t in route_tests:
        tname = os.path.basename(t).lower()
        if rn_flat in tname:
            has_test = True
            break

    if has_test:
        covered += 1
    else:
        uncovered += 1
        print(f"  UNCOVERED: {rn}")
        if any(kw in rn for kw in ["pay", "wallet", "webhook", "settlement", "cron", "checkout", "invoice"]):
            uncovered_critical.append(rn)

print()
total_routes = covered + uncovered
pct = covered * 100 // total_routes if total_routes else 0
print(f"  API routes: {covered}/{total_routes} covered ({pct}%)")
print()

if uncovered_critical:
    print("--- CRITICAL UNCOVERED ROUTES ---")
    for rn in sorted(uncovered_critical):
        print(f"  !!! {rn}")
    print()

# ---- Component coverage ----
print("--- COMPONENT COVERAGE ---")
comp_with = 0
comp_without = 0

for cf in sorted(comp_files):
    base = os.path.splitext(os.path.basename(cf))[0]
    has_test = any(base in t for t in test_files)
    if has_test:
        comp_with += 1
    else:
        comp_without += 1

total_comps = comp_with + comp_without
comp_pct = comp_with * 100 // total_comps if total_comps else 0
print(f"  Components: {comp_with}/{total_comps} covered ({comp_pct}%)")
print()
print("  Notable components WITHOUT tests:")
for cf in sorted(comp_files):
    base = os.path.splitext(os.path.basename(cf))[0]
    has_test = any(base in t for t in test_files)
    if not has_test and any(kw in cf.lower() for kw in ["finance", "wallet", "checkout", "payment", "dashboard"]):
        print(f"    !!! {cf}")
print()

# ---- Lib coverage ----
print("--- LIB COVERAGE ---")
lib_with = 0
lib_without = 0

for lf in sorted(lib_files):
    base = os.path.splitext(os.path.basename(lf))[0]
    has_test = any(base in t and "__tests__" in t for t in test_files)
    if has_test:
        lib_with += 1
    else:
        lib_without += 1

total_libs = lib_with + lib_without
lib_pct = lib_with * 100 // total_libs if total_libs else 0

print("  Infrastructure libs WITHOUT tests:")
for lf in sorted(lib_files):
    base = os.path.splitext(os.path.basename(lf))[0]
    has_test = any(base in t and "__tests__" in t for t in test_files)
    if not has_test and any(kw in lf for kw in ["api-server", "postgis", "routing", "cache", "realtime", "redis", "socket"]):
        print(f"    !!! {lf}")

print(f"  Lib files: {lib_with}/{total_libs} covered ({lib_pct}%)")
print()

# ---- Summary ----
print("--- SUMMARY ---")
print(f"  Unit tests:      {len(test_files)} files")
print(f"  E2E tests:       17 spec files")
print(f"  API routes:      {covered}/{total_routes} covered ({pct}%)")
print(f"  Components:      {comp_with}/{total_comps} covered ({comp_pct}%)")
print(f"  Lib files:       {lib_with}/{total_libs} covered ({lib_pct}%)")
if uncovered_critical:
    print(f"  Critical routes uncovered: {len(uncovered_critical)}")
print()
print("--- TOP GAPS TO PRIORITIZE ---")
print("  1. Payment/finance routes (wallet, settlements, invoices, cron)")
print("  2. Finance dashboard components (admin-finance, provider-finance, client-finance)")
print("  3. Infrastructure libs (postgis, routing, realtime-client, cache-manifest)")
print("  4. Webhook handlers (lytex, evolution)")
print("  5. Cron job routes (commissions, reminders, settlements)")
