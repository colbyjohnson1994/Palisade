/**
 * Content script. Isolated from the page.
 *
 * Hides elements that match the active cosmetic lists and any selectors
 * you saved with Block element. Network blocks are not done here; the
 * service worker handles those with declarativeNetRequest.
 *
 * page-hook.js runs in the page world (see the manifest) and blocks
 * window.open when this script tells it to.
 */

const STYLE_ID = "palisade-cosmetic";
let picking = false;
let lastSelectors = [];
let reportedKey = "";
let reported = 0;

init();

async function init() {
  if (window.top === window) chrome.runtime.sendMessage({ type: "visit" }).catch(() => {});
  const state = await chrome.storage.local.get(null);
  apply(state);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    chrome.storage.local.get(null).then(apply);
  });
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.source === "palisade" && event.data.type === "popup-blocked") {
      chrome.runtime.sendMessage({ type: "popup-blocked" }).catch(() => {});
    }
    if (event.data?.source === "palisade" && event.data.type === "youtube-blocked") {
      chrome.runtime.sendMessage({ type: "youtube-blocked" }).catch(() => {});
    }
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "pick") startPicker();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && picking) stopPicker();
  });
  const watch = () => {
    const root = document.documentElement;
    if (!root) return;
    new MutationObserver(() => scheduleReport()).observe(root, { childList: true, subtree: true });
  };
  if (document.documentElement) watch();
  else document.addEventListener("DOMContentLoaded", watch, { once: true });
}

function apply(state) {
  const host = location.hostname.replace(/^www\./, "").toLowerCase();
  const selectors = cosmeticFor(normalize(state), host);
  lastSelectors = selectors;
  const style = document.getElementById(STYLE_ID) || document.createElement("style");
  style.id = STYLE_ID;
  const next = selectors.map((selector) => `${selector}{display:none !important;}`).join("\n");
  if (style.textContent !== next) {
    style.textContent = next;
    if (!style.parentNode) (document.documentElement || document.head).appendChild(style);
  }
  const site = (state.sites || {})[host];
  const blocking = state.settings?.enabled !== false && site?.mode !== "allow";
  const blockPopups = blocking && state.settings?.blockPopups !== false;
  window.postMessage({ source: "palisade", type: "popups", block: blockPopups }, "*");
  window.postMessage({ source: "palisade", type: "youtube", block: youtubeOn(normalize(state), host) }, "*");
  scheduleReport();
}

function normalize(state) {
  return {
    settings: state.settings || { enabled: true, blockPopups: true, blockYoutube: true },
    lists: state.lists || { ads: true, privacy: true, social: true, annoyance: true, malware: true },
    customRules: state.customRules || "",
    sites: state.sites || {},
  };
}

/** Same decision as lib/youtube.js youtubeBlocking(). Keep the two in agreement. */
function youtubeOn(state, host) {
  const name = String(host || "").toLowerCase().replace(/^www\./, "");
  const yt = name === "youtube.com" || name.endsWith(".youtube.com") || name === "youtubekids.com" || name.endsWith(".youtubekids.com") || name === "youtube-nocookie.com" || name.endsWith(".youtube-nocookie.com");
  if (!yt) return false;
  if (state.settings?.enabled === false) return false;
  const site = state.sites?.[name];
  if (site?.mode === "allow") return false;
  const override = site?.categories?.youtube || "inherit";
  if (override === "off") return false;
  if (override === "on") return true;
  return state.settings?.blockYoutube !== false;
}

/**
 * Same decision as lib/filters.js cosmeticFor(). Duplicated so this classic
 * content script does not need to be a module (Edge loads it earlier that way).
 */
function cosmeticFor(state, hostname) {
  if (state.settings.enabled === false) return [];
  const site = state.sites[hostname];
  if (site?.mode === "allow") return [];
  const lists = self.PALISADE_COSMETIC || {};
  const selectors = [];
  for (const [listId, group] of Object.entries(lists)) {
    const override = site?.categories?.[listId] || "inherit";
    const enabled = override === "on" ? true : override === "off" ? false : state.lists[listId] !== false;
    if (enabled) selectors.push(...group);
  }
  for (const rule of parseCosmetic(state.customRules)) {
    if (!rule.domain || hostname === rule.domain || hostname.endsWith(`.${rule.domain}`)) selectors.push(rule.selector);
  }
  for (const rule of site?.cosmetic || []) {
    if (rule.selector) selectors.push(rule.selector);
  }
  return [...new Set(selectors)];
}

function parseCosmetic(text) {
  const rules = [];
  for (const original of String(text || "").split(/\r?\n/)) {
    const line = original.trim();
    if (!line || line.startsWith("!") || line.includes("#@#")) continue;
    const at = line.indexOf("##");
    if (at === -1) continue;
    const domain = line.slice(0, at).trim().toLowerCase();
    const selector = line.slice(at + 2).trim();
    if (!selector) continue;
    rules.push({ domain: domain || null, selector });
  }
  return rules;
}

let reportTimer = 0;
function scheduleReport() {
  clearTimeout(reportTimer);
  reportTimer = setTimeout(reportCosmetic, 400);
}

function reportCosmetic() {
  if (window.top !== window) return;
  const key = lastSelectors.join("\0");
  if (key !== reportedKey) {
    reportedKey = key;
    reported = 0;
  }
  let count = 0;
  for (const selector of lastSelectors) {
    try {
      count += document.querySelectorAll(selector).length;
    } catch {
      /* a bad custom selector must not break the rest */
    }
  }
  if (count <= reported) return;
  const delta = Math.min(2000, count - reported);
  reported = count;
  chrome.runtime.sendMessage({ type: "cosmetic-blocked", category: "cosmetic", count: delta }).catch(() => {});
}

function startPicker() {
  if (picking) return;
  picking = true;
  const host = ensureUi();
  const root = host.shadowRoot;
  root.getElementById("banner").hidden = false;
  root.getElementById("panel").hidden = true;
  document.addEventListener("mousemove", hover, true);
  document.addEventListener("click", choose, true);
}

function stopPicker() {
  picking = false;
  document.removeEventListener("mousemove", hover, true);
  document.removeEventListener("click", choose, true);
  const host = document.getElementById("palisade-picker");
  if (!host) return;
  host.shadowRoot.getElementById("banner").hidden = true;
  host.shadowRoot.getElementById("panel").hidden = true;
  host.shadowRoot.getElementById("box").hidden = true;
}

function hover(event) {
  const element = event.target;
  if (!(element instanceof Element) || element.id === "palisade-picker") return;
  const box = document.getElementById("palisade-picker").shadowRoot.getElementById("box");
  const rect = element.getBoundingClientRect();
  box.hidden = false;
  box.style.top = `${rect.top}px`;
  box.style.left = `${rect.left}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;
}

function choose(event) {
  const element = event.target;
  if (!(element instanceof Element) || element.id === "palisade-picker") return;
  event.preventDefault();
  event.stopPropagation();
  document.removeEventListener("mousemove", hover, true);
  document.removeEventListener("click", choose, true);
  const ladder = buildLadder(element);
  const root = document.getElementById("palisade-picker").shadowRoot;
  root.getElementById("banner").hidden = true;
  const panel = root.getElementById("panel");
  panel.hidden = false;
  const range = root.getElementById("range");
  range.max = String(Math.max(0, ladder.length - 1));
  range.value = String(Math.max(0, ladder.findIndex((item) => item.selector.startsWith("."))));
  const paint = () => {
    const item = ladder[Number(range.value)] || ladder[0];
    root.getElementById("selector").textContent = item.selector;
    root.getElementById("hint").textContent = item.hint;
    let count = 0;
    try {
      count = document.querySelectorAll(item.selector).length;
    } catch {
      count = 0;
    }
    root.getElementById("count").textContent = `Hides ${count} on this page`;
  };
  range.oninput = paint;
  paint();
  root.getElementById("save").onclick = () => {
    const item = ladder[Number(range.value)] || ladder[0];
    const host = location.hostname.replace(/^www\./, "").toLowerCase();
    const siteOnly = root.getElementById("site-only").checked;
    if (siteOnly) {
      chrome.runtime.sendMessage({
        type: "add-cosmetic",
        host,
        selector: item.selector,
        label: item.selector,
      });
    } else {
      chrome.storage.local.get({ customRules: "" }).then(({ customRules }) => {
        const line = `##${item.selector}`;
        if (!String(customRules).split("\n").includes(line)) {
          chrome.storage.local.set({ customRules: `${String(customRules).trim()}\n${line}`.trim() });
        }
      });
    }
    stopPicker();
  };
  root.getElementById("cancel").onclick = stopPicker;
}

function buildLadder(element) {
  const tag = element.tagName.toLowerCase();
  const classes = [...element.classList].filter((name) => name && name.length < 40);
  const items = [];
  if (element.id) items.push({ selector: `#${CSS.escape(element.id)}`, hint: "This element only" });
  if (classes.length) {
    const classSel = `.${classes.map((name) => CSS.escape(name)).join(".")}`;
    items.push({ selector: classSel, hint: "Elements with these classes" });
    items.push({ selector: `${tag}${classSel}`, hint: `Every ${tag} with these classes` });
  }
  items.push({ selector: tag, hint: `Every ${tag} — very broad` });
  const seen = new Set();
  return items.filter((item) => (seen.has(item.selector) ? false : seen.add(item.selector)));
}

function ensureUi() {
  let host = document.getElementById("palisade-picker");
  if (host) return host;
  host = document.createElement("div");
  host.id = "palisade-picker";
  host.style.all = "initial";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .banner, .panel { position: fixed; z-index: 2147483647; font: 14px/1.4 system-ui, sans-serif; }
      .banner { top: 0; left: 0; right: 0; display: flex; justify-content: space-between; gap: 12px; padding: 10px 16px; background: #1f4a3d; color: #f3efe6; }
      .banner button, .panel button { min-height: 44px; border: 0; background: transparent; color: #e4c48a; font-weight: 650; cursor: pointer; }
      .panel { right: 12px; bottom: 12px; left: 12px; max-width: 380px; margin-left: auto; padding: 16px; border-radius: 16px; background: #f7f3ea; color: #1c2420; box-shadow: 0 12px 40px rgba(0,0,0,.25); }
      .panel .row { display: flex; gap: 8px; margin-top: 12px; }
      .panel .save { flex: 1; border-radius: 10px; background: #1f4a3d; color: #f3efe6; }
      .panel .cancel { border-radius: 10px; border: 1px solid #ddd4c4; color: #1c2420; }
      #selector { font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all; color: #5c675f; }
      #box { position: fixed; z-index: 2147483646; border: 2px solid #a8742a; pointer-events: none; }
      label { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    </style>
    <div id="box" hidden></div>
    <div class="banner" id="banner" hidden>
      <span>Click anything on this page to block it.</span>
      <button id="banner-cancel" type="button">Cancel</button>
    </div>
    <div class="panel" id="panel" hidden>
      <strong>Block element</strong>
      <p id="selector"></p>
      <input id="range" type="range" min="0" max="0" value="0" aria-label="Selector breadth">
      <p id="hint"></p>
      <p id="count"></p>
      <label><input id="site-only" type="checkbox" checked> Only on this site</label>
      <div class="row">
        <button class="save" id="save" type="button">Block</button>
        <button class="cancel" id="cancel" type="button">Cancel</button>
      </div>
    </div>
  `;
  document.documentElement.appendChild(host);
  shadow.getElementById("banner-cancel").onclick = stopPicker;
  return host;
}
