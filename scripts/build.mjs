import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(projectRoot, "dist");

if (dirname(output) !== projectRoot || !output.endsWith("dist")) {
  throw new Error("Refusing to clean an unexpected output directory");
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(projectRoot, "index.html"), join(output, "index.html"));
await cp(join(projectRoot, "assets"), join(output, "assets"), { recursive: true });
await cp(join(projectRoot, "src"), join(output, "src"), { recursive: true });

console.log(`Built static site at ${output}`);
