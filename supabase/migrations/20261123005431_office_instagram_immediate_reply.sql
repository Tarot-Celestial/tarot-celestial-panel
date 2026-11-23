begin;

-- Both entry points claim the same row with the same lease. The webhook first
-- locates its exact verified inbound; it must never fall back to the queue.
create function public.office_capture_claim_pending(p_target uuid, p_source_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  actor uuid;
  worker uuid;
  candidate public.office_capture_opportunities;
  reason text;
  decision text;
  skipped integer := 0;
begin
  if (p_target is null) <> (p_source_id is null) then return null; end if;
  select s.actor_user_id,w.id into actor,worker
  from public.office_capture_settings s join public.workers w on w.user_id=s.actor_user_id and w.is_active
  where s.id and s.enabled and public.tc_has_admin_access(s.actor_user_id) is true;
  if actor is null or public.office_autonomy_check('capture_reply','*','',null,false) in ('paused','schedule','limit') then
    return null;
  end if;
  loop
    if p_target is null then
      select o.* into candidate from public.office_capture_opportunities o
      where o.status='pending'
        and public.office_autonomy_check('capture_reply',o.channel,o.account_id,o.request_id::text,false) in ('allow','handoff')
      order by o.latest_inbound_at,o.id limit 1 for update of o skip locked;
    else
      select o.* into candidate from public.office_capture_opportunities o
      where o.id=p_target and o.source_id=p_source_id and o.channel='instagram' and o.kind='message' and o.status='pending'
      for update of o skip locked;
    end if;
    if not found then return null; end if;
    decision := public.office_autonomy_check('capture_reply',candidate.channel,candidate.account_id,candidate.request_id::text,false);
    if decision not in ('allow','handoff') then return null; end if;
    reason := public.office_capture_guard(candidate.id);
    if reason is null and decision='handoff' then
      reason := 'autonomy_handoff';
    end if;
    if reason is null then
      update public.office_capture_opportunities set status='claimed',claimed_by=actor,
        lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '3 minutes',updated_at=now()
      where id=candidate.id returning * into candidate;
      return to_jsonb(candidate) || jsonb_build_object('actor_user_id',actor,'actor_worker_id',worker,
        'submission_key',case when candidate.kind='form' then 'meta:'||candidate.source_id end);
    end if;
    update public.office_capture_opportunities
    set status=case when reason in ('purchased','expired','opted_out') then reason else 'handoff' end,
      last_error=reason,updated_at=now() where id=candidate.id;
    skipped := skipped + 1;
    if p_target is not null or skipped>=20 then return null; end if;
  end loop;
end $$;

create or replace function public.office_capture_claim() returns jsonb
language sql volatile security invoker set search_path='' as $$
  select public.office_capture_claim_pending(null,null)
$$;

create function public.office_capture_claim_instagram_dm(p_account text,p_source_id text)
returns jsonb language sql volatile strict security invoker set search_path='' as $$
  select public.office_capture_claim_pending(o.id,i.source_id)
  from public.office_capture_inbound i
  join public.office_capture_opportunities o on o.id=i.opportunity_id
    and (o.channel,o.account_id,o.kind,o.thread_key,o.recipient_id,o.source_id,o.latest_inbound_at)
      =(i.channel,i.account_id,i.kind,i.thread_key,i.recipient_id,i.source_id,i.source_at)
  where (i.channel,i.account_id,i.kind,i.source_id)=('instagram',p_account,'message',p_source_id)
    and i.verified and o.verified and i.recipient_id=i.thread_key and nullif(btrim(i.inbound_text),'') is not null
$$;

-- A second DM received during transport stays in the inbound ledger. Promote
-- it after a confirmed send or a change proven to precede any native send.
-- The normal claim still rechecks the thread, human takeover and opt-outs.
create function public.office_instagram_promote_waiting_dm() returns trigger
language plpgsql security invoker set search_path='' as $$
declare incoming public.office_capture_inbound;
begin
  if new.status='blocked' and exists(
    select from public.tc_instagram_sends s where s.request_id=new.request_id
  ) then return new; end if;
  select i.* into incoming from public.office_capture_inbound i
  where i.opportunity_id=new.id and (i.channel,i.account_id,i.kind,i.thread_key,i.recipient_id)
    =(new.channel,new.account_id,new.kind,new.thread_key,new.recipient_id)
    and i.verified and (i.source_at,i.source_id)>(new.latest_inbound_at,new.source_id)
  order by i.source_at desc,i.source_id desc limit 1;
  if found and not public.office_commercial_blocked(new.id) then
    perform public.office_capture_store(new.channel,new.account_id,new.kind,new.thread_key,incoming.source_id,
      incoming.source_at,incoming.inbound_text,true,new.thread_id,new.recipient_id,new.name,new.session_id,
      new.client_id,new.lead_id,new.market,new.whatsapp_consent);
  end if;
  return new;
end $$;

create trigger office_instagram_promote_waiting_dm after update of status on public.office_capture_opportunities
for each row when (
  new.channel='instagram' and new.kind='message' and old.status is distinct from new.status and (
    (new.status='sent' and new.receipt_id is not null) or
    (old.status in ('claimed','dispatching') and new.status='blocked' and new.last_error='NEWER_INSTAGRAM_DM' and new.receipt_id is null)
  )
) execute function public.office_instagram_promote_waiting_dm();

revoke all on function public.office_capture_claim_pending(uuid,text), public.office_capture_claim_instagram_dm(text,text),
  public.office_instagram_promote_waiting_dm() from public,anon,authenticated;
grant execute on function public.office_capture_claim_pending(uuid,text), public.office_capture_claim_instagram_dm(text,text),
  public.office_instagram_promote_waiting_dm() to service_role;

commit;
