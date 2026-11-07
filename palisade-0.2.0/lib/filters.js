/**
 * Palisade filter compiler. No Chrome APIs — safe to run in Node tests.
 *
 * Built-in network rules are original starter lists (not a copy of EasyList).
 * Custom rules use a small Adblock Plus-compatible subset:
 *
 *   ||host^                 block that host and its subdomains
 *   ||host/path^            block a URL prefix
 *   @@||host^               allow that host
 *   @@||host^$document      allow every request started by that site
 *   example.com##.sponsor   hide .sponsor on that host
 *   ##.sponsor              hide .sponsor on every site
 *   ! comment
 *
 * Anything else is reported as an error and skipped.
 */

export const RESOURCE_TYPES = [
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "media",
  "other",
];

/** @type {Record<string, { title: string, description: string, domains: string[], paths: string[], cosmetic: string[] }>} */
export const LISTS = {
  ads: {
    title: "Ads",
    description: "Common ad servers and banner slots.",
    domains: [
      "doubleclick.net",
      "googlesyndication.com",
      "googleadservices.com",
      "googletagservices.com",
      "adservice.google.com",
      "pagead2.googlesyndication.com",
      "adnxs.com",
      "adsrvr.org",
      "rubiconproject.com",
      "pubmatic.com",
      "openx.net",
      "casalemedia.com",
      "criteo.com",
      "criteo.net",
      "taboola.com",
      "outbrain.com",
      "moatads.com",
      "amazon-adsystem.com",
      "media.net",
      "3lift.com",
      "lijit.com",
      "sharethrough.com",
      "teads.tv",
      "yieldmo.com",
      "adform.net",
      "smartadserver.com",
      "contextweb.com",
      "bidswitch.net",
      "ads-twitter.com",
      "adroll.com",
    ],
    paths: [],
    cosmetic: [
      ".ad-banner",
      ".ad-rail",
      ".ad-inline",
      ".sponsored-card",
      ".preroll-ad",
      ".signature-ad",
      "iframe[src*='doubleclick.net']",
      "iframe[src*='googlesyndication.com']",
      "ins.adsbygoogle",
    ],
  },
  privacy: {
    title: "Trackers",
    description: "Analytics, tag managers, and tracking pixels. Turning this off leaves measurement scripts running.",
    domains: [
      "google-analytics.com",
      "googletagmanager.com",
      "hotjar.com",
      "mouseflow.com",
      "mxpnl.com",
      "segment.io",
      "segment.com",
      "fullstory.com",
      "clarity.ms",
      "demdex.net",
      "omtrdc.net",
      "scorecardresearch.com",
      "quantserve.com",
      "chartbeat.com",
      "nr-data.net",
    ],
    paths: ["||facebook.com/tr", "||www.facebook.com/tr"],
    cosmetic: ["img[src*='facebook.com/tr']", "img[src*='google-analytics.com']"],
  },
  social: {
    title: "Social widgets",
    description: "Share buttons and embedded social scripts.",
    domains: ["platform.twitter.com", "syndication.twitter.com", "platform.instagram.com", "connect.facebook.net"],
    paths: [],
    cosmetic: [
      ".twitter-share-button",
      ".fb-like",
      ".fb-share-button",
      "iframe[src*='platform.twitter.com']",
      "iframe[src*='facebook.com/plugins']",
    ],
  },
  annoyance: {
    title: "Annoyances",
    description: "Newsletter pop-overs and common cookie bars.",
    domains: ["privy.com", "justuno.com", "optinmonster.com"],
    paths: [],
    cosmetic: [
      "#onetrust-banner-sdk",
      "#onetrust-consent-sdk",
      ".cc-banner",
      "#cookie-notice",
      ".cookie-notice",
      ".cookie-banner",
      "#cookie-law-info-bar",
      ".cky-consent-container",
      "#gdpr-cookie-notice",
    ],
  },
  malware: {
    title: "Aggressive pop-unders",
    description: "Pop-under and malvertising networks. This is a starter list, not antivirus.",
    domains: [
      "popads.net",
      "popcash.net",
      "hilltopads.net",
      "clickadu.com",
      "propellerads.com",
      "exoclick.com",
      "juicyads.com",
      "trafficjunky.net",
      "popunder.net",
      "adcash.com",
    ],
    paths: [],
    cosmetic: [".scare-popup"],
  },
};

/**
 * Static declarativeNetRequest rules, one array per list.
 * IDs are unique inside a list. Priority 1 so dynamic exceptions can override them.
 */
export function staticRules() {
  /** @type {Record<string, object[]>} */
  const out = {};
  for (const [listId, list] of Object.entries(LISTS)) {
    const rules = [];
    let id = 1;
    for (const domain of list.domains) {
      rules.push({
        id: id++,
        priority: 1,
        action: { type: "block" },
        condition: {
          requestDomains: [domain],
          domainType: "thirdParty",
          resourceTypes: RESOURCE_TYPES,
        },
      });
    }
    for (const path of list.paths) {
      rules.push({
        id: id++,
        priority: 1,
        action: { type: "block" },
        condition: {
          urlFilter: `${path}*`,
          domainType: "thirdParty",
          resourceTypes: RESOURCE_TYPES,
        },
      });
    }
    out[listId] = rules;
  }
  return out;
}

/**
 * @param {string} text
 * @returns {{
 *   blocks: { kind: "domain" | "prefix", value: string }[],
 *   allows: { kind: "domain" | "document", value: string }[],
 *   cosmetic: { domain: string | null, selector: string }[],
 *   errors: { line: number, text: string, message: string }[]
 * }}
 */
export function parseCustomFilters(text) {
  const blocks = [];
  const allows = [];
  const cosmetic = [];
  const errors = [];
  const lines = String(text || "").split(/\r?\n/);
  lines.forEach((original, index) => {
    const line = original.trim();
    if (!line || line.startsWith("!") || (line.startsWith("[") && line.endsWith("]"))) return;
    const cosmeticSep = line.includes("#@#") ? "#@#" : line.includes("##") ? "##" : null;
    if (cosmeticSep) {
      const at = line.indexOf(cosmeticSep);
      const domain = line.slice(0, at).trim().toLowerCase();
      const selector = line.slice(at + cosmeticSep.length).trim();
      if (!selector || selector.length > 200) {
        errors.push({ line: index + 1, text: line, message: "Element filter needs a short selector" });
        return;
      }
      if (domain && !isHost(domain)) {
        errors.push({ line: index + 1, text: line, message: "Domain before ## is not a hostname" });
        return;
      }
      if (cosmeticSep === "#@#") {
        errors.push({ line: index + 1, text: line, message: "Element exceptions are not in 0.1.0. Delete the filter instead." });
        return;
      }
      cosmetic.push({ domain: domain || null, selector });
      return;
    }
    const exception = line.startsWith("@@");
    const body = exception ? line.slice(2) : line;
    const documentAllow = /\$document\s*$/i.test(body);
    const pattern = body.replace(/\$document\s*$/i, "");
    const hostRule = pattern.match(/^\|\|([a-z0-9.-]+)(\^)?$/i);
    const pathRule = pattern.match(/^\|\|([a-z0-9.-]+)(\/[^$^]*)\^?$/i);
    if (hostRule && isHost(hostRule[1])) {
      if (exception && documentAllow) allows.push({ kind: "document", value: hostRule[1].toLowerCase() });
      else if (exception) allows.push({ kind: "domain", value: hostRule[1].toLowerCase() });
      else blocks.push({ kind: "domain", value: hostRule[1].toLowerCase() });
      return;
    }
    if (pathRule && isHost(pathRule[1]) && !exception) {
      blocks.push({ kind: "prefix", value: `||${pathRule[1].toLowerCase()}${pathRule[2]}` });
      return;
    }
    errors.push({
      line: index + 1,
      text: line,
      message: "Unsupported in 0.1.0. Use ||host^, @@||host^, @@||host^$document, or ##selector.",
    });
  });
  return { blocks, allows, cosmetic, errors };
}

export function isHost(value) {
  return /^[a-z0-9.-]+$/i.test(value) && value.includes(".") && !value.startsWith(".") && !value.endsWith(".");
}

/**
 * Dynamic rules that implement custom filters and per-site exceptions.
 * IDs start at 100000 so they never collide with the static lists.
 *
 * Priority:
 *   10  per-site category allow (beats built-in blocks)
 *   15  per-site category block (used when that list is off globally)
 *   20  custom block
 *   30  custom allow
 *   100 whole-site allow
 */
export function dynamicRules(state) {
  const rules = [];
  let id = 100000;
  const next = () => id++;
  const lists = state.lists || {};
  const sites = state.sites || {};
  const globalOn = state.settings?.enabled !== false;

  if (globalOn) {
    const parsed = parseCustomFilters(state.customRules || "");
    for (const block of parsed.blocks) {
      rules.push(block.kind === "domain" ? domainRule(next(), 20, "block", block.value) : prefixRule(next(), 20, "block", block.value));
    }
    for (const allow of parsed.allows) {
      if (allow.kind === "document") rules.push(initiatorAllow(next(), 100, allow.value));
      else rules.push(domainRule(next(), 30, "allow", allow.value));
    }
    for (const [domain, site] of Object.entries(sites)) {
      if (!isHost(domain)) continue;
      if (site.mode === "allow") {
        rules.push(initiatorAllow(next(), 100, domain));
        continue;
      }
      for (const [listId, list] of Object.entries(LISTS)) {
        const override = (site.categories || {})[listId] || "inherit";
        const globalOn = lists[listId] !== false;
        if (override === "off" && globalOn) {
          for (const host of list.domains) rules.push(domainRule(next(), 10, "allow", host, domain));
          for (const path of list.paths) rules.push(prefixRule(next(), 10, "allow", path, domain));
        }
        if (override === "on" && !globalOn) {
          for (const host of list.domains) rules.push(domainRule(next(), 15, "block", host, domain));
          for (const path of list.paths) rules.push(prefixRule(next(), 15, "block", path, domain));
        }
      }
    }
  }
  return rules;
}

function domainRule(id, priority, type, host, initiator) {
  const condition = {
    requestDomains: [host],
    resourceTypes: RESOURCE_TYPES,
  };
  if (initiator) condition.initiatorDomains = [initiator];
  if (type === "block") condition.domainType = "thirdParty";
  return { id, priority, action: { type }, condition };
}

function prefixRule(id, priority, type, urlFilter, initiator) {
  const condition = {
    urlFilter: `${urlFilter}*`,
    resourceTypes: RESOURCE_TYPES,
  };
  if (type === "block") condition.domainType = "thirdParty";
  if (initiator) condition.initiatorDomains = [initiator];
  return {
    id,
    priority,
    action: { type },
    condition,
  };
}

function initiatorAllow(id, priority, host) {
  return {
    id,
    priority,
    action: { type: "allow" },
    condition: {
      initiatorDomains: [host],
      resourceTypes: RESOURCE_TYPES,
    },
  };
}

/** Cosmetic selectors that should apply on this hostname right now. */
export function cosmeticFor(state, hostname) {
  if (state.settings?.enabled === false) return [];
  const site = (state.sites || {})[hostname];
  if (site?.mode === "allow") return [];
  const selectors = [];
  const lists = state.lists || {};
  for (const [listId, list] of Object.entries(LISTS)) {
    const override = site?.categories?.[listId] || "inherit";
    const enabled = override === "on" ? true : override === "off" ? false : lists[listId] !== false;
    if (!enabled) continue;
    selectors.push(...list.cosmetic);
  }
  const parsed = parseCustomFilters(state.customRules || "");
  for (const rule of parsed.cosmetic) {
    if (!rule.domain || hostMatches(hostname, rule.domain)) selectors.push(rule.selector);
  }
  for (const rule of site?.cosmetic || []) {
    if (rule.selector) selectors.push(rule.selector);
  }
  return [...new Set(selectors)];
}

export function hostMatches(hostname, domain) {
  const host = hostname.toLowerCase();
  const root = domain.toLowerCase();
  return host === root || host.endsWith(`.${root}`);
}

export function bareHost(hostname) {
  return String(hostname || "").toLowerCase().replace(/^www\./, "");
}
