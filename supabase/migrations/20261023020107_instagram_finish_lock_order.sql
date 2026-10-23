-- Same order as ingest/merge: account advisory -> thread -> send receipt.
-- Resolve the thread again after the advisory wait: a concurrent merge may
-- have moved the receipt to its canonical UUID while this request waited.
create or replace function public.tc_instagram_finish_send(p_request uuid,p_status text,p_remote_id text,p_error text)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_send public.tc_instagram_sends; v_account text; v_thread uuid;
begin
  if p_status not in ('sent','failed','uncertain') then raise exception 'INVALID_STATUS'; end if;
  select t.account_id into v_account from public.tc_instagram_sends s
    join public.tc_instagram_threads t on t.id=s.thread_id where s.request_id=p_request;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('instagram:'||v_account,0));
  select thread_id into v_thread from public.tc_instagram_sends where request_id=p_request;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform 1 from public.tc_instagram_threads where id=v_thread for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_send from public.tc_instagram_sends where request_id=p_request for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_send.thread_id is distinct from v_thread then raise exception 'STALE_THREAD'; end if;
  if v_send.status in ('sent','confirmed_sent','confirmed_not_sent') then return; end if;
  if p_status='sent' and nullif(p_remote_id,'') is null then raise exception 'RECEIPT_REQUIRED'; end if;
  update public.tc_instagram_sends set status=p_status,remote_message_id=p_remote_id,error_code=p_error,completed_at=clock_timestamp() where request_id=p_request;
  if p_status='sent' then
    update public.tc_instagram_threads set last_reply_at=clock_timestamp(),
      private_reply_sent=private_reply_sent or (kind='comment' and v_send.reply_mode='private') where id=v_thread;
  end if;
end $$;
revoke all on function public.tc_instagram_finish_send(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.tc_instagram_finish_send(uuid,text,text,text) to service_role;
