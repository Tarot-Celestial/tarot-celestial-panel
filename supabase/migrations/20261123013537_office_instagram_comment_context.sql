begin;

-- A private response to a comment appears in the recipient's DM conversation.
-- Only borrow its route when both native threads prove the same account and
-- recipient, and both delivery ledgers agree on the remote message.
create function public.office_capture_instagram_comment_context(p_id uuid,p_lease_token uuid)
returns jsonb language sql stable strict security invoker set search_path='' as $$
  select jsonb_build_object('route',attempt.route,'remote_id',native.remote_message_id,'completed_at',native.completed_at)
  from public.office_capture_opportunities dm
  join public.office_capture_inbound incoming on incoming.opportunity_id=dm.id
    and (incoming.channel,incoming.account_id,incoming.kind,incoming.thread_key,incoming.recipient_id,incoming.source_id,incoming.source_at)
      =(dm.channel,dm.account_id,dm.kind,dm.thread_key,dm.recipient_id,dm.source_id,dm.latest_inbound_at) and incoming.verified
  join public.office_capture_opportunities comment on comment.channel=dm.channel and comment.account_id=dm.account_id
    and comment.recipient_id=dm.recipient_id and comment.kind='comment' and comment.source_id=comment.thread_key
    and comment.verified and comment.status='sent' and not comment.opted_out
  join public.office_capture_inbound source on source.opportunity_id=comment.id
    and (source.channel,source.account_id,source.kind,source.thread_key,source.recipient_id,source.source_id,source.source_at)
      =(comment.channel,comment.account_id,comment.kind,comment.thread_key,comment.recipient_id,comment.source_id,comment.latest_inbound_at)
    and source.verified
  join public.tc_instagram_threads root on root.id=comment.thread_id and root.kind='comment' and root.merged_into is null
    and (root.account_id,root.remote_id,root.recipient_id)=(comment.account_id,comment.source_id,comment.recipient_id) and root.private_reply_sent
  join public.office_capture_attempts attempt on attempt.opportunity_id=comment.id and attempt.source_id=comment.source_id
    and attempt.request_id=comment.request_id and attempt.route='ask_country' and attempt.outcome='sent'
    and attempt.receipt_id=comment.receipt_id
  join public.tc_instagram_sends native on native.thread_id=root.id and native.request_id=attempt.request_id
    and native.reply_mode='private' and native.status='sent' and native.remote_message_id=attempt.receipt_id
  where dm.id=p_id and dm.lease_token=p_lease_token and dm.lease_until>clock_timestamp()
    and dm.status in ('claimed','dispatching') and dm.channel='instagram' and dm.kind='message'
    and dm.verified and dm.recipient_id=dm.thread_key and dm.recipient_id ~ '^[0-9]{1,40}$'
    and (comment.client_id is null or dm.client_id is null or comment.client_id=dm.client_id)
    and nullif(btrim(native.remote_message_id),'') is not null
    and native.completed_at>=comment.latest_inbound_at
    and native.completed_at>=dm.latest_inbound_at-interval '24 hours' and native.completed_at<dm.latest_inbound_at
    and public.office_capture_guard(dm.id) is null
    and not public.office_commercial_blocked(comment.id)
    and not exists(select from public.office_capture_suppressions s where s.client_id=comment.client_id)
    and (comment.client_id is null or not exists(select from public.tc_crm_first_purchases_batch(array[comment.client_id])))
    and exists(select from public.tc_social_inbox_activity activity where
      (activity.provider,activity.account_id,activity.kind,activity.remote_id,activity.thread_remote_id)
        =(comment.channel,comment.account_id,comment.kind,comment.source_id,comment.thread_key) and activity.removed_at is null)
    and not exists(select from public.office_capture_inbound later where later.opportunity_id=dm.id and later.verified
      and (later.source_at,later.source_id)>(dm.latest_inbound_at,dm.source_id))
    and not exists (
      select from public.tc_instagram_threads thread join public.tc_instagram_sends other on other.thread_id=thread.id
      where (thread.account_id,thread.recipient_id)=(dm.account_id,dm.recipient_id)
        and other.request_id not in (native.request_id,dm.request_id)
        and (other.status in ('sending','uncertain') or (other.status in ('sent','confirmed_sent')
          and coalesce(other.completed_at,other.created_at)>=native.completed_at))
    )
  order by native.completed_at desc limit 1
$$;
revoke all on function public.office_capture_instagram_comment_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.office_capture_instagram_comment_context(uuid,uuid) to service_role;

commit;
