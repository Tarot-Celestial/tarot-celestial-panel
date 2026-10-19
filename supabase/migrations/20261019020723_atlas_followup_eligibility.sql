begin;

-- A completed/cancelled job does not erase a promise to contact the client later.
-- The most recent recorded outcome supersedes older outcomes; a subsequent
-- positive completed purchase resolves that sales follow-up. History stays intact.
create or replace view public.atlas_current_followups with (security_invoker=true) as
 select latest.id,latest.job_id,latest.worker_id,latest.client_id,latest.channel,
   latest.next_contact_at,latest.created_at
 from (
   select distinct on (o.client_id) o.id,o.job_id,o.worker_id,o.client_id,o.channel,
     o.outcome,o.next_contact_at,o.created_at
   from public.atlas_admin_job_outcomes o
   order by o.client_id,o.created_at desc,o.id desc
 ) latest
 where latest.outcome='followup' and latest.next_contact_at is not null
   and not exists(select 1 from public.crm_cliente_pagos p where p.cliente_id=latest.client_id
     and p.estado='completed' and p.importe>0 and p.created_at>=latest.created_at);
revoke all on public.atlas_current_followups from public,anon,authenticated;
grant select on public.atlas_current_followups to service_role;

-- Add a promise-aware restriction and priority. Existing ownership, opted-out
-- clients, purchases, CRM future dates, cooldowns, quotas and weekend rules remain.
create or replace function public.tc_atlas_candidate_rows(p_kind text,p_worker uuid default null)
returns table(id uuid,client_id uuid,lead_id uuid,name text,worker_id uuid,reasons jsonb,priority integer,last_contact_at timestamptz,next_contact_at timestamptz)
language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
 if p_kind='capture' then
  return query
  select distinct on (l.cliente_id) l.id,l.cliente_id,l.id,trim(concat_ws(' ',c.nombre,c.apellido)),l.assigned_worker_id,
   jsonb_build_array(case when af.id is not null then 'Seguimiento acordado en Atlas que ya corresponde' when l.next_contact_at is not null then 'Seguimiento que ya corresponde' else 'Contacto pendiente sin fecha futura' end,
    case when l.estado in ('pend_cap','hizo_free','recontacto') then 'Tiene una consulta gratuita registrada' else 'No consta una primera compra confirmada' end),
   case when af.id is not null then -1 when l.estado in ('pend_cap','hizo_free','recontacto') then 0 when l.next_contact_at is not null then 1 else 2 end,
   greatest(coalesce(l.last_contact_at,l.contacted_at),af.created_at),coalesce(af.next_contact_at,l.next_contact_at)
  from captacion_leads l join crm_clientes c on c.id=l.cliente_id
  left join atlas_current_followups af on af.client_id=c.id
  where l.closed_at is null and coalesce(l.estado,'nuevo') not in ('cliente','captado','no_interesado','numero_invalido','perdido','cerrado','finalizado')
   and (l.next_contact_at is null or l.next_contact_at<=tc_atlas_now())
   and (af.next_contact_at is null or af.next_contact_at<=tc_atlas_now())
   and coalesce(l.intento_actual,0)<=coalesce(l.max_intentos,3)
   and coalesce(c.origen,'') not ilike '%orion%' and length(regexp_replace(coalesce(c.telefono,''),'[^0-9]','','g'))>=6
   and coalesce(c.estado,'') not in ('baja','deleted','eliminado','archivado')
   and coalesce(to_jsonb(c)->>'do_not_contact','false')<>'true' and coalesce(to_jsonb(c)->>'marketing_opt_out','false')<>'true'
   and (p_worker is null or l.assigned_worker_id is null or l.assigned_worker_id=p_worker)
   and (l.assigned_worker_id is null or exists(select 1 from workers w where w.id=l.assigned_worker_id and w.role='central' and w.is_active is distinct from false))
   and not exists(select 1 from crm_client_capture_assignments a where a.client_id=c.id and a.status='confirmed')
   and not exists(select 1 from crm_cliente_pagos p where p.cliente_id=c.id and p.estado='completed' and p.importe>0)
   and not exists(select 1 from rendimiento_llamadas r where r.cliente_id=c.id::text and r.cliente_compra_minutos and r.importe>0)
   and not exists(select 1 from atlas_admin_jobs j where j.kind='capture' and j.status in ('pending','in_progress','blocked') and j.client_ids @> array[c.id])
  order by l.cliente_id,l.next_contact_at nulls last,l.created_at,l.id;
 elsif p_kind='recovery' then
  if extract(isodow from tc_atlas_now() at time zone 'America/Guayaquil') not between 1 and 5 then return; end if;
  return query
  select c.id,c.id,null::uuid,c.nombre,r.responsible_id,
   jsonb_build_array(case when af.id is not null then 'Seguimiento acordado en Atlas que ya corresponde' when a.client_id is not null then 'Ya pertenece a la misión de hoy' when h.last_at is not null then 'Seguimiento de recuperación que ya corresponde' else 'Pendiente de primera gestión de recuperación' end,'Cumple la elegibilidad de Recuperar clientes'),
   case when af.id is not null then -1 when a.client_id is not null then 0 when h.last_at is not null then 1 else 2 end,greatest(h.last_at,af.created_at),af.next_contact_at
  from tc_recovery_candidates c join crm_clientes cl on cl.id=c.id
  left join crm_client_recovery r on r.client_id=c.id
  left join crm_recovery_mission_schedules s on s.worker_id=coalesce(p_worker,r.responsible_id)
  left join crm_recovery_mission_assignments a on a.client_id=c.id and a.mission_day=(tc_atlas_now() at time zone 'America/Guayaquil')::date
  left join lateral(select max(hh.created_at) last_at from crm_client_recovery_history hh where hh.client_id=c.id and hh.status in ('contacted','no_response')) h on true
  left join atlas_current_followups af on af.client_id=c.id
  where c.eligible and coalesce(r.status,'pending') in ('pending','contacted','no_response')
   and (af.next_contact_at is null or af.next_contact_at<=tc_atlas_now())
   and coalesce(cl.estado,'') not in ('baja','deleted','eliminado','archivado')
   and coalesce(to_jsonb(cl)->>'do_not_contact','false')<>'true' and coalesce(to_jsonb(cl)->>'marketing_opt_out','false')<>'true'
   and (p_worker is null or r.responsible_id is null or r.responsible_id=p_worker)
   and (p_worker is null or exists(select 1 from crm_recovery_mission_schedules ss where ss.worker_id=p_worker and ss.enabled))
   and exists(select 1 from crm_recovery_mission_schedules ss join workers ww on ww.id=ss.worker_id
    where ss.enabled and ww.role='central' and ww.is_active is distinct from false
     and (coalesce(p_worker,r.responsible_id) is null or ss.worker_id=coalesce(p_worker,r.responsible_id))
     and (((tc_atlas_now() at time zone 'America/Guayaquil')::date+ss.end_time) at time zone 'America/Guayaquil')>tc_atlas_now())
   and (r.responsible_id is null or exists(select 1 from workers w join crm_recovery_mission_schedules ss on ss.worker_id=w.id and ss.enabled where w.id=r.responsible_id and w.role='central' and w.is_active is distinct from false))
   and (a.client_id is null or a.worker_id=coalesce(p_worker,r.responsible_id))
   and not exists(select 1 from crm_recovery_contact_events e where e.client_id=c.id and e.mission_day=(tc_atlas_now() at time zone 'America/Guayaquil')::date and e.counted)
   and (coalesce(h.last_at,r.contacted_at) is null or coalesce(h.last_at,r.contacted_at)<=tc_atlas_now()-make_interval(days=>coalesce(s.followup_days,7)))
   and not exists(select 1 from atlas_admin_jobs j where j.kind='recovery' and j.status in ('pending','in_progress','blocked') and j.client_ids @> array[c.id]);
 else raise exception 'INVALID_KIND'; end if;
end $$;

revoke all on function public.tc_atlas_candidate_rows(text,uuid) from public,anon,authenticated;
grant execute on function public.tc_atlas_candidate_rows(text,uuid) to service_role;
commit;
