import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FeatureStoreError, patchFeature } from "./packages/core/src/harness/state";
import { readLatestMorningReview } from "./packages/core/src/harness/morning-review";
import type { FeaturePatch, DevnsConfig } from "./packages/core/src/harness/types";

const projectRoot = process.env.DEVNS_PROJECT_DIR ?? __dirname;
const inventoryPath = process.env.DEVNS_FEATURES_PATH ?? ".devns/features.json";
const candidatesPath = process.env.DEVNS_CANDIDATES_PATH ?? ".devns/candidates.json";
const roadmapPath = path.resolve(projectRoot, inventoryPath);
const candidatesRoadmapPath = path.resolve(projectRoot, candidatesPath);
const dashboardConfig: DevnsConfig = {
  version: 1,
  features: inventoryPath,
  candidates: candidatesPath,
  review: {
    outputDir: ".devns/reviews"
  }
};
const editableFeatureFields = new Set(["status", "priority", "reviewDecision", "agentNotes", "rfc"]);

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

async function readCandidatesPayload() {
  try {
    const raw = await readFile(candidatesRoadmapPath, "utf8");
    const parsed = JSON.parse(raw) as { candidates?: unknown[] };
    return Array.isArray(parsed.candidates) ? parsed.candidates : [];
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function roadmapApiPlugin() {
  return {
    name: "devns-roadmap-api",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        try {
          if (!req.url?.startsWith("/api/")) {
            next();
            return;
          }

          if (req.method === "GET" && req.url === "/api/roadmap") {
            const raw = await readFile(roadmapPath, "utf8");
            sendJson(res, 200, {
              ...JSON.parse(raw),
              candidates: await readCandidatesPayload()
            });
            return;
          }

          if (req.method === "GET" && req.url === "/api/reviews/latest") {
            sendJson(res, 200, {
              report: await readLatestMorningReview(projectRoot, dashboardConfig)
            });
            return;
          }

          const featureMatch = req.url.match(/^\/api\/features\/([^/?#]+)$/);
          if (req.method === "PATCH" && featureMatch) {
            const featureId = decodeURIComponent(featureMatch[1]);
            const body = await readJsonBody(req);
            const patch = "patch" in body ? body.patch : body;
            const expectedRevision = "expectedRevision" in body ? body.expectedRevision : undefined;
            const cleanPatch = Object.fromEntries(
              Object.entries(patch).filter(([key]) => editableFeatureFields.has(key))
            ) as FeaturePatch;

            const result = await patchFeature(projectRoot, dashboardConfig, featureId, cleanPatch, { expectedRevision });
            sendJson(res, 200, { feature: result.feature, revision: result.revision });
            return;
          }

          sendJson(res, 404, { error: "Unknown API route" });
        } catch (error) {
          const status =
            error instanceof FeatureStoreError && error.code === "FEATURE_NOT_FOUND"
              ? 404
              : error instanceof FeatureStoreError && error.code === "REVISION_CONFLICT"
                ? 409
                : 500;
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
