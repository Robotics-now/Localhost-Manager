# Version 1.2

This update adds five new features: live latency readouts, a pin-to-top system, a macOS-style accent color picker, a configurable toolbar badge, and a customizable keyboard shortcut. It also includes several UI refinements across the popup and settings windows.

> [!IMPORTANT]
> When installing remember to load the `port_ext` folder into your browser instead of the entire source code, as it will fail because it is not the extension itself.

>[!tip]
> You could also check out the new features on the <a href="https://localhost-manager.roboticsnow.dpdns.org/#settings">website
---

## New features:

**Latency readout** — every active port now shows its response time in milliseconds, in small gray text under the URL.

**Pin to top** — pin your most-used ports so they always float to the top of the list view. The pin icon outlines when unpinned and fills solid when pinned.

**Accent color** — a macOS-style swatch picker in Settings with 8 color options that recolor every button, link, and highlight across the popup and settings window.


**Toolbar badge** — see your active port count directly on the extension icon without opening the popup. The badge flashes translucent red if the control server goes offline (duration adjustable from 10 seconds to 20 minutes in Settings), and translucent green for 7 seconds when a new port comes online.

**Keyboard shortcut** — open the popup instantly with `⌘⇧L` / `Ctrl+Shift+L` by default. Customizable from Chrome's own shortcuts page, linked directly from Settings.

---

> ## What's Changed
> Version 1.2 update #13 
> **Full Changelog**: https://github.com/Robotics-now/Localhost-Manager/compare/V1.1...V1.2
