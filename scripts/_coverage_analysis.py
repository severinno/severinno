import os

# Collect source files
lib_files, comp_files, app_files, test_files = set(), set(), set(), set()
api_routes = set()

for root, dirs, files in os.walk("src"):
    for f in files:
        rel = os.path.relpath(os.path.join(root, f), "src")
        if "__tests__" in root:
            if ".test." in f or ".spec." in f:
                test_files.add(rel)
            continue
        if root.endswith("__tests__"):
            continue
        if f.endswith(".ts") or f.endswith(".tsx"):
            if "lib" in root:
                lib_files.add(rel)
            elif "components" in root:
                comp_files.add(rel)
            elif "app" in root and "/api/" not in root and not root.endswith("/api"):
                app_files.add(rel)
            if f == "route.ts" and "/api/" in root:
                api_routes.add(rel)

# API route test coverage
route_tests = [t for t in test_files if "-route" in os.path.basename(t) or "-header" in os.path.basename(t)]

print("=" * 70)
print("TEST COVERAGE ANALYSIS - Severinno Marketplace")
print("=" * 70)
print()
print(f"Source files (lib):       {len(lib_files)}")
print(f"Source files (components): {len(comp_files)}")
print(f"Source files (app):       {len(app_files)}")
print(f"API routes:               {len(api_routes)}")
print(f"Test files (unit):        {len([t for t in test_files])}")
print(f"Test files (E2E):         17 (e2e/)")
print()
print("--- API ROUTE COVERAGE ---")
print()

covered, uncovered = 0, 0
uncovered_critical = []

for rf in sorted(api_routes):
    rn = rf.replace("\\", "/").replace("src/app/api/", "/").replace("/route.ts", "")
    rn = rn.replace("[", ":").replace("]", "")
    has_test = False
    for t in route_tests:
        tname = os.path.basename(t).lower()
        rparts = rn.replace(":param", "").replace("/", "-")
        last = rn.split("/")[-1].replace(":param", "")
        if rparts in tname or (last in tname and "route" in tname):
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
print(f"API routes: {covered}/{len(api_routes)} covered ({covered*100//len(api_routes)}%)")
print()
print("--- CRITICAL UNCOVERED ROUTES ---")
for rn in sorted(uncovered_critical):
    print(f"  !!! {rn}")
print()

# Component coverage
print("--- COMPONENT COVERAGE ---")
comp_with, comp_without = 0, 0
comp_no_test = []
for cf in sorted(comp_files):
    base = os.path.splitext(os.path.basename(cf))[0]
    has_test = any(base in t for t in test_files)
    if has_test:
        comp_with += 1
    else:
        comp_without += 1
        comp_no_test.append(cf)

print(f"Components: {comp_with}/{comp_with + comp_without} covered")
print()
print("  Notable components WITHOUT tests:")
for cf in comp_no_test:
    if any(kw in cf.lower() for kw in ["finance", "wallet", "checkout", "payment", "dashboard"]):
        print(f"    !!! {cf}")
print()

# Lib coverage
print("--- LIB COVERAGE ---")
lib_with, lib_without = 0, 0
lib_no_test = []
for lf in sorted(lib_files):
    base = os.path.splitext(os.path.basename(lf))[0]
    has_test = any(base in t and "__tests__" in t for t in test_files)
    if has_test:
        lib_with += 1
    else:
        lib_without += 1
        lib_no_test.append(lf)

print(f"Lib files: {lib_with}/{lib_with + lib_without} covered")
print()
print("  Lib files WITHOUT tests:")
for lf in lib_no_test:
    if any(kw in lf for kw in ["api-server", "postgis", "routing", "cache", "realtime", "redis", "socket"]):
        print(f"    !!! {lf}")
print()
print("--- SUMMARY ---")
print(f"  Unit tests:      {len(test_files)} files")
print(f"  E2E tests:       17 spec files (160 tests across 5 browsers)")
print(f"  API routes:      {covered}/{len(api_routes)} covered ({covered*100//len(api_routes)}%)")
print(f"  Components:      {comp_with}/{comp_with + comp_without} covered ({comp_with*100//max(1,comp_with+comp_without)}%)")
print(f"  Lib files:       {lib_with}/{lib_with + lib_without} covered ({lib_with*100//max(1,lib_with+lib_without)}%)")
print(f"  Critical routes uncovered: {len(uncovered_critical)}")
print()
print("--- TOP GAPS TO PRIORITIZE ---")
print("  1. Payment/finance routes (wallet, settlements, invoices)")
print("  2. Finance dashboard components (admin-finance, provider-finance, client-finance)")
print("  3. Infrastructure libs (postgis, routing, realtime-client, cache-manifest)")
print("  4. Webhook handlers (lytex, evolution)")
print("  5. Cron job routes (commissions, reminders, settlements)")
