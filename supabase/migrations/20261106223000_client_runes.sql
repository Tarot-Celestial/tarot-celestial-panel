-- Individual display entitlement; never grants balances, reservations or rank.
-- Requires tc_has_admin_access from the preceding delegated access migration.
create table if not exists public.client_runes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null unique references public.crm_clientes(id),
  enabled boolean not null default false,
  title text not null check (char_length(btrim(title)) between 1 and 100),
  benefit text not null default '' check (char_length(benefit) <= 2000),
  created_by uuid not null references public.workers(id),
  updated_by uuid not null references public.workers(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint client_runes_active_benefit check (not enabled or char_length(btrim(benefit)) > 0)
);
create table if not exists public.client_rune_events (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  cliente_id uuid not null references public.crm_clientes(id),
  actor_worker_id uuid not null references public.workers(id),
  request jsonb not null,
  before_state jsonb,
  after_state jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists client_rune_events_client_time on public.client_rune_events(cliente_id, created_at desc);
create index if not exists client_rune_events_actor on public.client_rune_events(actor_worker_id);
create index if not exists client_runes_created_by on public.client_runes(created_by);
create index if not exists client_runes_updated_by on public.client_runes(updated_by);
alter table public.client_runes enable row level security;
alter table public.client_rune_events enable row level security;
revoke all on public.client_runes, public.client_rune_events from public, anon, authenticated;
grant select, insert, update, delete on public.client_runes, public.client_rune_events to service_role;

create or replace function public.tc_admin_set_client_rune(
  p_cliente_id uuid, p_enabled boolean, p_title text, p_benefit text,
  p_expected_updated_at timestamptz, p_operation_id uuid,
  p_actor_worker_id uuid, p_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_old public.client_runes%rowtype;
  v_new public.client_runes%rowtype;
  v_event public.client_rune_events%rowtype;
  v_request jsonb;
begin
  if not coalesce(public.tc_has_admin_access(p_actor_user_id), false)
    or not exists(select 1 from public.workers where id=p_actor_worker_id and user_id=p_actor_user_id and is_active) then
    raise exception 'RUNE_FORBIDDEN';
  end if;
  if p_cliente_id is null or p_operation_id is null or p_enabled is null
    or p_title is null or char_length(btrim(p_title)) not between 1 and 100
    or p_benefit is null or char_length(btrim(p_benefit)) > 2000
    or (p_enabled and btrim(p_benefit)='') then raise exception 'RUNE_INVALID_INPUT'; end if;
  v_request := jsonb_build_object('enabled',p_enabled,'title',btrim(p_title),'benefit',btrim(p_benefit),
    'expected_updated_at',p_expected_updated_at,'actor_user_id',p_actor_user_id);
  -- Lock only the selected ficha while the grant and its audit are committed.
  perform 1 from public.crm_clientes where id=p_cliente_id for update;
  if not found then raise exception 'RUNE_CLIENT_NOT_FOUND'; end if;
  select * into v_event from public.client_rune_events where operation_id=p_operation_id;
  if found then
    if v_event.cliente_id is distinct from p_cliente_id or v_event.actor_worker_id is distinct from p_actor_worker_id or v_event.request is distinct from v_request then
      raise exception 'RUNE_OPERATION_REUSED';
    end if;
    return v_event.after_state;
  end if;
  select * into v_old from public.client_runes where cliente_id=p_cliente_id for update;
  if v_old.updated_at is distinct from p_expected_updated_at then raise exception 'RUNE_CONFLICT'; end if;
  insert into public.client_runes(cliente_id,enabled,title,benefit,created_by,updated_by)
    values(p_cliente_id,p_enabled,btrim(p_title),btrim(p_benefit),p_actor_worker_id,p_actor_worker_id)
  on conflict(cliente_id) do update set enabled=excluded.enabled,title=excluded.title,benefit=excluded.benefit,
    updated_by=excluded.updated_by,updated_at=greatest(clock_timestamp(),client_runes.updated_at + interval '1 microsecond')
  returning * into v_new;
  insert into public.client_rune_events(operation_id,cliente_id,actor_worker_id,request,before_state,after_state)
    values(p_operation_id,p_cliente_id,p_actor_worker_id,v_request,
      case when v_old.id is null then null else to_jsonb(v_old) end,to_jsonb(v_new));
  return to_jsonb(v_new);
end;
$$;
revoke all on function public.tc_admin_set_client_rune(uuid,boolean,text,text,timestamptz,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.tc_admin_set_client_rune(uuid,boolean,text,text,timestamptz,uuid,uuid,uuid) to service_role;
comment on table public.client_runes is 'Individually enabled rune and descriptive advantage. Does not confer other entitlements.';
notify pgrst, 'reload schema';
