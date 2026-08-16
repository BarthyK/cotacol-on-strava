// Runs in the PAGE's own JS context (world: "MAIN") on Cotacol pages,
// injected at document_start.
//
// Cotacol is a Blazor Server app: its data arrives over a SignalR/WebSocket
// connection, not as JSON we can fetch. Confirmed via live debugging that
// Cotacol renders each hill's line as a feature on a google.maps.Data layer
// (GeoJSON API) rather than individual Polyline objects -- so instead of
// patching Polyline (which never fires), we patch google.maps.Data so we
// get a live reference to the layer instance, then listen for its
// "addfeature" events to capture each hill's LineString/MultiLineString
// geometry as it's added. Color comes from whatever styling function
// Cotacol passes to data.setStyle() (the Data API's standard mechanism for
// per-feature styling) -- we capture that function and call it ourselves
// per feature to get the real green/orange, exactly as Cotacol's own map
// does, rather than guessing at colors independently. We still patch
// google.maps.Marker separately to get each climb's name, matched to its
// line by proximity.

(function () {
  const NS = "cotacol-map-hook";
  const pointsSeen = new Map(); // "lat,lng" -> { lat, lng, title }
  const linesSeen = new Map(); // feature id/key -> { id, path: [[lat,lng],...], color }
  let broadcastScheduled = false;

  function scheduleBroadcast() {
    if (broadcastScheduled) return;
    broadcastScheduled = true;
    setTimeout(() => {
      broadcastScheduled = false;
      window.postMessage(
        {
          source: NS,
          type: "sync",
          points: Array.from(pointsSeen.values()),
          lines: Array.from(linesSeen.values()),
        },
        "*"
      );
    }, 500);
  }

  function extractLatLng(pt) {
    if (!pt) return null;
    const lat = typeof pt.lat === "function" ? pt.lat() : pt.lat;
    const lng = typeof pt.lng === "function" ? pt.lng() : pt.lng;
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
  }

  function recordMarker(opts, instance) {
    try {
      const pos = opts?.position ?? instance.getPosition?.();
      const ll = extractLatLng(pos);
      if (!ll) return;
      const key = `${ll[0].toFixed(6)},${ll[1].toFixed(6)}`;
      const title = opts?.title ?? instance.getTitle?.() ?? "Unnamed climb";
      pointsSeen.set(key, { lat: ll[0], lng: ll[1], title });
      scheduleBroadcast();
    } catch (e) {
      // ignore malformed marker options
    }
  }

  function patchMarkerClass() {
    const maps = window.google?.maps;
    if (!maps?.Marker || maps.Marker.__cotacolPatched) return;

    const OrigMarker = maps.Marker;
    function PatchedMarker(opts) {
      const instance = new OrigMarker(opts);
      recordMarker(opts, instance);
      return instance;
    }
    PatchedMarker.prototype = OrigMarker.prototype;
    Object.setPrototypeOf(PatchedMarker, OrigMarker);
    PatchedMarker.__cotacolPatched = true;
    maps.Marker = PatchedMarker;
  }

  function recordPolyline(opts, instance) {
    try {
      let rawPath = opts?.path;
      if ((!rawPath || rawPath.length === 0) && instance.getPath) {
        rawPath = instance.getPath().getArray();
      }
      if (!rawPath || rawPath.length < 2) return;
      const path = Array.from(rawPath).map(extractLatLng).filter(Boolean);
      if (path.length < 2) return;
      const color = opts?.strokeColor || "#888888";
      const key = `p${path[0].join(",")}|${path[path.length - 1].join(",")}|${path.length}`;
      const isNew = !linesSeen.has(key);
      linesSeen.set(key, { id: key, paths: [path], color });
      if (isNew) console.log("[cotacol] polyline captured:", key, color);
      scheduleBroadcast();
    } catch (e) {
      // ignore malformed polyline options
    }
  }

  function patchPolylineClass() {
    const maps = window.google?.maps;
    if (!maps?.Polyline || maps.Polyline.__cotacolPatched) return;

    const OrigPolyline = maps.Polyline;
    function PatchedPolyline(opts) {
      const instance = new OrigPolyline(opts);
      recordPolyline(opts, instance);
      return instance;
    }
    PatchedPolyline.prototype = OrigPolyline.prototype;
    Object.setPrototypeOf(PatchedPolyline, OrigPolyline);
    PatchedPolyline.__cotacolPatched = true;
    maps.Polyline = PatchedPolyline;
  }

  function patchAdvancedMarkerClass() {
    // Newer Google Maps apps use marker.AdvancedMarkerElement instead of
    // the classic Marker class. Patch this too, defensively.
    const markerLib = window.google?.maps?.marker;
    if (!markerLib?.AdvancedMarkerElement || markerLib.AdvancedMarkerElement.__cotacolPatched) return;

    const OrigAdvanced = markerLib.AdvancedMarkerElement;
    function PatchedAdvanced(opts) {
      const instance = new OrigAdvanced(opts);
      try {
        const ll = extractLatLng(opts?.position);
        if (ll) {
          const key = `${ll[0].toFixed(6)},${ll[1].toFixed(6)}`;
          pointsSeen.set(key, { lat: ll[0], lng: ll[1], title: opts?.title ?? "Unnamed climb" });
          scheduleBroadcast();
        }
      } catch (e) {}
      return instance;
    }
    PatchedAdvanced.prototype = OrigAdvanced.prototype;
    Object.setPrototypeOf(PatchedAdvanced, OrigAdvanced);
    PatchedAdvanced.__cotacolPatched = true;
    markerLib.AdvancedMarkerElement = PatchedAdvanced;
  }

  // --- google.maps.Data layer patching (this is what actually draws the
  // hill lines) ---

  const dataLayers = new Set(); // every Data instance we've seen
  const stylingFnByLayer = new Map(); // Data instance -> last styling fn passed to setStyle

  function geometryToPaths(geometry) {
    // google.maps.Data.Geometry wraps LineString/MultiLineString/etc.
    // Use forEachLatLng, which works uniformly across all geometry types
    // and just gives us every point in order -- fine for LineString; for
    // MultiLineString we fall back to getArray() to keep segments separate.
    if (!geometry) return [];
    const type = geometry.getType && geometry.getType();
    if (type === "LineString") {
      const path = [];
      geometry.forEachLatLng((ll) => {
        const p = extractLatLng(ll);
        if (p) path.push(p);
      });
      return path.length >= 2 ? [path] : [];
    }
    if (type === "MultiLineString") {
      const lines = geometry.getArray ? geometry.getArray() : [];
      return lines
        .map((line) => {
          const path = [];
          line.forEachLatLng((ll) => {
            const p = extractLatLng(ll);
            if (p) path.push(p);
          });
          return path;
        })
        .filter((p) => p.length >= 2);
    }
    return [];
  }

  function colorForFeature(layer, feature) {
    const stylingFn = stylingFnByLayer.get(layer);
    if (typeof stylingFn === "function") {
      try {
        const style = stylingFn(feature) || {};
        if (style.strokeColor) return style.strokeColor;
      } catch (e) {
        // fall through to default
      }
    }
    return "#888888";
  }

  function recordFeature(layer, feature) {
    try {
      const paths = geometryToPaths(feature.getGeometry());
      if (paths.length === 0) return;
      const color = colorForFeature(layer, feature);
      const fid = feature.getId ? feature.getId() : null;
      const firstPath = paths[0];
      const key = fid != null ? `f${fid}` : `${firstPath[0].join(",")}|${firstPath[firstPath.length - 1].join(",")}|${paths.length}`;
      const isNew = !linesSeen.has(key);
      linesSeen.set(key, { id: key, paths, color });
      if (isNew) console.log("[cotacol] line captured:", key, color);
      scheduleBroadcast();
    } catch (e) {
      console.warn("[cotacol] recordFeature failed:", e);
    }
  }

  function hookDataLayerInstance(layer) {
    if (dataLayers.has(layer)) return;
    dataLayers.add(layer);
    console.log("[cotacol] Data layer hooked, layer #", dataLayers.size);

    // Catch every feature already on the layer at the moment we noticed it...
    let existingCount = 0;
    try {
      layer.forEach((feature) => {
        existingCount++;
        recordFeature(layer, feature);
      });
    } catch (e) {
      console.warn("[cotacol] initial forEach failed:", e);
    }
    console.log("[cotacol] layer had", existingCount, "features at hook time");

    // ...and every one added from here on (Blazor Server likely streams
    // features in progressively as data arrives over SignalR).
    layer.addListener("addfeature", (e) => {
      console.log("[cotacol] addfeature event fired");
      recordFeature(layer, e.feature);
    });
    layer.addListener("setgeometry", (e) => {
      console.log("[cotacol] setgeometry event fired");
      recordFeature(layer, e.feature);
    });

    // Capture whatever styling function Cotacol assigns, so future/past
    // features can be colored correctly (setStyle can be called before or
    // after features are added).
    const origSetStyle = layer.setStyle.bind(layer);
    layer.setStyle = function (styleOrFn) {
      console.log("[cotacol] setStyle called");
      stylingFnByLayer.set(layer, styleOrFn);
      const result = origSetStyle(styleOrFn);
      // Re-color anything we already captured from this layer now that we
      // have (or changed) its styling function.
      try {
        layer.forEach((feature) => recordFeature(layer, feature));
      } catch (e) {}
      return result;
    };
  }

  function patchDataClass() {
    const maps = window.google?.maps;
    if (!maps?.Data || maps.Data.__cotacolPatched) return;

    const OrigData = maps.Data;
    function PatchedData(opts) {
      const instance = new OrigData(opts);
      hookDataLayerInstance(instance);
      return instance;
    }
    PatchedData.prototype = OrigData.prototype;
    Object.setPrototypeOf(PatchedData, OrigData);
    PatchedData.__cotacolPatched = true;
    maps.Data = PatchedData;
  }

  function scanForExistingDataLayers() {
    // A map's built-in map.data is created internally by the Map
    // constructor itself (not via `new google.maps.Data(...)`), so our
    // Data-class patch won't catch it. Instead, patch Map so that whenever
    // one is constructed, we grab its .data property directly.
    const maps = window.google?.maps;
    if (!maps?.Map || maps.Map.__cotacolDataPatched) return;

    const OrigMap = maps.Map;
    function PatchedMap(...args) {
      const instance = new OrigMap(...args);
      if (instance.data) hookDataLayerInstance(instance.data);
      return instance;
    }
    PatchedMap.prototype = OrigMap.prototype;
    Object.setPrototypeOf(PatchedMap, OrigMap);
    PatchedMap.__cotacolDataPatched = true;
    maps.Map = PatchedMap;
  }

  // The Google Maps script itself loads asynchronously, and Blazor Server
  // may take a moment to open its SignalR connection and start rendering
  // after that -- so keep polling for a while rather than giving up early.
  let tries = 0;
  const interval = setInterval(() => {
    patchMarkerClass();
    patchAdvancedMarkerClass();
    patchPolylineClass();
    patchDataClass();
    scanForExistingDataLayers();
    tries++;
    if (tries > 600) clearInterval(interval); // ~30s at 50ms
  }, 50);

  // Safety net for a timing race: if Cotacol's map finishes loading (and
  // creates all its lines) before this script finishes attaching -- e.g. a
  // fast page load, or the browser restoring a cached/back-forward tab
  // instead of a true fresh load -- our patches only catch objects created
  // *after* they're installed, so already-existing features would be
  // missed entirely with no addfeature event ever firing for them. Re-scan
  // every known Data layer's current feature list periodically to catch
  // that case too.
  setInterval(() => {
    for (const layer of dataLayers) {
      try {
        layer.forEach((feature) => recordFeature(layer, feature));
      } catch (e) {}
    }
  }, 3000);

  // Debug helpers -- run these in the DevTools console on cotacol.cc:
  //   window.__cotacolDebug.isPatched()      -> confirms Marker/Polyline/Data got wrapped
  //   window.__cotacolDebug.getPoints()      -> markers captured so far (names)
  //   window.__cotacolDebug.getLines()       -> hill lines captured so far (from either source)
  //   window.__cotacolDebug.getDataLayerCount() -> how many Data layers found
  window.__cotacolDebug = {
    isPatched: () => ({
      marker: window.google?.maps?.Marker?.__cotacolPatched === true,
      polyline: window.google?.maps?.Polyline?.__cotacolPatched === true,
      data: window.google?.maps?.Data?.__cotacolPatched === true,
      mapDataHook: window.google?.maps?.Map?.__cotacolDataPatched === true,
    }),
    getPoints: () => Array.from(pointsSeen.values()),
    getLines: () => Array.from(linesSeen.values()),
    getDataLayerCount: () => dataLayers.size,
    inspectDataLayers: () => {
      const results = [];
      for (const layer of dataLayers) {
        const geomTypes = {};
        let count = 0;
        try {
          layer.forEach((feature) => {
            count++;
            const t = feature.getGeometry()?.getType?.() ?? "unknown";
            geomTypes[t] = (geomTypes[t] || 0) + 1;
          });
        } catch (e) {
          results.push({ error: String(e) });
          continue;
        }
        results.push({ featureCount: count, geometryTypes: geomTypes });
      }
      return results;
    },
  };
})();
