const CONTROL_SERVER = 'http://127.0.0.1:8765';

// --- THEME ---
function applyTheme(theme) {
    if (theme === 'auto') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
        document.documentElement.setAttribute('data-theme', theme);
    }
    reapplyStoredAccent();
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const checked = document.querySelector('input[name="theme"]:checked');
    if (checked?.value === 'auto') applyTheme('auto');
});

document.querySelectorAll('input[name="theme"]').forEach(radio => {
    radio.addEventListener('change', () => {
        applyTheme(radio.value);
        chrome.storage.local.set({ theme: radio.value });
    });
});

// --- GRID VIEW ---
document.getElementById('gridViewToggle').addEventListener('change', (e) => {
    chrome.storage.local.set({ viewMode: e.target.checked ? 'grid' : 'list' });
});

// Slider steps: index 0 = 30min, then 1hr, 2hr, ... 24hr (index 1–24)
// total 24 steps (indices 0–23)
const INTERVAL_STEPS = [
    { label: '30 min', ms: 30 * 60 * 1000 },
    ...Array.from({ length: 23 }, (_, i) => ({
        label: `${i + 1} hr`,
        ms: (i + 1) * 60 * 60 * 1000
    }))
]; // indices 0–23

const slider = document.getElementById('scanIntervalSlider');
const sliderLabel = document.getElementById('scanIntervalLabel');
const sliderRow = document.getElementById('scanIntervalRow');

function updateSliderLabel(index) {
    sliderLabel.textContent = INTERVAL_STEPS[index].label;
}

function setSliderEnabled(enabled) {
    slider.disabled = !enabled;
    sliderRow.classList.toggle('disabled', !enabled);
}

slider.addEventListener('input', () => {
    const index = parseInt(slider.value);
    updateSliderLabel(index);
    chrome.storage.local.set({
        autoScanInterval: INTERVAL_STEPS[index].ms,
        autoScanIntervalIndex: index
    });
    // Clear existing cache so the new interval is respected on next open
    chrome.storage.local.remove(['autoScanCache', 'autoScanTimestamp']);
});

// --- SERVER-DOWN FLASH DURATION ---
// 22 steps: 10 sec, 30 sec, then every whole minute from 1 to 20.
const FLASH_DURATION_STEPS = [
    { label: '10 sec', ms: 10 * 1000 },
    { label: '30 sec', ms: 30 * 1000 },
    ...Array.from({ length: 20 }, (_, i) => ({
        label: `${i + 1} min`,
        ms: (i + 1) * 60 * 1000
    }))
]; // indices 0–21

const serverFlashSlider = document.getElementById('serverFlashSlider');
const serverFlashLabel = document.getElementById('serverFlashLabel');

function updateServerFlashLabel(index) {
    serverFlashLabel.textContent = FLASH_DURATION_STEPS[index].label;
}

serverFlashSlider.addEventListener('input', () => {
    const index = parseInt(serverFlashSlider.value);
    updateServerFlashLabel(index);
    chrome.storage.local.set({
        serverDownFlashDuration: FLASH_DURATION_STEPS[index].ms,
        serverDownFlashIndex: index
    });
});

// --- AUTO SCAN ---
document.getElementById('autoScanToggle').addEventListener('change', (e) => {
    const enabled = e.target.checked;
    chrome.storage.local.set({ autoScan: enabled });
    setSliderEnabled(enabled);
    if (!enabled) {
        chrome.storage.local.remove(['autoScanCache', 'autoScanTimestamp']);
    }
});

// --- NETWORK SCAN ---
const networkToggle = document.getElementById('networkScanToggle');
const networkSection = document.getElementById('networkScanSection');
const networkRange = document.getElementById('networkRange');

networkToggle.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    networkSection.className = enabled ? 'visible' : '';
    chrome.storage.local.set({ networkScan: enabled });
});

networkRange.addEventListener('change', () => {
    chrome.storage.local.set({ networkRange: networkRange.value.trim() });
});

// --- SERVER STATUS ---
async function checkServer() {
    const label = document.getElementById('serverStatusLabel');
    try {
        const res = await fetch(`${CONTROL_SERVER}/status`, { signal: AbortSignal.timeout(1500) });
        if (res.ok) {
            const data = await res.json();
            const count = data.activePorts?.length || 0;
            label.textContent = count > 0 ? `Online · ${count} hosted` : 'Online';
            label.style.color = 'var(--chrome-green)';
        } else {
            throw new Error();
        }
    } catch {
        label.textContent = 'Offline';
        label.style.color = 'var(--chrome-red)';
    }
}

// --- ACCENT COLOR ---
// Each swatch carries light/dark variants in its data-* attributes so the
// accent stays correct regardless of which theme is active.
function applyAccent(swatchEl) {
    const root = document.documentElement.style;
    root.setProperty('--accent', swatchEl.dataset.color);
    root.setProperty('--accent-hover', swatchEl.dataset.hover);
    root.setProperty('--accent-surface', swatchEl.dataset.surface);
    // Dark theme overrides — only take effect when [data-theme="dark"] is active,
    // since CSS custom properties set inline on :root win over the dark selector
    // otherwise. We re-apply based on current theme instead.
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) {
        root.setProperty('--accent', swatchEl.dataset.dark);
        root.setProperty('--accent-hover', swatchEl.dataset.darkHover);
        root.setProperty('--accent-surface', swatchEl.dataset.darkSurface);
    }
}

function selectSwatch(colorHex) {
    document.querySelectorAll('.swatch').forEach(s => {
        s.classList.toggle('selected', s.dataset.color === colorHex);
    });
}

document.querySelectorAll('.swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
        selectSwatch(swatch.dataset.color);
        applyAccent(swatch);
        chrome.storage.local.set({
            accentColor: {
                color: swatch.dataset.color,
                hover: swatch.dataset.hover,
                surface: swatch.dataset.surface,
                dark: swatch.dataset.dark,
                darkHover: swatch.dataset.darkHover,
                darkSurface: swatch.dataset.darkSurface
            }
        });
    });
});

// Re-apply the correct light/dark accent variant whenever the theme changes,
// since applyAccent() reads the current data-theme at call time.
function reapplyStoredAccent() {
    chrome.storage.local.get(['accentColor'], (result) => {
        if (!result.accentColor) return;
        const a = result.accentColor;
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const root = document.documentElement.style;
        root.setProperty('--accent', isDark ? a.dark : a.color);
        root.setProperty('--accent-hover', isDark ? a.darkHover : a.hover);
        root.setProperty('--accent-surface', isDark ? a.darkSurface : a.surface);
    });
}

// --- KEYBOARD SHORTCUT ---
// Chrome doesn't allow extensions to set shortcuts programmatically — only the
// user can do that on chrome://extensions/shortcuts. We just read the current
// binding to display it accurately, and deep-link to that page on click.
function loadShortcut() {
    const label = document.getElementById('shortcutKeys');
    if (!chrome.commands || !chrome.commands.getAll) {
        label.textContent = 'Not set';
        return;
    }
    chrome.commands.getAll((commands) => {
        const cmd = commands.find(c => c.name === '_execute_action');
        if (cmd && cmd.shortcut) {
            label.textContent = cmd.shortcut;
        } else {
            label.textContent = 'Not set';
        }
    });
}

document.getElementById('shortcutBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// --- BACK BUTTON ---
document.getElementById('backBtn').addEventListener('click', () => window.close());

// --- LOAD SAVED SETTINGS ---
chrome.storage.local.get(['theme', 'viewMode', 'networkScan', 'networkRange', 'autoScan', 'autoScanIntervalIndex', 'accentColor', 'serverDownFlashIndex'], (result) => {
    const theme = result.theme || 'auto';
    const radio = document.querySelector(`input[name="theme"][value="${theme}"]`);
    if (radio) radio.checked = true;
    applyTheme(theme);

    // Accent color — default to the first (blue) swatch if none saved
    const defaultSwatch = document.querySelector('.swatch');
    if (result.accentColor) {
        selectSwatch(result.accentColor.color);
    } else if (defaultSwatch) {
        selectSwatch(defaultSwatch.dataset.color);
    }
    reapplyStoredAccent();

    if (result.viewMode === 'grid') {
        document.getElementById('gridViewToggle').checked = true;
    }

    const autoScanOn = !!result.autoScan;
    if (autoScanOn) {
        document.getElementById('autoScanToggle').checked = true;
    }
    // Restore slider position; default index 2 = 2 hr
    const savedIndex = result.autoScanIntervalIndex ?? 2;
    slider.value = savedIndex;
    updateSliderLabel(savedIndex);
    setSliderEnabled(autoScanOn);

    if (result.networkScan) {
        networkToggle.checked = true;
        networkSection.className = 'visible';
    }

    if (result.networkRange) {
        networkRange.value = result.networkRange;
    }

    loadShortcut();
    checkServer();

    // Restore server-down flash duration slider; default index 8 = 2 min
    const flashIndex = result.serverDownFlashIndex ?? 8;
    serverFlashSlider.value = flashIndex;
    updateServerFlashLabel(flashIndex);
});