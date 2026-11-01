# Local setup (Windows + VS Code), step by step

**Needs:** Node.js 20+ (https://nodejs.org, LTS), VS Code, a Supabase project (docs/DATABASE.md).

1. Unzip the project. In VS Code: **File → Open Folder** → choose the folder that contains `package.json` (not a parent folder).
2. **Terminal → New Terminal**. Check Node: `node -v` (must show v20 or higher).
3. Install: `npm install`
4. Create your env file: `copy .env.example .env` — it must sit next to `package.json`. Open `.env` and fill:
   * `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (docs/DATABASE.md)
   * `JWT_SECRET`: run `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and paste the output
   * `OWNER_EMAIL=pavan@gmail.com`, `OWNER_INITIAL_PASSWORD` (10+ characters, your choice)
   * SMTP lines only if you want working "Forgot password" emails (Gmail: enable 2-step verification, create an *App password*, use `smtp.gmail.com`, port `587`).
5. `npm run db:migrate` → `npm run owner:seed` → `npm run check`
6. `npm run dev` → open http://localhost:5000 (frontend and backend are one process; there is no separate frontend server).

## Test registration and login
* **Sign Up** tab → create a buyer. You should land on the shop.
* Sign out, log in as `pavan@gmail.com` with the owner password → Owner screens (Add Product, History, Orders…).
* Verify records: Supabase → Table Editor → `users` (password column is a long `$2a$12$…` hash).
* Try the sign-up form with `pavan@gmail.com` → "Email already exists" (cannot become owner).

## Troubleshooting
| Message | Fix |
|---|---|
| `Invalid or missing environment variables` | `.env` missing, not next to package.json, or a required value empty |
| `password authentication failed` / `ENOTFOUND` | Wrong `DATABASE_URL` password or host; URL-encode special characters |
| `relation "users" does not exist` | Run `npm run db:migrate` |
| Login says incorrect for owner | Run `npm run owner:seed` (or `owner:reset-password`) |
| Image upload: "storage is not set up" | `SUPABASE_URL` / service key missing, or run migration 002 |
| `EADDRINUSE` | Port 5000 busy: change `PORT` in `.env` |
| Forgot password: "email is not set up" | Fill the SMTP lines in `.env` |
