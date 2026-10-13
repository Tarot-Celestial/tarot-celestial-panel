-- Additive, service-role-only Leonaris companion memory. Existing CRM/Leo data is untouched.
create table if not exists public.tc_client_leo_companion_state (
  client_id uuid primary key references public.crm_clientes(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  memory_enabled boolean not null default true,
  style text not null default 'warm' check (style in ('warm','concise')),
  signal_seen_at jsonb not null default '{}'::jsonb check (jsonb_typeof(signal_seen_at) = 'object'),
  helpful_count integer not null default 0 check (helpful_count >= 0),
  unhelpful_count integer not null default 0 check (unhelpful_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tc_client_leo_companion_state add column if not exists signal_seen_at jsonb not null default '{}'::jsonb;
create table if not exists public.tc_client_leo_memories (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.tc_client_leo_companion_state(client_id) on delete cascade,
  content text not null check (char_length(content) between 1 and 400),
  created_at timestamptz not null default now(),
  unique(client_id, content)
);
create index if not exists tc_client_leo_memories_client_created_idx on public.tc_client_leo_memories(client_id, created_at desc, id);
create table if not exists public.tc_client_leo_chat_requests (
  client_id uuid not null references public.tc_client_leo_companion_state(client_id) on delete cascade,
  request_id uuid not null,
  question text check (question is null or char_length(question) between 1 and 2000),
  question_hash text not null,
  status text not null default 'processing' check (status in ('processing','completed','failed')),
  claim_token uuid not null default gen_random_uuid(),
  attempts integer not null default 1 check (attempts between 1 and 60),
  memory_retained boolean not null,
  answer jsonb check (answer is null or jsonb_typeof(answer) = 'object'),
  feedback boolean,
  reply_expires_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key(client_id, request_id)
);
create index if not exists tc_client_leo_chat_requests_client_started_idx on public.tc_client_leo_chat_requests(client_id, started_at desc);
create index if not exists tc_client_leo_chat_requests_client_completed_idx on public.tc_client_leo_chat_requests(client_id, completed_at desc) where status = 'completed';
alter table public.tc_client_leo_companion_state enable row level security;
alter table public.tc_client_leo_memories enable row level security;
alter table public.tc_client_leo_chat_requests enable row level security;
revoke all on public.tc_client_leo_companion_state, public.tc_client_leo_memories, public.tc_client_leo_chat_requests from public, anon, authenticated;
grant select, insert, update, delete on public.tc_client_leo_companion_state, public.tc_client_leo_memories, public.tc_client_leo_chat_requests to service_role;
grant select, insert, update on public.tc_client_leo_profiles to service_role;

-- Invoker intentionally: only service_role has both EXECUTE and underlying table grants.
-- The application must derive client_id from the authenticated CRM owner, never user input.
create or replace function public.tc_leonaris_memory(p_client_id uuid, p_operation text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_state public.tc_client_leo_companion_state%rowtype;
  v_chat public.tc_client_leo_chat_requests%rowtype;
  v_memory public.tc_client_leo_memories%rowtype;
  v_request uuid;
  v_token uuid;
  v_content text;
  v_question text;
  v_answer jsonb;
  v_memories jsonb;
  v_history jsonb;
  v_keep boolean;
  v_feedback boolean;
  v_context text;
  v_path text;
  v_signal text;
  v_signal_key text;
  v_profile public.tc_client_leo_profiles%rowtype;
  v_visits numeric;
  v_interactions numeric;
  v_interest numeric;
begin
  if p_client_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('status','error','code','invalid_request');
  end if;
  if p_operation not in ('read','preferences','remember','forget','reset','claim','complete','fail','feedback','signal') then
    return jsonb_build_object('status','error','code','invalid_operation');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tc-leonaris:' || p_client_id::text, 0));
  insert into public.tc_client_leo_companion_state(client_id) values(p_client_id) on conflict(client_id) do nothing;
  select * into strict v_state from public.tc_client_leo_companion_state where client_id = p_client_id;
  -- Lazy bounded retention: all reads and writes purge expired data for this client only.
  delete from public.tc_client_leo_chat_requests where client_id = p_client_id and created_at < v_now - interval '30 days';
  update public.tc_client_leo_chat_requests set answer = null, question = null
    where client_id = p_client_id and not memory_retained and reply_expires_at <= v_now and (answer is not null or question is not null);
  delete from public.tc_client_leo_chat_requests
    where client_id = p_client_id and request_id in (
      select request_id from public.tc_client_leo_chat_requests where client_id = p_client_id
      order by created_at desc, request_id desc offset 60
    );

  if p_operation = 'signal' then
    -- Opt-out and writes share this transaction lock: no signal can slip through
    -- between a separate preference read and profile mutation.
    if not v_state.memory_enabled then return jsonb_build_object('status','ok','recorded',false); end if;
    v_signal := p_payload->>'signal';
    v_context := p_payload->>'context';
    v_path := case v_context
      when 'dashboard' then '/cliente/dashboard' when 'promotions' then '/cliente/precios-ofertas'
      when 'ranks' then '/cliente/rangos' when 'oracle' then '/cliente/oraculo' when 'roulette' then '/cliente/ruleta'
      when 'raffle' then '/cliente/sorteo' when 'tarotists' then '/cliente/tarotistas' when 'reviews' then '/cliente/resenas'
      when 'ritual' then '/cliente/ritual' when 'notifications' then '/cliente/notificaciones' when 'profile' then '/cliente/perfil' else null end;
    if v_signal is null or v_signal not in ('visit','interaction') or v_path is null or v_path is distinct from p_payload->>'pathname' then
      return jsonb_build_object('status','error','code','invalid_signal');
    end if;
    v_signal_key := v_signal || ':' || v_context;
    if coalesce((v_state.signal_seen_at->>v_signal_key)::timestamptz, '-infinity'::timestamptz) > v_now - interval '30 seconds' then
      return jsonb_build_object('status','ok','recorded',false);
    end if;
    insert into public.tc_client_leo_profiles(client_id) values(p_client_id) on conflict(client_id) do nothing;
    select * into strict v_profile from public.tc_client_leo_profiles where client_id = p_client_id for update;
    v_visits := case when jsonb_typeof(v_profile.visit_counts->v_context) = 'number' then greatest(0,(v_profile.visit_counts->>v_context)::numeric) else 0 end;
    v_interactions := case when jsonb_typeof(v_profile.interaction_counts->v_context) = 'number' then greatest(0,(v_profile.interaction_counts->>v_context)::numeric) else 0 end;
    v_interest := case when jsonb_typeof(v_profile.interest_scores->v_context) = 'number' then greatest(0,(v_profile.interest_scores->>v_context)::numeric) else 0 end;
    update public.tc_client_leo_profiles set
      visit_counts = case when v_signal = 'visit' then jsonb_set(coalesce(visit_counts,'{}'::jsonb),array[v_context],to_jsonb(least(1000000,v_visits + 1)),true) else visit_counts end,
      interaction_counts = case when v_signal = 'interaction' then jsonb_set(coalesce(interaction_counts,'{}'::jsonb),array[v_context],to_jsonb(least(1000000,v_interactions + 1)),true) else interaction_counts end,
      interest_scores = jsonb_set(coalesce(interest_scores,'{}'::jsonb),array[v_context],to_jsonb(least(1000000,v_interest + case when v_signal = 'visit' then 1 else 2 end)),true),
      last_path = v_path,last_seen_at = v_now,updated_at = v_now where client_id = p_client_id;
    update public.tc_client_leo_companion_state set signal_seen_at = jsonb_set(signal_seen_at,array[v_signal_key],to_jsonb(v_now),true),updated_at = v_now where client_id = p_client_id;
    return jsonb_build_object('status','ok','recorded',true);
  elsif p_operation = 'read' then
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'content',content,'createdAt',created_at) order by created_at,id),'[]'::jsonb)
      into v_memories from public.tc_client_leo_memories where client_id = p_client_id and v_state.memory_enabled;
    select coalesce(jsonb_agg(turn order by completed_at, request_id, position),'[]'::jsonb) into v_history
    from (
      select c.completed_at, c.request_id, t.position, t.turn
      from (
        select request_id, question, answer, completed_at from public.tc_client_leo_chat_requests
        where client_id = p_client_id and v_state.memory_enabled and memory_retained and status = 'completed' and answer is not null and question is not null
        order by completed_at desc, request_id desc limit 6
      ) c cross join lateral (values
        (1, jsonb_build_object('id',c.request_id::text || ':user','role','user','content',c.question,'createdAt',c.completed_at)),
        (2, jsonb_build_object('id',c.request_id::text,'role','assistant','content',c.answer->>'message','createdAt',c.completed_at))
      ) t(position,turn)
    ) turns;
    return jsonb_build_object('status','ok','displayName',v_state.display_name,'memoryEnabled',v_state.memory_enabled,'style',v_state.style,'memories',v_memories,'history',v_history,'helpful',v_state.helpful_count,'unhelpful',v_state.unhelpful_count);
  elsif p_operation = 'preferences' then
    if (p_payload ? 'memoryEnabled' and jsonb_typeof(p_payload->'memoryEnabled') <> 'boolean')
      or (p_payload ? 'style' and coalesce(p_payload->>'style','') not in ('warm','concise'))
      or (p_payload ? 'displayName' and p_payload->'displayName' <> 'null'::jsonb and (jsonb_typeof(p_payload->'displayName') <> 'string' or char_length(btrim(p_payload->>'displayName')) not between 1 and 80)) then
      return jsonb_build_object('status','error','code','invalid_preferences');
    end if;
    update public.tc_client_leo_companion_state set
      display_name = case when p_payload ? 'displayName' then nullif(btrim(p_payload->>'displayName'),'') else display_name end,
      memory_enabled = case when p_payload ? 'memoryEnabled' then (p_payload->>'memoryEnabled')::boolean else memory_enabled end,
      style = case when p_payload ? 'style' then p_payload->>'style' else style end,
      updated_at = v_now where client_id = p_client_id;
    if p_payload->>'memoryEnabled' = 'false' then
      update public.tc_client_leo_chat_requests set question = null, memory_retained = false,
        reply_expires_at = least(coalesce(reply_expires_at,v_now + interval '10 minutes'),v_now + interval '10 minutes')
        where client_id = p_client_id;
    end if;
    return jsonb_build_object('status','ok');
  elsif p_operation = 'remember' then
    if not v_state.memory_enabled then return jsonb_build_object('status','error','code','memory_disabled'); end if;
    v_content := btrim(regexp_replace(p_payload->>'content','[[:space:]]+',' ','g'));
    if v_content is null or char_length(v_content) not between 1 and 400 then return jsonb_build_object('status','error','code','invalid_memory'); end if;
    select * into v_memory from public.tc_client_leo_memories where client_id = p_client_id and content = v_content;
    if not found then
      if (select count(*) from public.tc_client_leo_memories where client_id = p_client_id) >= 20 then return jsonb_build_object('status','error','code','memory_limit'); end if;
      insert into public.tc_client_leo_memories(client_id,content) values(p_client_id,v_content) returning * into v_memory;
    end if;
    return jsonb_build_object('status','ok','memory',jsonb_build_object('id',v_memory.id,'content',v_memory.content,'createdAt',v_memory.created_at));
  elsif p_operation = 'forget' then
    delete from public.tc_client_leo_memories where client_id = p_client_id and id = (p_payload->>'memoryId')::uuid;
    return jsonb_build_object('status','ok');
  elsif p_operation = 'reset' then
    delete from public.tc_client_leo_memories where client_id = p_client_id;
    update public.tc_client_leo_profiles set visit_counts = '{}'::jsonb, interest_scores = '{}'::jsonb, interaction_counts = '{}'::jsonb, last_path = null, last_seen_at = null, updated_at = v_now where client_id = p_client_id;
    -- Erase all conversation content, but retain content-free request metadata so
    -- repeatedly forgetting memory cannot bypass the request rate limit.
    update public.tc_client_leo_chat_requests set question = null, question_hash = '', answer = null,
      feedback = null, status = 'failed', memory_retained = false, claim_token = gen_random_uuid(),
      reply_expires_at = v_now where client_id = p_client_id;
    update public.tc_client_leo_companion_state set helpful_count = 0, unhelpful_count = 0, signal_seen_at = '{}'::jsonb, updated_at = v_now where client_id = p_client_id;
    return jsonb_build_object('status','ok');
  end if;

  v_request := (p_payload->>'requestId')::uuid;
  if v_request is null then return jsonb_build_object('status','error','code','invalid_request'); end if;
  select * into v_chat from public.tc_client_leo_chat_requests where client_id = p_client_id and request_id = v_request;
  if p_operation = 'claim' then
    v_question := btrim(p_payload->>'question');
    if v_question is null or char_length(v_question) not between 1 and 2000 then return jsonb_build_object('status','error','code','invalid_request'); end if;
    if v_chat.request_id is not null then
      if v_chat.question_hash <> md5(v_question) then return jsonb_build_object('status','error','code','request_conflict'); end if;
      if v_chat.status = 'completed' then return jsonb_build_object('status','completed','answer',v_chat.answer); end if;
      if v_chat.status = 'processing' and v_chat.started_at > v_now - interval '2 minutes' then return jsonb_build_object('status','in_progress','retryAfter',3); end if;
    end if;
    if coalesce(v_chat.attempts,0) >= 60 or (select coalesce(sum(attempts),0) from public.tc_client_leo_chat_requests where client_id = p_client_id and started_at > v_now - interval '1 minute') >= 8
      or (select coalesce(sum(attempts),0) from public.tc_client_leo_chat_requests where client_id = p_client_id and started_at > v_now - interval '1 hour') >= 60 then
      return jsonb_build_object('status','rate_limited','retryAfter',60);
    end if;
    v_token := gen_random_uuid();
    insert into public.tc_client_leo_chat_requests(client_id,request_id,question,question_hash,claim_token,memory_retained,created_at,started_at)
      values(p_client_id,v_request,case when v_state.memory_enabled then v_question else null end,md5(v_question),v_token,v_state.memory_enabled,v_now,v_now)
      on conflict(client_id,request_id) do update set status = 'processing', claim_token = v_token, started_at = v_now,
        attempts = public.tc_client_leo_chat_requests.attempts + 1, question = excluded.question, memory_retained = excluded.memory_retained;
    return jsonb_build_object('status','claimed','claimToken',v_token);
  elsif p_operation in ('complete','fail') then
    if v_chat.request_id is null or v_chat.claim_token is distinct from (p_payload->>'claimToken')::uuid then return jsonb_build_object('status','error','code','stale_claim'); end if;
    if v_chat.status = 'completed' then return jsonb_build_object('status','ok'); end if;
    if v_chat.status <> 'processing' then return jsonb_build_object('status','error','code','stale_claim'); end if;
    if p_operation = 'fail' then
      update public.tc_client_leo_chat_requests set status = 'failed',question = null,answer = null where client_id = p_client_id and request_id = v_request;
      return jsonb_build_object('status','ok');
    end if;
    v_answer := p_payload->'answer';
    if v_answer is null or jsonb_typeof(v_answer) <> 'object' or v_answer->>'id' is distinct from v_request::text
      or coalesce(v_answer->>'mode','') not in ('ai','guided')
      or char_length(coalesce(v_answer->>'title','')) not between 1 and 160
      or char_length(coalesce(v_answer->>'message','')) not between 1 and 4000
      or jsonb_typeof(v_answer->'actions') is distinct from 'array'
      or jsonb_array_length(v_answer->'actions') > 6 then return jsonb_build_object('status','error','code','invalid_answer'); end if;
    v_keep := v_state.memory_enabled and v_chat.memory_retained;
    update public.tc_client_leo_chat_requests set status = 'completed',answer = v_answer,completed_at = v_now,memory_retained = v_keep,
      question = case when v_keep then question else null end,reply_expires_at = case when v_keep then null else v_now + interval '10 minutes' end
      where client_id = p_client_id and request_id = v_request;
    delete from public.tc_client_leo_chat_requests where client_id = p_client_id and request_id in (
      select request_id from public.tc_client_leo_chat_requests where client_id = p_client_id order by created_at desc,request_id desc offset 60
    );
    return jsonb_build_object('status','ok');
  elsif p_operation = 'feedback' then
    if v_chat.status is distinct from 'completed' or jsonb_typeof(p_payload->'helpful') is distinct from 'boolean' then
      return jsonb_build_object('status','error','code','invalid_feedback');
    end if;
    v_feedback := (p_payload->>'helpful')::boolean;
    if v_chat.feedback is distinct from v_feedback then
      update public.tc_client_leo_companion_state set
        helpful_count = helpful_count - case when v_chat.feedback is true then 1 else 0 end + case when v_feedback then 1 else 0 end,
        unhelpful_count = unhelpful_count - case when v_chat.feedback is false then 1 else 0 end + case when not v_feedback then 1 else 0 end,
        updated_at = v_now where client_id = p_client_id;
      update public.tc_client_leo_chat_requests set feedback = v_feedback where client_id = p_client_id and request_id = v_request;
    end if;
    return jsonb_build_object('status','ok');
  end if;
  return jsonb_build_object('status','error','code','invalid_operation');
exception when invalid_text_representation then
  return jsonb_build_object('status','error','code','invalid_request');
end;
$function$;
revoke all on function public.tc_leonaris_memory(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.tc_leonaris_memory(uuid,text,jsonb) to service_role;
comment on function public.tc_leonaris_memory(uuid,text,jsonb) is 'Server-only bounded explicit memory, chat deduplication/rate limiting, and idempotent feedback for an authenticated CRM client.';

