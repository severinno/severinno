#!/bin/bash
# ============================================================================
# OSRM Data Setup — Governador Valadares / MG
# ============================================================================
# This script downloads OSM data for the region around Governador Valadares,
# processes it with OSRM extract/partition/customize, and places the
# resulting .osrm files in ./osrm-data/ ready for docker-compose.
#
# Uso:
#   chmod +x scripts/setup-osrm.sh && bash scripts/setup-osrm.sh
#
# Pré-requisitos:
#   - Docker instalado
#   - osmium-tool instalado (apt install osmium-tool / brew install osmium-tool)
#   - ~2 GB de espaço livre em disco
# ============================================================================

set -euo pipefail

OSRM_IMAGE="ghcr.io/project-osrm/osrm-backend:latest"
DATA_DIR="./osrm-data"
OSM_URL="https://download.geofabrik.de/south-america/brazil/sudeste-latest.osm.pbf"
OSM_FILE="sudeste-latest.osm.pbf"
GV_FILE="governador-valadares.osm.pbf"
GV_OSRM="governador-valadares.osrm"

# Bounding box for Governador Valadares region (approx 80km radius)
# Covers: Governador Valadares, Coroaci, São João do Oriente, etc.
BBOX="-42.15,-19.05,-41.55,-18.65"

echo "=== OSRM Data Setup — Governador Valadares / MG ==="
echo ""

# Check prerequisites
if ! command -v osmium &> /dev/null; then
  echo "❌ osmium-tool is required but not installed."
  echo ""
  echo "   Install it with one of:"
  echo "     apt install osmium-tool        (Debian/Ubuntu)"
  echo "     brew install osmium-tool       (macOS)"
  echo "     choco install osmium-tool      (Windows)"
  echo ""
  echo "   Alternatively, use a pre-clipped extract from:"
  echo "     https://extract.bbbike.org/"
  echo "     https://protomaps.com/extracts"
  echo ""
  echo "   After downloading, place the .osm.pbf file in $DATA_DIR/"
  echo "   named '$GV_FILE' and re-run this script."
  exit 1
fi

# Create data directory
mkdir -p "$DATA_DIR"

# Step 1: Download Sudeste Brazil extract
if [ ! -f "$DATA_DIR/$OSM_FILE" ]; then
  echo "📥 Downloading Sudeste Brazil OSM extract..."
  echo "   URL: $OSM_URL"
  wget -c "$OSM_URL" -O "$DATA_DIR/$OSM_FILE" --progress=dot:giga
  echo "   ✅ Download complete"
else
  echo "   ✅ $OSM_FILE already exists, skipping download"
fi

# Step 2: Clip to Governador Valadares bounding box
if [ ! -f "$DATA_DIR/$GV_FILE" ]; then
  echo "✂️  Clipping to Governador Valadares region (bbox: $BBOX)..."
  osmium extract \
    --bbox "$BBOX" \
    --output "$DATA_DIR/$GV_FILE" \
    --overwrite \
    "$DATA_DIR/$OSM_FILE"
  echo "   ✅ Clipped with osmium"
else
  echo "   ✅ $GV_FILE already exists"
fi

# Step 3: OSRM Extract (convert OSM → OSRM)
echo "🔧 Running osrm-extract..."
docker run --rm -t \
  -v "$(pwd)/$DATA_DIR:/data" \
  "$OSRM_IMAGE" \
  osrm-extract \
  -p /opt/car.lua \
  --location-dependent-data /opt/names/osrmnames.names \
  /data/"$GV_FILE"

echo "   ✅ osrm-extract complete"

# Step 4: OSRM Partition (MLD)
echo "🔧 Running osrm-partition..."
docker run --rm -t \
  -v "$(pwd)/$DATA_DIR:/data" \
  "$OSRM_IMAGE" \
  osrm-partition \
  /data/"$GV_OSRM"

echo "   ✅ osrm-partition complete"

# Step 5: OSRM Customize (MLD)
echo "🔧 Running osrm-customize..."
docker run --rm -t \
  -v "$(pwd)/$DATA_DIR:/data" \
  "$OSRM_IMAGE" \
  osrm-customize \
  /data/"$GV_OSRM"

echo "   ✅ osrm-customize complete"

# Step 6: Cleanup — remove the large regional file
echo "🧹 Cleaning up..."
rm -f "$DATA_DIR/$OSM_FILE"
echo "   ✅ Removed regional extract"

echo ""
echo "🎉 OSRM data ready!"
echo ""
echo "▶️  Start OSRM server:"
echo "   docker compose -f docker-compose.dev.yml --profile routing up -d osrm"
echo ""
echo "🧪 Test route:"
echo '   curl "http://localhost:5000/route/v1/driving/-41.9736,-19.8125;-41.9481,-18.8505?overview=full&geometries=geojson"'
echo ""
