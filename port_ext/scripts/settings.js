const CONTROL_SERVER = 'http://127.0.0.1:8765';

// --- THEME ---
function applyTheme(theme) {
    if (theme === 'auto') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
        document.documentElement.setAttribute('data-theme', theme);
    }
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

// --- BACK BUTTON ---
document.getElementById('backBtn').addEventListener('click', () => window.close());

// --- LOAD SAVED SETTINGS ---
chrome.storage.local.get(['theme', 'viewMode', 'networkScan', 'networkRange', 'autoScan', 'autoScanIntervalIndex'], (result) => {
    const theme = result.theme || 'auto';
    const radio = document.querySelector(`input[name="theme"][value="${theme}"]`);
    if (radio) radio.checked = true;
    applyTheme(theme);

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

    checkServer();
});