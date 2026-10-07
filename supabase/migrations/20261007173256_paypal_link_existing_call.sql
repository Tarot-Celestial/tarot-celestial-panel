begin;

-- This adapter intentionally leaves the installed v8 implementation unchanged.
do $$ begin
  if to_regprocedure('public.crm_register_call_atomic_v8(jsonb)') is null then
    raise exception 'Falta crm_register_call_atomic_v8(jsonb). No se ha aplicado esta migración.';
  end if;
end $$;

create table if not exists public.crm_payment_call_links (
  payment_id uuid primary key references public.crm_cliente_pagos(id),
  operation_id uuid not null unique,
  cliente_id uuid not null references public.crm_clientes(id),
  worker_id uuid not null references public.workers(id),
  rendimiento_id uuid not null references public.rendimiento_llamadas(id),
  result jsonb not null,
  created_at timestamptz not null default now()
);
create unique index if not exists crm_payment_call_links_call_uidx on public.crm_payment_call_links(rendimiento_id);
create index if not exists crm_payment_call_links_client_idx on public.crm_payment_call_links(cliente_id);
create index if not exists crm_payment_call_links_worker_idx on public.crm_payment_call_links(worker_id);
alter table public.crm_payment_call_links enable row level security;
revoke all on public.crm_payment_call_links from public, anon, authenticated;
grant select, insert on public.crm_payment_call_links to service_role;

create or replace function public.tc_register_call_with_payment(p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  payment_uuid uuid := nullif(p_payload->>'existing_payment_id','')::uuid;
  client_uuid uuid := (p_payload->>'cliente_id')::uuid;
  operation_uuid uuid := (p_payload->>'operation_id')::uuid;
  worker_uuid uuid := (p_payload->>'telefonista_worker_id')::uuid;
  paid public.crm_cliente_pagos%rowtype;
  prior public.crm_payment_call_links%rowtype;
  payload jsonb := p_payload;
  result jsonb;
  call_uuid uuid;
  payment_count bigint;
begin
  -- Serializes call registrations for this client; the existing v8 still checks balances.
  perform 1 from public.crm_clientes where id = client_uuid for update;
  if not found then raise exception 'CLIENTE_NO_ENCONTRADO'; end if;

  if payment_uuid is null then
    if coalesce((payload->>'cliente_compra_minutos')::boolean,false)
      and payload->>'forma_pago' = 'paypal_manual'
      and not coalesce((payload->>'separate_payment_confirmed')::boolean,false)
      and exists (
        select 1 from public.crm_cliente_pagos p
        join public.crm_paypal_orders o on o.payment_id = p.id
        where p.cliente_id = client_uuid and p.estado = 'completed'
          and o.status = 'completed' and p.source_rendimiento_id is null
          and p.importe = (payload->>'importe')::numeric
      ) then raise exception 'PAYPAL_PAYMENT_ALREADY_CONFIRMED';
    end if;
    return public.crm_register_call_atomic_v8(payload);
  end if;

  select * into prior from public.crm_payment_call_links where operation_id = operation_uuid;
  if found then
    if prior.payment_id <> payment_uuid or prior.cliente_id <> client_uuid or prior.worker_id <> worker_uuid then
      raise exception 'PAYMENT_OPERATION_CONFLICT';
    end if;
    return prior.result || jsonb_build_object('duplicate_prevented',true);
  end if;

  select * into paid from public.crm_cliente_pagos where id = payment_uuid for update;
  if not found or paid.cliente_id <> client_uuid or paid.estado <> 'completed' then
    raise exception 'EXISTING_PAYMENT_INVALID';
  end if;
  if not exists (select 1 from public.crm_paypal_orders o where o.payment_id = payment_uuid
      and o.cliente_id = client_uuid and o.status = 'completed' and o.capture_id is not null) then
    raise exception 'EXISTING_PAYMENT_INVALID';
  end if;
  if paid.source_rendimiento_id is not null or exists (
    select 1 from public.crm_payment_call_links where payment_id = payment_uuid
  ) then raise exception 'PAYMENT_ALREADY_LINKED'; end if;
  if coalesce((payload->>'cliente_compra_minutos')::boolean,false)
    or payload->>'tipo_registro' is distinct from 'minutos'
    or coalesce((payload->>'tiempo')::numeric,0) <= 0
    or coalesce((payload->>'free_delta')::numeric,0) > 0
    or coalesce((payload->>'normal_delta')::numeric,0) > 0
    or coalesce((payload->>'tiempo')::numeric,0) <>
      -coalesce((payload->>'free_delta')::numeric,0)-coalesce((payload->>'normal_delta')::numeric,0) then
    raise exception 'EXISTING_PAYMENT_CALL_ONLY';
  end if;

  -- Consume already credited minutes. Never re-run the purchase/rewards branch.
  payload := payload || jsonb_build_object(
    'cliente_compra_minutos',false,'importe',0,'forma_pago',null,
    'misma_compra',false,'guarda_minutos',false,'minutos_guardados_free',0,
    'minutos_guardados_normales',0,'points_to_add',0,'purchase_benefits',null,
    'note_text',coalesce(payload->>'note_text','') || ' Pago PayPal ya registrado: ' || payment_uuid::text || '. Sin nueva compra.'
  );
  select count(*) into payment_count from public.crm_cliente_pagos where cliente_id = client_uuid;
  result := public.crm_register_call_atomic_v8(payload);
  if result->>'ok' = 'false' then raise exception 'CALL_REGISTER_FAILED'; end if;
  call_uuid := nullif(result#>>'{rendimiento,id}','')::uuid;
  if call_uuid is null or (result->'payment' is not null and result->'payment' <> 'null'::jsonb)
    or payment_count <> (select count(*) from public.crm_cliente_pagos where cliente_id = client_uuid) then
    raise exception 'EXISTING_PAYMENT_CONTRACT_MISMATCH';
  end if;
  -- A replay from v8 must not attach a second payment to the same call.
  if exists (select 1 from public.crm_cliente_pagos where source_rendimiento_id = call_uuid) then
    raise exception 'PAYMENT_OPERATION_CONFLICT';
  end if;
  update public.crm_cliente_pagos set source_rendimiento_id = call_uuid where id = payment_uuid;
  result := result || jsonb_build_object('existing_payment_id',payment_uuid,'payment',null,'payment_linked',true);
  insert into public.crm_payment_call_links(payment_id,operation_id,cliente_id,worker_id,rendimiento_id,result)
    values(payment_uuid,operation_uuid,client_uuid,worker_uuid,call_uuid,result);
  return result;
end $$;
revoke all on function public.tc_register_call_with_payment(jsonb) from public, anon, authenticated;
grant execute on function public.tc_register_call_with_payment(jsonb) to service_role;
commit;
