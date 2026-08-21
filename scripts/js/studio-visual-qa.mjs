#!/usr/bin/env node
/**
 * Local visual/interaction smoke for Studio Browser Inspector. This is not a
 * WCAG conformance audit; it only archives real Chromium screenshots and
 * verifies that the rendered page exposes usable interactive controls.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const packageRoot = path.join(root, "packages", "js", "browser-real");
const require = createRequire(path.join(packageRoot, "package.json"));
const playwrightPath = require.resolve("playwright", { paths: [packageRoot] });
const importedPlaywright = await import(pathToFileURL(playwrightPath).href);
const playwright = importedPlaywright.default || importedPlaywright;
const baseUrl = process.env.HANDOFFKIT_STUDIO_URL || "http://127.0.0.1:3100/studio/browser";
const widths = [375, 768, 1024, 1440];
const outputRoot = path.join(root, ".local-tests", "studio-visual-qa");
await mkdir(outputRoot, { recursive: true });

const server = await playwright.chromium.launchServer({ headless: true });
const browser = await playwright.chromium.connect({ wsEndpoint: server.wsEndpoint() });
const records = [];
try {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const response = await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30_000 });
    const controls = await page.locator("button, input, select, textarea, [role=button]").evaluateAll((items) => items
      .filter((item) => {
        const style = getComputedStyle(item);
        return style.visibility !== "hidden" && style.display !== "none";
      })
      .map((item) => {
        const box = item.getBoundingClientRect();
        return {
          tag: item.tagName.toLowerCase(),
          text: (item.textContent || "").trim().slice(0, 80),
          width: Math.round(box.width),
          height: Math.round(box.height),
          aria_label: item.getAttribute("aria-label") || "",
        };
      }));
    const missingLabel = controls.filter((item) =>
      ["button", "input", "select", "textarea"].includes(item.tag)
      && !item.text && !item.aria_label,
    );
    const screenshot = await page.screenshot({ path: path.join(outputRoot, `studio-${width}.png`), fullPage: true });
    records.push({
      width,
      height: 900,
      status: response?.status() ?? 0,
      controls: controls.length,
      controls_below_40px: controls.filter((item) => item.width < 40 || item.height < 40).length,
      missing_label_count: missingLabel.length,
      control_details: controls,
      screenshot_sha256: createHash("sha256").update(screenshot).digest("hex"),
    });
    await context.close();
  }
} finally {
  await browser.close().catch(() => {});
  await server.close().catch(() => {});
}

const report = {
  format: "handoffkit.studio.visual-qa",
  format_version: 1,
  generated_at: new Date().toISOString(),
  url: baseUrl,
  notice: "Local Chromium visual smoke only; not a formal WCAG 2.2 AA audit.",
  viewports: records,
  status: records.length === widths.length && records.every((item) => item.status === 200) ? "pass" : "fail",
};
await writeFile(path.join(outputRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
