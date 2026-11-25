// Service worker. Owns the done/not-done sync with Cotacol.
//
// Geometry is bundled (data/climbs.json); the only thing fetched from Cotacol
// is the signed-in rider's per-climb status:
//
//   GET https://www.cotacol.cc/api/me/climb-status
//   -> [{ id, done, attempts, planned, firstClimbed, bestTime, localLegend }, ...]
//
// It uses your existing cotacol.cc login cookie (host_permissions lets the
// extension send it). If the browser refuses to attach the cookie from here,
// cotacol-sync.js does the same fetch from inside any cotacol.cc tab as a
// fallback and hands the result to saveStatus() via a message.

const ORIGIN = "https://www.cotacol.cc";
const STATUS_URL = `${ORIGIN}/api/me/climb-status`;
const SESSION_URL = `${ORIGIN}/auth/session`;
const STALE_MS = 60 * 60 * 1000; // re-sync when older than 1h and Strava opens
const ALARM = "cotacol-status-sync";

function normalizeStatus(raw) {
  // Be tolerant of small shape changes (array vs. object map, id naming).
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.climbs)
      ? raw.climbs
      : raw && typeof raw === "object"
        ? Object.entries(raw).map(([id, v]) => ({ id, ...(typeof v === "object" ? v : { done: !!v }) }))
        : null;
  if (!list) throw new Error("Unrecognized climb-status response");
  const byId = {};
  for (const s of list) {
    const id = String(s.id ?? s.climbId ?? s.number ?? "");
    if (!id) continue;
    byId[id] = { done: !!s.done, planned: !!s.planned };
  }
  return byId;
}

async function saveStatus(byId, via) {
  const doneCount = Object.values(byId).filter((s) => s.done).length;
  const cotacolStatus = { byId, doneCount, lastSyncedAt: Date.now(), via, error: null };
  await chrome.storage.local.set({ cotacolStatus });
  return cotacolStatus;
}

async function saveError(error) {
  const { cotacolStatus } = await chrome.storage.local.get("cotacolStatus");
  await chrome.storage.local.set({
    cotacolStatus: { ...(cotacolStatus || { byId: {}, doneCount: 0, lastSyncedAt: null }), error, lastErrorAt: Date.now() },
  });
}

let inFlight = null;
async function syncNow() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const sres = await fetch(SESSION_URL, { credentials: "include", cache: "no-store" });
      const session = sres.ok ? await sres.json() : null;
      if (!session?.signedIn) {
        // Possibly just the cookie not being sent from the extension context;
        // cotacol-sync.js will cover that case when you visit cotacol.cc.
        await saveError("not-signed-in");
        return { ok: false, error: "not-signed-in" };
      }
      const res = await fetch(STATUS_URL, { credentials: "include", cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const st = await saveStatus(normalizeStatus(await res.json()), "background");
      console.log(`[cotacol] synced: ${st.doneCount} done`);
      return { ok: true, doneCount: st.doneCount };
    } catch (e) {
      console.warn("[cotacol] sync failed:", e);
      await saveError(String(e.message || e));
      return { ok: false, error: String(e.message || e) };
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function syncIfStale() {
  const { cotacolStatus } = await chrome.storage.local.get("cotacolStatus");
  if (!cotacolStatus?.lastSyncedAt || Date.now() - cotacolStatus.lastSyncedAt > STALE_MS) {
    return syncNow();
  }
  return { ok: true, fresh: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "sync-now") {
    syncNow().then(sendResponse);
    return true;
  }
  if (msg?.type === "sync-if-stale") {
    syncIfStale().then(sendResponse);
    return true;
  }
  if (msg?.type === "status-from-page") {
    // Fallback path: cotacol-sync.js fetched it from inside a cotacol.cc tab.
    try {
      saveStatus(normalizeStatus(msg.data), "cotacol-tab").then((st) => sendResponse({ ok: true, doneCount: st.doneCount }));
    } catch (e) {
      sendResponse({ ok: false, error: String(e.message || e) });
    }
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: 180 });
  chrome.storage.local.remove("cotacolData"); // old capture-based format
  syncNow();
});
chrome.runtime.onStartup.addListener(() => syncIfStale());
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) syncNow();
});

// Badge = number of climbs done.
function updateBadge(st) {
  const n = st?.doneCount ?? 0;
  chrome.action.setBadgeText({ text: st?.lastSyncedAt && n ? String(n) : st?.error ? "!" : "" });
  chrome.action.setBadgeBackgroundColor({ color: st?.error && !st?.lastSyncedAt ? "#888888" : "#fc4c02" });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.cotacolStatus) updateBadge(changes.cotacolStatus.newValue);
});
chrome.storage.local.get("cotacolStatus").then(({ cotacolStatus }) => updateBadge(cotacolStatus));
