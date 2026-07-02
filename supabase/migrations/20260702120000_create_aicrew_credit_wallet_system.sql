-- AICrew credit wallet system.
-- Idempotent, aicrew_ prefixed, no destructive changes.

create extension if not exists pgcrypto;

create table if not exists public.aicrew_credit_policies (
  id text primary key,
  kind text not null,
  name text not null,
  payload jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aicrew_membership_plans (
  id text primary key,
  name text not null,
  price_cny integer not null default 0 check (price_cny >= 0),
  signup_bonus integer not null default 0 check (signup_bonus >= 0),
  daily_refresh_first_week integer not null default 0 check (daily_refresh_first_week >= 0),
  daily_refresh_after_week integer not null default 0 check (daily_refresh_after_week >= 0),
  monthly_grant integer not null default 0 check (monthly_grant >= 0),
  concurrent_task_limit integer,
  payload jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aicrew_credit_products (
  id text primary key,
  name text not null,
  price_cny integer not null check (price_cny >= 0),
  base_credits integer not null check (base_credits >= 0),
  bonus_credits integer not null default 0 check (bonus_credits >= 0),
  total_credits integer generated always as (base_credits + bonus_credits) stored,
  payload jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aicrew_price_rules (
  id text primary key,
  catalog_version text not null,
  category text not null,
  unit text not null,
  base_credits integer not null check (base_credits >= 0),
  high_pattern_credits integer not null check (high_pattern_credits >= 0),
  payload jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (catalog_version, category, unit)
);

create table if not exists public.aicrew_wallets (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.aicrew_workspaces(id) on delete cascade,
  user_id text,
  currency text not null default 'credits',
  display_name text not null default '算力积分',
  plan_id text not null default 'free',
  available_credits integer not null default 0 check (available_credits >= 0),
  reserved_credits integer not null default 0 check (reserved_credits >= 0),
  lifetime_granted integer not null default 0 check (lifetime_granted >= 0),
  lifetime_purchased integer not null default 0 check (lifetime_purchased >= 0),
  lifetime_consumed integer not null default 0 check (lifetime_consumed >= 0),
  version integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, currency)
);

create table if not exists public.aicrew_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.aicrew_workspaces(id) on delete cascade,
  wallet_id uuid references public.aicrew_wallets(id) on delete set null,
  product_id text,
  provider text not null default 'manual',
  provider_order_id text,
  status text not null default 'draft',
  amount_cny integer not null default 0 check (amount_cny >= 0),
  product_snapshot jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  unique (provider, provider_order_id)
);

create table if not exists public.aicrew_credit_buckets (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.aicrew_wallets(id) on delete cascade,
  source_type text not null,
  original_amount integer not null check (original_amount >= 0),
  remaining_amount integer not null check (remaining_amount >= 0),
  reserved_amount integer not null default 0 check (reserved_amount >= 0),
  expires_at timestamptz,
  priority integer not null default 100,
  grant_policy_id text references public.aicrew_credit_policies(id),
  order_id uuid references public.aicrew_orders(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (remaining_amount + reserved_amount <= original_amount)
);
create index if not exists aicrew_credit_buckets_spend_idx on public.aicrew_credit_buckets(wallet_id, priority, expires_at nulls last, created_at);

create table if not exists public.aicrew_credit_reservations (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.aicrew_wallets(id) on delete cascade,
  task_id text,
  quote_id text,
  amount_reserved integer not null check (amount_reserved >= 0),
  amount_settled integer not null default 0 check (amount_settled >= 0),
  price_catalog_version text not null,
  status text not null default 'reserved',
  idempotency_key text not null,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wallet_id, idempotency_key),
  check (amount_settled <= amount_reserved)
);
create index if not exists aicrew_credit_reservations_wallet_idx on public.aicrew_credit_reservations(wallet_id, status, expires_at);

create table if not exists public.aicrew_credit_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.aicrew_wallets(id) on delete cascade,
  bucket_id uuid references public.aicrew_credit_buckets(id),
  reservation_id uuid references public.aicrew_credit_reservations(id),
  type text not null,
  status text not null default 'posted',
  amount integer not null,
  balance_after integer not null check (balance_after >= 0),
  reserved_after integer not null default 0 check (reserved_after >= 0),
  price_catalog_version text,
  reference_type text,
  reference_id text,
  idempotency_key text not null,
  description text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  unique (wallet_id, idempotency_key)
);
create index if not exists aicrew_credit_transactions_wallet_idx on public.aicrew_credit_transactions(wallet_id, created_at desc);

create table if not exists public.aicrew_credit_reservation_allocations (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.aicrew_credit_reservations(id) on delete cascade,
  bucket_id uuid not null references public.aicrew_credit_buckets(id),
  amount_reserved integer not null check (amount_reserved >= 0),
  amount_settled integer not null default 0 check (amount_settled >= 0),
  source_expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (reservation_id, bucket_id),
  check (amount_settled <= amount_reserved)
);

create table if not exists public.aicrew_credit_transaction_allocations (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.aicrew_credit_transactions(id) on delete cascade,
  bucket_id uuid not null references public.aicrew_credit_buckets(id),
  amount integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.aicrew_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.aicrew_workspaces(id) on delete cascade,
  wallet_id uuid references public.aicrew_wallets(id) on delete set null,
  plan_id text not null,
  status text not null default 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  agreement_version text,
  plan_snapshot jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);

create table if not exists public.aicrew_redeem_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  policy_id text references public.aicrew_credit_policies(id),
  max_redemptions integer not null default 1 check (max_redemptions > 0),
  redeemed_count integer not null default 0 check (redeemed_count >= 0),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.aicrew_redeem_records (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.aicrew_redeem_codes(id) on delete cascade,
  wallet_id uuid not null references public.aicrew_wallets(id) on delete cascade,
  transaction_id uuid references public.aicrew_credit_transactions(id),
  created_at timestamptz not null default now(),
  unique (code_id, wallet_id)
);

create table if not exists public.aicrew_credit_audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.aicrew_workspaces(id) on delete cascade,
  wallet_id uuid references public.aicrew_wallets(id) on delete set null,
  actor_id text not null default 'system',
  actor_role text not null default 'system',
  action text not null,
  reason text not null,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.aicrew_membership_plans (id, name, price_cny, signup_bonus, daily_refresh_first_week, daily_refresh_after_week, monthly_grant, concurrent_task_limit, payload)
values
  ('free', '免费版', 0, 70, 20, 10, 0, 2, '{}'::jsonb),
  ('standard_monthly', '普通会员', 68, 0, 20, 20, 1300, 5, '{}'::jsonb),
  ('pro_monthly', '高级会员', 328, 0, 20, 20, 6500, 7, '{}'::jsonb),
  ('flagship_monthly', '旗舰会员', 763, 0, 20, 20, 16000, null, '{}'::jsonb)
on conflict (id) do update
  set name = excluded.name,
      price_cny = excluded.price_cny,
      signup_bonus = excluded.signup_bonus,
      daily_refresh_first_week = excluded.daily_refresh_first_week,
      daily_refresh_after_week = excluded.daily_refresh_after_week,
      monthly_grant = excluded.monthly_grant,
      concurrent_task_limit = excluded.concurrent_task_limit,
      updated_at = now();

insert into public.aicrew_credit_products (id, name, price_cny, base_credits, bonus_credits, payload)
values
  ('topup_300', '300 积分包', 30, 300, 0, '{}'::jsonb),
  ('topup_680', '680 积分包', 68, 680, 0, '{}'::jsonb),
  ('topup_980', '980 积分包', 98, 980, 50, '{}'::jsonb),
  ('topup_1680', '1680 积分包', 168, 1680, 170, '{}'::jsonb),
  ('topup_3280', '3280 积分包', 328, 3280, 520, '{}'::jsonb),
  ('topup_6480', '6480 积分包', 648, 6480, 1520, '{}'::jsonb)
on conflict (id) do update
  set name = excluded.name,
      price_cny = excluded.price_cny,
      base_credits = excluded.base_credits,
      bonus_credits = excluded.bonus_credits,
      updated_at = now();
