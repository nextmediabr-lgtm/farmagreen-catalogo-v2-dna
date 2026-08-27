import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = [
  ["public/app-v6-9.js", "public/app-v6-9-compat.js"],
  ["public/analytics-v69.js", "public/analytics-v69-compat.js"],
  ["public/meta-pixel-v69.js", "public/meta-pixel-v69-compat.js"],
];
const UNSUPPORTED_RUNTIME_PATTERNS = [
  [/\?\./, "optional chaining"],
  [/\?\?/, "nullish coalescing"],
  [/\.at\s*\(/, "Array.at"],
  [/\.matchAll\s*\(/, "String.matchAll"],
];

for (const [sourceName, outputName] of TARGETS) {
  const sourcePath = path.join(ROOT, sourceName);
  const outputPath = path.join(ROOT, outputName);
  const source = await fs.readFile(sourcePath, "utf8");
  const result = ts.transpileModule(source, {
    fileName: sourceName,
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      module: ts.ModuleKind.None,
      newLine: ts.NewLineKind.LineFeed,
      removeComments: false,
      target: ts.ScriptTarget.ES2017,
    },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics || []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length) {
    throw new Error(
      `No se pudo transpilar ${sourceName}: ${errors
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "))
        .join("; ")}`,
    );
  }
  const output = `/* Generado por scripts/build-v69-client.mjs. No editar. */\n${result.outputText}`;
  for (const [pattern, label] of UNSUPPORTED_RUNTIME_PATTERNS) {
    if (pattern.test(output)) throw new Error(`${outputName} todavía usa ${label}.`);
  }
  await fs.writeFile(outputPath, output, "utf8");
}
