// --- CONFIGURATION & STATE ---
let knownPorts = [3000, 5000, 5173, 5500, 5501, 8000, 8080];
let activePortSet = new Set();
let hostedPortSet = new Set();
let isGridView = false;
let currentTheme = 'auto';
let networkScanEnabled = false;
let networkRange = '192.168.1';
let autoScanEnabled = false;
let pinnedPorts = new Set();

const CONTROL_SERVER = 'http://127.0.0.1:8765';
const NETWORK_PORTS_TO_CHECK = [80, 443, 3000, 5000, 8000, 8080, 8443];
const NETWORK_TIMEOUT = 1500;

const portListContainer = document.getElementById('port-list');
const networkPortList = document.getElementById('network-port-list');
const networkResults = document.getElementById('networkResults');
const statusDiv = document.getElementById('status');
const statusDot = document.getElementById('statusDot');
const htmlFileInput = document.getElementById('htmlFile');

// --- THEME ---
function applyTheme(theme) {
    currentTheme = theme;
    if (theme === 'auto') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
        document.documentElement.setAttribute('data-theme', theme);
    }
    reapplyStoredAccent();
}

// --- ACCENT COLOR ---
// Mirrors the swatch picker in settings.js — reads the saved color object
// and applies the light or dark variant depending on the current theme.
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

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentTheme === 'auto') applyTheme('auto');
});

// Re-apply theme/accent whenever popup gets focus (user may have changed it in settings)
window.addEventListener('focus', () => {
    chrome.storage.local.get(['theme', 'viewMode', 'networkScan', 'networkRange'], (result) => {
        applyTheme(result.theme || 'auto');
        const newGrid = result.viewMode === 'grid';
        if (newGrid !== isGridView) {
            isGridView = newGrid;
            portListContainer.className = isGridView ? 'icon-view' : 'list-view';
            networkPortList.className = isGridView ? 'icon-view' : 'list-view';
        }
        networkScanEnabled = !!result.networkScan;
        networkRange = result.networkRange || '192.168.1';
        autoScanEnabled = !!result.autoScan;
    });
});

// --- INITIALIZATION ---
chrome.storage.local.get(['knownPorts', 'viewMode', 'hostedPorts', 'theme', 'networkScan', 'networkRange', 'autoScan', 'autoScanInterval', 'pinnedPorts'], (result) => {
    if (result.knownPorts) knownPorts = result.knownPorts;
    if (result.viewMode) {
        isGridView = result.viewMode === 'grid';
        portListContainer.className = isGridView ? 'icon-view' : 'list-view';
        networkPortList.className = isGridView ? 'icon-view' : 'list-view';
    }
    if (result.hostedPorts) result.hostedPorts.forEach(p => hostedPortSet.add(p));
    if (result.pinnedPorts) result.pinnedPorts.forEach(p => pinnedPorts.add(p));
    networkScanEnabled = !!result.networkScan;
    networkRange = result.networkRange || '192.168.1';
    autoScanEnabled = !!result.autoScan;
    autoScanTTL = result.autoScanInterval || AUTO_SCAN_TTL_DEFAULT;
    applyTheme(result.theme || 'auto');
    scanPorts();
});

// --- STATUS HELPERS ---
function setStatus(state, text) {
    statusDiv.className = state === 'error' ? 'error' : '';
    statusDiv.innerText = text;
    if (state === 'scanning') statusDot.className = 'status-dot scanning';
    else if (state === 'active') statusDot.className = 'status-dot active';
    else if (state === 'error') statusDot.className = 'status-dot error';
    else statusDot.className = 'status-dot inactive';
}

function setError(text, duration = 4000) {
    setStatus('error', text);
    setTimeout(() => updateStatus('done', activePortSet.size, knownPorts.length), duration);
}

function updateStatus(state, activeCount = 0, totalCount = 0) {
    if (state === 'scanning') {
        setStatus('scanning', 'Scanning services…');
    } else if (activeCount > 0) {
        setStatus('active', `${activeCount} of ${totalCount} services active`);
    } else {
        setStatus('inactive', 'No active services found');
    }
}

// --- CONTROL SERVER ---
async function controlServerReady() {
    try {
        const res = await fetch(`${CONTROL_SERVER}/status`, { signal: AbortSignal.timeout(1000) });
        return res.ok;
    } catch { return false; }
}

async function startHosted(port, content) {
    const res = await fetch(`${CONTROL_SERVER}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port, content })
    });
    return res.json();
}

async function stopHosted(port) {
    const res = await fetch(`${CONTROL_SERVER}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port })
    });
    return res.json();
}

// --- LOCALHOST PORT SCANNING ---
async function getFaviconUrl(port) {
    try {
        await fetch(`http://localhost:${port}/favicon.ico`, { method: 'HEAD', mode: 'no-cors' });
        return `http://localhost:${port}/favicon.ico`;
    } catch { return null; }
}

async function checkPort(port) {
    const url = `http://localhost:${port}`;
    const startTime = performance.now();
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1200);
        await fetch(url, { mode: 'no-cors', signal: controller.signal });
        clearTimeout(timeout);
        const latency = Math.round(performance.now() - startTime);

        let title = `Port ${port}`;
        try {
            const mc = new AbortController();
            const mt = setTimeout(() => mc.abort(), 1200);
            const res = await fetch(url, { signal: mc.signal });
            clearTimeout(mt);
            const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
            title = doc.querySelector('title')?.innerText?.trim() || title;
        } catch { /* keep default */ }

        const favicon = await getFaviconUrl(port);
        return { port, url, title, favicon, latency };
    } catch { return null; }
}

const AUTO_SCAN_TTL_DEFAULT = 2 * 60 * 60 * 1000;
let autoScanTTL = AUTO_SCAN_TTL_DEFAULT;

async function scanPorts(force = false) {
    portListContainer.innerHTML = '';
    updateStatus('scanning');

    if (autoScanEnabled) {
        await runAutoScan(force);
    } else {
        const uniquePorts = [...new Set(knownPorts)];
        const results = await Promise.all(uniquePorts.map(checkPort));
        activePortSet = new Set(results.filter(Boolean).map(r => r.port));

        const displayList = uniquePorts.map(port => {
            const hit = results.find(r => r?.port === port);
            return hit
                ? { ...hit, active: true }
                : { port, url: `http://localhost:${port}`, title: `Port ${port}`, favicon: null, active: false };
        });

        updateStatus('done', activePortSet.size, uniquePorts.length);
        sortByPin(displayList).forEach(data => renderPort(data, portListContainer));
    }

    if (networkScanEnabled) scanNetwork();
    else networkResults.style.display = 'none';

    reportToBackground();
}

// Tells background.js the current active count and server health right after
// a scan, so the toolbar badge updates immediately instead of waiting for the
// background's own ~15s poll cycle. New-port detection still happens in the
// background since it needs to run even when the popup is closed.
function reportToBackground() {
    chrome.runtime.sendMessage({ action: 'reportActiveCount', count: activePortSet.size });
    controlServerReady().then(online => {
        chrome.runtime.sendMessage({ action: 'reportServerStatus', online });
    });
}

// Auto scan: probe all ports in BATCH_SIZE chunks.
// Results are cached in storage for 2 hours. On popup open, if a valid
// cache exists it's rendered instantly. Only a forced rescan (button click)
// or an expired cache triggers a real port sweep.
async function runAutoScan(force = false) {
    const BATCH_SIZE = 100;
    const TOTAL_PORTS = 65535;

    // Check cache first
    const stored = await new Promise(resolve =>
        chrome.storage.local.get(['autoScanCache', 'autoScanTimestamp'], resolve)
    );

    const cacheAge = Date.now() - (stored.autoScanTimestamp || 0);
    const cacheValid = stored.autoScanCache && cacheAge < autoScanTTL;

    if (!force && cacheValid) {
        // Use cached results — popup opens instantly
        const cached = stored.autoScanCache;
        const remaining = autoScanTTL - cacheAge;
        const minsLeft = Math.round(remaining / 60000);

        activePortSet = new Set(cached.map(r => r.port));
        knownPorts = [...new Set([...cached.map(r => r.port), ...hostedPortSet])];

        updateStatus('done', activePortSet.size, knownPorts.length);
        setStatus('active', `${activePortSet.size} services · next scan in ${minsLeft}m`);

        const offlineHosted = [...hostedPortSet]
            .filter(port => !activePortSet.has(port))
            .map(port => ({ port, url: `http://localhost:${port}`, title: `Port ${port}`, favicon: null, active: false }));

        const cachedActive = cached.map(r => ({ ...r, active: true }));
        sortByPin([...cachedActive, ...offlineHosted]).forEach(data => renderPort(data, portListContainer));
        return;
    }

    // Cache expired or forced — do a real scan
    const discovered = [];
    let batchNum = 0;
    const totalBatches = Math.ceil(TOTAL_PORTS / BATCH_SIZE);

    for (let start = 1; start <= TOTAL_PORTS; start += BATCH_SIZE) {
        batchNum++;
        const batch = [];
        for (let p = start; p < start + BATCH_SIZE && p <= TOTAL_PORTS; p++) {
            batch.push(p);
        }
        const results = await Promise.all(batch.map(checkPort));
        results.filter(Boolean).forEach(r => discovered.push(r));

        // Update status every 10 batches so user sees progress
        if (batchNum % 10 === 0) {
            const pct = Math.round((batchNum / totalBatches) * 100);
            setStatus('scanning', `Auto scan ${pct}% — ${discovered.length} found so far…`);
        }
    }

    activePortSet = new Set(discovered.map(r => r.port));
    knownPorts = [...new Set([...discovered.map(r => r.port), ...hostedPortSet])];

    // Save results and timestamp to storage
    chrome.storage.local.set({
        knownPorts,
        autoScanCache: discovered,
        autoScanTimestamp: Date.now()
    });

    updateStatus('done', activePortSet.size, knownPorts.length);

    const offlineHosted = [...hostedPortSet]
        .filter(port => !activePortSet.has(port))
        .map(port => ({ port, url: `http://localhost:${port}`, title: `Port ${port}`, favicon: null, active: false }));

    const discoveredActive = discovered.map(r => ({ ...r, active: true }));
    sortByPin([...discoveredActive, ...offlineHosted]).forEach(data => renderPort(data, portListContainer));
}

// --- NETWORK SCANNING ---
async function checkNetworkHost(ip, port) {
    const url = `http://${ip}:${port}`;
    try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), NETWORK_TIMEOUT);
        await fetch(url, { mode: 'no-cors', signal: controller.signal });
        return { ip, port, url, title: `${ip}:${port}`, favicon: null, active: true };
    } catch { return null; }
}

async function scanNetwork() {
    networkResults.style.display = 'block';
    networkPortList.innerHTML = '';

    const header = networkResults.querySelector('.network-header');
    header.textContent = 'Local network — scanning…';

    // Build list of IPs: base.1 through base.254
    const base = networkRange.replace(/\.\d+$/, ''); // strip trailing octet if user added one
    const ips = Array.from({ length: 30 }, (_, i) => `${base}.${i + 1}`); // scan .1–.30 for speed
    const checks = [];
    for (const ip of ips) {
        for (const port of NETWORK_PORTS_TO_CHECK) {
            checks.push(checkNetworkHost(ip, port));
        }
    }

    const results = (await Promise.all(checks)).filter(Boolean);

    // Deduplicate by IP — show each IP once using whichever port responded first
    const seen = new Set();
    const unique = results.filter(r => {
        if (seen.has(r.ip)) return false;
        seen.add(r.ip);
        return true;
    });

    header.textContent = unique.length > 0
        ? `Local network — ${unique.length} device${unique.length > 1 ? 's' : ''} found`
        : 'Local network — no devices found';

    unique.forEach(data => renderPort(data, networkPortList, true));
}

// --- RENDERING ---

// Pinned ports float to the top, keeping relative order within each group
function sortByPin(items) {
    return [...items].sort((a, b) => {
        const aPinned = pinnedPorts.has(a.port) ? 1 : 0;
        const bPinned = pinnedPorts.has(b.port) ? 1 : 0;
        return bPinned - aPinned;
    });
}

const fallbackSvg = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235f6368' stroke-width='1.5'><rect x='2' y='3' width='20' height='14' rx='2'/><path d='M8 21h8M12 17v4'/></svg>`;

// deleteSvg — trash icon for delete button
const deleteSvgMarkup = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
  <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10"/>
</svg>`;

function renderPort(data, container, isNetwork = false) {
    const isHosted = !isNetwork && hostedPortSet.has(data.port);
    const isPinned = !isNetwork && pinnedPorts.has(data.port);
    const dotColor = isHosted ? 'var(--accent)' : data.active ? 'var(--chrome-green)' : 'var(--chrome-gray-dot)';
    const dotTitle = isHosted ? 'Hosted by extension' : data.active ? 'Active' : 'Offline';

    const wrapper = document.createElement('div');
    wrapper.className = 'swipe-wrapper';
    wrapper.dataset.port = data.port;

    const track = document.createElement('div');
    track.className = 'swipe-track';

    const item = document.createElement('div');
    item.className = 'port-item';
    if (isPinned) item.classList.add('pinned');

    const img = document.createElement('img');
    img.alt = '';
    img.src = data.favicon || fallbackSvg;
    img.addEventListener('error', () => { img.src = fallbackSvg; });

    const indicator = document.createElement('span');
    indicator.className = 'status-indicator';
    indicator.title = dotTitle;
    indicator.style.background = dotColor;

    const details = document.createElement('div');
    details.className = 'details';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'title';
    if (isHosted) titleSpan.style.color = 'var(--accent)';
    titleSpan.textContent = data.title;

    const urlSpan = document.createElement('span');
    urlSpan.className = 'url';
    urlSpan.textContent = isNetwork ? data.url : `localhost:${data.port}`;

    // Latency — light gray small text under the URL, list view only, only when known
    if (typeof data.latency === 'number' && data.active) {
        const latencySpan = document.createElement('span');
        latencySpan.className = 'latency';
        latencySpan.textContent = `${data.latency} ms`;
        details.appendChild(titleSpan);
        details.appendChild(urlSpan);
        details.appendChild(latencySpan);
    } else {
        details.appendChild(titleSpan);
        details.appendChild(urlSpan);
    }

    const iconTitle = document.createElement('span');
    iconTitle.className = 'icon-title';
    iconTitle.textContent = data.title;

    item.appendChild(indicator);
    item.appendChild(img);
    item.appendChild(details);
    item.appendChild(iconTitle);

    // Pin button — list view only, not for network scan rows
    if (!isNetwork) {
        const pinBtn = document.createElement('button');
        pinBtn.className = 'pin-btn';
        if (isPinned) pinBtn.classList.add('pinned');
        pinBtn.title = isPinned ? 'Unpin' : 'Pin to top';
        pinBtn.setAttribute('aria-label', isPinned ? 'Unpin port' : 'Pin port to top');
        // Simple thumbtack/pin glyph — outline when unpinned, filled when pinned
        pinBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="${isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.3">
            <path d="M9.5 1.5h-3a.5.5 0 0 0-.5.5v3.1c0 .3-.1.5-.3.7L3.4 8.1a1 1 0 0 0-.4.8v.6c0 .3.2.5.5.5h4.1v3.5a.4.4 0 0 0 .8 0V10h4.1c.3 0 .5-.2.5-.5v-.6a1 1 0 0 0-.4-.8L10.3 5.8a.9.9 0 0 1-.3-.7V2a.5.5 0 0 0-.5-.5z" stroke-linejoin="round" stroke-linecap="round"/>
        </svg>`;
        pinBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePin(data.port);
        });
        item.appendChild(pinBtn);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    const deleteLabel = document.createElement('span');
    deleteLabel.textContent = isHosted ? 'Stop' : 'Remove';
    deleteBtn.innerHTML = deleteSvgMarkup;
    deleteBtn.appendChild(deleteLabel);

    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isNetwork) {
            wrapper.remove();
        } else if (isHosted) {
            stopHosting(data.port);
        } else {
            removePort(data.port);
        }
    });

    track.appendChild(item);
    track.appendChild(deleteBtn);
    wrapper.appendChild(track);
    container.appendChild(wrapper);

    if (data.active) {
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => {
            if (wrapper.dataset.swiped === '1') return;
            chrome.tabs.create({ url: data.url });
        });
    } else {
        item.style.opacity = '0.6';
        item.style.cursor = 'default';
    }

    attachSwipe(wrapper, track, item);
}

// Pin/unpin a port — re-renders the current scan results so the new order shows immediately
function togglePin(port) {
    if (pinnedPorts.has(port)) pinnedPorts.delete(port);
    else pinnedPorts.add(port);
    chrome.storage.local.set({ pinnedPorts: [...pinnedPorts] });
    scanPorts(); // re-render with new pin order, uses cache if valid so this is instant
}

// --- SWIPE TO DELETE ---
const REVEAL_WIDTH = 72;
const REVEAL_HEIGHT = 36;

function attachSwipe(wrapper, track, item) {
    let startX = 0, startY = 0;
    let active = false;
    let isRevealed = false;
    let directionLocked = false;
    let isHorizontal = false;

    const isGrid = () => portListContainer.classList.contains('icon-view');

    function currentOffset() {
        return isRevealed ? (isGrid() ? -REVEAL_HEIGHT : -REVEAL_WIDTH) : 0;
    }

    function moveTo(x, animated = false) {
        track.style.transition = animated ? 'transform 0.2s ease' : 'none';
        track.style.transform = isGrid() ? `translateY(${x}px)` : `translateX(${x}px)`;
    }

    function snapOpen() {
        moveTo(isGrid() ? -REVEAL_HEIGHT : -REVEAL_WIDTH, true);
        isRevealed = true;
        document.querySelectorAll('.swipe-wrapper').forEach(w => {
            if (w !== wrapper) w.dispatchEvent(new CustomEvent('swipe-close'));
        });
    }

    function snapClosed(animated = true) {
        moveTo(0, animated);
        isRevealed = false;
    }

    wrapper.addEventListener('swipe-close', () => snapClosed(true));

    document.addEventListener('mousedown', (e) => {
        if (isRevealed && !wrapper.contains(e.target)) snapClosed(true);
    }, { passive: true });

    item.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        startX = e.clientX;
        startY = e.clientY;
        active = true;
        directionLocked = false;
        isHorizontal = false;
    });

    window.addEventListener('mousemove', (e) => {
        if (!active) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!directionLocked) {
            if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
            isHorizontal = isGrid() ? Math.abs(dy) > Math.abs(dx) : Math.abs(dx) > Math.abs(dy);
            directionLocked = true;
        }
        if (!isHorizontal) return;

        const delta = isGrid() ? dy : dx;
        const limit = isGrid() ? REVEAL_HEIGHT : REVEAL_WIDTH;
        const newX = Math.min(0, Math.max(-limit, currentOffset() + delta));
        moveTo(newX);
    });

    window.addEventListener('mouseup', (e) => {
        if (!active) return;
        active = false;
        if (!directionLocked || !isHorizontal) return;

        wrapper.dataset.swiped = '1';
        setTimeout(() => { wrapper.dataset.swiped = '0'; }, 200);

        const delta = isGrid() ? (e.clientY - startY) : (e.clientX - startX);
        const limit = isGrid() ? REVEAL_HEIGHT : REVEAL_WIDTH;
        const final = currentOffset() + delta;

        if (final < -limit / 2) snapOpen();
        else snapClosed(true);
    });
}

// --- PORT MANAGEMENT ---
function removePort(port) {
    knownPorts = knownPorts.filter(p => p !== port);
    pinnedPorts.delete(port);
    chrome.storage.local.set({ knownPorts, pinnedPorts: [...pinnedPorts] });
    portListContainer.querySelector(`[data-port="${port}"]`)?.remove();
    activePortSet.delete(port);
    updateStatus('done', activePortSet.size, knownPorts.length);
}

// --- HOSTING ---
async function hostFile(htmlContent) {
    const ready = await controlServerReady();
    if (!ready) { setError('Server offline — run: node server.js'); return; }

    const candidates = [9000, 9001, 9002, 9003, 9004, 9005];
    const port = candidates.find(p => !activePortSet.has(p) && !hostedPortSet.has(p));
    if (port === undefined) { setError('No free port in range 9000–9005'); return; }

    setStatus('scanning', `Starting server on port ${port}…`);

    let result;
    try {
        result = await startHosted(port, htmlContent);
    } catch {
        setError('Server offline — run: node server.js');
        return;
    }

    if (!result.ok) { setError(`Failed: ${result.error}`); return; }

    hostedPortSet.add(port);
    if (!knownPorts.includes(port)) knownPorts.push(port);
    chrome.storage.local.set({ knownPorts, hostedPorts: [...hostedPortSet] });
    chrome.tabs.create({ url: `http://localhost:${port}` });
    await scanPorts();
}

async function stopHosting(port) {
    const wrapper = portListContainer.querySelector(`[data-port="${port}"]`);

    // Instantly update state so it won't reappear on rescan
    hostedPortSet.delete(port);
    knownPorts = knownPorts.filter(p => p !== port);
    pinnedPorts.delete(port);
    chrome.storage.local.set({ knownPorts, hostedPorts: [...hostedPortSet], pinnedPorts: [...pinnedPorts] });
    activePortSet.delete(port);

    // Animate the row out in 0.5s — user sees it gone immediately
    if (wrapper) {
        wrapper.style.transition = 'opacity 0.3s ease, max-height 0.4s ease, padding 0.4s ease';
        wrapper.style.overflow = 'hidden';
        wrapper.style.maxHeight = wrapper.offsetHeight + 'px';
        // Trigger animation on next frame
        requestAnimationFrame(() => {
            wrapper.style.opacity = '0';
            wrapper.style.maxHeight = '0';
        });
        setTimeout(() => wrapper.remove(), 450);
    }

    updateStatus('done', activePortSet.size, knownPorts.length);

    // Actually stop the server in the background — takes ~5s, user doesn't wait
    stopHosted(port).catch(() => {
        // Server already gone or unreachable — nothing to do
    });
}

// --- EVENT LISTENERS ---
let settingsWindowId = null;

document.getElementById('settingsBtn').addEventListener('click', () => {
    // If a settings window is already open, just focus it
    if (settingsWindowId !== null) {
        chrome.windows.get(settingsWindowId, (win) => {
            if (chrome.runtime.lastError || !win) {
                // Window was closed externally — create a new one
                settingsWindowId = null;
                openSettingsWindow();
            } else {
                chrome.windows.update(settingsWindowId, { focused: true });
            }
        });
    } else {
        openSettingsWindow();
    }
});

function openSettingsWindow() {
    chrome.windows.create({
        url: chrome.runtime.getURL('templates/settings.html'),
        type: 'popup',
        width: 380,
        height: 560
    }, (win) => {
        settingsWindowId = win.id;
        // Clear the tracked ID when the window is closed
        chrome.windows.onRemoved.addListener(function onRemoved(closedId) {
            if (closedId === settingsWindowId) {
                settingsWindowId = null;
                chrome.windows.onRemoved.removeListener(onRemoved);
            }
        });
    });
}

document.getElementById('rescanBtn').addEventListener('click', () => scanPorts(true));
document.getElementById('rescanBtnAlt').addEventListener('click', () => scanPorts(true));

document.getElementById('addPortBtn').addEventListener('click', () => {
    const input = document.getElementById('customPort');
    const port = parseInt(input.value);
    if (port > 0 && port < 65536) {
        if (knownPorts.includes(port)) {
            setError(`Port ${port} is already in the list`, 2000);
            input.value = '';
            return;
        }
        knownPorts.push(port);
        chrome.storage.local.set({ knownPorts });
        scanPorts();
        input.value = '';
    }
});

document.getElementById('hostBtn').addEventListener('click', () => htmlFileInput.click());
document.getElementById('hostProjectBtn').addEventListener('click', () => document.getElementById('projectFolder').click());

htmlFileInput.addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => hostFile(event.target.result);
    reader.readAsText(file);
    htmlFileInput.value = '';
});

// Multi-file project hosting
// Reads every file in the selected folder, encodes binary files as base64,
// and sends them all to /start-multi on the control server.
document.getElementById('projectFolder').addEventListener('change', async function (e) {
    const files = [...e.target.files];
    if (!files.length) return;

    const ready = await controlServerReady();
    if (!ready) { setError('Server offline — run: node server.js'); return; }

    const candidates = [9000, 9001, 9002, 9003, 9004, 9005];
    const port = candidates.find(p => !activePortSet.has(p) && !hostedPortSet.has(p));
    if (port === undefined) { setError('No free port in range 9000–9005'); return; }

    setStatus('scanning', `Reading ${files.length} files…`);

    const TEXT_TYPES = /\.(html?|css|js|mjs|json|svg|txt|xml|md|ts|jsx|tsx|map|yaml|yml|toml|ini)$/i;

    // Step 1: read all files, keeping the raw webkitRelativePath
    const fileData = [];
    for (const file of files) {
        const rawPath = file.webkitRelativePath || file.name;

        const result = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
            if (TEXT_TYPES.test(file.name)) {
                reader.onload = (ev) => resolve({ rawPath, content: ev.target.result, encoding: 'utf8' });
                reader.readAsText(file, 'UTF-8');
            } else {
                reader.onload = (ev) => {
                    const raw = ev.target.result || '';
                    const commaIdx = raw.indexOf(',');
                    resolve({ rawPath, content: commaIdx !== -1 ? raw.slice(commaIdx + 1) : '', encoding: 'base64' });
                };
                reader.readAsDataURL(file);
            }
        }).catch(err => { console.warn(`Skipping ${file.name}:`, err); return null; });

        if (result) fileData.push(result);
    }

    if (fileData.length === 0) {
        setError('No readable files found in folder');
        document.getElementById('projectFolder').value = '';
        return;
    }

    // DEBUG: log all raw paths to see exactly what Chrome gives us
    console.log('[LM] Raw paths from webkitRelativePath:');
    fileData.forEach(f => console.log(' ', JSON.stringify(f.rawPath)));

    // Read the entry file name — default to index.html if blank
    const entryFileName = (document.getElementById('entryFile').value.trim() || 'index.html').toLowerCase();

    // Find the entry file to determine root
    const indexFile = fileData.find(f =>
        f.rawPath.toLowerCase().endsWith('/' + entryFileName) ||
        f.rawPath.toLowerCase() === entryFileName
    );

    console.log('[LM] entry file:', entryFileName, '| found at:', indexFile ? indexFile.rawPath : 'NOT FOUND');

    let rootPrefix = '';
    if (indexFile) {
        const lastSlash = indexFile.rawPath.lastIndexOf('/');
        rootPrefix = lastSlash !== -1 ? indexFile.rawPath.slice(0, lastSlash + 1) : '';
    } else {
        const firstSlash = fileData[0].rawPath.indexOf('/');
        rootPrefix = firstSlash !== -1 ? fileData[0].rawPath.slice(0, firstSlash + 1) : '';
    }

    console.log('[LM] rootPrefix to strip:', JSON.stringify(rootPrefix));

    const strippedFiles = fileData
        .map(f => ({
            path: f.rawPath.startsWith(rootPrefix)
                ? f.rawPath.slice(rootPrefix.length)
                : f.rawPath,
            content: f.content,
            encoding: f.encoding
        }))
        .filter(f => f.path);

    console.log('[LM] Stripped paths being sent to server:');
    strippedFiles.forEach(f => console.log(' ', JSON.stringify(f.path)));

    // Warn clearly if no entry file was found
    if (!indexFile) {
        setError(`No ${entryFileName} found — pick your project root folder`);
        document.getElementById('projectFolder').value = '';
        return;
    }

    if (strippedFiles.length === 0) {
        setError('Could not determine project root');
        document.getElementById('projectFolder').value = '';
        return;
    }

    setStatus('scanning', `Starting server on port ${port} · ${strippedFiles.length} files…`);

    let result;
    try {
        const res = await fetch(`${CONTROL_SERVER}/start-multi`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port, files: strippedFiles, entryFile: entryFileName })
        });
        result = await res.json();
    } catch {
        setError('Server offline — run: node server.js');
        document.getElementById('projectFolder').value = '';
        return;
    }

    if (!result.ok) { setError(`Failed: ${result.error}`); return; }

    hostedPortSet.add(port);
    if (!knownPorts.includes(port)) knownPorts.push(port);
    chrome.storage.local.set({ knownPorts, hostedPorts: [...hostedPortSet] });
    const entryUrl = entryFileName === 'index.html'
        ? `http://localhost:${port}`
        : `http://localhost:${port}/${entryFileName}`;
    chrome.tabs.create({ url: entryUrl });
    await scanPorts();
    document.getElementById('projectFolder').value = '';
});