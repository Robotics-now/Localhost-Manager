# Localhost-Manager

<div align="center">

<img src="https://img.shields.io/badge/Localhost%20Manager-Extention-4fc3f7?style=for-the-badge&labelColor=0d1117" alt="Localhost Manager Pro" height="36"/>

<br/><br/>

[![Version](https://img.shields.io/badge/Version-1.7-4fc3f7?style=flat-square)](/)
[![Manifest](https://img.shields.io/badge/Manifest-V3-22c55e?style=flat-square)](/)
[![License](https://img.shields.io/badge/License-GPL3.0-f59e0b?style=flat-square)](/)
[![Node](https://img.shields.io/badge/Requires-Node.js-3c873a?style=flat-square)](/)

<br/>

**Monitor active localhost ports · Host HTML files on real servers · Scan your local network**

<br/>

| |
| --- |
| <img src="https://avatars.githubusercontent.com/u/192281838?v=4" width="28" height="28" style="border-radius:50%;" align="center"> **[@Robotics-now](https://github.com/Robotics-now)** |

<br/>

[Install](#-install) · [Setup](#-setup) · [Features](#-features) · [API Contract](#-api-contract) · [File Structure](#-file-structure)

</div>

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔍 **Port scanner** | Monitors a configurable list of localhost ports and shows their status in real time |
| ⚡ **Auto scan** | Probes all 65,535 ports in parallel batches — results cached for up to 24 hrs |
| 📄 **HTML hosting** | Serves any HTML file on a real `http://localhost` port via the Node.js control server |
| 🌐 **Network scan** | Optionally scans devices on your local network (192.168.x.x) |
| 🎨 **Themes** | Light, dark, or auto (follows system appearance) |
| ⬡ **Live status dots** | Green = active · Gray = offline · Blue = hosted · Red = error |
| ↔️ **Swipe to remove** | Drag any port row left to reveal a delete button |
| 🕒 **Smart caching** | Configurable scan interval (30 min → 24 hr) — popup opens instantly from cache |

---

## <img width="18" height="18" alt="image" src="https://github.com/user-attachments/assets/877b0398-e64c-4390-b3f5-f5d01b43ae17" /> Install

<details>
<summary><b>Step 1 — Download the extension</b></summary>
<br/>

Go to [Releases](https://github.com/Robotics-now/Localhost-Manager/releases/) and download the latest `.zip`. Extract it to a permanent folder — Chrome loads the extension directly from this folder so don't delete it after loading.

</details>

<details>
<summary><b>Step 2 — Load into Chrome</b></summary>
<br/>

1. Open `chrome://extensions`
2. Enable **Developer Mode** (top right toggle)
3. Click **Load unpacked**
4. Select the extracted extension folder

The extension icon will appear in your toolbar.

</details>

<details>
<summary><b>Step 3 — Start the control server</b></summary>
<br/>

The control server is required for the **Host HTML** feature. It runs a tiny local REST API that the extension uses to spin up and tear down real HTTP servers.

```bash
node server.js
```

Leave this terminal open while using the extension. You should see:

```
┌─────────────────────────────────────────┐
│  Localhost Manager Pro — Control Server │
│   Listening on http://127.0.0.1:8765    │
│   Keep this terminal open while using   │
│   the extension. Ctrl+C to quit.        │
└─────────────────────────────────────────┘
```

> **Requires Node.js** — no `npm install` needed, uses only built-in modules.

</details>

---

## <img width="18" height="18" alt="image" src="https://github.com/user-attachments/assets/81ac9f58-0358-451e-a4f0-2dd53ecc6250" /> Setup

Once installed, click the extension icon. Active services appear immediately with a green dot. Click any row to open it in a new tab.

### Optional: Enable Auto Scan

Open **Settings** (gear icon in the popup) and toggle **Auto scan** on. The extension will probe every port from 1–65,535, cache the results, and only re-scan after your chosen interval.

```
30 min ──┬── 1 hr ── 2 hr ── ... ── 24 hr
         └── default: 2 hr
```

> Inactive ports are automatically removed from the list when auto scan is on.

### Host an HTML file

1. Make sure `node server.js` is running
2. Click **Host HTML** in the popup
3. Pick any `.html` file
4. The extension finds a free port in the `9000–9005` range, starts a real HTTP server, and opens it in a new tab
5. Click the **stop** button (swipe left on the row) to shut it down

---

## <img width="18" height="18" alt="image" src="https://github.com/user-attachments/assets/b997b662-dddd-4d9c-9495-4de8630f6308" /> File Structure

```
Localhost-Manager/
├── manifest.json         # Extension manifest (MV3)
├── background.js         # Service worker
├── server.js             # Node.js control server (run separately)
├── templates/
│   ├── popup.html        # Extension popup UI
│   └── settings.html     # Settings page
└── scripts/
    ├── popup.js          # Popup logic
    └── settings.js       # Settings logic
```

---

## <img width="18" height="18" alt="image" src="https://github.com/user-attachments/assets/36fed2c1-acd5-4d2b-af15-90acd5ce4636" /> API Contract

The extension communicates with `server.js` over plain HTTP on `http://127.0.0.1:8765`. You can replace `server.js` with your own implementation in any language — as long as it speaks this contract.

**Base URL:** `http://127.0.0.1:8765`  
**All responses:** `Content-Type: application/json`  
**CORS headers required on every response:**
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

<details>
<summary><b>GET /status — health check</b></summary>
<br/>

```json
{
  "ok": true,
  "activePorts": [9000, 9001]
}
```

</details>

<details>
<summary><b>POST /start — serve an HTML file</b></summary>
<br/>

**Request body:**
```json
{
  "port": 9000,
  "content": "<html>...</html>"
}
```

**Success:**
```json
{
  "ok": true,
  "port": 9000,
  "message": "Serving on http://localhost:9000"
}
```

**Failure:**
```json
{
  "ok": false,
  "error": "Could not bind port 9000: address already in use"
}
```

</details>

<details>
<summary><b>POST /stop — shut down a hosted server</b></summary>
<br/>

**Request body:**
```json
{ "port": 9000 }
```

**Success:**
```json
{
  "ok": true,
  "port": 9000,
  "message": "Stopped server on port 9000"
}
```

**Failure:**
```json
{
  "ok": false,
  "error": "No server running on port 9000"
}
```

</details>

---

## <img width="18" height="18" alt="image" src="https://github.com/user-attachments/assets/7b2e33e7-68ad-4b64-a8e0-6c9ee917fc33" /> Settings Reference

| Setting | Description |
|---|---|
| **Theme** | Light / Dark / Auto (follows system) |
| **Grid view** | Toggle between list and icon grid layout |
| **Auto scan** | Discover all active ports automatically |
| **Scan interval** | How long to cache auto scan results (30 min – 24 hr) |
| **Local network scan** | Scan 192.168.x.x devices on common ports |

---

## <img width="18" height="18" alt="image" src="https://github.com/user-attachments/assets/333cc08d-02a4-4150-900e-ffe8fd1b5008" />
 Status Indicators

| Dot | Meaning |
|:---:|---|
| 🟢 Green | Port is active and responding |
| ⚫ Gray | Port is in your list but not responding |
| 🔵 Blue | Port is being hosted by the extension |
| 🔴 Red (pulsing) | Error — e.g. control server offline |
| 🟡 Yellow (pulsing) | Scanning in progress |

---

## <img width="18" height="18" alt="image" src="https://github.com/user-attachments/assets/ef1a8a01-c16b-4cb5-b6ce-c35823e75bc1" /> Browser Compatibility

Works on any Chromium-based browser with Manifest V3 support:

- <img width="13" height="13" src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/chrome/chrome-original.svg" />  Google Chrome
- <img width="13" height="13" alt="image" src="https://github.com/user-attachments/assets/045b3211-af74-4106-971e-b67f1c8f2ea1" /> Microsoft Edge
- <img width="13" height="13" src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/opera/opera-original.svg" /> Opera
- <img width="13" height="13" alt="image" src="https://github.com/user-attachments/assets/645e0744-259d-49e3-99ae-3a3c498801dd" /> Chromium

---

## <img width="18" height="18" alt="image" src="https://github.com/user-attachments/assets/3e2ff91a-048e-481e-95af-ac944b0a998e" /> Quick Reference

| | |
|---|---|
| **Control server port** | `8765` |
| **Hosted file ports** | `9000 – 9005` |
| **Auto scan range** | `1 – 65,535` |
| **Cache interval** | `30 min – 24 hr` |
| **Network scan range** | `192.168.x.1 – .30` (configurable) |
| **Manifest version** | MV3 |
| **Node.js required** | For Host HTML feature only |

---

<div align="center">

[![Star on GitHub](https://img.shields.io/github/stars/Robotics-now/Localhost-Manager?style=social)](https://github.com/Robotics-now/Localhost-Manager)

**Built for developers who run too many servers.**

</div>

---

## License

> **GPL 3.0 License**  
> Copyright © 2026 Robotics-now
