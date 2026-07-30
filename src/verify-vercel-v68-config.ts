import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPreparedRoutesV68 } from "./vercel-config-v68.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = path.join(ROOT, ".vercel", "output", "config.json");
const config = JSON.parse(await fs.readFile(CONFIG, "utf8")) as {
  version?: unknown;
  routes?: unknown;
};

if (config.version !== 3) {
  throw new Error("La configuración Vercel V6.8 debe usar Build Output API v3.");
}
verifyPreparedRoutesV68(config.routes, process.env.V68_UPSTREAM_ORIGIN);
process.stdout.write("Configuración Vercel V6.8 sincronizada verificada.\n");
