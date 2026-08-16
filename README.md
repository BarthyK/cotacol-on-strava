# Cotacol on Strava Route Builder

A browser extension that shows your [Cotacol](https://www.cotacol.cc) hills
as colored lines — the actual climb shape, green if you've done it, orange
if you haven't — directly on Strava's real Route Builder map, so you can
see them while you draw a route without switching tabs.

![status](https://img.shields.io/badge/status-community%20project-orange)
![platform](https://img.shields.io/badge/browser-Chrome%20%7C%20Edge-blue)

## ⚠️ Security note — read before installing

This is an **unofficial, community-built browser extension**, not
published on the Chrome Web Store or reviewed by Google/Microsoft.
Installing it as an "unpacked extension" means your browser trusts it
completely, with no automated review process checking it for you. That's
normal for a free hobby project like this one, but you should make that
call with open eyes:

- **The full source code is right here in this repository — read it before
  installing.** It's plain, unminified JavaScript; nothing is obfuscated
  or bundled. If you can read basic JavaScript (or ask someone who can, or
  paste it into an AI assistant and ask it to summarize what the code
  does), you can verify for yourself exactly what it does and doesn't
  touch.
- **What it actually does, in plain terms:** it reads climb data rendered
  on cotacol.cc's own map, and draws that data onto Strava's map. It does
  not collect analytics, does not send your data anywhere except your own
  browser's local storage, and does not contact any server other than
  cotacol.cc and strava.com (the sites you're already using it on).
- **Install and use it at your own risk.** This is shared as a free hobby
  project, with no warranty and no guarantee it'll keep working — both
  Cotacol and Strava have changed things mid-development that broke it
  without warning, and could again.
- If you'd rather not install unreviewed code, that's a completely
  reasonable choice — feel free to just read the source for ideas instead.

## Install (unpacked extension)

**Chrome:**
1. Download this repository (green **Code** button above → **Download
   ZIP**, or grab the zip from the latest [Release](../../releases)) and
   unzip it.
2. Go to `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the unzipped folder.

**Edge:**
1. Same download/unzip step as above.
2. Go to `edge://extensions`.
3. Enable **Developer mode** (toggle, bottom-left of the sidebar).
4. Click **Load unpacked** and select the unzipped folder.
5. Edge may prompt you to confirm the extension's site permissions
   (strava.com / cotacol.cc) — allow it, or the content scripts won't
   inject.

**Then:**
1. Visit `https://www.cotacol.cc/map` while logged in (it redirects to
   `cotacol-hunting-app.azurewebsites.net` — that's expected). Let the map
   fully render with lines, and wait a few seconds — the extension icon
   badge should pick up a count.
2. Go create or edit a route on Strava's map. A small "Cotacol hills"
   panel appears on the right edge of the screen. Toggle it on.

## How it works

Cotacol is a **Blazor Server** app — it pushes data over a
SignalR/WebSocket connection, not as fetchable JSON, so there's no REST
endpoint to call directly. Instead, this extension patches the client-side
Google Maps rendering APIs that Cotacol's own map uses (`google.maps.Marker`
for climb names, plus both `google.maps.Polyline` and `google.maps.Data`
for line shapes and colors, since which one Cotacol actually uses varied
across sessions during development) to capture the data as it's drawn.

On the Strava side, Strava's Route Builder runs on **Mapbox GL JS** and
conveniently exposes a public global for it: `window.strava.maps.getMap()`.
The extension uses Mapbox GL's normal `addSource`/`addLayer` API to draw a
`line` layer straight from your synced Cotacol data, with a data-driven
`line-color` expression so Cotacol's green/orange carries through exactly.

## Known limitations

- **Clicking a hill line doesn't drop a waypoint yet** — it logs to the
  console; you still click the same spot on Strava's real map to add it.
- **Coverage builds up as you browse Cotacol**, rather than syncing
  instantly in one shot in every session — if a hill hasn't rendered on
  Cotacol's map at some point since install, it won't show up on Strava
  yet.
- **Both Cotacol and Strava can change their frontend code at any time**,
  which may silently break this extension until it's updated (this
  happened more than once during development).

## Troubleshooting

**Check this first:** on the Cotacol map page, open DevTools (F12) →
Console. If you see `net::ERR_BLOCKED_BY_CLIENT` errors (especially for
`maps.googleapis.com`), your browser's tracking prevention (or an
ad-blocker) is blocking Cotacol's map from loading at all. Fix: click the
padlock/shield icon in the address bar → allow tracking/ads for that site,
then reload.

If sync still shows 0 climbs after that, open the console on the Cotacol
page and run:
```js
window.__cotacolDebug.isPatched()
window.__cotacolDebug.getDataLayerCount()
window.__cotacolDebug.inspectDataLayers()
```
and open an [Issue](../../issues) with what those return, plus any
`[cotacol]`-prefixed console lines you see.

## Contributing

Pull requests welcome — especially fixes for whatever Cotacol/Strava
change next. See `cotacol-map-hook.js` for the Cotacol-side capture logic
and `map-hook.js` for the Strava-side rendering.

## License

MIT — do whatever you like with this, no warranty provided. See
[Security note](#️-security-note--read-before-installing) above.

