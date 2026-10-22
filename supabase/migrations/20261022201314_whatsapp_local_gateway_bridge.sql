-- Outbound-only bridge: the local computer never exposes a port to the internet.
create table public.whatsapp_bridge_worker (
  id boolean primary key default true check (id),
  last_seen_at timestamptz not null default now()
);
create table public.whatsapp_bridge_commands (
  id uuid primary key default gen_random_uuid(),
  method text not null check (method in ('GET','POST')),
  path text not null,
  payload jsonb,
  state text not null default 'pending' check (state in ('pending','running','completed')),
  response_status integer,
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '45 seconds')
);
create index whatsapp_bridge_pending_idx on public.whatsapp_bridge_commands(created_at) where state='pending';
alter table public.whatsapp_bridge_worker enable row level security;
alter table public.whatsapp_bridge_commands enable row level security;
revoke all on public.whatsapp_bridge_worker,public.whatsapp_bridge_commands from public,anon,authenticated;
grant select,insert,update,delete on public.whatsapp_bridge_worker,public.whatsapp_bridge_commands to service_role;

create function public.tc_whatsapp_bridge_enqueue(p_id uuid,p_method text,p_path text,p_payload jsonb)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from public.whatsapp_bridge_worker where last_seen_at>now()-interval '30 seconds') then return false; end if;
  if p_method not in ('GET','POST') or length(p_path)>250 or p_path !~ '^/sessions/[A-Za-z0-9_-]{1,64}/' or octet_length(coalesce(p_payload::text,''))>32768 then raise exception 'INVALID_COMMAND'; end if;
  insert into public.whatsapp_bridge_commands(id,method,path,payload) values(p_id,p_method,p_path,p_payload);
  return true;
end;
$$;
create function public.tc_whatsapp_bridge_exchange(p_results jsonb default '[]'::jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_result jsonb; v_commands jsonb;
begin
  if jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>10 or octet_length(p_results::text)>2097152 then raise exception 'INVALID_RESULTS'; end if;
  insert into public.whatsapp_bridge_worker(id,last_seen_at) values(true,now()) on conflict(id) do update set last_seen_at=excluded.last_seen_at;
  for v_result in select value from jsonb_array_elements(p_results) loop
    if (v_result->>'status')::integer not between 100 and 599 then raise exception 'INVALID_RESPONSE'; end if;
    update public.whatsapp_bridge_commands set state='completed',response_status=(v_result->>'status')::integer,result=v_result->'json'
      where id=(v_result->>'id')::uuid and state='running' and expires_at>now();
  end loop;
  -- Results contain chats and QR codes: remove promptly, never retain a history here.
  delete from public.whatsapp_bridge_commands where expires_at<now();
  with candidates as (
    select id from public.whatsapp_bridge_commands where state='pending' and expires_at>now()
    order by created_at limit 4 for update skip locked
  ), claimed as (
    update public.whatsapp_bridge_commands c set state='running' from candidates q where c.id=q.id
    returning c.id,c.method,c.path,c.payload,c.expires_at
  ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into v_commands from claimed;
  return jsonb_build_object('commands',v_commands);
end;
$$;
revoke all on function public.tc_whatsapp_bridge_enqueue(uuid,text,text,jsonb),public.tc_whatsapp_bridge_exchange(jsonb) from public,anon,authenticated;
grant execute on function public.tc_whatsapp_bridge_enqueue(uuid,text,text,jsonb),public.tc_whatsapp_bridge_exchange(jsonb) to service_role;
