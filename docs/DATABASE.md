# Database guide (Supabase)

1. Go to https://supabase.com → **Start your project** → sign in → **New project**. Choose a name, a strong **database password** (save it!) and the region nearest to you. Wait ~2 minutes.
2. **Project Settings → API**: copy
   * *Project URL* → `SUPABASE_URL`
   * *service_role* key (click Reveal) → `SUPABASE_SERVICE_ROLE_KEY`  (**secret: server only, never in frontend or GitHub**)
3. **Project Settings → Database → Connection string → URI**. Copy it and replace `[YOUR-PASSWORD]` with your database password → `DATABASE_URL`.
   * Local PC: either "Direct connection" or "Session pooler" works.
   * Vercel: use the **Transaction pooler** string (port 6543).
   * If your password contains symbols like `@ # /` URL-encode them (`@` → `%40`).
4. Create the tables. Easiest: in VS Code terminal run `npm run db:migrate`.
   Alternative: Supabase **SQL Editor → New query**, paste `database/migrations/001_schema.sql`, Run; then the same for `002_storage.sql`.
5. Create the owner: `npm run owner:seed`.
6. Verify: Supabase **Table Editor** → `users` has one row with role `owner`; `store` has one row. `Storage` shows buckets `public-media` (public) and `payment-proofs` (private). `npm run check` prints OK lines.

## Security model
All tables have Row Level Security **enabled with no policies**, so the public Supabase API (anon key) can read nothing. Only this backend (direct Postgres connection + service-role key) touches data. The anon key is not used.

## Tables
`users` · `store` (single row) · `products` · `product_logs` · `orders` · `order_items` · `order_events` · `delivery_requests` · `notifications` · `wishlist` · `password_resets`
