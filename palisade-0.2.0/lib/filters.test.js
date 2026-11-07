import assert from "node:assert/strict";
import test from "node:test";
import { cosmeticFor, dynamicRules, parseCustomFilters, staticRules } from "./filters.js";

test("static lists have unique ids and third-party blocks", () => {
  const rules = staticRules();
  assert.ok(rules.ads.length > 10);
  for (const [name, list] of Object.entries(rules)) {
    const ids = new Set(list.map((rule) => rule.id));
    assert.equal(ids.size, list.length, name);
    assert.equal(list[0].condition.domainType, "thirdParty");
    assert.equal(list[0].action.type, "block");
  }
});

test("custom filter subset", () => {
  const parsed = parseCustomFilters(`
! note
||tracker.example^
@@||good.example^
@@||shop.example^$document
news.example##.sponsor
##.ad-slot
nope
`);
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0].line, 8);
  assert.deepEqual(parsed.blocks, [{ kind: "domain", value: "tracker.example" }]);
  assert.deepEqual(parsed.allows, [
    { kind: "domain", value: "good.example" },
    { kind: "document", value: "shop.example" },
  ]);
  assert.deepEqual(parsed.cosmetic, [
    { domain: "news.example", selector: ".sponsor" },
    { domain: null, selector: ".ad-slot" },
  ]);
});

test("site allow outranks built-in blocks, and category off punches holes", () => {
  const rules = dynamicRules({
    settings: { enabled: true },
    lists: { ads: true, privacy: true },
    customRules: "||extra.example^",
    sites: {
      "ledger.daily": { mode: "allow", categories: {}, cosmetic: [] },
      "shop.example": { mode: "default", categories: { ads: "off" }, cosmetic: [] },
    },
  });
  const siteAllow = rules.find((rule) => rule.condition.initiatorDomains?.[0] === "ledger.daily" && rule.priority === 100);
  assert.ok(siteAllow);
  const custom = rules.find((rule) => rule.condition.requestDomains?.[0] === "extra.example");
  assert.equal(custom.priority, 20);
  const hole = rules.find(
    (rule) => rule.priority === 10 && rule.condition.initiatorDomains?.[0] === "shop.example" && rule.condition.requestDomains?.[0] === "doubleclick.net",
  );
  assert.ok(hole);
});

test("turning a list on for one site adds network blocks only for that site", () => {
  const rules = dynamicRules({
    settings: { enabled: true },
    lists: { ads: false },
    customRules: "",
    sites: {
      "ledger.daily": { mode: "default", categories: { ads: "on" }, cosmetic: [] },
    },
  });
  const hit = rules.find(
    (rule) =>
      rule.priority === 15 &&
      rule.action.type === "block" &&
      rule.condition.initiatorDomains?.[0] === "ledger.daily" &&
      rule.condition.requestDomains?.[0] === "doubleclick.net",
  );
  assert.ok(hit);
  assert.equal(hit.condition.domainType, "thirdParty");
});

test("cosmetic rules respect site allow and list toggles", () => {
  const base = {
    settings: { enabled: true },
    lists: { ads: true, privacy: true, social: false, annoyance: true, malware: true },
    customRules: "ledger.daily##.mine\n##.everywhere",
    sites: {},
  };
  const on = cosmeticFor(base, "ledger.daily");
  assert.ok(on.includes(".ad-banner"));
  assert.ok(on.includes(".mine"));
  assert.ok(on.includes(".everywhere"));
  assert.equal(on.includes(".twitter-share-button"), false);
  const allowed = cosmeticFor({ ...base, sites: { "ledger.daily": { mode: "allow" } } }, "ledger.daily");
  assert.deepEqual(allowed, []);
});
