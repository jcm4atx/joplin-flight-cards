// Builds the Joplin plugin package: publish/us.mayson.scuteflights.jpl
//   npm install && npm run build
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "dist");
const publish = path.join(here, "publish");
const manifest = JSON.parse(fs.readFileSync(path.join(here, "src/manifest.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"));
if (manifest.version !== pkg.version) throw new Error(`Version mismatch: src/manifest.json ${manifest.version}, package.json ${pkg.version}`);

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.mkdirSync(publish, { recursive: true });

const common = {
  bundle: true,
  minify: true,
  legalComments: "none",
  alias: { "@": path.join(here, "src") },
  define: { "process.env.NODE_ENV": '"production"' },
  jsx: "automatic",
  logLevel: "warning",
  target: "es2020",
  platform: "browser",
};

// Plugin backend (Joplin's plugin sandbox, global `joplin`) and the panel (a webview).
await build({ ...common, entryPoints: ["src/index.ts"], outfile: path.join(dist, "index.js"), format: "cjs" });
await build({ ...common, entryPoints: ["src/panel.tsx"], outfile: path.join(dist, "panel.js"), format: "iife" });

// Panel stylesheet.
const tw = path.join(here, "node_modules/.bin", process.platform === "win32" ? "tailwindcss.cmd" : "tailwindcss");
execFileSync(tw, ["-c", "tailwind.config.ts", "-i", "src/panel.css", "-o", path.join(dist, "panel.css"), "--minify"], { cwd: here, stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" });

fs.copyFileSync(path.join(here, "src/manifest.json"), path.join(dist, "manifest.json"));

// A .jpl is a plain tar archive with manifest.json at its root.
const jpl = path.join(publish, `${manifest.id}.jpl`);
execFileSync("tar", ["-cf", jpl, "manifest.json", "index.js", "panel.js", "panel.css"], { cwd: dist });
fs.copyFileSync(path.join(dist, "manifest.json"), path.join(publish, `${manifest.id}.json`));

for (const f of fs.readdirSync(publish)) console.log(`publish/${f}  ${(fs.statSync(path.join(publish, f)).size / 1024).toFixed(0)} KB`);
