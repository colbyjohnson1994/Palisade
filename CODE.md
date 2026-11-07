# Palisade 0.2.0 — code guide

This release's main feature is YouTube video ads. The rest of the extension is the 0.1.0 blocker: starter lists, per-site memory, custom filters, element blocking, pop-ups, and stats.

Palisade is an original blocker. It is not affiliated with Adblock Plus or YouTube, and the starter lists are not copies of EasyList.

## YouTube video ads

YouTube does not serve the video ad from a separate host you can block. The ad break and the movie both come from `googlevideo.com`. Blocking that host stops the video. Palisade leaves those requests alone.

`youtube.js` is generated from `lib/youtube.js` and `youtube-boot.js`. The manifest runs it in the page world at `document_start`, only on YouTube, YouTube Kids, and youtube-nocookie. It does four things:

1. Deletes `adPlacements`, `playerAds`, `adSlots`, and `adBreakHeartbeatParams` from `ytInitialPlayerResponse`, from `JSON.parse`, and from player, next, browse, and reel responses (fetch and XHR).
2. Drops feed objects that are only an ad renderer (`adSlotRenderer`, `promotedSparklesWebRenderer`, and the rest of `AD_RENDERERS`).
3. Injects `YOUTUBE_CSS` so leftover home, search, and overlay slots do not show.
4. If the player still gets an `ad-showing` state, mutes that video, seeks to the end, and clicks Skip. It also closes overlay ads and dismisses the "ad blockers aren't allowed" dialog when that text is on screen.

`lib/youtube.js` is the part with no browser APIs. `lib/youtube.test.js` checks that a player payload loses the ad break and keeps `videoDetails` and `streamingData`.

The content script cannot read the page world directly. It posts `{ source: "palisade", type: "youtube", block }` after it reads storage. The page script defaults to blocking, so the first player response is cleaned even if storage is still loading. Turning the feature off takes effect on the next response; reload the tab to be sure.

The decision lives in `youtubeBlocking()` and is repeated in `content.js` `youtubeOn()`. Both treat these as off:

- master switch paused
- the site's mode is `allow`
- `sites[host].categories.youtube` is `off`

`settings.blockYoutube` is the default and starts on. A site can force it on while the default is off. `www` is stripped, so `youtube.com` and `www.youtube.com` share one memory. `music.youtube.com` is its own host.

Each removed break posts `{ type: "youtube-blocked" }`. The content script forwards that to the service worker, which counts it as category `youtube`. Notes are throttled to one every 800ms so a busy page does not inflate the badge.

What this will not do: it will not block an ad that YouTube has already stitched into the media file with no `ad-showing` marker. It will not survive a player change that renames every ad field. When that happens, update `AD_KEYS` and the skip-button selectors, run `node build-rules.mjs`, and reload the extension.

## What else this release does

- Blocks third-party requests to the starter ad, tracker, social, annoyance, and pop-under domains.
- Hides a small set of common ad, share, and cookie elements.
- Remembers, per site, "allow everything" and per-list on/off overrides.
- Remembers element hides from Block element.
- Accepts a small custom-filter syntax.
- Blocks `window.open` pop-ups while a site is being filtered.
- Counts blocks and visits on this browser.
- Exports and imports a JSON backup.

## What it does not do yet

- It does not subscribe to remote filter lists. Unknown custom-filter lines are reported and skipped.
- It does not block WebRTC or run an "acceptable ads" program.
- Network hit counts for the starter lists use `declarativeNetRequest.onRuleMatchedDebug`. That event only fires for an unpacked extension. YouTube, element hides, and pop-up blocks are counted in every install.
- A category override blocks or allows the starter domains for that site. It does not rewrite your custom filters. "Allow everything" on a site does outrank custom blocks, and it also turns YouTube cleaning off.
- Single-page URL changes do not count as a new visit. A visit is one document load in the top frame.
- Cosmetic rules can flash for a moment. That is a Manifest V3 limit. The YouTube hook does not wait on storage.

## File map

| File | Role |
| --- | --- |
| `manifest.json` | Permissions, popup, options page, content scripts, static rulesets |
| `background.js` | Service worker. Lists, dynamic rules, badge, context menu, stats |
| `lib/filters.js` | Starter lists, custom-filter parser, rule compiler. No browser APIs |
| `lib/youtube.js` | YouTube decision and player-response cleaner. No browser APIs |
| `lib/youtube.test.js` | Player payload and on/off tests |
| `youtube-boot.js` | Page hooks. Not loaded on its own |
| `youtube.js` | Generated page script. This is what the manifest runs |
| `lib/storage.js` | Default state and `loadState()` |
| `lib/filters.test.js` | Parser and priority tests |
| `build-rules.mjs` | Writes `rules/*.json`, `cosmetic-data.js`, and `youtube.js` |
| `rules/*.json` | Static `declarativeNetRequest` rules. Generated |
| `cosmetic-data.js` | Generated selector groups for the content script |
| `content.js` | Hides elements, tells the page hooks whether pop-ups and YouTube are on |
| `page-hook.js` | Page-world script. Wraps `window.open` |
| `popup.html`, `popup.js` | Toolbar popup. On YouTube the first switch is video ads |
| `options.html`, `options.js` | Full settings tab |
| `ui.css` | Shared popup and settings styles |
| `icons/` | Toolbar icons |

`background.js`, `popup.js`, and `options.js` are ES modules. `content.js`, `page-hook.js`, and `youtube.js` are classic scripts. The YouTube script has to be classic and synchronous: the player reads `ytInitialPlayerResponse` during HTML parse, before any async import can finish.

## How a YouTube watch page is handled

```text
document_start
  youtube.js (page world)
    ├─ setter on ytInitialPlayerResponse
    ├─ JSON.parse / fetch / XHR strip ad fields
    └─ every 400ms: skip a playing ad, close overlays
  content.js (isolated)
    └─ storage, then postMessage { type: "youtube", block }
```

## Storage shape

Everything persistent is one `chrome.storage.local` object.

```js
{
  version: 1,
  settings: {
    enabled: true,
    showBadge: true,
    blockPopups: true,
    showContextMenu: true,
    blockYoutube: true       // default for every YouTube host
  },
  lists: { ads: true, privacy: true, social: true, annoyance: true, malware: true },
  customRules: "",
  sites: {
    "youtube.com": {
      mode: "default",       // "allow" turns video ads back on, with everything else
      categories: {
        youtube: "off"       // "inherit" | "on" | "off"
      },
      cosmetic: []
    }
  },
  stats: {
    allTime: 0,
    byDay: { "2026-11-07": 12 },
    byCategory: { youtube: 4, ads: 9, cosmetic: 2, popups: 1 },
    byHost: { "youtube.com": { visits: 3, blocked: 4, lastVisit: 1730950000000 } }
  }
}
```

The per-tab badge count is `chrome.storage.session` under `tab:<id>`. It is not part of the backup.

## Messages

| `type` | Direction | Effect |
| --- | --- | --- |
| `youtube` | content script → page | `{ block: true/false }` |
| `youtube-blocked` | page → content script → worker | Count one video-ad block |
| `visit` | content script → worker | `stats.byHost[host].visits` |
| `cosmetic-blocked` | content script → worker | Badge and `stats`, category `cosmetic` |
| `popup-blocked` | page hook → content script → worker | Badge and `stats`, category `popups` |
| `add-cosmetic` | content script → worker | Appends to `sites[host].cosmetic` |
| `pick` | popup → content script | Start Block element |

Page messages use `window.postMessage` and `source: "palisade"`.

## Filter syntax in 0.2.0

Custom filters do not affect YouTube video ads. Use the YouTube switch for that. One custom rule per line:

| Line | Meaning |
| --- | --- |
| `! text` | Comment |
| `\|\|host^` | Block that host and its subdomains, third-party only |
| `\|\|host/path^` | Block URLs with that prefix, third-party only |
| `@@\|\|host^` | Allow that host |
| `@@\|\|host^$document` | Allow every request started by that site |
| `example.com##.sponsor` | Hide `.sponsor` on that host |
| `##.sponsor` | Hide `.sponsor` on every site |

`example.com#@#.sponsor` is not supported.

## Rule priority

Static list rules use priority `1`. Dynamic rules start at id `100000`.

| Priority | Rule |
| --- | --- |
| 1 | Built-in list block |
| 10 | This site turned that list off |
| 15 | This site turned that list on while the global list is off |
| 20 | Your `\|\|host^` block |
| 30 | Your `@@\|\|host^` allow |
| 100 | Your `$document` allow, or "allow this site" |

YouTube cleaning is not a declarativeNetRequest rule. Allowing the site turns the page script off. It does not add a network allow for `googlevideo.com`.

## Lists and regeneration

`LISTS` in `lib/filters.js` is the source for the starter lists. `lib/youtube.js` is the source for the video-ad cleaner. `build-rules.mjs` writes `rules/*.json`, `cosmetic-data.js`, and `youtube.js`. Edit the sources, then run the script. The manifest loads the generated files.

## Permissions

| Permission | Why |
| --- | --- |
| `declarativeNetRequest` | Starter-list blocks |
| `declarativeNetRequestFeedback` | Count those network matches. Unpacked installs only |
| `storage` | Save sites and stats |
| `tabs` | Read the active tab's host |
| `contextMenus` | Block element, and allow/block this site |
| `<all_urls>` | Content scripts and starter-list requests. YouTube cleaning only runs on YouTube hosts |

## Tests

```sh
node --test lib/filters.test.js lib/youtube.test.js
```

The worker, popup, and the live player need Edge or Chrome. The unit test does not open YouTube.

## Safe places to change the YouTube blocker

- A new ad field name: add it to `AD_KEYS` in `lib/youtube.js`.
- A new feed card: add the renderer name to `AD_RENDERERS`.
- A renamed Skip button: add the selector to `SKIP_BUTTONS` in `youtube-boot.js`.
- Then `node build-rules.mjs` and reload the extension. `youtube.js` is generated. Edits there are overwritten.
