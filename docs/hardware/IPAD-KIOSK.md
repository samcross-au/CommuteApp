<p align="center">
  <img src="../../assets/brand/cc-logo-apple-touch.png" alt="Commute Compute™" width="120">
</p>

# iPad Kiosk Guide

**Use any iPad as a full-screen Commute Compute™ display**

Copyright (c) 2025-2026 Angus Bergman — AGPL-3.0 Dual Licence

---

## Overview

The iPad kiosk (`/ipad`) shows the same CCDash™ dashboard as the TRMNL display,
rendered at the iPad's exact screen resolution so text stays sharp. It needs no
firmware, jailbreak, or Bluetooth pairing: you open a web page in Safari.

| | |
|:--|:--|
| **Works on** | Any iPad running iOS 9 or later (iPad 2 / mini 1 onwards) |
| **Orientation** | Landscape fills the screen; portrait shows the dashboard full-width, letterboxed |
| **Refresh** | Every 60 seconds by default (30 s – 15 min) |
| **Night mode** | Inverts to white-on-black from 9 pm to 6 am (or always on / off) |
| **Offline** | Keeps the last dashboard on screen and shows an "Offline — last updated" badge |

## Setup

1. Finish the Setup Wizard on your deployment (choose **iPad** in Step 1 if you like — it shows the link at the end).
2. On the iPad, open Safari and go to `https://YOUR-PROJECT-NAME.vercel.app/ipad`.
3. Tap **Share → Add to Home Screen**. Launching from the home-screen icon hides Safari's address bar.
4. Keep the screen on:
   - iPadOS 16.4+ keeps the screen awake automatically while the kiosk is open (tap the screen once if it doesn't).
   - Otherwise: **Settings → Display & Brightness → Auto-Lock → Never**.
5. Optional, for a wall-mounted display: **Settings → Accessibility → Guided Access** and turn it on, then triple-click the Home/Top button in the kiosk to lock the iPad to it.

Leave the iPad on its charger — an always-on screen will drain the battery in a few hours.

## On-Screen Settings

Tap anywhere on the dashboard to open the settings panel:

- **Destination** — Auto / Rotate / a specific destination (shown when you have more than one; see below)
- **Night mode** — Auto / On / Off
- **Refresh every** — 30 s, 1 min, 2 min, 5 min
- **Refresh now**

Settings are saved on the iPad.

## URL Options

You can also set options in the link (handy when adding to the home screen, as the
home-screen app keeps the link it was added with):

| Parameter | Example | Meaning |
|:----------|:--------|:--------|
| `token` | `?token=abc123` | Device token, needed only if device authentication is enabled |
| `interval` | `?interval=120` | Refresh period in seconds (30–900) |
| `night` | `?night=on` | `auto`, `on` or `off` |
| `demo` | `?demo=1` | Show a random demo journey (useful before API keys are approved) |
| `dest` | `?dest=alexs-work` | Which destination to show: `auto` (default), `rotate`, or a destination ID from the Admin Panel |

Example: `https://YOUR-PROJECT-NAME.vercel.app/ipad?interval=120&night=auto`

## Several Destinations

If your household commutes to more than one place (a partner's work, a second
office), add them in the **Admin Panel → Configuration → Destinations**. Then:

- **Auto** (default) shows whichever destination is due next today. For example,
  a partner arriving at 8:15 is shown until 8:15, then your 9:00 journey.
- **Rotate** takes turns, moving to the next destination on each refresh.
- **A specific destination** pins the display, which is handy for a second iPad,
  or for each person's own home-screen icon (`/ipad?dest=alexs-work`).

## How It Works

The kiosk requests `/api/screen?format=png&w=<width>&h=<height>`, where the size is
the iPad's screen in physical pixels (capped at 2× scale). `/api/screen` renders the
standard CCDash™ layout at that size. Any browser display can use the same
parameters, or `?device=` with one of `ipad`, `ipad-mini`, `ipad-pro-13`,
`ipad-legacy`. Width and height are clamped to 400–2800 × 240–2800.

The kiosk script is plain ES5 (no modern JavaScript syntax), so it runs on old
iPads that can no longer update past iOS 9, 10 or 12.

## Troubleshooting

| Problem | Fix |
|:--------|:----|
| "Can't reach your Commute Compute server" | Check the iPad's Wi-Fi and that the Setup Wizard is complete. Try `/ipad?demo=1` to confirm the kiosk itself works. |
| Screen turns off | Set Auto-Lock to Never (see step 4). |
| Address bar still visible | Open the kiosk from the home-screen icon, not from Safari. |
| 401/403 errors after enabling device auth | Add `?token=YOUR_TOKEN` to the link and re-add it to the home screen. |

> **Not on Vercel?** Run the portable server (`npm run serve`, also the default
> for Docker and Render) and the kiosk works the same way. The older standalone
> server (`npm start`) returns TRMNL markup from `/api/screen` and won't work.
> See [Moving Off Vercel](../setup/SWITCHING-HOSTS.md).
