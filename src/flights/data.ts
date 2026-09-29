/**
 * Bundled reference data, loaded on demand (it's most of the plug-in's size).
 *   airports.json  mwgg/Airports (MIT): every airport with an IATA code, with its time zone
 *   airlines.json  OpenFlights airlines.dat (ODbL): airlines with IATA codes
 *   land.json      Natural Earth 1:50m land (public domain), simplified
 *   land110.json   Natural Earth 1:110m land (public domain), for wide views
 */
import airports from "./data/airports.json";
import airlines from "./data/airlines.json";
import land from "./data/land.json";
import land110 from "./data/land110.json";

export default { airports, airlines, land, land110 } as unknown as {
  airports: [string, string, string, string, string, string, number, number, string, number][];
  airlines: [string, string, string, string, string, number][];
  land: { scale: number; rings: number[][] };
  land110: { scale: number; rings: number[][] };
};
