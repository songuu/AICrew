import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(".");
const basePort = Number.parseInt(process.env.PORT || "5173", 10);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

function toSafePath(requestUrl) {
  const url = new URL(requestUrl, "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(root, requested));
  if (!filePath.startsWith(root)) {
    return join(root, "index.html");
  }
  return filePath;
}

function createStaticServer() {
  return createServer((request, response) => {
    const filePath = toSafePath(request.url || "/");
    const fallbackPath = join(root, "index.html");
    const target = existsSync(filePath) && statSync(filePath).isFile() ? filePath : fallbackPath;
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(target)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    createReadStream(target).pipe(response);
  });
}

function listenOnAvailablePort(port, attempts = 10) {
  const server = createStaticServer();
  server.on("error", error => {
    if (error.code === "EADDRINUSE" && attempts > 0) {
      listenOnAvailablePort(port + 1, attempts - 1);
      return;
    }
    throw error;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`AICrew Studio running at http://127.0.0.1:${port}`);
  });
}

listenOnAvailablePort(basePort);
