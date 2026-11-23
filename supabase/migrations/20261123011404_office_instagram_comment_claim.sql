begin;

-- Keep the same guarded row lock for a scheduled round, a DM, or a root comment.

create or replace function public.office_capture_claim_pending(p_target uuid, p_source_id text)
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
      where o.id=p_target and o.source_id=p_source_id and o.channel='instagram' and o.kind in ('message','comment') and o.status='pending'
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

-- Instagram routes private replies by comment ID. Signed root comments can lack an author ID.

create function public.office_capture_claim_instagram_comment(p_account text, p_source_id text)
returns jsonb language sql volatile strict security invoker set search_path='' as $$
  select public.office_capture_claim_pending(o.id,i.source_id)
  from public.office_capture_inbound i
  join public.office_capture_opportunities o on o.id=i.opportunity_id
    and (o.channel,o.account_id,o.kind,o.thread_key,o.source_id,o.latest_inbound_at)
      =(i.channel,i.account_id,i.kind,i.thread_key,i.source_id,i.source_at)
    and o.recipient_id is not distinct from i.recipient_id
  where (i.channel,i.account_id,i.kind,i.source_id)=('instagram',p_account,'comment',p_source_id)
    and i.thread_key=i.source_id and i.verified and o.verified and nullif(btrim(i.inbound_text),'') is not null
$$;

revoke all on function public.office_capture_claim_instagram_comment(text,text) from public,anon,authenticated;
grant execute on function public.office_capture_claim_instagram_comment(text,text) to service_role;

commit;
