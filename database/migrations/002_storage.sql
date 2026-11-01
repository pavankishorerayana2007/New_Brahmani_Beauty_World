-- Storage buckets (Supabase only).
--  public-media    : product images and the owner's payment QR (public read)
--  payment-proofs  : buyers' payment screenshots (private, owner views via signed URL)
insert into storage.buckets (id, name, public) values ('public-media', 'public-media', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('payment-proofs', 'payment-proofs', false)
  on conflict (id) do nothing;
-- No storage policies are created: uploads happen only through the backend (service role).
