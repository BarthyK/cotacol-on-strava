chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.cotacolData) return;
  const count = changes.cotacolData.newValue?.count ?? 0;
  chrome.action.setBadgeText({ text: count ? String(count) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#fc4c02" });
});
