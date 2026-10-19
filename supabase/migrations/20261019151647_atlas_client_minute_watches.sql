begin;

-- The existing CRM balance is authoritative: FREE plus normal, as in
-- tc_client_state_snapshot. These tables record observations, never balances.
create table if not exists public.atlas_client_minute_watches (
 id uuid primary key default gen_random_uuid(),
 worker_id uuid not null references public.workers(id),
 client_id uuid not null references public.crm_clientes(id),
 threshold_minutes integer not null default 30 check(threshold_minutes between 0 and 1000),
 enabled boolean not null default true,
 low_episode_open boolean not null default false,
 episode integer not null default 0 check(episode>=0),
 last_free integer not null default 0 check(last_free>=0),
 last_normal integer not null default 0 check(last_normal>=0),
 evaluated_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(worker_id,client_id)
);
create index if not exists atlas_minute_watches_client on public.atlas_client_minute_watches(client_id,id);
create table if not exists public.atlas_client_minute_alerts (
 id uuid primary key default gen_random_uuid(),
 watch_id uuid not null references public.atlas_client_minute_watches(id),
 episode integer not null check(episode>0),
 threshold_minutes integer not null,
 free_at_trigger integer not null, normal_at_trigger integer not null,
 triggered_at timestamptz not null default now(), acknowledged_at timestamptz,
 resolved_at timestamptz,
 unique(watch_id,episode)
);
create index if not exists atlas_minute_alerts_open on public.atlas_client_minute_alerts(watch_id) where resolved_at is null;
alter table public.atlas_client_minute_watches enable row level security;
alter table public.atlas_client_minute_alerts enable row level security;
revoke all on public.atlas_client_minute_watches,public.atlas_client_minute_alerts from public,anon,authenticated;
grant select,insert,update on public.atlas_client_minute_watches,public.atlas_client_minute_alerts to service_role;

create schema if not exists atlas_private;
revoke all on schema atlas_private from public,anon,authenticated;
grant usage on schema atlas_private to service_role;

-- Always lock CRM before watches, in watch-ID order. Calls from the CRM trigger
-- already hold this client lock. Admin changes use the same order, preventing a
-- stale balance from reopening an alert after a concurrent purchase.
create or replace function atlas_private.evaluate_minute_watches(p_client uuid) returns void
language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
declare c public.crm_clientes; w public.atlas_client_minute_watches;
 f integer; n integer; total bigint; at_time timestamptz:=clock_timestamp();
begin
 select * into c from public.crm_clientes where id=p_client for update;
 if not found then return; end if;
 f:=greatest(0,coalesce(c.minutos_free_pendientes,0));
 n:=greatest(0,coalesce(c.minutos_normales_pendientes,0));
 total:=f::bigint+n::bigint;
 for w in select * from public.atlas_client_minute_watches where client_id=p_client order by id for update loop
  if total>w.threshold_minutes then
   update public.atlas_client_minute_alerts set resolved_at=at_time where watch_id=w.id and resolved_at is null;
   update public.atlas_client_minute_watches set low_episode_open=false,last_free=f,last_normal=n,evaluated_at=at_time where id=w.id;
  elsif w.enabled and not w.low_episode_open then
   update public.atlas_client_minute_watches set low_episode_open=true,episode=episode+1,last_free=f,last_normal=n,evaluated_at=at_time where id=w.id;
   insert into public.atlas_client_minute_alerts(watch_id,episode,threshold_minutes,free_at_trigger,normal_at_trigger,triggered_at)
    values(w.id,w.episode+1,w.threshold_minutes,f,n,at_time);
   insert into public.atlas_admin_audit(worker_id,action,entity_type,entity_id,detail)
    values(w.worker_id,'minute_watch_triggered','client_minute_watch',w.id::text,
      jsonb_build_object('client_id',p_client,'episode',w.episode+1,'threshold',w.threshold_minutes,'minutes_total',total));
  else
   update public.atlas_client_minute_watches set last_free=f,last_normal=n,evaluated_at=at_time where id=w.id;
  end if;
 end loop;
end $$;
revoke all on function atlas_private.evaluate_minute_watches(uuid) from public,anon,authenticated;
grant execute on function atlas_private.evaluate_minute_watches(uuid) to service_role;

-- A private trigger-only definer is necessary because CRM updates can originate
-- from authorized browser/RPC roles which must never gain access to admin watches.
-- It accepts no caller parameters and reads the real changed CRM row only.
create or replace function atlas_private.on_client_minutes_changed() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
 if exists(select 1 from public.atlas_client_minute_watches where client_id=new.id) then
  perform atlas_private.evaluate_minute_watches(new.id);
 end if;
 return new;
end $$;
revoke all on function atlas_private.on_client_minutes_changed() from public,anon,authenticated,service_role;
drop trigger if exists trg_atlas_client_minutes_changed on public.crm_clientes;
create trigger trg_atlas_client_minutes_changed
 after update of minutos_free_pendientes,minutos_normales_pendientes on public.crm_clientes
 for each row when (old.minutos_free_pendientes is distinct from new.minutos_free_pendientes
                    or old.minutos_normales_pendientes is distinct from new.minutos_normales_pendientes)
 execute function atlas_private.on_client_minutes_changed();

create or replace function public.tc_atlas_minute_watches(p_user uuid) returns jsonb
language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare actor uuid:=public.tc_atlas_admin(p_user); rows jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',w.id,'clientId',w.client_id,'clientName',trim(concat_ws(' ',c.nombre,c.apellido)),
  'threshold',w.threshold_minutes,'enabled',w.enabled,
  'balance',jsonb_build_object('state','known','free',greatest(0,coalesce(c.minutos_free_pendientes,0)),
    'normal',greatest(0,coalesce(c.minutos_normales_pendientes,0)),
    'total',greatest(0,coalesce(c.minutos_free_pendientes,0))::bigint+greatest(0,coalesce(c.minutos_normales_pendientes,0))::bigint,
    'observedAt',w.evaluated_at),
  'alert',case when a.id is not null and w.enabled then jsonb_build_object('id',a.id,
    'triggeredAt',a.triggered_at,'acknowledgedAt',a.acknowledged_at,
    'totalAtTrigger',a.free_at_trigger::bigint+a.normal_at_trigger::bigint) else null end
 ) order by w.created_at desc,w.id),'[]'::jsonb) into rows
 from public.atlas_client_minute_watches w join public.crm_clientes c on c.id=w.client_id
 left join public.atlas_client_minute_alerts a on a.watch_id=w.id and a.episode=w.episode and a.resolved_at is null
 where w.worker_id=actor;
 return jsonb_build_object('watches',rows,'unreadCount',(select count(*) from jsonb_array_elements(rows) r where r->'alert'->>'id' is not null and r->'alert'->>'acknowledgedAt' is null));
end $$;

create or replace function public.tc_atlas_upsert_minute_watch(p_user uuid,p_client uuid,p_threshold integer default 30,p_enabled boolean default true) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid:=public.tc_atlas_admin(p_user); w public.atlas_client_minute_watches; prior public.atlas_client_minute_watches;
begin
 if p_threshold is null or p_threshold not between 0 and 1000 or p_enabled is null then raise exception 'INVALID_WATCH'; end if;
 perform 1 from public.crm_clientes where id=p_client for update;
 if not found then raise exception 'CLIENT_NOT_FOUND'; end if;
 select * into prior from public.atlas_client_minute_watches where worker_id=actor and client_id=p_client for update;
 insert into public.atlas_client_minute_watches(worker_id,client_id,threshold_minutes,enabled)
 values(actor,p_client,p_threshold,p_enabled)
 on conflict(worker_id,client_id) do update set threshold_minutes=excluded.threshold_minutes,enabled=excluded.enabled,
  updated_at=case when atlas_client_minute_watches.threshold_minutes is distinct from excluded.threshold_minutes or atlas_client_minute_watches.enabled is distinct from excluded.enabled then clock_timestamp() else atlas_client_minute_watches.updated_at end
 returning * into w;
 if prior.id is null or prior.threshold_minutes is distinct from p_threshold or prior.enabled is distinct from p_enabled then
  insert into public.atlas_admin_audit(worker_id,action,entity_type,entity_id,detail)
   values(actor,'minute_watch_configured','client_minute_watch',w.id::text,
    jsonb_build_object('client_id',p_client,'threshold',p_threshold,'enabled',p_enabled));
 end if;
 perform atlas_private.evaluate_minute_watches(p_client);
 return public.tc_atlas_minute_watches(p_user);
end $$;

create or replace function public.tc_atlas_set_minute_watch_enabled(p_user uuid,p_watch uuid,p_enabled boolean) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid:=public.tc_atlas_admin(p_user); client uuid; w public.atlas_client_minute_watches;
begin
 if p_enabled is null then raise exception 'INVALID_WATCH'; end if;
 select client_id into client from public.atlas_client_minute_watches where id=p_watch and worker_id=actor;
 if not found then raise exception 'WATCH_NOT_FOUND'; end if;
 perform 1 from public.crm_clientes where id=client for update;
 select * into w from public.atlas_client_minute_watches where id=p_watch and worker_id=actor for update;
 if not found then raise exception 'WATCH_NOT_FOUND'; end if;
 if w.enabled is distinct from p_enabled then
  update public.atlas_client_minute_watches set enabled=p_enabled,updated_at=clock_timestamp() where id=w.id;
  insert into public.atlas_admin_audit(worker_id,action,entity_type,entity_id,detail)
   values(actor,'minute_watch_enabled','client_minute_watch',w.id::text,jsonb_build_object('enabled',p_enabled));
 end if;
 perform atlas_private.evaluate_minute_watches(client);
 return public.tc_atlas_minute_watches(p_user);
end $$;

create or replace function public.tc_atlas_ack_minute_alert(p_user uuid,p_alert uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor uuid:=public.tc_atlas_admin(p_user); a public.atlas_client_minute_alerts;
begin
 select al.* into a from public.atlas_client_minute_alerts al join public.atlas_client_minute_watches w on w.id=al.watch_id
  where al.id=p_alert and w.worker_id=actor for update of al;
 if not found then raise exception 'ALERT_NOT_FOUND'; end if;
 if a.acknowledged_at is null then
  update public.atlas_client_minute_alerts set acknowledged_at=clock_timestamp() where id=a.id;
  insert into public.atlas_admin_audit(worker_id,action,entity_type,entity_id,detail)
   values(actor,'minute_alert_acknowledged','client_minute_alert',a.id::text,jsonb_build_object('watch_id',a.watch_id));
 end if;
 return public.tc_atlas_minute_watches(p_user);
end $$;

revoke all on function public.tc_atlas_minute_watches(uuid),public.tc_atlas_upsert_minute_watch(uuid,uuid,integer,boolean),
 public.tc_atlas_set_minute_watch_enabled(uuid,uuid,boolean),public.tc_atlas_ack_minute_alert(uuid,uuid) from public,anon,authenticated;
grant execute on function public.tc_atlas_minute_watches(uuid),public.tc_atlas_upsert_minute_watch(uuid,uuid,integer,boolean),
 public.tc_atlas_set_minute_watch_enabled(uuid,uuid,boolean),public.tc_atlas_ack_minute_alert(uuid,uuid) to service_role;
commit;
