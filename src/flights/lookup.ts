/**
 * Fills in a flight from what the user typed, trying free public sources (and
 * AeroDataBox if the user has a key). The user's own values always win.
 */
import {
  addDays,
  derive,
  findAirline,
  findAirport,
  hashColor,
  hslHex,
  normTime,
  splitFlightNumber,
  utcToLocal,
  type Airline,
  type Airport,
  type Flight,
  type FlightInput,
  type Source,
} from "./model";

export interface NetResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface Net {
  get(url: string, headers?: Record<string, string>): Promise<NetResponse>;
}
export type AdbHost = "rapidapi" | "apimarket" | "direct";
export interface LookupSettings {
  adbKey?: string;
  adbHost?: AdbHost;
  /** Look things up online at all (off = built-in data and estimates only). */
  online?: boolean;
  /** Save a copy of the airline logo in the card. */
  logos?: boolean;
  photos?: boolean;
  weather?: boolean;
}

export class LookupError extends Error {}

const TIMEOUT = 15000;
async function withTimeout<T>(p: Promise<T>, ms = TIMEOUT): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<T>((_, rej) => (t = setTimeout(() => rej(new Error("timed out")), ms)))]).finally(() => clearTimeout(t));
}
async function getJson(net: Net, url: string, headers?: Record<string, string>): Promise<{ status: number; body: any }> {
  const r = await withTimeout(net.get(url, headers));
  if (r.status === 204) return { status: 204, body: null };
  const txt = await r.text();
  let body: any = null;
  try {
    body = txt ? JSON.parse(txt) : null;
  } catch {
    body = null;
  }
  return { status: r.status, body };
}
function b64(buf: ArrayBuffer) {
  const u8 = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

// ------------------------------------------------------------------ AeroDataBox
const ADB: Record<AdbHost, { base: string; headers: (k: string) => Record<string, string> }> = {
  rapidapi: { base: "https://aerodatabox.p.rapidapi.com", headers: (k) => ({ "X-RapidAPI-Key": k, "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com" }) },
  apimarket: { base: "https://prod.api.market/api/v1/aedbx/aerodatabox", headers: (k) => ({ "x-api-market-key": k }) },
  direct: { base: "https://api.aerodatabox.com", headers: (k) => ({ "X-Api-Key": k }) },
};
const localParts = (t: any): { date: string; time: string } | null => {
  const m = String(t?.local || "").match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return m ? { date: m[1], time: m[2] } : null;
};
export async function testAdbKey(net: Net, key: string, host: AdbHost) {
  const h = ADB[host];
  const r = await withTimeout(net.get(`${h.base}/health/services/feeds/FlightSchedules`, h.headers(key)));
  if (r.status === 401 || r.status === 403) throw new Error("The key was refused");
  if (r.status === 429) throw new Error("Rate limit or quota reached for this key");
  if (r.status >= 400) throw new Error(`AeroDataBox answered ${r.status}`);
  return true;
}

// ------------------------------------------------------------------ colour from a logo
export async function logoColor(dataUrl: string): Promise<string | null> {
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 60;
    c.height = 24;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0, 60, 24);
    const px = g.getImageData(0, 0, 60, 24).data;
    const buckets = new Map<number, { n: number; h: number; s: number; l: number }>();
    for (let i = 0; i < px.length; i += 4) {
      const [r, gg, b, a] = [px[i] / 255, px[i + 1] / 255, px[i + 2] / 255, px[i + 3]];
      if (a < 180) continue;
      const mx = Math.max(r, gg, b),
        mn = Math.min(r, gg, b),
        l = (mx + mn) / 2,
        d = mx - mn;
      if (d < 0.18 || l > 0.92 || l < 0.08) continue; // skip greys, white, black
      const s = d / (1 - Math.abs(2 * l - 1));
      let h = mx === r ? ((gg - b) / d) % 6 : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4;
      h = (h * 60 + 360) % 360;
      const k = Math.round(h / 20);
      const e = buckets.get(k) || { n: 0, h: 0, s: 0, l: 0 };
      e.n++;
      e.h += h;
      e.s += s;
      e.l += l;
      buckets.set(k, e);
    }
    let best: { n: number; h: number; s: number; l: number } | null = null;
    for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
    if (!best || best.n < 12) return null;
    const h = best.h / best.n,
      s = Math.min(75, (best.s / best.n) * 100),
      l = Math.min(42, Math.max(28, (best.l / best.n) * 100));
    return hslHex(h, Math.max(35, s), l);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ the lookup
export interface LookupResult {
  flight: Flight;
  warnings: string[];
}

function guessTz(lon: number) {
  const h = Math.round(lon / 15);
  return h === 0 ? "UTC" : `Etc/GMT${h > 0 ? "-" : "+"}${Math.abs(h)}`;
}

async function airportFrom(q: string, net: Net | null, log: string[]): Promise<{ a: Airport; src: Source } | null> {
  const a = await findAirport(q);
  if (a) return { a, src: "builtin" };
  const code = q.trim().toUpperCase();
  if (net && /^[A-Z]{3,4}$/.test(code)) {
    try {
      const r = await getJson(net, `https://hexdb.io/api/v1/airport/${code.length === 3 ? "iata" : "icao"}/${code}`);
      const j = r.body;
      if (j && typeof j.latitude === "number") {
        log.push(`HexDB: found airport ${code}`);
        return { a: { iata: j.iata || "", icao: j.icao || "", name: j.airport || code, city: j.region_name || "", country: j.country_code || "", lat: j.latitude, lon: j.longitude, tz: guessTz(j.longitude) }, src: "hexdb" };
      }
    } catch (e) {
      log.push(`HexDB airport lookup failed: ${(e as Error).message}`);
    }
  }
  return null;
}

export async function lookupFlight(input: FlightInput, net: Net | null, st: LookupSettings, onStep?: (s: string) => void, prev?: Flight | null): Promise<LookupResult> {
  const log: string[] = [];
  const warnings: string[] = [];
  const src: Partial<Record<string, Source>> = {};
  const step = (s: string) => onStep?.(s);
  if (st.online === false) net = null;

  // ---- what the user typed
  const date = input.date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new LookupError("Enter the date of the flight");
  const depTime = normTime(input.depTime);
  if (!depTime) throw new LookupError("Enter the departure time, like 18:45 or 6:45 pm");
  const arrTyped = input.arrTime ? normTime(input.arrTime) : "";
  if (input.arrTime && !arrTyped) throw new LookupError("The arrival time isn't a time, like 06:40");
  const fn = splitFlightNumber(input.number);
  if (!fn.number || !/^\d/.test(fn.number)) throw new LookupError("Enter the flight number, like 117 or BA117");

  step("Finding the airline");
  const typed = input.airline.trim();
  const codeInName = typed.match(/\(([A-Z0-9]{2,3})\)\s*$/)?.[1];
  let airline: Airline | null = null;
  if (codeInName) airline = await findAirline(codeInName);
  if (!airline && typed) airline = await findAirline(typed);
  if (!airline && fn.code) airline = await findAirline(fn.code);
  if (!airline) {
    if (!typed && !fn.code) throw new LookupError("Enter the airline, by name or code");
    airline = { name: typed || fn.code, iata: /^[A-Z0-9]{2}$/.test(fn.code) ? fn.code : "", icao: /^[A-Z]{3}$/.test(fn.code) ? fn.code : "" };
    warnings.push(`“${typed || fn.code}” isn't in the built-in airline list; it was kept as you typed it.`);
    src.airline = "you";
  } else src.airline = "builtin";
  if (fn.code && airline && fn.code !== airline.iata && fn.code !== airline.icao) warnings.push(`The flight number starts with ${fn.code}, but the airline is ${airline.name} (${airline.iata || airline.icao}).`);

  step("Finding the airports");
  const fromR = await airportFrom(input.from, net, log);
  if (!fromR) throw new LookupError(`Couldn't find the departure airport “${input.from}”. Try its three-letter code.`);
  const toR = await airportFrom(input.to, net, log);
  if (!toR) throw new LookupError(`Couldn't find the arrival airport “${input.to}”. Try its three-letter code.`);
  if (fromR.a === toR.a || (fromR.a.iata && fromR.a.iata === toR.a.iata)) throw new LookupError("The departure and arrival airports are the same");
  src.from = fromR.src;
  src.to = toR.src;

  const f: Flight = {
    v: 1,
    date,
    depTime,
    arrTime: arrTyped,
    airline: { ...airline },
    number: fn.number,
    callsign: airline.icao ? `${airline.icao}${fn.number}` : undefined,
    from: fromR.a,
    to: toR.a,
    aircraft: input.aircraft?.trim() || undefined,
    reg: input.reg?.trim().toUpperCase() || undefined,
    seat: input.seat?.trim() || undefined,
    cabin: input.cabin?.trim() || undefined,
    booking: input.booking?.trim().toUpperCase() || undefined,
    notes: input.notes?.trim() || undefined,
    sources: src,
    updated: Date.now(),
  };
  src.date = "you";
  src.depTime = "you";
  src.number = "you";
  if (arrTyped) src.arrTime = "you";
  if (f.aircraft) src.aircraft = "you";
  if (f.reg) src.reg = "you";
  // keep things found last time that the user can't type (photo, logo…) when refreshing offline
  if (prev) {
    for (const k of ["logo", "color", "photo", "weatherDep", "weatherArr"] as const) if (prev[k] && !net) (f as any)[k] = prev[k];
  }

  const set = <K extends keyof Flight>(k: K, v: Flight[K] | undefined | null | "", s: Source) => {
    if (v == null || v === "") return false;
    if (src[k as string] === "you") return false;
    if (f[k] != null && f[k] !== "" && src[k as string] && src[k as string] !== "builtin" && s !== "aerodatabox") return false;
    (f as any)[k] = v;
    src[k as string] = s;
    return true;
  };

  if (net) {
    // ---- AeroDataBox (live and historical schedules, gates, aircraft)
    if (st.adbKey) {
      step("Asking AeroDataBox");
      const h = ADB[st.adbHost || "rapidapi"];
      const code = `${airline.iata || airline.icao}${fn.number}`;
      try {
        const r = await getJson(net, `${h.base}/flights/number/${encodeURIComponent(code)}/${date}?withAircraftImage=true&withLocation=false&dateLocalRole=Departure`, h.headers(st.adbKey));
        if (r.status === 401 || r.status === 403) warnings.push("AeroDataBox refused the API key (check it in Settings).");
        else if (r.status === 429) warnings.push("AeroDataBox: the key's rate limit or monthly quota was reached.");
        else if (r.status === 204 || (Array.isArray(r.body) && !r.body.length)) log.push(`AeroDataBox: no ${code} on ${date}`);
        else if (r.status >= 400 || !Array.isArray(r.body)) log.push(`AeroDataBox answered ${r.status}`);
        else {
          const legs = r.body as any[];
          const leg =
            legs.find((x) => x.departure?.airport?.iata === f.from.iata && x.arrival?.airport?.iata === f.to.iata) ||
            legs.find((x) => x.departure?.airport?.iata === f.from.iata) ||
            legs.find((x) => x.arrival?.airport?.iata === f.to.iata);
          if (!leg) warnings.push(`AeroDataBox has ${code} on ${date}, but not from ${f.from.iata} to ${f.to.iata} (it flies ${legs.map((x) => `${x.departure?.airport?.iata}–${x.arrival?.airport?.iata}`).join(", ")}).`);
          else {
            log.push("AeroDataBox: found the flight");
            const dep = leg.departure || {},
              arr = leg.arrival || {};
            const ds = localParts(dep.scheduledTime),
              as = localParts(arr.scheduledTime);
            if (ds) {
              f.depSched = `${ds.date} ${ds.time}`;
              if (ds.time !== depTime) warnings.push(`AeroDataBox has it scheduled at ${ds.time}, not ${depTime}. Your time was kept.`);
            }
            if (as) {
              f.arrSched = `${as.date} ${as.time}`;
              if (set("arrTime", as.time, "aerodatabox")) f.arrDate = as.date;
            }
            const da = localParts(dep.runwayTime) || localParts(dep.revisedTime),
              aa = localParts(arr.runwayTime) || localParts(arr.revisedTime) || localParts(arr.predictedTime);
            if (da) f.depActual = `${da.date} ${da.time}`;
            if (aa) f.arrActual = `${aa.date} ${aa.time}`;
            set("depTerminal", dep.terminal, "aerodatabox");
            set("depGate", dep.gate, "aerodatabox");
            set("arrTerminal", arr.terminal, "aerodatabox");
            set("arrGate", arr.gate, "aerodatabox");
            set("baggage", arr.baggageBelt, "aerodatabox");
            set("status", leg.status && leg.status !== "Unknown" ? String(leg.status).replace(/([a-z])([A-Z])/g, "$1 $2") : "", "aerodatabox");
            set("callsign", leg.callSign, "aerodatabox");
            if (leg.codeshareStatus === "IsCodeshared") f.codeshare = "Codeshare";
            const ac = leg.aircraft || {};
            set("aircraft", ac.model, "aerodatabox");
            set("reg", ac.reg, "aerodatabox");
            set("modeS", ac.modeS, "aerodatabox");
            if (ac.image?.url) {
              f.photo = { src: ac.image.url, link: ac.image.webUrl, credit: ac.image.author, license: ac.image.license };
              src.photo = "aerodatabox";
            }
            if (leg.airline?.name && src.airline !== "you") {
              f.airline = { ...f.airline, name: f.airline.name || leg.airline.name, iata: f.airline.iata || leg.airline.iata || "", icao: f.airline.icao || leg.airline.icao || "" };
            }
          }
        }
      } catch (e) {
        log.push(`AeroDataBox failed: ${(e as Error).message}`);
        warnings.push("Couldn't reach AeroDataBox; free sources were used instead.");
      }
    }

    // ---- published route (adsbdb): a sanity check, and airline details
    step("Checking the route");
    const cs = [airline.icao && `${airline.icao}${fn.number}`, airline.iata && `${airline.iata}${fn.number}`].filter(Boolean) as string[];
    for (const c of cs) {
      try {
        const r = await getJson(net, `https://api.adsbdb.com/v0/callsign/${encodeURIComponent(c)}`);
        const fr = r.body?.response?.flightroute;
        if (!fr) continue;
        const o = fr.origin?.iata_code,
          d = fr.destination?.iata_code;
        f.routeCheck = `${o}–${d}`;
        if (o === f.from.iata && d === f.to.iata) {
          log.push(`adsbdb: ${c} is published as ${o}–${d}`);
          src.route = "adsbdb";
        }
        else if (o && d) log.push(`adsbdb: ${c} is currently published as ${o}–${d} (routes change; yours was kept)`);
        if (fr.airline) {
          if (!f.airline.callsign && fr.airline.callsign) f.airline.callsign = fr.airline.callsign;
          if (!f.airline.country && fr.airline.country) f.airline.country = fr.airline.country;
          if (!f.airline.icao && fr.airline.icao) f.airline.icao = fr.airline.icao;
          if (src.airline === "you" && fr.airline.name) {
            f.airline.name = fr.airline.name;
            f.airline.iata ||= fr.airline.iata || "";
            src.airline = "adsbdb";
          }
        }
        if (fr.callsign_icao) {
          if (!f.callsign) f.callsign = fr.callsign_icao;
          if (fr.callsign_icao === f.callsign) src.callsign = "adsbdb";
        }
        break;
      } catch (e) {
        log.push(`adsbdb route lookup failed: ${(e as Error).message}`);
        break;
      }
    }

    // ---- the aircraft (registration → type, owner, photo)
    if (f.reg) {
      step("Looking up the aircraft");
      try {
        const r = await getJson(net, `https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(f.reg)}`);
        const ac = r.body?.response?.aircraft;
        if (ac) {
          log.push(`adsbdb: aircraft ${f.reg} — ${ac.manufacturer} ${ac.type}`);
          set("aircraft", [ac.manufacturer, ac.type].filter(Boolean).join(" ").replace(/^(\w+) \1\b/, "$1"), "adsbdb");
          set("aircraftType", ac.icao_type, "adsbdb");
          set("owner", ac.registered_owner, "adsbdb");
          set("modeS", ac.mode_s, "adsbdb");
          if (!f.photo && ac.url_photo_thumbnail && st.photos !== false) {
            f.photo = { src: ac.url_photo_thumbnail, link: ac.url_photo || undefined, credit: "airport-data.com" };
            src.photo = "adsbdb";
          }
        } else log.push(`adsbdb: no aircraft ${f.reg}`);
      } catch (e) {
        log.push(`adsbdb aircraft lookup failed: ${(e as Error).message}`);
      }
      if (st.photos !== false && (!f.photo || src.photo === "adsbdb")) {
        try {
          const r = await getJson(net, `https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(f.reg)}`);
          const p = r.body?.photos?.[0];
          if (p?.thumbnail_large?.src) {
            f.photo = { src: p.thumbnail_large.src, link: p.link, credit: p.photographer };
            src.photo = "planespotters";
            log.push("Planespotters: found a photo");
          }
        } catch (e) {
          log.push(`Planespotters failed: ${(e as Error).message}`);
        }
      }
    }
    if (st.photos === false) {
      delete f.photo;
      delete src.photo;
    }

    // ---- airline logo (kept in the note so the card works offline)
    if (st.logos !== false && f.airline.iata) {
      step("Fetching the airline logo");
      try {
        const r = await withTimeout(net.get(`https://pics.avs.io/200/80/${f.airline.iata}.png`));
        const ct = r.headers.get("content-type") || "";
        if (r.status === 200 && ct.startsWith("image/")) {
          const buf = await r.arrayBuffer();
          if (buf.byteLength > 400 && buf.byteLength < 200_000) {
            f.logo = `data:image/png;base64,${b64(buf)}`;
            src.logo = "builtin";
          }
        }
      } catch (e) {
        log.push(`Logo failed: ${(e as Error).message}`);
      }
    }
  }
  f.color = (f.logo && (await logoColor(f.logo))) || f.color || hashColor(f.airline.name || f.airline.iata);

  // ---- derived times
  const d = derive(f);
  if (!f.arrTime && d.arrUtc != null) src.arrTime = "estimate";
  if (f.arrTime && !f.arrDate) f.arrDate = d.arrDate;
  if (!f.arrTime) f.arrDate = d.arrDate;

  // ---- weather at both ends (Open-Meteo, no key)
  if (net && st.weather !== false && d.depUtc != null && d.arrUtc != null) {
    step("Checking the weather");
    const today = new Date().toISOString().slice(0, 10);
    const wx = async (a: Airport, t: number) => {
      const loc = utcToLocal(t, a.tz);
      if (loc.date > addDays(today, 15)) return undefined;
      const base = loc.date >= addDays(today, -60) ? "https://api.open-meteo.com/v1/forecast" : "https://archive-api.open-meteo.com/v1/archive";
      const r = await getJson(net!, `${base}?latitude=${a.lat.toFixed(3)}&longitude=${a.lon.toFixed(3)}&start_date=${loc.date}&end_date=${loc.date}&hourly=temperature_2m,weather_code&timezone=${encodeURIComponent(a.tz.startsWith("Etc/") ? "GMT" : a.tz)}`);
      const hr = r.body?.hourly;
      if (!hr?.time) return undefined;
      const i = Math.min(hr.time.length - 1, +loc.time.slice(0, 2));
      const tempC = hr.temperature_2m?.[i],
        code = hr.weather_code?.[i];
      return typeof tempC === "number" && typeof code === "number" ? { tempC, code } : undefined;
    };
    try {
      const [w1, w2] = await Promise.all([wx(f.from, d.depUtc), wx(f.to, d.arrUtc)]);
      if (w1) f.weatherDep = w1;
      if (w2) f.weatherArr = w2;
      if (w1 || w2) src.weather = "openmeteo";
    } catch (e) {
      log.push(`Weather failed: ${(e as Error).message}`);
    }
  }
  src.distance = "computed";
  f.log = log;
  f.sources = src;
  f.updated = Date.now();
  return { flight: f, warnings };
}
