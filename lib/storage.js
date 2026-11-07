/**
 * Default settings and small storage helpers shared by the popup, options
 * page, and service worker. Content scripts do not import this file; they
 * read chrome.storage.local with the same shape documented in CODE.md.
 */

export const LIST_IDS = ["ads", "privacy", "social", "annoyance", "malware"];

export const DEFAULT_STATE = {
  version: 1,
  settings: {
    enabled: true,
    showBadge: true,
    blockPopups: true,
    showContextMenu: true,
    blockYoutube: true,
  },
  lists: {
    ads: true,
    privacy: true,
    social: true,
    annoyance: true,
    malware: true,
  },
  customRules: "",
  sites: {},
  stats: {
    allTime: 0,
    byDay: {},
    byCategory: {},
    byHost: {},
  },
};

export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function emptySite() {
  return { mode: "default", categories: {}, cosmetic: [] };
}

export async function loadState() {
  const stored = await chrome.storage.local.get(DEFAULT_STATE);
  return {
    ...DEFAULT_STATE,
    ...stored,
    settings: { ...DEFAULT_STATE.settings, ...(stored.settings || {}) },
    lists: { ...DEFAULT_STATE.lists, ...(stored.lists || {}) },
    sites: stored.sites || {},
    stats: { ...DEFAULT_STATE.stats, ...(stored.stats || {}) },
  };
}

/** www.example.com and example.com share one remembered policy. */
export function bareHost(hostname) {
  return String(hostname || "").toLowerCase().replace(/^www\./, "");
}

export function hostFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return bareHost(parsed.hostname);
  } catch {
    return null;
  }
}
