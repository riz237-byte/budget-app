create table public.movements (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  date date not null,
  year integer not null,
  month integer not null check (month between 1 and 12),
  type text not null check (type in ('Entrata', 'Uscita')),
  description text not null check (char_length(description) between 1 and 250),
  amount numeric(14,2) not null check (amount >= 0),
  category text not null check (char_length(category) between 1 and 80),
  primary key (user_id, id)
);
create index movements_user_date_idx on public.movements (user_id, date desc);

create table public.monthly_budgets (
  user_id uuid not null references auth.users(id) on delete cascade,
  year integer not null,
  month integer not null check (month between 1 and 12),
  amount numeric(14,2) not null check (amount >= 0),
  primary key (user_id, year, month)
);

create table public.category_budgets (
  user_id uuid not null references auth.users(id) on delete cascade,
  year integer not null,
  month integer not null check (month between 1 and 12),
  category text not null check (char_length(category) between 1 and 80),
  amount numeric(14,2) not null check (amount >= 0),
  percentage numeric(7,3) not null check (percentage >= 0),
  primary key (user_id, year, month, category)
);

create table public.balances (
  user_id uuid not null references auth.users(id) on delete cascade,
  year integer not null,
  month integer not null,
  account_opening numeric(14,2) not null default 0 check (account_opening >= 0),
  cash_opening numeric(14,2) not null default 0 check (cash_opening >= 0),
  investment_opening numeric(14,2) not null default 0 check (investment_opening >= 0),
  account_final numeric(14,2) check (account_final >= 0),
  cash_final numeric(14,2) check (cash_final >= 0),
  investment_final numeric(14,2) check (investment_final >= 0),
  primary key (user_id, year, month),
  check (month between 1 and 12)
);

create table public.migration_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  completed_at timestamptz not null default now(),
  counts jsonb not null default '{}'::jsonb
);

alter table public.movements enable row level security;
alter table public.monthly_budgets enable row level security;
alter table public.category_budgets enable row level security;
alter table public.balances enable row level security;
alter table public.migration_state enable row level security;

create policy "Owner manages own movements" on public.movements
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Owner manages own monthly budgets" on public.monthly_budgets
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Owner manages own category budgets" on public.category_budgets
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Owner manages own balances" on public.balances
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Owner manages own migration state" on public.migration_state
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.movements, public.monthly_budgets, public.category_budgets, public.balances, public.migration_state from anon;
grant select, insert, update, delete on public.movements, public.monthly_budgets, public.category_budgets, public.balances, public.migration_state to authenticated;

