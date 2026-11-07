/**
 * Service worker.
 *
 * Owns two browser mechanisms the pages cannot:
 *   1. declarativeNetRequest — network blocks and per-site exceptions
 *   2. the toolbar badge and the running block count
 *
 * Popup and options write chrome.storage.local. This file listens and
 * rebuilds dynamic rules. Static lists live in rules/*.json and are only
 * enabled or disabled as a whole.
 */

import { dynamicRules } from "./lib/filters.js";
import { DEFAULT_STATE, LIST_IDS, dayKey, emptySite, hostFromUrl, loadState } from "./lib/storage.js";

const TAB_KEY = (tabId) => `tab:${tabId}`;

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(null);
  if (!current.version) await chrome.storage.local.set(DEFAULT_STATE);
  await setupMenus();
  await apply();
});

chrome.runtime.onStartup.addListener(() => {
  setupMenus();
  apply();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.stats && Object.keys(changes).length === 1) return;
  scheduleApply();
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading" && info.url) {
    chrome.storage.session.remove(TAB_KEY(tabId));
    chrome.action.setBadgeText({ tabId, text: "" });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(TAB_KEY(tabId));
});

chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener((info) => {
  const tabId = info.request.tabId;
  if (tabId < 0) return;
  const list = info.rule.rulesetId;
  if (!list || !LIST_IDS.includes(list)) return;
  recordBlock(tabId, list);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === "block-element") {
    chrome.tabs.sendMessage(tab.id, { type: "pick" }).catch(() => {});
  }
  if (info.menuItemId === "toggle-site" && tab.url) {
    const host = hostFromUrl(tab.url);
    if (!host) return;
    const state = await loadState();
    const site = state.sites[host] || emptySite();
    site.mode = site.mode === "allow" ? "default" : "allow";
    state.sites[host] = site;
    await chrome.storage.local.set({ sites: state.sites });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender).then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});

let chain = Promise.resolve();
function scheduleApply() {
  chain = chain.then(() => apply()).catch((error) => console.error("Palisade apply failed", error));
}

async function apply() {
  const state = await loadState();
  const enabled = [];
  const disabled = [];
  for (const id of LIST_IDS) {
    if (state.settings.enabled && state.lists[id] !== false) enabled.push(id);
    else disabled.push(id);
  }
  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enabled,
    disableRulesetIds: disabled,
  });
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const addRules = dynamicRules(state).slice(0, 4500);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules,
  });
  await setupMenus();
  if (!state.settings.enabled || !state.settings.showBadge) {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id != null) chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    }
  }
  chrome.action.setBadgeBackgroundColor({ color: "#1F4A3D" });
}

async function setupMenus() {
  const state = await loadState();
  await chrome.contextMenus.removeAll();
  if (!state.settings.showContextMenu) return;
  chrome.contextMenus.create({
    id: "block-element",
    title: "Block element with Palisade",
    contexts: ["all"],
  });
  chrome.contextMenus.create({
    id: "toggle-site",
    title: "Allow or block this site",
    contexts: ["page"],
  });
}

async function recordBlock(tabId, category, count = 1) {
  return updateStats(async (stats, state) => {
    if (!state.settings.enabled) return;
    const n = Math.max(1, Math.min(2000, Number(count) || 1));
    const key = TAB_KEY(tabId);
    const session = await chrome.storage.session.get(key);
    const total = (session[key] || 0) + n;
    await chrome.storage.session.set({ [key]: total });
    if (state.settings.showBadge) {
      chrome.action.setBadgeText({ tabId, text: total > 999 ? "999+" : String(total) });
      chrome.action.setBadgeBackgroundColor({ color: "#1F4A3D" });
    }
    const today = dayKey();
    stats.allTime += n;
    stats.byDay[today] = (stats.byDay[today] || 0) + n;
    stats.byCategory[category] = (stats.byCategory[category] || 0) + n;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const host = tab?.url ? hostFromUrl(tab.url) : null;
    if (host) {
      stats.byHost = stats.byHost || {};
      const row = stats.byHost[host] || { visits: 0, blocked: 0, lastVisit: 0 };
      row.blocked += n;
      stats.byHost[host] = row;
    }
  });
}

let statsChain = Promise.resolve();
function updateStats(mutator) {
  statsChain = statsChain.then(async () => {
    const state = await loadState();
    state.stats.byHost = state.stats.byHost || {};
    const before = JSON.stringify(state.stats);
    await mutator(state.stats, state);
    if (JSON.stringify(state.stats) !== before) await chrome.storage.local.set({ stats: state.stats });
  });
  return statsChain;
}

async function handle(message, sender) {
  if (message?.type === "cosmetic-blocked" && sender.tab?.id != null) {
    await recordBlock(sender.tab.id, message.category || "cosmetic", message.count || 1);
    return { ok: true };
  }
  if (message?.type === "youtube-blocked" && sender.tab?.id != null) {
    await recordBlock(sender.tab.id, "youtube");
    return { ok: true };
  }
  if (message?.type === "popup-blocked" && sender.tab?.id != null) {
    await recordBlock(sender.tab.id, "popups");
    return { ok: true };
  }
  if (message?.type === "visit" && sender.tab?.id != null && sender.frameId === 0) {
    const host = hostFromUrl(sender.tab.url || "");
    if (!host) return { ok: false };
    await updateStats(async (stats) => {
      stats.byHost = stats.byHost || {};
      const row = stats.byHost[host] || { visits: 0, blocked: 0, lastVisit: 0 };
      row.visits += 1;
      row.lastVisit = Date.now();
      stats.byHost[host] = row;
    });
    return { ok: true };
  }
  if (message?.type === "add-cosmetic") {
    const state = await loadState();
    const host = message.host;
    if (!host || !message.selector) return { ok: false };
    const site = state.sites[host] || emptySite();
    const already = site.cosmetic.some((item) => item.selector === message.selector);
    if (!already) site.cosmetic.push({ selector: message.selector, label: message.label || message.selector });
    state.sites[host] = site;
    await chrome.storage.local.set({ sites: state.sites });
    return { ok: true };
  }
  if (message?.type === "tab-count") {
    const key = TAB_KEY(message.tabId);
    const session = await chrome.storage.session.get(key);
    return { ok: true, count: session[key] || 0 };
  }
  return { ok: false };
}
