-- Consume the existing, idempotent assigned_client_purchase XP award. This
-- migration never grants XP and never modifies a payment or the active XP rule.
create table if not exists public.central_purchase_celebrations (
  payment_id uuid primary key references public.crm_cliente_pagos(id),
  event_id uuid not null unique references public.worker_xp_events(id),
  worker_id uuid not null references public.workers(id),
  seen_at timestamptz not null default now()
);
alter table public.central_purchase_celebrations enable row level security;
revoke all on public.central_purchase_celebrations from public, anon, authenticated;
grant select, insert on public.central_purchase_celebrations to service_role;

create or replace function public.tc_central_purchase_celebrations(p_user uuid, p_event uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare w workers%rowtype; item jsonb; inserted_payment uuid; result jsonb;
begin
  select * into w from workers where user_id::text=p_user::text
    and role='central' and is_active is not false order by id limit 1;
  if not found then raise exception 'FORBIDDEN'; end if;

  if p_event is null then
    select coalesce(jsonb_agg(v.item order by v.created_at), '[]'::jsonb) into result from (
      select jsonb_build_object('id',e.id,'worker_id',e.worker_id,'payment_id',p.id,
        'client_id',p.cliente_id,'xp',e.xp_amount,'amount',p.importe,
        'currency',coalesce(p.moneda,'EUR'),'created_at',e.created_at) item,e.created_at
      from worker_xp_events e join crm_cliente_pagos p on e.reference_id='payment:'||p.id::text
      where e.worker_id=w.id and e.status='applied' and e.origin='crm_cliente_pagos' and e.xp_amount>0
        and e.created_at>=now()-interval '24 hours' and e.created_at<=now()
        and lower(p.estado)='completed' and p.importe>0
        and (p.created_by_user_id=w.id or p.created_by_user_id::text=w.user_id::text)
        and exists(select 1 from worker_xp_rules r where r.action_key=e.action_key and r.integration_key='assigned_client_purchase')
        and not exists(select 1 from central_purchase_celebrations c where c.payment_id=p.id)
      order by e.created_at,e.id limit 10
    ) v;
    return jsonb_build_object('events',result);
  end if;

  -- Re-check both the committed XP event and completed payment when claiming.
  -- A payment/XP reversal cannot race through the confirmation check.
  select jsonb_build_object('id',e.id,'worker_id',e.worker_id,'payment_id',p.id,
    'client_id',p.cliente_id,'xp',e.xp_amount,'amount',p.importe,
    'currency',coalesce(p.moneda,'EUR'),'created_at',e.created_at) into item
  from worker_xp_events e join crm_cliente_pagos p on e.reference_id='payment:'||p.id::text
  where e.id=p_event and e.worker_id=w.id and e.status='applied'
    and e.origin='crm_cliente_pagos' and e.xp_amount>0
    and e.created_at>=now()-interval '24 hours' and e.created_at<=now()
    and lower(p.estado)='completed' and p.importe>0
    and (p.created_by_user_id=w.id or p.created_by_user_id::text=w.user_id::text)
    and exists(select 1 from worker_xp_rules r where r.action_key=e.action_key and r.integration_key='assigned_client_purchase')
  for share of e,p;
  if item is null then return jsonb_build_object('event',null); end if;
  insert into central_purchase_celebrations(payment_id,event_id,worker_id)
    values((item->>'payment_id')::uuid,p_event,w.id)
    on conflict do nothing returning payment_id into inserted_payment;
  return jsonb_build_object('event',case when inserted_payment is not null then item else null end);
end $$;
revoke all on function public.tc_central_purchase_celebrations(uuid,uuid) from public,anon,authenticated;
grant execute on function public.tc_central_purchase_celebrations(uuid,uuid) to service_role;
