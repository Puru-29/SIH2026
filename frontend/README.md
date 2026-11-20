# AgriSense frontend

React 19 app for the farmer, buyer, FPO and admin portals, built with TanStack Start / Router / Query, Vite, TypeScript and Tailwind CSS 4. It talks to the Rust API in [`../backend/`](../backend/). See the [root README](../README.md) for the product overview and local sample-account setup.

## Run

You need Node.js 20.19 or newer with npm (or Bun), and the backend running on port 3001.

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # production build
npm run lint       # ESLint
npm run format     # Prettier
```

Or start the backend and frontend together from the repository root with `scripts/dev.ps1` (Windows) or `scripts/dev.sh` (macOS / Linux).

## API and environment

- In development, Vite forwards `/api/*` and `/health` to `http://127.0.0.1:3001` (see `vite.config.ts`), so there are no CORS issues and no env vars are needed.
- `VITE_API_BASE_URL`: optional. Set it to call a backend at another address (for example `http://localhost:8099`) instead of the proxy.
- `VITE_GOOGLE_CLIENT_ID`: optional, enables Google sign-in.

Put local values in `.env.local` (not committed).

## Folder layout of `src/`

| Folder | What is in it |
|---|---|
| `routes/` | One file per page (TanStack file routes): farmer and buyer pages (`dashboard`, `crops`, `decision`, `orders`, `payments`…), `fpo.*` for the FPO portal and `admin.*` for the admin console. `routeTree.gen.ts` is generated, don't edit it. |
| `components/` | `ui/` (shadcn/ui primitives), `agri/` (farmer and buyer widgets, layout, landing page), `fpo/` and `admin/` (portal-specific pieces). |
| `services/` | API clients (`api-client.ts`, `fpo-api.ts`, `admin-api.ts`), the signed-in session (`session.ts`) and shared types. |
| `hooks/` | React Query hooks over the services (lots, offers, market prices, transactions, FPO data, role guards). |
| `lib/` | Shared helpers and contexts: translations (`i18n*.ts`), crop catalogue, farm location, notifications, formatting. |
| `i18n/`, `assets/` | Extra translation resources and static images. |
