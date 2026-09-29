# Third-party data and services

## Bundled data (`src/flights/data/`)

| File | Source | License |
| --- | --- | --- |
| `airports.json` | [mwgg/Airports](https://github.com/mwgg/Airports) | MIT |
| `airlines.json` | [OpenFlights](https://openflights.org/data) airline database | [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/) |
| `land.json`, `land110.json` | [Natural Earth](https://www.naturalearthdata.com/) land polygons | Public domain |

The files were trimmed to the fields the plugin uses. The airline data remains under the ODbL: if you publicly use a changed version of `airlines.json`, you must offer that changed database under the ODbL too, and keep this attribution.

## Bundled libraries

Bundled into `panel.js` at build time, each under its own license (see `node_modules/<name>/LICENSE` after `npm install`): React and React DOM (MIT), Radix UI (MIT), lucide-react (ISC), class-variance-authority (Apache-2.0), clsx (MIT), tailwind-merge (MIT). The panel stylesheet is generated with Tailwind CSS (MIT).

## Online services used at run time

[adsbdb](https://www.adsbdb.com/), [HexDB](https://hexdb.io/), [Planespotters](https://www.planespotters.net/) (photos are linked and credited, not copied), airline logos from pics.avs.io, [Open-Meteo](https://open-meteo.com/) (weather data CC BY 4.0), and optionally [AeroDataBox](https://aerodatabox.com/) with your own key. Each has its own terms of use.

Fonts: General Sans from [Fontshare](https://www.fontshare.com/) and JetBrains Mono from Google Fonts, loaded by the panel when online.
