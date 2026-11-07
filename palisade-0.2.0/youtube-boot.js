/**
 * Page-world half of the YouTube blocker. Concatenated after lib/youtube.js
 * into youtube.js. Runs at document_start, before the player reads its config.
 */
let block = true;
let lastNote = 0;
let adActive = false;

const SKIP_BUTTONS = [
  ".ytp-skip-ad-button",
  ".ytp-ad-skip-button",
  ".ytp-ad-skip-button-modern",
  ".ytp-ad-skip-button-slot button",
  "button.ytp-ad-skip-button-modern",
].join(",");

if (window.__palisadeYoutube) {
  /* already installed */
} else {
  window.__palisadeYoutube = true;
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "palisade" || data.type !== "youtube") return;
    block = Boolean(data.block);
    syncStyle();
  });
  syncStyle();
  trapPlayerResponse();
  hookParse();
  hookFetch();
  hookXhr();
  setInterval(tick, 400);
}

function note() {
  const now = Date.now();
  if (now - lastNote < 800) return;
  lastNote = now;
  window.postMessage({ source: "palisade", type: "youtube-blocked" }, "*");
}

function syncStyle() {
  const existing = document.getElementById("palisade-youtube");
  if (!block) {
    existing?.remove();
    return;
  }
  const style = existing || document.createElement("style");
  style.id = "palisade-youtube";
  style.textContent = YOUTUBE_CSS;
  if (!style.parentNode) (document.documentElement || document.head).appendChild(style);
}

function trapPlayerResponse() {
  let stored;
  try {
    stored = window.ytInitialPlayerResponse;
  } catch {
    stored = undefined;
  }
  try {
    Object.defineProperty(window, "ytInitialPlayerResponse", {
      configurable: true,
      enumerable: true,
      get() {
        return stored;
      },
      set(value) {
        if (block && value && typeof value === "object" && stripPlayer(value)) note();
        stored = value;
      },
    });
  } catch {
    /* the player locked this property; fetch and the sweep still run */
  }
  if (block && stored && typeof stored === "object" && stripPlayer(stored)) note();
}

function hookParse() {
  const nativeParse = JSON.parse;
  JSON.parse = function palisadeParse(text, reviver) {
    const value = nativeParse.call(this, text, reviver);
    if (!block || typeof text !== "string" || text.length > 6_000_000) return value;
    if (!text.includes("adPlacement") && !text.includes("playerAds") && !text.includes("adSlots") && !text.includes("adBreakHeartbeatParams")) return value;
    if (value && typeof value === "object" && stripPlayer(value)) note();
    return value;
  };
}

function hookFetch() {
  const nativeFetch = window.fetch;
  if (typeof nativeFetch !== "function") return;
  window.fetch = function palisadeFetch(input, init) {
    const pending = nativeFetch.apply(this, arguments);
    if (!block) return pending;
    let url = "";
    try {
      if (typeof input === "string") url = input;
      else if (input instanceof URL) url = input.href;
      else url = input?.url || "";
    } catch {
      url = "";
    }
    if (!shouldInspectUrl(url)) return pending;
    return pending.then((response) => rewriteResponse(response));
  };
}

async function rewriteResponse(response) {
  try {
    const text = await response.clone().text();
    const next = transformPlayerText(text);
    if (next === text) return response;
    note();
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    return new Response(next, { status: response.status, statusText: response.statusText, headers });
  } catch {
    return response;
  }
}

function hookXhr() {
  const xhrOpen = XMLHttpRequest.prototype.open;
  const textDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "responseText");
  const responseDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "response");
  XMLHttpRequest.prototype.open = function palisadeOpen(method, url) {
    try {
      this.__palisadeUrl = String(url || "");
    } catch {
      /* some hosts seal the xhr object */
    }
    return xhrOpen.apply(this, arguments);
  };
  if (textDesc?.get) {
    Object.defineProperty(XMLHttpRequest.prototype, "responseText", {
      configurable: true,
      get() {
        const text = textDesc.get.call(this);
        if (!block || this.readyState !== 4 || typeof text !== "string" || !shouldInspectUrl(this.__palisadeUrl || "")) return text;
        if (this.__palisadeText) return this.__palisadeText;
        const next = transformPlayerText(text);
        if (next === text) return text;
        this.__palisadeText = next;
        note();
        return next;
      },
    });
  }
  if (responseDesc?.get) {
    Object.defineProperty(XMLHttpRequest.prototype, "response", {
      configurable: true,
      get() {
        if (block && this.__palisadeText && (this.responseType === "" || this.responseType === "text")) return this.__palisadeText;
        const value = responseDesc.get.call(this);
        if (block && this.readyState === 4 && this.responseType === "json" && shouldInspectUrl(this.__palisadeUrl || "") && value && typeof value === "object" && stripPlayer(value)) {
          note();
        }
        return value;
      },
    });
  }
}

function tick() {
  if (!block) return;
  const current = window.ytInitialPlayerResponse;
  if (current && typeof current === "object") stripPlayer(current);
  dismissWall();
  closeOverlays();
  skipPlayingAd();
}

function closeOverlays() {
  document.querySelectorAll(".ytp-ad-overlay-close-button").forEach((button) => {
    button.click();
  });
}

function skipPlayingAd() {
  const player = document.querySelector("#movie_player, .html5-video-player");
  if (!player) return;
  const showing = player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting") || Boolean(player.querySelector(".ytp-ad-player-overlay, .ytp-ad-preview-container"));
  if (!showing) {
    adActive = false;
    return;
  }
  const video = player.querySelector("video");
  if (video) {
    video.muted = true;
    if (video.playbackRate < 16) video.playbackRate = 16;
    if (Number.isFinite(video.duration) && video.duration > 0.3 && video.currentTime < video.duration - 0.15) {
      try {
        video.currentTime = video.duration - 0.05;
      } catch {
        /* the ad element can reject seeks until metadata loads */
      }
    }
  }
  player.querySelectorAll(SKIP_BUTTONS).forEach((button) => button.click());
  if (typeof player.skipAd === "function") {
    try {
      player.skipAd();
    } catch {
      /* private player method; the seek above is the real fallback */
    }
  }
  if (!adActive) {
    adActive = true;
    note();
  }
}

function dismissWall() {
  const dialogs = document.querySelectorAll("ytd-enforcement-message-view-model, tp-yt-paper-dialog");
  let hit = false;
  dialogs.forEach((dialog) => {
    const text = (dialog.textContent || "").toLowerCase();
    if (!text.includes("ad blocker") && !text.includes("use of ad blockers") && !text.includes("blockers aren't allowed") && !text.includes("blockers violate")) return;
    dialog.remove();
    hit = true;
  });
  if (!hit) return;
  document.querySelectorAll("tp-yt-iron-overlay-backdrop").forEach((node) => node.remove());
  const video = document.querySelector("#movie_player video, .html5-video-player video");
  if (video && video.paused) video.play().catch(() => {});
  note();
}
