-- Staff-only operational messages. No balance, reward or attendance mutations.
alter table public.chat_messages add column if not exists kind text not null default 'text';
alter table public.chat_messages add column if not exists operation_meta jsonb not null default '{}'::jsonb;
alter table public.chat_messages add column if not exists updated_at timestamptz not null default now();
create unique index if not exists staff_chat_latest_consultation_idx on public.chat_messages(thread_id) where kind='consultation';
create index if not exists staff_chat_call_pair_recent_idx on public.rendimiento_llamadas(telefonista_worker_id,tarotista_worker_id,fecha_hora desc,created_at desc,id desc) where tiempo>0;
-- Existing authenticated chat policies must not permit forged source cards.
alter table public.chat_messages enable row level security;
drop policy if exists staff_chat_text_insert_only on public.chat_messages;
create policy staff_chat_text_insert_only on public.chat_messages as restrictive for insert to anon,authenticated with check(kind='text' and operation_meta='{}'::jsonb);
drop policy if exists staff_chat_text_update_only on public.chat_messages;
create policy staff_chat_text_update_only on public.chat_messages as restrictive for update to anon,authenticated using(kind='text' and operation_meta='{}'::jsonb) with check(kind='text' and operation_meta='{}'::jsonb);
drop policy if exists staff_chat_text_delete_only on public.chat_messages;
create policy staff_chat_text_delete_only on public.chat_messages as restrictive for delete to anon,authenticated using(kind='text' and operation_meta='{}'::jsonb);

create table if not exists public.staff_chat_pauses(
 id uuid primary key default gen_random_uuid(), thread_id uuid not null references public.chat_threads(id),
 worker_id uuid not null references public.workers(id), worker_name text not null,
 kind text not null check(kind in('bathroom','lunch','break')),
 status text not null check(status in('pending','active','returned','rejected','cancelled')),
 created_at timestamptz not null default now(), started_at timestamptz, ended_at timestamptz,
 decided_by uuid references public.workers(id), decided_at timestamptz, revision bigint not null default 0
);
create unique index if not exists staff_chat_one_open_pause on public.staff_chat_pauses(worker_id) where status in('pending','active');
create index if not exists staff_chat_pauses_thread_idx on public.staff_chat_pauses(thread_id,created_at desc);
create index if not exists staff_chat_pauses_decided_by_idx on public.staff_chat_pauses(decided_by);

create table if not exists public.staff_chat_call_appeals(
 id uuid primary key default gen_random_uuid(), thread_id uuid not null references public.chat_threads(id),
 call_id uuid not null, worker_id uuid not null references public.workers(id), worker_name text not null,
 call_revision bigint not null, reason text not null check(length(reason) between 3 and 500),
 status text not null default 'pending' check(status in('pending','resolved')),
 resolution text, resolved_by uuid references public.workers(id), resolved_at timestamptz,
 revision bigint not null default 0, created_at timestamptz not null default now(),
 unique(call_id,worker_id,call_revision)
);
-- No call FK: deleted source records remain reviewable in the internal audit.
create index if not exists staff_chat_appeals_thread_idx on public.staff_chat_call_appeals(thread_id,status,created_at desc);
create index if not exists staff_chat_appeals_worker_idx on public.staff_chat_call_appeals(worker_id);
create index if not exists staff_chat_appeals_resolved_by_idx on public.staff_chat_call_appeals(resolved_by);
create table if not exists public.staff_chat_operation_audit(
 id uuid primary key default gen_random_uuid(), actor_id uuid not null references public.workers(id),
 operation_id uuid not null, thread_id uuid not null references public.chat_threads(id),
 action text not null, request jsonb not null, result jsonb not null,
 created_at timestamptz not null default now(), unique(actor_id,operation_id)
);
create index if not exists staff_chat_operation_audit_thread_idx on public.staff_chat_operation_audit(thread_id,created_at desc);
alter table public.staff_chat_pauses enable row level security;
alter table public.staff_chat_call_appeals enable row level security;
alter table public.staff_chat_operation_audit enable row level security;
revoke all on public.staff_chat_pauses,public.staff_chat_call_appeals,public.staff_chat_operation_audit from public,anon,authenticated;
grant select,insert,update on public.staff_chat_pauses,public.staff_chat_call_appeals,public.staff_chat_operation_audit to service_role;

create or replace function public.staff_chat_refresh_last_call(p_central uuid,p_tarotista uuid)
returns void language plpgsql security invoker set search_path='' as $fn$
declare r public.rendimiento_llamadas%rowtype; t uuid; m public.chat_messages%rowtype;
 central_name text; tarotista_name text; first_name text; summary text; message_time timestamptz;
begin
 if p_central is null or p_tarotista is null or p_central=p_tarotista then return; end if;
 -- Exact worker IDs only. A manual name must never leak a call to another worker.
 select display_name into central_name from public.workers where id=p_central and role in('central','admin');
 if not found then return; end if;
 select display_name into tarotista_name from public.workers where id=p_tarotista and role='tarotista';
 if not found then return; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff-call:'||p_central::text||':'||p_tarotista::text,0));
 select * into r from public.rendimiento_llamadas
 where telefonista_worker_id=p_central::text and tarotista_worker_id=p_tarotista::text and tiempo>0
 order by fecha_hora desc nulls last,created_at desc,id desc limit 1;
 select id into t from public.chat_threads where central_worker_id=p_central and tarotist_worker_id=p_tarotista;
 if r.id is null then
   if t is not null then update public.chat_messages set body='No hay una consulta registrada disponible.',operation_meta='{}',updated_at=now() where thread_id=t and kind='consultation'; end if;
   return;
 end if;
 if t is null then
   insert into public.chat_threads(central_worker_id,tarotist_worker_id,status,title)
    values(p_central,p_tarotista,'open',coalesce(central_name,'Central')||' · '||coalesce(tarotista_name,'Tarotista'))
    on conflict(central_worker_id,tarotist_worker_id) where central_worker_id is not null do nothing returning id into t;
   if t is null then select id into t from public.chat_threads where central_worker_id=p_central and tarotist_worker_id=p_tarotista; end if;
 end if;
 first_name:=split_part(regexp_replace(btrim(coalesce(r.cliente_nombre,'')),'[[:space:]]+',' ','g'),' ',1);
 if first_name='' or first_name ~ '[0-9@]' or first_name !~ '^[[:alpha:]][[:alpha:]''’-]*$' then first_name:='Clienta'; end if;
 first_name:=left(first_name,50);
 if jsonb_typeof(r.code_blocks)='array' then
   select string_agg((value->>'minutes')||' '||(value->>'code'),' · ' order by ord)
    into summary from jsonb_array_elements(r.code_blocks) with ordinality a(value,ord)
    where value->>'code' in('FREE','RUEDA','CLIENTE','REPITE','CALL','OTROS') and value->>'minutes' ~ '^[0-9]+([.][0-9]+)?$';
 end if;
 if coalesce(summary,'')='' then
   summary:=concat_ws(' · ',case when r.minutos_1>0 and upper(r.codigo_1) in('FREE','RUEDA','CLIENTE','REPITE','CALL','OTROS') then trim_scale(r.minutos_1)::text||' '||upper(r.codigo_1) end,
    case when r.minutos_2>0 and upper(r.codigo_2) in('FREE','RUEDA','CLIENTE','REPITE','CALL','OTROS') then trim_scale(r.minutos_2)::text||' '||upper(r.codigo_2) end);
 end if;
 -- Legacy free-text summaries are interpreted by the shared API catalogue.
 -- Never copy arbitrary legacy text (which may include customer details) here.
 if summary='' then summary:='Consulta registrada'; end if;
 select * into m from public.chat_messages where thread_id=t and kind='consultation';
 message_time:=case when m.id is not null and m.operation_meta->>'call_id'=r.id::text then m.created_at else now() end;
 insert into public.chat_messages(thread_id,sender_worker_id,sender_display_name,body,kind,operation_meta,created_at,updated_at)
 values(t,p_central,coalesce(central_name,'Central'),left(summary||' · '||first_name,2000),'consultation',jsonb_build_object('call_id',r.id),message_time,now())
 on conflict(thread_id) where kind='consultation' do update set
  sender_worker_id=excluded.sender_worker_id,sender_display_name=excluded.sender_display_name,body=excluded.body,
  operation_meta=excluded.operation_meta,created_at=excluded.created_at,updated_at=excluded.updated_at;
 update public.chat_threads set last_message_at=message_time,last_message_preview=left(summary||' · '||first_name,180)
 where id=t and (last_message_at is null or last_message_at<=message_time);
end $fn$;
revoke all on function public.staff_chat_refresh_last_call(uuid,uuid) from public,anon,authenticated;
grant execute on function public.staff_chat_refresh_last_call(uuid,uuid) to service_role;

create or replace function public.staff_chat_sync_last_call() returns trigger language plpgsql security invoker set search_path='' as $fn$
declare oc uuid; ot uuid; nc uuid; nt uuid;
begin
 if TG_OP<>'INSERT' then
  if coalesce(OLD.telefonista_worker_id,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then oc:=OLD.telefonista_worker_id::uuid; end if;
  if coalesce(OLD.tarotista_worker_id,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then ot:=OLD.tarotista_worker_id::uuid; end if;
 end if;
 if TG_OP<>'DELETE' then
  if coalesce(NEW.telefonista_worker_id,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then nc:=NEW.telefonista_worker_id::uuid; end if;
  if coalesce(NEW.tarotista_worker_id,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then nt:=NEW.tarotista_worker_id::uuid; end if;
 end if;
 -- Stable ordering prevents two concurrent reassignments taking reversed pair locks.
 if coalesce(oc::text||ot::text,'')<=coalesce(nc::text||nt::text,'') then
  perform public.staff_chat_refresh_last_call(oc,ot);
  if (oc,ot) is distinct from (nc,nt) then perform public.staff_chat_refresh_last_call(nc,nt); end if;
 else
  perform public.staff_chat_refresh_last_call(nc,nt);
  if (oc,ot) is distinct from (nc,nt) then perform public.staff_chat_refresh_last_call(oc,ot); end if;
 end if;
 return null;
end $fn$;
revoke all on function public.staff_chat_sync_last_call() from public,anon,authenticated;
grant execute on function public.staff_chat_sync_last_call() to service_role;
drop trigger if exists staff_chat_sync_last_call on public.rendimiento_llamadas;
create trigger staff_chat_sync_last_call after insert or update of tiempo,code_blocks,codigo_1,minutos_1,codigo_2,minutos_2,resumen_codigo,cliente_nombre,tarotista_worker_id,telefonista_worker_id,fecha_hora or delete
 on public.rendimiento_llamadas for each row execute function public.staff_chat_sync_last_call();

create or replace function public.staff_chat_operation(p_actor uuid,p_thread uuid,p_action text,p_operation_id uuid,p_target uuid default null,p_reason text default '',p_revision bigint default null)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare w public.workers%rowtype; t public.chat_threads%rowtype; p public.staff_chat_pauses%rowtype; a public.staff_chat_call_appeals%rowtype;
 previous public.staff_chat_operation_audit%rowtype; r public.rendimiento_llamadas%rowtype;
 can_manage boolean; request_data jsonb; result_data jsonb; msg text; entity_id uuid; stamp timestamptz:=now();
begin
 select * into w from public.workers where id=p_actor and is_active is true and role in('admin','central','tarotista');
 if w.id is null then raise exception 'FORBIDDEN'; end if;
 select * into t from public.chat_threads where id=p_thread;
 if t.id is null then raise exception 'THREAD_NOT_FOUND'; end if;
 can_manage:=coalesce(public.tc_worker_has_admin_access(p_actor),false) or (w.role in('admin','central') and t.central_worker_id=p_actor);
 if not can_manage and t.tarotist_worker_id<>p_actor then raise exception 'FORBIDDEN'; end if;
 if p_operation_id is null then raise exception 'INVALID_OPERATION_ID'; end if;
 p_reason:=btrim(coalesce(p_reason,''));
 if length(p_reason)>500 then raise exception 'INVALID_REASON'; end if;
 request_data:=jsonb_build_object('thread',p_thread,'action',p_action,'target',p_target,'reason',p_reason,'revision',p_revision);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff-op:'||p_actor::text,0));
 select * into previous from public.staff_chat_operation_audit where actor_id=p_actor and operation_id=p_operation_id;
 if found then
  if previous.request<>request_data then raise exception 'OPERATION_CONFLICT'; end if;
  return previous.result;
 end if;
 if p_action in('bathroom','request_lunch','request_break') then
  if w.role<>'tarotista' or t.tarotist_worker_id<>p_actor then raise exception 'FORBIDDEN'; end if;
  if exists(select 1 from public.staff_chat_pauses where worker_id=p_actor and status in('pending','active')) then raise exception 'PAUSE_ALREADY_OPEN'; end if;
  insert into public.staff_chat_pauses(thread_id,worker_id,worker_name,kind,status,started_at)
   values(p_thread,p_actor,coalesce(w.display_name,'Tarotista'),case p_action when 'bathroom' then 'bathroom' when 'request_lunch' then 'lunch' else 'break' end,
    case when p_action='bathroom' then 'active' else 'pending' end,case when p_action='bathroom' then stamp end) returning * into p;
  msg:=case p_action when 'bathroom' then 'Informa que va al baño.' when 'request_lunch' then 'Solicita permiso para almorzar.' else 'Solicita permiso para un descanso.' end;
  entity_id:=p.id;result_data:=jsonb_build_object('id',p.id,'status',p.status,'revision',p.revision);
 elsif p_action in('approve_break','reject_break','return','cancel_pause') then
  select * into p from public.staff_chat_pauses where id=p_target and thread_id=p_thread for update;
  if p.id is null or p.revision is distinct from p_revision then raise exception 'OPERATION_CONFLICT'; end if;
  if p_action in('approve_break','reject_break') then
   if not can_manage then raise exception 'FORBIDDEN'; end if;
   if p.status<>'pending' then raise exception 'OPERATION_CONFLICT'; end if;
   update public.staff_chat_pauses set status=case when p_action='approve_break' then 'active' else 'rejected' end,
    decided_by=p_actor,decided_at=stamp,started_at=case when p_action='approve_break' then stamp end,revision=revision+1 where id=p.id returning * into p;
   msg:=case when p_action='approve_break' then 'Permiso aceptado: ' else 'Permiso rechazado: ' end||p.worker_name||case p.kind when 'lunch' then ' · almuerzo.' else ' · descanso.' end;
  else
   if p.worker_id<>p_actor then raise exception 'FORBIDDEN'; end if;
   if (p_action='return' and p.status<>'active') or (p_action='cancel_pause' and p.status<>'pending') then raise exception 'OPERATION_CONFLICT'; end if;
   update public.staff_chat_pauses set status=case when p_action='return' then 'returned' else 'cancelled' end,ended_at=stamp,revision=revision+1 where id=p.id returning * into p;
   msg:=case when p_action='cancel_pause' then 'Retira su solicitud de pausa.' else case p.kind when 'lunch' then 'Ha regresado del almuerzo.' when 'bathroom' then 'Ha regresado del baño.' else 'Ha regresado del descanso.' end end;
  end if;
  entity_id:=p.id;result_data:=jsonb_build_object('id',p.id,'status',p.status,'revision',p.revision);
 elsif p_action='appeal' then
  if w.role<>'tarotista' or t.tarotist_worker_id<>p_actor then raise exception 'FORBIDDEN'; end if;
  if length(p_reason)<3 then raise exception 'INVALID_REASON'; end if;
  select * into r from public.rendimiento_llamadas where telefonista_worker_id=t.central_worker_id::text and tarotista_worker_id=p_actor::text and tiempo>0
   order by fecha_hora desc nulls last,created_at desc,id desc limit 1 for update;
  if r.id is null then raise exception 'CALL_NOT_FOUND'; end if;
  if r.id<>p_target or r.edit_revision is distinct from p_revision then raise exception 'CALL_CHANGED'; end if;
  if exists(select 1 from public.staff_chat_call_appeals where call_id=r.id and worker_id=p_actor and call_revision=r.edit_revision) then raise exception 'APPEAL_ALREADY_OPEN'; end if;
  insert into public.staff_chat_call_appeals(thread_id,call_id,worker_id,worker_name,call_revision,reason)
   values(p_thread,r.id,p_actor,coalesce(w.display_name,'Tarotista'),r.edit_revision,p_reason) returning * into a;
  entity_id:=a.id;msg:='Ha solicitado revisar los minutos o códigos de su última consulta. Motivo: '||p_reason;
  result_data:=jsonb_build_object('id',a.id,'status',a.status,'revision',a.revision);
 elsif p_action='resolve_appeal' then
  if not can_manage then raise exception 'FORBIDDEN'; end if;
  if length(p_reason)<3 then raise exception 'INVALID_REASON'; end if;
  select * into a from public.staff_chat_call_appeals where id=p_target and thread_id=p_thread for update;
  if a.id is null or a.status<>'pending' or a.revision is distinct from p_revision then raise exception 'OPERATION_CONFLICT'; end if;
  update public.staff_chat_call_appeals set status='resolved',resolution=p_reason,resolved_by=p_actor,resolved_at=stamp,revision=revision+1 where id=a.id returning * into a;
  entity_id:=a.id;msg:='Revisión de consulta resuelta. '||p_reason;
  result_data:=jsonb_build_object('id',a.id,'status',a.status,'revision',a.revision);
 else raise exception 'INVALID_ACTION';
 end if;
 insert into public.chat_messages(thread_id,sender_worker_id,sender_display_name,body,kind,operation_meta,client_message_id)
  values(p_thread,p_actor,coalesce(w.display_name,'Equipo'),msg,case when p_action in('appeal','resolve_appeal') then 'appeal' else 'pause' end,jsonb_build_object('operation_id',entity_id,'action',p_action),'operation:'||p_operation_id::text);
 update public.chat_threads set last_message_at=stamp,last_message_preview=left(msg,180),status='open' where id=p_thread;
 insert into public.staff_chat_operation_audit(actor_id,operation_id,thread_id,action,request,result) values(p_actor,p_operation_id,p_thread,p_action,request_data,result_data);
 return result_data;
end $fn$;
revoke all on function public.staff_chat_operation(uuid,uuid,text,uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.staff_chat_operation(uuid,uuid,text,uuid,uuid,text,bigint) to service_role;
