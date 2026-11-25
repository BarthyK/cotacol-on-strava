// Runs in the ISOLATED world on strava.com/maps/* and /routes/*. Has access to
// chrome.storage and the bundled data, but not to the page's map object --
// map-hook.js (MAIN world) does the drawing; the two talk via postMessage.
//
// Data flow:
//   data/climbs.json (bundled geometry, 1000 climbs)
//   + chrome.storage.local.cotacolStatus (done/planned per climb id, synced
//     by background.js from cotacol.cc/api/me/climb-status)
//   -> colored lines sent to map-hook.js

const NS = "cotacol-strava";
const COLORS = {
  done: "#2f9e44",
  todo: "#fc6a03",
  unknown: "#8c8c8c", // no status synced yet
};

let enabled = false;
let mapReady = false;
let climbs = null; // [{ id, n, name, city, pts, seg, paths }]
let status = null; // chrome.storage cotacolStatus

function decodePolyline(str) {
  // Standard Google encoded polyline, precision 5 -> [[lat, lng], ...]
  let i = 0, lat = 0, lng = 0;
  const out = [];
  while (i < str.length) {
    for (let k = 0; k < 2; k++) {
      let b, shift = 0, result = 0;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 31) << shift;
        shift += 5;
      } while (b >= 32 && i < str.length);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (k === 0) lat += d;
      else lng += d;
    }
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

async function loadClimbs() {
  if (climbs) return climbs;
  const res = await fetch(chrome.runtime.getURL("data/climbs.json"));
  const json = await res.json();
  climbs = json.climbs
    .filter((c) => c.p)
    .map((c) => ({ id: c.id, n: c.n, name: c.name, city: c.city, pts: c.pts, seg: c.seg, paths: [decodePolyline(c.p)] }))
    .filter((c) => c.paths[0].length >= 2);
  return climbs;
}

function buildLines() {
  const byId = status?.byId;
  const hasStatus = !!(status?.lastSyncedAt && byId);
  return climbs.map((c) => {
    const s = hasStatus ? byId[c.id] : null;
    const state = !hasStatus ? "unknown" : s?.done ? "done" : "todo";
    return { ...c, state, planned: !!s?.planned, color: COLORS[state] };
  });
}

async function pushMarkers() {
  if (!mapReady) return;
  if (!enabled) {
    window.postMessage({ target: NS, type: "clear-markers" }, "*");
    updatePanelCount(0);
    return;
  }
  try {
    await loadClimbs();
  } catch (e) {
    console.warn("[cotacol] could not load bundled climbs:", e);
    return;
  }
  const markers = buildLines();
  window.postMessage({ target: NS, type: "add-markers", markers, status: summary() }, "*");
  updatePanelCount(markers.length);
}

function summary() {
  return {
    lastSyncedAt: status?.lastSyncedAt ?? null,
    doneCount: status?.doneCount ?? 0,
    error: status?.error ?? null,
    via: status?.via ?? null,
  };
}

function loadStatus() {
  chrome.storage.local.get(["cotacolStatus"], (res) => {
    status = res.cotacolStatus ?? null;
    updateSyncStatus();
    pushMarkers();
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.cotacolStatus) {
    status = changes.cotacolStatus.newValue ?? null;
    updateSyncStatus();
    pushMarkers();
  }
});

function requestSync(force) {
  const el = document.getElementById("cotacol-sync-status");
  if (force && el) el.textContent = "Syncing with Cotacol...";
  chrome.runtime.sendMessage({ type: force ? "sync-now" : "sync-if-stale" }, () => {
    void chrome.runtime.lastError; // service worker may be restarting; ignore
    updateSyncStatus();
  });
}

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.source !== NS) return;
  if (data.type === "map-ready") {
    mapReady = true;
    setPanelMapStatus(true);
    pushMarkers();
  }
  if (data.type === "marker-clicked") onClimbClicked(data.marker);
  if (data.type === "sync-now") requestSync(true);
});

// --- floating panel UI ---

const HOST_ID = "hillsync-shared-panel";

function getSharedHost() {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;
    document.body.appendChild(host);
  }
  return host;
}

function buildPanel() {
  const panel = document.createElement("div");
  panel.id = "cotacol-panel";
  panel.className = "hillsync-widget";
  panel.innerHTML = `
    <div class="cotacol-header">
      <label class="cotacol-toggle">
        <input type="checkbox" id="cotacol-enable" />
        <span>Cotacol hills</span>
      </label>
    </div>
    <div class="cotacol-body" id="cotacol-body" style="display:none">
      <div id="cotacol-map-status" class="cotacol-status">Waiting for Strava's map...</div>
      <div id="cotacol-sync-status" class="cotacol-status"></div>
      <div id="cotacol-visible-count" class="cotacol-status"></div>
      <div class="cotacol-legend">
        <span><i style="background:${COLORS.done}"></i>Done</span>
        <span><i style="background:${COLORS.todo}"></i>To do</span>
        <span><i class="cotacol-planned" style="background:${COLORS.todo}"></i>Planned</span>
      </div>
      <div id="cotacol-selected" class="cotacol-selected" style="display:none"></div>
      <button type="button" id="cotacol-refresh" class="cotacol-btn">Refresh status</button>
    </div>
  `;
  getSharedHost().appendChild(panel);

  const checkbox = panel.querySelector("#cotacol-enable");
  const body = panel.querySelector("#cotacol-body");
  panel.querySelector("#cotacol-refresh").addEventListener("click", () => requestSync(true));

  chrome.storage.local.get(["cotacolEnabled"], (res) => {
    enabled = !!res.cotacolEnabled;
    checkbox.checked = enabled;
    body.style.display = enabled ? "block" : "none";
    pushMarkers();
  });

  checkbox.addEventListener("change", () => {
    enabled = checkbox.checked;
    body.style.display = enabled ? "block" : "none";
    chrome.storage.local.set({ cotacolEnabled: enabled });
    pushMarkers();
  });

  loadStatus();
  requestSync(false);

  // map-hook.js may have attached before this script loaded.
  window.postMessage({ target: NS, type: "request-bounds" }, "*");
}

function setPanelMapStatus(ready) {
  const el = document.getElementById("cotacol-map-status");
  if (el) el.textContent = ready ? "Connected to Strava's map." : "Waiting for Strava's map...";
}

function updateSyncStatus() {
  const el = document.getElementById("cotacol-sync-status");
  if (!el) return;
  if (status?.lastSyncedAt) {
    const when = new Date(status.lastSyncedAt).toLocaleString();
    el.textContent = `${status.doneCount} climbs done (synced ${when})`;
    if (status.error === "not-signed-in") el.textContent += " — sign in on cotacol.cc to refresh.";
  } else if (status?.error === "not-signed-in") {
    el.textContent = "Not signed in to cotacol.cc — log in there, then Refresh. Hills show grey until then.";
  } else if (status?.error) {
    el.textContent = `Sync failed: ${status.error}`;
  } else {
    el.textContent = "Status not synced yet — hills show grey.";
  }
}

function updatePanelCount(count) {
  const el = document.getElementById("cotacol-visible-count");
  if (el) el.textContent = enabled && count ? `${count} hills on map` : "";
}

function onClimbClicked(c) {
  const el = document.getElementById("cotacol-selected");
  if (!el || !c) return;
  const stateLabel = { done: "Done", todo: "To do", unknown: "Status unknown" }[c.state] || "";
  el.style.display = "block";
  el.textContent = "";
  const title = document.createElement("div");
  title.className = "cotacol-selected-title";
  title.textContent = `#${c.n} ${c.name}`;
  const meta = document.createElement("div");
  meta.textContent = `${c.city} · ${c.pts} pts · ${stateLabel}${c.planned ? " · planned" : ""}`;
  const links = document.createElement("div");
  links.className = "cotacol-links";
  const mk = (href, label) => {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = label;
    return a;
  };
  links.append(
    mk(`https://www.cotacol.cc/climbs?climb=${encodeURIComponent(c.id)}`, "Cotacol"),
    mk(`https://www.strava.com/segments/${encodeURIComponent(c.seg)}`, "Strava segment")
  );
  el.append(title, meta, links);
}

if (document.body) {
  buildPanel();
} else {
  document.addEventListener("DOMContentLoaded", buildPanel, { once: true });
}
