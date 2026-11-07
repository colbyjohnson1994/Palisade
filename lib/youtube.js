/**
 * YouTube video-ad decisions and player-response cleaning.
 * No browser APIs. youtube.js in the extension is generated from this file.
 */

export const AD_KEYS = ["adPlacements", "playerAds", "adSlots", "adBreakHeartbeatParams"];

const AD_KEY_SET = new Set(AD_KEYS);

/** Renderer objects YouTube uses for video and feed ads. Not the video itself. */
export const AD_RENDERERS = [
  "adSlotRenderer",
  "adPlacementRenderer",
  "playerLegacyDesktopWatchAdsRenderer",
  "promotedSparklesWebRenderer",
  "compactPromotedVideoRenderer",
  "displayAdRenderer",
  "inFeedAdLayoutRenderer",
  "bannerPromoRenderer",
  "statementBannerRenderer",
  "primetimePromoRenderer",
  "videoMastheadAdV3Renderer",
];

const AD_RENDERER_SET = new Set(AD_RENDERERS);

export const YOUTUBE_CSS = `
ytd-ad-slot-renderer,
ytd-banner-promo-renderer,
ytd-statement-banner-renderer,
ytd-in-feed-ad-layout-renderer,
ytd-promoted-sparkles-web-renderer,
ytd-promoted-sparkles-text-search-renderer,
ytd-display-ad-renderer,
ytd-video-masthead-ad-v3-renderer,
ytd-primetime-promo-renderer,
ytd-companion-slot-renderer,
ytd-action-companion-ad-renderer,
ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
#masthead-ad,
#player-ads,
.ytd-mealbar-promo-renderer,
ytm-promoted-sparkles-web-renderer,
.ytp-ad-overlay-slot,
.ytp-ad-text-overlay {
  display: none !important;
}
`.trim();

export function isYoutubeHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtubekids.com" || host.endsWith(".youtubekids.com") || host === "youtube-nocookie.com" || host.endsWith(".youtube-nocookie.com");
}

/**
 * True when this page should have video ads removed.
 * Site allow, a per-site "off", and the master pause all win.
 * settings.blockYoutube is the default for every YouTube host.
 */
export function youtubeBlocking(state, hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  if (!isYoutubeHost(host)) return false;
  if (state?.settings?.enabled === false) return false;
  const site = state?.sites?.[host];
  if (site?.mode === "allow") return false;
  const override = site?.categories?.youtube || "inherit";
  if (override === "off") return false;
  if (override === "on") return true;
  return state?.settings?.blockYoutube !== false;
}

export function shouldInspectUrl(url) {
  const value = String(url || "");
  if (!value) return false;
  return value.includes("/youtubei/v1/player") || value.includes("/youtubei/v1/next") || value.includes("/youtubei/v1/browse") || value.includes("/youtubei/v1/reel") || value.includes("ad_break") || value.includes("/get_midroll") || value.includes("/pagead/") || value.includes("ptracking");
}

/** Delete ad fields in place. Returns true when something was removed. */
export function stripPlayer(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 7) return false;
  if (Array.isArray(value)) {
    if (value.length > 800) return false;
    let changed = false;
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const item = value[index];
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const keys = Object.keys(item);
        if (keys.length === 1 && (AD_RENDERER_SET.has(keys[0]) || AD_KEY_SET.has(keys[0]))) {
          value.splice(index, 1);
          changed = true;
          continue;
        }
      }
      if (stripPlayer(item, depth + 1)) changed = true;
    }
    return changed;
  }
  let changed = false;
  for (const key of AD_KEYS) {
    if (key in value) {
      delete value[key];
      changed = true;
    }
  }
  for (const key of Object.keys(value)) {
    if (AD_RENDERER_SET.has(key)) {
      delete value[key];
      changed = true;
      continue;
    }
    const child = value[key];
    if (child && typeof child === "object" && stripPlayer(child, depth + 1)) changed = true;
  }
  return changed;
}

/** Return the original string when it has no ad payload or it is not JSON. */
export function transformPlayerText(text) {
  if (typeof text !== "string" || text.length < 2 || text.length > 6_000_000) return text;
  if (!text.includes("adPlacement") && !text.includes("playerAds") && !text.includes("adSlots") && !text.includes("adBreakHeartbeatParams") && !text.includes("adSlotRenderer") && !text.includes("PromotedSparkles") && !text.includes("promotedSparkles")) {
    return text;
  }
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || !stripPlayer(data)) return text;
    return JSON.stringify(data);
  } catch {
    return text;
  }
}
