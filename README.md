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
- **What it actually does, in plain terms:** it ships the public shapes of
  all 1000 Cotacol climbs inside the extension, reads *your* done/not-done
  status from cotacol.cc (using your existing login there), and draws the
  climbs onto Strava's map. It does
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
6. If an older version is listed, click **Remove** on it first.

**Pin the extension to the toolbar** (Chrome and Edge):
1. Click the puzzle-piece **Extensions** icon next to the address bar.
2. Find **Cotacol on Strava Route Builder** and click the pin icon (Chrome)
   or the eye icon / **Show in toolbar** (Edge).
3. The Cotacol icon now stays visible. Click it to open the popup, which
   shows how many climbs are bundled, how many you've done and when your
   status last synced, plus a **Refresh status now** button. The number
   on the icon's badge is your done count.

**Then:**
1. Make sure you're logged in on `https://www.cotacol.cc` (Connect with
   Strava). Opening any cotacol.cc page also refreshes your status.
2. Go create or edit a route on Strava's map. A small "Cotacol hills"
   panel appears on the right edge of the screen. Toggle it on.
   - **Green** = done, **orange** = to do, **dark outline** = bookmarked
     (planned) on Cotacol, **grey** = your status hasn't synced yet.
   - Click a line to see its number, name, points and links to the Cotacol
     climb and the Strava segment.

## How it works

- **Geometry is bundled.** `data/climbs.json` holds all 1000 climbs (id,
  number, name, points, Strava segment id and encoded polyline), generated
  from Cotacol's public `https://www.cotacol.cc/api/climbs`. Climbs rarely
  change; to refresh, run
  `powershell -ExecutionPolicy Bypass -File tools\build-climbs.ps1` and
  reload the extension.
- **Only your status is fetched.** `background.js` calls
  `https://www.cotacol.cc/api/me/climb-status` with your cotacol.cc login,
  which returns `{ id, done, planned, ... }` per climb. It runs on install,
  on browser startup, every 3 hours, when you open the Route Builder (if
  the last sync is older than 1 hour), and when you click **Refresh**.
  `cotacol-sync.js` does the same fetch from inside any cotacol.cc tab you
  open, as a fallback.
- **Strava side.** Strava's Route Builder runs on Mapbox GL JS and exposes
  `window.strava.maps.getMap()`. `map-hook.js` adds GeoJSON line, start-dot
  and checkered-flag layers (flags fade in between zoom 10 and 12) and
  re-adds them if you switch base map style.

## Known limitations

- **Clicking a hill line doesn't drop a waypoint** — it shows the climb's
  details in the panel; click the same spot on Strava's map to route there.
- **Cotacol and Strava can change their sites at any time**, which may
  break this extension until it's updated.

## Troubleshooting

- **All hills are grey / popup says "Not signed in":** open
  https://www.cotacol.cc, sign in, then click **Refresh status now** in the
  extension popup (or the panel on Strava).
- **No panel on Strava:** make sure you're on `strava.com/maps/...` or
  `strava.com/routes/...` and reload with Ctrl+Shift+R.
- **Debug helpers** — in DevTools → Console on the Strava Route Builder:
  ```js
  __cotacolDebug.isMapConnected()
  __cotacolDebug.getCounts()      // { done, todo, unknown, planned }
  __cotacolDebug.getStatus()      // last sync time, error, source
  __cotacolDebug.hasLayers()
  __cotacolDebug.findClimb(241)   // or a name fragment
  __cotacolDebug.syncNow()
  ```
  The service worker (chrome://extensions → *service worker* link) logs
  `[cotacol]` lines for each sync attempt.

## Contributing

Pull requests welcome — especially fixes for whatever Cotacol/Strava
change next. `background.js` handles the status sync, `overlay-content.js`
merges bundled climbs with status, and `map-hook.js` does the rendering.

## License

MIT — do whatever you like with this, no warranty provided. See
[Security note](#️-security-note--read-before-installing) above.

