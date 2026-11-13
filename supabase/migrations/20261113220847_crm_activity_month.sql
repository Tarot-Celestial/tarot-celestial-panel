-- One activity month per client. Reads actual business events, never login timestamps.
-- Does not write calls, purchases, rewards, balances or the label catalogue history.
begin;

create table if not exists public.crm_client_activity_month (
  cliente_id uuid primary key references public.crm_clientes(id) on delete cascade,
  last_activity_at timestamptz not null,
  source text not null,
  source_id uuid,
  updated_at timestamptz not null default now()
);
create table if not exists public.crm_client_month_tag_audit (
  id bigint generated always as identity primary key,
  cliente_id uuid not null references public.crm_clientes(id) on delete cascade,
  old_labels text[] not null,
  new_label text not null,
  activity_at timestamptz not null,
  source text not null,
  source_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists crm_client_month_tag_audit_client_idx
  on public.crm_client_month_tag_audit(cliente_id, created_at desc);
alter table public.crm_client_activity_month enable row level security;
alter table public.crm_client_month_tag_audit enable row level security;
revoke all on public.crm_client_activity_month, public.crm_client_month_tag_audit from public, anon, authenticated;
grant select, insert, update, delete on public.crm_client_activity_month to service_role;
grant select, insert on public.crm_client_month_tag_audit to service_role;
grant usage, select on sequence public.crm_client_month_tag_audit_id_seq to service_role;
create policy crm_activity_month_service on public.crm_client_activity_month for all to service_role using(true) with check(true);
create policy crm_month_tag_audit_service on public.crm_client_month_tag_audit for all to service_role using(true) with check(true);

create or replace function public.tc_crm_is_month_tag(p_label text) returns boolean
language sql immutable security invoker set search_path = '' as $$
  select trim(coalesce(p_label,'')) ~* '^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)([[:space:]_.\/-]*20[0-9]{2})?$';
$$;

create or replace function public.tc_crm_apply_activity_month(p_cliente_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  activity public.crm_client_activity_month%rowtype;
  local_date date;
  month_name text;
  month_id uuid;
  old_names text[];
  names text[] := array['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
begin
  -- The same client lock is taken before manual tag replacement and event handling.
  perform 1 from public.crm_clientes where id=p_cliente_id for update;
  if not found then return; end if;
  select * into activity from public.crm_client_activity_month where cliente_id=p_cliente_id;
  if not found then return; end if;
  local_date := (activity.last_activity_at at time zone 'Europe/Madrid')::date;
  month_name := names[extract(month from local_date)::integer] || ' ' || extract(year from local_date)::integer;
  select id into month_id from public.crm_etiquetas where lower(nombre)=lower(month_name);
  if month_id is null then
    insert into public.crm_etiquetas(nombre) values(month_name) on conflict do nothing;
    select id into month_id from public.crm_etiquetas where lower(nombre)=lower(month_name);
  end if;
  -- A hidden month must be selectable in the CRM filter.
  update public.crm_etiquetas set activa=true where id=month_id and activa is distinct from true;
  select coalesce(array_agg(e.nombre order by e.nombre),'{}'::text[]) into old_names
  from public.crm_cliente_etiquetas ce join public.crm_etiquetas e on e.id=ce.etiqueta_id
  where ce.cliente_id=p_cliente_id and public.tc_crm_is_month_tag(e.nombre);
  if cardinality(old_names)=1 and exists(
    select 1 from public.crm_cliente_etiquetas where cliente_id=p_cliente_id and etiqueta_id=month_id
  ) then return; end if;
  delete from public.crm_cliente_etiquetas ce using public.crm_etiquetas e
  where ce.cliente_id=p_cliente_id and ce.etiqueta_id=e.id
    and ce.etiqueta_id<>month_id and public.tc_crm_is_month_tag(e.nombre);
  insert into public.crm_cliente_etiquetas(cliente_id,etiqueta_id) values(p_cliente_id,month_id)
    on conflict(cliente_id,etiqueta_id) do nothing;
  insert into public.crm_client_month_tag_audit(cliente_id,old_labels,new_label,activity_at,source,source_id)
  values(p_cliente_id,old_names,month_name,activity.last_activity_at,activity.source,activity.source_id);
end;
$$;

create or replace function public.tc_crm_record_activity(
  p_cliente_id uuid, p_at timestamptz, p_source text, p_source_id uuid
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_cliente_id is null or p_at is null or p_at>now() then return; end if;
  perform 1 from public.crm_clientes where id=p_cliente_id for update;
  if not found then return; end if;
  insert into public.crm_client_activity_month(cliente_id,last_activity_at,source,source_id)
  values(p_cliente_id,p_at,p_source,p_source_id)
  on conflict(cliente_id) do update set
    last_activity_at=excluded.last_activity_at,source=excluded.source,source_id=excluded.source_id,updated_at=now()
  where excluded.last_activity_at>crm_client_activity_month.last_activity_at;
  -- Replayed or older events may repair a stale label, but cannot move the month back.
  perform public.tc_crm_apply_activity_month(p_cliente_id);
end;
$$;

create or replace function public.tc_crm_activity_event() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare client_id uuid; event_at timestamptz;
begin
  if tg_table_name='rendimiento_llamadas' then
    select id into client_id from public.crm_clientes where id::text=btrim(new.cliente_id);
    event_at := coalesce(new.fecha_hora,new.created_at);
    perform public.tc_crm_record_activity(client_id,event_at,'call',new.id);
  elsif tg_table_name='crm_cliente_pagos' then
    if new.estado='completed' and new.importe>0 then
      perform public.tc_crm_record_activity(new.cliente_id,new.created_at,'purchase',new.id);
    end if;
  elsif tg_table_name='crm_client_capture_audit' then
    if new.action='capture_confirmed' then
      perform public.tc_crm_record_activity(new.client_id,new.created_at,'capture_confirmed',new.id);
    end if;
  elsif tg_table_name='captacion_leads' then
    if new.estado='captado' then
      if tg_op='INSERT' then event_at:=coalesce(new.closed_at,new.updated_at,new.created_at);
      elsif old.estado is distinct from new.estado then event_at:=coalesce(new.closed_at,new.updated_at,now());
      else return new; end if;
      perform public.tc_crm_record_activity(new.cliente_id,event_at,'captacion',new.id);
    end if;
  end if;
  return new;
end;
$$;

-- Run after existing capture triggers, which acquire capture advisory locks before client rows.
create trigger zz_tc_crm_month_call after insert or update of cliente_id,fecha_hora on public.rendimiento_llamadas
  for each row execute function public.tc_crm_activity_event();
create trigger zz_tc_crm_month_purchase after insert or update of estado on public.crm_cliente_pagos
  for each row execute function public.tc_crm_activity_event();
create trigger tc_crm_month_capture_confirmed after insert on public.crm_client_capture_audit
  for each row when (new.action='capture_confirmed') execute function public.tc_crm_activity_event();
create trigger tc_crm_month_captacion after insert or update of estado on public.captacion_leads
  for each row execute function public.tc_crm_activity_event();

-- A stale browser, old deployment or manual label save cannot undo the business month.
-- Deferred so bulk delete+insert remains valid; repair is a no-op once consistent.
create or replace function public.tc_crm_guard_activity_month() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op in ('DELETE','UPDATE') then perform public.tc_crm_apply_activity_month(old.cliente_id); end if;
  if tg_op='INSERT' then perform public.tc_crm_apply_activity_month(new.cliente_id);
  elsif tg_op='UPDATE' and new.cliente_id is distinct from old.cliente_id then
    perform public.tc_crm_apply_activity_month(new.cliente_id);
  end if;
  return null;
end;
$$;
create constraint trigger tc_crm_month_tag_guard after insert or update or delete on public.crm_cliente_etiquetas
  deferrable initially deferred for each row execute function public.tc_crm_guard_activity_month();

create or replace function public.tc_crm_replace_client_tags(p_cliente_id uuid,p_etiquetas uuid[]) returns void
language plpgsql security invoker set search_path = '' as $$
declare has_activity boolean;
begin
  perform 1 from public.crm_clientes where id=p_cliente_id for update;
  if not found then raise exception 'CLIENT_NOT_FOUND'; end if;
  if exists(select 1 from unnest(coalesce(p_etiquetas,'{}'::uuid[])) x(id)
    where x.id is null or not exists(select 1 from public.crm_etiquetas e where e.id=x.id))
  then raise exception 'INVALID_TAG'; end if;
  select exists(select 1 from public.crm_client_activity_month where cliente_id=p_cliente_id) into has_activity;
  delete from public.crm_cliente_etiquetas ce using public.crm_etiquetas e
  where ce.cliente_id=p_cliente_id and e.id=ce.etiqueta_id
    and not (has_activity and public.tc_crm_is_month_tag(e.nombre))
    and not(ce.etiqueta_id=any(coalesce(p_etiquetas,'{}'::uuid[])));
  insert into public.crm_cliente_etiquetas(cliente_id,etiqueta_id)
  select p_cliente_id,e.id from public.crm_etiquetas e where e.id=any(coalesce(p_etiquetas,'{}'::uuid[]))
    and not(has_activity and public.tc_crm_is_month_tag(e.nombre))
  on conflict(cliente_id,etiqueta_id) do nothing;
  perform public.tc_crm_apply_activity_month(p_cliente_id);
end;
$$;

revoke all on function public.tc_crm_is_month_tag(text), public.tc_crm_apply_activity_month(uuid),
  public.tc_crm_record_activity(uuid,timestamptz,text,uuid), public.tc_crm_activity_event(),
  public.tc_crm_guard_activity_month(),public.tc_crm_replace_client_tags(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.tc_crm_is_month_tag(text), public.tc_crm_apply_activity_month(uuid),
  public.tc_crm_record_activity(uuid,timestamptz,text,uuid),public.tc_crm_activity_event(),
  public.tc_crm_guard_activity_month(),public.tc_crm_replace_client_tags(uuid,uuid[]) to service_role;

-- Reconcile only clients active this month, based on source records, not updated_at/login.
-- No fabricated purchases/calls, no removal of old clients from their historic segments.
do $$
declare activity_row record; before_client jsonb;
  month_start timestamptz := date_trunc('month',now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';
begin
  for activity_row in
    with events as (
      select c.id cliente_id,coalesce(r.fecha_hora,r.created_at) event_at,'call'::text source,r.id source_id
      from public.rendimiento_llamadas r join public.crm_clientes c on c.id::text=btrim(r.cliente_id)
      where coalesce(r.fecha_hora,r.created_at)>=month_start and coalesce(r.fecha_hora,r.created_at)<=now()
      union all
      select cliente_id,created_at,'purchase',id from public.crm_cliente_pagos
      where estado='completed' and importe>0 and created_at>=month_start and created_at<=now()
      union all
      select id,captured_at,'capture',id from public.crm_clientes where captured_at>=month_start and captured_at<=now()
      union all
      select client_id,created_at,'capture_confirmed',id from public.crm_client_capture_audit
      where action='capture_confirmed' and created_at>=month_start and created_at<=now()
      union all
      select cliente_id,coalesce(closed_at,updated_at,created_at),'captacion',id from public.captacion_leads
      where estado='captado' and coalesce(closed_at,updated_at,created_at)>=month_start
        and coalesce(closed_at,updated_at,created_at)<=now()
    )
    select distinct on(cliente_id) * from events where cliente_id is not null order by cliente_id,event_at desc,source,source_id
  loop
    select to_jsonb(c) into before_client from public.crm_clientes c where c.id=activity_row.cliente_id for update;
    perform public.tc_crm_record_activity(activity_row.cliente_id,activity_row.event_at,activity_row.source,activity_row.source_id);
    if before_client is distinct from (select to_jsonb(c) from public.crm_clientes c where c.id=activity_row.cliente_id) then
      raise exception 'CRM_MONTH_REPAIR_CHANGED_CLIENT_DATA';
    end if;
  end loop;
end;
$$;
set constraints tc_crm_month_tag_guard immediate;
commit;
