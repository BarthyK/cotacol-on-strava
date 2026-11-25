const statusEl = document.getElementById("status");

fetch(chrome.runtime.getURL("data/climbs.json"))
  .then((r) => r.json())
  .then((j) => {
    const date = j.generatedAt ? new Date(j.generatedAt).toLocaleDateString() : "?";
    document.getElementById("climbs").textContent = `${j.count} climbs bundled (data from ${date}).`;
  })
  .catch(() => (document.getElementById("climbs").textContent = "Bundled climb data missing!"));

function render() {
  chrome.storage.local.get(["cotacolStatus"], ({ cotacolStatus: st }) => {
    statusEl.textContent = "";
    if (st?.lastSyncedAt) {
      statusEl.textContent = `${st.doneCount} done · synced ${new Date(st.lastSyncedAt).toLocaleString()}.`;
    }
    if (st?.error === "not-signed-in") {
      statusEl.append(st?.lastSyncedAt ? " Latest refresh: " : "", "Not signed in. ");
      const a = document.createElement("a");
      a.href = "https://www.cotacol.cc/";
      a.target = "_blank";
      a.textContent = "Sign in on cotacol.cc";
      statusEl.append(a, ", then refresh.");
    } else if (st?.error) {
      statusEl.append(` Last refresh failed: ${st.error}`);
    } else if (!st?.lastSyncedAt) {
      statusEl.textContent = "Status not synced yet.";
    }
  });
}

document.getElementById("sync").addEventListener("click", () => {
  statusEl.textContent = "Syncing...";
  chrome.runtime.sendMessage({ type: "sync-now" }, () => {
    void chrome.runtime.lastError;
    render();
  });
});

document.getElementById("clear").addEventListener("click", () => {
  chrome.storage.local.remove("cotacolStatus", render);
});

render();
