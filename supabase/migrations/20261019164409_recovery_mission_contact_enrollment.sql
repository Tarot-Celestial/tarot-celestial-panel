begin;

-- The full recovery portfolio remains usable alongside the prepared daily list.
-- Enrol a due contact before the legacy action records its new contact timestamp:
-- checking eligibility afterwards would mistake this action for a recent follow-up.
-- Thirty is the daily minimum, not a ceiling on eligible work.
create or replace function public.tc_recovery_mission_enroll_contact(p_worker uuid,p_client uuid,p_at timestamptz)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare ctx jsonb; d date; recovery crm_client_recovery; assigned_worker uuid;
 last_contact timestamptz; follow_days integer;
begin
 ctx:=tc_recovery_mission_context(p_worker,p_at);
 if not coalesce((ctx->>'active')::boolean,false)
  or not exists(select 1 from workers where id=p_worker and role='central' and is_active is distinct from false)
 then return false; end if;
 d:=(ctx->>'day')::date;
 -- Match the existing mutation lock order. Never acquire the allocator's lock
 -- here: it takes its own lock before the client and could otherwise deadlock.
 perform 1 from crm_clientes where id=p_client for update;
 if not found then return false; end if;
 select * into recovery from crm_client_recovery where client_id=p_client for update;
 if coalesce(recovery.status,'pending') not in ('pending','contacted','no_response')
  or (recovery.responsible_id is not null and recovery.responsible_id<>p_worker)
  or not exists(select 1 from tc_recovery_candidates where id=p_client and eligible)
 then return false; end if;
 select worker_id into assigned_worker from crm_recovery_mission_assignments where mission_day=d and client_id=p_client;
 if found then
  -- A no-response attempt reserves this client's place for the same central;
  -- the later contacted action can count without restarting the cooldown.
  return assigned_worker=p_worker;
 end if;
 select followup_days into follow_days from crm_recovery_mission_schedules where worker_id=p_worker;
 select max(created_at) into last_contact from crm_client_recovery_history
 where client_id=p_client and status in ('contacted','no_response');
 if coalesce(last_contact,recovery.contacted_at)>p_at-make_interval(days=>follow_days) then return false; end if;
 insert into crm_recovery_mission_assignments(mission_day,worker_id,client_id,assigned_at)
 values(d,p_worker,p_client,p_at) on conflict(mission_day,client_id) do nothing;
 -- Neither ownership nor version is changed here. The existing action claims
 -- the contact and validates p_version in the same transaction; failure rolls
 -- this new assignment back too.
 return exists(select 1 from crm_recovery_mission_assignments where mission_day=d and client_id=p_client and worker_id=p_worker);
end $$;

create or replace function public.tc_recovery_act_v2(p_user uuid,p_client uuid,p_action text,p_version integer,
 p_payment uuid default null,p_note text default '',p_channel text default 'whatsapp',p_request_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor workers; request_key uuid:=coalesce(p_request_id,gen_random_uuid()); request_payload jsonb;
 previous crm_recovery_mission_requests; result jsonb; at_time timestamptz:=tc_recovery_mission_now();
begin
 select * into actor from workers where user_id=p_user and role in ('central','admin') and is_active is distinct from false
 order by case when role='central' then 0 else 1 end,id limit 1;
 if actor.id is null then raise exception 'FORBIDDEN'; end if;
 if p_channel not in ('whatsapp','phone','email','other') or p_channel is null then raise exception 'INVALID_CHANNEL'; end if;
 request_payload:=jsonb_build_object('worker',actor.id,'client',p_client,'action',p_action,'version',p_version,'payment',p_payment,'note',left(coalesce(p_note,''),1000),'channel',p_channel);
 perform pg_advisory_xact_lock(hashtextextended('recovery-request:'||request_key,0));
 select * into previous from crm_recovery_mission_requests where request_id=request_key;
 if found then
  if previous.payload<>request_payload then raise exception 'OPERATION_CONFLICT'; end if;
  return previous.result||jsonb_build_object('duplicate_prevented',true,'mission',tc_recovery_mission_snapshot(actor.id,at_time));
 end if;
 perform 1 from crm_clientes where id=p_client for update;
 if p_action in ('contacted','no_response') then
  perform tc_recovery_mission_enroll_contact(actor.id,p_client,at_time);
 end if;
 result:=tc_recovery_act(p_user,p_client,p_action,p_version,p_payment,p_note);
 if p_action='contacted' and result->>'status'='contacted' then
  result:=result||tc_recovery_mission_record_contact(actor.id,p_client,request_key,p_channel,p_note,at_time);
 else result:=result||jsonb_build_object('counted',false); end if;
 result:=result||jsonb_build_object('duplicate_prevented',false,'mission',tc_recovery_mission_snapshot(actor.id,at_time));
 insert into crm_recovery_mission_requests(request_id,worker_id,client_id,payload,result) values(request_key,actor.id,p_client,request_payload,result);
 return result;
end $$;

revoke all on function public.tc_recovery_mission_enroll_contact(uuid,uuid,timestamptz),
 public.tc_recovery_act_v2(uuid,uuid,text,integer,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.tc_recovery_mission_enroll_contact(uuid,uuid,timestamptz),
 public.tc_recovery_act_v2(uuid,uuid,text,integer,uuid,text,text,uuid) to service_role;
notify pgrst,'reload schema';
commit;
