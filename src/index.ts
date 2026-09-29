/* Flight cards for Joplin: plug-in backend (runs in Joplin's plug-in sandbox, global `joplin`). */
declare const joplin: any;
/** Present in the desktop plugin sandbox only. */
declare const require: ((id: string) => any) | undefined;

const P = "us.mayson.scuteflights";
const MARKER = "<!-- scute:flight ";
const FIELDS = ["id", "parent_id", "title", "body", "user_created_time", "user_updated_time", "updated_time"];

async function all(path: string[], query: Record<string, unknown> = {}) {
  const out: any[] = [];
  for (let page = 1; page < 1000; page++) {
    const r = await joplin.data.get(path, { ...query, page, limit: 100 });
    out.push(...(r.items || []));
    if (!r.has_more) break;
  }
  return out;
}

const b64 = (buf: ArrayBuffer) => {
  const B = (globalThis as any).Buffer;
  if (B) return B.from(buf).toString("base64");
  let s = "";
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

/** GET for the panel when the webview can't reach a host itself (CORS). */
async function httpGet(url: string, headers: Record<string, string>) {
  if (!/^https:\/\//i.test(url)) throw new Error("Only https URLs");
  try {
    const r = await fetch(url, { headers });
    return { status: r.status, type: r.headers.get("content-type") || "", body: b64(await r.arrayBuffer()) };
  } catch (e) {
    // Desktop: Node's https module has no CORS rules.
    let https: any = null;
    try {
      const nodeRequire: any = typeof require === "function" ? require : null;
      https = nodeRequire ? nodeRequire(["ht", "tps"].join("")) : null;
    } catch {}
    if (!https) throw e;
    return new Promise<{ status: number; type: string; body: string }>((res, rej) => {
      const req = https.get(url, { headers: { "User-Agent": "Mozilla/5.0 (Joplin; flight cards plug-in)", ...headers } }, (r: any) => {
        const chunks: any[] = [];
        let n = 0;
        r.on("data", (c: any) => {
          n += c.length;
          if (n > 4_000_000) req.destroy(new Error("Response too large"));
          else chunks.push(c);
        });
        r.on("end", () => res({ status: r.statusCode || 0, type: String(r.headers["content-type"] || ""), body: (globalThis as any).Buffer.concat(chunks).toString("base64") }));
        r.on("error", rej);
      });
      req.on("error", rej);
      req.setTimeout(20000, () => req.destroy(new Error("Timed out")));
    });
  }
}

joplin.plugins.register({
  async onStart() {
    let platform = "desktop";
    try {
      platform = (await joplin.versionInfo()).platform || "desktop";
    } catch {}
    try {
      await joplin.settings.registerSection(P, { label: "Flight cards", iconName: "fas fa-plane" });
      await joplin.settings.registerSettings({
        [`${P}.folderId`]: { value: "", type: 2, public: false, section: P, label: "Notebook" },
        [`${P}.visible`]: { value: false, type: 3, public: false, section: P, label: "Panel visible" },
        [`${P}.prefs`]: { value: "{}", type: 2, public: false, section: P, label: "Preferences" },
        [`${P}.adbKey`]: { value: "", type: 2, public: true, secure: true, section: P, label: "AeroDataBox API key (optional)", description: "Adds scheduled/actual times, terminals, gates and the aircraft. Free tier on RapidAPI or API.Market." },
        [`${P}.adbHost`]: { value: "rapidapi", type: 2, public: true, isEnum: true, options: { rapidapi: "RapidAPI", apimarket: "API.Market", direct: "AeroDataBox" }, section: P, label: "AeroDataBox key is from" },
      });
    } catch (e) {
      console.warn("Flight cards settings", e);
    }
    const get = async (k: string, fb: any) => {
      try {
        const v = await joplin.settings.value(`${P}.${k}`);
        return v ?? fb;
      } catch {
        return fb;
      }
    };
    const set = (k: string, v: any) => joplin.settings.setValue(`${P}.${k}`, v).catch(() => {});

    const panel = await joplin.views.panels.create(`${P}.panel`);
    await joplin.views.panels.setHtml(panel, '<div id="root"></div>');
    await joplin.views.panels.addScript(panel, "./panel.css");
    await joplin.views.panels.addScript(panel, "./panel.js");
    const changed = () => joplin.views.panels.postMessage(panel, { t: "changed" }).catch(() => {});

    async function list(folderId?: string) {
      const folders = (await all(["folders"], { fields: ["id", "title", "parent_id"] })).sort((a, b) => a.title.localeCompare(b.title));
      let fid: string = folderId ?? (await get("folderId", ""));
      if (fid && !folders.some((f) => f.id === fid)) fid = "";
      if (folderId !== undefined) await set("folderId", fid);
      const notes = fid ? (await all(["folders", fid, "notes"], { fields: FIELDS })).filter((n) => (n.body || "").includes(MARKER)) : [];
      return { platform, folders, folderId: fid, notes };
    }

    async function addResource(name: string, mime: string, base64: string): Promise<string | null> {
      if (platform === "mobile") return null;
      try {
        const fs = joplin.require("fs-extra");
        const dir = await joplin.plugins.dataDir();
        const path = `${dir}/${Date.now().toString(36)}-${name.replace(/[^\w.-]+/g, "_")}`;
        await fs.writeFile(path, base64, "base64");
        const res = await joplin.data.post(["resources"], null, { title: name, mime }, [{ path }]);
        await fs.remove(path).catch(() => {});
        return res.id as string;
      } catch (e) {
        console.warn("Flight cards: couldn't add a resource, using a data URL instead", e);
        return null;
      }
    }

    await joplin.views.panels.onMessage(panel, async (m: any) => {
      switch (m?.t) {
        case "list":
          return list(m.folderId);
        case "settings": {
          let prefs: any = {};
          try {
            prefs = JSON.parse(await get("prefs", "{}")) || {};
          } catch {}
          return { ...prefs, adbKey: await get("adbKey", ""), adbHost: await get("adbHost", "rapidapi") };
        }
        case "saveSettings": {
          const { adbKey, adbHost, ...prefs } = m.settings || {};
          await set("adbKey", adbKey || "");
          await set("adbHost", adbHost || "rapidapi");
          await set("prefs", JSON.stringify(prefs));
          return true;
        }
        case "http":
          return httpGet(String(m.url), m.headers || {});
        case "resource":
          return addResource(String(m.name), String(m.mime), String(m.data));
        case "deleteResources":
          for (const id of m.ids || []) await joplin.data.delete(["resources", id]).catch(() => {});
          return true;
        case "post": {
          const n = await joplin.data.post(["notes"], null, { parent_id: m.parent_id, title: m.title, body: m.body, user_created_time: m.created || Date.now() });
          return n.id;
        }
        case "put":
          await joplin.data.put(["notes", m.id], null, { title: m.title, body: m.body });
          return true;
        case "delete":
          await joplin.data.delete(["notes", m.id]);
          return true;
        case "createFolder":
          return (await joplin.data.post(["folders"], null, { title: m.title })).id;
        case "openNote":
          await joplin.commands.execute("openNote", m.id);
          return true;
      }
      return null;
    });

    const toggle = `${P}.toggle`;
    await joplin.commands.register({
      name: toggle,
      label: "Flight cards",
      iconName: "fas fa-plane",
      execute: async () => {
        const vis = await joplin.views.panels.visible(panel).catch(() => false);
        if (vis) await joplin.views.panels.hide(panel);
        else {
          await joplin.views.panels.show(panel);
          changed();
        }
        await set("visible", !vis);
      },
    });
    try {
      await joplin.views.menuItems.create(`${P}.menu`, toggle, "tools");
    } catch (e) {
      console.info("Flight cards: menu item not available", e);
    }
    try {
      await joplin.views.toolbarButtons.create(`${P}.button`, toggle, "editorToolbar");
    } catch (e) {
      console.info("Flight cards: toolbar button not available", e);
    }
    try {
      await joplin.workspace.onSyncComplete(() => changed());
    } catch {}
    if (platform !== "mobile" && !(await get("visible", false))) await joplin.views.panels.hide(panel).catch(() => {});
  },
});
