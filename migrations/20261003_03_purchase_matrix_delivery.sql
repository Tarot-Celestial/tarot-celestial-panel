-- ============================================================
-- TAROT CELESTIAL · ENTREGA REAL RANGO x NIVEL DE PAQUETE
-- 03 · INTEGRACIÓN CON EL TRIGGER NATIVO YA EXISTENTE
--
-- IMPORTANTE:
--   NO crea un segundo trigger de entrega en crm_cliente_pagos.
--   Reutiliza tc_purchase_benefits -> tc_apply_purchase_benefits(uuid).
--
-- Regla de sustitución/acumulación:
--   * Beneficios NATIVOS del pack/promoción se conservan y se acumulan.
--   * Para pagos con nivel de paquete administrado, la matriz sustituye SOLO
--     los antiguos beneficios globales de rango (purchase_coins/rank_roulette),
--     evitando doble acreditación.
--   * Pagos sin nivel administrado conservan el comportamiento histórico.
-- ============================================================
begin;

do $$ begin
  if to_regprocedure('public.tc_apply_purchase_benefits(uuid)') is null then raise exception 'MISSING_REQUIRED_FUNCTION: tc_apply_purchase_benefits(uuid)'; end if;
  if to_regprocedure('public.grant_cliente_oracle_credits(uuid,integer,text,text,text,jsonb)') is null then raise exception 'MISSING_REQUIRED_FUNCTION: grant_cliente_oracle_credits'; end if;
  if to_regclass('public.tc_rank_package_benefits') is null then raise exception 'MISSING_MIGRATION_01'; end if;
  if to_regclass('public.tc_purchase_package_levels') is null then raise exception 'MISSING_MIGRATION_01'; end if;
end $$;

create or replace function public.tc_apply_rank_package_benefits(p_payment_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  p public.crm_cliente_pagos%rowtype;
  rank_state jsonb;
  rank_key text;
  package_source text;
  package_key text;
  package_level smallint;
  cfg public.tc_rank_package_benefits;
  ev uuid;
  i integer;
  spin_id uuid;
  spin_ids jsonb:='[]'::jsonb;
  existing jsonb;
  status text;
  snapshot jsonb;
begin
  select * into p from public.crm_cliente_pagos where id=p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;

  select e.snapshot into existing
  from public.tc_client_benefit_events e
  where e.delivery_key='rank-package:'||p.id::text
  limit 1;
  if existing is not null then return existing||jsonb_build_object('duplicate_prevented',true); end if;

  if lower(coalesce(p.estado,''))<>'completed' or coalesce(p.importe,0)<=0 then
    return jsonb_build_object('status','payment_not_completed');
  end if;

  package_source:=case when coalesce(p.pack_id,'') like 'promo:%' then 'promotion' else 'standard' end;
  package_key:=case when package_source='promotion' then substring(p.pack_id from 7) else p.pack_id end;

  select x.package_level into package_level
  from public.tc_purchase_package_levels x
  where x.package_source=package_source and x.package_key=package_key;

  rank_state:=public.tc_client_rank_state(p.cliente_id);
  rank_key:=nullif(rank_state->>'effective','');

  if package_level is null then status:='unmapped_package';
  elsif rank_key is null then status:='no_effective_rank';
  else
    select * into cfg from public.tc_rank_package_benefits b where b.rank_key=rank_key and b.package_level=package_level;
    if not found then status:='config_missing';
    elsif not cfg.enabled then status:='disabled';
    else status:='delivered'; end if;
  end if;

  snapshot:=jsonb_build_object(
    'status',status,'payment_id',p.id,'rank_state',rank_state,'rank_key',rank_key,
    'package_source',package_source,'package_key',package_key,'package_level',package_level,
    'config',case when cfg.rank_key is not null then to_jsonb(cfg) else null end,
    'native_benefits_context',p.benefits_context
  );

  insert into public.tc_client_benefit_events(
    cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,purchase_amount,currency,
    coins,oracle_credits,package_level,delivery_key,snapshot
  ) values(
    p.cliente_id,p.id,rank_key,'rank_package:'||coalesce(package_level::text,'none'),'rank_package',p.importe,p.moneda,
    case when status='delivered' then cfg.coins else 0 end,
    case when status='delivered' then cfg.oracle_credits else 0 end,
    package_level,'rank-package:'||p.id::text,snapshot
  ) returning id into ev;

  if status<>'delivered' then
    return snapshot;
  end if;

  if cfg.coins>0 then
    update public.crm_clientes set puntos=coalesce(puntos,0)+cfg.coins,updated_at=now() where id=p.cliente_id;
    insert into public.cliente_puntos_historial(cliente_id,tipo,puntos,descripcion,meta)
    values(p.cliente_id,'ganado',cfg.coins,'Beneficio de rango · paquete nivel '||package_level,jsonb_build_object('payment_id',p.id,'benefit_event_id',ev,'rank',rank_key,'package_level',package_level));
  end if;

  if cfg.oracle_credits>0 then
    perform public.grant_cliente_oracle_credits(p.cliente_id,cfg.oracle_credits,'rank-package:'||p.id::text||':oracle','rank_package','Beneficio de rango por compra',jsonb_build_object('payment_id',p.id,'benefit_event_id',ev,'package_level',package_level,'rank',rank_key));
  end if;

  for i in 1..cfg.roulette_level_1_spins loop
    insert into public.cliente_ruleta_giros(cliente_id,payment_key,source,nivel,purchase_id,purchase_amount,purchase_currency,estado,required_rank)
    values(p.cliente_id,'rank-package:'||p.id::text||':l1:'||i,'rank_package_matrix',1,p.id,p.importe,p.moneda,'pending',rank_key) returning id into spin_id;
    spin_ids:=spin_ids||to_jsonb(spin_id);
  end loop;
  for i in 1..cfg.roulette_level_2_spins loop
    insert into public.cliente_ruleta_giros(cliente_id,payment_key,source,nivel,purchase_id,purchase_amount,purchase_currency,estado,required_rank)
    values(p.cliente_id,'rank-package:'||p.id::text||':l2:'||i,'rank_package_matrix',2,p.id,p.importe,p.moneda,'pending',rank_key) returning id into spin_id;
    spin_ids:=spin_ids||to_jsonb(spin_id);
  end loop;
  for i in 1..cfg.roulette_level_3_spins loop
    insert into public.cliente_ruleta_giros(cliente_id,payment_key,source,nivel,purchase_id,purchase_amount,purchase_currency,estado,required_rank)
    values(p.cliente_id,'rank-package:'||p.id::text||':l3:'||i,'rank_package_matrix',3,p.id,p.importe,p.moneda,'pending',rank_key) returning id into spin_id;
    spin_ids:=spin_ids||to_jsonb(spin_id);
  end loop;
  for i in 1..cfg.roulette_special_spins loop
    insert into public.cliente_ruleta_giros(cliente_id,payment_key,source,nivel,purchase_id,purchase_amount,purchase_currency,estado,required_rank)
    values(p.cliente_id,'rank-package:'||p.id::text||':l4:'||i,'rank_package_matrix',4,p.id,p.importe,p.moneda,'pending',rank_key) returning id into spin_id;
    spin_ids:=spin_ids||to_jsonb(spin_id);
  end loop;

  snapshot:=snapshot||jsonb_build_object('delivered',jsonb_build_object('coins',cfg.coins,'oracle_credits',cfg.oracle_credits,'spin_ids',spin_ids));
  update public.tc_client_benefit_events set snapshot=snapshot where id=ev;
  perform public.tc_touch_roulette_signal(p.cliente_id);
  insert into public.cliente_notificaciones(cliente_id,tipo,titulo,mensaje,meta,leida,created_at)
  values(p.cliente_id,'rank_package_benefits','Beneficios de rango aplicados','Tus beneficios adicionales por rango y nivel de paquete ya están disponibles.',jsonb_build_object('payment_id',p.id,'rank',rank_key,'package_level',package_level,'benefit_event_id',ev),false,now());
  return snapshot;
exception when unique_violation then
  select e.snapshot into existing from public.tc_client_benefit_events e where e.delivery_key='rank-package:'||p_payment_id::text limit 1;
  if existing is not null then return existing||jsonb_build_object('duplicate_prevented',true); end if;
  raise;
end $$;

-- Sustituye la función REAL existente preservando todos sus beneficios nativos.
-- Para pagos mapeados a Nivel 1/2/3, los antiguos bonus globales de rango se
-- suprimen y se aplica la matriz. Para pagos no mapeados, el legado sigue igual.
create or replace function public.tc_apply_purchase_benefits(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare p public.crm_cliente_pagos%rowtype; r jsonb; cfg jsonb; ctx jsonb; q jsonb; k text;
  base_coins integer; bonus_coins integer; oc integer; n integer; lvl smallint; s uuid; e uuid; i integer;
  v_package_source text; v_package_key text; v_package_level smallint; v_matrix boolean:=false; v_matrix_result jsonb:='{}'::jsonb;
begin
  select * into p from public.crm_cliente_pagos where id=p_payment_id;
  if p.id is null then raise exception 'PAYMENT_NOT_FOUND'; end if;
  perform 1 from public.crm_clientes where id=p.cliente_id for update;
  select * into p from public.crm_cliente_pagos where id=p_payment_id for update;
  if p.estado<>'completed' or p.importe<=0 or p.benefits_processed_at is not null then return '{}'::jsonb; end if;

  v_package_source:=case when coalesce(p.pack_id,'') like 'promo:%' then 'promotion' else 'standard' end;
  v_package_key:=case when v_package_source='promotion' then substring(p.pack_id from 7) else p.pack_id end;
  select x.package_level into v_package_level from public.tc_purchase_package_levels x
   where x.package_source=v_package_source and x.package_key=v_package_key;
  v_matrix:=v_package_level is not null;

  r:=public.tc_client_rank_state(p.cliente_id); cfg:=r->'config'; ctx:=p.benefits_context;
  base_coins:=greatest(coalesce((ctx->>'coins')::integer,0),0);
  bonus_coins:=case when not v_matrix and (cfg->>'is_active')::boolean and (cfg->>'coins_enabled')::boolean then (cfg->>'purchase_coins')::integer else 0 end;
  oc:=greatest(coalesce((ctx->>'oracle_credits')::integer,0),0);
  if base_coins>0 or bonus_coins>0 then
    update public.crm_clientes set puntos=coalesce(puntos,0)+base_coins+bonus_coins,updated_at=now() where id=p.cliente_id;
  end if;
  for k,n in select * from (values('pack_coins',base_coins),('rank_coins',bonus_coins)) v(k,n) loop
    if n>0 then
      insert into public.tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,purchase_amount,currency,coins,snapshot)
      values(p.cliente_id,p.id,r->>'effective',k,'coins',p.importe,p.moneda,n,jsonb_build_object('config',cfg,'context',ctx)) returning id into e;
      insert into public.cliente_puntos_historial(cliente_id,tipo,puntos,descripcion,operation_id,saldo_despues,meta)
      select p.cliente_id,'ganado',n,case when k='rank_coins' then 'Beneficio de rango · '||coalesce(cfg->>'label','') else 'Beneficio del pack' end,
        e,round(coalesce(c.puntos,0)-case when k='pack_coins' then bonus_coins else 0 end)::integer,jsonb_build_object('payment_id',p.id,'benefit_event_id',e,'rank',r->>'effective')
      from public.crm_clientes c where c.id=p.cliente_id;
    end if;
  end loop;
  if oc>0 then
    insert into public.cliente_oracle_credit_movements(cliente_id,amount,movement_type,reference,pack_id,notes,meta)
    values(p.cliente_id,oc,'purchase','benefit:'||p.id||':oracle',coalesce(p.pack_id,'purchase'),'Beneficio de compra',jsonb_build_object('payment_id',p.id)) on conflict(reference) do nothing;
    insert into public.tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,purchase_amount,currency,oracle_credits,snapshot)
    values(p.cliente_id,p.id,r->>'effective','pack_oracle','oracle_credits',p.importe,p.moneda,oc,ctx);
  end if;
  q:=public.tc_purchase_benefit_quote(p.importe,p.moneda);
  for k,lvl,n in select * from (values
    ('purchase_roulette',case when coalesce((ctx->>'special_spins')::integer,0)>0 then 4::smallint else (q->>'roulette_level')::smallint end,
      case when coalesce((ctx->>'special_spins')::integer,0)>0 then (ctx->>'special_spins')::integer else coalesce((q->>'roulette_spins')::integer,0) end),
    ('rank_roulette',(cfg->>'roulette_level')::smallint,
      case when not v_matrix and (cfg->>'is_active')::boolean and (cfg->>'roulette_enabled')::boolean then (cfg->>'roulette_spins')::integer else 0 end)
  ) v(k,lvl,n) loop
    if lvl is not null and n>0 then
      for i in 1..n loop
        insert into public.cliente_ruleta_giros(cliente_id,payment_key,source,nivel,purchase_id,purchase_amount,purchase_currency,estado,required_rank)
        values(p.cliente_id,'benefit:'||p.id||':'||k||':'||i,'rank_benefits',lvl,p.id,p.importe,p.moneda,'pending',
          case when k='rank_roulette' then r->>'effective' end) returning id into s;
        insert into public.tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,purchase_amount,currency,spin_id,snapshot)
        values(p.cliente_id,p.id,r->>'effective',k||':'||i,'roulette',p.importe,p.moneda,s,jsonb_build_object('level',lvl,'band',q,'config',cfg,'context',ctx));
      end loop;
    end if;
  end loop;

  if v_matrix then
    v_matrix_result:=public.tc_apply_rank_package_benefits(p.id);
  end if;

  update public.crm_cliente_pagos set benefits_processed_at=now() where id=p.id;
  insert into public.tc_client_benefit_events(cliente_id,payment_id,rank_at_event,benefit_key,benefit_type,purchase_amount,currency,snapshot)
  values(p.cliente_id,p.id,r->>'effective','purchase_processed','processed',p.importe,p.moneda,jsonb_build_object('rank_state',r,'context',ctx,'rank_package_matrix',v_matrix_result));
  insert into public.cliente_notificaciones(cliente_id,tipo,titulo,mensaje,meta,leida,created_at)
  values(p.cliente_id,'purchase_benefits','Beneficios de compra actualizados','Los beneficios de tu compra ya están disponibles en tu saldo y en tus ruletas.',
    jsonb_build_object('payment_id',p.id,'rank',r->>'effective','coins',base_coins+bonus_coins,'rank_package_matrix',v_matrix_result),false,now());
  perform public.tc_touch_roulette_signal(p.cliente_id);
  return jsonb_build_object('rank',r->>'effective','coins',base_coins+bonus_coins,'oracle_credits',oc,'rank_package_matrix',v_matrix_result);
end $function$;

-- Cancelaciones/devoluciones: no se destruyen recompensas ya consumidas.
-- Se marca la entrega para revisión/auditoría; la política de reversión queda
-- separada de la desactivación de futuras entregas.
create or replace function public.tc_rank_package_refund_marker()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' and lower(coalesce(old.estado,''))='completed' and lower(coalesce(new.estado,''))<>'completed' then
    update public.tc_client_benefit_events
       set snapshot=coalesce(snapshot,'{}'::jsonb)||jsonb_build_object(
         'refund_review',jsonb_build_object('payment_status',new.estado,'marked_at',now(),'automatic_reversal',false)
       )
     where payment_id=new.id and benefit_type='rank_package';
  end if;
  return new;
end $$;

drop trigger if exists trg_tc_rank_package_refund_marker on public.crm_cliente_pagos;
create trigger trg_tc_rank_package_refund_marker
after update of estado on public.crm_cliente_pagos
for each row execute function public.tc_rank_package_refund_marker();

revoke all on function public.tc_apply_rank_package_benefits(uuid),public.tc_rank_package_refund_marker() from public,anon,authenticated;
grant execute on function public.tc_apply_rank_package_benefits(uuid) to service_role;
notify pgrst,'reload schema';
commit;
