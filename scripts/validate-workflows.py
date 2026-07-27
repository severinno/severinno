#!/usr/bin/env python3
"""
validate-workflows.py -- Validate all GitHub Actions workflow files.

Checks:
  1. YAML syntax -- every .github/workflows/*.yml must parse cleanly
  2. Uses: resolution -- every `uses: ./.github/workflows/<name>.yml` must
     point to an existing file that has `on: workflow_call`
  3. Orphaned workflows -- reusable workflows (on: workflow_call) that are
     defined but never referenced by any other workflow
  4. YAML anchors -- anchors defined (&name) must be referenced (*name), and
     references must point to an existing anchor

Usage:
    python3 scripts/validate-workflows.py           # validate all
    python3 scripts/validate-workflows.py --ci      # exit 1 on any issue
    python3 scripts/validate-workflows.py --verbose  # show passed checks too

Exit codes:
    0 -- all valid
    1 -- one or more issues found
"""

import os
import re
import sys
import yaml


# ── Settings ────────────────────────────────────────────────────────────

WORKFLOWS_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", ".github", "workflows")
)


# ── Helpers ─────────────────────────────────────────────────────────────

def get_workflow_files():
    """Return sorted list of *.yml workflow file paths."""
    if not os.path.isdir(WORKFLOWS_DIR):
        print("[ERROR] Workflows directory not found: " + WORKFLOWS_DIR)
        sys.exit(1)
    return sorted(
        os.path.join(WORKFLOWS_DIR, f)
        for f in os.listdir(WORKFLOWS_DIR)
        if f.endswith(".yml")
    )


def read_raw(path):
    """Read file bytes and return as string (lenient decoding)."""
    with open(path, "rb") as fh:
        raw = fh.read()
    return raw.decode("utf-8", errors="replace")


def collect_local_uses(raw, source_file=None):
    """Return set of local workflow paths referenced via 'uses:'.

    Skips references inside comments (lines starting with #).
    If source_file is given, also skips self-references.
    """
    refs = set()
    for line in raw.split("\n"):
        stripped = line.strip()
        # Strip inline comments (anything after #)
        if "#" in stripped:
            stripped = stripped[:stripped.index("#")].strip()
        if not stripped:
            continue
        m = re.search(r"uses:\s+\./\.github/workflows/([\w.-]+\.yml)", stripped)
        if m:
            ref_name = m.group(1)
            if source_file and ref_name == source_file:
                continue  # skip self-references from usage comments
            refs.add(ref_name)
    return refs


def has_workflow_call(parsed):
    """Return True if parsed YAML data has 'on: workflow_call'.

    GitHub Actions uses YAML 1.1, which treats bare 'on' as the
    boolean True.  PyYAML (default loader) follows this, so we
    must check BOTH the string key 'on' and the boolean key True.
    """
    if not isinstance(parsed, dict):
        return False
    # YAML 1.1: 'on:' is parsed as boolean True
    # Explicit None check avoids falsy-value fallthrough (e.g. empty dict {})
    on_val = parsed.get("on")
    if on_val is None:
        on_val = parsed.get(True)
    if on_val is None:
        return False
    if isinstance(on_val, str) and on_val == "workflow_call":
        return True
    if isinstance(on_val, dict) and "workflow_call" in on_val:
        return True
    return False


def collect_anchors(raw):
    """Return (defined, referenced) anchor name sets."""
    sep = r"(?=\s|:|$)"
    defined = set(re.findall(r"&(\w+)" + sep, raw))
    referenced = set(re.findall(r"\*(\w+)" + sep, raw))
    return defined, referenced


def find_orphaned_workflows(files_data, all_referenced):
    """Return set of reusable workflow filenames never referenced."""
    orphaned = set()
    for fname, parsed in files_data.items():
        if has_workflow_call(parsed) and fname not in all_referenced:
            orphaned.add(fname)
    return orphaned


# ── Main validation ────────────────────────────────────────────────────

def validate():
    verbose = "--verbose" in sys.argv
    ci_mode = "--ci" in sys.argv

    files = get_workflow_files()
    total = len(files)
    issues: list[str] = []
    parsed_data: dict[str, dict | None] = {}

    # --- Phase 1: Parse all files and collect metadata ---
    for fpath in files:
        fname = os.path.basename(fpath)
        raw = read_raw(fpath)

        try:
            parsed = yaml.safe_load(raw)
        except yaml.YAMLError as e:
            issues.append(f"[{fname}] YAML syntax error: {e}")
            parsed = None

        if parsed is None:
            issues.append(f"[{fname}] YAML parsed as null (empty or error)")
        elif not isinstance(parsed, dict):
            issues.append(f"[{fname}] YAML root is not a dict (got {type(parsed).__name__})")

        parsed_data[fname] = parsed if isinstance(parsed, dict) else None

    # --- Phase 2: Collect all 'uses:' references ---
    all_local_uses: set[str] = set()
    uses_by_file: dict[str, set[str]] = {}

    for fpath in files:
        fname = os.path.basename(fpath)
        raw = read_raw(fpath)
        uses = collect_local_uses(raw, fname)
        uses_by_file[fname] = uses
        all_local_uses.update(uses)

    # --- Phase 3: Resolve each 'uses:' reference ---
    for fname, uses in uses_by_file.items():
        for ref in uses:
            ref_path = os.path.join(WORKFLOWS_DIR, ref)
            if not os.path.exists(ref_path):
                issues.append(
                    f"[{fname}] uses: ./.github/workflows/{ref} --> FILE NOT FOUND"
                )
            else:
                ref_parsed = parsed_data.get(ref)
                if ref_parsed is None:
                    issues.append(
                        f"[{fname}] uses: ./.github/workflows/{ref} --> "
                        f"referenced file has YAML errors"
                    )
                elif not has_workflow_call(ref_parsed):
                    issues.append(
                        f"[{fname}] uses: ./.github/workflows/{ref} --> "
                        f"missing 'on: workflow_call'"
                    )
                elif verbose:
                    print(f"  [OK] [{fname}] uses: .../{ref} resolved")

    # --- Phase 4: Find orphaned reusable workflows ---
    orphaned = find_orphaned_workflows(parsed_data, all_local_uses)
    for o in sorted(orphaned):
        issues.append(f"[{o}] reusable workflow defined but never referenced")

    # --- Phase 5: Check YAML anchors ---
    for fpath in files:
        fname = os.path.basename(fpath)
        raw = read_raw(fpath)
        defined, referenced = collect_anchors(raw)
        unused = defined - referenced
        missing = referenced - defined
        if unused:
            issues.append(
                f"[{fname}] YAML anchors defined but never used: "
                + ", ".join(sorted(unused))
            )
        if missing:
            issues.append(
                f"[{fname}] YAML anchors referenced but never defined: "
                + ", ".join(sorted(missing))
            )
        if verbose and not unused and not missing and (defined or referenced):
            print(f"  [OK] [{fname}] anchors OK ({len(defined)} defined, {len(referenced)} referenced)")

    # --- Phase 6: Single final report ---
    passed = sum(1 for p in parsed_data.values() if p is not None)

    print(f"\n--- Summary ---")
    print(f"  Files scanned: {total}")
    print(f"  YAML valid:    {passed}/{total}")

    if issues:
        print(f"  Issues found:  {len(issues)}\n")
        for issue in issues:
            print(f"    * {issue}")
        print()
        if ci_mode:
            sys.exit(1)
    else:
        print(f"  Result:        All checks passed\n")

    # Also exit 1 even without --ci if there are issues (so scripts/tools can
    # check via exit code). Use --ci only for stricter exit-on-any-issue.
    # Without --ci, we still exit 1 but print a softer message.
    if issues:
        sys.exit(1)


if __name__ == "__main__":
    validate()
