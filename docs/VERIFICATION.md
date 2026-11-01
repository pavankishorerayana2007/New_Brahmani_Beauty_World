# Final verification — what was and was not tested

## Actually done in the build environment
| Check | Result |
|---|---|
| Every server/script file parses (`node --check`) | Pass |
| Converted frontend loads in a real browser (Chromium), no JS errors | Pass |
| Sign-up form no longer offers owner mode; no demo buttons | Pass |
| Login error display, buyer login → shop → product page, session restore on reload (API mocked) | Pass |
| Owner login → all 8 owner screens render (API mocked) | Pass |
| Server distance/price/delivery logic gives identical results to your original frontend functions | Pass |
| Scan of converted frontend for leftover `localStorage`, demo accounts, fake payment code | None left |

## NOT tested (the build environment has no internet, no Postgres, no Supabase, no Vercel, no SMTP)
The Express server was **never started**, and nothing ran against a real database. That means these are written but unverified until you run them: registration/login/logout cookies, role checks, every SQL statement, transactions (stock, orders), image upload/Storage, signed payment-proof links, OTP email, rate limiting, the Vercel deployment itself.
Expect to possibly hit a few small bugs on first run. If one appears, copy the exact terminal/Vercel log message and it can be fixed quickly.

## Your acceptance checklist (about 20 minutes)
1. `npm run check` → all OK.
2. Register buyer → appears in `users` (role buyer, hashed password). Log out/in. Refresh keeps you logged in.
3. Register with `pavan@gmail.com` → rejected. Owner login works; buyer cannot open owner pages (`/api/products` returns 403 for a buyer).
4. Owner: add product with image → buyer sees it. Edit price/stock (needs a reason) → History shows entries.
5. Buyer: add to cart, COD order → stock decreases, owner gets notification; owner advances Packed → Shipped → Delivered; buyer taps "I Have Taken Order".
6. Buyer: UPI order with reference + screenshot → owner Orders page → View proof → Confirm.
7. Buyer cancels an order → stock returns. Owner blocks the buyer → buyer cannot order.
8. Address > 10 km → request sent → owner approves with a charge → buyer completes checkout.
9. Pause store → buyer cannot order. Toggle COD off → hidden at checkout.
10. Production: repeat 2, 4, 5 on the Vercel URL.

## Known limitations
* Inline `onclick` handlers (from your original design) require `script-src-attr 'unsafe-inline'` in the CSP; moving to event listeners would remove it.
* Rate limiting counts in each serverless instance's memory; the per-account login lockout (stored in the database) is the dependable protection.
* GPS coordinates are sent by the buyer's browser; the owner still approves long-distance deliveries and sees the address.
* The shopping bag is kept in the page only (as in your prototype), so it clears on reload.
* One shop / one owner by design (as requested).
