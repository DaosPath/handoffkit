import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  emptyStudioBrowserSnapshot,
  parseStudioBrowserEvent,
  parseStudioBrowserNdjson,
  reduceStudioBrowserEvents,
  StudioBrowserEventError,
} from "./browser-events.ts";

const fixtureUrl = new URL(
  "../../../../../packages/contracts/test-fixtures/browser/studio-browser-events-v1.ndjson",
  import.meta.url,
);

test("Studio Browser Inspector parses real NDJSON only", async () => {
  const events = parseStudioBrowserNdjson(await readFile(fixtureUrl, "utf8"));
  const snapshot = reduceStudioBrowserEvents(events, { generatedAt: "2026-08-13T12:00:08Z" });
  assert.equal(events.length, 8);
  assert.equal(snapshot.source.status, "connected");
  assert.equal(snapshot.plan.search_plan, "platform");
  assert.equal(snapshot.errors[0].code, "provider_challenge");
  assert.equal(snapshot.claims[0].status, "not_found");
  assert.equal(snapshot.recovery.delivery, "at_least_once");
  assert.equal(snapshot.profile.kind, "ephemeral");
});

test("Studio Browser Inspector rejects mocks and secrets", () => {
  const base = {
    format: "handoffkit.studio.browser-event",
    event_id: "x",
    event_type: "browser.progress",
    occurred_at: "2026-08-13T12:00:00Z",
    payload: { message: "ok" },
  };
  assert.throws(
    () => parseStudioBrowserEvent({ ...base, mock: true }),
    (error) => error instanceof StudioBrowserEventError,
  );
  assert.throws(
    () => parseStudioBrowserEvent({ ...base, payload: { cookie: "abc" } }),
    (error) => error instanceof StudioBrowserEventError,
  );
  const empty = emptyStudioBrowserSnapshot("unconfigured");
  assert.equal(empty.timeline.length, 0);
  assert.equal(empty.source.status, "unconfigured");
});

test("authorized screenshot is preserved and never invented", () => {
  const event = parseStudioBrowserEvent({
    format: "handoffkit.studio.browser-event",
    event_id: "shot",
    event_type: "browser.page",
    occurred_at: "2026-08-13T12:00:00Z",
    payload: {
      url: "https://example.org/",
      title: "Example",
      screenshot_authorized: true,
      screenshot: "data:image/png;base64,AAA",
    },
  });
  const snapshot = reduceStudioBrowserEvents([event]);
  assert.equal(snapshot.page.screenshot_authorized, true);
  assert.equal(snapshot.page.screenshot.startsWith("data:image/png"), true);
  const empty = emptyStudioBrowserSnapshot("unconfigured");
  assert.equal(empty.page, null);
});
