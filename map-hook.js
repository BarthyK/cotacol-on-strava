// Runs in the PAGE's own JS context (world: "MAIN") on strava.com/maps/*
// and strava.com/routes/*, injected at document_start.
//
// Strava's Route Builder is Mapbox GL JS under the hood, and -- usefully --
// Strava exposes a public global for getting at the live map instance:
// window.strava.maps.getMap(). (Confirmed by reading the actual StatsHunters
// extension source, which uses the same call as its primary path.) Once we
// have the map instance, we use Mapbox GL's own standard API
// (addSource/addLayer with a GeoJSON source) to draw Cotacol's hill lines --
// these calls go straight into Strava's real map, no shadow overlay needed.

(function () {
  const NS = "cotacol-strava";
  const SOURCE_ID = "cotacol-hills";
  const START_ID = "cotacol-hills-start";
  const END_ID = "cotacol-hills-end";
  const FLAG_IMAGE = "cotacol-flag-icon";
  let map = null;
  let linesById = {}; // keep the last-sent set so click lookups work
  let lastLines = null; // reapply after style reloads (e.g. satellite toggle)

  function toLineFeatureCollection(lines) {
    linesById = {};
    for (const l of lines) linesById[l.id] = l;
    return {
      type: "FeatureCollection",
      features: lines.map((l) => ({
        type: "Feature",
        id: l.id,
        properties: { id: l.id, name: l.name, color: l.color },
        geometry: {
          type: "MultiLineString",
          coordinates: l.paths.map((path) => path.map(([lat, lng]) => [lng, lat])),
        },
      })),
    };
  }

  function toEndpointFeatureCollection(lines, end) {
    return {
      type: "FeatureCollection",
      features: lines.map((l) => {
        const path = end === "start" ? l.paths[0] : l.paths[l.paths.length - 1];
        const [lat, lng] = end === "start" ? path[0] : path[path.length - 1];
        return {
          type: "Feature",
          id: `${l.id}-${end}`,
          properties: { id: l.id, name: l.name, color: l.color },
          geometry: { type: "Point", coordinates: [lng, lat] },
        };
      }),
    };
  }

  function makeFlagIcon() {
    // Small checkered-flag pattern drawn on an offscreen canvas, registered
    // as a Mapbox image so it can be used in a symbol layer's icon-image.
    const size = 18;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#222222";
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2.5, 0, Math.PI * 2);
    ctx.clip();
    const cell = 4;
    for (let y = 0; y < size; y += cell) {
      for (let x = 0; x < size; x += cell) {
        const isDark = (Math.round(x / cell) + Math.round(y / cell)) % 2 === 0;
        ctx.fillStyle = isDark ? "#111111" : "#ffffff";
        ctx.fillRect(x, y, cell, cell);
      }
    }
    ctx.restore();

    return ctx.getImageData(0, 0, size, size);
  }

  function ensureFlagImage() {
    if (map.hasImage && map.hasImage(FLAG_IMAGE)) return;
    const img = makeFlagIcon();
    map.addImage(FLAG_IMAGE, { width: img.width, height: img.height, data: img.data });
  }

  function addLayerNow() {
    if (!map) return false;
    try {
      ensureFlagImage();

      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      }
      if (!map.getSource(START_ID)) {
        map.addSource(START_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      }
      if (!map.getSource(END_ID)) {
        map.addSource(END_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      }

      if (!map.getLayer(SOURCE_ID)) {
        map.addLayer({
          id: SOURCE_ID,
          type: "line",
          source: SOURCE_ID,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-width": 4,
            "line-color": ["get", "color"], // straight from Cotacol's own green/orange
            "line-opacity": 0.85,
          },
        });
        map.on("click", SOURCE_ID, (e) => {
          const f = e.features && e.features[0];
          if (!f) return;
          const l = linesById[f.properties.id];
          if (l) window.postMessage({ source: NS, type: "marker-clicked", marker: l }, "*");
        });
        map.on("mouseenter", SOURCE_ID, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", SOURCE_ID, () => (map.getCanvas().style.cursor = ""));
        console.log("[cotacol] layer added");
      }

      if (!map.getLayer(START_ID)) {
        map.addLayer({
          id: START_ID,
          type: "circle",
          source: START_ID,
          paint: {
            "circle-radius": 5,
            "circle-color": ["get", "color"],
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#ffffff",
          },
        });
      }

      if (!map.getLayer(END_ID)) {
        map.addLayer({
          id: END_ID,
          type: "symbol",
          source: END_ID,
          layout: {
            "icon-image": FLAG_IMAGE,
            "icon-size": 1,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: {
            // Invisible when zoomed out, fades in between zoom 10-12 --
            // avoids cluttering the map with flags at wide zoom levels.
            "icon-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0, 12, 1],
          },
        });
      }

      if (lastLines) {
        map.getSource(SOURCE_ID).setData(toLineFeatureCollection(lastLines));
        map.getSource(START_ID).setData(toEndpointFeatureCollection(lastLines, "start"));
        map.getSource(END_ID).setData(toEndpointFeatureCollection(lastLines, "end"));
      }
      return true;
    } catch (e) {
      console.warn("[cotacol] failed to add layer:", e);
      return false;
    }
  }

  function ensureLayer() {
    if (!map) return false;
    if (map.isStyleLoaded && !map.isStyleLoaded()) {
      console.log("[cotacol] style not loaded yet, waiting...");
      map.once("style.load", addLayerNow);
      return false;
    }
    return addLayerNow();
  }

  function setLines(lines) {
    lastLines = lines;
    if (!ensureLayer()) return;
    try {
      map.getSource(SOURCE_ID).setData(toLineFeatureCollection(lines));
      map.getSource(START_ID).setData(toEndpointFeatureCollection(lines, "start"));
      map.getSource(END_ID).setData(toEndpointFeatureCollection(lines, "end"));
    } catch (e) {
      console.warn("[cotacol] failed to set data:", e);
    }
  }

  function clearLines() {
    lastLines = [];
    setLines([]);
  }

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.target !== NS) return;
    if (data.type === "add-markers") setLines(data.markers);
    if (data.type === "clear-markers") clearLines();
    if (data.type === "request-bounds") {
      window.postMessage({ source: NS, type: "map-ready" }, "*");
    }
  });

  let tries = 0;
  const interval = setInterval(() => {
    if (!map && window.strava?.maps?.getMap?.()) {
      map = window.strava.maps.getMap();
      map.on("style.load", addLayerNow); // survive basemap switches (satellite, etc.)
      console.log("[cotacol] map connected");
      window.postMessage({ source: NS, type: "map-ready" }, "*");
      clearInterval(interval);
      return;
    }
    tries++;
    if (tries > 600) clearInterval(interval); // ~30s at 50ms
  }, 50);
})();
