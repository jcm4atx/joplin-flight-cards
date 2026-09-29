/** Flight records: the data model, reference data (airports, airlines) and time/distance maths. */

export type Source = "you" | "aerodatabox" | "adsbdb" | "hexdb" | "builtin" | "openmeteo" | "planespotters" | "estimate" | "computed";
export const SOURCE_LABEL: Record<Source, string> = {
  you: "You",
  aerodatabox: "AeroDataBox",
  adsbdb: "adsbdb",
  hexdb: "HexDB",
  builtin: "Built-in data",
  openmeteo: "Open-Meteo",
  planespotters: "Planespotters",
  estimate: "Estimate",
  computed: "Calculated",
};

export interface Airport {
  iata: string;
  icao: string;
  name: string;
  city: string;
  state?: string;
  country: string; // ISO 3166-1 alpha-2
  lat: number;
  lon: number;
  tz: string;
  elev?: number;
}
export interface Airline {
  iata: string;
  icao: string;
  name: string;
  callsign?: string;
  country?: string;
  active?: boolean;
}
export interface Weather {
  tempC: number;
  code: number;
}
export interface Photo {
  src: string;
  link?: string;
  credit?: string;
  license?: string;
}

/** What the user types in. Required: date, depTime, airline, number, from, to. */
export interface FlightInput {
  date: string; // YYYY-MM-DD, local at the departure airport
  depTime: string; // HH:MM local
  arrTime?: string;
  airline: string; // name or code
  number: string; // "117" or "BA117"
  from: string; // IATA / ICAO / city
  to: string;
  aircraft?: string;
  reg?: string;
  seat?: string;
  cabin?: string;
  booking?: string;
  notes?: string;
}

/** The note's structured data (Scute note field `flight`; Joplin hidden JSON line). */
export interface Flight {
  v: 1;
  date: string;
  depTime: string;
  arrTime: string; // HH:MM local at arrival ("" = unknown)
  arrDate?: string; // YYYY-MM-DD local at arrival (computed if missing)
  airline: Airline;
  number: string; // digits (and letter suffix), no airline prefix
  callsign?: string; // ATC call sign, e.g. BAW117
  from: Airport;
  to: Airport;
  depTerminal?: string;
  depGate?: string;
  arrTerminal?: string;
  arrGate?: string;
  baggage?: string;
  aircraft?: string; // model, e.g. "Boeing 777-300ER"
  aircraftType?: string; // ICAO type, e.g. B77W
  reg?: string;
  modeS?: string;
  owner?: string;
  seat?: string;
  cabin?: string;
  booking?: string;
  notes?: string;
  status?: string;
  codeshare?: string;
  /** Actual / revised times (local HH:MM, with date) if a live source had them. */
  depActual?: string;
  arrActual?: string;
  depSched?: string;
  arrSched?: string;
  weatherDep?: Weather;
  weatherArr?: Weather;
  logo?: string; // data:image/png;base64…
  color?: string; // airline accent colour
  photo?: Photo;
  routeCheck?: string; // what the published route said
  sources: Partial<Record<string, Source>>;
  log?: string[];
  updated: number;
}

// ------------------------------------------------------------------ reference data
type Db = Awaited<ReturnType<typeof loadDb>>;
let dbP: Promise<Db> | null = null;
async function loadDb() {
  const d = (await import("./data")).default;
  const airports: Airport[] = d.airports.map(([iata, icao, name, city, state, country, lat, lon, tz, elev]) => ({ iata, icao, name, city, state, country, lat, lon, tz, elev }));
  const byIata = new Map(airports.map((a) => [a.iata, a]));
  const byIcao = new Map(airports.filter((a) => a.icao).map((a) => [a.icao, a]));
  const airlines: Airline[] = d.airlines.map(([iata, icao, name, callsign, country, active]) => ({ iata, icao, name, callsign, country, active: !!active }));
  return { airports, byIata, byIcao, airlines, land: d.land, land110: d.land110 };
}
let dbNow: Db | null = null;
export function db() {
  return (dbP ||= loadDb().then((d) => (dbNow = d)));
}
/** The reference data if it has loaded already (for synchronous drawing). */
export function dbSync() {
  return dbNow;
}
export type RefData = Db;

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

let countryNames: Intl.DisplayNames | null = null;
export function countryName(iso: string) {
  if (!iso) return "";
  try {
    countryNames ||= new Intl.DisplayNames(["en"], { type: "region" });
    return countryNames.of(iso.toUpperCase()) || iso;
  } catch {
    return iso;
  }
}

/** Airports matching what someone typed: codes first, then city and name. */
export async function searchAirports(q: string, limit = 8): Promise<Airport[]> {
  const d = await db();
  const t = q.trim();
  if (!t) return [];
  const up = t.toUpperCase();
  const out: Airport[] = [];
  const push = (a?: Airport) => a && !out.includes(a) && out.push(a);
  if (/^[A-Z]{3}$/.test(up)) push(d.byIata.get(up));
  if (/^[A-Z0-9]{4}$/.test(up)) push(d.byIcao.get(up));
  const n = norm(t);
  if (n.length < 2) return out;
  const scored: [number, Airport][] = [];
  for (const a of d.airports) {
    if (out.includes(a)) continue;
    const city = norm(a.city);
    const name = norm(a.name);
    let s = 0;
    if (city === n) s = 90;
    else if (city.startsWith(n)) s = 70;
    else if (name.startsWith(n)) s = 60;
    else if (name.includes(" " + n) || city.includes(" " + n)) s = 45;
    else if (name.includes(n)) s = 30;
    if (!s) continue;
    // big airports first: international ones and those with ICAO codes
    if (/international|intl/i.test(a.name)) s += 8;
    if (a.icao && /^[A-Z]{4}$/.test(a.icao)) s += 4;
    scored.push([s, a]);
  }
  scored.sort((x, y) => y[0] - x[0] || x[1].name.localeCompare(y[1].name));
  for (const [, a] of scored) {
    if (out.length >= limit) break;
    out.push(a);
  }
  return out.slice(0, limit);
}
export async function findAirport(q: string): Promise<Airport | null> {
  const t = q.trim();
  const m = t.match(/^\s*([A-Za-z]{3,4})\b/);
  const d = await db();
  if (m) {
    const c = m[1].toUpperCase();
    const hit = c.length === 3 ? d.byIata.get(c) : d.byIcao.get(c);
    if (hit) return hit;
  }
  return (await searchAirports(t, 1))[0] || null;
}

export async function searchAirlines(q: string, limit = 8): Promise<Airline[]> {
  const d = await db();
  const t = q.trim();
  if (!t) return [];
  const up = t.toUpperCase();
  const n = norm(t);
  const scored: [number, Airline][] = [];
  for (const a of d.airlines) {
    let s = 0;
    if (a.iata === up) s = 100;
    else if (a.icao === up) s = 95;
    else if (norm(a.name) === n) s = 90;
    else if (norm(a.name).startsWith(n)) s = 70;
    else if (a.callsign && norm(a.callsign) === n) s = 65;
    else if (n.length > 2 && norm(a.name).includes(n)) s = 40;
    if (!s) continue;
    if (a.active) s += 10;
    if (a.icao) s += 2;
    scored.push([s, a]);
  }
  scored.sort((x, y) => y[0] - x[0] || x[1].name.localeCompare(y[1].name));
  return scored.slice(0, limit).map((x) => x[1]);
}
export async function findAirline(q: string): Promise<Airline | null> {
  return (await searchAirlines(q, 1))[0] || null;
}

/** Split "BA 117", "BAW117", "117" into an airline code and the number. */
export function splitFlightNumber(s: string): { code: string; number: string } {
  const t = s.replace(/\s+/g, "").toUpperCase();
  const m = t.match(/^([A-Z]{3}|(?:[A-Z]{2}|[A-Z]\d|\d[A-Z])(?=\d))?0*(\d{1,4}[A-Z]?)$/);
  if (m) return { code: m[1] || "", number: m[2] };
  return { code: "", number: t.replace(/^[A-Z]{2,3}/, "") || t };
}

// ------------------------------------------------------------------ time
const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    dtfCache.set(tz, f);
  }
  return f;
}
/** Offset of `tz` from UTC at instant `t`, in minutes. */
export function tzOffset(t: number, tz: string) {
  try {
    const p = Object.fromEntries(dtf(tz).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((asUtc - Math.floor(t / 1000) * 1000) / 60000);
  } catch {
    return 0;
  }
}
/** Local wall time (YYYY-MM-DD + HH:MM) in `tz` → UTC milliseconds. */
export function localToUtc(date: string, time: string, tz: string): number | null {
  const d = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const h = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!d || !h) return null;
  const guess = Date.UTC(+d[1], +d[2] - 1, +d[3], +h[1], +h[2]);
  let t = guess - tzOffset(guess, tz) * 60000;
  t = guess - tzOffset(t, tz) * 60000;
  return t;
}
/** UTC milliseconds → { date, time } local in `tz`. */
export function utcToLocal(t: number, tz: string) {
  const p = Object.fromEntries(dtf(tz).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${String(+p.hour % 24).padStart(2, "0")}:${p.minute}` };
}
export function tzAbbr(t: number, tz: string) {
  try {
    const s = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(t)).find((x) => x.type === "timeZoneName")?.value || "";
    return s;
  } catch {
    return "";
  }
}
export function fmtOffset(min: number) {
  const s = min < 0 ? "−" : "+";
  const a = Math.abs(min);
  return `${s}${Math.floor(a / 60)}${a % 60 ? ":" + String(a % 60).padStart(2, "0") : ""}`;
}
export function fmtDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
export function fmtDate(date: string, style: "long" | "short" | "day" = "long") {
  const d = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!d) return date;
  const t = new Date(Date.UTC(+d[1], +d[2] - 1, +d[3], 12));
  const o: Intl.DateTimeFormatOptions =
    style === "long" ? { weekday: "short", day: "numeric", month: "short", year: "numeric" } : style === "short" ? { day: "numeric", month: "short", year: "numeric" } : { weekday: "short", day: "numeric", month: "short" };
  return new Intl.DateTimeFormat("en-GB", { ...o, timeZone: "UTC" }).format(t);
}
export function fmtTime(hhmm: string, h12: boolean) {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || !h12) return hhmm;
  const h = +m[1];
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}
export function normTime(s: string): string {
  const t = s.trim().toLowerCase().replace(/\s+/g, "");
  let m = t.match(/^(\d{1,2})(?::|\.|h)?(\d{2})?(am|pm|a|p)?$/);
  if (!m) return "";
  let h = +m[1];
  const mi = m[2] ? +m[2] : 0;
  if (m[3]) {
    if (h === 12) h = 0;
    if (m[3].startsWith("p")) h += 12;
  }
  if (h > 23 || mi > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ distance
const R_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Typical gate-to-gate time for a distance, when nothing better is known. */
export function estimateMinutes(km: number) {
  return Math.round(km / 13.3 + 32); // ~800 km/h cruise plus taxi, climb and descent
}

// ------------------------------------------------------------------ derived values
export interface Derived {
  depUtc: number | null;
  arrUtc: number | null;
  arrDate: string;
  durationMin: number | null;
  distanceKm: number;
  estimated: boolean; // arrival time is an estimate
  dayShift: number; // arrival date − departure date (local)
  tzDiffMin: number; // arrival offset − departure offset
  code: string; // BA 117
}
export function derive(f: Flight): Derived {
  const depUtc = localToUtc(f.date, f.depTime, f.from.tz);
  const km = distanceKm(f.from, f.to);
  let arrUtc: number | null = null;
  let estimated = false;
  let arrDate = f.arrDate || "";
  if (f.arrTime && depUtc != null) {
    if (arrDate) arrUtc = localToUtc(arrDate, f.arrTime, f.to.tz);
    if (arrUtc == null || arrUtc <= depUtc || arrUtc - depUtc > 30 * 3600e3) {
      // pick the arrival date that gives a sensible flight time
      const expect = estimateMinutes(km);
      let best: number | null = null;
      for (const shift of [-1, 0, 1, 2]) {
        const d = addDays(f.date, shift);
        const t = localToUtc(d, f.arrTime, f.to.tz);
        if (t == null || t <= depUtc) continue;
        if (best == null || Math.abs((t - depUtc) / 60000 - expect) < Math.abs((best - depUtc) / 60000 - expect)) {
          best = t;
          arrDate = d;
        }
      }
      arrUtc = best;
    }
  } else if (depUtc != null) {
    arrUtc = depUtc + estimateMinutes(km) * 60000;
    estimated = true;
    arrDate = utcToLocal(arrUtc, f.to.tz).date;
  }
  const tzDiffMin = depUtc != null ? tzOffset(arrUtc ?? depUtc, f.to.tz) - tzOffset(depUtc, f.from.tz) : 0;
  const dayShift = arrDate ? Math.round((Date.parse(arrDate + "T00:00Z") - Date.parse(f.date + "T00:00Z")) / 86400e3) : 0;
  return {
    depUtc,
    arrUtc,
    arrDate,
    durationMin: depUtc != null && arrUtc != null ? Math.round((arrUtc - depUtc) / 60000) : null,
    distanceKm: km,
    estimated,
    dayShift,
    tzDiffMin,
    code: `${f.airline.iata || f.airline.icao} ${f.number}`.trim(),
  };
}
export function addDays(date: string, n: number) {
  const t = Date.parse(date + "T12:00Z") + n * 86400e3;
  return new Date(t).toISOString().slice(0, 10);
}
export function estimatedArrival(f: Flight) {
  const d = derive({ ...f, arrTime: "" });
  return d.arrUtc != null ? utcToLocal(d.arrUtc, f.to.tz) : null;
}

// ------------------------------------------------------------------ units
export type Units = "imperial" | "metric";
export function defaultUnits(): Units {
  try {
    const loc = navigator.language || "en-US";
    return /^en-(US|LR)|^my/i.test(loc) ? "imperial" : "metric";
  } catch {
    return "imperial";
  }
}
export function fmtDistance(km: number, u: Units) {
  const mi = km * 0.621371;
  const n = (x: number) => Math.round(x).toLocaleString("en-US");
  return u === "imperial" ? `${n(mi)} mi` : `${n(km)} km`;
}
export function fmtDistanceAlt(km: number, u: Units) {
  return fmtDistance(km, u === "imperial" ? "metric" : "imperial");
}
export function fmtTemp(c: number, u: Units) {
  return u === "imperial" ? `${Math.round((c * 9) / 5 + 32)}°F` : `${Math.round(c)}°C`;
}

/** WMO weather codes → words and a small emoji-free glyph name. */
export function weatherText(code: number) {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorm";
}

/** A title like "BOS → LHR · BA 117". */
export function flightTitle(f: Flight) {
  return `${f.from.iata || f.from.icao} → ${f.to.iata || f.to.icao} · ${derive(f).code}`;
}

/** Plain Markdown summary (readable without the plug-in, and searchable). */
export function flightMarkdown(f: Flight, u: Units = "imperial") {
  const d = derive(f);
  const L: string[] = [];
  L.push(`**${f.airline.name} ${d.code}** · ${fmtDate(f.date)}`);
  L.push("");
  L.push(`${f.from.city || f.from.name} (${f.from.iata}) → ${f.to.city || f.to.name} (${f.to.iata})`);
  L.push("");
  const row = (k: string, v?: string | null) => v && L.push(`- ${k}: ${v}`);
  row("Departs", `${f.depTime} ${d.depUtc != null ? tzAbbr(d.depUtc, f.from.tz) : ""} · ${f.from.name}${f.depTerminal ? ` · Terminal ${f.depTerminal}` : ""}${f.depGate ? ` · Gate ${f.depGate}` : ""}`);
  const arr = f.arrTime || (d.arrUtc != null ? utcToLocal(d.arrUtc, f.to.tz).time : "");
  row("Arrives", `${arr}${d.estimated ? " (estimated)" : ""} ${d.arrUtc != null ? tzAbbr(d.arrUtc, f.to.tz) : ""}${d.dayShift ? ` (${d.dayShift > 0 ? "+" : ""}${d.dayShift} day)` : ""} · ${f.to.name}${f.arrTerminal ? ` · Terminal ${f.arrTerminal}` : ""}`);
  if (d.durationMin != null) row("Flight time", `${d.estimated ? "about " : ""}${fmtDuration(d.durationMin)}`);
  row("Distance", `${fmtDistance(d.distanceKm, u)} (${fmtDistanceAlt(d.distanceKm, u)})`);
  row("Aircraft", [f.aircraft, f.reg].filter(Boolean).join(" · "));
  row("Seat", [f.seat, f.cabin].filter(Boolean).join(" · "));
  row("Booking", f.booking);
  row("Status", f.status);
  if (f.notes) L.push("", f.notes);
  return L.join("\n");
}

export const REQUIRED: (keyof FlightInput)[] = ["date", "depTime", "airline", "number", "from", "to"];
export const blankInput = (): FlightInput => ({ date: "", depTime: "", arrTime: "", airline: "", number: "", from: "", to: "", aircraft: "", reg: "", seat: "", cabin: "", booking: "", notes: "" });

/** Turn a stored flight back into form input (for "Edit"). */
export function inputOf(f: Flight): FlightInput {
  return {
    date: f.date,
    depTime: f.depTime,
    arrTime: f.sources.arrTime === "you" ? f.arrTime : "",
    airline: f.airline.iata ? `${f.airline.name} (${f.airline.iata})` : f.airline.name,
    number: f.number,
    from: f.from.iata,
    to: f.to.iata,
    aircraft: f.sources.aircraft === "you" ? f.aircraft || "" : "",
    reg: f.sources.reg === "you" ? f.reg || "" : "",
    seat: f.seat || "",
    cabin: f.cabin || "",
    booking: f.booking || "",
    notes: f.notes || "",
  };
}

/** Deterministic accent colour for an airline without a logo. */
export function hashColor(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hues = [210, 355, 25, 160, 265, 195, 330, 140];
  return hslHex(hues[h % hues.length], 55, 38);
}
export function hslHex(h: number, s: number, l: number) {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}
