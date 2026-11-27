import test from "node:test";
import assert from "node:assert/strict";
import { analyticsScreen, trackAnalyticsEvent, trackAnalyticsScreen } from "../lib/platform/analytics.ts";

test("web analytics sends category paths and event names without document identifiers or referrers", t => {
  const browser = { dataLayer: [] as unknown[] };
  const scripts: unknown[] = [];
  const originals = Object.getOwnPropertyDescriptors(globalThis);
  const originalId = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
  t.after(() => {
    for (const key of ["window", "location", "document"] as const) {
      const descriptor = originals[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    if (originalId === undefined) delete process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
    else process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID = originalId;
  });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: browser },
    location: { configurable: true, value: { origin: "https://maite.example", href: "https://maite.example/ideal/novels/private-id" } },
    document: { configurable: true, value: { createElement: () => ({}), head: { append: (script: unknown) => scripts.push(script) } } },
  });
  delete process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
  trackAnalyticsEvent("chapter_created");
  assert.equal(scripts.length, 0);
  process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID = "G-123TEST";
  trackAnalyticsScreen("/ideal/novels/private-id");
  trackAnalyticsScreen("/ideal/novels/private-id");
  trackAnalyticsEvent("chapter_created");
  assert.equal(scripts.length, 1);
  assert.equal(analyticsScreen("/ideal/library/gallery/private-id"), "purchased_gallery");
  assert.equal(analyticsScreen("/auth/callback"), undefined);
  const commands = browser.dataLayer.map(entry => Array.from(entry as ArrayLike<unknown>));
  assert.deepEqual(commands.filter(entry => entry[0] === "event"), [
    ["event", "page_view", { page_location: "https://maite.example/ideal/novel_detail", page_referrer: "", page_title: "novel_detail" }],
    ["event", "chapter_created"],
  ]);
  assert.doesNotMatch(JSON.stringify(commands), /private-id/u);
});
