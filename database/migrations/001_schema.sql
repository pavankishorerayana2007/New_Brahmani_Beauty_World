-- New Brahmani Beauty World : core schema (PostgreSQL / Supabase)
-- Run once (npm run db:migrate, or paste into the Supabase SQL Editor).

create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

-- ---------- users (buyers + the single owner) ----------
create table if not exists users (
  id             uuid primary key default gen_random_uuid(),
  role           text not null default 'buyer' check (role in ('buyer','owner')),
  name           text not null check (char_length(name) between 2 and 100),
  email          text not null check (email = lower(email)),
  mobile         text not null default '' check (mobile = '' or mobile ~ '^[0-9]{10}$'),
  address        text not null default '',
  city           text not null default '',
  pincode        text not null default '',
  loc            jsonb,
  password_hash  text not null,
  token_version  int  not null default 0,
  blocked        boolean not null default false,
  blocked_at     timestamptz,
  failed_logins  int  not null default 0,
  locked_until   timestamptz,
  last_login_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists users_email_uq on users (email);
-- Database-level guarantee: there can never be more than one owner.
create unique index if not exists users_single_owner_uq on users (role) where role = 'owner';
drop trigger if exists users_updated on users;
create trigger users_updated before update on users for each row execute function set_updated_at();

-- ---------- store (single row: the shop run by the owner) ----------
create table if not exists store (
  id             boolean primary key default true check (id),
  owner_id       uuid not null unique references users(id) on delete restrict,
  shop_name      text not null,
  loc            jsonb,
  cod_enabled    boolean not null default true,
  qr_url         text,
  qr_path        text,
  paused         boolean not null default false,
  pause_message  text not null default '',
  paused_since   timestamptz,
  updated_at     timestamptz not null default now()
);
drop trigger if exists store_updated on store;
create trigger store_updated before update on store for each row execute function set_updated_at();

-- ---------- products ----------
create table if not exists products (
  id             bigint generated always as identity primary key,
  type           text not null default 'single' check (type in ('single','combo')),
  name           text not null,
  brand          text not null,
  category       text not null,
  description    text not null default '',
  how_to_use     text not null default '',
  size           text not null default '',
  variant        text not null default '',
  unit           text not null default 'pcs',
  price          numeric(10,2) not null check (price > 0),
  discount_pct   int  not null default 0 check (discount_pct between 0 and 90),
  stock          int  not null default 0 check (stock >= 0),
  initial_stock  int  not null default 0,
  expiry         date,
  shelf          text not null default 'Main store',
  active         boolean not null default true,
  deleted        boolean not null default false,
  kind           text not null default 'jar',
  hue            int  not null default 340,
  images         text[] not null default '{}',
  combo_items    jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists products_visible_idx on products (deleted, active, created_at desc);
create index if not exists products_category_idx on products (category);
drop trigger if exists products_updated on products;
create trigger products_updated before update on products for each row execute function set_updated_at();

create table if not exists product_logs (
  id          bigint generated always as identity primary key,
  product_id  bigint not null references products(id) on delete cascade,
  kind        text not null,
  detail      text not null default '',
  delta       int  not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists product_logs_product_idx on product_logs (product_id, created_at);

-- ---------- delivery requests (deliveries above 10 km need owner approval) ----------
create table if not exists delivery_requests (
  id               bigint generated always as identity primary key,
  buyer_id         uuid not null references users(id) on delete cascade,
  buyer_name       text not null,
  buyer_mobile     text not null default '',
  address          jsonb not null,
  addr_key         text not null,
  items_key        text not null,
  items            jsonb not null,
  subtotal         numeric(10,2) not null,
  distance_km      numeric(6,1) not null,
  estimated        boolean not null default false,
  suggested_charge int not null default 0,
  approved_charge  int,
  status           text not null default 'Pending' check (status in ('Pending','Approved','Rejected','Used')),
  note             text,
  decided_at       timestamptz,
  order_id         bigint,
  from_cart        boolean not null default false,
  created_at       timestamptz not null default now()
);
create index if not exists dr_buyer_idx  on delivery_requests (buyer_id, status);
create index if not exists dr_status_idx on delivery_requests (status, created_at desc);

-- ---------- orders ----------
create table if not exists orders (
  id                  bigint generated always as identity (start with 1001) primary key,
  buyer_id            uuid not null references users(id) on delete restrict,
  status              text not null check (status in ('Awaiting Payment','Confirmed','Packed','Shipped','Delivered','Received by Buyer','Cancelled')),
  payment_method      text not null check (payment_method in ('cod','upi')),
  payment_status      text not null,
  utr                 text,
  proof_path          text,
  subtotal            numeric(10,2) not null,
  delivery_charge     numeric(10,2) not null default 0,
  total               numeric(10,2) not null,
  distance_km         numeric(6,1),
  estimated           boolean not null default false,
  far                 boolean not null default false,
  delivery_request_id bigint references delivery_requests(id) on delete set null,
  address             jsonb not null,
  cancel_reason       text,
  cancelled_at        timestamptz,
  delivered_at        timestamptz,
  received_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists orders_buyer_idx  on orders (buyer_id, created_at desc);
create index if not exists orders_status_idx on orders (status, created_at desc);
-- a payment reference (UTR) can only be used once
create unique index if not exists orders_utr_uq on orders (lower(utr)) where utr is not null;
drop trigger if exists orders_updated on orders;
create trigger orders_updated before update on orders for each row execute function set_updated_at();

do $$ begin
  alter table delivery_requests add constraint dr_order_fk
    foreign key (order_id) references orders(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists order_items (
  id          bigint generated always as identity primary key,
  order_id    bigint not null references orders(id) on delete cascade,
  product_id  bigint references products(id) on delete set null,
  name        text not null,
  qty         int  not null check (qty > 0),
  unit_price  numeric(10,2) not null,
  unit        text not null default 'pcs',
  kind        text,
  hue         int,
  image       text
);
create index if not exists order_items_order_idx on order_items (order_id);
create index if not exists order_items_product_idx on order_items (product_id);

create table if not exists order_events (
  id         bigint generated always as identity primary key,
  order_id   bigint not null references orders(id) on delete cascade,
  status     text not null,
  at         timestamptz not null default now()
);
create index if not exists order_events_order_idx on order_events (order_id, at);

-- ---------- notifications / wishlist ----------
create table if not exists notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references users(id) on delete cascade,
  title       text not null,
  message     text not null,
  goto        text,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (user_id, is_read, created_at desc);

create table if not exists wishlist (
  user_id     uuid   not null references users(id) on delete cascade,
  product_id  bigint not null references products(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, product_id)
);

-- ---------- forgot-password OTP ----------
create table if not exists password_resets (
  email         text primary key,
  user_id       uuid references users(id) on delete cascade,
  otp_hash      text,
  expires_at    timestamptz,
  attempts      int not null default 0,
  dead          boolean not null default true,
  send_count    int not null default 0,
  window_start  timestamptz not null default now(),
  last_sent_at  timestamptz not null default now()
);

-- ---------- Row Level Security ----------
-- RLS is ON with NO policies: Supabase's public (anon / authenticated) API can read
-- nothing. Only this backend (direct Postgres connection) can touch the data.
alter table users             enable row level security;
alter table store             enable row level security;
alter table products          enable row level security;
alter table product_logs      enable row level security;
alter table delivery_requests enable row level security;
alter table orders            enable row level security;
alter table order_items       enable row level security;
alter table order_events      enable row level security;
alter table notifications     enable row level security;
alter table wishlist          enable row level security;
alter table password_resets   enable row level security;
