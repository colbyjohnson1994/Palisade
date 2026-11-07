/**
 * Toolbar popup. Reads the active tab, then reads and writes chrome.storage.local.
 * The service worker rebuilds network rules when that storage changes.
 */

import { LISTS } from "./lib/filters.js";
import { emptySite, hostFromUrl, loadState } from "./lib/storage.js";
import { isYoutubeHost, youtubeBlocking } from "./lib/youtube.js";

const domainEl = document.querySelector("#domain");
const statusEl = document.querySelector("#status");
const memoryEl = document.querySelector("#memory");
const switchEl = document.querySelector("#site-switch");
const countEl = document.querySelector("#count");
const categoriesEl = document.querySelector("#categories");
const noteEl = document.querySelector("#note");

const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
const host = tab?.url ? hostFromUrl(tab.url) : null;

document.querySelector("#open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.querySelector("#close").addEventListener("click", () => window.close());
document.querySelector("#pause").addEventListener("click", toggleGlobal);
document.querySelector("#reload").addEventListener("click", () => {
  if (tab?.id) chrome.tabs.reload(tab.id);
  window.close();
});
document.querySelector("#pick").addEventListener("click", async () => {
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, { type: "pick" });
  window.close();
});
switchEl.addEventListener("click", toggleSite);

render();
chrome.storage.onChanged.addListener(() => render());

async function render() {
  const state = await loadState();
  const site = host ? state.sites[host] || emptySite() : null;
  const enabled = state.settings.enabled !== false;
  const allowed = site?.mode === "allow";
  const blocking = Boolean(host) && enabled && !allowed;
  domainEl.textContent = host || "This page can't be filtered";
  statusEl.textContent = !host ? "Nothing to block here" : !enabled ? "Paused everywhere" : allowed ? "Allowed on this site" : isYoutubeHost(host) && youtubeBlocking(state, host) ? "Blocking video ads" : "Blocking on this site";
  const custom = site && (site.mode !== "default" || site.cosmetic?.length || Object.values(site.categories || {}).some((value) => value && value !== "inherit"));
  memoryEl.textContent = custom ? "Saved for this site" : "Using default lists";
  switchEl.setAttribute("aria-checked", blocking ? "true" : "false");
  switchEl.disabled = !host;
  switchEl.setAttribute("aria-label", blocking ? "Turn blocking off for this site" : "Turn blocking on for this site");
  const session = tab?.id != null ? await chrome.storage.session.get(`tab:${tab.id}`) : {};
  countEl.textContent = String(session[`tab:${tab?.id}`] || 0);
  document.querySelector("#pause").textContent = enabled ? "Pause everywhere" : "Resume everywhere";
  noteEl.textContent = host && isYoutubeHost(host) ? "Reload the video after changing this. An ad already on screen is skipped." : host ? `These choices stay saved for ${host} on this browser.` : "";
  categoriesEl.replaceChildren();
  if (!host) return;
  if (isYoutubeHost(host)) {
    const override = site.categories?.youtube || "inherit";
    const globalOn = state.settings.blockYoutube !== false;
    const on = override === "on" ? true : override === "off" ? false : globalOn;
    categoriesEl.append(categoryRow("YouTube video ads", on, !enabled || allowed, async () => {
      const next = !on;
      const value = next === globalOn ? "inherit" : next ? "on" : "off";
      const latest = await loadState();
      const current = latest.sites[host] || emptySite();
      current.categories = { ...current.categories, youtube: value };
      latest.sites[host] = current;
      await chrome.storage.local.set({ sites: latest.sites });
    }));
  }
  for (const [id, list] of Object.entries(LISTS)) {
    const override = site.categories?.[id] || "inherit";
    const globalOn = state.lists[id] !== false;
    const on = override === "on" ? true : override === "off" ? false : globalOn;
    const row = categoryRow(list.title, on, !enabled || allowed, async () => {
      const next = !on;
      const value = next === globalOn ? "inherit" : next ? "on" : "off";
      const latest = await loadState();
      const current = latest.sites[host] || emptySite();
      current.categories = { ...current.categories, [id]: value };
      latest.sites[host] = current;
      await chrome.storage.local.set({ sites: latest.sites });
    });
    categoriesEl.append(row);
  }
}

function categoryRow(title, on, disabled, onClick) {
  const row = document.createElement("div");
  row.className = "row split";
  const label = document.createElement("span");
  label.textContent = title;
  const button = document.createElement("button");
  button.className = "switch";
  button.type = "button";
  button.setAttribute("role", "switch");
  button.setAttribute("aria-checked", on ? "true" : "false");
  button.setAttribute("aria-label", title);
  button.disabled = disabled;
  button.innerHTML = "<i></i>";
  button.addEventListener("click", onClick);
  row.append(label, button);
  return row;
}

async function toggleSite() {
  if (!host) return;
  const state = await loadState();
  if (!state.settings.enabled) {
    state.settings.enabled = true;
    await chrome.storage.local.set({ settings: state.settings });
  }
  const site = state.sites[host] || emptySite();
  site.mode = site.mode === "allow" ? "default" : "allow";
  state.sites[host] = site;
  await chrome.storage.local.set({ sites: state.sites });
}

async function toggleGlobal() {
  const state = await loadState();
  state.settings.enabled = !state.settings.enabled;
  await chrome.storage.local.set({ settings: state.settings });
}
