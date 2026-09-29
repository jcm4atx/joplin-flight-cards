# Flight Cards for Joplin

Enter a flight you took and get a note for it: a card with both airports, local times, flight time and distance, a route map, the aircraft and its photo, the airline's logo and the weather at each end. Add a notebook of these cards and the panel turns into a flight log with totals and a map of every route.

Works on Joplin desktop (Windows, macOS, Linux) and Joplin mobile (Android, iOS).

## Features

- **Quick entry.** You type the date, departure time, airline, flight number and the two airports. Airlines and airports autocomplete from built-in lists (about 7,900 airports and 1,500 airlines), so entry works offline.
- **Optional details.** You can also add the arrival time, aircraft, registration (tail number), seat, class, booking reference and your own notes.
- **Automatic lookups.** The missing details are filled in online (see below). Every field can be checked and changed before saving, and each one says where it came from.
- **Cards that look right in Joplin.** Each flight is an ordinary note whose body is the card (HTML), so it looks the same in the note viewer, in exports and on every device.
- **Flight log.** For the chosen notebook: flights, distance, time in the air, airports and countries, the longest flight, top airports and airlines, a map of every route, and a list you can filter by year.
- **Units and formats.** Miles and °F or kilometres and °C, and 12- or 24-hour times.

## Installing

### From a release (recommended)

1. Download `us.mayson.scuteflights.jpl` from the [latest release](../../releases/latest).
2. Install it in Joplin:
   - **Desktop:** **Tools → Options → Plugins** (on macOS: **Joplin → Settings → Plugins**). Click the **⚙** gear, choose **Install from file**, pick the `.jpl`, and restart Joplin when asked.
   - **Mobile (Joplin 3.0.3 or later):** **Configuration → Plugins → Install from file**, and pick the `.jpl`. If you don't see the Plugins section, switch on plugin support there first.
3. Open it:
   - **Desktop:** **Tools → Flight cards**, or the plane button in the editor toolbar. The panel opens beside the editor; run the command again to hide it.
   - **Mobile:** the plugin panel button in the note toolbar.

### Updating

Install the new `.jpl` the same way. Joplin replaces the old version and keeps your settings. Your flight notes are never touched by an update.

### Uninstalling

**Tools → Options → Plugins**, find **Flight Cards**, then **Delete**. Your flight notes stay; they're ordinary notes.

## Using it

1. Open the panel and pick (or create) the notebook for your flights.
2. Press **Add a flight**, fill in the date, departure time, airline, flight number and airports, and press **Find details**.
3. Check the details and change anything you like. **Look up again** keeps your changes.
4. Press **Create card**. The card is created as a note in the chosen notebook.

Saved cards can be opened from the panel to edit or refresh them later, for example once actual times are available. Edit a card from the panel rather than in the note text, because saving from the panel rewrites the note body.

## Where the details come from

| What | Where from | Needs |
| --- | --- | --- |
| Airport names, cities, coordinates, time zones | Built in; [HexDB](https://hexdb.io/) for anything missing | — |
| Distance, great-circle route, time-zone change, estimated flight time and arrival | Calculated | — |
| Whether the flight number is published on that route, the airline's call sign | [adsbdb](https://www.adsbdb.com/) | — |
| Aircraft type and owner | adsbdb | a registration |
| Aircraft photo, credited and linked to the photographer | [Planespotters](https://www.planespotters.net/) | a registration |
| Airline logo | pics.avs.io | — |
| Weather at departure and arrival | [Open-Meteo](https://open-meteo.com/) (forecast or historical) | — |
| Scheduled and actual times, terminals, gates, aircraft and registration for that exact date, status | [AeroDataBox](https://aerodatabox.com/) | an API key (optional) |

Without an AeroDataBox key, the arrival time is estimated from the distance unless you enter it, and the card says so.

**Adding an AeroDataBox key (optional).** Get a free-tier key from [RapidAPI](https://rapidapi.com/aedbx-aedbx/api/aerodatabox) or [API.Market](https://api.market/store/aedbx/aerodatabox). Enter it in the panel's **Settings** and press **Test the key**. You can also enter it in **Tools → Options → Flight cards**, where you choose which service the key is from. The key is kept in Joplin's secure settings on that device (the system keychain on desktop) and isn't synced.

**Working offline.** Switch **Look flights up online** off in Settings to keep everything local. The route map is drawn from built-in coastlines, so it works offline too.

## Privacy

The lookup services see the flight number, registration, airport coordinates and date you look up, and nothing else. Requests go directly from Joplin to those services; there is no server of mine in between. The finished card is an ordinary note, so it syncs through whatever sync target you use, including Joplin's end-to-end encryption. The aircraft photo is shown from Planespotters' site rather than copied, as their terms ask.

## How the data is stored

Each flight is one note in the notebook you pick. The note body is the card itself (HTML), followed by the flight's data as JSON in an HTML comment at the very end:

```
<div class="scute-flight-card">…the card…</div>

<!-- scute:flight {"v":1,…} -->
```

The comment is invisible in the rendered note. The panel only lists notes that have it. On desktop the route map and the airline logo are saved as note attachments; on mobile they're kept inside the note.

The same format is used by the Flight cards plugin for Scute, a self-hosted notes app, so flights can move between the two.

## Building from source

You need [Node.js](https://nodejs.org/) 18 or later and `tar` (built into Linux, macOS and Windows 10+).

```bash
git clone https://github.com/<you>/joplin-flight-cards.git
cd joplin-flight-cards
npm install
npm run check    # type-check (optional)
npm run build    # → publish/us.mayson.scuteflights.jpl
```

Then install `publish/us.mayson.scuteflights.jpl` as described above.

### Project layout

| Path | What it is |
| --- | --- |
| `src/manifest.json` | The Joplin plugin manifest (id, version, name) |
| `src/index.ts` | Plugin backend: settings, the panel, the menu item and toolbar button, and note/attachment access through the Joplin data API |
| `src/panel.tsx` | The panel (React), talking to the backend with `webviewApi.postMessage` |
| `src/components/flights.tsx` | The entry form, card preview, settings and flight log |
| `src/flights/` | The flight model, online lookups, route map, card HTML, and the built-in airport, airline and coastline data |
| `src/components/ui/`, `src/hooks/`, `src/lib/` | Small UI building blocks (Radix UI and Tailwind CSS) |
| `src/panel.css`, `tailwind.config.ts` | Panel styles |
| `build.mjs` | Bundles with esbuild and Tailwind, then packs the `.jpl` (a tar archive) |

### Releasing

1. Bump `version` in both `package.json` and `src/manifest.json` (the build checks they match). Before the first release, fill in `homepage_url` and `repository_url` in `src/manifest.json` with the repository's address.
2. Commit, then tag and push:
   ```bash
   git tag v1.1.1
   git push origin main --tags
   ```
3. The included GitHub Actions workflow (`.github/workflows/release.yml`) builds the `.jpl` and attaches it to a GitHub release for that tag.

To list the plugin in Joplin's in-app plugin search as well, publish it to npm (`npm publish`). The package name starts with `joplin-plugin-` and has the `joplin-plugin` keyword, and the `publish/` folder holds the `.jpl` and its manifest, which is what Joplin's plugin repository looks for. Remove `"private": true` from `package.json` first. Joplin's repository picks up new versions from npm on its own.

## Requirements

- Joplin desktop 3.0 or later, or Joplin mobile 3.0.3 or later.
- An internet connection for the online lookups (optional).

## License

[MIT](LICENSE) © 2026 John Mayson. The bundled airport, airline and coastline data have their own licenses; see [THIRD_PARTY.md](THIRD_PARTY.md).
