-- Reviewed accounting schema source. The Supabase CLI is unavailable in this
-- workspace (offline invocation is not cached), so this is deliberately not a
-- fabricated migration history filename. Apply once, then record its real version.
-- This is a manual bookkeeping ledger: it does not move money at any provider.
-- The existing public.accounting_entries belongs to FinanceControlCenter and is
-- deliberately neither read nor altered. All new storage is tc_accounting_*.

create table if not exists public.tc_accounting_categories (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('income','expense')),
  name text not null check (length(btrim(name)) between 2 and 80),
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid
);
create unique index if not exists tc_accounting_categories_name_key on public.tc_accounting_categories(kind,lower(btrim(name)));
create table if not exists public.tc_accounting_methods (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 80),
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid
);
create unique index if not exists tc_accounting_methods_name_key on public.tc_accounting_methods(lower(btrim(name)));

create table if not exists public.tc_accounting_ledger_entries (
  id uuid primary key,
  kind text not null check (kind in ('income','expense','transfer','vault_deposit','vault_withdrawal','opening_balance','vault_payout')),
  account text not null check (account in ('celestial','leonaris')),
  to_account text check (to_account in ('celestial','leonaris')),
  currency text not null check (currency in ('EUR','USD')),
  amount_cents bigint not null check (amount_cents between 1 and 100000000000),
  occurred_on date not null check (occurred_on between date '2000-01-01' and date '2099-12-31'),
  category_id uuid references public.tc_accounting_categories(id) on delete restrict,
  method_id uuid references public.tc_accounting_methods(id) on delete restrict,
  description text not null check (length(btrim(description)) between 3 and 500),
  reference text not null default '' check (length(reference) <= 200),
  recipient text check (recipient in ('Alex','Ricky')),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null,
  voided_at timestamptz,
  void_reason text,
  voided_by uuid,
  check ((kind='transfer' and to_account is not null and account<>to_account) or (kind<>'transfer' and to_account is null)),
  check ((kind in ('income','expense') and category_id is not null and method_id is not null) or (kind not in ('income','expense') and category_id is null)),
  check ((kind='vault_payout' and recipient is not null) or (kind<>'vault_payout' and recipient is null)),
  check ((voided_at is null and void_reason is null and voided_by is null) or
         (voided_at is not null and void_reason is not null and length(btrim(void_reason)) between 3 and 500 and voided_by is not null and voided_at>=created_at))
);
create index if not exists tc_accounting_ledger_entries_date_idx on public.tc_accounting_ledger_entries(currency,occurred_on,created_at,id);
create index if not exists tc_accounting_ledger_entries_account_date_idx on public.tc_accounting_ledger_entries(account,currency,occurred_on) where voided_at is null;
create index if not exists tc_accounting_ledger_entries_to_account_idx on public.tc_accounting_ledger_entries(to_account,currency,occurred_on) where kind='transfer' and voided_at is null;
create index if not exists tc_accounting_ledger_entries_category_idx on public.tc_accounting_ledger_entries(category_id) where category_id is not null;
create index if not exists tc_accounting_ledger_entries_method_idx on public.tc_accounting_ledger_entries(method_id) where method_id is not null;
create unique index if not exists tc_accounting_ledger_entries_initial_balance_key on public.tc_accounting_ledger_entries(account,currency) where kind='opening_balance' and voided_at is null;

create table if not exists public.tc_accounting_option_audit (
  id uuid primary key default gen_random_uuid(),
  option_kind text not null check (option_kind in ('income','expense','method')),
  option_id uuid not null,
  actor uuid not null,
  previous_state jsonb,
  next_state jsonb not null,
  occurred_at timestamptz not null default clock_timestamp()
);

alter table public.tc_accounting_categories enable row level security;
alter table public.tc_accounting_methods enable row level security;
alter table public.tc_accounting_ledger_entries enable row level security;
alter table public.tc_accounting_option_audit enable row level security;
revoke all on public.tc_accounting_categories,public.tc_accounting_methods,public.tc_accounting_ledger_entries,public.tc_accounting_option_audit from public,anon,authenticated,service_role;
grant select,insert,update on public.tc_accounting_categories,public.tc_accounting_methods to service_role;
grant select,insert on public.tc_accounting_ledger_entries,public.tc_accounting_option_audit to service_role;
grant update(voided_at,void_reason,voided_by) on public.tc_accounting_ledger_entries to service_role;

insert into public.tc_accounting_methods(name) values ('PayPal'),('Bizum'),('Transferencia externa'),('Efectivo') on conflict do nothing;
insert into public.tc_accounting_categories(kind,name) values
 ('income','Venta de minutos'),('income','Rituales'),('income','Otros ingresos'),
 ('expense','Centrales'),('expense','Tarotistas'),('expense','Recargas'),
 ('expense','Premium numbers'),('expense','WellDone'),('expense','Otros gastos') on conflict do nothing;

create schema if not exists private;
grant usage on schema private to service_role;
create or replace function private.tc_accounting_immutable_entry()
returns trigger language plpgsql security invoker set search_path='' as $fn$
begin
  if tg_op='DELETE' then raise exception 'ACCOUNTING_IMMUTABLE_ENTRY'; end if;
  if old.voided_at is not null or new.voided_at is null or
     (to_jsonb(new)-array['voided_at','void_reason','voided_by']) is distinct from
     (to_jsonb(old)-array['voided_at','void_reason','voided_by']) then
    raise exception 'ACCOUNTING_IMMUTABLE_ENTRY';
  end if;
  return new;
end $fn$;
revoke all on function private.tc_accounting_immutable_entry() from public,anon,authenticated;
grant execute on function private.tc_accounting_immutable_entry() to service_role;
drop trigger if exists tc_accounting_immutable_entry on public.tc_accounting_ledger_entries;
create trigger tc_accounting_immutable_entry before update or delete on public.tc_accounting_ledger_entries
for each row execute function private.tc_accounting_immutable_entry();

-- Validate all historical vault balances, not merely today's total. A backdated
-- withdrawal or void must never create a temporarily negative vault.
create or replace function private.tc_accounting_assert_vault_balances()
returns void language plpgsql security invoker set search_path='' as $fn$
begin
  if exists (
    select 1 from (
      select sum(case when kind='vault_deposit' then amount_cents else -amount_cents end)
        over(partition by account,currency order by occurred_on,created_at,id rows unbounded preceding) balance
      from public.tc_accounting_ledger_entries
      where voided_at is null and kind in ('vault_deposit','vault_withdrawal','vault_payout')
    ) v where v.balance<0
  ) then raise exception 'ACCOUNTING_INSUFFICIENT_VAULT'; end if;
end $fn$;
revoke all on function private.tc_accounting_assert_vault_balances() from public,anon,authenticated;
grant execute on function private.tc_accounting_assert_vault_balances() to service_role;

create or replace function public.accounting_snapshot(p_actor uuid)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare v_result jsonb;
begin
  if not coalesce(public.tc_has_admin_access(p_actor),false) then raise exception 'ACCOUNTING_FORBIDDEN'; end if;
  -- One SQL statement means all components share the same MVCC snapshot.
  select jsonb_build_object(
    'entries',coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_on desc,e.created_at desc,e.id desc) from public.tc_accounting_ledger_entries e),'[]'::jsonb),
    'categories',coalesce((select jsonb_agg(to_jsonb(c) order by c.kind,c.name) from public.tc_accounting_categories c),'[]'::jsonb),
    'methods',coalesce((select jsonb_agg(to_jsonb(m) order by m.name) from public.tc_accounting_methods m),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $fn$;

create or replace function public.accounting_post_entry(p_actor uuid,p_entry jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare
  v_id uuid; v_kind text; v_account text; v_to text; v_currency text; v_amount bigint;
  v_date date; v_category uuid; v_method uuid; v_description text; v_reference text; v_recipient text;
  v_existing public.tc_accounting_ledger_entries%rowtype; v_saved public.tc_accounting_ledger_entries%rowtype;
  v_available numeric; v_available_on_date numeric;
begin
  if not coalesce(public.tc_has_admin_access(p_actor),false) then raise exception 'ACCOUNTING_FORBIDDEN'; end if;
  if jsonb_typeof(p_entry) is distinct from 'object' then raise exception 'ACCOUNTING_INVALID_ENTRY'; end if;
  if coalesce(p_entry->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'ACCOUNTING_INVALID_ID'; end if;
  v_id := (p_entry->>'id')::uuid;
  v_kind := p_entry->>'kind'; v_account := p_entry->>'account'; v_to := p_entry->>'to_account';
  v_currency := p_entry->>'currency'; v_recipient := p_entry->>'recipient';
  v_description := btrim(coalesce(p_entry->>'description','')); v_reference := btrim(coalesce(p_entry->>'reference',''));
  if jsonb_typeof(p_entry->'description') is distinct from 'string' or
     (p_entry->>'reference' is not null and jsonb_typeof(p_entry->'reference') is distinct from 'string') then raise exception 'ACCOUNTING_INVALID_DESCRIPTION'; end if;
  if v_kind is null or v_kind not in ('income','expense','transfer','vault_deposit','vault_withdrawal','opening_balance','vault_payout')
    or v_account is null or v_account not in ('celestial','leonaris') or v_currency is null or v_currency not in ('EUR','USD') then
    raise exception 'ACCOUNTING_INVALID_ENTRY';
  end if;
  if jsonb_typeof(p_entry->'amount_cents') is distinct from 'number' or coalesce(p_entry->>'amount_cents','') !~ '^[0-9]+$'
    or length(p_entry->>'amount_cents')>12 then raise exception 'ACCOUNTING_INVALID_AMOUNT'; end if;
  v_amount := (p_entry->>'amount_cents')::bigint;
  if v_amount<1 or v_amount>100000000000 then raise exception 'ACCOUNTING_INVALID_AMOUNT'; end if;
  if coalesce(p_entry->>'occurred_on','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then raise exception 'ACCOUNTING_INVALID_DATE'; end if;
  begin v_date := (p_entry->>'occurred_on')::date;
  exception when others then raise exception 'ACCOUNTING_INVALID_DATE'; end;
  if v_date>(now() at time zone 'Europe/Madrid')::date then raise exception 'ACCOUNTING_FUTURE_DATE'; end if;
  if length(v_description) not between 3 and 500 or length(v_reference)>200 then raise exception 'ACCOUNTING_INVALID_DESCRIPTION'; end if;
  if (p_entry->>'category_id') is not null and (p_entry->>'category_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'ACCOUNTING_INVALID_CATEGORY'; end if;
  if (p_entry->>'method_id') is not null and (p_entry->>'method_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'ACCOUNTING_INVALID_METHOD'; end if;
  v_category := (p_entry->>'category_id')::uuid; v_method := (p_entry->>'method_id')::uuid;
  if (v_kind='transfer' and (v_to is null or v_to not in ('celestial','leonaris') or v_to=v_account))
    or (v_kind<>'transfer' and v_to is not null) then raise exception 'ACCOUNTING_INVALID_TRANSFER'; end if;
  if (v_kind in ('income','expense') and (v_category is null or v_method is null))
    or (v_kind not in ('income','expense') and v_category is not null) then raise exception 'ACCOUNTING_INVALID_CATEGORY'; end if;
  if (v_kind='vault_payout' and (v_recipient is null or v_recipient not in ('Alex','Ricky')))
    or (v_kind<>'vault_payout' and v_recipient is not null) then raise exception 'ACCOUNTING_INVALID_RECIPIENT'; end if;

  perform pg_advisory_xact_lock(hashtextextended('tc-accounting-ledger-v1',0));
  select * into v_existing from public.tc_accounting_ledger_entries where id=v_id;
  if found then
    if v_existing.created_by is distinct from p_actor or
       row(v_existing.kind,v_existing.account,v_existing.to_account,v_existing.currency,v_existing.amount_cents,v_existing.occurred_on,v_existing.category_id,v_existing.method_id,v_existing.description,v_existing.reference,v_existing.recipient)
       is distinct from row(v_kind,v_account,v_to,v_currency,v_amount,v_date,v_category,v_method,v_description,v_reference,v_recipient) then
      raise exception 'ACCOUNTING_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('entry',to_jsonb(v_existing),'replayed',true);
  end if;
  if v_category is not null and not exists(select 1 from public.tc_accounting_categories where id=v_category and kind=v_kind and active) then raise exception 'ACCOUNTING_INVALID_CATEGORY'; end if;
  if v_method is not null and not exists(select 1 from public.tc_accounting_methods where id=v_method and active) then raise exception 'ACCOUNTING_INVALID_METHOD'; end if;
  if v_kind='opening_balance' then
    if exists(select 1 from public.tc_accounting_ledger_entries where account=v_account and currency=v_currency and kind='opening_balance' and voided_at is null) then raise exception 'ACCOUNTING_OPENING_EXISTS'; end if;
    if exists(select 1 from public.tc_accounting_ledger_entries where currency=v_currency and voided_at is null and (account=v_account or to_account=v_account) and occurred_on<v_date) then raise exception 'ACCOUNTING_OPENING_DATE'; end if;
  end if;
  if v_kind='vault_deposit' then
    select coalesce(sum(delta),0),coalesce(sum(delta) filter(where occurred_on<=v_date),0) into v_available,v_available_on_date
    from (
      select occurred_on,case
        when kind in ('income','opening_balance','vault_withdrawal') and account=v_account then amount_cents
        when kind in ('expense','vault_deposit') and account=v_account then -amount_cents
        when kind='transfer' and account=v_account then -amount_cents
        when kind='transfer' and to_account=v_account then amount_cents
        else 0 end delta
      from public.tc_accounting_ledger_entries where currency=v_currency and voided_at is null and (account=v_account or to_account=v_account)
    ) balances;
    if v_available<v_amount or v_available_on_date<v_amount then raise exception 'ACCOUNTING_INSUFFICIENT_AVAILABLE'; end if;
  end if;
  insert into public.tc_accounting_ledger_entries(id,kind,account,to_account,currency,amount_cents,occurred_on,category_id,method_id,description,reference,recipient,created_by)
  values(v_id,v_kind,v_account,v_to,v_currency,v_amount,v_date,v_category,v_method,v_description,v_reference,v_recipient,p_actor)
  returning * into v_saved;
  perform private.tc_accounting_assert_vault_balances();
  return jsonb_build_object('entry',to_jsonb(v_saved),'replayed',false);
end $fn$;

create or replace function public.accounting_void_entry(p_actor uuid,p_id uuid,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare v_entry public.tc_accounting_ledger_entries%rowtype; v_reason text := btrim(coalesce(p_reason,''));
begin
  if not coalesce(public.tc_has_admin_access(p_actor),false) then raise exception 'ACCOUNTING_FORBIDDEN'; end if;
  if p_id is null or length(v_reason) not between 3 and 500 then raise exception 'ACCOUNTING_INVALID_VOID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('tc-accounting-ledger-v1',0));
  select * into v_entry from public.tc_accounting_ledger_entries where id=p_id for update;
  if not found then raise exception 'ACCOUNTING_ENTRY_NOT_FOUND'; end if;
  if v_entry.voided_at is not null then return jsonb_build_object('entry',to_jsonb(v_entry),'replayed',true); end if;
  update public.tc_accounting_ledger_entries set voided_at=clock_timestamp(),voided_by=p_actor,void_reason=v_reason where id=p_id returning * into v_entry;
  perform private.tc_accounting_assert_vault_balances();
  return jsonb_build_object('entry',to_jsonb(v_entry),'replayed',false);
end $fn$;

create or replace function public.accounting_upsert_option(p_actor uuid,p_option jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare v_id uuid; v_kind text; v_name text; v_active boolean; v_old jsonb; v_new jsonb;
begin
  if not coalesce(public.tc_has_admin_access(p_actor),false) then raise exception 'ACCOUNTING_FORBIDDEN'; end if;
  if jsonb_typeof(p_option) is distinct from 'object' then raise exception 'ACCOUNTING_INVALID_OPTION'; end if;
  v_kind := p_option->>'kind'; v_name := btrim(coalesce(p_option->>'name',''));
  if v_kind is null or v_kind not in ('income','expense','method') or jsonb_typeof(p_option->'name') is distinct from 'string' or length(v_name) not between 2 and 80 then raise exception 'ACCOUNTING_INVALID_OPTION'; end if;
  if p_option ? 'active' and jsonb_typeof(p_option->'active') is distinct from 'boolean' then raise exception 'ACCOUNTING_INVALID_OPTION'; end if;
  v_active := coalesce((p_option->>'active')::boolean,true);
  if (p_option->>'id') is not null and (p_option->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'ACCOUNTING_INVALID_ID'; end if;
  v_id := (p_option->>'id')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('tc-accounting-ledger-v1',0));
  if v_kind='method' then
    if v_id is null then
      select id into v_id from public.tc_accounting_methods where lower(btrim(name))=lower(v_name);
      if v_id is null then
        insert into public.tc_accounting_methods(name,active,created_by,updated_by) values(v_name,v_active,p_actor,p_actor) returning to_jsonb(tc_accounting_methods.*) into v_new;
      else
        select to_jsonb(m) into v_new from public.tc_accounting_methods m where id=v_id;
        if (v_new->>'active')::boolean is distinct from v_active then raise exception 'ACCOUNTING_OPTION_EXISTS'; end if;
        return jsonb_build_object('option',v_new,'replayed',true);
      end if;
    else
      select to_jsonb(m) into v_old from public.tc_accounting_methods m where id=v_id;
      if v_old is null then raise exception 'ACCOUNTING_OPTION_NOT_FOUND'; end if;
      update public.tc_accounting_methods set name=v_name,active=v_active,updated_at=clock_timestamp(),updated_by=p_actor where id=v_id returning to_jsonb(tc_accounting_methods.*) into v_new;
    end if;
  else
    if v_id is null then
      select id into v_id from public.tc_accounting_categories where kind=v_kind and lower(btrim(name))=lower(v_name);
      if v_id is null then
        insert into public.tc_accounting_categories(kind,name,active,created_by,updated_by) values(v_kind,v_name,v_active,p_actor,p_actor) returning to_jsonb(tc_accounting_categories.*) into v_new;
      else
        select to_jsonb(c) into v_new from public.tc_accounting_categories c where id=v_id;
        if (v_new->>'active')::boolean is distinct from v_active then raise exception 'ACCOUNTING_OPTION_EXISTS'; end if;
        return jsonb_build_object('option',v_new,'replayed',true);
      end if;
    else
      select to_jsonb(c) into v_old from public.tc_accounting_categories c where id=v_id and kind=v_kind;
      if v_old is null then raise exception 'ACCOUNTING_OPTION_NOT_FOUND'; end if;
      update public.tc_accounting_categories set name=v_name,active=v_active,updated_at=clock_timestamp(),updated_by=p_actor where id=v_id returning to_jsonb(tc_accounting_categories.*) into v_new;
    end if;
  end if;
  insert into public.tc_accounting_option_audit(option_kind,option_id,actor,previous_state,next_state)
  values(v_kind,(v_new->>'id')::uuid,p_actor,v_old,v_new);
  return jsonb_build_object('option',v_new,'replayed',false);
exception when unique_violation then raise exception 'ACCOUNTING_OPTION_EXISTS';
end $fn$;

revoke all on function public.accounting_snapshot(uuid),public.accounting_post_entry(uuid,jsonb),public.accounting_void_entry(uuid,uuid,text),public.accounting_upsert_option(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.accounting_snapshot(uuid),public.accounting_post_entry(uuid,jsonb),public.accounting_void_entry(uuid,uuid,text),public.accounting_upsert_option(uuid,jsonb) to service_role;
comment on table public.tc_accounting_ledger_entries is 'Private manual cash ledger. Transfers and vault reallocations are not income/expense. Separate EUR/USD. Never invokes banks, payment processors, payroll or customer balances.';
