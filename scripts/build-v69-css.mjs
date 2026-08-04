import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const SOURCES = ["styles-v6-5.css", "styles-v6-6.css", "styles-v6-7.css", "styles-v6-9.css"];
const OUTPUT = path.join(PUBLIC, "styles-v6-9-1.css");

const sections = await Promise.all(
  SOURCES.map(async (name) => `/* ${name} */\n${(await fs.readFile(path.join(PUBLIC, name), "utf8")).trim()}\n`),
);

await fs.writeFile(
  OUTPUT,
  `/* V6.9.1: consolidación mecánica; el orden de cascada original se conserva. */\n${sections.join("\n")}`,
  "utf8",
);
