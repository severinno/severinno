import os

main = r'C:\PROJETOS\severinno'

# Update ci.yml
ci_path = os.path.join(main, '.github', 'workflows', 'ci.yml')
with open(ci_path, 'r', encoding='utf-8') as f:
    ci = f.read()

# Replace utf8-check job with workflow_call reference
# Use the marker comment before "  # Tests" to find the right spot
marker_ci = "  # Tests"
idx_start = ci.find("  # UTF-8 Encoding Check")
idx_end = ci.find(marker_ci)
assert idx_start != -1 and idx_end != -1, "ci.yml: markers not found"

old_block = ci[idx_start:idx_end]
new_block = """  # UTF-8 Encoding Check ----------------------------------------------------
  # Reusable via .github/workflows/utf8-check.yml
  utf8-check:
    uses: ./.github/workflows/utf8-check.yml

  # Tests"""

ci = ci[:idx_start] + new_block + ci[idx_end:]
with open(ci_path, 'w', encoding='utf-8') as f:
    f.write(ci)
print("ci.yml updated")

# Update pr-check.yml
pr_path = os.path.join(main, '.github', 'workflows', 'pr-check.yml')
with open(pr_path, 'r', encoding='utf-8') as f:
    pr = f.read()

marker_pr = "  # Main PR Check"
idx_start = pr.find("  # UTF-8 Encoding Check")
idx_end = pr.find(marker_pr)
assert idx_start != -1 and idx_end != -1, "pr-check.yml: markers not found"

old_block = pr[idx_start:idx_end]
new_block = """  # UTF-8 Encoding Check ----------------------------------------------------
  # Fast gate: <10s, no dependencies beyond python3 (pre-installed on runners).
  # Reusable via .github/workflows/utf8-check.yml
  utf8-check:
    uses: ./.github/workflows/utf8-check.yml

  # Main PR Check"""

pr = pr[:idx_start] + new_block + pr[idx_end:]
with open(pr_path, 'w', encoding='utf-8') as f:
    f.write(pr)
print("pr-check.yml updated")

# Update e2e-cache.yml
e2e_path = os.path.join(main, '.github', 'workflows', 'e2e-cache.yml')
with open(e2e_path, 'r', encoding='utf-8') as f:
    e2e = f.read()

marker_e2e = "  e2e-cache:"
idx_start = e2e.find("  # UTF-8 Encoding Check")
idx_end = e2e.find(marker_e2e)
assert idx_start != -1 and idx_end != -1, "e2e-cache.yml: markers not found"

old_block = e2e[idx_start:idx_end]
new_block = """  # UTF-8 Encoding Check ----------------------------------------------------
  # Fast gate: <10s, no dependencies beyond python3 (pre-installed on runners).
  # Reusable via .github/workflows/utf8-check.yml
  utf8-check:
    uses: ./.github/workflows/utf8-check.yml

  e2e-cache:"""

e2e = e2e[:idx_start] + new_block + e2e[idx_end:]
with open(e2e_path, 'w', encoding='utf-8') as f:
    f.write(e2e)
print("e2e-cache.yml updated")

print("\nAll 3 workflows updated!")
