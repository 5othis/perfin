# PerFin — Personal Finance Tracker

Local-first web app replacing Excel for tracking net worth across multiple accounts.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

## Features

- **Dashboard** — net worth total, breakdown by account type, all account balances
- **Update Balances** — enter today's balances for every account and save a snapshot
- **History** — net worth over time chart + per-account history + snapshot table
- **Accounts** — add, edit, delete accounts

## Data

All data is stored in browser `localStorage`. Use **Export** (top-right) to save a `.json` backup. Use **Import** to restore it on any machine.

> Pre-loaded with your 14 accounts and initial April 2026 snapshot from the Excel sheet.

## Build

```bash
npm run build   # output in dist/
npm run preview # preview the build locally
```

## Docker

### Build & Run

```bash
# Build image and run on http://localhost:8080
docker compose up --build -d

# Or manually:
docker build -t perfin .
docker run -d -p 8080:80 --name perfin perfin
```

### Notes

- Data is still in browser `localStorage` — Docker only changes how the app is served, not where data is stored.
- `docker-compose.yml` maps host port `8080` to container port `80`.
- The Dockerfile is multi-stage: Node builds the Vite app, then Nginx serves the static `dist/` files.
