"use client";

/**
 * ProvidersMap — MapLibre GL map of provider markers + user location.
 *
 * SSR-safe: MapLibre is imported lazily inside a `useEffect` (so the component
 * itself can be statically imported, e.g. by `next/dynamic`). Tiles are
 * OpenStreetMap raster tiles (attribution required).
 */

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { formatDistance } from "@/lib/geo-client";
import type { ProviderCard } from "@/lib/api";
import { logger } from "@/lib/logger";

type Props = {
  providers: ProviderCard[];
  userLat?: number | null;
  userLng?: number | null;
  onSelectProvider?: (id: string) => void;
  selectedId?: string | null;
  className?: string;
};

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';

// Default center: São Paulo (used when no markers and no user location)
const SP_DEFAULT: [number, number] = [-46.6333, -23.5505];

type MapInstance = InstanceType<typeof import("maplibre-gl").Map>;
type MarkerInstance = InstanceType<typeof import("maplibre-gl").Marker>;
type PopupInstance = InstanceType<typeof import("maplibre-gl").Popup>;

export default function ProvidersMap({
  providers,
  userLat,
  userLng,
  onSelectProvider,
  selectedId,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapInstance | null>(null);
  // Mutable marker/popup registry — kept outside React state for perf
  const markersRef = useRef<Record<string, { marker: MarkerInstance; popup: PopupInstance }>>({});
  const userMarkerRef = useRef<MarkerInstance | null>(null);

  // ---- Initialize map once -------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      const maplibregl = await import("maplibre-gl");
      await import("maplibre-gl/dist/maplibre-gl.css");
      if (cancelled || !containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: [OSM_TILES],
              tileSize: 256,
              attribution: OSM_ATTRIBUTION,
              maxzoom: 19,
            },
          },
          layers: [
            {
              id: "osm-tiles",
              type: "raster",
              source: "osm",
              paint: { "raster-opacity": 1 },
            },
          ],
        },
        center: SP_DEFAULT,
        zoom: 12,
        attributionControl: { compact: true },
      });

      map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
      map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

      mapRef.current = map;

      const onIdle = () => fitToBounds(map, providers, userLat, userLng);
      map.on("load", onIdle);
      // Also fit when markers change before "load" fired
      window.setTimeout(() => fitToBounds(map, providers, userLat, userLng), 50);

      cleanup = () => {
        map.remove();
        mapRef.current = null;
        markersRef.current = {};
        userMarkerRef.current = null;
      };
    })().catch((err) => {
      logger.error("ProvidersMap — falha ao inicializar", undefined, err);
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // Map must be initialised only once — props are synced by the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Sync providers → markers -------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (cancelled || map !== mapRef.current) return;
      syncProviderMarkers({
        map,
        maplibregl,
        providers,
        selectedId,
        onSelectProvider,
        markersRef,
      });
      fitToBounds(map, providers, userLat, userLng);
    })();

    return () => {
      cancelled = true;
    };
  }, [providers, selectedId, userLat, userLng, onSelectProvider]);

  // ---- Sync user location marker ------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (cancelled || map !== mapRef.current) return;
      syncUserMarker({
        map,
        maplibregl,
        lat: userLat,
        lng: userLng,
        userMarkerRef,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [userLat, userLng]);

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-xl border bg-muted",
        "h-[400px] md:h-full",
        className,
      )}
      aria-label="Mapa de prestadores"
      role="application"
    >
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fitToBounds(
  map: MapInstance,
  providers: ProviderCard[],
  userLat?: number | null,
  userLng?: number | null,
) {
  const points: [number, number][] = [];
  for (const p of providers) {
    if (typeof p.lat === "number" && typeof p.lng === "number") {
      points.push([p.lng, p.lat]);
    }
  }
  if (typeof userLat === "number" && typeof userLng === "number") {
    points.push([userLng, userLat]);
  }
  if (points.length === 0) return;
  if (points.length === 1) {
    map.setCenter(points[0]);
    map.setZoom(14);
    return;
  }
  // [minX, minY, maxX, maxY] = [west, south, east, north]
  let west = points[0][0];
  let south = points[0][1];
  let east = points[0][0];
  let north = points[0][1];
  for (const [lng, lat] of points) {
    if (lng < west) west = lng;
    if (lat < south) south = lat;
    if (lng > east) east = lng;
    if (lat > north) north = lat;
  }
  const pad = 0.005; // ~500m
  const bounds: [[number, number], [number, number]] = [
    [west - pad, south - pad],
    [east + pad, north + pad],
  ];
  try {
    map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 600 });
  } catch {
    // ignore
  }
}

type MarkerRef = { marker: MarkerInstance; popup: PopupInstance };

function syncProviderMarkers(opts: {
  map: MapInstance;
  maplibregl: typeof import("maplibre-gl");
  providers: ProviderCard[];
  selectedId?: string | null;
  onSelectProvider?: (id: string) => void;
  markersRef: React.RefObject<Record<string, MarkerRef>>;
}) {
  const { map, maplibregl, providers, selectedId, onSelectProvider, markersRef } = opts;
  const registry = markersRef.current ?? {};

  // Remove markers for providers no longer in the list
  for (const [id, ref] of Object.entries(registry)) {
    if (!providers.some((p) => p.id === id)) {
      ref.marker.remove();
      delete registry[id];
    }
  }

  for (const provider of providers) {
    if (typeof provider.lat !== "number" || typeof provider.lng !== "number") {
      continue;
    }
    const existing = registry[provider.id];
    const isSelected = selectedId === provider.id;

    if (existing) {
      // Update selected state styling only
      const el = existing.marker.getElement();
      el.dataset.selected = isSelected ? "true" : "false";
      continue;
    }

    // Build a custom HTML marker
    const el = document.createElement("button");
    el.type = "button";
    el.className = "vitrine-map-marker";
    el.dataset.selected = isSelected ? "true" : "false";
    el.dataset.verified = provider.verified ? "true" : "false";
    el.setAttribute("aria-label", `Ver ${provider.name} no mapa`);
    el.style.cssText = `
      display: flex; align-items: center; gap: 6px;
      padding: 4px 8px 4px 6px;
      border-radius: 9999px;
      border: 1px solid rgba(255,255,255,0.85);
      background: var(--primary);
      color: var(--primary-foreground);
      font-size: 12px; font-weight: 600; line-height: 1;
      box-shadow: 0 4px 12px -2px rgba(0,0,0,0.25);
      cursor: pointer;
      transform: translate(-50%, -100%);
      transition: transform 120ms ease, box-shadow 120ms ease;
    `;

    const star = document.createElement("span");
    star.textContent = "★";
    star.style.color = "#facc15";
    el.appendChild(star);

    const rating = document.createElement("span");
    rating.textContent = provider.rating > 0 ? `${provider.rating.toFixed(1)}` : "Novo";
    el.appendChild(rating);

    const sep = document.createElement("span");
    sep.textContent = "·";
    sep.style.opacity = "0.6";
    el.appendChild(sep);

    const price = document.createElement("span");
    const min = provider.services?.[0]?.basePrice;
    price.textContent = typeof min === "number" ? `a partir de ${formatBRL(min)}` : "Ver";
    el.appendChild(price);

    el.addEventListener("click", (e) => {
      e.stopPropagation();
      onSelectProvider?.(provider.id);
    });

    el.addEventListener("mouseenter", () => {
      el.style.transform = "translate(-50%, -100%) scale(1.06)";
    });
    el.addEventListener("mouseleave", () => {
      el.style.transform = "translate(-50%, -100%) scale(1)";
    });

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 18,
      className: "map-popup",
      maxWidth: "260px",
    }).setHTML(
      `<div class="p-3 text-sm">
        <div class="font-semibold leading-tight">${escapeHtml(provider.name)}</div>
        <div class="mt-1 flex items-center gap-2 text-muted-foreground text-xs">
          <span>★ ${provider.rating.toFixed(1)} (${provider.reviewCount})</span>
          ${provider.city ? `<span>·</span><span>${escapeHtml(provider.city ?? "")}</span>` : ""}
          ${
            typeof provider.distanceKm === "number"
              ? `<span>·</span><span>${formatDistance(provider.distanceKm)}</span>`
              : ""
          }
        </div>
        ${provider.verified ? `<div class="mt-1 text-[11px] font-medium text-primary">✓ Verificado</div>` : ""}
      </div>`,
    );

    const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([provider.lng, provider.lat])
      .setPopup(popup)
      .addTo(map);

    el.addEventListener("mouseenter", () => popup.addTo(map));
    el.addEventListener("mouseleave", () => popup.remove());

    registry[provider.id] = { marker, popup };
  }

  markersRef.current = registry;
}

function syncUserMarker(opts: {
  map: MapInstance;
  maplibregl: typeof import("maplibre-gl");
  lat?: number | null;
  lng?: number | null;
  userMarkerRef: React.RefObject<MarkerInstance | null>;
}) {
  const { map, maplibregl, lat, lng, userMarkerRef } = opts;
  // Remove existing marker
  if (userMarkerRef.current) {
    userMarkerRef.current.remove();
    userMarkerRef.current = null;
  }
  if (typeof lat !== "number" || typeof lng !== "number") return;

  const el = document.createElement("div");
  el.setAttribute("aria-label", "Sua localização");
  el.style.cssText = `
    width: 18px; height: 18px;
    border-radius: 9999px;
    background: #2563eb;
    border: 3px solid white;
    box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.25), 0 2px 8px rgba(0,0,0,0.25);
    position: relative;
  `;
  const pulse = document.createElement("span");
  pulse.style.cssText = `
    position: absolute; inset: -6px;
    border-radius: 9999px;
    border: 2px solid rgba(37, 99, 235, 0.55);
    animation: vitrine-map-pulse 1.6s ease-out infinite;
  `;
  el.appendChild(pulse);

  const marker = new maplibregl.Marker({ element: el, anchor: "center" })
    .setLngLat([lng, lat])
    .addTo(map);
  userMarkerRef.current = marker;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Inject keyframes for the user pulse + selected marker (once, on module load)
if (typeof document !== "undefined") {
  const id = "vitrine-map-pulse-keyframes";
  if (!document.getElementById(id)) {
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      @keyframes vitrine-map-pulse {
        0%   { transform: scale(0.6); opacity: 0.9; }
        100% { transform: scale(2.0); opacity: 0; }
      }
      .vitrine-map-marker[data-selected="true"] {
        z-index: 10 !important;
        box-shadow: 0 0 0 4px color-mix(in oklch, var(--primary) 35%, transparent),
                    0 6px 18px -2px rgba(0,0,0,0.35) !important;
        transform: translate(-50%, -100%) scale(1.08) !important;
      }
      .vitrine-map-marker[data-verified="false"] {
        background: var(--muted-foreground);
      }
    `;
    document.head.appendChild(style);
  }
}
