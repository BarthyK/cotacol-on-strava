function render() {
  chrome.storage.local.get(["cotacolData"], (res) => {
    const el = document.getElementById("status");
    const stored = res.cotacolData;
    if (!stored || !stored.count) {
      el.textContent = "No data yet. Visit cotacol.cc/map (logged in), let it fully load, and wait a few seconds.";
      return;
    }
    const when = new Date(stored.lastSyncedAt).toLocaleString();
    el.textContent = `${stored.count} hills synced. Last synced ${when}.`;
  });
}

document.getElementById("clear").addEventListener("click", () => {
  chrome.storage.local.remove("cotacolData", render);
});

render();
