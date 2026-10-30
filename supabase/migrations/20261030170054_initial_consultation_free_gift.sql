-- The initial consultation is global per CRM client and independent from the
-- introductory allowance for each new tarotist, periodic passes and wallet gifts.
create table public.crm_initial_consultation_gift_uses (
 id uuid primary key default gen_random_uuid(),
 operation_id uuid not null unique references public.crm_call_operations(operation_id),
 cliente_id uuid not null unique references public.crm_clientes(id),
 tarotista_worker_id uuid not null references public.workers(id),
 worker_id uuid not null references public.workers(id),
 minutes integer not null check(minutes=7),
 benefit_event_id uuid not null references public.tc_client_benefit_events(id),
 rendimiento_id uuid not null references public.rendimiento_llamadas(id),
 request jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now()
);
create index crm_initial_consultation_gift_tarotista_idx on public.crm_initial_consultation_gift_uses(tarotista_worker_id);
create index crm_initial_consultation_gift_worker_idx on public.crm_initial_consultation_gift_uses(worker_id);
create index crm_initial_consultation_gift_benefit_idx on public.crm_initial_consultation_gift_uses(benefit_event_id);
create index crm_initial_consultation_gift_rendimiento_idx on public.crm_initial_consultation_gift_uses(rendimiento_id);
alter table public.crm_initial_consultation_gift_uses enable row level security;
revoke all on public.crm_initial_consultation_gift_uses from public,anon,authenticated,service_role;
grant select,insert on public.crm_initial_consultation_gift_uses to service_role;
-- Exact digit-only matching supports historical formatting without guessing names.
create index crm_clientes_initial_gift_phone_idx on public.crm_clientes
 ((pg_catalog.regexp_replace(coalesce(nullif(telefono_normalizado,''),telefono,''),'[^0-9]','','g')));
create index captacion_events_initial_free_client_idx on public.captacion_state_events(cliente_id)
 where action='hizo_free';

create function public.tc_initial_consultation_gift_preview(p_cliente_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare c public.crm_clientes%rowtype; phone_key text; reason text;
begin
 select * into c from public.crm_clientes where id=p_cliente_id;
 if not found then raise exception 'CLIENTE_NO_ENCONTRADO'; end if;
 phone_key:=pg_catalog.regexp_replace(coalesce(nullif(c.telefono_normalizado,''),c.telefono,''),'[^0-9]','','g');
 reason:=case
  when exists(select 1 from public.crm_initial_consultation_gift_uses u where u.cliente_id=p_cliente_id) then 'ALREADY_USED'
  when exists(select 1 from public.rendimiento_llamadas r
    where r.cliente_id in (select other.id::text from public.crm_clientes other
      where other.id=p_cliente_id or (length(phone_key)>=6
        and pg_catalog.regexp_replace(coalesce(nullif(other.telefono_normalizado,''),other.telefono,''),'[^0-9]','','g')=phone_key))
      and (coalesce(r.tiempo,0)>0 or coalesce(r.minutos_1,0)+coalesce(r.minutos_2,0)>0 or coalesce(r.usa_7_free,false)))
    then 'PREVIOUS_CONSULTATION'
  when exists(select 1 from public.captacion_state_events e
    where e.action='hizo_free' and e.cliente_id in (select other.id from public.crm_clientes other
      where other.id=p_cliente_id or (length(phone_key)>=6
        and pg_catalog.regexp_replace(coalesce(nullif(other.telefono_normalizado,''),other.telefono,''),'[^0-9]','','g')=phone_key)))
    then 'PREVIOUS_CONSULTATION'
  when length(phone_key)>=6 and exists(select 1 from public.first_tarotist_reservations f
    where f.free_consult_used is true
      and (f.client_key='phone:'||phone_key or pg_catalog.regexp_replace(coalesce(f.phone,''),'[^0-9]','','g')=phone_key))
    then 'PREVIOUS_CONSULTATION'
  else null end;
 return jsonb_build_object('policy_key','initial_consultation_once_v1','eligible',reason is null,'minutes',7,'reason',reason);
end $function$;

create function public.tc_register_initial_consultation_gift(p_user uuid,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare actor public.workers%rowtype; tarotista public.workers%rowtype; c public.crm_clientes%rowtype;
 op uuid; client_id uuid; tarotista_id uuid; request jsonb; previous public.crm_initial_consultation_gift_uses%rowtype;
 offer jsonb; event_id uuid; payload jsonb; result jsonb; receipt jsonb; accounting jsonb; assignment jsonb;
 before_free numeric; before_normal numeric; after_free numeric; after_normal numeric; final_receipt jsonb; note_text text; phone_key text;
begin
 select * into actor from public.workers where user_id=p_user and role in ('central','admin') and is_active is true;
 if actor.id is null then raise exception 'FORBIDDEN'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'INVALID_INITIAL_FREE_REQUEST'; end if;
 op:=nullif(p_payload->>'operation_id','')::uuid;
 client_id:=nullif(p_payload->>'cliente_id','')::uuid;
 tarotista_id:=nullif(p_payload->>'tarotista_worker_id','')::uuid;
 if op is null or client_id is null or tarotista_id is null
    or coalesce((p_payload->>'cliente_compra_minutos')::boolean,false)
    or coalesce((p_payload->>'usa_7_free')::boolean,false)
    or coalesce((p_payload->>'captado')::boolean,false)
    or coalesce((p_payload->>'recuperado')::boolean,false)
    or coalesce((p_payload->>'importe')::numeric,0)<>0
    or nullif(p_payload->>'tarotista_manual_call','') is not null
    or nullif(p_payload->>'collaborator_source','') is not null
    or nullif(p_payload->>'existing_payment_id','') is not null
    or nullif(p_payload->>'paypal_collection_order_id','') is not null
    or nullif(p_payload->>'paypal_collection_source','') is not null
    or coalesce(p_payload->>'clasificacion','nada')<>'nada'
 then raise exception 'INVALID_INITIAL_FREE_REQUEST'; end if;
 request:=jsonb_build_object('client',client_id,'worker',actor.id,'tarotista',tarotista_id,'policy','initial_consultation_once_v1','minutes',7);
 -- Match canonical operation lock order, then serialize all consultations for this client.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(op::text,0));
 select * into previous from public.crm_initial_consultation_gift_uses where operation_id=op;
 if found then
  if previous.request<>request then raise exception 'PAYMENT_OPERATION_CONFLICT'; end if;
  return previous.result||jsonb_build_object('duplicate_prevented',true);
 end if;
 if exists(select 1 from public.crm_call_operations where operation_id=op) then raise exception 'PAYMENT_OPERATION_CONFLICT'; end if;
 select * into c from public.crm_clientes where id=client_id for update;
 if not found then raise exception 'CLIENTE_NO_ENCONTRADO'; end if;
 phone_key:=pg_catalog.regexp_replace(coalesce(nullif(c.telefono_normalizado,''),c.telefono,''),'[^0-9]','','g');
 if length(phone_key)>=6 then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('initial-consultation-phone:'||phone_key,0));
 end if;
 offer:=public.tc_initial_consultation_gift_preview(client_id);
 if offer->>'reason' is not null then raise exception '%',offer->>'reason'; end if;
 select * into tarotista from public.workers where id=tarotista_id and role='tarotista' and is_active is true;
 if not found then raise exception 'TAROTISTA_INACTIVE'; end if;
 before_free:=coalesce(c.minutos_free_pendientes,0);before_normal:=coalesce(c.minutos_normales_pendientes,0);
 insert into public.tc_client_benefit_events(cliente_id,rank_at_event,benefit_key,benefit_type,minutes,delivery_key,snapshot)
 values(client_id,null,'initial_consultation','minutes',7,'initial-consultation-call:'||client_id::text,
  jsonb_build_object('source','initial_consultation_once_v1','operation_id',op,'tarotista_worker_id',tarotista_id,
   'grant_minutes',7,'consume_minutes',7,'free_before',before_free)) returning id into event_id;
 update public.crm_clientes set minutos_free_pendientes=coalesce(minutos_free_pendientes,0)+7,updated_at=now() where id=client_id;
 payload:=jsonb_build_object('operation_id',op,'cliente_id',client_id,'cliente_nombre',concat_ws(' ',c.nombre,c.apellido),
  'telefonista_worker_id',actor.id,'telefonista_nombre',actor.display_name,'tarotista_worker_id',tarotista_id,'tarotista_nombre',tarotista.display_name,
  'tipo_registro','7free','cliente_compra_minutos',false,'usa_7_free',true,'usa_minutos',false,
  'misma_compra',false,'guarda_minutos',false,'codigo_1','FREE','minutos_1',7,'codigo_2',null,'minutos_2',0,
  'resumen_codigo','7 free','tiempo',7,'importe',0,'captado',false,'recuperado',false,'promo',false,
  'note_text','Primera consulta de 7 minutos FREE.','note_author_user_id',actor.user_id,'note_author_name',actor.display_name,
  'note_author_email',actor.email,'created_by_role',actor.role);
 result:=public.tc_register_call_minutes(payload);
 if result#>>'{rendimiento,id}' is null or coalesce((result->>'duplicate_prevented')::boolean,false) then raise exception 'CALL_REGISTER_FAILED'; end if;
 -- The existing trigger also records a valid first management. This explicit,
 -- idempotent attribution keeps the initial marker and never confirms capture/XP.
 assignment:=public.register_client_capture_contact(client_id,actor.id,(result#>>'{rendimiento,id}')::uuid,true,'nada','celestial');
 select coalesce(minutos_free_pendientes,0),coalesce(minutos_normales_pendientes,0)
  into after_free,after_normal from public.crm_clientes where id=client_id;
 if after_free<>before_free or after_normal<>before_normal then raise exception 'MINUTE_ACCOUNTING_MISMATCH'; end if;
 receipt:=jsonb_build_object('policy_key','initial_consultation_once_v1','minutes',7,'grant_minutes',7,'consume_minutes',7,
  'tarotista_worker_id',tarotista_id,'tarotista_name',tarotista.display_name,'benefit_event_id',event_id);
 accounting:=coalesce(result->'minute_accounting','{}'::jsonb)||jsonb_build_object('source','initial_consultation_once_v1',
  'free_before',before_free,'normal_before',before_normal,'initial_free_granted',7,'used_free',7,'used_normal',0,
  'free_after',after_free,'normal_after',after_normal);
 note_text:=format('Primera consulta: 7 minutos FREE con %s. Acreditados ahora: 7; consumidos: 7. Saldo anterior: %s FREE + %s normales. Saldo final: %s FREE + %s normales.',
  tarotista.display_name,before_free,before_normal,after_free,after_normal);
 update public.crm_client_notes set texto=note_text,
  event_data=coalesce(event_data,'{}'::jsonb)||jsonb_build_object('initial_free',receipt,'minute_accounting',accounting,
   'free_before',before_free,'free_delta',0,'free_after',after_free,'normal_before',before_normal,'normal_delta',0,'normal_after',after_normal)
  where cliente_id=client_id::text and event_data->>'rendimiento_id'=result#>>'{rendimiento,id}';
 result:=result||jsonb_build_object('initial_free',receipt,'capture_assignment',assignment,'minute_accounting',accounting,
  'balances',jsonb_build_object('free_before',before_free,'normal_before',before_normal,'free_after',after_free,'normal_after',after_normal,
   'free_delta',0,'normal_delta',0,'total_after',after_free+after_normal));
 final_receipt:=result;
 update public.crm_call_operations set result=final_receipt where operation_id=op;
 update public.tc_client_benefit_events set snapshot=snapshot||jsonb_build_object('rendimiento_id',result#>>'{rendimiento,id}','free_after',after_free,'normal_after',after_normal) where id=event_id;
 insert into public.crm_initial_consultation_gift_uses(operation_id,cliente_id,tarotista_worker_id,worker_id,minutes,benefit_event_id,rendimiento_id,request,result)
 values(op,client_id,tarotista_id,actor.id,7,event_id,(result#>>'{rendimiento,id}')::uuid,request,result);
 return result;
end $function$;
revoke all on function public.tc_initial_consultation_gift_preview(uuid),public.tc_register_initial_consultation_gift(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.tc_initial_consultation_gift_preview(uuid),public.tc_register_initial_consultation_gift(uuid,jsonb) to service_role;
