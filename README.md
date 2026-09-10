# Global Good Practices — Interactive Booth Map

An interactive 3D world map for a conference booth, built to teach visitors how
countries are extending social insurance to informal and self-employed workers.
Seventeen good practices across fourteen countries, organised by the **Five As**
framework.

Built as a static site: no server, no build step, no framework. Publish the
repository to GitHub Pages and it runs.

![The map at booth resolution](docs/images/booth-map.png)

---

## What it does

**A real map, not a picture of one.** Country borders come from Natural Earth
1:50m — the same admin-0 dataset behind most published world maps — triangulated
and extruded into WebGL geometry with Three.js. Every one of the 241 features is
individually pickable. The projection is Equal Earth, so no country is inflated
relative to another.

**The fourteen countries with a practice stand up out of the map**, coloured by
their Five As category, named with a flag and a count. Everything else stays
low and quiet in WIEGO's khaki.

**Nothing is spelled out until you ask.** Clicking a country opens its panel;
clicking a practice inside it opens the detail. That is the booth interaction —
a visitor points at a country, you click it, and the story appears.

**Find any country, however small.** Cabo Verde is four pixels wide at world
zoom. The searchable picker lists all 236 named countries with their flags, with
practice countries grouped at the top, so nothing depends on hitting a tiny
target. Zoom with the wheel, pinch, the `+`/`−` buttons or a double-click.

**Three roles, one URL.**

| Role | How they get in | What they can do |
|---|---|---|
| **Host** | Google sign-in, restricted to one account | Issue codes, moderate notes, export |
| **Display** | Types a 16-character code | Full-screen presentation |
| **Visitor** | Scans the QR code | Browse on their phone, add notes for 24 hours |

**Visitors write on the map.** A phone that scans the booth QR gets a
time-limited pass, picks any country, and adds what they know. Their notes show
up on the country's panel and as a count on its label.

---

## Quick start

```bash
npm start        # http://localhost:8080
```

Then, in the page:

1. **Event host** tab → sign in (see [docs/SETUP.md](docs/SETUP.md) to configure
   Google sign-in or an owner passphrase)
2. **Controller → Issue display code** — that is what the projector machine types
3. **Controller → Show visitor QR code** — that is what goes on the stand

Before your first real event, read [docs/SETUP.md](docs/SETUP.md). At minimum,
rotate the event secret:

```bash
npm run secret
```

---

## Layout

```
index.html            App shell and the access gate
config.js             Everything an event host edits — start here
css/style.css         WIEGO palette, Lato, responsive down to a phone

js/
  main.js             Bootstrap and wiring
  map3d.js            Three.js scene: extrusion, picking, camera, pins
  geo.js              Equal Earth projection and TopoJSON decoding
  labels.js           DOM country labels, placement and collision
  ui.js               Legend, picker, country panel, sheets
  practices.js        All the content — the Five As and the 17 practices
  auth.js             Roles, Google ID token verification
  tokens.js           Self-verifying display codes and visitor passes
  store.js            Visitor notes: local, or Firestore when configured
  qr.js               QR rendering
  config-loader.js    Config defaults

data/
  countries-50m.json  Natural Earth 1:50m admin-0 (world-atlas)
  world-index.json    Generated: ISO codes, names, bboxes, label anchors

tools/
  build-index.mjs     Regenerates world-index.json
  check.mjs           End-to-end browser test
  serve.mjs           Local static server
  secret.mjs          Prints a new event secret
  passphrase.mjs      Hashes an owner passphrase

vendor/               three.js, earcut, qrcode-generator — all committed
assets/flags/         270 SVG flags (flag-icons)
```

Everything third-party is committed rather than fetched from a CDN. A booth on
bad conference wifi should not depend on unpkg being up.

---

## Testing

```bash
npm i -g playwright   # once
npm run check         # 60 assertions in a real browser
SHOTS=1 npm run check # also writes screenshots to .shots/
```

The check drives a real Chromium: it mints a code with the same scheme the app
uses, unlocks the gate, waits for the WebGL scene, then exercises the picker,
the panel, the filter, the QR sheet and the full guest flow — at booth
resolution, on a phone viewport, and as the host. It also asserts that a wrong code, an
expired code and a code from a different secret are all refused, and that a note
containing markup is escaped rather than executed.

---

## Content notes

The practice text follows the source infographic, expanded from caption length to
a paragraph a visitor can actually learn from. One figure was corrected:

- **Germany, Künstlersozialversicherung.** The infographic gives 30% / 30% / 20%,
  which totals 80%. The published Künstlersozialkasse split is **50% artist,
  30% levy on commissioning businesses, 20% federal subsidy**. The panel shows the
  corrected figures and says so in a footnote.

Spellings were also normalised to the schemes' own names: AHMINI (not ANMINI),
Casa do Cidadão, Cabo Verde, Germany.

## Map notes

Natural Earth carries five polygons with no ISO code — Somaliland, Kosovo,
Northern Cyprus, the Indian Ocean Territories and the Siachen Glacier. They are
drawn as neutral land: no label, no flag, not in the country picker, so the map
makes no claim either way. The standard disclaimer sits in the page footer.

---

## Licences

| | |
|---|---|
| Three.js | MIT |
| earcut | ISC |
| qrcode-generator | MIT |
| world-atlas / Natural Earth | Public domain |
| flag-icons | MIT |
| WIEGO logo and palette | © WIEGO — used under the 2019 Brandbook |
