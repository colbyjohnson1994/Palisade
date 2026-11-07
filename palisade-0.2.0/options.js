/**
 * Settings page. Same storage shape as the popup and the service worker.
 * Sections: General, Sites, Filter lists, My filters, Stats.
 */

import { LISTS, parseCustomFilters } from "./lib/filters.js";
import { DEFAULT_STATE, emptySite, loadState } from "./lib/storage.js";

const nav = document.querySelector("#nav");
const panel = document.querySelector("#panel");
const sections = [
  ["general", "General"],
  ["sites", "Sites"],
  ["lists", "Filter lists"],
  ["filters", "My filters"],
  ["stats", "Stats"],
];

let current = location.hash.replace("#", "");
if (!sections.some(([id]) => id === current)) current = "general";
let siteQuery = "";

for (const [id, label] of sections) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.id = id;
  button.textContent = label;
  button.addEventListener("click", () => {
    current = id;
    history.replaceState(null, "", `#${id}`);
    draw();
  });
  nav.append(button);
}

chrome.storage.onChanged.addListener(() => {
  const active = document.activeElement;
  if (active?.id === "site-search" || active?.id === "rules") return;
  draw();
});

draw();

async function draw() {
  for (const button of nav.querySelectorAll("button")) {
    button.setAttribute("aria-current", button.dataset.id === current ? "true" : "false");
  }
  const state = await loadState();
  panel.replaceChildren();
  if (current === "general") renderGeneral(state);
  if (current === "sites") renderSites(state);
  if (current === "lists") renderLists(state);
  if (current === "filters") renderFilters(state);
  if (current === "stats") renderStats(state);
}

function renderGeneral(state) {
  panel.append(heading("General", "YouTube video ads are the default. Other switches apply in this browser only. Pausing does not delete site settings."));
  const settings = [
    ["blockYoutube", "Block YouTube video ads", "Strips ad breaks out of the player, then skips any ad that still starts. Allow youtube.com, or turn this off, if you want the ads."],
    ["enabled", "Block everywhere", "Master switch. Turn this off to pause Palisade without forgetting sites."],
    ["showBadge", "Show the blocked count on the icon", "The number is for the current page."],
    ["blockPopups", "Block pop-up windows", "Stops window.open while a site is being filtered. Browser-level pop-ups are separate."],
    ["showContextMenu", "Show Block element in the page menu", "Right-click a page and choose Block element with Palisade."],
  ];
  for (const [key, label, hint] of settings) {
    panel.append(checkCard(label, hint, state.settings[key] !== false, async (on) => {
      const latest = await loadState();
      latest.settings[key] = on;
      await chrome.storage.local.set({ settings: latest.settings });
    }));
  }
  const actions = document.createElement("div");
  actions.className = "actions";
  const exportButton = button("Export backup", "primary");
  exportButton.addEventListener("click", () => downloadBackup(state));
  const importLabel = document.createElement("label");
  importLabel.className = "ghost file";
  importLabel.textContent = "Import backup";
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "application/json";
  file.hidden = true;
  file.addEventListener("change", async () => {
    const chosen = file.files?.[0];
    file.value = "";
    if (!chosen) return;
    try {
      const json = JSON.parse(await chosen.text());
      if (json?.palisade !== 1) throw new Error("not a backup");
      await chrome.storage.local.set({
        version: 1,
        settings: { ...DEFAULT_STATE.settings, ...(json.settings || {}) },
        lists: { ...DEFAULT_STATE.lists, ...(json.lists || {}) },
        customRules: typeof json.customRules === "string" ? json.customRules : "",
        sites: json.sites && typeof json.sites === "object" ? json.sites : {},
        stats: { ...DEFAULT_STATE.stats, ...(json.stats || {}) },
      });
    } catch {
      window.alert("That file is not a Palisade backup.");
    }
  });
  importLabel.append(file);
  const reset = button("Reset everything", "ghost");
  reset.addEventListener("click", async () => {
    if (!window.confirm("Clear saved sites, custom filters, and stats on this browser?")) return;
    await chrome.storage.local.set(structuredClone(DEFAULT_STATE));
  });
  actions.append(exportButton, importLabel, reset);
  panel.append(actions);
}

function renderLists(state) {
  panel.append(heading("Filter lists", "Starter lists written for Palisade. They are not EasyList. A site can override any of these. YouTube video ads are not in these lists."));
  for (const [id, list] of Object.entries(LISTS)) {
    const count = list.domains.length + list.paths.length;
    panel.append(checkCard(`${list.title} · ${count} network rules`, list.description, state.lists[id] !== false, async (on) => {
      const latest = await loadState();
      latest.lists[id] = on;
      await chrome.storage.local.set({ lists: latest.lists });
    }));
  }
}

function renderFilters(state) {
  panel.append(heading("My filters", "One rule per line. Supported syntax is listed under the box. Other lines are saved but not applied. These do not block YouTube video ads; that switch is under General."));
  const area = document.createElement("textarea");
  area.id = "rules";
  area.spellcheck = false;
  area.value = state.customRules || "";
  area.setAttribute("aria-label", "Custom filters");
  const errors = document.createElement("div");
  const paint = () => {
    const parsed = parseCustomFilters(area.value);
    errors.replaceChildren();
    if (!parsed.errors.length) return;
    const list = document.createElement("ul");
    list.className = "error";
    for (const error of parsed.errors) {
      const item = document.createElement("li");
      item.textContent = `Line ${error.line}: ${error.message}`;
      list.append(item);
    }
    errors.append(list);
  };
  let timer = 0;
  area.addEventListener("input", () => {
    paint();
    clearTimeout(timer);
    timer = setTimeout(() => chrome.storage.local.set({ customRules: area.value }), 300);
  });
  panel.append(area, errors);
  const help = document.createElement("pre");
  help.textContent = [
    "! comments start with an exclamation mark",
    "||doubleclick.net^",
    "||facebook.com/tr^",
    "@@||good.example^",
    "@@||shop.example^$document",
    "news.example##.sponsor",
    "##.ad-slot",
  ].join("\n");
  panel.append(help);
  paint();
}

function renderSites(state) {
  panel.append(heading("Remembered sites", "Allow a site, or turn one list on or off there, and Palisade keeps that choice. YouTube video ads can be turned off for youtube.com without turning them off everywhere."));
  const search = document.createElement("input");
  search.id = "site-search";
  search.type = "search";
  search.placeholder = "Filter by domain";
  search.value = siteQuery;
  search.addEventListener("input", () => {
    siteQuery = search.value;
    const cards = panel.querySelector("#site-cards");
    if (cards) fillSites(cards, state);
  });
  panel.append(search);
  const cards = document.createElement("div");
  cards.id = "site-cards";
  panel.append(cards);
  fillSites(cards, state);
}

function fillSites(cards, state) {
  cards.replaceChildren();
  const hosts = new Set([...Object.keys(state.sites || {}), ...Object.keys(state.stats.byHost || {})]);
  const needle = siteQuery.trim().toLowerCase();
  const list = [...hosts].filter((host) => !needle || host.includes(needle)).sort();
  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = needle ? "No site matches that filter." : "Nothing remembered yet. Browse a site, or allow one from the toolbar.";
    cards.append(empty);
    return;
  }
  for (const host of list) {
    const site = state.sites[host] || emptySite();
    const stat = state.stats.byHost?.[host] || { visits: 0, blocked: 0, lastVisit: 0 };
    const card = document.createElement("article");
    card.className = "card";
    const title = document.createElement("strong");
    title.textContent = host;
    const meta = document.createElement("p");
    meta.className = "muted";
    const when = stat.lastVisit ? new Date(stat.lastVisit).toLocaleString() : "not visited yet";
    meta.textContent = `${stat.visits || 0} visits · ${stat.blocked || 0} blocked · ${when}`;
    const modeRow = document.createElement("label");
    modeRow.className = "check";
    modeRow.append(text("This site"));
    const mode = document.createElement("select");
    mode.setAttribute("aria-label", `Mode for ${host}`);
    for (const [value, label] of [["default", "Use my lists"], ["allow", "Allow everything"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = (site.mode || "default") === value;
      mode.append(option);
    }
    mode.addEventListener("change", () => saveSite(host, (next) => { next.mode = mode.value; }));
    modeRow.append(mode);
    card.append(title, meta, modeRow);
    card.append(categorySelect(host, site, "youtube", "YouTube video ads", state.settings.blockYoutube !== false));
    for (const [id, listDef] of Object.entries(LISTS)) {
      card.append(categorySelect(host, site, id, listDef.title, state.lists[id] !== false));
    }
    if (site.cosmetic?.length) {
      const hidden = document.createElement("ul");
      for (const item of site.cosmetic) {
        const li = document.createElement("li");
        li.textContent = item.selector;
        const remove = button("Remove", "link");
        remove.addEventListener("click", () => saveSite(host, (next) => {
          next.cosmetic = (next.cosmetic || []).filter((entry) => entry.selector !== item.selector);
        }));
        li.append(remove);
        hidden.append(li);
      }
      card.append(hidden);
    }
    const forget = button("Forget this site", "link");
    forget.addEventListener("click", async () => {
      const latest = await loadState();
      delete latest.sites[host];
      if (latest.stats.byHost) delete latest.stats.byHost[host];
      await chrome.storage.local.set({ sites: latest.sites, stats: latest.stats });
    });
    card.append(forget);
    cards.append(card);
  }
}

function categorySelect(host, site, id, title, globalOn) {
  const row = document.createElement("label");
  row.className = "check";
  row.append(text(title));
  const select = document.createElement("select");
  select.setAttribute("aria-label", `${title} on ${host}`);
  const value = site.categories?.[id] || "inherit";
  for (const [optionValue, label] of [
    ["inherit", globalOn ? "Same as global (on)" : "Same as global (off)"],
    ["on", "On for this site"],
    ["off", "Off for this site"],
  ]) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = label;
    option.selected = value === optionValue;
    select.append(option);
  }
  select.addEventListener("change", () => saveSite(host, (next) => {
    next.categories = { ...next.categories, [id]: select.value };
  }));
  row.append(select);
  return row;
}

function renderStats(state) {
  panel.append(heading("Stats", "Counts stay on this device. YouTube video ads are counted when an ad break is removed or skipped. Hidden elements are always counted."));
  const today = dayKey();
  const cards = document.createElement("div");
  cards.className = "stats";
  cards.append(statCard(String(state.stats.allTime || 0), "Blocked in total"), statCard(String(state.stats.byDay?.[today] || 0), "Blocked today"));
  panel.append(cards);
  const days = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    const key = dayKey(date);
    days.push({ key, value: state.stats.byDay?.[key] || 0, label: key.slice(5) });
  }
  const max = Math.max(1, ...days.map((day) => day.value));
  const chart = document.createElement("div");
  chart.className = "card";
  for (const day of days) {
    const row = document.createElement("div");
    row.className = "bar-row";
    const label = document.createElement("span");
    label.textContent = day.label;
    const track = document.createElement("div");
    track.className = "track";
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.width = `${Math.round((day.value / max) * 100)}%`;
    track.append(bar);
    const value = document.createElement("span");
    value.textContent = String(day.value);
    row.append(label, track, value);
    chart.append(row);
  }
  panel.append(chart);
  const categories = document.createElement("div");
  categories.className = "card";
  const names = { ...Object.fromEntries(Object.entries(LISTS).map(([id, list]) => [id, list.title])), youtube: "YouTube video ads", cosmetic: "Hidden elements", popups: "Pop-ups", custom: "Custom" };
  const entries = Object.entries(state.stats.byCategory || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No blocks recorded yet.";
    categories.append(empty);
  }
  for (const [id, count] of entries) {
    const row = document.createElement("div");
    row.className = "row";
    row.append(text(names[id] || id), text(String(count)));
    categories.append(row);
  }
  panel.append(categories);
}

async function saveSite(host, edit) {
  const latest = await loadState();
  const site = latest.sites[host] || emptySite();
  edit(site);
  latest.sites[host] = site;
  await chrome.storage.local.set({ sites: latest.sites });
}

function downloadBackup(state) {
  const payload = { palisade: 1, exportedAt: new Date().toISOString(), ...state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "palisade-backup.json";
  link.click();
  URL.revokeObjectURL(url);
}

function heading(title, textContent) {
  const wrap = document.createElement("div");
  const h = document.createElement("h2");
  h.textContent = title;
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = textContent;
  wrap.append(h, p);
  return wrap;
}

function checkCard(label, hint, on, onChange) {
  const card = document.createElement("div");
  card.className = "card";
  const row = document.createElement("div");
  row.className = "check";
  const copy = document.createElement("span");
  const strong = document.createElement("strong");
  strong.textContent = label;
  const small = document.createElement("span");
  small.className = "muted";
  small.textContent = hint;
  copy.append(strong, document.createElement("br"), small);
  const toggle = document.createElement("button");
  toggle.className = "switch";
  toggle.type = "button";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-checked", on ? "true" : "false");
  toggle.setAttribute("aria-label", label);
  toggle.innerHTML = "<i></i>";
  toggle.addEventListener("click", () => onChange(toggle.getAttribute("aria-checked") !== "true"));
  row.append(copy, toggle);
  card.append(row);
  return card;
}

function statCard(value, label) {
  const card = document.createElement("div");
  card.className = "card stat";
  const number = document.createElement("p");
  number.className = "count";
  number.textContent = value;
  const caption = document.createElement("p");
  caption.className = "muted";
  caption.textContent = label;
  card.append(number, caption);
  return card;
}

function button(label, kind) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = kind;
  node.textContent = label;
  return node;
}

function text(value) {
  const span = document.createElement("span");
  span.textContent = value;
  return span;
}

function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
