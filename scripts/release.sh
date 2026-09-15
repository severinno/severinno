#!/usr/bin/env bash
# =============================================================================
# release.sh — version bump, changelog generation, and git tag
#
# Usage:
#   ./scripts/release.sh               # show current version and help
#   ./scripts/release.sh patch          # 0.2.0 → 0.2.1
#   ./scripts/release.sh minor          # 0.2.0 → 0.3.0
#   ./scripts/release.sh major          # 0.2.0 → 1.0.0
#   ./scripts/release.sh minor cache    # 0.2.0 → 0.3.0-cache
#   ./scripts/release.sh --dry-run patch  # show what would happen
#
# Exit codes:
#   0 — release created successfully
#   1 — error (invalid args, dirty working tree, etc.)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PACKAGE_JSON="$PROJECT_DIR/package.json"

# ── Parse args ──────────────────────────────────────────────────────────────

DRY_RUN=false
BUMP=""
SUFFIX=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    major|minor|patch) BUMP="$arg" ;;
    *) SUFFIX="$arg" ;;
  esac
done

# ── Help / current version ──────────────────────────────────────────────────

CURRENT_VERSION=$(grep '"version"' "$PACKAGE_JSON" | sed 's/.*: "//;s/".*//')
CURRENT_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "(no tag)")

if [ -z "$BUMP" ]; then
  echo "Severinno Release Script"
  echo ""
  echo "  Current version: v$CURRENT_VERSION"
  echo "  Last tag:        $CURRENT_TAG"
  echo ""
  echo "Usage:"
  echo "  ./scripts/release.sh <bump> [suffix] [--dry-run]"
  echo ""
  echo "Bump:  patch | minor | major"
  echo "Suffix: optional tag suffix (e.g. 'cache' → v0.3.0-cache)"
  echo ""
  echo "Examples:"
  echo "  ./scripts/release.sh patch          # v0.2.1"
  echo "  ./scripts/release.sh minor cache    # v0.3.0-cache"
  echo "  ./scripts/release.sh --dry-run patch  # preview only"
  exit 0
fi

# ── Validate working tree ───────────────────────────────────────────────────

if [ -n "$(git status --porcelain)" ]; then
  echo "❌ Working tree is dirty. Commit or stash changes first."
  exit 1
fi

# ── Bump version ────────────────────────────────────────────────────────────

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

case "$BUMP" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"

if [ -n "$SUFFIX" ]; then
  TAG="v${NEW_VERSION}-${SUFFIX}"
else
  TAG="v${NEW_VERSION}"
fi

echo "🔖 Release: v$CURRENT_VERSION → $TAG"
echo ""

# ── Generate changelog ──────────────────────────────────────────────────────

LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || true)

if [ -n "$LAST_TAG" ]; then
  LOG_RANGE="${LAST_TAG}..HEAD"
  echo "Changes since $LAST_TAG:"
else
  LOG_RANGE="HEAD"
  echo "Changes (initial release):"
fi

CHANGELOG=$(git log "$LOG_RANGE" --oneline --no-decorate 2>/dev/null | \
  sed 's/^[0-9a-f]\{7,9\} //' | \
  sed 's/^/  /')

if [ -z "$CHANGELOG" ]; then
  CHANGELOG="  (no new commits)"
fi

echo "$CHANGELOG"
echo ""

# ── Tag stats ───────────────────────────────────────────────────────────────

TS_COUNT=$(find src/ -name '*.ts' -o -name '*.tsx' 2>/dev/null | wc -l)
TEST_COUNT_UNIT=$(npx vitest run --reporter=verbose 2>/dev/null | grep "Tests" | tail -1 | grep -o '[0-9]* passed' | grep -o '[0-9]*' || echo "?")
E2E_COUNT="160 (5 browsers)"

echo "---"
echo "  Version:    $TAG"
echo "  TypeScript: $TS_COUNT files"
echo "  Unit tests: $TEST_COUNT_UNIT"
echo "  E2E:        $E2E_COUNT"
echo ""

# ---- Apply changes ----------------------------------------------------------

CHANGELOG_FILE="$PROJECT_DIR/CHANGELOG.md"

if $DRY_RUN; then
  echo "⚠️  DRY-RUN — no changes made"
  echo "  Would update package.json version to: $NEW_VERSION"
  echo "  Would create tag: $TAG"
  echo "  Would write: CHANGELOG.md"
  exit 0
fi

# Update package.json
# Detect GNU sed vs BSD sed (macOS)
if grep -q GNU <<< "$(sed --version 2>/dev/null)"; then
  SED_INLINE=(-i)
else
  SED_INLINE=(-i '')
fi

sed "${SED_INLINE[@]}" "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" "$PACKAGE_JSON"
echo "  + package.json: v$CURRENT_VERSION -> v$NEW_VERSION"

# Prepend new entry to CHANGELOG.md
if [ -f "$CHANGELOG_FILE" ]; then
  EXISTING=$(cat "$CHANGELOG_FILE")
else
  EXISTING=""
fi
{
  echo "# Changelog"
  echo ""
  echo "## $TAG ($(date +%Y-%m-%d))"
  echo ""
  echo "$CHANGELOG"
  echo ""
  if [ -n "$EXISTING" ]; then
    # Strip existing header to avoid duplication
    echo "$EXISTING" | tail -n +3
  fi
} > "$CHANGELOG_FILE"
echo "  + CHANGELOG.md written"

# Stage and commit both files together
git add "$PACKAGE_JSON" "$CHANGELOG_FILE"
git commit -m "chore: bump version to $TAG"
echo "  + Committed version bump + changelog"

# Create tag
git tag -a "$TAG" -m "Release $TAG"
echo "  + Created tag: $TAG"

echo ""
echo "========================================="
echo "  Release $TAG created successfully!"
echo ""
echo "  To push:"
echo "    git push origin main --tags"
echo "========================================="
