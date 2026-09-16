import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const cloudDev = process.env.HCT_CLOUD_DEV === "1";
const api = cloudDev ? {
  "/api/login": require("./api/login.js"),
  "/api/logout": require("./api/logout.js"),
  "/api/state": require("./api/state.js"),
} : {};
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (api[pathname]) {
      await api[pathname](request, response);
      return;
    }
    const safe = normalize(pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
    if (safe.startsWith("..")) throw new Error("invalid path");
    const body = await readFile(join(root, safe));
    response.writeHead(200, { "content-type": types[extname(safe)] || "application/octet-stream", "cache-control": "no-store" });
    response.end(body);
  } catch (_) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(4173, "0.0.0.0");
