import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Dev-only convenience: lets the Experiment tab persist a finished run to
// public/results/<name>.json so the Write-up tab can load it. Inference never
// touches this server; without it the app falls back to a JSON download.
function saveResults(): Plugin {
  return {
    name: "save-results",
    configureServer(server) {
      server.middlewares.use("/__save-results", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        const name = new URL(req.url ?? "", "http://x").searchParams.get("name") ?? "recorded";
        if (!/^[a-z0-9-]+$/.test(name)) {
          res.statusCode = 400;
          return res.end("bad name");
        }
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          const dir = resolve(__dirname, "public/results");
          mkdirSync(dir, { recursive: true });
          writeFileSync(resolve(dir, `${name}.json`), Buffer.concat(chunks));
          res.setHeader("content-type", "application/json");
          res.end('{"ok":true}');
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), saveResults()],
  server: { port: 5183, strictPort: true },
});
