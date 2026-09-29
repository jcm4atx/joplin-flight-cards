/**
 * The flight card as self-contained HTML with inline styles, so the same card
 * works in Scute (rendered by the plug-in) and inside a Joplin note body.
 */
import { SOURCE_LABEL, derive, fmtDate, fmtDistance, fmtDistanceAlt, fmtDuration, fmtOffset, fmtTemp, fmtTime, tzAbbr, utcToLocal, weatherText, countryName, type Flight, type Source, type Units } from "./model";

export interface CardOpts {
  units: Units;
  h12: boolean;
  dark?: boolean;
  /** Inline <svg> markup for the map, or an image URL (Joplin resource :/id or data: URL). */
  mapSvg?: string;
  mapSrc?: string;
  logoSrc?: string;
  /** Show the aircraft photo (it's loaded from the photographer's site). */
  photo?: boolean;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const safeUrl = (u?: string) => (u && /^(https?:|data:image\/|:\/)/i.test(u) ? u : "");

interface Pal {
  bg: string;
  fg: string;
  muted: string;
  line: string;
  soft: string;
  good: string;
  warn: string;
}
const LIGHT: Pal = { bg: "#fffdf8", fg: "#1c232b", muted: "#69727c", line: "#e6e1d6", soft: "#f5f1e8", good: "#2f7a4f", warn: "#a2560f" };
const DARK: Pal = { bg: "#172029", fg: "#e9eef2", muted: "#98a4ae", line: "#2a3844", soft: "#1e2a35", good: "#6cc393", warn: "#e3a15a" };

/** Minutes between two "YYYY-MM-DD HH:MM" local stamps in the same zone. */
function diffMin(a?: string, b?: string) {
  if (!a || !b) return null;
  const p = (s: string) => Date.parse(s.replace(" ", "T") + ":00Z");
  const x = p(a),
    y = p(b);
  return isNaN(x) || isNaN(y) ? null : Math.round((x - y) / 60000);
}

export function flightCardHtml(f: Flight, o: CardOpts) {
  const P = o.dark ? DARK : LIGHT;
  const d = derive(f);
  const accent = /^#[0-9a-f]{6}$/i.test(f.color || "") ? f.color! : "#1f5d8c";
  const mono = "ui-monospace,SFMono-Regular,'JetBrains Mono',Menlo,Consolas,monospace";
  const sans = "'General Sans','Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
  const t = (hhmm: string) => fmtTime(hhmm, o.h12);
  const arrTime = f.arrTime || (d.arrUtc != null ? utcToLocal(d.arrUtc, f.to.tz).time : "");
  const depZone = d.depUtc != null ? tzAbbr(d.depUtc, f.from.tz) : "";
  const arrZone = d.arrUtc != null ? tzAbbr(d.arrUtc, f.to.tz) : "";
  const logo = safeUrl(o.logoSrc || f.logo);

  const label = (s: string) => `<div style="font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:${P.muted};font-weight:600;margin-bottom:3px">${esc(s)}</div>`;
  const chip = (s: string) => `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${P.soft};border:1px solid ${P.line};font-size:12px;margin:2px 4px 0 0;white-space:nowrap">${s}</span>`;
  const actual = (sched: string | undefined, act: string | undefined, verb: string) => {
    if (!act) return "";
    const late = diffMin(act, sched || "");
    const hhmm = act.slice(11, 16);
    const col = late != null && late > 14 ? P.warn : P.good;
    const note = late == null ? "" : late > 0 ? ` (${fmtDuration(late)} late)` : late < 0 ? ` (${fmtDuration(-late)} early)` : " (on time)";
    return `<div style="font-size:12px;color:${col};margin-top:2px;font-weight:600">${esc(verb)} ${esc(t(hhmm))}${esc(note)}</div>`;
  };
  const place = (side: "dep" | "arr") => {
    const a = side === "dep" ? f.from : f.to;
    const time = side === "dep" ? f.depTime : arrTime;
    const zone = side === "dep" ? depZone : arrZone;
    const date = side === "dep" ? f.date : d.arrDate || f.date;
    const term = side === "dep" ? f.depTerminal : f.arrTerminal;
    const gate = side === "dep" ? f.depGate : f.arrGate;
    const est = side === "arr" && d.estimated;
    const align = side === "dep" ? "left" : "right";
    const chips = [term && chip(`Terminal ${esc(term)}`), gate && chip(`Gate ${esc(gate)}`), side === "arr" && f.baggage && chip(`Bags ${esc(f.baggage)}`)].filter(Boolean).join("");
    const shift = side === "arr" && d.dayShift ? `<sup style="font-size:12px;color:${accent};font-weight:700;margin-left:3px">${d.dayShift > 0 ? "+" : ""}${d.dayShift}</sup>` : "";
    return (
      `<div style="flex:1 1 0;min-width:0;text-align:${align}">` +
      `<div style="font-family:${mono};font-size:40px;line-height:1;font-weight:700;letter-spacing:.02em">${esc(a.iata || a.icao)}</div>` +
      `<div style="font-size:14px;font-weight:600;margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.city || a.name)}</div>` +
      `<div style="font-size:12px;color:${P.muted};overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(a.name)}">${esc(a.name)}${a.country ? ", " + esc(countryName(a.country)) : ""}</div>` +
      `<div style="margin-top:10px;font-size:24px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1;white-space:nowrap">${est ? `<span style="color:${P.muted};font-weight:500">≈</span> ` : ""}${esc(t(time))}${shift}</div>` +
      `<div style="font-size:12px;color:${P.muted}">${esc(zone)}${zone ? " · " : ""}${esc(fmtDate(date, "day"))}${est ? " · estimated" : ""}</div>` +
      actual(side === "dep" ? f.depSched : f.arrSched, side === "dep" ? f.depActual : f.arrActual, side === "dep" ? "Departed" : "Arrived") +
      (chips ? `<div style="margin-top:6px">${chips}</div>` : "") +
      `</div>`
    );
  };
  const mid =
    `<div style="flex:0 0 auto;width:30%;max-width:190px;text-align:center;padding-top:10px">` +
    `<div style="font-size:13px;font-weight:600;font-variant-numeric:tabular-nums">${d.durationMin != null ? (d.estimated ? "about " : "") + esc(fmtDuration(d.durationMin)) : ""}</div>` +
    `<div style="display:flex;align-items:center;gap:6px;margin:6px 0;color:${accent}"><span style="flex:1;border-top:2px dotted ${accent};opacity:.6"></span>` +
    `<svg width="22" height="22" viewBox="0 0 24 24" fill="${accent}" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" transform="rotate(90 12 12)"/></svg>` +
    `<span style="flex:1;border-top:2px dotted ${accent};opacity:.6"></span></div>` +
    `<div style="font-size:12px;color:${P.muted};font-variant-numeric:tabular-nums">${esc(fmtDistance(d.distanceKm, o.units))} · ${esc(fmtDistanceAlt(d.distanceKm, o.units))}</div>` +
    `</div>`;

  const cells: [string, string][] = [];
  const add = (k: string, v?: string | null) => v && cells.push([k, v]);
  add("Aircraft", f.aircraft ? esc(f.aircraft) + (f.aircraftType ? ` <span style="color:${P.muted};font-weight:500">${esc(f.aircraftType)}</span>` : "") : "");
  add("Registration", esc(f.reg || ""));
  add("Seat", esc(f.seat || ""));
  add("Class", esc(f.cabin || ""));
  add("Booking", f.booking ? `<span style="font-family:${mono};letter-spacing:.08em">${esc(f.booking)}</span>` : "");
  add("Status", esc([f.status, f.codeshare].filter(Boolean).join(" · ")));
  add("Call sign", f.callsign ? `<span style="font-family:${mono}">${esc(f.callsign)}</span>` + (f.airline.callsign ? ` <span style="color:${P.muted};font-weight:500">${esc(f.airline.callsign.toUpperCase())}</span>` : "") : "");
  if (d.tzDiffMin) add("Time change", `${esc(fmtOffset(d.tzDiffMin))} h`);
  if (f.weatherDep) add(`Weather ${f.from.iata}`, `${esc(fmtTemp(f.weatherDep.tempC, o.units))} · ${esc(weatherText(f.weatherDep.code))}`);
  if (f.weatherArr) add(`Weather ${f.to.iata}`, `${esc(fmtTemp(f.weatherArr.tempC, o.units))} · ${esc(weatherText(f.weatherArr.code))}`);
  add("Operator", f.owner && f.owner.toLowerCase() !== f.airline.name.toLowerCase() ? esc(f.owner) : "");

  const map = o.mapSvg ? `<div style="line-height:0;border-top:1px solid ${P.line};border-bottom:1px solid ${P.line}">${o.mapSvg.replace("<svg ", '<svg style="display:block;width:100%;height:auto" ')}</div>` : o.mapSrc ? `<div style="line-height:0;border-top:1px solid ${P.line};border-bottom:1px solid ${P.line}"><img src="${esc(safeUrl(o.mapSrc))}" alt="Route map ${esc(f.from.iata)} to ${esc(f.to.iata)}" style="display:block;width:100%;height:auto"></div>` : "";

  const photoUrl = o.photo !== false && f.photo ? safeUrl(f.photo.src) : "";
  const photo = photoUrl
    ? `<div style="display:flex;gap:14px;align-items:flex-start;padding:0 22px 18px;flex-wrap:wrap">` +
      `<a href="${esc(safeUrl(f.photo!.link) || photoUrl)}" style="flex:0 0 auto;line-height:0"><img src="${esc(photoUrl)}" alt="${esc([f.aircraft, f.reg].filter(Boolean).join(" "))}" style="width:220px;max-width:100%;height:auto;border-radius:10px;border:1px solid ${P.line};object-fit:cover"></a>` +
      `<div style="flex:1 1 180px;font-size:12px;color:${P.muted};padding-top:2px">${label("The aircraft")}<div style="color:${P.fg};font-size:14px;font-weight:600">${esc(f.aircraft || "")}${f.reg ? ` · ${esc(f.reg)}` : ""}</div>` +
      `${f.photo!.credit ? `Photo © ${esc(f.photo!.credit)}` : ""}${f.photo!.link ? ` · <a href="${esc(safeUrl(f.photo!.link))}" style="color:${P.muted}">${esc(hostOf(f.photo!.link))}</a>` : ""}${f.photo!.license ? ` · ${esc(f.photo!.license)}` : ""}</div></div>`
    : "";

  const notes = f.notes ? `<div style="padding:0 22px 18px;font-size:14px;line-height:1.5">${label("Notes")}${esc(f.notes).replace(/\r?\n/g, "<br>")}</div>` : "";
  const used = [...new Set(Object.values(f.sources).filter((s): s is Source => !!s && s !== "you" && s !== "computed" && s !== "estimate"))].map((s) => SOURCE_LABEL[s]);
  const footer = `<div style="padding:10px 22px;border-top:1px solid ${P.line};font-size:11px;color:${P.muted};display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><span>${used.length ? "Details from " + esc(used.join(", ")) : "Details you entered"}${d.estimated ? " · arrival estimated from distance" : ""}</span><span>Updated ${esc(fmtDate(new Date(f.updated).toISOString().slice(0, 10), "short"))}</span></div>`;

  const header =
    `<div style="background:${accent};color:#fff;padding:14px 22px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">` +
    (logo
      ? `<div style="flex:0 0 auto;background:#fff;border-radius:10px;padding:4px 8px;line-height:0"><img src="${esc(logo)}" alt="${esc(f.airline.name)}" style="height:34px;width:auto;max-width:120px"></div>`
      : `<div style="flex:0 0 auto;width:42px;height:42px;border-radius:10px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-family:${mono};font-weight:700">${esc(f.airline.iata || f.airline.icao || "✈")}</div>`) +
    `<div style="flex:1 1 160px;min-width:0"><div style="font-size:16px;font-weight:700;line-height:1.2">${esc(f.airline.name)}</div><div style="font-size:12px;opacity:.85">${esc(fmtDate(f.date))}</div></div>` +
    `<div style="flex:0 0 auto;text-align:right"><div style="font-size:10.5px;letter-spacing:.12em;opacity:.8;font-weight:600">FLIGHT</div><div style="font-family:${mono};font-size:22px;font-weight:700;letter-spacing:.04em;white-space:nowrap">${esc(d.code)}</div></div>` +
    `</div>`;

  const grid = cells.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:14px 22px;padding:16px 22px 18px">${cells.map(([k, v]) => `<div style="flex:1 1 140px;min-width:0">${label(k)}<div style="font-size:14px;font-weight:600;overflow-wrap:anywhere">${v}</div></div>`).join("")}</div>`
    : "";

  return (
    `<div class="scute-flight-card" style="font-family:${sans};color:${P.fg};background:${P.bg};border:1px solid ${P.line};border-radius:16px;overflow:hidden;max-width:760px;margin:0 0 16px;box-shadow:0 1px 2px rgba(0,0,0,.05),0 8px 24px rgba(0,0,0,.06)">` +
    header +
    `<div style="display:flex;gap:10px;padding:20px 22px 18px;align-items:flex-start">${place("dep")}${mid}${place("arr")}</div>` +
    map +
    grid +
    photo +
    notes +
    footer +
    `</div>`
  );
}

function hostOf(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
