-- ============================================================
-- TAROT CELESTIAL · BENEFICIOS MANUALES · MINUTOS DE REGALO
-- Añade minutos FREE al panel de concesión manual de beneficios.
-- Los minutos normales existentes se conservan intactos.
-- ============================================================
begin;

create or replace function public.tc_admin_grant_client_benefits(
  p_actor uuid,
  p_cliente_id uuid,
  p_grant jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_operation uuid := gen_random_uuid();
  v_reason text := left(coalesce(nullif(btrim(p_grant->>'reason'),''),'Acreditación manual desde Administración'),300);
  v_coins integer := greatest(0,least(1000000,coalesce((p_grant->>'coins')::integer,0)));
  v_oracle integer := greatest(0,least(10000,coalesce((p_grant->>'oracle_credits')::integer,0)));
  v_gift_minutes integer := greatest(0,least(100000,coalesce((p_grant->>'gift_minutes')::integer,0)));
  v_l1 integer := greatest(0,least(100,coalesce((p_grant->>'roulette_level_1_spins')::integer,0)));
  v_l2 integer := greatest(0,least(100,coalesce((p_grant->>'roulette_level_2_spins')::integer,0)));
  v_l3 integer := greatest(0,least(100,coalesce((p_grant->>'roulette_level_3_spins')::integer,0)));
  v_diamond integer := greatest(0,least(100,coalesce((p_grant->>'roulette_diamond_spins')::integer,0)));
  v_before_coins integer := 0;
  v_after_coins integer := 0;
  v_before_free integer := 0;
  v_after_free integer := 0;
  v_normal_minutes integer := 0;
  v_rank jsonb;
  v_spin uuid;
  v_spin_ids jsonb := '[]'::jsonb;
  v_event uuid;
  i integer;
  lvl smallint;
  qty integer;
begin
  perform public.tc_assert_benefit_admin(p_actor);

  if p_cliente_id is null then raise exception 'INVALID_CLIENT'; end if;
  perform 1 from public.crm_clientes where id=p_cliente_id for update;
  if not found then raise exception 'INVALID_CLIENT'; end if;

  if v_coins+v_oracle+v_gift_minutes+v_l1+v_l2+v_l3+v_diamond <= 0 then
    raise exception 'INVALID_MANUAL_GRANT';
  end if;

  v_rank := public.tc_client_rank_state(p_cliente_id);

  if v_gift_minutes > 0 then
    select coalesce(minutos_free_pendientes,0), coalesce(minutos_normales_pendientes,0)
      into v_before_free, v_normal_minutes
      from public.crm_clientes
     where id=p_cliente_id
     for update;

    update public.crm_clientes
       set minutos_free_pendientes=coalesce(minutos_free_pendientes,0)+v_gift_minutes,
           updated_at=now()
     where id=p_cliente_id
     returning minutos_free_pendientes into v_after_free;

    insert into public.tc_client_benefit_events(
      cliente_id,rank_at_event,benefit_key,benefit_type,minutes,delivery_key,snapshot
    ) values (
      p_cliente_id,v_rank->>'effective','admin_manual_gift_minutes','admin_manual_grant',v_gift_minutes,
      'admin-manual:'||v_operation::text||':gift-minutes',
      jsonb_build_object(
        'operation_id',v_operation,'actor_user_id',p_actor,'reason',v_reason,'grant',p_grant,
        'minutes_before',v_before_free+v_normal_minutes,
        'minutes_after',v_after_free+v_normal_minutes,
        'free_before',v_before_free,
        'free_after',v_after_free,
        'normal_unchanged',v_normal_minutes
      )
    ) returning id into v_event;

    insert into public.crm_client_notes(
      cliente_id,texto,author_user_id,author_name,author_email,is_pinned,event_type,event_data
    ) values (
      p_cliente_id::text,
      '🎁 Administración añadió +'||v_gift_minutes||' minutos FREE. Saldo total: '||(v_before_free+v_normal_minutes)||' → '||(v_after_free+v_normal_minutes)||' minutos. Motivo: '||v_reason,
      p_actor,'Administración',null,false,'admin_manual_gift_minutes',
      jsonb_build_object('operation_id',v_operation,'benefit_event_id',v_event,'gift_minutes',v_gift_minutes,'free_before',v_before_free,'free_after',v_after_free,'normal_minutes',v_normal_minutes)
    );
  end if;

  if v_coins > 0 then
    select coalesce(puntos,0) into v_before_coins from public.crm_clientes where id=p_cliente_id for update;
    update public.crm_clientes
       set puntos=coalesce(puntos,0)+v_coins,updated_at=now()
     where id=p_cliente_id
     returning puntos into v_after_coins;

    insert into public.tc_client_benefit_events(
      cliente_id,rank_at_event,benefit_key,benefit_type,coins,delivery_key,snapshot
    ) values (
      p_cliente_id,v_rank->>'effective','admin_manual_coins','admin_manual_grant',v_coins,
      'admin-manual:'||v_operation::text||':coins',
      jsonb_build_object('operation_id',v_operation,'actor_user_id',p_actor,'reason',v_reason,'grant',p_grant)
    ) returning id into v_event;

    insert into public.cliente_puntos_historial(
      cliente_id,tipo,puntos,descripcion,operation_id,saldo_despues,meta
    ) values (
      p_cliente_id,'ganado',v_coins,'Regalo manual de Administración · '||v_reason,
      v_event,v_after_coins,
      jsonb_build_object('source','admin_manual_benefit','admin_operation_id',v_operation,'actor_user_id',p_actor,'balance_before',v_before_coins)
    );
  end if;

  if v_oracle > 0 then
    perform public.grant_cliente_oracle_credits(
      p_cliente_id,
      v_oracle,
      'admin-manual:'||v_operation::text||':oracle',
      'admin_manual',
      'Regalo manual de Administración · '||v_reason,
      jsonb_build_object('source','admin_manual_benefit','operation_id',v_operation,'actor_user_id',p_actor,'reason',v_reason)
    );

    insert into public.tc_client_benefit_events(
      cliente_id,rank_at_event,benefit_key,benefit_type,oracle_credits,delivery_key,snapshot
    ) values (
      p_cliente_id,v_rank->>'effective','admin_manual_oracle','admin_manual_grant',v_oracle,
      'admin-manual:'||v_operation::text||':oracle-event',
      jsonb_build_object('operation_id',v_operation,'actor_user_id',p_actor,'reason',v_reason,'grant',p_grant)
    );
  end if;

  for lvl,qty in
    select * from (values
      (1::smallint,v_l1),
      (2::smallint,v_l2),
      (3::smallint,v_l3),
      (4::smallint,v_diamond)
    ) as x(level,quantity)
  loop
    if qty > 0 then
      for i in 1..qty loop
        insert into public.cliente_ruleta_giros(
          cliente_id,payment_key,source,nivel,estado,required_rank
        ) values (
          p_cliente_id,
          'admin-manual:'||v_operation::text||':l'||lvl::text||':'||i::text,
          case when lvl=4 then 'admin_manual_diamond' else 'admin_manual_benefit' end,
          lvl,
          'pending',
          null
        ) returning id into v_spin;

        v_spin_ids := v_spin_ids || to_jsonb(v_spin);

        insert into public.tc_client_benefit_events(
          cliente_id,rank_at_event,benefit_key,benefit_type,spin_id,delivery_key,snapshot
        ) values (
          p_cliente_id,v_rank->>'effective',
          case when lvl=4 then 'admin_manual_roulette_diamond' else 'admin_manual_roulette_level_'||lvl::text end,
          'admin_manual_grant',v_spin,
          'admin-manual:'||v_operation::text||':spin:'||v_spin::text,
          jsonb_build_object(
            'operation_id',v_operation,'actor_user_id',p_actor,'reason',v_reason,
            'roulette_level',lvl,'diamond',lvl=4,'grant',p_grant
          )
        );
      end loop;
    end if;
  end loop;

  if v_l1+v_l2+v_l3+v_diamond > 0 then
    perform public.tc_touch_roulette_signal(p_cliente_id);
  end if;

  insert into public.cliente_notificaciones(cliente_id,tipo,titulo,mensaje,meta,leida,created_at)
  values(
    p_cliente_id,
    'admin_manual_benefit',
    'Has recibido nuevos beneficios',
    'Administración ha acreditado nuevos beneficios en tu cuenta.',
    jsonb_build_object(
      'operation_id',v_operation,'coins',v_coins,'oracle_credits',v_oracle,'gift_minutes',v_gift_minutes,
      'roulette_level_1_spins',v_l1,'roulette_level_2_spins',v_l2,
      'roulette_level_3_spins',v_l3,'roulette_diamond_spins',v_diamond,
      'reason',v_reason
    ),
    false,
    now()
  );

  return jsonb_build_object(
    'operation_id',v_operation,
    'cliente_id',p_cliente_id,
    'coins',v_coins,
    'oracle_credits',v_oracle,
    'gift_minutes',v_gift_minutes,
    'roulette_level_1_spins',v_l1,
    'roulette_level_2_spins',v_l2,
    'roulette_level_3_spins',v_l3,
    'roulette_diamond_spins',v_diamond,
    'spin_ids',v_spin_ids,
    'reason',v_reason
  );
end $$;

revoke all on function public.tc_admin_grant_client_benefits(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.tc_admin_grant_client_benefits(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
