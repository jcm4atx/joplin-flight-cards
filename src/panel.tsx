/** Flight cards for Joplin: the panel. Cards are ordinary notes; the data rides along in an HTML comment. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowLeft, ExternalLink, FolderPlus, Loader2, Plane, Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toaster } from "@/components/ui/toaster";
import { toast } from "@/hooks/use-toast";
import { FlightFlow, FlightLog, FlightSettingsForm, FlightView, type FlightHost, type FlightSettings } from "@/components/flights";
import { flightCardHtml } from "@/flights/card";
import { LIGHT, routeMap } from "@/flights/map";
import { defaultUnits, flightTitle, type Flight } from "@/flights/model";
import type { Net, NetResponse } from "@/flights/lookup";

declare const webviewApi: { postMessage(m: unknown): Promise<any>; onMessage(cb: (m: any) => void): void };
const call = (t: string, args: Record<string, unknown> = {}) => webviewApi.postMessage({ t, ...args });

const MARK = "<!-- scute:flight ";
const blockRe = /<!-- scute:flight ([\s\S]*?) -->\s*$/;
const enc = (o: unknown) => {
  let s = JSON.stringify(o);
  while (s.includes("--")) s = s.replace(/--/g, "-\\u002d");
  return s.replace(/>/g, "\\u003e");
};
interface Meta {
  v: 1;
  flight: Flight;
  res?: { map?: string; logo?: string };
}
interface Item {
  id: string;
  folderId: string;
  flight: Flight;
  meta: Meta;
}
function parse(n: any): Item | null {
  const m = String(n.body || "").match(blockRe);
  if (!m) return null;
  try {
    const meta = JSON.parse(m[1]) as Meta;
    if (meta?.v !== 1 || !meta.flight?.from) return null;
    // (A logo saved as a resource isn't reachable from the panel, so the panel's preview goes without it.)
    return { id: n.id, folderId: n.parent_id, flight: { ...meta.flight }, meta };
  } catch {
    return null;
  }
}

const utf8b64 = (s: string) => {
  const u = new TextEncoder().encode(s);
  let out = "";
  for (let i = 0; i < u.length; i += 0x8000) out += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(out);
};
const unb64 = (s: string) => {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};

/** Match Joplin's light/dark theme using the colours it hands to webviews. */
function applyTheme() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--joplin-background-color").trim();
  const m = bg.match(/^#?([0-9a-f]{6})$/i) || bg.match(/^#?([0-9a-f]{3})$/i);
  let dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  if (m) {
    const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    dark = 0.299 * r + 0.587 * g + 0.114 * b < 128;
  } else {
    const rgb = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgb) dark = 0.299 * +rgb[1] + 0.587 * +rgb[2] + 0.114 * +rgb[3] < 128;
  }
  document.documentElement.classList.toggle("dark", !!dark);
}

// Webview first; the backend fetches when the webview is blocked (CORS).
const net: Net = {
  async get(url, headers = {}) {
    try {
      return await fetch(url, { headers, credentials: "omit", referrerPolicy: "no-referrer" });
    } catch (e) {
      const r = await call("http", { url, headers }).catch(() => null);
      if (!r) throw e;
      const bytes = unb64(r.body || "");
      const res: NetResponse = {
        status: r.status,
        headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? r.type : null) },
        text: async () => new TextDecoder().decode(bytes),
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      };
      return res;
    }
  },
};

type View = { v: "log" } | { v: "add" } | { v: "settings" } | { v: "open"; id: string } | { v: "edit" | "refresh"; id: string };

function App() {
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState("desktop");
  const [folders, setFolders] = useState<{ id: string; title: string; parent_id: string }[]>([]);
  const [folderId, setFolderId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [settings, setSettings] = useState<FlightSettings | null>(null);
  const [view, setView] = useState<View>({ v: "log" });
  const fid = useRef("");
  fid.current = folderId;

  const load = useCallback(async (id?: string) => {
    const r = await call("list", id === undefined ? {} : { folderId: id });
    setFolders(r.folders || []);
    setFolderId(r.folderId || "");
    setPlatform(r.platform || "desktop");
    setItems(((r.notes || []) as any[]).map(parse).filter(Boolean) as Item[]);
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
    void call("settings").then((s) => setSettings({ units: defaultUnits(), h12: /en-US/i.test(navigator.language), online: true, logos: true, photos: true, weather: true, adbKey: "", adbHost: "rapidapi", ...(s || {}) }));
    webviewApi.onMessage((m: any) => {
      const msg = m && m.message !== undefined ? m.message : m;
      if (msg?.t === "changed") void load(fid.current);
    });
  }, [load]);

  const host = useMemo<FlightHost | null>(() => {
    if (!settings) return null;
    const folderPath = (f: { id: string; title: string; parent_id: string }) => {
      const parts = [f.title];
      let p = folders.find((x) => x.id === f.parent_id);
      for (let i = 0; p && i < 8; i++, p = folders.find((x) => x.id === p!.parent_id)) parts.unshift(p.title);
      return parts.join(" / ");
    };
    const h: FlightHost = {
      kind: "joplin",
      destLabel: "Notebook",
      net,
      settings,
      async saveSettings(s) {
        await call("saveSettings", { settings: s });
        setSettings(s);
      },
      destinations: async () => folders.map((f) => ({ id: f.id, title: folderPath(f) })).sort((a, b) => a.title.localeCompare(b.title)),
      defaultDest: () => folderId || settings.lastDest || "",
      async save(f, dest, existingId) {
        const old = existingId ? items.find((x) => x.id === existingId) : null;
        const code = `${f.airline.iata || f.airline.icao || ""}${f.number}`.replace(/[^\w]+/g, "");
        const res: Meta["res"] = {};
        // Route map: a resource on desktop, a data: URL on mobile.
        const svg = await routeMap(f.from, f.to, { W: 720, H: 260, theme: LIGHT });
        const mapB64 = utf8b64(svg);
        res.map = (await call("resource", { name: `${code}-${f.from.iata}-${f.to.iata}-map.svg`, mime: "image/svg+xml", data: mapB64 })) || undefined;
        const stored: Flight = { ...f };
        let logoSrc: string | undefined;
        if (!f.logo && old?.meta.res?.logo) {
          // keep the logo resource from the earlier save
          res.logo = old.meta.res.logo;
          logoSrc = `:/${res.logo}`;
        } else if (f.logo?.startsWith("data:image/")) {
          const [, mime, data] = f.logo.match(/^data:(image\/[\w.+-]+);base64,(.*)$/) || [];
          const id = mime ? await call("resource", { name: `${f.airline.iata || "airline"}-logo.${mime.split("/")[1].replace("svg+xml", "svg")}`, mime, data }) : null;
          if (id) {
            res.logo = id;
            delete stored.logo;
            logoSrc = `:/${id}`;
          }
        }
        const html = flightCardHtml(f, { units: settings.units, h12: settings.h12, dark: false, mapSrc: res.map ? `:/${res.map}` : `data:image/svg+xml;base64,${mapB64}`, logoSrc, photo: settings.photos });
        const meta: Meta = { v: 1, flight: stored, res };
        const body = `${html.replace(/\n+/g, " ")}\n\n${MARK}${enc(meta)} -->\n`;
        const title = flightTitle(f);
        let id = existingId;
        if (existingId) await call("put", { id: existingId, title, body });
        else id = await call("post", { parent_id: dest.id, title, body });
        const stale = [old?.meta.res?.map, old?.meta.res?.logo].filter((x) => x && x !== res.map && x !== res.logo);
        if (stale.length) await call("deleteResources", { ids: stale });
        if (dest.id !== folderId && !existingId) await load(dest.id);
        else await load(fid.current);
        return id!;
      },
      dark: () => document.documentElement.classList.contains("dark"),
    };
    return h;
  }, [settings, folders, folderId, items, load]);

  if (loading || !host)
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );

  const cur = "id" in view ? items.find((x) => x.id === view.id) : null;
  const back = () => setView({ v: "log" });

  let body;
  if (view.v === "settings") body = <FlightSettingsForm host={host} onDone={back} />;
  else if (view.v === "add") body = <FlightFlow host={host} onCancel={back} onDone={(id) => (toast({ title: "Flight card created" }), setView({ v: "open", id }))} />;
  else if ((view.v === "edit" || view.v === "refresh") && cur)
    body = (
      <FlightFlow
        key={view.v + cur.id}
        host={host}
        existing={{ id: cur.id, flight: cur.flight, destId: cur.folderId }}
        startWith={view.v === "edit" ? "review" : "refresh"}
        onCancel={() => setView({ v: "open", id: cur.id })}
        onDone={(id) => (toast({ title: "Flight card saved" }), setView({ v: "open", id }))}
      />
    );
  else if (view.v === "open" && cur)
    body = (
      <FlightView
        flight={cur.flight}
        host={host}
        writable
        onEdit={() => setView({ v: "edit", id: cur.id })}
        onRefresh={() => setView({ v: "refresh", id: cur.id })}
        onDelete={async () => {
          if (!confirm(`Delete the note for ${flightTitle(cur.flight)}?`)) return;
          await call("delete", { id: cur.id });
          await call("deleteResources", { ids: [cur.meta.res?.map, cur.meta.res?.logo].filter(Boolean) });
          back();
          void load(fid.current);
        }}
        extra={
          <Button variant="outline" size="sm" onClick={() => void call("openNote", { id: cur.id })} data-testid="button-open-note">
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open the note
          </Button>
        }
      />
    );
  else
    body = folderId ? (
      <FlightLog title={folders.find((f) => f.id === folderId)?.title} flights={items} host={host} onOpen={(id) => setView({ v: "open", id })} onAdd={() => setView({ v: "add" })} />
    ) : (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm">
        <Plane className="mx-auto h-7 w-7 text-muted-foreground" />
        <p className="mt-2 font-medium">Pick the notebook for your flight cards</p>
        <p className="text-muted-foreground">Or add a flight and choose a notebook as you save it.</p>
        <Button className="mt-3" onClick={() => setView({ v: "add" })} data-testid="button-empty-add">
          <Plus className="mr-1.5 h-4 w-4" /> Add a flight
        </Button>
      </div>
    );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl p-3 sm:p-4 space-y-4">
        <header className="flex flex-wrap items-center gap-2">
          {view.v !== "log" ? (
            <Button variant="ghost" size="sm" onClick={back} data-testid="button-back">
              <ArrowLeft className="mr-1 h-4 w-4" /> All flights
            </Button>
          ) : (
            <div className="flex items-center gap-2 font-semibold">
              <Plane className="h-4 w-4" /> Flight cards
            </div>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {view.v === "log" && (
              <>
                <Select value={folderId || "__none"} onValueChange={(v) => (setLoading(true), void load(v === "__none" ? "" : v))}>
                  <SelectTrigger className="h-8 w-44 text-xs" data-testid="select-folder">
                    <SelectValue placeholder="Notebook" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Choose a notebook…</SelectItem>
                    {folders.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="New notebook"
                  onClick={async () => {
                    const t = prompt("Name of the new notebook", "Flights");
                    if (!t?.trim()) return;
                    const id = await call("createFolder", { title: t.trim() });
                    setLoading(true);
                    await load(id);
                  }}
                  data-testid="button-new-folder"
                >
                  <FolderPlus className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" title="Settings" onClick={() => setView({ v: "settings" })} data-testid="button-settings">
                  <Settings2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </header>
        {platform === "mobile" && view.v === "add" && <p className="text-xs text-muted-foreground">On mobile the map and logo are stored inside the note itself.</p>}
        {body}
      </div>
      <Toaster />
    </div>
  );
}

const start = () => {
  if (typeof webviewApi === "undefined" || !document.getElementById("root")) return void setTimeout(start, 30);
  applyTheme();
  try {
    window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);
  } catch {}
  document.body.classList.add("scute-joplin");
  createRoot(document.getElementById("root")!).render(<App />);
};
start();
