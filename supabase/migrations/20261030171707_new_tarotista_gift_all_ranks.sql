-- Extend only the once-per-client/new-tarotist introduction, not monthly passes.
-- Preserve the activation timestamp, launches, prior receipts and operation keys.
alter table public.crm_new_tarotista_gift_policy
 drop constraint crm_new_tarotista_gift_policy_rank_minutes_check;
update public.crm_new_tarotista_gift_policy
 set rank_minutes=rank_minutes||'{"sin_rango":7,"bronce":7}'::jsonb where id;
alter table public.crm_new_tarotista_gift_policy
 alter column rank_minutes set default '{"sin_rango":7,"bronce":7,"plata":10,"oro":12,"diamante":15}'::jsonb,
 add constraint crm_new_tarotista_gift_policy_rank_minutes_check check(
  jsonb_typeof(rank_minutes)='object'
  and rank_minutes ?& array['sin_rango','bronce','plata','oro','diamante']
  and coalesce((rank_minutes->>'sin_rango')::integer between 1 and 60,false)
  and coalesce((rank_minutes->>'bronce')::integer between 1 and 60,false)
  and coalesce((rank_minutes->>'plata')::integer between 1 and 60,false)
  and coalesce((rank_minutes->>'oro')::integer between 1 and 60,false)
  and coalesce((rank_minutes->>'diamante')::integer between 1 and 60,false));
alter table public.crm_new_tarotista_gift_uses
 drop constraint crm_new_tarotista_gift_uses_effective_rank_check,
 add constraint crm_new_tarotista_gift_uses_effective_rank_check
 check(effective_rank in ('sin_rango','bronce','plata','oro','diamante'));

CREATE OR REPLACE FUNCTION public.tc_new_tarotista_gift_offer(p_cliente_id uuid, p_tarotista_worker_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r text; n integer; credit integer:=0; reason text; w public.workers%rowtype;
 rel public.crm_new_tarotista_releases%rowtype; cfg jsonb;
begin
 if not exists(select 1 from public.crm_clientes where id=p_cliente_id) then raise exception 'CLIENTE_NO_ENCONTRADO'; end if;
 select rank_minutes into cfg from public.crm_new_tarotista_gift_policy where id;
 -- Keep the global rank state unchanged; this benefit gives null rank an explicit key.
 r:=coalesce(nullif(public.tc_client_rank_state(p_cliente_id)->>'effective',''),'sin_rango');
 n:=case when r in ('sin_rango','bronce','plata','oro','diamante') then coalesce((cfg->>r)::integer,0) else 0 end;
 select * into w from public.workers where id=p_tarotista_worker_id;
 select * into rel from public.crm_new_tarotista_releases where tarotista_worker_id=p_tarotista_worker_id;
 select coalesce(e.minutes,0) into credit from public.tc_client_benefit_events e
  where e.cliente_id=p_cliente_id and e.delivery_key='diamond-new-tarotista:'||p_tarotista_worker_id::text||':'||p_cliente_id::text;
 credit:=coalesce(credit,0);
 reason:=case
  when rel.tarotista_worker_id is null or not rel.enabled then 'GIFT_NOT_AVAILABLE'
  when w.id is null or w.role is distinct from 'tarotista' or w.is_active is distinct from true then 'TAROTISTA_INACTIVE'
  when exists(select 1 from public.crm_new_tarotista_gift_uses u where u.cliente_id=p_cliente_id and u.tarotista_worker_id=p_tarotista_worker_id) then 'ALREADY_USED'
  when n<=0 then 'RANK_NOT_ELIGIBLE'
  else null end;
 return jsonb_build_object('tarotista_worker_id',p_tarotista_worker_id,'tarotista_name',w.display_name,
  'effective_rank',r,'eligible',reason is null,'reason',reason,
  'eligibility_key',p_tarotista_worker_id,'grant_minutes',n,
  'consume_minutes',n,'previous_credit_minutes',credit);
end $function$;

CREATE OR REPLACE FUNCTION public.tc_new_tarotista_gift_preview(p_cliente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r text; cfg jsonb; offers jsonb;
begin
 if not exists(select 1 from public.crm_clientes where id=p_cliente_id) then raise exception 'CLIENTE_NO_ENCONTRADO'; end if;
 -- Keep the global rank state unchanged; this benefit gives null rank an explicit key.
 r:=coalesce(nullif(public.tc_client_rank_state(p_cliente_id)->>'effective',''),'sin_rango');
 select rank_minutes into cfg from public.crm_new_tarotista_gift_policy where id;
 select coalesce(jsonb_agg(public.tc_new_tarotista_gift_offer(p_cliente_id,x.tarotista_worker_id) order by x.released_at desc,x.tarotista_worker_id),'[]'::jsonb)
  into offers from public.crm_new_tarotista_releases x where x.enabled;
 return jsonb_build_object('effective_rank',r,'minutes',case when r in ('sin_rango','bronce','plata','oro','diamante') then coalesce((cfg->>r)::integer,0) else 0 end,
  'policy_key','new_tarotista_once_v1','offers',offers);
end $function$;

CREATE OR REPLACE FUNCTION public.tc_register_new_tarotista_gift(p_user uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
 actor public.workers%rowtype; tarotista public.workers%rowtype; c public.crm_clientes%rowtype;
 op uuid; client_id uuid; tarotista_id uuid; request jsonb; previous public.crm_new_tarotista_gift_uses%rowtype;
 offer jsonb; r text; minutes integer; granted integer; credit_event uuid; event_id uuid;
 payload jsonb; result jsonb; final_receipt jsonb; receipt jsonb; accounting jsonb; before_free numeric; before_normal numeric;
 after_free numeric; after_normal numeric; note_text text;
begin
 select * into actor from public.workers where user_id=p_user and role in ('central','admin') and is_active is true;
 if actor.id is null then raise exception 'FORBIDDEN'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'INVALID_RANK_FREE_REQUEST'; end if;
 op:=nullif(p_payload->>'operation_id','')::uuid;
 client_id:=nullif(p_payload->>'cliente_id','')::uuid;
 tarotista_id:=nullif(p_payload->>'tarotista_worker_id','')::uuid;
 if op is null or client_id is null or tarotista_id is null
    or p_payload->>'rank_free_eligibility_key' is distinct from tarotista_id::text
    or coalesce(p_payload->>'rank_free_expected_rank','') not in ('sin_rango','bronce','plata','oro','diamante')
    or coalesce(p_payload->>'rank_free_expected_minutes','') !~ '^[1-9][0-9]?$'
    or coalesce((p_payload->>'cliente_compra_minutos')::boolean,false)
    or coalesce((p_payload->>'usa_7_free')::boolean,false)
    or coalesce((p_payload->>'captado')::boolean,false)
    or coalesce((p_payload->>'recuperado')::boolean,false)
    or coalesce((p_payload->>'importe')::numeric,0)<>0
    or nullif(p_payload->>'tarotista_manual_call','') is not null
    or nullif(p_payload->>'collaborator_source','') is not null
    or nullif(p_payload->>'existing_payment_id','') is not null
    or nullif(p_payload->>'paypal_collection_order_id','') is not null
    or coalesce(p_payload->>'clasificacion','nada')<>'nada'
 then raise exception 'INVALID_RANK_FREE_REQUEST'; end if;
 request:=jsonb_build_object('client',client_id,'worker',actor.id,'tarotista',tarotista_id,
  'expected_rank',p_payload->>'rank_free_expected_rank','expected_minutes',(p_payload->>'rank_free_expected_minutes')::integer,
  'eligibility_key',p_payload->>'rank_free_eligibility_key','policy','new_tarotista_once_v1');
 -- Same first lock as the canonical minute RPC. Replay precedes current-rank checks.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(op::text,0));
 select * into previous from public.crm_new_tarotista_gift_uses where operation_id=op;
 if found then
  if previous.request<>request then raise exception 'PAYMENT_OPERATION_CONFLICT'; end if;
  return previous.result||jsonb_build_object('duplicate_prevented',true);
 end if;
 if exists(select 1 from public.crm_call_operations where operation_id=op) then raise exception 'PAYMENT_OPERATION_CONFLICT'; end if;
 select * into c from public.crm_clientes where id=client_id for update;
 if not found then raise exception 'CLIENTE_NO_ENCONTRADO'; end if;
 if exists(select 1 from public.crm_new_tarotista_gift_uses where cliente_id=client_id and tarotista_worker_id=tarotista_id) then raise exception 'ALREADY_USED'; end if;
 offer:=public.tc_new_tarotista_gift_offer(client_id,tarotista_id);
 if offer->>'reason' is not null then raise exception '%',offer->>'reason'; end if;
 r:=offer->>'effective_rank';minutes:=(offer->>'consume_minutes')::integer;
 if r is distinct from p_payload->>'rank_free_expected_rank'
    or minutes is distinct from (p_payload->>'rank_free_expected_minutes')::integer then raise exception 'RANK_CHANGED'; end if;
 select * into tarotista from public.workers where id=tarotista_id and role='tarotista' and is_active is true;
 if not found then raise exception 'TAROTISTA_INACTIVE'; end if;
 select e.id into credit_event from public.tc_client_benefit_events e
  where e.cliente_id=client_id and e.delivery_key='diamond-new-tarotista:'||tarotista_id::text||':'||client_id::text and coalesce(e.minutes,0)>0;
 -- The old Diamond event is audit context only. This is a distinct once-per-pair
 -- allowance: grant and consume N now without depending on the existing wallet.
 granted:=minutes;
 before_free:=coalesce(c.minutos_free_pendientes,0);before_normal:=coalesce(c.minutos_normales_pendientes,0);
 insert into public.tc_client_benefit_events(cliente_id,rank_at_event,benefit_key,benefit_type,minutes,delivery_key,snapshot)
 values(client_id,r,'new_tarotista_consultation','minutes',granted,'new-tarotista-call:'||tarotista_id::text||':'||client_id::text,
  jsonb_build_object('source','new_tarotista_once_v1','operation_id',op,'tarotista_worker_id',tarotista_id,'rank',r,
   'grant_minutes',granted,'consume_minutes',minutes,'previous_credit_event_id',credit_event,'free_before',before_free)) returning id into event_id;
 if granted>0 then
  update public.crm_clientes set minutos_free_pendientes=coalesce(minutos_free_pendientes,0)+granted,updated_at=now() where id=client_id;
 end if;
 payload:=jsonb_build_object('operation_id',op,'cliente_id',client_id,'cliente_nombre',concat_ws(' ',c.nombre,c.apellido),
  'telefonista_worker_id',actor.id,'telefonista_nombre',actor.display_name,'tarotista_worker_id',tarotista_id,'tarotista_nombre',tarotista.display_name,
  'tipo_registro','minutos','cliente_compra_minutos',false,'usa_7_free',false,'usa_minutos',true,
  'misma_compra',false,'guarda_minutos',false,'codigo_1','FREE','minutos_1',minutes,'codigo_2',null,'minutos_2',0,
  'resumen_codigo',minutes||' free','tiempo',minutes,'importe',0,'captado',false,'recuperado',false,'promo',false,
  'note_text','Consulta de bienvenida con nueva tarotista.','note_author_user_id',actor.user_id,'note_author_name',actor.display_name,
  'note_author_email',actor.email,'created_by_role',actor.role);
 result:=public.tc_register_call_minutes(payload);
 if result#>>'{rendimiento,id}' is null or coalesce((result->>'duplicate_prevented')::boolean,false) then raise exception 'CALL_REGISTER_FAILED'; end if;
 select coalesce(minutos_free_pendientes,0),coalesce(minutos_normales_pendientes,0)
 into after_free,after_normal from public.crm_clientes where id=client_id;
 if after_free<>before_free+granted-minutes or after_normal<>before_normal then raise exception 'MINUTE_ACCOUNTING_MISMATCH'; end if;
 receipt:=jsonb_build_object('effective_rank',r,'minutes',minutes,'policy_key','new_tarotista_once_v1',
  'tarotista_worker_id',tarotista_id,'tarotista_name',tarotista.display_name,'benefit_event_id',event_id,
  'grant_minutes',granted,'consume_minutes',minutes,'previous_credit_event_id',credit_event);
 accounting:=coalesce(result->'minute_accounting','{}'::jsonb)||jsonb_build_object('source','new_tarotista_once_v1',
  'free_before',before_free,'normal_before',before_normal,'rank_free_granted',granted,'used_free',minutes,'used_normal',0,
  'free_after',after_free,'normal_after',after_normal,'previous_credit_event_id',credit_event);
 note_text:=format('Consulta con nueva tarotista: %s. Rango %s: %s minutos FREE. Acreditados ahora: %s; consumidos: %s. Saldo anterior: %s FREE + %s normales. Saldo final: %s FREE + %s normales.',
  tarotista.display_name,r,minutes,granted,minutes,before_free,before_normal,after_free,after_normal);
 update public.crm_client_notes set texto=note_text,
  event_data=coalesce(event_data,'{}'::jsonb)||jsonb_build_object('rank_free',receipt,'minute_accounting',accounting,
   'free_before',before_free,'free_delta',after_free-before_free,'free_after',after_free,
   'normal_before',before_normal,'normal_delta',0,'normal_after',after_normal)
  where cliente_id=client_id::text and event_data->>'rendimiento_id'=result#>>'{rendimiento,id}';
 result:=result||jsonb_build_object('rank_free',receipt,'minute_accounting',accounting,
  'balances',jsonb_build_object('free_before',before_free,'normal_before',before_normal,'free_after',after_free,'normal_after',after_normal,
   'free_delta',after_free-before_free,'normal_delta',0,'total_after',after_free+after_normal));
 -- Finish the receipt created by the inner call in this same transaction.
 final_receipt:=result;
 update public.crm_call_operations set result=final_receipt where operation_id=op;
 update public.tc_client_benefit_events set snapshot=snapshot||jsonb_build_object('rendimiento_id',result#>>'{rendimiento,id}','free_after',after_free,'normal_after',after_normal) where id=event_id;
 insert into public.crm_new_tarotista_gift_uses(operation_id,cliente_id,tarotista_worker_id,worker_id,effective_rank,minutes,granted_minutes,
 previous_credit_event_id,benefit_event_id,rendimiento_id,request,result)
 values(op,client_id,tarotista_id,actor.id,r,minutes,granted,credit_event,event_id,(result#>>'{rendimiento,id}')::uuid,request,result);
 return result;
end $function$;

-- Preserve the service-only contract; rank state, monthly passes and 7FREE capture are untouched.
-- Informational copies follow this policy only. Information rules are excluded
-- from both purchase evaluation and once/monthly benefit claims.
with descriptions as (
 select entry.key as rank,
  format('%s minutos FREE para conocer a una nueva tarotista, una vez por cliente y tarotista habilitada. Se registran desde Central o Administración, incluso con saldo cero. Este regalo es independiente de los pases mensuales.',entry.value) as description
 from public.crm_new_tarotista_gift_policy cfg,
 jsonb_each_text(cfg.rank_minutes) entry
 where cfg.id and entry.key in ('bronce','plata','oro','diamante')
)
update public.client_benefit_rules r
set description=d.description,revision=r.revision+1,updated_at=now()
from descriptions d
where r.rank=d.rank and r.name='Primera consulta con nueva tarotista'
 and r.event='information' and r.archived_at is null
 and r.description is distinct from d.description;

insert into public.client_benefit_rules(name,description,rank,event,claim_mode,scope,active)
select 'Primera consulta con nueva tarotista',
 '7 minutos FREE para conocer a una nueva tarotista, una vez por cliente y tarotista habilitada. Se registran desde Central o Administración, incluso con saldo cero. Este regalo es independiente de los pases mensuales.',
 'bronce','information','claim','all',true
where not exists(select 1 from public.client_benefit_rules
 where name='Primera consulta con nueva tarotista' and rank='bronce'
 and event='information' and archived_at is null);
-- No sin_rango rule row: this informational catalog's global rank enum stays intact.
revoke all on function public.tc_new_tarotista_gift_offer(uuid,uuid),public.tc_new_tarotista_gift_preview(uuid),public.tc_register_new_tarotista_gift(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.tc_new_tarotista_gift_offer(uuid,uuid),public.tc_new_tarotista_gift_preview(uuid),public.tc_register_new_tarotista_gift(uuid,jsonb) to service_role;
