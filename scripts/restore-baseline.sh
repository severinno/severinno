#!/usr/bin/env bash
# =============================================================================
# restore-baseline.sh
#
# Emergency recovery: downloads the last known-good benchmark artifact from
# GitHub Actions and restores it as the local baseline.  Useful when an
# invalid baseline is accidentally committed to main.
#
# Prerequisites:
#   - GitHub CLI (`gh`) authenticated, OR
#   - `curl` + `GITHUB_TOKEN` (or `GH_TOKEN`) environment variable
#
# Usage:
#   bash scripts/restore-baseline.sh --type geo           # restore geo-baseline.json
#   bash scripts/restore-baseline.sh --type cache         # restore cache-baseline.json
#   bash scripts/restore-baseline.sh --type geo --dry-run # preview without writing
#
# Flags:
#   --type <t>     Benchmark type: geo or cache (required).
#   --dry-run      Print what would be done without writing files.
#   --run-id <n>   Use a specific workflow run ID instead of the latest.
#   --token <s>    GitHub token (default: $GITHUB_TOKEN or $GH_TOKEN).
#
# Exit codes:
#   0 - baseline restored
#   1 - error (missing dependencies, no artifact found, etc.)
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$PROJECT_DIR/docs/benchmarks"

WORKFLOW_NAME="PR Check"
ARTIFACT_NAME_PREFIX="geo-benchmark"

declare -A BASELINE_FILES
BASELINE_FILES[geo]="geo-baseline.json"
BASELINE_FILES[cache]="cache-baseline.json"

declare -A ARTIFACT_NAMES
ARTIFACT_NAMES[geo]="geo-benchmark"
ARTIFACT_NAMES[cache]="cache-benchmark"  # fallback - cache artifact may use different name

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

TYPE=""
DRY_RUN=false
RUN_ID=""
TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --type)
      TYPE="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --run-id)
      RUN_ID="$2"
      shift 2
      ;;
    --token)
      TOKEN="$2"
      shift 2
      ;;
    *)
      echo "[FAIL] Unknown flag: $1"
      echo "Usage: bash scripts/restore-baseline.sh --type geo|cache [--dry-run] [--run-id <n>] [--token <s>]"
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

if [[ -z "$TYPE" ]]; then
  echo "[FAIL] --type is required. Usage: bash scripts/restore-baseline.sh --type geo|cache"
  exit 1
fi

if [[ -z "${BASELINE_FILES[$TYPE]:-}" ]]; then
  echo "[FAIL] Unknown type '$TYPE'. Available: ${!BASELINE_FILES[*]}"
  exit 1
fi

BASELINE_FILE="${BASELINE_FILES[$TYPE]}"
ARTIFACT_NAME="${ARTIFACT_NAMES[$TYPE]}"

# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------

HAVE_GH=false
HAVE_CURL=false

if command -v gh &>/dev/null; then
  HAVE_GH=true
fi

if command -v curl &>/dev/null; then
  HAVE_CURL=true
fi

if ! command -v jq &>/dev/null; then
  echo "[FAIL] 'jq' is required for JSON parsing. Install it via your package manager."
  echo "   https://jqlang.github.io/jq/"
  exit 1
fi

if ! $HAVE_GH && ! $HAVE_CURL; then
  echo "[FAIL] Neither 'gh' (GitHub CLI) nor 'curl' is available."
  echo "   Install gh: https://cli.github.com/"
  echo "   Or set GITHUB_TOKEN and ensure curl is installed."
  exit 1
fi

if ! $HAVE_GH && [[ -z "$TOKEN" ]]; then
  echo "[FAIL] curl mode requires GITHUB_TOKEN or GH_TOKEN environment variable."
  echo "   Or install the GitHub CLI (gh) for tokenless authentication."
  exit 1
fi

# Validate --run-id if provided
if [[ -n "$RUN_ID" ]] && ! [[ "$RUN_ID" =~ ^[0-9]+$ ]]; then
  echo "[FAIL] --run-id must be a positive integer, got: $RUN_ID"
  exit 1
fi

# ---------------------------------------------------------------------------
# Resolve repository
# ---------------------------------------------------------------------------

REPO=""
if $HAVE_GH; then
  REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || true)
fi

if [[ -z "$REPO" ]]; then
  # Fallback: extract from git remote
  REPO=$(git -C "$PROJECT_DIR" remote get-url origin 2>/dev/null | sed -E 's|.*github\.com[:/]([^/]+/[^/.]+)(\.git)?$|\1|' || true)
fi

if [[ -z "$REPO" ]]; then
  echo "[FAIL] Could not determine GitHub repository."
  echo "   Set GITHUB_REPOSITORY environment variable, or run from a git clone."
  exit 1
fi

echo "  [i]  Repository: $REPO"
echo "  [i]  Type:       $TYPE"
echo "  [i]  Artifact:   $ARTIFACT_NAME"
echo "  [i]  Target:     $OUT_DIR/$BASELINE_FILE"
[[ -n "$RUN_ID" ]] && echo "  [i]  Run ID:     $RUN_ID"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Find the workflow run
# ---------------------------------------------------------------------------

if [[ -z "$RUN_ID" ]]; then
  echo "  --- Finding latest successful '$WORKFLOW_NAME' run ---"
  echo ""

  RUN_JSON=""
  if $HAVE_GH; then
    RUN_JSON=$(gh run list \
      --workflow "$WORKFLOW_NAME" \
      --branch main \
      --status success \
      --limit 1 \
      --json databaseId,headBranch,createdAt \
      2>/dev/null || true)
  else
    # URL-encode the workflow name for the API query parameter
    ENCODED_WORKFLOW=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$WORKFLOW_NAME'))" 2>/dev/null || echo "PR%20Check")
    RUN_JSON=$(curl -sfL \
      -H "Authorization: token $TOKEN" \
      -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/$REPO/actions/workflows/$ENCODED_WORKFLOW/runs?branch=main&status=success&per_page=1" \
      2>/dev/null | head -c 4096 || true)
  fi

  if [[ -z "$RUN_JSON" ]] || [[ "$RUN_JSON" == "[]" ]] || [[ "$RUN_JSON" == "null" ]]; then
    echo "[FAIL] No successful '$WORKFLOW_NAME' runs found on main."
    echo "   Try --run-id <n> to specify a specific run."
    exit 1
  fi

  if $HAVE_GH; then
    RUN_ID=$(echo "$RUN_JSON" | jq -r '.[0].databaseId')
    echo "  [OK] Found run #$RUN_ID ($(echo "$RUN_JSON" | jq -r '.[0].createdAt' | head -c 10))"
  else
    RUN_ID=$(echo "$RUN_JSON" | jq -r '.workflow_runs[0].id')
    echo "  [OK] Found run #$RUN_ID ($(echo "$RUN_JSON" | jq -r '.workflow_runs[0].createdAt' | head -c 10))"
  fi
  echo ""
fi

# ---------------------------------------------------------------------------
# Step 2: Download the artifact
# ---------------------------------------------------------------------------

echo "  --- Downloading '$ARTIFACT_NAME' artifact from run #$RUN_ID ---"
echo ""

TMP_DIR=$(mktemp -d)
TMP_ARCHIVE="$TMP_DIR/artifact.zip"

if $DRY_RUN; then
  echo "  [dry-run] Would download artifact from run #$RUN_ID"
  echo "  [dry-run] Would extract to: $OUT_DIR/$BASELINE_FILE"
  echo ""
  echo "  [OK] Dry-run complete. No files written."
  rm -rf "$TMP_DIR"
  exit 0
fi

DOWNLOAD_OK=false
if $HAVE_GH; then
  echo "  Using gh CLI..."
  if gh run download "$RUN_ID" --name "$ARTIFACT_NAME" --dir "$TMP_DIR" 2>/dev/null; then
    # Verify that gh actually produced files
    if [[ -n "$(find "$TMP_DIR" -name '*.json' -type f 2>/dev/null | head -1)" ]]; then
      DOWNLOAD_OK=true
    else
      echo "  [!]  gh download reported success but no JSON files found - falling back to curl"
    fi
  fi
fi

if ! $DOWNLOAD_OK && $HAVE_CURL; then
  echo "  Using curl + API..."

  # Get the artifact ID from the run
  ARTIFACT_ID=""
  ARTIFACT_JSON=$(curl -sfL \
    -H "Authorization: token $TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$REPO/actions/runs/$RUN_ID/artifacts?name=$ARTIFACT_NAME&per_page=1" \
    2>/dev/null || true)

  if [[ -n "$ARTIFACT_JSON" ]]; then
    ARTIFACT_ID=$(echo "$ARTIFACT_JSON" | jq -r '.artifacts[0].id // empty')
  fi

  if [[ -z "$ARTIFACT_ID" ]]; then
    echo "[FAIL] No artifact named '$ARTIFACT_NAME' found in run #$RUN_ID."
    echo "   Available artifacts:"
    curl -sfL \
      -H "Authorization: token $TOKEN" \
      -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/$REPO/actions/runs/$RUN_ID/artifacts?per_page=20" \
      2>/dev/null | jq -r '.artifacts[]?.name // "none"' | sed 's/^/     - /'
    rm -rf "$TMP_DIR"
    exit 1
  fi

  echo "  Artifact ID: $ARTIFACT_ID"

  # Download the artifact zip
  curl -sfL \
    -H "Authorization: token $TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -L -o "$TMP_ARCHIVE" \
    "https://api.github.com/repos/$REPO/actions/artifacts/$ARTIFACT_ID/zip" \
    2>/dev/null || {
    echo "[FAIL] Failed to download artifact."
    rm -rf "$TMP_DIR"
    exit 1
  }

  if [[ -f "$TMP_ARCHIVE" ]] && [[ -s "$TMP_ARCHIVE" ]]; then
    DOWNLOAD_OK=true
  fi
fi

if ! $DOWNLOAD_OK; then
  echo "[FAIL] Failed to download artifact using any available method."
  rm -rf "$TMP_DIR"
  exit 1
fi

echo "  [OK] Artifact downloaded (size: $(du -h "$TMP_ARCHIVE" 2>/dev/null | cut -f1 || echo '?'))"

# ---------------------------------------------------------------------------
# Step 3: Extract the baseline file
# ---------------------------------------------------------------------------

if [[ -f "$TMP_ARCHIVE" ]]; then
  # The artifact contains geo-latest.json (or cache-latest.json)
  # We rename it to the baseline filename
  EXTRACTED=$(unzip -l "$TMP_ARCHIVE" 2>/dev/null | grep -E '\.json$' | head -1 | awk '{print $NF}')
  unzip -o "$TMP_ARCHIVE" -d "$TMP_DIR" >/dev/null 2>&1
  echo "  Extracted: $EXTRACTED"
fi

# Find the JSON file inside the extracted artifact
EXTRACTED_FILE=$(find "$TMP_DIR" -name '*.json' -type f 2>/dev/null | head -1)

if [[ -z "$EXTRACTED_FILE" ]]; then
  echo "[FAIL] No JSON file found in the artifact."
  echo "   Artifact contents:"
  ls -la "$TMP_DIR" 2>/dev/null || true
  rm -rf "$TMP_DIR"
  exit 1
fi

echo "  Extracted: $(basename "$EXTRACTED_FILE") ($(du -h "$EXTRACTED_FILE" | cut -f1))"

# Validate the JSON
if ! jq empty "$EXTRACTED_FILE" 2>/dev/null; then
  echo "[FAIL] Extracted file is not valid JSON. Aborting."
  rm -rf "$TMP_DIR"
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 4: Backup and restore
# ---------------------------------------------------------------------------

mkdir -p "$OUT_DIR"

if [[ -f "$OUT_DIR/$BASELINE_FILE" ]]; then
  BACKUP="$OUT_DIR/$BASELINE_FILE.restore-backup"
  cp "$OUT_DIR/$BASELINE_FILE" "$BACKUP"
  echo "  Backup saved: $BACKUP"
fi

cp "$EXTRACTED_FILE" "$OUT_DIR/$BASELINE_FILE"
echo "  [OK] Restored: $OUT_DIR/$BASELINE_FILE"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
echo "  --- Summary ---------------------------------------------------"
echo "  Repository:  $REPO"
echo "  Workflow:    $WORKFLOW_NAME"
echo "  Run #:       $RUN_ID"
echo "  Artifact:    $ARTIFACT_NAME"
echo "  Restored:    $OUT_DIR/$BASELINE_FILE"
echo "  Benchmarks:  $(jq '.benchmarks | length' "$EXTRACTED_FILE") entries"
echo "  Timestamp:   $(jq -r '.meta.timestamp // "unknown"' "$EXTRACTED_FILE")"
echo ""

# Cleanup
rm -rf "$TMP_DIR"

echo "  [OK] Baseline restored. Run the next CI comparison to verify."
