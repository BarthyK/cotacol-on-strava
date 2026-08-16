// Runs in the ISOLATED world on strava.com/routes/*. Has access to
// chrome.storage but not to the page's own map object -- that's why
// map-hook.js (MAIN world) exists, and why the two talk via postMessage.

const NS = "cotacol-strava";
let enabled = false;
let mapReady = false;
let allLines = {}; // id -> climb

function pushMarkers() {
  if (!mapReady) return;
  const markers = Object.values(allLines);
  if (enabled) {
    window.postMessage({ target: NS, type: "add-markers", markers }, "*");
  } else {
    window.postMessage({ target: NS, type: "clear-markers" }, "*");
  }
  updatePanelCount(markers.length);
}

function loadClimbsFromStorage() {
  chrome.storage.local.get(["cotacolData"], (res) => {
    allLines = res.cotacolData?.byId ?? {};
    updateSyncStatus(res.cotacolData);
    pushMarkers();
  });
}

// Keep in sync if a Cotacol tab syncs new data while this tab is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.cotacolData) {
    allLines = changes.cotacolData.newValue?.byId ?? {};
    updateSyncStatus(changes.cotacolData.newValue);
    pushMarkers();
  }
});

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.source !== NS) return;
  if (data.type === "map-ready") {
    mapReady = true;
    setPanelMapStatus(true);
    pushMarkers();
  }
  if (data.type === "marker-clicked") {
    onClimbClicked(data.marker);
  }
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
      <div id="cotacol-sync-status" class="cotacol-status">No Cotacol data synced yet.</div>
      <div id="cotacol-visible-count" class="cotacol-status"></div>
      <div class="cotacol-hint">Visit any page on cotacol.cc/map in another tab to sync/refresh your climbs.</div>
    </div>
  `;
  getSharedHost().appendChild(panel);

  const checkbox = panel.querySelector("#cotacol-enable");
  const body = panel.querySelector("#cotacol-body");

  chrome.storage.local.get(["cotacolEnabled"], (res) => {
    enabled = !!res.cotacolEnabled;
    checkbox.checked = enabled;
    body.style.display = enabled ? "block" : "none";
    if (enabled) loadClimbsFromStorage();
  });

  checkbox.addEventListener("change", () => {
    enabled = checkbox.checked;
    body.style.display = enabled ? "block" : "none";
    chrome.storage.local.set({ cotacolEnabled: enabled });
    if (enabled) loadClimbsFromStorage();
    else pushMarkers();
  });

  // Ask map-hook.js whether it's already attached (it may have attached
  // before this script finished loading).
  window.postMessage({ target: NS, type: "request-bounds" }, "*");
}

function setPanelMapStatus(ready) {
  const el = document.getElementById("cotacol-map-status");
  if (el) el.textContent = ready ? "Connected to Strava's map." : "Waiting for Strava's map...";
}

function updateSyncStatus(stored) {
  const el = document.getElementById("cotacol-sync-status");
  if (!el) return;
  if (!stored || !stored.count) {
    el.textContent = "No Cotacol data synced yet.";
    return;
  }
  const when = new Date(stored.lastSyncedAt).toLocaleString();
  el.textContent = `${stored.count} climbs synced (last: ${when})`;
}

function updatePanelCount(count) {
  const el = document.getElementById("cotacol-visible-count");
  if (el) el.textContent = enabled ? `${count} hills shown on map` : "";
}

function onClimbClicked(marker) {
  // Placeholder hook: this is where we'd add the climb's coordinates as a
  // waypoint into the route being built.
  console.log("[Cotacol] climb clicked:", marker.name, marker.color, marker.paths);
}

// The panel doesn't depend on any particular map DOM structure anymore
// (map-hook.js finds the map via window.strava.maps.getMap()), so just wait
// for the page body to exist.
if (document.body) {
  buildPanel();
} else {
  document.addEventListener("DOMContentLoaded", buildPanel, { once: true });
}
