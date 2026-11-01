<p align="center">
  <img src="../../assets/brand/cc-logo-apple-touch.png" alt="Commute Compute™" width="120">
</p>

# Moving Off Vercel

**Run your Commute Compute™ deployment on another host without changing how it behaves**

Copyright (c) 2025-2026 Angus Bergman — AGPL-3.0 Dual Licence

---

## Overview

Vercel is the recommended host, and its free Hobby plan covers personal use. If you
ever want to move, `src/portable-server.js` runs the same deployment on any Node.js
host. It serves exactly what Vercel serves, from the same files:

- `public/` as static files (Setup Wizard, Admin Panel, `/ipad`, `/flasher/`)
- the API router (`api/index.js`), which serves every endpoint in `handlers/` at the same URL (`handlers/zone/[id].js` → `/api/zone/:id`)
- the redirects, rewrites and security headers in `vercel.json`

Your settings live in Redis, not on Vercel, so if you point the new host at the
**same Redis database** your journey, API keys and preferences come with you.

> `npm start` still runs the older standalone server (`src/server.js`), which
> has different routes. Use `npm run serve` for a Vercel-equivalent server.

## What to Carry Over

Copy these environment variables from Vercel (Project → Settings → Environment
Variables) to the new host:

| Variable | Needed | Notes |
|:---------|:-------|:------|
| `CC_ADMIN_TOKEN` | Yes | Use the same value so your Admin Panel login keeps working. |
| Redis URL and token | Yes | Vercel's Redis integration names them `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, or with a `CCKV_` prefix). Any of those names work on the new host. You can also find them in the Upstash console under your database → **REST API**. |
| `PORT` | Host-dependent | Most hosts set it for you. Defaults to 3000. |

To use a different Redis instead (for example, Redis running next to Docker), set
`REDIS_URL=redis://...`. You will need to run the Setup Wizard again, as the new
database starts empty.

## Try It Locally First

```bash
npm install
```

```bash
CC_ADMIN_TOKEN=your-token UPSTASH_REDIS_REST_URL=https://... UPSTASH_REDIS_REST_TOKEN=... npm run serve
```

Open `http://localhost:3000/ipad`. With your Vercel Redis details, it shows your real
dashboard. Without Redis, `http://localhost:3000/ipad?demo=1` still works.

## Hosting Options

### Render (free web service)

1. On [render.com](https://render.com), choose **New → Blueprint** and select your repository. `render.yaml` already starts the portable server.
2. Fill in `CC_ADMIN_TOKEN`, `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` when prompted.
3. Free services sleep after 15 minutes without traffic and take 30–60 seconds to wake. A display refreshing every minute keeps it awake while it is on.

### Docker (home server, NAS, Raspberry Pi, or any VPS)

```bash
docker compose up -d --build
```

Set the variables in a `.env` file next to `docker-compose.yml`. The image's default
command is the portable server and it listens on port 3000.

### Google Cloud Run

Deploy the repository's `Dockerfile` (`gcloud run deploy --source .`) and set the
variables on the service. The free tier comfortably covers one dashboard.

> Cloudflare Workers/Pages cannot run this project: the dashboard renderer uses a
> native module (`@napi-rs/canvas`) that Workers do not support.

## After Moving

Your displays remember the server address, so update each one:

| Display | What to change |
|:--------|:---------------|
| **iPad / browser** | Open `https://NEW-ADDRESS/ipad`. On an iPad, delete the old home-screen icon and add the new page again. |
| **TRMNL** | Re-run WiFi/server provisioning from the Setup Wizard so the device receives the new URL. |
| **Kindle** | Change the server URL in the Kindle configuration. |

Then remove the project from Vercel if you no longer need it. Your Redis database
is separate; deleting the Vercel project does not delete it, but removing the Redis
integration from Vercel may. Check in the Upstash console before deleting anything.

## Differences From Vercel

| | Vercel | Portable server |
|:--|:--|:--|
| Function timeout | 60 s (`maxDuration`) | None |
| Cold starts | Occasional, 5–10 s | None while running (Render free tier sleeps when idle) |
| Deploys | Manual (`vercel --prod` / Redeploy) | Depends on host; Render redeploys on push |
| `/api/version` environment | `vercel-production` | `development` (label only) |
