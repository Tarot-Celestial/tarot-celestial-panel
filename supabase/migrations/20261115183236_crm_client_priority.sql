begin;

-- The capture audit contains a large import baseline; only confirmed capture
-- events represent activity. Keep the read path independent of that history.
create index if not exists crm_capture_audit_confirmed_client_date_idx
  on public.crm_client_capture_audit(client_id,created_at desc)
  where action='capture_confirmed';

-- Read-only ordering for the authorized Admin/Central server route. Amounts use
-- the existing CRM's recorded-amount convention; currencies are also returned
-- separately. There is no invented historical exchange rate or balance write.
create or replace function public.tc_crm_client_priority_page(
  p_tag_ids uuid[],
  p_search text default '',
  p_phone_candidates text[] default '{}',
  p_country text default '',
  p_web_filter text default 'todos',
  p_after jsonb default null,
  p_as_of timestamptz default now(),
  p_limit integer default 121
) returns table (
  cliente_id uuid,
  gasto_total numeric,
  compras bigint,
  ultima_actividad_at timestamptz,
  gasto_por_moneda jsonb
)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  search_text text := lower(btrim(coalesce(p_search,'')));
  first_name text;
  remaining_name text;
  after_id uuid;
  after_spend numeric;
  after_count bigint;
  after_activity timestamptz;
begin
  if p_tag_ids is null or cardinality(p_tag_ids)=0 or cardinality(p_tag_ids)>100
    or p_limit is null or p_limit<1 or p_limit>121
    or p_as_of is null or not isfinite(p_as_of)
    or coalesce(p_web_filter,'todos') not in ('todos','registrados','no_registrados','onboarding_pendiente')
  then raise exception 'CRM_PRIORITY_INVALID_ARGUMENT' using errcode='22023'; end if;

  search_text := regexp_replace(search_text,'\s+',' ','g');
  first_name := split_part(search_text,' ',1);
  remaining_name := nullif(substr(search_text,length(first_name)+2),'');
  if p_after is not null then
    if jsonb_typeof(p_after)<>'object'
      or not (p_after ?& array['cliente_id','gasto_total','compras','ultima_actividad_at'])
    then raise exception 'CRM_PRIORITY_INVALID_CURSOR' using errcode='22023'; end if;
    after_id := (p_after->>'cliente_id')::uuid;
    after_spend := (p_after->>'gasto_total')::numeric;
    after_count := (p_after->>'compras')::bigint;
    after_activity := (p_after->>'ultima_actividad_at')::timestamptz;
    if after_id is null or after_spend is null or after_spend<0
      or after_spend in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
      or after_count is null or after_count<0
      or (after_activity is not null and (not isfinite(after_activity) or after_activity>p_as_of))
    then raise exception 'CRM_PRIORITY_INVALID_CURSOR' using errcode='22023'; end if;
  end if;

  return query
  with candidates as materialized (
    select c.id,c.captured_at
    from public.crm_clientes c
    where c.created_at<=p_as_of
      and coalesce(lower(c.origen),'') not like '%orion%'
      and exists (
        select 1 from public.crm_cliente_etiquetas ce
        where ce.cliente_id=c.id and ce.etiqueta_id=any(p_tag_ids)
          and ce.created_at<=p_as_of
      )
      and (
        (cardinality(coalesce(p_phone_candidates,'{}'))>0 and
          (c.telefono=any(p_phone_candidates) or c.telefono_normalizado=any(p_phone_candidates)))
        or (cardinality(coalesce(p_phone_candidates,'{}'))=0 and (
          search_text='' or strpos(lower(coalesce(c.nombre,'')),search_text)>0
          or strpos(lower(coalesce(c.apellido,'')),search_text)>0
          or strpos(lower(coalesce(c.email,'')),search_text)>0
          or (remaining_name is not null and (
            (strpos(lower(coalesce(c.nombre,'')),first_name)>0 and strpos(lower(coalesce(c.apellido,'')),remaining_name)>0)
            or (strpos(lower(coalesce(c.nombre,'')),remaining_name)>0 and strpos(lower(coalesce(c.apellido,'')),first_name)>0)
          ))
        ))
      )
      and (coalesce(p_country,'')='' or c.pais ilike '%'||p_country||'%')
      and case coalesce(p_web_filter,'todos')
        when 'registrados' then coalesce(c.onboarding_completado,false) or coalesce(c.total_accesos,0)>0 or c.ultimo_acceso_at is not null or c.ultima_actividad_at is not null
        when 'no_registrados' then not (coalesce(c.onboarding_completado,false) or coalesce(c.total_accesos,0)>0 or c.ultimo_acceso_at is not null or c.ultima_actividad_at is not null)
        when 'onboarding_pendiente' then not coalesce(c.onboarding_completado,false) and (coalesce(c.total_accesos,0)>0 or c.ultimo_acceso_at is not null or c.ultima_actividad_at is not null)
        else true
      end
  ), payments as materialized (
    select p.cliente_id,p.importe,p.created_at,
      coalesce(nullif(upper(btrim(p.moneda)),''),'EUR') currency
    from public.crm_cliente_pagos p join candidates c on c.id=p.cliente_id
    where p.estado='completed' and p.importe>0 and p.created_at<=p_as_of
  ), calls as materialized (
    select c.id cliente_id,l.id,l.importe,coalesce(l.fecha_hora,l.created_at) event_at
    from public.rendimiento_llamadas l join candidates c on btrim(coalesce(l.cliente_id,''))=c.id::text
    where l.created_at<=p_as_of and coalesce(l.fecha_hora,l.created_at)<=p_as_of
  ), purchases as (
    select p.cliente_id,p.importe,p.currency from payments p
    union all
    select l.cliente_id,l.importe,'EUR' from calls l
    where l.importe>0 and not exists (
      -- ANY linked payment suppresses the legacy call, even refunded/cancelled.
      -- Filtering this anti-join by payment state would resurrect refunds.
      select 1 from public.crm_cliente_pagos p where p.source_rendimiento_id=l.id
    )
  ), by_currency as (
    select p.cliente_id,p.currency,round(sum(p.importe),2) amount,count(*) count
    from purchases p group by p.cliente_id,p.currency
  ), totals as (
    select b.cliente_id,sum(b.amount) amount,sum(b.count)::bigint count,
      jsonb_object_agg(b.currency,b.amount order by b.currency) currencies
    from by_currency b group by b.cliente_id
  ), activity_events as (
    -- Keep the authoritative state when it existed at the page cutoff.
    select a.cliente_id,a.last_activity_at event_at
    from public.crm_client_activity_month a join candidates c on c.id=a.cliente_id
    where a.updated_at<=p_as_of and a.last_activity_at<=p_as_of
    union all select l.cliente_id,l.event_at from calls l
    union all select p.cliente_id,p.created_at from payments p
    union all select c.id,c.captured_at from candidates c where c.captured_at<=p_as_of
    union all
    select a.client_id,a.created_at from public.crm_client_capture_audit a join candidates c on c.id=a.client_id
    where a.action='capture_confirmed' and a.created_at<=p_as_of
    union all
    select l.cliente_id,coalesce(l.closed_at,l.updated_at,l.created_at)
    from public.captacion_leads l join candidates c on c.id=l.cliente_id
    where l.estado='captado' and l.created_at<=p_as_of and coalesce(l.closed_at,l.updated_at,l.created_at)<=p_as_of
    union all
    select a.cliente_id,a.completed_at from public.cliente_payment_attempts a join candidates c on c.id=a.cliente_id
    where a.status='completed' and a.amount>0 and a.created_at<=p_as_of and a.completed_at<=p_as_of
    union all
    select m.cliente_id,m.created_at from public.cliente_oracle_credit_movements m join candidates c on c.id=m.cliente_id
    where m.created_at<=p_as_of and public.tc_crm_is_paid_stripe_oracle_purchase(m.amount,m.movement_type,m.reference,m.meta)
    union all
    select m.cliente_id,m.created_at from public.cliente_oracle_question_movements m join candidates c on c.id=m.cliente_id
    where m.created_at<=p_as_of and public.tc_crm_is_paid_stripe_oracle_purchase(m.amount,m.movement_type,m.reference,m.meta)
  ), activities as (
    select e.cliente_id,max(e.event_at) event_at from activity_events e group by e.cliente_id
  ), ranked as (
    select c.id,coalesce(t.amount,0) amount,coalesce(t.count,0) count,a.event_at,
      coalesce(t.currencies,'{}'::jsonb) currencies
    from candidates c left join totals t on t.cliente_id=c.id left join activities a on a.cliente_id=c.id
  )
  select r.id,r.amount,r.count,r.event_at,r.currencies from ranked r
  where p_after is null or r.amount<after_spend
    or (r.amount=after_spend and r.count<after_count)
    or (r.amount=after_spend and r.count=after_count and coalesce(r.event_at,'-infinity'::timestamptz)<coalesce(after_activity,'-infinity'::timestamptz))
    or (r.amount=after_spend and r.count=after_count and r.event_at is not distinct from after_activity and r.id>after_id)
  order by r.amount desc,r.count desc,r.event_at desc nulls last,r.id asc
  limit p_limit;
end;
$$;

revoke all on function public.tc_crm_client_priority_page(uuid[],text,text[],text,text,jsonb,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.tc_crm_client_priority_page(uuid[],text,text[],text,text,jsonb,timestamptz,integer) to service_role;

commit;
