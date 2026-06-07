#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = process.env.DEVNS_REPO || process.cwd();
const artifactDir = process.env.DEVNS_BROWSER_SMOKE_ARTIFACT_ABS_DIR || path.join(root, ".devns", "artifacts", "browser-smoke", "manual");
const url = process.env.DEVNS_BROWSER_SMOKE_URL;

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function viewportFromEnv() {
  const raw = process.env.DEVNS_BROWSER_SMOKE_VIEWPORT || "1440x900";
  const match = /^(\d+)x(\d+)$/.exec(raw);
  if (!match) return { width: 1440, height: 900 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function boundedText(value, maxBytes = 512_000) {
  const buffer = Buffer.from(value || "", "utf8");
  if (buffer.length <= maxBytes) return value || "";
  return `${buffer.subarray(0, maxBytes).toString("utf8")}\n... truncated by DEVNS playwright semantic smoke ...\n`;
}

async function writeText(fileName, value) {
  await writeFile(path.join(artifactDir, fileName), boundedText(value));
}

async function writeJson(fileName, value) {
  await writeText(fileName, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeStructuredRecords(name, records) {
  if (!records.length) {
    await writeJson(`${name}.json`, []);
    return;
  }
  await writeText(`${name}.ndjson`, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
}

async function importPlaywright() {
  const errors = [];
  for (const specifier of ["playwright", "@playwright/test"]) {
    try {
      return await import(specifier);
    } catch (error) {
      errors.push(`${specifier}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Unable to import Playwright. Install playwright or @playwright/test. ${errors.join(" | ")}`);
}

async function safeEvaluate(page, expression, fallback) {
  try {
    return await page.evaluate(expression);
  } catch {
    return fallback;
  }
}

async function accessibilitySnapshot(page) {
  const body = page.locator("body");
  if (typeof body.ariaSnapshot === "function") {
    try {
      const snapshot = await body.ariaSnapshot({ timeout: 5000 });
      if (snapshot) {
        await writeText("accessibility.aria.yml", `${snapshot}\n`);
        return { type: "aria_snapshot", path: "accessibility.aria.yml" };
      }
    } catch {
      // Fall through to the DOM-derived summary below for older Playwright versions.
    }
  }

  const fallback = await safeEvaluate(
    page,
    () =>
      Array.from(document.querySelectorAll("a,button,input,select,textarea,[role],[aria-label],[aria-labelledby],h1,h2,h3,main,nav,header,footer"))
        .slice(0, 300)
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role") || undefined,
          ariaLabel: element.getAttribute("aria-label") || undefined,
          text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240)
        }))
        .filter((item) => item.role || item.ariaLabel || item.text),
    []
  );
  await writeJson("accessibility.json", fallback);
  return { type: "dom_accessibility_fallback", path: "accessibility.json" };
}

if (!url) {
  process.stderr.write("DEVNS_BROWSER_SMOKE_URL is required for playwright semantic smoke.\n");
  process.exit(78);
}

await mkdir(artifactDir, { recursive: true });

const consoleRecords = [];
const networkRecords = [];
const startedAt = new Date().toISOString();
let browser;
let context;
let exitCode = 0;

try {
  const playwright = await importPlaywright();
  const browserName = process.env.DEVNS_BROWSER_SMOKE_BROWSER || "chromium";
  const browserType = playwright[browserName];
  if (!browserType?.launch) {
    throw new Error(`Unknown Playwright browser "${browserName}". Use chromium, firefox, or webkit.`);
  }

  browser = await browserType.launch({
    headless: process.env.DEVNS_BROWSER_SMOKE_HEADLESS !== "false"
  });
  context = await browser.newContext({
    viewport: viewportFromEnv()
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

  const page = await context.newPage();
  page.on("console", (message) => {
    consoleRecords.push({
      type: message.type(),
      text: message.text(),
      location: message.location()
    });
  });
  page.on("pageerror", (error) => {
    consoleRecords.push({
      type: "pageerror",
      text: error instanceof Error ? error.message : String(error)
    });
  });
  page.on("response", (response) => {
    const request = response.request();
    networkRecords.push({
      type: "response",
      method: request.method(),
      url: response.url(),
      status: response.status(),
      resourceType: request.resourceType()
    });
  });
  page.on("requestfailed", (request) => {
    networkRecords.push({
      type: "requestfailed",
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      failed: true,
      failureText: request.failure()?.errorText
    });
  });

  const timeout = envNumber("DEVNS_BROWSER_SMOKE_TIMEOUT_MS", 30_000);
  const waitUntil = process.env.DEVNS_BROWSER_SMOKE_WAIT_UNTIL || "load";
  const response = await page.goto(url, { waitUntil, timeout });
  const selector = process.env.DEVNS_BROWSER_SMOKE_SELECTOR;
  if (selector) {
    await page.locator(selector).first().waitFor({ state: "visible", timeout });
  }
  const settleMs = envNumber("DEVNS_BROWSER_SMOKE_SETTLE_MS", 300);
  if (settleMs) await delay(settleMs);

  const title = await page.title().catch(() => "");
  const visibleText = await page
    .locator("body")
    .innerText({ timeout: 5000 })
    .catch(() => safeEvaluate(page, () => document.body?.innerText || "", ""));
  const html = await page.content().catch(() => "");
  const accessibility = await accessibilitySnapshot(page);

  await writeText("visible-text.txt", `${visibleText}\n`);
  await writeText("dom-snapshot.html", html);
  await page.screenshot({ path: path.join(artifactDir, "screenshot.png"), fullPage: true });
  await writeJson("semantic-summary.json", {
    url,
    finalUrl: page.url(),
    title,
    status: response?.status(),
    accessibility,
    visibleTextBytes: Buffer.byteLength(visibleText || "", "utf8"),
    capturedAt: new Date().toISOString()
  });
} catch (error) {
  exitCode = 1;
  await writeJson("error.json", {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    startedAt,
    completedAt: new Date().toISOString()
  });
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
} finally {
  if (context) {
    await context.tracing.stop({ path: path.join(artifactDir, "trace.zip") }).catch(() => undefined);
  }
  await writeStructuredRecords("console", consoleRecords);
  await writeStructuredRecords("network", networkRecords);
  if (browser) {
    await browser.close().catch(() => undefined);
  }
}

process.exit(exitCode);
