// Runs in the ISOLATED world on Cotacol pages. Has chrome.storage access
// but can't see google.maps objects directly -- that's why
// cotacol-map-hook.js (MAIN world) exists and relays via postMessage.

const NS = "cotacol-map-hook";

function nearestMarkerName(midpoint, points) {
  let best = null;
  let bestDist = Infinity;
  for (const p of points) {
    const dLat = p.lat - midpoint[0];
    const dLng = p.lng - midpoint[1];
    const d = dLat * dLat + dLng * dLng;
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best ? best.title : "Unnamed climb";
}

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.source !== NS || data.type !== "sync") return;
  if (!Array.isArray(data.lines) || data.lines.length === 0) return;

  chrome.storage.local.get(["cotacolData"], (res) => {
    const byId = res.cotacolData?.byId ?? {};
    for (const line of data.lines) {
      const firstPath = line.paths[0];
      const mid = firstPath[Math.floor(firstPath.length / 2)];
      byId[line.id] = {
        id: line.id,
        paths: line.paths,
        color: line.color,
        name: nearestMarkerName(mid, data.points),
      };
    }
    chrome.storage.local.set({
      cotacolData: {
        byId,
        count: Object.keys(byId).length,
        lastSyncedAt: Date.now(),
      },
    });
  });
});
