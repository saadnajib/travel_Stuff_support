# @carrylink/web

React 18 + TypeScript + Vite frontend for CarryLink (contract: `docs/API.md`).

- Install (from repo root): `npm install`
- Dev server: `npm run dev -w apps/web` → http://localhost:5173 (start the API on :4000 too: `npm run dev -w apps/api`)
- Build / typecheck: `npm run build -w apps/web` · `npm run typecheck -w apps/web`
- Env: `VITE_API_URL` (optional) — API base URL; defaults to `/api/v1`.
- Proxy: in dev (and `vite preview`) `/api` is proxied to `http://localhost:4000`, so the httpOnly refresh cookie is same-origin. Leave `VITE_API_URL` unset locally; if you point it at another origin, that API must allow CORS with credentials for this origin.
- Auth: the access token lives in memory only; the session is restored on load via `POST /auth/refresh`.
- Dev seed logins: see `docs/API.md` (e.g. `sender@carrylink.dev` / `Sender-Passw0rd!`).
