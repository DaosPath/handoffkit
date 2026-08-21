#!/usr/bin/env node
/**
 * Reproducible WCAG 2.x AA audit for the live Studio Browser Inspector.
 *
 * This is an automated audit, not a claim of complete conformance. It runs
 * axe-core against real Chromium at the same responsive widths as the visual
 * smoke and records keyboard/focus checks separately. A non-empty violation
 * set fails closed; no rule is disabled or downgraded to a warning.
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const browserRealRoot = path.join(root, "packages", "js", "browser-real");
const webRoot = path.join(root, "apps", "web");
const browserRequire = createRequire(path.join(browserRealRoot, "package.json"));
const webRequire = createRequire(path.join(webRoot, "package.json"));
const playwrightPath = browserRequire.resolve("playwright", { paths: [browserRealRoot] });
const axePath = webRequire.resolve("axe-core");
const importedPlaywright = await import(pathToFileURL(playwrightPath).href);
const playwright = importedPlaywright.default || importedPlaywright;

const baseUrl = process.env.HANDOFFKIT_STUDIO_URL || "http://127.0.0.1:3100/studio/browser";
const widths = [375, 768, 1024, 1440];
const outputRoot = path.join(root, ".local-tests", "studio-accessibility");
const outputPath = process.env.HANDOFFKIT_A11Y_OUTPUT
  ? path.resolve(root, process.env.HANDOFFKIT_A11Y_OUTPUT)
  : path.join(outputRoot, "report.json");
await mkdir(outputRoot, { recursive: true });
await mkdir(path.dirname(outputPath), { recursive: true });

const server = await playwright.chromium.launchServer({ headless: true });
const browser = await playwright.chromium.connect({ wsEndpoint: server.wsEndpoint() });
const viewports = [];
try {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    let response;
    let audit;
    let keyboard;
    try {
      response = await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30_000 });
      if (!response || response.status() >= 400) {
        throw new Error(`Studio returned HTTP ${response?.status() ?? 0}`);
      }
      await page.addScriptTag({ path: axePath });
      audit = await page.evaluate(async () => {
        const result = await window.axe.run(document, {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
          },
        });
        return {
          test_engine: result.testEngine,
          test_runner: result.testRunner,
          test_environment: result.testEnvironment,
          pass_count: result.passes.length,
          incomplete: result.incomplete.map(({ id, impact, description, help, helpUrl }) => ({
            id, impact, description, help, help_url: helpUrl,
          })),
          violations: result.violations.map(({ id, impact, description, help, helpUrl, nodes }) => ({
            id,
            impact,
            description,
            help,
            help_url: helpUrl,
            node_count: nodes.length,
            targets: nodes.map((node) => node.target),
          })),
        };
      });
      keyboard = await page.evaluate(() => {
        const visible = (element) => {
          const style = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          return style.visibility !== "hidden" && style.display !== "none"
            && box.width > 0 && box.height > 0;
        };
        const interactive = [...document.querySelectorAll(
          "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])",
        )].filter(visible);
        const missingNames = interactive.filter((element) => {
          const name = element.getAttribute("aria-label")
            || element.getAttribute("title")
            || element.textContent?.trim();
          return !name;
        }).length;
        const mainCount = document.querySelectorAll("main").length;
        const skipLink = document.querySelector("a.security-skip-link[href='#browser-content']");
        return {
          interactive_count: interactive.length,
          missing_accessible_name_count: missingNames,
          main_count: mainCount,
          skip_link: Boolean(skipLink),
        };
      });
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => {
        const element = document.activeElement;
        if (!(element instanceof HTMLElement)) return { visible: false, has_indicator: false };
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          name: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 80) || "",
          visible: box.width > 0 && box.height > 0,
          has_indicator: style.outlineStyle !== "none" && style.outlineWidth !== "0px"
            || style.boxShadow !== "none",
        };
      });
      keyboard.focus = focus;
    } catch (error) {
      audit = {
        test_engine: null,
        test_runner: null,
        test_environment: null,
        pass_count: 0,
        incomplete: [],
        violations: [{ id: "audit_execution", impact: "critical", description: String(error), node_count: 0, targets: [] }],
      };
      keyboard = { error: String(error) };
    } finally {
      await context.close();
    }
    viewports.push({
      width,
      height: 900,
      status: response?.status() ?? 0,
      ...audit,
      keyboard,
    });
  }
} finally {
  await browser.close().catch(() => {});
  await server.close().catch(() => {});
}

const violations = viewports.flatMap((viewport) => viewport.violations.map((violation) => ({
  viewport: viewport.width,
  id: violation.id,
  impact: violation.impact,
  description: violation.description,
  help: violation.help,
  help_url: violation.help_url,
  node_count: violation.node_count,
})));
const keyboardFailures = viewports.flatMap((viewport) => {
  const checks = [];
  if (viewport.status !== 200) checks.push("http_status");
  if ((viewport.keyboard?.missing_accessible_name_count || 0) > 0) checks.push("missing_accessible_name");
  if (viewport.keyboard?.main_count !== 1) checks.push("main_landmark_count");
  if (!viewport.keyboard?.skip_link) checks.push("skip_link");
  if (!viewport.keyboard?.focus?.visible || !viewport.keyboard?.focus?.has_indicator) checks.push("keyboard_focus_indicator");
  return checks.map((check) => ({ viewport: viewport.width, check }));
});
const report = {
  format: "handoffkit.studio.accessibility-audit",
  format_version: 1,
  generated_at: new Date().toISOString(),
  url: baseUrl,
  engine: "axe-core",
  engine_version: viewports.find((viewport) => viewport.test_engine?.version)?.test_engine?.version || null,
  standard: "WCAG 2.x A/AA automated rules (axe tags wcag2a, wcag2aa, wcag21aa, wcag22aa)",
  notice: "Automated audit plus limited keyboard/landmark checks; manual assistive-technology review remains separate.",
  status: violations.length === 0 && keyboardFailures.length === 0 ? "pass" : "fail",
  violations,
  keyboard_failures: keyboardFailures,
  viewports,
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (report.status !== "pass") process.exitCode = 1;
