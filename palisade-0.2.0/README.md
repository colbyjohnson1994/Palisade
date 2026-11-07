# Palisade 0.2.0

Source tree for Palisade, a Manifest V3 blocker for Microsoft Edge and Chrome. The main feature is YouTube video ads.

Two archives:

- `Palisade-0.2.0.zip` is the release. Unzip it and load the folder. It has only the files the browser runs.
- `Palisade-0.2.0-source.zip` is this tree: `CODE.md`, tests, `lib/youtube.js`, `youtube-boot.js`, and `build-rules.mjs`.

Palisade removes ad breaks from the player response before the video starts, hides the ad slots on the home and search pages, and skips any ad that still begins. Playback stays on `googlevideo.com`. Blocking that host would stop the video itself.

Palisade is not Adblock Plus and it does not ship EasyList. It also has a toolbar switch, per-site memory, a short starter list, your own filters, element blocking, a pop-up block, and stats.

## Install on Edge

1. Unzip `Palisade-0.2.0.zip`. Leave the `palisade-0.2.0` folder intact.
2. Open `edge://extensions`.
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select the `palisade-0.2.0` folder (the one that contains `manifest.json`).
5. Pin Palisade. Open a YouTube video.

If you already loaded 0.1.0, click Reload on the extension card, then reload YouTube.

The icon on a YouTube tab says **Blocking video ads**. The switch under it turns video ads off for that site only and remembers the choice. Settings → General has the global YouTube switch. Allow the site, from the big switch, if you want every ad back. Reload the tab after you change it. An ad that is already on screen is muted and skipped.

## Reload after you edit

On the extensions page, click Reload on Palisade. Then reload the site you are testing.

## Tests

From this folder:

```sh
node --test lib/filters.test.js lib/youtube.test.js
```

If you edit the starter lists or the YouTube cleaner:

```sh
node build-rules.mjs
```

## Read the code

[CODE.md](CODE.md) is the map. The YouTube path is `lib/youtube.js` (the rules) and `youtube-boot.js` (the page hooks). `youtube.js` is the generated file Edge actually runs.
