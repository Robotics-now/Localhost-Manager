// background.js — service worker
// Owns the toolbar badge: active port count, server-down alert, new-port flash.
// Runs independently of whether the popup is open.

const CONTROL_SERVER = 'http://127.0.0.1:8765';
const BADGE_POLL_INTERVAL_MS = 15000; // how often the background checks things
const NEW_PORT_FLASH_MS = 7000;       // fixed per spec, not user-configurable

const BADGE_NEUTRAL = '#5f6368';        // gray — normal active count
const BADGE_RED = '#ea4335';            // server offline
const BADGE_RED_TRANSLUCENT = '#ea4335cc';
const BADGE_GREEN = '#34a853';          // new port detected
const BADGE_GREEN_TRANSLUCENT = '#34a853cc';

let knownActivePorts = new Set();   // last known active ports, used to detect "new"
let serverDownFlashTimer = null;
let newPortFlashTimer = null;
let flashBlinkInterval = null;      // drives the translucent pulse while flashing
let currentFlashMode = null;        // 'red' | 'green' | null

chrome.runtime.onInstalled.addListener(() => {
  console.log("Localhost Manager installed.");
  initBadge();
});

chrome.runtime.onStartup.addListener(() => {
  initBadge();
});

function initBadge() {
  chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
  updateBadgeCount(0);
  pollOnce();
  setInterval(pollOnce, BADGE_POLL_INTERVAL_MS);
}

// --- Badge rendering ---

function updateBadgeCount(count) {
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  if (currentFlashMode === null) {
    chrome.action.setBadgeBackgroundColor({ color: BADGE_NEUTRAL });
  }
}

function startFlash(mode, durationMs) {
  // A new flash of the same or higher-priority mode resets the timer.
  // Red (server down) takes priority over green (new port) since it's
  // a problem state, not a celebratory one.
  if (currentFlashMode === 'red' && mode === 'green') return;

  stopFlash();
  currentFlashMode = mode;

  const solid = mode === 'red' ? BADGE_RED : BADGE_GREEN;
  const translucent = mode === 'red' ? BADGE_RED_TRANSLUCENT : BADGE_GREEN_TRANSLUCENT;

  let translucentPhase = false;
  chrome.action.setBadgeBackgroundColor({ color: solid });

  flashBlinkInterval = setInterval(() => {
    translucentPhase = !translucentPhase;
    chrome.action.setBadgeBackgroundColor({ color: translucentPhase ? translucent : solid });
  }, 600);

  const timerRef = mode === 'red' ? 'serverDownFlashTimer' : 'newPortFlashTimer';
  const timer = setTimeout(() => {
    stopFlash();
  }, durationMs);

  if (mode === 'red') serverDownFlashTimer = timer;
  else newPortFlashTimer = timer;
}

function stopFlash() {
  if (flashBlinkInterval) { clearInterval(flashBlinkInterval); flashBlinkInterval = null; }
  if (serverDownFlashTimer) { clearTimeout(serverDownFlashTimer); serverDownFlashTimer = null; }
  if (newPortFlashTimer) { clearTimeout(newPortFlashTimer); newPortFlashTimer = null; }
  currentFlashMode = null;
  chrome.action.setBadgeBackgroundColor({ color: BADGE_NEUTRAL });
}

// --- Polling ---

async function pollOnce() {
  const { knownPorts = [], serverDownFlashDuration } = await chrome.storage.local.get(['knownPorts', 'serverDownFlashDuration']);

  // 1. Check active ports among knownPorts (lightweight — no title/favicon fetch here,
  //    that detail work stays in popup.js; background only needs up/down + count)
  const activeNow = new Set();
  await Promise.all(knownPorts.map(async (port) => {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 800);
      await fetch(`http://localhost:${port}`, { mode: 'no-cors', signal: controller.signal });
      clearTimeout(t);
      activeNow.add(port);
    } catch { /* inactive */ }
  }));

  // Detect newly active ports (weren't active last poll, are active now)
  const newlyActive = [...activeNow].filter(p => !knownActivePorts.has(p));
  if (newlyActive.length > 0 && knownActivePorts.size > 0) {
    // Only flash if this isn't the very first poll (avoids flashing on startup)
    startFlash('green', NEW_PORT_FLASH_MS);
  }
  knownActivePorts = activeNow;

  updateBadgeCount(activeNow.size);

  // 2. Check control server health (only matters if the user hosts files)
  try {
    const res = await fetch(`${CONTROL_SERVER}/status`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) throw new Error();
    // Server is back up — clear a red flash if one was active
    if (currentFlashMode === 'red') stopFlash();
  } catch {
    const durationMs = serverDownFlashDuration || (2 * 60 * 1000); // default 2 min
    if (currentFlashMode !== 'red') {
      startFlash('red', durationMs);
    }
  }
}

// --- Messages from popup.js ---
// popup.js calls this after its own scan completes so the badge updates
// immediately rather than waiting for the next background poll cycle.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getPorts") {
    sendResponse({ status: "Background worker is active" });
    return true;
  }
  if (request.action === "reportActiveCount") {
    updateBadgeCount(request.count || 0);
    sendResponse({ ok: true });
    return true;
  }
  if (request.action === "reportNewPorts" && request.ports?.length > 0) {
    startFlash('green', NEW_PORT_FLASH_MS);
    sendResponse({ ok: true });
    return true;
  }
  if (request.action === "reportServerStatus") {
    if (request.online) {
      if (currentFlashMode === 'red') stopFlash();
    } else {
      chrome.storage.local.get(['serverDownFlashDuration'], (result) => {
        const durationMs = result.serverDownFlashDuration || (2 * 60 * 1000);
        if (currentFlashMode !== 'red') startFlash('red', durationMs);
      });
    }
    sendResponse({ ok: true });
    return true;
  }
  return true;
});