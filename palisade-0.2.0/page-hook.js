/**
 * Runs in the page world, not the extension world.
 * Content scripts cannot wrap window.open; this file can, because the
 * manifest loads it with "world": "MAIN".
 * The content script tells it whether pop-up blocking is on.
 */
(() => {
  if (window.__palisadeHooked) return;
  window.__palisadeHooked = true;
  const nativeOpen = window.open;
  let block = false;
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "palisade" || data.type !== "popups") return;
    block = Boolean(data.block);
  });
  window.open = function palisadeOpen(...args) {
    if (block) {
      window.postMessage({ source: "palisade", type: "popup-blocked" }, "*");
      return null;
    }
    return nativeOpen.apply(this, args);
  };
})();
