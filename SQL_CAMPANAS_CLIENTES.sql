-- Centro de campañas. Ejecutar una vez en Supabase SQL Editor; se puede repetir.
-- Reutiliza CRM, preferencias de promociones, notificaciones y suscripciones push.
-- No crea campañas ni envía mensajes. No cambia las políticas de tablas existentes.
begin;
create table if not exists public.tc_client_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 100),
  message text not null check (char_length(message) between 1 and 1500),
  image_url text not null default '', action_url text not null default '',
  expires_at timestamptz not null, scheduled_at timestamptz,
  channels text[] not null check (cardinality(channels)>0 and channels <@ array['panel','push']::text[]),
  audience jsonb not null,
  status text not null default 'draft' check(status in ('draft','scheduled','running','completed','cancelled')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.tc_client_campaign_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.tc_client_campaigns(id) on delete cascade,
  client_id uuid not null references public.crm_clientes(id) on delete cascade,
  channel text not null check(channel in ('panel','push')),
  target_key text not null,
  state text not null default 'pending' check(state in ('pending','processing','sent','failed','skipped','uncertain')),
  attempt_token uuid, attempts integer not null default 0,
  started_at timestamptz, sent_at timestamptz, opened_at timestamptz,
  error text, created_at timestamptz not null default now(),
  unique(campaign_id,client_id,channel,target_key)
);
alter table public.tc_client_campaigns enable row level security;
alter table public.tc_client_campaign_deliveries enable row level security;
revoke all on public.tc_client_campaigns,public.tc_client_campaign_deliveries from anon,authenticated;
grant all on public.tc_client_campaigns,public.tc_client_campaign_deliveries to service_role;
create index if not exists tc_campaign_due_idx on public.tc_client_campaigns(scheduled_at) where status in ('scheduled','running');
create index if not exists tc_campaign_delivery_queue_idx on public.tc_client_campaign_deliveries(campaign_id,state,created_at);
create index if not exists tc_campaign_delivery_client_idx on public.tc_client_campaign_deliveries(client_id);
create index if not exists tc_campaign_creator_idx on public.tc_client_campaigns(created_by);
alter table public.cliente_notificaciones add column if not exists campaign_id uuid references public.tc_client_campaigns(id);
alter table public.cliente_notificaciones add column if not exists expires_at timestamptz;
create index if not exists cliente_notificaciones_campaign_idx on public.cliente_notificaciones(campaign_id) where campaign_id is not null;

create or replace function public.tc_campaign_audience(a jsonb)
returns table(client_id uuid, full_name text, country text, eligible boolean, push_devices bigint)
language sql stable security invoker set search_path=public,pg_temp as $$
 select c.id, trim(coalesce(c.nombre,'')||' '||coalesce(c.apellido,'')),coalesce(c.pais,''),
   coalesce(p.settings->'promotions'->>'enabled','false')='true',
   (select count(distinct s.endpoint) from cliente_push_subscriptions s where s.cliente_id=c.id)
 from crm_clientes c
 left join crm_client_notification_preferences p on p.client_id=c.id
 where c.auth_user_id is not null
   and (a->>'mode'<>'selected' or c.id::text in (select jsonb_array_elements_text(a->'client_ids')))
   and (a->>'mode'<>'segment' or coalesce(a->>'country','')='' or lower(c.pais)=lower(a->>'country'))
   and (a->>'mode'<>'segment' or a->>'inactive_days' is null or
     coalesce(c.ultima_actividad_at,c.ultimo_acceso_at,c.created_at)<=now()-make_interval(days=>(a->>'inactive_days')::integer))
$$;
create or replace function public.tc_campaign_preview(a jsonb, search_text text default '', page_offset integer default 0)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 with recipients as (select * from tc_campaign_audience(a))
 select jsonb_build_object(
  'matched',(select count(*) from recipients),
  'eligible',(select count(*) from recipients where eligible),
  'push_devices',(select coalesce(sum(push_devices),0) from recipients where eligible),
  'countries',(select coalesce(jsonb_agg(pais order by pais),'[]') from (select distinct pais from crm_clientes where pais is not null and pais<>'') countries),
  'search_total',(select count(*) from recipients where search_text='' or position(lower(search_text) in lower(full_name))>0),
  'sample',(select coalesce(jsonb_agg(r),'[]') from (select * from recipients where search_text='' or position(lower(search_text) in lower(full_name))>0 order by full_name,client_id limit 50 offset greatest(page_offset,0)) r))
$$;
create or replace function public.tc_campaign_save(p_id uuid, doc jsonb, actor uuid)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare saved uuid;
begin
 insert into tc_client_campaigns(id,title,message,image_url,action_url,expires_at,channels,audience,created_by)
 values(p_id,doc->>'title',doc->>'message',doc->>'image_url',doc->>'action_url',(doc->>'expires_at')::timestamptz,
   array(select jsonb_array_elements_text(doc->'channels')),doc->'audience',actor)
 on conflict(id) do update set title=excluded.title,message=excluded.message,image_url=excluded.image_url,
   action_url=excluded.action_url,expires_at=excluded.expires_at,channels=excluded.channels,audience=excluded.audience,updated_at=now()
 where tc_client_campaigns.status='draft' returning id into saved;
 if saved is null then raise exception 'La campaña ya está programada y no se puede editar.'; end if;
 return saved;
end $$;
create or replace function public.tc_campaign_schedule(p_id uuid, send_at timestamptz)
returns integer language plpgsql security invoker set search_path=public,pg_temp as $$
declare c tc_client_campaigns; total integer;
begin
 select * into c from tc_client_campaigns where id=p_id for update;
 if not found then raise exception 'Campaña no encontrada.'; end if;
 if c.status<>'draft' then return (select count(*)::integer from tc_client_campaign_deliveries where campaign_id=p_id); end if;
 if send_at is null or c.expires_at<=greatest(now(),send_at) then raise exception 'La campaña caduca antes del envío.'; end if;
 insert into tc_client_campaign_deliveries(campaign_id,client_id,channel,target_key)
 select c.id,r.client_id,'panel','panel' from tc_campaign_audience(c.audience) r
 where r.eligible and 'panel'=any(c.channels)
 union all
 select c.id,r.client_id,'push',s.id::text from tc_campaign_audience(c.audience) r
 join lateral (select distinct on (endpoint) id from cliente_push_subscriptions where cliente_id=r.client_id order by endpoint,created_at desc,id) s on true
 where r.eligible and 'push'=any(c.channels)
 on conflict do nothing;
 select count(*) into total from tc_client_campaign_deliveries where campaign_id=p_id;
 if total=0 then raise exception 'No hay destinatarios con permiso y canal disponible.'; end if;
 update tc_client_campaigns set status='scheduled',scheduled_at=greatest(now(),send_at),updated_at=now() where id=p_id;
 return total;
end $$;
create or replace function public.tc_campaign_claim(batch_size integer default 30, only_campaign uuid default null)
returns setof public.tc_client_campaign_deliveries language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 -- Un envío push interrumpido no se reintenta automáticamente: puede haber sido aceptado.
 update tc_client_campaign_deliveries set state='uncertain',error='El proceso se interrumpió; no se reenvía para evitar duplicados.'
 where state='processing' and started_at<now()-interval '10 minutes';
 update tc_client_campaign_deliveries d set state='skipped',error='Campaña caducada o cancelada.'
 from tc_client_campaigns c where c.id=d.campaign_id and d.state='pending' and (c.expires_at<=now() or c.status='cancelled');
 return query with ready as (
  select d.id from tc_client_campaign_deliveries d join tc_client_campaigns c on c.id=d.campaign_id
  where d.state='pending' and c.status in ('scheduled','running') and c.scheduled_at<=now() and c.expires_at>now()
    and (only_campaign is null or c.id=only_campaign)
  order by c.scheduled_at,d.created_at,d.id limit least(greatest(batch_size,1),50) for update of d skip locked
 ) update tc_client_campaign_deliveries d set state='processing',attempts=attempts+1,attempt_token=gen_random_uuid(),started_at=now()
 from ready where d.id=ready.id returning d.*;
end $$;
create or replace function public.tc_campaign_prepare(delivery_id uuid, token uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare d tc_client_campaign_deliveries; c tc_client_campaigns; allowed boolean;
begin
 select * into d from tc_client_campaign_deliveries where id=delivery_id and state='processing' and attempt_token=token for update;
 if not found then return null; end if;
 select * into c from tc_client_campaigns where id=d.campaign_id for share;
 select exists(select 1 from crm_clientes cl
   join crm_client_notification_preferences p on p.client_id=cl.id
   where cl.id=d.client_id and cl.auth_user_id is not null and p.settings->'promotions'->>'enabled'='true') into allowed;
 if not allowed or c.status='cancelled' or c.expires_at<=now() then
   update tc_client_campaign_deliveries set state='skipped',error='Sin permiso, cuenta no disponible o campaña caducada/cancelada.' where id=d.id;
   return null;
 end if;
 if d.channel='panel' then
   insert into cliente_notificaciones(id,cliente_id,titulo,mensaje,tipo,meta,leida,campaign_id,expires_at)
   values(d.id,d.client_id,c.title,c.message,'campaign',jsonb_build_object('campaign_id',c.id,'image_url',c.image_url,'url','/cliente/campanas/'||c.id||'?delivery='||d.id,'expires_at',c.expires_at),false,c.id,c.expires_at)
   on conflict(id) do nothing;
   update tc_client_campaign_deliveries set state='sent',sent_at=now(),error=null where id=d.id;
   return null;
 end if;
 return to_jsonb(c);
end $$;
create or replace function public.tc_campaign_finish()
returns void language sql security invoker set search_path=public,pg_temp as $$
 update tc_client_campaigns c set status=case when exists(select 1 from tc_client_campaign_deliveries d where d.campaign_id=c.id and d.state in ('pending','processing')) then 'running' else 'completed' end,updated_at=now()
 where c.status in ('scheduled','running') and c.scheduled_at<=now()
$$;
create or replace function public.tc_campaign_action(p_id uuid, action text)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare c tc_client_campaigns;
begin
 select * into c from tc_client_campaigns where id=p_id for update;
 if not found then raise exception 'Campaña no encontrada.'; end if;
 if action='cancel' then
   update tc_client_campaigns set status='cancelled',updated_at=now() where id=p_id;
   update tc_client_campaign_deliveries set state='skipped',error='Cancelada por administración.' where campaign_id=p_id and state='pending';
   update cliente_notificaciones set expires_at=now() where campaign_id=p_id;
 elsif action='retry' and c.status in ('completed','running') and c.expires_at>now() then
   update tc_client_campaign_deliveries set state='pending',error=null,attempt_token=null where campaign_id=p_id and state='failed';
   update tc_client_campaigns set status='running',updated_at=now() where id=p_id;
 else raise exception 'Esta acción no está disponible para la campaña.';
 end if;
end $$;
create or replace function public.tc_campaign_overview()
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(row order by row.created_at desc),'[]') from (
 select c.*, (select jsonb_build_object('total',count(*),'clients',count(distinct d.client_id),
   'pending',count(*) filter(where state in ('pending','processing')),'sent',count(*) filter(where state='sent'),
   'failed',count(*) filter(where state='failed'),'skipped',count(*) filter(where state='skipped'),
   'uncertain',count(*) filter(where state='uncertain'),'opened',count(distinct client_id) filter(where opened_at is not null),
   'panel_sent',count(*) filter(where state='sent' and channel='panel'),'push_sent',count(*) filter(where state='sent' and channel='push'))
   from tc_client_campaign_deliveries d where d.campaign_id=c.id) as results
 from tc_client_campaigns c order by c.created_at desc limit 100) row
$$;
create or replace function public.tc_campaign_preference(p_client uuid, actor uuid, enabled boolean)
returns void language sql security invoker set search_path=public,pg_temp as $$
 insert into crm_client_notification_preferences(client_id,business,settings,updated_by_user_id)
 select id,coalesce(origen,'celestial'),jsonb_build_object('promotions',jsonb_build_object('enabled',enabled,'timing','according_to_preferences')),actor from crm_clientes where id=p_client and auth_user_id=actor
 on conflict(client_id) do update set settings=jsonb_set(crm_client_notification_preferences.settings,'{promotions}',
   coalesce(crm_client_notification_preferences.settings->'promotions','{}'::jsonb)||jsonb_build_object('enabled',enabled)),updated_by_user_id=actor,updated_at=now()
$$;
-- Funciones internas: jamás ejecutables desde un navegador con anon/authenticated.
revoke all on function public.tc_campaign_audience(jsonb),public.tc_campaign_preview(jsonb,text,integer),public.tc_campaign_save(uuid,jsonb,uuid),public.tc_campaign_schedule(uuid,timestamptz),public.tc_campaign_claim(integer,uuid),public.tc_campaign_prepare(uuid,uuid),public.tc_campaign_finish(),public.tc_campaign_action(uuid,text),public.tc_campaign_overview(),public.tc_campaign_preference(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.tc_campaign_audience(jsonb),public.tc_campaign_preview(jsonb,text,integer),public.tc_campaign_save(uuid,jsonb,uuid),public.tc_campaign_schedule(uuid,timestamptz),public.tc_campaign_claim(integer,uuid),public.tc_campaign_prepare(uuid,uuid),public.tc_campaign_finish(),public.tc_campaign_action(uuid,text),public.tc_campaign_overview(),public.tc_campaign_preference(uuid,uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;
