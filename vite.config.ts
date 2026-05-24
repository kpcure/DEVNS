import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FeatureStoreError, patchFeature } from "./packages/core/src/harness/state";
import type { FeaturePatch, NeverStopConfig } from "./packages/core/src/harness/types";

const roadmapPath = path.resolve(__dirname, ".workbench/dogfood/features.json");
const dogfoodConfig: NeverStopConfig = {
  version: 1,
  features: ".workbench/dogfood/features.json"
};
const editableFeatureFields = new Set(["status", "priority", "reviewDecision", "agentNotes"]);

async function readJsonBody(req: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res: import("node:http").ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

function roadmapApiPlugin() {
  return {
    name: "never-stop-roadmap-api",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        try {
          if (!req.url?.startsWith("/api/")) {
            next();
            return;
          }

          if (req.method === "GET" && req.url === "/api/roadmap") {
            const raw = await readFile(roadmapPath, "utf8");
            sendJson(res, 200, JSON.parse(raw));
            return;
          }

          const featureMatch = req.url.match(/^\/api\/features\/([^/?#]+)$/);
          if (req.method === "PATCH" && featureMatch) {
            const featureId = decodeURIComponent(featureMatch[1]);
            const patch = await readJsonBody(req);
            const cleanPatch = Object.fromEntries(
              Object.entries(patch).filter(([key]) => editableFeatureFields.has(key))
            ) as FeaturePatch;

            const result = await patchFeature(__dirname, dogfoodConfig, featureId, cleanPatch);
            sendJson(res, 200, { feature: result.feature, revision: result.revision });
            return;
          }

          sendJson(res, 404, { error: "Unknown API route" });
        } catch (error) {
          const status = error instanceof FeatureStoreError && error.code === "FEATURE_NOT_FOUND" ? 404 : 500;
          sendJson(res, status, { error: error instanceof Error ? error.message : "Unknown error" });
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), roadmapApiPlugin()],
  server: {
    port: 5173,
    host: "127.0.0.1"
  }
});
