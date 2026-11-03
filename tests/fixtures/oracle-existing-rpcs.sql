-- Snapshot of the existing Oracle RPCs, read 2026-11-03. No production data.
CREATE OR REPLACE FUNCTION public.consume_cliente_oracle_credit(p_cliente_id uuid, p_draw_key text, p_draw_type text, p_notes text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_balance integer;
  v_reference text := 'draw:' || p_draw_key;
begin
  -- Serializa consumos del mismo cliente para impedir doble gasto concurrente.
  perform pg_advisory_xact_lock(hashtext(p_cliente_id::text));

  if exists (select 1 from public.cliente_oracle_credit_movements where reference = v_reference) then
    return public.get_cliente_oracle_balance(p_cliente_id);
  end if;

  select public.get_cliente_oracle_balance(p_cliente_id) into v_balance;
  if v_balance < 1 then raise exception 'NO_ORACLE_CREDITS'; end if;

  insert into public.cliente_oracle_credit_movements
    (cliente_id, amount, movement_type, reference, draw_type, notes)
  values
    (p_cliente_id, -1, 'draw', v_reference, p_draw_type, p_notes);

  return v_balance - 1;
end;
$function$;

CREATE OR REPLACE FUNCTION public.consume_cliente_oracle_question(p_cliente_id uuid, p_draw_id text)
 RETURNS TABLE(source text, extra_balance integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_used timestamptz;
  v_balance integer;
begin
  -- Serializa por cliente para impedir doble consumo entre pestañas/peticiones.
  perform pg_advisory_xact_lock(hashtextextended(p_cliente_id::text || ':oracle-question', 0));

  select cliente_id, included_question_used_at into v_owner, v_used
  from public.cliente_oraculo_diario where id::text = p_draw_id for update;
  if v_owner is null or v_owner <> p_cliente_id then raise exception 'DRAW_NOT_FOUND'; end if;

  if v_used is null then
    update public.cliente_oraculo_diario set included_question_used_at = now() where id::text = p_draw_id;
    source := 'included';
    extra_balance := public.get_cliente_oracle_question_balance(p_cliente_id);
    return next; return;
  end if;

  v_balance := public.get_cliente_oracle_question_balance(p_cliente_id);
  if v_balance <= 0 then raise exception 'NO_ORACLE_QUESTIONS'; end if;

  insert into public.cliente_oracle_question_movements(cliente_id,amount,movement_type,reference,draw_id,notes)
  values(p_cliente_id,-1,'consume','question:' || gen_random_uuid()::text,p_draw_id,'Pregunta adicional consumida');
  source := 'extra';
  extra_balance := v_balance - 1;
  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_cliente_oracle_question_balance(p_cliente_id uuid)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select greatest(0, coalesce(sum(amount),0)::integer)
  from public.cliente_oracle_question_movements
  where cliente_id = p_cliente_id;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_cliente_oracle_draw(p_cliente_id uuid, p_draw_key text, p_draw_type text, p_shuffle_id text, p_question text, p_context text, p_required_cards integer, p_notes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_balance integer; v_session public.cliente_oracle_draw_sessions;
begin
  select * into v_session from public.cliente_oracle_draw_sessions where cliente_id=p_cliente_id and status in ('created','started','in_progress','failed') order by updated_at desc limit 1;
  if found then return jsonb_build_object('balance', public.get_cliente_oracle_balance(p_cliente_id), 'session', to_jsonb(v_session), 'resumed', true); end if;
  v_balance := public.consume_cliente_oracle_credit(p_cliente_id,p_draw_key,p_draw_type,p_notes);
  insert into public.cliente_oracle_draw_sessions(cliente_id,draw_key,draw_type,shuffle_id,question,context,required_cards,status,credit_reserved)
  values(p_cliente_id,p_draw_key,p_draw_type,p_shuffle_id,p_question,nullif(p_context,''),p_required_cards,'in_progress',true) returning * into v_session;
  return jsonb_build_object('balance',v_balance,'session',to_jsonb(v_session),'resumed',false);
end $function$;