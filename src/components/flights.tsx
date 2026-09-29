/** Flight cards UI, shared by the Scute and Joplin plug-ins. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, Loader2, MapPin, Pencil, Plane, PlaneLanding, PlaneTakeoff, Plus, RefreshCw, Search, Settings2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { flightCardHtml } from "@/flights/card";
import { DARK, LIGHT, routeMap, routesMap } from "@/flights/map";
import { LookupError, lookupFlight, testAdbKey, type AdbHost, type Net } from "@/flights/lookup";
import {
  REQUIRED,
  SOURCE_LABEL,
  blankInput,
  countryName,
  db,
  derive,
  fmtDate,
  fmtDistance,
  fmtDuration,
  inputOf,
  searchAirlines,
  searchAirports,
  type Airline,
  type Airport,
  type Flight,
  type FlightInput,
  type Source,
  type Units,
} from "@/flights/model";

// ------------------------------------------------------------------ host
export interface Dest {
  id: string;
  title: string;
  boards?: { id: string; title: string }[];
}
export interface FlightSettings {
  units: Units;
  h12: boolean;
  online: boolean;
  logos: boolean;
  photos: boolean;
  weather: boolean;
  adbKey: string;
  adbHost: AdbHost;
  lastDest?: string;
}
export interface FlightHost {
  kind: "scute" | "joplin";
  destLabel: string; // "Space" / "Notebook"
  net: Net | null;
  settings: FlightSettings;
  saveSettings(s: FlightSettings): Promise<void>;
  destinations(): Promise<Dest[]>;
  defaultDest(): string;
  save(f: Flight, dest: { id: string; boardId: string | null }, existingId?: string): Promise<string>;
  dark(): boolean;
}

/** User edits made in the review step survive "Look up again" / "Refresh". */
export function keepUserEdits(next: Flight, old: Flight | null | undefined) {
  if (!old) return next;
  const out: Flight = { ...next, sources: { ...next.sources } };
  for (const [k, s] of Object.entries(old.sources || {})) {
    if (s !== "you") continue;
    if (["date", "depTime", "number", "airline", "from", "to"].includes(k)) continue;
    (out as any)[k] = (old as any)[k];
    out.sources[k] = "you";
    if (k === "arrTime") out.arrDate = old.arrDate;
  }
  return out;
}

// ------------------------------------------------------------------ small pieces
function useDark(host: FlightHost) {
  const [dark, setDark] = useState(host.dark());
  useEffect(() => {
    const mo = new MutationObserver(() => setDark(host.dark()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => mo.disconnect();
  }, [host]);
  return dark;
}
function useRouteMap(f: Flight | null, dark: boolean, W = 720, H = 260) {
  const [svg, setSvg] = useState<string>("");
  const key = f ? `${f.from.lat},${f.from.lon},${f.to.lat},${f.to.lon},${f.from.iata},${f.to.iata}` : "";
  useEffect(() => {
    let live = true;
    if (!f) return setSvg("");
    void routeMap(f.from, f.to, { W, H, theme: dark ? DARK : LIGHT }).then((s) => live && setSvg(s));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, dark, W, H]);
  return svg;
}

export function FlightCard({ flight, host, testId }: { flight: Flight; host: FlightHost; testId?: string }) {
  const dark = useDark(host);
  const map = useRouteMap(flight, dark);
  const html = useMemo(() => flightCardHtml(flight, { units: host.settings.units, h12: host.settings.h12, dark, mapSvg: map || undefined, photo: host.settings.photos }), [flight, host.settings.units, host.settings.h12, host.settings.photos, dark, map]);
  return <div className="scute-flight" data-testid={testId || "flight-card"} dangerouslySetInnerHTML={{ __html: html }} />;
}

function SourceChip({ s }: { s?: Source }) {
  if (!s) return null;
  const tone =
    s === "you" ? "bg-primary/10 text-primary" : s === "estimate" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : s === "computed" || s === "builtin" ? "bg-muted text-muted-foreground" : "bg-sky-500/10 text-sky-700 dark:text-sky-300";
  return <span className={`ml-1.5 rounded px-1.5 py-px text-[10px] font-medium normal-case tracking-normal ${tone}`}>{SOURCE_LABEL[s]}</span>;
}

/** A text box with suggestions (airports, airlines). */
function Combo<T>({
  id,
  value,
  onChange,
  search,
  render,
  pick,
  placeholder,
  icon,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  search: (q: string) => Promise<T[]>;
  render: (x: T) => ReactNode;
  pick: (x: T) => string;
  placeholder?: string;
  icon?: ReactNode;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<T[]>([]);
  const [hi, setHi] = useState(0);
  const seq = useRef(0);
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) return;
    const n = ++seq.current;
    const q = value;
    const t = setTimeout(
      () =>
        void search(q).then((r) => {
          if (n !== seq.current) return;
          setItems(r);
          setHi(0);
          setOpen(r.length > 0);
        }),
      q.length < 3 ? 60 : 120,
    );
    return () => clearTimeout(t);
  }, [value, search]);
  const choose = (x: T) => {
    typed.current = false;
    onChange(pick(x));
    setOpen(false);
  };
  return (
    <div className="relative">
      {icon && <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">{icon}</span>}
      <Input
        id={id}
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        className={icon ? "pl-8" : undefined}
        onChange={(e) => {
          typed.current = true;
          onChange(e.target.value);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !items.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(items.length - 1, h + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(0, h - 1));
          } else if (e.key === "Enter" || e.key === "Tab") {
            if (e.key === "Enter") e.preventDefault();
            choose(items[hi]);
          } else if (e.key === "Escape") setOpen(false);
        }}
        data-testid={`input-${id}`}
      />
      {open && (
        <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-lg" role="listbox" data-testid={`list-${id}`}>
          {items.map((x, i) => (
            <li
              key={i}
              role="option"
              aria-selected={i === hi}
              className={`cursor-pointer rounded px-2 py-1.5 ${i === hi ? "bg-accent text-accent-foreground" : ""}`}
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(x);
              }}
            >
              {render(x)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const airportLine = (a: Airport) => `${a.iata} · ${a.city || a.name}${a.city && a.city !== a.name ? ` — ${a.name}` : ""}`;
const AirportRow = (a: Airport) => (
  <div className="flex items-baseline gap-2 min-w-0">
    <span className="font-mono font-semibold w-9 shrink-0">{a.iata}</span>
    <span className="truncate">
      {a.city || a.name}
      <span className="text-muted-foreground"> · {a.name}, {countryName(a.country)}</span>
    </span>
  </div>
);
const AirlineRow = (a: Airline) => (
  <div className="flex items-baseline gap-2 min-w-0">
    <span className="font-mono font-semibold w-9 shrink-0">{a.iata}</span>
    <span className="truncate">
      {a.name}
      <span className="text-muted-foreground">
        {a.icao ? ` · ${a.icao}` : ""}
        {a.country ? ` · ${a.country}` : ""}
        {a.active ? "" : " · former"}
      </span>
    </span>
  </div>
);

function Field({ label, htmlFor, children, hint, source, className }: { label: string; htmlFor?: string; children: ReactNode; hint?: ReactNode; source?: Source; className?: string }) {
  return (
    <div className={`space-y-1.5 min-w-0 ${className || ""}`}>
      <Label htmlFor={htmlFor} className="flex items-center text-xs font-medium">
        {label}
        <SourceChip s={source} />
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ settings
export function FlightSettingsForm({ host, onDone }: { host: FlightHost; onDone: () => void }) {
  const [s, setS] = useState<FlightSettings>({ ...host.settings });
  const [testing, setTesting] = useState(false);
  const up = (p: Partial<FlightSettings>) => setS((o) => ({ ...o, ...p }));
  return (
    <div className="space-y-5" data-testid="flight-settings">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Distances and temperatures">
          <Select value={s.units} onValueChange={(v) => up({ units: v as Units })}>
            <SelectTrigger data-testid="select-units">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="imperial">Miles, °F</SelectItem>
              <SelectItem value="metric">Kilometres, °C</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Times">
          <Select value={s.h12 ? "12" : "24"} onValueChange={(v) => up({ h12: v === "12" })}>
            <SelectTrigger data-testid="select-clock">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24">24-hour (18:45)</SelectItem>
              <SelectItem value="12">12-hour (6:45 PM)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="space-y-2.5">
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={s.online} onCheckedChange={(v) => up({ online: !!v })} data-testid="check-online" className="mt-0.5" />
          <span>
            Look flights up online
            <span className="block text-xs text-muted-foreground">Free sources, no account: adsbdb and HexDB (routes, aircraft), Open-Meteo (weather), Planespotters (photos), airline logos. They see the flight numbers and registrations you look up.</span>
          </span>
        </label>
        <div className={`ml-6 space-y-2 ${s.online ? "" : "opacity-50 pointer-events-none"}`}>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={s.logos} onCheckedChange={(v) => up({ logos: !!v })} data-testid="check-logos" /> Airline logos (saved in the card)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={s.photos} onCheckedChange={(v) => up({ photos: !!v })} data-testid="check-photos" /> Aircraft photos (shown from the photographer's site, credited)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={s.weather} onCheckedChange={(v) => up({ weather: !!v })} data-testid="check-weather" /> Weather at departure and arrival
          </label>
        </div>
      </div>
      <div className="rounded-lg border p-3 space-y-3">
        <div>
          <div className="text-sm font-medium">AeroDataBox (optional)</div>
          <p className="text-xs text-muted-foreground">
            With a key, cards also get the scheduled and actual times, terminals, gates, the aircraft and its registration for the exact date. AeroDataBox has a free tier on RapidAPI and API.Market.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <Field label="API key" htmlFor="adb-key">
            <Input id="adb-key" type="password" autoComplete="off" value={s.adbKey} onChange={(e) => up({ adbKey: e.target.value.trim() })} placeholder="Paste your key" data-testid="input-adb-key" />
          </Field>
          <Field label="Where the key is from">
            <Select value={s.adbHost} onValueChange={(v) => up({ adbHost: v as AdbHost })}>
              <SelectTrigger data-testid="select-adb-host">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rapidapi">RapidAPI</SelectItem>
                <SelectItem value="apimarket">API.Market</SelectItem>
                <SelectItem value="direct">AeroDataBox</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!s.adbKey || testing || !host.net}
          onClick={async () => {
            setTesting(true);
            try {
              await testAdbKey(host.net!, s.adbKey, s.adbHost);
              toast({ title: "The key works" });
            } catch (e) {
              toast({ title: "Key test failed", description: (e as Error).message, variant: "destructive" });
            } finally {
              setTesting(false);
            }
          }}
          data-testid="button-test-key"
        >
          {testing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Test the key
        </Button>
        <p className="text-[11px] text-muted-foreground">{host.kind === "scute" ? "The key is kept (encrypted) with your Scute settings." : "The key is kept in this plug-in's Joplin settings."}</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} data-testid="button-settings-cancel">
          Cancel
        </Button>
        <Button
          onClick={async () => {
            await host.saveSettings(s);
            onDone();
          }}
          data-testid="button-settings-save"
        >
          Save settings
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the add / edit flow
type Step = "form" | "busy" | "review" | "settings";

export function FlightFlow({
  host,
  existing,
  startWith,
  onDone,
  onCancel,
  onTitle,
}: {
  host: FlightHost;
  /** Editing an existing card. */
  existing?: { id: string; flight: Flight; destId: string };
  /** "review" jumps straight to the details of `existing` (Edit); "refresh" re-runs the lookup. */
  startWith?: "form" | "review" | "refresh";
  onDone: (id: string) => void;
  onCancel: () => void;
  onTitle?: (t: string) => void;
}) {
  const [step, setStep] = useState<Step>(startWith === "review" && existing ? "review" : "form");
  const [input, setInput] = useState<FlightInput>(() => (existing ? inputOf(existing.flight) : blankInput()));
  const [more, setMore] = useState(() => !!existing && !!(existing.flight.seat || existing.flight.booking || existing.flight.notes));
  const [flight, setFlight] = useState<Flight | null>(existing?.flight ?? null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [dests, setDests] = useState<Dest[]>([]);
  const [dest, setDest] = useState(existing?.destId || "");
  const [board, setBoard] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [, force] = useState(0);
  const ran = useRef(false);

  useEffect(() => {
    void db(); // start loading airports while the user types
    void host.destinations().then((d) => {
      setDests(d);
      if (!existing) {
        const pref = host.defaultDest();
        setDest((cur) => cur || (d.some((x) => x.id === pref) ? pref : d[0]?.id || ""));
      }
    });
  }, [host, existing]);
  useEffect(() => {
    onTitle?.(step === "settings" ? "Flight card settings" : step === "review" ? (existing ? "Edit flight card" : "Check the details") : existing ? "Edit flight" : "Add a flight");
  }, [step, existing, onTitle]);

  const set = (k: keyof FlightInput) => (v: string) => setInput((o) => ({ ...o, [k]: v }));
  const missing = REQUIRED.filter((k) => !String(input[k] || "").trim());

  async function run() {
    setErr("");
    setStep("busy");
    setBusy("Starting");
    try {
      const r = await lookupFlight(input, host.net, host.settings, setBusy, existing?.flight);
      setFlight(keepUserEdits(r.flight, flight));
      setWarnings(r.warnings);
      setStep("review");
    } catch (e) {
      setErr(e instanceof LookupError ? e.message : `Lookup failed: ${(e as Error).message}`);
      setStep("form");
    }
  }
  useEffect(() => {
    if (startWith === "refresh" && existing && !ran.current) {
      ran.current = true;
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const edit = <K extends keyof Flight>(k: K, v: Flight[K]) =>
    setFlight((f) => {
      if (!f) return f;
      const n: Flight = { ...f, [k]: v, sources: { ...f.sources, [k]: "you" } };
      if (k === "arrTime") {
        n.arrDate = undefined;
        if (!v) delete n.sources.arrTime;
      }
      return n;
    });

  async function save() {
    if (!flight || !dest) return;
    setSaving(true);
    try {
      const d = derive(flight);
      const toSave: Flight = { ...flight, arrDate: flight.arrTime ? flight.arrDate || d.arrDate : d.arrDate, updated: Date.now() };
      const id = await host.save(toSave, { id: dest, boardId: board || null }, existing?.id);
      if (host.settings.lastDest !== dest) void host.saveSettings({ ...host.settings, lastDest: dest });
      onDone(id);
    } catch (e) {
      toast({ title: "Couldn't save the card", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (step === "settings")
    return (
      <FlightSettingsForm
        host={host}
        onDone={() => {
          force((x) => x + 1);
          setStep(flight && startWith === "review" ? "review" : "form");
        }}
      />
    );

  if (step === "busy")
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-muted-foreground" data-testid="flight-busy">
        <div className="relative h-10 w-10">
          <Loader2 className="absolute inset-0 h-10 w-10 animate-spin text-primary/40" />
          <Plane className="absolute inset-2.5 h-5 w-5 text-primary" />
        </div>
        <div>{busy}…</div>
      </div>
    );

  if (step === "review" && flight) {
    const d = derive(flight);
    const s = flight.sources;
    const dst = dests.find((x) => x.id === dest);
    return (
      <div className="space-y-5" data-testid="flight-review">
        <FlightCard flight={flight} host={host} testId="flight-card-preview" />
        {warnings.length > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm space-y-1" data-testid="flight-warnings">
            {warnings.map((w, i) => (
              <div key={i} className="flex gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Details</h3>
          <p className="text-xs text-muted-foreground -mt-2">Everything can be changed. The label next to each field says where it came from.</p>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            <Field label="Airline" htmlFor="r-airline" source={s.airline} className="col-span-2">
              <Input id="r-airline" value={flight.airline.name} onChange={(e) => setFlight({ ...flight, airline: { ...flight.airline, name: e.target.value }, sources: { ...s, airline: "you" } })} data-testid="input-review-airline" />
            </Field>
            <Field label="Departs" htmlFor="r-dep" source={s.depTime}>
              <Input id="r-dep" type="time" value={flight.depTime} onChange={(e) => e.target.value && edit("depTime", e.target.value)} data-testid="input-review-dep" />
            </Field>
            <Field label="Arrives" htmlFor="r-arr" source={s.arrTime} hint={d.estimated ? "Estimated from the distance" : undefined}>
              <Input id="r-arr" type="time" value={flight.arrTime} onChange={(e) => edit("arrTime", e.target.value)} data-testid="input-review-arr" />
            </Field>
            <Field label="Departure terminal" htmlFor="r-dt" source={s.depTerminal}>
              <Input id="r-dt" value={flight.depTerminal || ""} onChange={(e) => edit("depTerminal", e.target.value)} data-testid="input-review-dep-terminal" />
            </Field>
            <Field label="Departure gate" htmlFor="r-dg" source={s.depGate}>
              <Input id="r-dg" value={flight.depGate || ""} onChange={(e) => edit("depGate", e.target.value)} data-testid="input-review-dep-gate" />
            </Field>
            <Field label="Arrival terminal" htmlFor="r-at" source={s.arrTerminal}>
              <Input id="r-at" value={flight.arrTerminal || ""} onChange={(e) => edit("arrTerminal", e.target.value)} data-testid="input-review-arr-terminal" />
            </Field>
            <Field label="Arrival gate" htmlFor="r-ag" source={s.arrGate}>
              <Input id="r-ag" value={flight.arrGate || ""} onChange={(e) => edit("arrGate", e.target.value)} data-testid="input-review-arr-gate" />
            </Field>
            <Field label="Aircraft" htmlFor="r-ac" source={s.aircraft} className="col-span-2">
              <Input id="r-ac" value={flight.aircraft || ""} onChange={(e) => edit("aircraft", e.target.value)} placeholder="e.g. Airbus A321neo" data-testid="input-review-aircraft" />
            </Field>
            <Field label="Registration" htmlFor="r-reg" source={s.reg}>
              <Input id="r-reg" value={flight.reg || ""} onChange={(e) => edit("reg", e.target.value.toUpperCase())} placeholder="N12345" data-testid="input-review-reg" />
            </Field>
            <Field label="Status" htmlFor="r-status" source={s.status}>
              <Input id="r-status" value={flight.status || ""} onChange={(e) => edit("status", e.target.value)} data-testid="input-review-status" />
            </Field>
            <Field label="Seat" htmlFor="r-seat">
              <Input id="r-seat" value={flight.seat || ""} onChange={(e) => edit("seat", e.target.value.toUpperCase())} data-testid="input-review-seat" />
            </Field>
            <Field label="Class" htmlFor="r-cabin">
              <Input id="r-cabin" list="flight-cabins" value={flight.cabin || ""} onChange={(e) => edit("cabin", e.target.value)} data-testid="input-review-cabin" />
            </Field>
            <Field label="Booking reference" htmlFor="r-pnr" className="col-span-2">
              <Input id="r-pnr" value={flight.booking || ""} onChange={(e) => edit("booking", e.target.value.toUpperCase())} data-testid="input-review-booking" />
            </Field>
            <Field label="Notes" htmlFor="r-notes" className="col-span-2 sm:col-span-4">
              <Textarea id="r-notes" rows={2} value={flight.notes || ""} onChange={(e) => edit("notes", e.target.value)} data-testid="input-review-notes" />
            </Field>
          </div>
          <Cabins />
          {!!flight.log?.length && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">What was looked up</summary>
              <ul className="mt-1.5 space-y-0.5 pl-4 list-disc" data-testid="flight-log">
                {flight.log.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
        <section className="rounded-lg border bg-muted/30 p-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={existing ? host.destLabel : `Save to ${host.destLabel.toLowerCase()}`}>
              <Select value={dest} onValueChange={(v) => (setDest(v), setBoard(""))} disabled={!!existing}>
                <SelectTrigger data-testid="select-dest">
                  <SelectValue placeholder={dests.length ? `Choose a ${host.destLabel.toLowerCase()}` : `No ${host.destLabel.toLowerCase()}s you can write to`} />
                </SelectTrigger>
                <SelectContent>
                  {dests.map((x) => (
                    <SelectItem key={x.id} value={x.id}>
                      {x.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {!existing && !!dst?.boards?.length && (
              <Field label="Board (optional)">
                <Select value={board || "__none"} onValueChange={(v) => setBoard(v === "__none" ? "" : v)}>
                  <SelectTrigger data-testid="select-board">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">No board</SelectItem>
                    {dst.boards.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep("form")} data-testid="button-review-back">
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={run} data-testid="button-review-lookup">
                <RefreshCw className="mr-1.5 h-4 w-4" /> Look up again
              </Button>
              <Button onClick={save} disabled={!dest || saving} data-testid="button-create-card">
                {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plane className="mr-1.5 h-4 w-4" />}
                {existing ? "Save card" : "Create card"}
              </Button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  // ---- the form
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!missing.length) void run();
      }}
      data-testid="flight-form"
    >
      <div className="grid gap-3 grid-cols-2">
        <Field label="Date" htmlFor="f-date">
          <Input id="f-date" type="date" value={input.date} onChange={(e) => set("date")(e.target.value)} required data-testid="input-flight-date" />
        </Field>
        <Field label="Departure time" htmlFor="f-dep" hint="Local time at the airport">
          <Input id="f-dep" type="time" value={input.depTime} onChange={(e) => set("depTime")(e.target.value)} required data-testid="input-flight-dep" />
        </Field>
        <Field label="Airline" htmlFor="f-airline" className="col-span-2 sm:col-span-1">
          <Combo<Airline>
            id="f-airline"
            value={input.airline}
            onChange={set("airline")}
            search={searchAirlines}
            render={AirlineRow}
            pick={(a) => `${a.name} (${a.iata})`}
            placeholder="Name or code, e.g. Delta or DL"
            autoFocus={!existing}
          />
        </Field>
        <Field label="Flight number" htmlFor="f-num" className="col-span-2 sm:col-span-1">
          <Input id="f-num" value={input.number} onChange={(e) => set("number")(e.target.value)} placeholder="e.g. 117 or BA117" required autoComplete="off" data-testid="input-flight-number" />
        </Field>
        <Field label="From" htmlFor="f-from" className="col-span-2 sm:col-span-1">
          <Combo<Airport> id="f-from" value={input.from} onChange={set("from")} search={searchAirports} render={AirportRow} pick={airportLine} placeholder="Airport code or city" icon={<PlaneTakeoff className="h-4 w-4" />} />
        </Field>
        <Field label="To" htmlFor="f-to" className="col-span-2 sm:col-span-1">
          <Combo<Airport> id="f-to" value={input.to} onChange={set("to")} search={searchAirports} render={AirportRow} pick={airportLine} placeholder="Airport code or city" icon={<PlaneLanding className="h-4 w-4" />} />
        </Field>
      </div>

      <button type="button" className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground" onClick={() => setMore(!more)} data-testid="button-more-details">
        {more ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} More details (optional)
      </button>
      {more && (
        <div className="grid gap-3 grid-cols-2">
          <Field label="Arrival time" htmlFor="f-arr" hint="Local time; found or estimated if empty">
            <Input id="f-arr" type="time" value={input.arrTime || ""} onChange={(e) => set("arrTime")(e.target.value)} data-testid="input-flight-arr" />
          </Field>
          <Field label="Registration" htmlFor="f-reg" hint="Tail number, for the aircraft photo">
            <Input id="f-reg" value={input.reg || ""} onChange={(e) => set("reg")(e.target.value.toUpperCase())} placeholder="e.g. G-STBA" autoComplete="off" data-testid="input-flight-reg" />
          </Field>
          <Field label="Aircraft" htmlFor="f-ac" className="col-span-2">
            <Input id="f-ac" value={input.aircraft || ""} onChange={(e) => set("aircraft")(e.target.value)} placeholder="e.g. Boeing 787-9" data-testid="input-flight-aircraft" />
          </Field>
          <Field label="Seat" htmlFor="f-seat">
            <Input id="f-seat" value={input.seat || ""} onChange={(e) => set("seat")(e.target.value.toUpperCase())} placeholder="e.g. 32A" data-testid="input-flight-seat" />
          </Field>
          <Field label="Class" htmlFor="f-cabin">
            <Input id="f-cabin" list="flight-cabins" value={input.cabin || ""} onChange={(e) => set("cabin")(e.target.value)} placeholder="Economy" data-testid="input-flight-cabin" />
          </Field>
          <Field label="Booking reference" htmlFor="f-pnr" className="col-span-2">
            <Input id="f-pnr" value={input.booking || ""} onChange={(e) => set("booking")(e.target.value.toUpperCase())} placeholder="e.g. X7K2QP" autoComplete="off" data-testid="input-flight-booking" />
          </Field>
          <Field label="Notes" htmlFor="f-notes" className="col-span-2">
            <Textarea id="f-notes" rows={3} value={input.notes || ""} onChange={(e) => set("notes")(e.target.value)} data-testid="input-flight-notes" />
          </Field>
          <Cabins />
        </div>
      )}

      {err && (
        <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert" data-testid="flight-error">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
          <span>{err}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => setStep("settings")} data-testid="button-flight-settings">
          <Settings2 className="mr-1.5 h-4 w-4" /> Settings
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} data-testid="button-flight-cancel">
            Cancel
          </Button>
          <Button type="submit" disabled={missing.length > 0} title={missing.length ? "Fill in the date, time, airline, flight number and both airports" : undefined} data-testid="button-find-details">
            <Search className="mr-1.5 h-4 w-4" /> {host.settings.online && host.net ? "Find details" : "Continue"}
          </Button>
        </div>
      </div>
      {!host.settings.online && <p className="text-right text-[11px] text-muted-foreground">Online lookups are off; the card will use built-in airport data and estimates.</p>}
    </form>
  );
}
function Cabins() {
  return (
    <datalist id="flight-cabins">
      <option value="Economy" />
      <option value="Premium economy" />
      <option value="Business" />
      <option value="First" />
    </datalist>
  );
}

// ------------------------------------------------------------------ viewing a saved card
export function FlightView({ flight, host, onEdit, onRefresh, onDelete, writable, extra }: { flight: Flight; host: FlightHost; onEdit?: () => void; onRefresh?: () => void; onDelete?: () => void; writable: boolean; extra?: ReactNode }) {
  return (
    <div className="space-y-4" data-testid="flight-view">
      <FlightCard flight={flight} host={host} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>{extra}</div>
        {writable && (
          <div className="flex flex-wrap gap-2">
            {onDelete && (
              <Button variant="ghost" onClick={onDelete} className="text-destructive hover:text-destructive" data-testid="button-flight-delete">
                <Trash2 className="mr-1.5 h-4 w-4" /> Delete
              </Button>
            )}
            {onRefresh && (
              <Button variant="outline" onClick={onRefresh} data-testid="button-flight-refresh">
                <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh details
              </Button>
            )}
            {onEdit && (
              <Button onClick={onEdit} data-testid="button-flight-edit">
                <Pencil className="mr-1.5 h-4 w-4" /> Edit
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the log (all flights in a space / notebook)
export function FlightLog({ flights, host, onOpen, onAdd, title }: { flights: { id: string; flight: Flight }[]; host: FlightHost; onOpen: (id: string) => void; onAdd?: () => void; title?: string }) {
  const dark = useDark(host);
  const u = host.settings.units;
  const [svg, setSvg] = useState("");
  const [year, setYear] = useState("all");
  const years = useMemo(() => [...new Set(flights.map((x) => x.flight.date.slice(0, 4)))].sort().reverse(), [flights]);
  const list = useMemo(() => flights.filter((x) => year === "all" || x.flight.date.startsWith(year)).sort((a, b) => b.flight.date.localeCompare(a.flight.date) || b.flight.depTime.localeCompare(a.flight.depTime)), [flights, year]);
  const stats = useMemo(() => {
    let km = 0,
      min = 0;
    const ap = new Map<string, { n: number; a: Airport }>();
    const al = new Map<string, number>();
    const countries = new Set<string>();
    let longest: { id: string; flight: Flight; km: number } | null = null;
    for (const x of list) {
      const d = derive(x.flight);
      km += d.distanceKm;
      if (d.durationMin) min += d.durationMin;
      for (const a of [x.flight.from, x.flight.to]) {
        const k = a.iata || a.icao;
        ap.set(k, { n: (ap.get(k)?.n || 0) + 1, a });
        if (a.country) countries.add(a.country);
      }
      al.set(x.flight.airline.name, (al.get(x.flight.airline.name) || 0) + 1);
      if (!longest || d.distanceKm > longest.km) longest = { ...x, km: d.distanceKm };
    }
    const topAp = [...ap.values()].sort((a, b) => b.n - a.n).slice(0, 5);
    const topAl = [...al.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { km, min, airports: ap, countries, airlines: al, longest, topAp, topAl };
  }, [list]);
  useEffect(() => {
    let live = true;
    void routesMap(
      list.map((x) => ({ from: x.flight.from, to: x.flight.to })),
      { theme: dark ? DARK : LIGHT, airports: [...stats.airports.values()].map((v) => v.a) },
    ).then((s) => live && setSvg(s));
    return () => {
      live = false;
    };
  }, [list, dark, stats]);
  const Stat = ({ k, v, sub }: { k: string; v: ReactNode; sub?: ReactNode }) => (
    <div className="rounded-lg border bg-card p-3 min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{k}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums truncate">{v}</div>
      {sub && <div className="text-xs text-muted-foreground truncate">{sub}</div>}
    </div>
  );
  return (
    <div className="space-y-4" data-testid="flight-log-view">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title || "Your flights"}</h2>
        <div className="flex items-center gap-2">
          {years.length > 1 && (
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="w-32" data-testid="select-year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All years</SelectItem>
                {years.map((y) => (
                  <SelectItem key={y} value={y}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {onAdd && (
            <Button onClick={onAdd} data-testid="button-log-add">
              <Plus className="mr-1.5 h-4 w-4" /> Add a flight
            </Button>
          )}
        </div>
      </div>
      {!flights.length ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <Plane className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 font-medium">No flights yet</p>
          <p className="text-sm text-muted-foreground">Add one and it shows up here, on the map and in the totals.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-2 grid-cols-2 md:grid-cols-4">
            <Stat k="Flights" v={list.length} sub={`${stats.airlines.size} airline${stats.airlines.size === 1 ? "" : "s"}`} />
            <Stat k="Distance" v={fmtDistance(stats.km, u)} sub={`${(stats.km / 40075).toFixed(2)}× around the Earth`} />
            <Stat k="In the air" v={fmtDuration(stats.min)} sub={`${(stats.min / 60 / 24).toFixed(1)} days`} />
            <Stat k="Airports" v={stats.airports.size} sub={`${stats.countries.size} countr${stats.countries.size === 1 ? "y" : "ies"}`} />
          </div>
          {svg && <div className="overflow-hidden rounded-lg border leading-[0] [&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} data-testid="flight-log-map" />}
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border p-3 text-sm">
              <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Longest flight</div>
              {stats.longest && (
                <button className="text-left hover:underline" onClick={() => onOpen(stats.longest!.id)}>
                  <span className="font-mono font-semibold">
                    {stats.longest.flight.from.iata} → {stats.longest.flight.to.iata}
                  </span>{" "}
                  · {fmtDistance(stats.longest.km, u)}
                  <div className="text-xs text-muted-foreground">
                    {stats.longest.flight.airline.name} {stats.longest.flight.number} · {fmtDate(stats.longest.flight.date, "short")}
                  </div>
                </button>
              )}
            </div>
            <div className="rounded-lg border p-3 text-sm">
              <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Top airports</div>
              {stats.topAp.map(({ a, n }) => (
                <div key={a.iata || a.icao} className="flex justify-between gap-2">
                  <span className="truncate">
                    <span className="font-mono font-semibold">{a.iata}</span> {a.city}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{n}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg border p-3 text-sm">
              <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Top airlines</div>
              {stats.topAl.map(([name, n]) => (
                <div key={name} className="flex justify-between gap-2">
                  <span className="truncate">{name}</span>
                  <span className="tabular-nums text-muted-foreground">{n}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border">
            {list.map((x) => {
              const d = derive(x.flight);
              return (
                <button key={x.id} className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-muted/50" onClick={() => onOpen(x.id)} data-testid={`row-flight-${x.id}`}>
                  <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: x.flight.color || "#1f5d8c" }} />
                  <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{fmtDate(x.flight.date, "short")}</span>
                  <span className="font-mono font-semibold shrink-0">
                    {x.flight.from.iata} → {x.flight.to.iata}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {x.flight.airline.name} <span className="font-mono">{d.code}</span>
                  </span>
                  <span className="hidden sm:inline shrink-0 tabular-nums text-muted-foreground">{fmtDistance(d.distanceKm, u)}</span>
                  <span className="hidden sm:inline w-16 shrink-0 text-right tabular-nums text-muted-foreground">{d.durationMin ? fmtDuration(d.durationMin) : ""}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export { MapPin, X };
