/**
 * Route maps as SVG strings: land from Natural Earth, a great-circle arc, the
 * two airports. Works offline; the same SVG goes into Scute cards and Joplin
 * notes (as an image resource).
 */
import { db, type RefData } from "./model";

type Pt = { lat: number; lon: number };
type Land = { scale: number; rings: number[][] };
interface Ring {
  pts: Float32Array; // lon, lat pairs
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
const decoded = new WeakMap<Land, Ring[]>();
function rings(land: Land): Ring[] {
  let r = decoded.get(land);
  if (r) return r;
  r = land.rings.map((flat) => {
    const pts = new Float32Array(flat.length);
    let x = 0,
      y = 0,
      minX = 1e9,
      maxX = -1e9,
      minY = 1e9,
      maxY = -1e9;
    for (let i = 0; i < flat.length; i += 2) {
      x += flat[i];
      y += flat[i + 1];
      const lx = x / land.scale,
        ly = y / land.scale;
      pts[i] = lx;
      pts[i + 1] = ly;
      if (lx < minX) minX = lx;
      if (lx > maxX) maxX = lx;
      if (ly < minY) minY = ly;
      if (ly > maxY) maxY = ly;
    }
    return { pts, minX, maxX, minY, maxY };
  });
  decoded.set(land, r);
  return r;
}

const rad = Math.PI / 180;
/** Points along the great circle from a to b (longitudes unwrapped so the line is continuous). */
export function greatCircle(a: Pt, b: Pt, n = 96): Pt[] {
  const toV = (p: Pt) => [Math.cos(p.lat * rad) * Math.cos(p.lon * rad), Math.cos(p.lat * rad) * Math.sin(p.lon * rad), Math.sin(p.lat * rad)];
  const va = toV(a),
    vb = toV(b);
  const dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const om = Math.acos(dot);
  const out: Pt[] = [];
  let prevLon = a.lon;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let v: number[];
    if (om < 1e-6) v = va;
    else {
      const s1 = Math.sin((1 - t) * om) / Math.sin(om),
        s2 = Math.sin(t * om) / Math.sin(om);
      v = [s1 * va[0] + s2 * vb[0], s1 * va[1] + s2 * vb[1], s1 * va[2] + s2 * vb[2]];
    }
    const lat = Math.atan2(v[2], Math.hypot(v[0], v[1])) / rad;
    let lon = Math.atan2(v[1], v[0]) / rad;
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    prevLon = lon;
    out.push({ lat, lon });
  }
  return out;
}

export interface MapTheme {
  sea: string;
  land: string;
  coast: string;
  grid: string;
  route: string;
  dot: string;
  label: string;
  halo: string;
}
export const LIGHT: MapTheme = { sea: "#e6edf1", land: "#fbfaf6", coast: "#c9d2d6", grid: "#d6e0e5", route: "#1f5d8c", dot: "#1f2a33", label: "#1f2a33", halo: "#fbfaf6" };
export const DARK: MapTheme = { sea: "#0f1b24", land: "#1d2a34", coast: "#2c3c48", grid: "#18262f", route: "#7fb8e0", dot: "#e8eef2", label: "#e8eef2", halo: "#0f1b24" };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

interface View {
  lon0: number;
  lon1: number;
  lat0: number;
  lat1: number;
  k: number; // cos(mid lat)
  sx: number; // px per projected degree
  W: number;
  H: number;
}
function fitView(pts: Pt[], W: number, H: number, pad = 0.22, minSpan = 5): View {
  let lon0 = Infinity,
    lon1 = -Infinity,
    lat0 = Infinity,
    lat1 = -Infinity;
  for (const p of pts) {
    lon0 = Math.min(lon0, p.lon);
    lon1 = Math.max(lon1, p.lon);
    lat0 = Math.min(lat0, p.lat);
    lat1 = Math.max(lat1, p.lat);
  }
  const midLat = Math.max(-70, Math.min(70, (lat0 + lat1) / 2));
  const k = Math.cos(midLat * rad);
  let w = Math.max((lon1 - lon0) * k, minSpan);
  let h = Math.max(lat1 - lat0, minSpan * 0.5);
  w *= 1 + pad * 2;
  h *= 1 + pad * 2.4;
  // match the aspect ratio
  if (w / h > W / H) h = (w * H) / W;
  else w = (h * W) / H;
  if (w > 360 * k * 1.1) {
    w = 360 * k * 1.1;
    h = (w * H) / W;
  }
  const cx = ((lon0 + lon1) / 2) * k,
    cy = (lat0 + lat1) / 2;
  let top = cy + h / 2,
    bottom = cy - h / 2;
  if (top > 84) {
    bottom -= top - 84;
    top = 84;
  }
  if (bottom < -80) {
    top += -80 - bottom;
    bottom = -80;
  }
  return { lon0: cx / k - w / (2 * k), lon1: cx / k + w / (2 * k), lat0: bottom, lat1: top, k, sx: W / w, W, H };
}
const px = (v: View, lon: number) => (lon - v.lon0) * v.k * v.sx;
const py = (v: View, lat: number) => (v.lat1 - lat) * v.sx;

function landPath(v: View, land: Land) {
  const out: string[] = [];
  for (const shift of [-360, 0, 360]) {
    if (v.lon1 < -180 + shift - 1 || v.lon0 > 180 + shift + 1) continue;
    for (const r of rings(land)) {
      if (r.maxX + shift < v.lon0 || r.minX + shift > v.lon1 || r.maxY < v.lat0 || r.minY > v.lat1) continue;
      let d = "";
      let lx = NaN,
        ly = NaN;
      for (let i = 0; i < r.pts.length; i += 2) {
        const x = px(v, r.pts[i] + shift),
          y = py(v, r.pts[i + 1]);
        if (i && Math.abs(x - lx) < 0.9 && Math.abs(y - ly) < 0.9 && i < r.pts.length - 2) continue;
        d += (d ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
        lx = x;
        ly = y;
      }
      if (d) out.push(d + "Z");
    }
  }
  return out.join("");
}

function graticule(v: View, step: number) {
  let d = "";
  for (let lon = Math.ceil(v.lon0 / step) * step; lon <= v.lon1; lon += step) d += `M${px(v, lon).toFixed(1)} 0V${v.H}`;
  for (let lat = Math.ceil(v.lat0 / step) * step; lat <= v.lat1; lat += step) d += `M0 ${py(v, lat).toFixed(1)}H${v.W}`;
  return d;
}

export interface MapOpts {
  W?: number;
  H?: number;
  theme?: MapTheme;
  labels?: boolean;
  plane?: boolean;
  id?: string;
}
/** A map of one route, from → to. */
export async function routeMap(from: Pt & { iata?: string }, to: Pt & { iata?: string }, o: MapOpts = {}) {
  return routeMapWith(await db(), from, to, o);
}
export function routeMapWith(d: RefData, from: Pt & { iata?: string }, to: Pt & { iata?: string }, o: MapOpts = {}) {
  const W = o.W ?? 720,
    H = o.H ?? 260,
    t = o.theme ?? LIGHT;
  const arc = greatCircle(from, to);
  const v = fitView(arc, W, H);
  const land = v.lon1 - v.lon0 > 70 ? d.land110 : d.land;
  const path = arc.map((p, i) => (i ? "L" : "M") + px(v, p.lon).toFixed(1) + " " + py(v, p.lat).toFixed(1)).join("");
  const a = { x: px(v, arc[0].lon), y: py(v, arc[0].lat) };
  const b = { x: px(v, arc[arc.length - 1].lon), y: py(v, arc[arc.length - 1].lat) };
  const span = v.lon1 - v.lon0;
  const step = span > 120 ? 30 : span > 50 ? 15 : span > 20 ? 5 : span > 8 ? 2 : 1;
  let plane = "";
  if (o.plane !== false) {
    const i = Math.floor(arc.length / 2);
    const p1 = arc[i - 1],
      p2 = arc[i + 1];
    const mx = px(v, arc[i].lon),
      my = py(v, arc[i].lat);
    const ang = (Math.atan2(py(v, p2.lat) - py(v, p1.lat), px(v, p2.lon) - px(v, p1.lon)) * 180) / Math.PI;
    // a small plane pointing along +x
    plane = `<g transform="translate(${mx.toFixed(1)} ${my.toFixed(1)}) rotate(${ang.toFixed(1)})"><circle r="11" fill="${t.halo}" opacity=".9"/><path d="M10 0 L8 -1.2 L2 -1.3 L-5 -8 L-7.5 -8 L-3 -1.3 L-8 -1.2 L-11 -4.5 L-12.5 -4.5 L-11.5 0 L-12.5 4.5 L-11 4.5 L-8 1.2 L-3 1.3 L-7.5 8 L-5 8 L2 1.3 L8 1.2 Z" transform="scale(.75) translate(1 0)" fill="${t.route}"/></g>`;
  }
  const lbl = (p: { x: number; y: number }, text: string, other: { x: number; y: number }) => {
    if (o.labels === false || !text) return "";
    const right = p.x <= other.x ? p.x > 60 : p.x > W - 60;
    const x = right ? p.x - 10 : p.x + 10;
    const below = p.y < 26;
    const y = below ? p.y + 18 : p.y - 8;
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${right ? "end" : "start"}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="13" font-weight="700" letter-spacing=".06em" fill="${t.label}" stroke="${t.halo}" stroke-width="3.5" paint-order="stroke" stroke-linejoin="round">${esc(text)}</text>`;
  };
  const dot = (p: { x: number; y: number }) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5.5" fill="${t.halo}"/><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.6" fill="${t.dot}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Route map">` +
    `<rect width="${W}" height="${H}" fill="${t.sea}"/>` +
    `<path d="${graticule(v, step)}" stroke="${t.grid}" stroke-width="1" fill="none"/>` +
    `<path d="${landPath(v, land)}" fill="${t.land}" stroke="${t.coast}" stroke-width=".8" stroke-linejoin="round"/>` +
    `<path d="${path}" fill="none" stroke="${t.halo}" stroke-width="6" stroke-linecap="round" opacity=".8"/>` +
    `<path d="${path}" fill="none" stroke="${t.route}" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="1 0"/>` +
    plane +
    dot(a) +
    dot(b) +
    lbl(a, from.iata || "", b) +
    lbl(b, to.iata || "", a) +
    `</svg>`
  );
}

/** Every route on one map (the flight log's overview). */
export async function routesMap(routes: { from: Pt; to: Pt }[], o: MapOpts & { airports?: (Pt & { iata: string })[] } = {}) {
  const d = await db();
  const W = o.W ?? 900,
    H = o.H ?? 420,
    t = o.theme ?? LIGHT;
  const arcs = routes.map((r) => greatCircle(r.from, r.to, 64));
  const all = arcs.flat();
  const v = all.length ? fitView(all, W, H, 0.12, 20) : fitView([{ lat: -55, lon: -170 }, { lat: 75, lon: 190 }], W, H, 0, 20);
  const land = v.lon1 - v.lon0 > 70 ? d.land110 : d.land;
  const span = v.lon1 - v.lon0;
  const step = span > 120 ? 30 : span > 50 ? 15 : 5;
  // routes may sit either side of the map's centre: shift each by ±360 to fit best
  const cx = (v.lon0 + v.lon1) / 2;
  const paths = arcs
    .map((arc) => {
      const mid = arc[arc.length >> 1].lon;
      const sh = Math.round((cx - mid) / 360) * 360;
      return arc.map((p, i) => (i ? "L" : "M") + px(v, p.lon + sh).toFixed(1) + " " + py(v, p.lat).toFixed(1)).join("");
    })
    .join("");
  const dots = (o.airports || [])
    .map((a) => {
      const sh = Math.round((cx - a.lon) / 360) * 360;
      const x = px(v, a.lon + sh),
        y = py(v, a.lat);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="${t.dot}" stroke="${t.halo}" stroke-width="1.5"><title>${esc(a.iata)}</title></circle>`;
    })
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Map of your flights">` +
    `<rect width="${W}" height="${H}" fill="${t.sea}"/>` +
    `<path d="${graticule(v, step)}" stroke="${t.grid}" stroke-width="1" fill="none"/>` +
    `<path d="${landPath(v, land)}" fill="${t.land}" stroke="${t.coast}" stroke-width=".8" stroke-linejoin="round"/>` +
    `<path d="${paths}" fill="none" stroke="${t.route}" stroke-width="1.8" stroke-linecap="round" opacity=".75"/>` +
    dots +
    `</svg>`
  );
}
