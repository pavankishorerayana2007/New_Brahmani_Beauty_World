# Vercel deployment guide

Architecture: **one Vercel project**. `public/` is served as static files; every `/api/*` request is rewritten to `api/index.js`, which runs the same Express app as a serverless function (`vercel.json` already contains this). Same origin ⇒ no CORS problems and secure cookies just work.

1. Push the project to GitHub (docs/GITHUB.md).
2. https://vercel.com → sign in with GitHub → **Add New → Project** → **Import** your repository.
3. Settings on the import screen: **Framework Preset: Other**. Build Command: leave empty. Output Directory: `public`. Install Command: `npm install`. (Root Directory: the folder with `package.json`.)
4. Open **Environment Variables** and add (Production):

| Name | Value |
|---|---|
| `DATABASE_URL` | Supabase **Transaction pooler** URI (port 6543) |
| `JWT_SECRET` | the long random secret (new one for production is best) |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
| `OWNER_EMAIL` | `pavan@gmail.com` |
| `SHOP_NAME` | New Brahmani Beauty World |
| `FRONTEND_URL` | your final URL, e.g. `https://your-project.vercel.app` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | only if using forgot-password email |

Do **not** add `OWNER_INITIAL_PASSWORD` on Vercel — the owner is created from your own PC (`npm run owner:seed`) against the same Supabase database.

5. Click **Deploy**. After it finishes, update `FRONTEND_URL` if the URL differs, then **Deployments → Redeploy**.
6. Test: open `https://YOUR-URL/api/health` → `{"ok":true,...}`. Then register a buyer, log in, log out; log in as the owner; add a product with an image; as a buyer place a COD order; check the rows in Supabase.
7. Every `git push` to `main` triggers an automatic new deployment (pull requests/branches get preview URLs).

Troubleshooting: Vercel → project → **Logs**. A 500 on every API call usually means a missing env var (`DATABASE_URL`, `JWT_SECRET`) or the wrong (non-pooler) connection string.
