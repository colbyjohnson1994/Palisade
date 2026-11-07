import assert from "node:assert/strict";
import test from "node:test";
import { stripPlayer, transformPlayerText, youtubeBlocking } from "./youtube.js";

test("player payload loses ad breaks and keeps the video", () => {
  const payload = {
    videoDetails: { videoId: "abc", title: "Song" },
    adPlacements: [{ adPlacementRenderer: { id: 1 } }],
    playerAds: [{ ad: true }],
    adSlots: [{ id: "slot" }],
    adBreakHeartbeatParams: { heartbeat: 1 },
    streamingData: { formats: [{ url: "https://rr.googlevideo.com/videoplayback?id=1" }] },
  };
  assert.equal(stripPlayer(payload), true);
  assert.equal(payload.videoDetails.videoId, "abc");
  assert.equal(payload.streamingData.formats[0].url.includes("videoplayback"), true);
  assert.equal("adPlacements" in payload, false);
  assert.equal("playerAds" in payload, false);
  assert.equal("adSlots" in payload, false);
  assert.equal("adBreakHeartbeatParams" in payload, false);
});

test("nested playlist player responses and feed renderers are cleaned", () => {
  const payload = {
    entries: [{ playerResponse: { videoDetails: { videoId: "1" }, adPlacements: [{ ad: 1 }] } }],
    contents: [{ adSlotRenderer: { x: 1 } }, { videoRenderer: { videoId: "keep" } }, { compactPromotedVideoRenderer: { x: 1 } }],
  };
  assert.equal(stripPlayer(payload), true);
  assert.equal(payload.entries[0].playerResponse.videoDetails.videoId, "1");
  assert.equal("adPlacements" in payload.entries[0].playerResponse, false);
  assert.deepEqual(payload.contents, [{ videoRenderer: { videoId: "keep" } }]);
});

test("transform keeps unrelated json identical", () => {
  const text = JSON.stringify({ videoDetails: { title: "No ads here" } });
  assert.equal(transformPlayerText(text), text);
  const dirty = JSON.stringify({ videoDetails: { title: "Song" }, playerAds: [1], adPlacements: [2] });
  const cleaned = JSON.parse(transformPlayerText(dirty));
  assert.equal(cleaned.videoDetails.title, "Song");
  assert.equal("playerAds" in cleaned, false);
  assert.equal(transformPlayerText("not json adPlacements"), "not json adPlacements");
});

test("youtube blocking follows the master switch, site allow, and per-site override", () => {
  const base = { settings: { enabled: true, blockYoutube: true }, sites: {} };
  assert.equal(youtubeBlocking(base, "www.youtube.com"), true);
  assert.equal(youtubeBlocking(base, "music.youtube.com"), true);
  assert.equal(youtubeBlocking(base, "example.com"), false);
  assert.equal(youtubeBlocking({ settings: { enabled: false, blockYoutube: true }, sites: {} }, "youtube.com"), false);
  assert.equal(youtubeBlocking({ ...base, sites: { "youtube.com": { mode: "allow" } } }, "youtube.com"), false);
  assert.equal(
    youtubeBlocking({ settings: { enabled: true, blockYoutube: false }, sites: { "youtube.com": { mode: "default", categories: { youtube: "on" } } } }, "youtube.com"),
    true,
  );
  assert.equal(
    youtubeBlocking({ settings: { enabled: true, blockYoutube: true }, sites: { "youtube.com": { mode: "default", categories: { youtube: "off" } } } }, "youtube.com"),
    false,
  );
});
