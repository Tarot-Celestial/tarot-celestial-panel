begin;
do $$ begin
  if to_regprocedure('public.cliente_confirmar_compra_ruleta_v3(jsonb)') is null or
     to_regprocedure('public.cliente_confirmar_compra_ruleta_v2(jsonb)') is null then
    raise exception 'Faltan las funciones de compra v2/v3 existentes. No se ha instalado PayPal.';
  end if;
end $$;

create table if not exists public.crm_paypal_orders (
  id uuid primary key,
  cliente_id uuid not null references public.crm_clientes(id),
  worker_id uuid not null references public.workers(id),
  environment text not null check(environment in ('sandbox','live')),
  public_token uuid not null unique default gen_random_uuid(),
  order_id text unique,
  capture_id text unique,
  approval_url text,
  amount numeric(10,2) not null check(amount>0 and amount<=5000),
  currency text not null default 'EUR' check(currency='EUR'),
  pack_id text not null,
  pack_name text not null,
  purchase_payload jsonb not null,
  create_payload jsonb not null,
  status text not null default 'pending' check(status in ('pending','completed','cancelled')),
  remote_status text not null default 'CREATING',
  last_error text,
  payment_id uuid references public.crm_cliente_pagos(id),
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  completed_at timestamptz
);
create index if not exists crm_paypal_orders_client_date on public.crm_paypal_orders(cliente_id,created_at desc);
alter table public.crm_paypal_orders enable row level security;
revoke all on public.crm_paypal_orders from public,anon,authenticated;
grant select,insert,update on public.crm_paypal_orders to service_role;

-- Called exclusively by the server AFTER fetching and validating a COMPLETED
-- capture from PayPal. Row lock + the existing purchase RPC run in one transaction.
create or replace function public.tc_complete_paypal_crm(p_id uuid,p_order_id text,p_capture_id text,p_amount numeric,p_currency text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.crm_paypal_orders; result jsonb; payload jsonb; payment public.crm_cliente_pagos;
begin
  select * into a from public.crm_paypal_orders where id=p_id for update;
  if not found then raise exception 'PAYPAL_ORDER_NOT_FOUND'; end if;
  if p_order_id is distinct from a.order_id or p_amount is distinct from a.amount or p_currency is distinct from a.currency or coalesce(p_capture_id,'')='' then
    raise exception 'PAYPAL_CAPTURE_MISMATCH';
  end if;
  if a.status='completed' then
    if a.capture_id is distinct from p_capture_id then raise exception 'PAYPAL_CAPTURE_MISMATCH'; end if;
    return jsonb_build_object('ok',true,'duplicated',true,'payment_id',a.payment_id);
  end if;
  payload:=a.purchase_payload||jsonb_build_object('cliente_id',a.cliente_id,'amount',a.amount,'currency',a.currency,
    'payment_ref','paypal-crm:'||a.order_id,'created_by_user_id',a.worker_id,
    'metodo',case when a.pack_id='crm_manual_amount' then 'paypal_crm_manual' else 'paypal_crm' end);
  if a.pack_id='crm_manual_amount' then result:=public.cliente_confirmar_compra_ruleta_v2(payload);
  else result:=public.cliente_confirmar_compra_ruleta_v3(payload); end if;
  if result is null or result->>'ok'='false' or nullif(result->'payment'->>'id','') is null then raise exception 'PURCHASE_NOT_CONFIRMED'; end if;
  select * into payment from public.crm_cliente_pagos where id=(result->'payment'->>'id')::uuid;
  if not found or payment.cliente_id<>a.cliente_id or payment.estado<>'completed' or payment.importe<>a.amount then raise exception 'PURCHASE_MISMATCH'; end if;
  update public.crm_cliente_pagos set paypal_order_id=a.order_id,paypal_capture_id=p_capture_id where id=payment.id;
  update public.crm_paypal_orders set status='completed',remote_status='CAPTURE_COMPLETED',capture_id=p_capture_id,
    payment_id=payment.id,last_error=null,completed_at=now(),checked_at=now() where id=a.id;
  return jsonb_build_object('ok',true,'payment_id',payment.id);
end $$;
revoke all on function public.tc_complete_paypal_crm(uuid,text,text,numeric,text) from public,anon,authenticated;
grant execute on function public.tc_complete_paypal_crm(uuid,text,text,numeric,text) to service_role;
notify pgrst,'reload schema';
commit;
