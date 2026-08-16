# Cotacol on Strava Route Builder

A browser extension that shows your Cotacol hills as colored lines — the
actual climb shape, green if you've done it, orange if you haven't —
directly on Strava's real Route Builder map, so you can see them while you
draw a route without switching tabs.

## How it works

### 1. Syncing Cotacol data (`cotacol-map-hook.js` + `cotacol-sync.js`)

Cotacol is a **Blazor Server** app — it pushes data over a SignalR/WebSocket
connection, not as fetchable JSON, so there's no REST endpoint to call
directly. Instead, `cotacol-map-hook.js` (runs in the page's own JS context,
`world: "MAIN"`) patches `google.maps.Polyline` -- Cotacol renders each
hill's real Strava-segment shape as one of these, colored with whatever
`strokeColor` it chooses (green = done, orange = not, straight from
Cotacol's own styling, not guessed at) -- so every line gets captured the
moment it's drawn, regardless of how the underlying data arrived. It also
patches `google.maps.Marker`/`AdvancedMarkerElement` purely to grab each
climb's *name*, then matches each line to its nearest marker by proximity.
The result relays via `postMessage` to `cotacol-sync.js` (isolated world,
has `chrome.storage` access), which caches it as `{ path, color, name }`
per hill.

Practically: **open the Cotacol map, let it fully load with lines visible,
and wait a few seconds** — that's what triggers the sync.

### 2. Drawing on Strava's map (`map-hook.js` + `overlay-content.js`)

Strava's Route Builder runs on **Mapbox GL JS**, and conveniently exposes a
public global for it: `window.strava.maps.getMap()`. `map-hook.js` (MAIN
world, on strava.com/maps/* and strava.com/routes/*) polls for that, then
uses Mapbox GL's normal `addSource`/`addLayer` API to draw a `line` layer
straight from your synced Cotacol data -- `line-color` is a data-driven
expression pulling each feature's own `color` property, so Cotacol's
green/orange styling carries through exactly. (Confirmed by reading the
actual StatsHunters extension source -- it uses this same global as its
primary path for Strava.)

`overlay-content.js` adds the toggle panel (top-right of the Route Builder
page) and relays your synced hills from storage to `map-hook.js` whenever
the panel is switched on.

Strava's actual route-creation URL turned out to be
`strava.com/maps/create...`, not `/routes/new` as originally assumed -- both
are now covered by the extension's URL matching.

## Install (unpacked, for testing) — Microsoft Edge

1. Open `edge://extensions`.
2. Enable "Developer mode" (toggle, bottom-left of the sidebar).
3. Click "Load unpacked" and select this folder.
4. Edge will likely prompt you to confirm the extension's site permissions
   (strava.com / cotacol.cc) — allow it, or the content scripts won't inject.
5. Visit `https://www.cotacol.cc/map` while logged in (it will redirect to
   `cotacol-hunting-app.azurewebsites.net` — that's expected, the sync
   script runs there too). Let the map fully render with lines, wait a few
   seconds — the extension icon badge should pick up a count.
6. Go create/edit a route on Strava's map. A small "Cotacol hills" panel
   appears top-right. Toggle it on.

(Same steps work in Chrome too, just via `chrome://extensions` instead.)

## Current limitations / next steps

- **Clicking a hill line doesn't drop a waypoint yet.** Right now it just
  logs to the console (`onClimbClicked` in `overlay-content.js`) — you still
  click the same spot on Strava's real map to add it as a waypoint.
- **Name-matching is proximity-based**, not a real ID link (Cotacol's Maps
  API objects don't expose one to us) — so a hill's name could occasionally
  get attributed to a nearby marker instead of its own. Cosmetic only; the
  line's shape and color are always exact.

## If something doesn't work

**Check this first:** on the Cotacol map page, open DevTools (F12) → Console.
If you see `net::ERR_BLOCKED_BY_CLIENT` errors (especially for
`maps.googleapis.com`), your browser's built-in tracking prevention (or an
ad-blocker extension) is blocking Cotacol's map from loading at all -- no
map means no markers for the sync to catch. Fix: click the padlock/shield
icon in the address bar → turn tracking prevention off for that site (or
add an exception in your browser's privacy settings for
`cotacol-hunting-app.azurewebsites.net`), then reload.

Beyond that, tell me what you see and I'll adjust the code:
- Extension icon badge count after visiting the Cotacol map (0 = sync isn't
  catching anything).
- Whether the "Cotacol hills" panel appears on the Strava page, and what it
  says under "Waiting for Strava's map..." after a few seconds.
- Any errors in the DevTools Console on either page (look for `[cotacol]`
  lines specifically).
- If useful, paste the output of running
  `chrome.storage.local.get('cotacolData', console.log)` in the console.
