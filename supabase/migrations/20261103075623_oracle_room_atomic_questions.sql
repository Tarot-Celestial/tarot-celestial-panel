-- Additive, server-only entry points. No existing credits, readings or messages change.
create or replace function public.tc_oracle_answer_question(
  p_cliente_id uuid, p_draw_id text, p_question text, p_answer text
) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_draw public.cliente_oraculo_diario%rowtype;
  v_question text := btrim(p_question);
  v_answer text;
  v_source text;
  v_extra integer;
  v_order bigint;
begin
  if p_cliente_id is null or nullif(v_question, '') is null or length(v_question) > 500
     or nullif(btrim(p_answer), '') is null or length(p_answer) > 12000 then
    raise exception 'INVALID_ORACLE_QUESTION';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_cliente_id::text || ':oracle-question', 0));
  select * into v_draw from public.cliente_oraculo_diario
    where id = p_draw_id::uuid and cliente_id = p_cliente_id for update;
  if not found then raise exception 'DRAW_NOT_FOUND'; end if;

  -- Recover an already committed pair after a lost response, before charging again.
  select a.contenido into v_answer
    from public.cliente_oraculo_mensajes u
    join public.cliente_oraculo_mensajes a
      on a.cliente_id = u.cliente_id and a.draw_id = u.draw_id
      and a.message_order = u.message_order + 1 and a.role = 'assistant'
    where u.cliente_id = p_cliente_id and u.draw_id = p_draw_id
      and u.role = 'user' and u.contenido = v_question
    order by u.message_order desc limit 1;
  if found then return jsonb_build_object('answer', v_answer, 'replayed', true); end if;

  select source, extra_balance into v_source, v_extra
    from public.consume_cliente_oracle_question(p_cliente_id, p_draw_id);
  select greatest((extract(epoch from clock_timestamp()) * 1000000)::bigint,
    coalesce(max(message_order), 0) + 2) into v_order
    from public.cliente_oraculo_mensajes where cliente_id = p_cliente_id and draw_id = p_draw_id;
  insert into public.cliente_oraculo_mensajes
    (cliente_id, draw_id, fecha, tema, role, contenido, question_source, message_order, created_at)
  values
    (p_cliente_id, p_draw_id, v_draw.fecha, v_draw.tema, 'user', v_question, v_source, v_order, clock_timestamp()),
    (p_cliente_id, p_draw_id, v_draw.fecha, v_draw.tema, 'assistant', p_answer, v_source, v_order + 1, clock_timestamp());
  return jsonb_build_object('answer', p_answer, 'replayed', false, 'source', v_source, 'extraBalance', v_extra);
end;
$$;
revoke all on function public.tc_oracle_answer_question(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.tc_oracle_answer_question(uuid,text,text,text) to service_role;

create or replace function public.reserve_cliente_oracle_draw_v2(
  p_cliente_id uuid, p_draw_key text, p_draw_type text, p_shuffle_id text,
  p_question text, p_context text, p_required_cards integer, p_notes text
) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp
as $$
begin
  if p_cliente_id is null then raise exception 'CLIENT_REQUIRED'; end if;
  -- Serializes the legacy active-session check and reservation for this customer.
  perform pg_advisory_xact_lock(hashtextextended(p_cliente_id::text || ':oracle-draw', 0));
  return public.reserve_cliente_oracle_draw(p_cliente_id, p_draw_key, p_draw_type,
    p_shuffle_id, p_question, p_context, p_required_cards, p_notes);
end;
$$;
revoke all on function public.reserve_cliente_oracle_draw_v2(uuid,text,text,text,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.reserve_cliente_oracle_draw_v2(uuid,text,text,text,text,text,integer,text) to service_role;
