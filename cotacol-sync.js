// Runs (isolated world) on cotacol.cc pages. Fallback sync path: fetches the
// rider's climb status from inside the cotacol.cc tab, where the login cookie
// is always sent, and hands it to background.js for storage.
//
// Normally background.js syncs on its own; this just guarantees that simply
// visiting cotacol.cc while logged in refreshes your done/not-done status.

(async () => {
  try {
    const sres = await fetch("/auth/session", { credentials: "include", cache: "no-store" });
    const session = sres.ok ? await sres.json() : null;
    if (!session?.signedIn) return;
    const res = await fetch("/api/me/climb-status", { credentials: "include", cache: "no-store" });
    if (!res.ok) {
      console.warn("[cotacol] climb-status HTTP", res.status);
      return;
    }
    const data = await res.json();
    const reply = await chrome.runtime.sendMessage({ type: "status-from-page", data });
    console.log("[cotacol] status synced from cotacol.cc tab:", reply);
  } catch (e) {
    console.warn("[cotacol] status sync from tab failed:", e);
  }
})();
