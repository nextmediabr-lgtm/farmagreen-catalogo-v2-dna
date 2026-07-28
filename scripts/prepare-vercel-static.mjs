import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(root, process.env.VERCEL_STATIC_SOURCE || "dist/vercel-v65");
const output = path.join(root, ".vercel", "output");
const target = path.join(output, "static");
const configSource = process.env.VERCEL_STATIC_CONFIG
  ? path.resolve(root, process.env.VERCEL_STATIC_CONFIG)
  : "";

await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(target, { recursive: true });
await copyStatic(source, target);
const config = configSource ? JSON.parse(await fs.readFile(configSource, "utf8")) : { version: 3 };
if (config.version !== 3) throw new Error("La configuración Vercel estática debe usar Build Output API v3.");
await fs.writeFile(path.join(output, "config.json"), `${JSON.stringify(config)}\n`);

async function copyStatic(from, to) {
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    if (entry.name === ".vercel") continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(dst, { recursive: true });
      await copyStatic(src, dst);
    } else if (entry.isFile()) {
      await fs.copyFile(src, dst);
    }
  }
}
