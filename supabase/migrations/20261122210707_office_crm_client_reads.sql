begin;

-- Historical proof of acquisition, not a revenue ledger. This projection contains no
-- names, contact details, notes, provider payloads or link-only PayPal confirmations.
create view public.office_crm_purchase_evidence with (security_invoker = true) as
  select p.cliente_id as client_id, p.id, 'crm_cliente_pagos'::text as source,
    p.created_at as at, p.created_at as recorded_at, p.importe as amount,
    nullif(upper(trim(p.moneda)),'') as currency, lower(p.estado) as status
  from public.crm_cliente_pagos p
  -- A reversal alone may have followed a failed authorization. Require evidence
  -- of the original capture before it can establish a historical acquisition.
  where p.importe>0 and (lower(p.estado) in ('completed','refunded','partially_refunded')
    or (lower(p.estado)='reversed' and (nullif(trim(p.paypal_capture_id),'') is not null
      or exists (select 1 from public.cliente_payment_attempts a where a.cliente_id=p.cliente_id
        and a.status in ('completed','refunded','partially_refunded','reversed') and a.completed_at is not null
        and a.amount=p.importe and upper(a.currency)=upper(p.moneda) and a.order_id is not null
        and p.referencia_externa=a.provider||':'||a.order_id))))
    and coalesce(p.benefits_context->>'collection_only','false') <> 'true'
  union all
  select c.id, l.id, 'rendimiento_llamadas', coalesce(l.fecha_hora,l.created_at), l.created_at,
    l.importe, null::text, 'recorded'
  from public.rendimiento_llamadas l
  join public.crm_clientes c on c.id::text=btrim(coalesce(l.cliente_id,''))
  where l.cliente_compra_minutos is true and l.importe>0
    and not exists (select 1 from public.crm_cliente_pagos p where p.source_rendimiento_id=l.id)
  union all
  select a.cliente_id, a.id, 'cliente_payment_attempts', a.completed_at, a.created_at,
    a.amount, nullif(upper(trim(a.currency)),''), a.status
  from public.cliente_payment_attempts a
  where a.status in ('completed','refunded','partially_refunded','reversed') and a.completed_at is not null
    and a.amount>0 and a.provider_response#>>'{metadata,collection_only}' is distinct from 'true'
    and not exists (select 1 from public.crm_cliente_pagos p where p.cliente_id=a.cliente_id
      and a.order_id is not null and p.referencia_externa=a.provider||':'||a.order_id)
  union all
  select m.cliente_id,m.id,'stripe_oracle_credits',m.created_at,m.created_at,
    (m.meta->>'amount_eur')::numeric,'EUR','completed'
  from public.cliente_oracle_credit_movements m
  where public.tc_crm_is_paid_stripe_oracle_purchase(m.amount,m.movement_type,m.reference,m.meta)
  union all
  select m.cliente_id,m.id,'stripe_oracle_questions',m.created_at,m.created_at,
    (m.meta->>'amount_eur')::numeric,'EUR','completed'
  from public.cliente_oracle_question_movements m
  where public.tc_crm_is_paid_stripe_oracle_purchase(m.amount,m.movement_type,m.reference,m.meta);
revoke all on public.office_crm_purchase_evidence from public,anon,authenticated,service_role;
grant select on public.office_crm_purchase_evidence to service_role;

-- Used by the existing Central portfolio after its ownership check. Return only dates
-- for the already authorized page of IDs. Office queries below use the same evidence.
create function public.tc_crm_first_purchases_batch(p_client_ids uuid[])
returns table(client_id uuid, first_purchase_at timestamptz)
language plpgsql stable security invoker set search_path='' as $$
begin
  if p_client_ids is null or cardinality(p_client_ids)>200 then raise exception 'OFFICE_INVALID'; end if;
  return query select e.client_id,min(e.at) from public.office_crm_purchase_evidence e
    where e.client_id=any(p_client_ids) and e.at<=now() and e.recorded_at<=now() group by e.client_id;
end $$;

create function public.office_crm_client_page(p_actor uuid,p_search text,p_after uuid,p_limit int,p_as_of timestamptz,p_stage text)
returns table (id uuid,display_name text,country text,created_at timestamptz,account_linked boolean,capture_stage text,first_purchase_at timestamptz)
language plpgsql stable security invoker set search_path='' as $$
declare term text := lower(trim(coalesce(p_search,'')));
begin
  perform public.office_actor(p_actor);
  if length(term)>120 or p_limit is null or p_limit not between 1 and 51 or p_as_of is null or not isfinite(p_as_of)
    or p_stage is null or p_stage not in ('all','captured','pending') then raise exception 'OFFICE_INVALID'; end if;
  return query with candidates as (
    select c.id, nullif(trim(concat_ws(' ',c.nombre,c.apellido)),'') as label,c.pais,c.created_at,c.auth_user_id is not null as linked
    from public.crm_clientes c where coalesce(lower(c.origen),'') not like '%orion%' and c.created_at <= least(p_as_of,now())
      and (p_after is null or c.id>p_after) and (term='' or c.id::text=term
        or strpos(lower(concat_ws(' ',c.nombre,c.apellido)),term)>0)
  ), firsts as (
    select e.client_id,min(e.at) as first_at from public.office_crm_purchase_evidence e
    where e.at<=least(p_as_of,now()) and e.recorded_at<=least(p_as_of,now()) group by e.client_id
  )
  select c.id,c.label,c.pais,c.created_at,c.linked,
    case when f.first_at is null then 'pending' else 'captured' end,f.first_at
  from candidates c left join firsts f on f.client_id=c.id
  where p_stage='all' or ((f.first_at is not null)=(p_stage='captured'))
  order by c.id limit p_limit;
end $$;

create function public.office_crm_capture_totals(p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
  perform public.office_actor(p_actor);
  return (select jsonb_build_object('total_clients',count(*),'captured_clients',count(p.client_id))
    from public.crm_clientes c left join (
      select distinct e.client_id from public.office_crm_purchase_evidence e
      where e.at<=now() and e.recorded_at<=now()
    ) p on p.client_id=c.id where coalesce(lower(c.origen),'') not like '%orion%' and c.created_at<=now());
end $$;

create function public.office_crm_client_detail(p_actor uuid,p_client_id uuid,p_after_at timestamptz default null,
  p_after_id uuid default null,p_limit int default 25,p_after_source text default null) returns jsonb
language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare client jsonb; purchase jsonb; lead jsonb; reservations jsonb; has_more boolean;
begin
  perform public.office_actor(p_actor);
  if p_client_id is null or p_limit is null or p_limit not between 1 and 50
    or p_after_id is null and (p_after_at is not null or p_after_source is not null)
    or p_after_id is not null and (p_after_source is null or p_after_source not in ('reservas','first_tarotist_reservations'))
    or not isfinite(p_after_at) then raise exception 'OFFICE_INVALID'; end if;
  select jsonb_build_object('id',c.id,'display_name',nullif(trim(concat_ws(' ',c.nombre,c.apellido)),''),
    'country',c.pais,'created_at',c.created_at,'account_linked',c.auth_user_id is not null,'origin',c.origen)
    into client from public.crm_clientes c where c.id=p_client_id and coalesce(lower(c.origen),'') not like '%orion%';
  if client is null then return null; end if;
  select jsonb_build_object('id',e.id,'source',e.source,'at',e.at,'amount',e.amount,'currency',e.currency,'status',e.status)
    into purchase from public.office_crm_purchase_evidence e
    where e.client_id=p_client_id and e.at<=now() and e.recorded_at<=now()
    order by e.at, case when e.source='crm_cliente_pagos' then 0 else 1 end,e.source,e.id limit 1;
  select jsonb_build_object('id',l.id,'status',l.estado,'created_at',l.created_at,'next_contact_at',l.next_contact_at,'origin',l.origen)
    into lead from public.captacion_leads l where l.cliente_id=p_client_id and coalesce(lower(l.origen),'') not like '%orion%'
    order by l.created_at desc nulls last,l.id limit 1;
  with bookings as (
    -- The agenda stores UTC wall time in a timestamp without zone (reservaDate appends Z).
    select r.id,r.fecha_reserva at time zone 'UTC' as at,r.estado as status,
      coalesce(nullif(r.tarotista_nombre,''),nullif(r.tarotista_nombre_manual,'')) as tarotist_name,'reservas'::text as source
    from public.reservas r where r.cliente_id=p_client_id and r.deleted_at is null
    union all
    select r.id,r.scheduled_at,r.status,r.tarotista_name,'first_tarotist_reservations'
    from public.first_tarotist_reservations r where r.completion_cliente_id=p_client_id and r.brand='celestial'
  ), window_rows as (
    select b.* from bookings b where p_after_id is null
      or (p_after_at is not null and (b.at<p_after_at or b.at is null))
      or (b.at is not distinct from p_after_at and (b.id,b.source)>(p_after_id,p_after_source))
    order by b.at desc nulls last,b.id,b.source limit p_limit+1
  ), numbered as (
    select w.*,row_number() over(order by w.at desc nulls last,w.id,w.source) as n from window_rows w
  ) select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'at',b.at,'status',b.status,'tarotist_name',b.tarotist_name,
      'source',b.source) order by b.n) filter(where b.n<=p_limit),'[]'::jsonb), count(*)>p_limit
    into reservations,has_more from numbered b;
  return jsonb_build_object('client',client || jsonb_build_object('capture_stage',case when purchase is null then 'pending' else 'captured' end,
    'first_purchase_at',purchase->'at'),'first_purchase',purchase,'appointments',reservations,
    'appointments_has_more',has_more,'capture',lead);
end $$;

revoke all on function public.tc_crm_first_purchases_batch(uuid[]),public.office_crm_client_page(uuid,text,uuid,int,timestamptz,text),
  public.office_crm_client_detail(uuid,uuid,timestamptz,uuid,int,text),public.office_crm_capture_totals(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.tc_crm_first_purchases_batch(uuid[]),public.office_crm_client_page(uuid,text,uuid,int,timestamptz,text),
  public.office_crm_client_detail(uuid,uuid,timestamptz,uuid,int,text),public.office_crm_capture_totals(uuid) to service_role;
commit;
