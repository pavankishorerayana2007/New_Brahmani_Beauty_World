# New Brahmani Beauty World — full-stack store

Your original frontend (same design, pages and workflows) now runs on a real backend:
**Node.js + Express** API, **Supabase PostgreSQL** database, **Supabase Storage** for images.

```
public/            your frontend (index.html = original markup + CSS, app.js = original logic, now calling the API)
server/            Express backend  (routes, middleware, services, config)
api/index.js       Vercel serverless entry (wraps the same Express app)
database/migrations/  SQL schema (001) and storage buckets (002)
scripts/           db:migrate, owner:seed, check
docs/              step-by-step guides
```

## Quick start (Windows, VS Code)
1. Create the Supabase project and get your keys: **docs/DATABASE.md**
2. Open the project folder in VS Code: *File → Open Folder →* the folder that contains `package.json`.
3. Open the terminal (**Ctrl + `**) and run:
```
npm install
copy .env.example .env
```
4. Edit `.env` (fill Supabase values, `JWT_SECRET`, `OWNER_INITIAL_PASSWORD`).
5. Create tables, the owner account, then start:
```
npm run db:migrate
npm run owner:seed
npm run check
npm run dev
```
6. Open http://localhost:5000 — log in as **pavan@gmail.com** with the password you put in `OWNER_INITIAL_PASSWORD`.
7. Delete `OWNER_INITIAL_PASSWORD` from `.env` (it is only needed once).

Full guides: **docs/SETUP.md** · **docs/DATABASE.md** · **docs/GITHUB.md** · **docs/VERCEL.md** · **docs/VERIFICATION.md**

## How the owner account works
* `pavan@gmail.com` (`OWNER_EMAIL`) is the only owner. It is created by `npm run owner:seed`, never by the sign-up form.
* The sign-up API always creates a **buyer**; the role is never read from the request, and the owner email is reserved.
* The database itself enforces one owner (unique partial index). The password is stored only as a bcrypt hash and is never in source code.
* Roles are always read from the database on every request; the frontend's role is never trusted.
* Forgot the owner password? Put a new one in `OWNER_INITIAL_PASSWORD` and run `npm run owner:reset-password`.

## What changed in behaviour (on purpose)
* Demo buttons, demo accounts, sample products/orders, localStorage "database" and simulated payments are gone.
* Passwords are hashed with bcrypt on the server (the prototype used a fast SHA-256 in the browser).
* **UPI payments:** submitting a screenshot no longer marks an order "Paid". The order waits as *Awaiting Payment* and the owner confirms it from the Orders page after checking their own UPI account (that screen already existed in your design).
* Forgot-password sends a real email OTP through SMTP (optional; see `.env.example`). Without SMTP the page tells the user email isn't set up.
* The delivery distance still uses GPS when available, otherwise a PIN-code estimate (the label now says "estimated").
* Stock, prices, delivery charge and every status change are decided on the server, inside database transactions.

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | Start API + frontend on http://localhost:5000 (auto-restart) |
| `npm start` | Start without auto-restart |
| `npm run db:migrate` | Apply `database/migrations/*.sql` once each |
| `npm run owner:seed` | Create the owner (does nothing if it exists) |
| `npm run owner:reset-password` | Set a new owner password |
| `npm run check` | Verify env vars, DB connection, tables, owner |
