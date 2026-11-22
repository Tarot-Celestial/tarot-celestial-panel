begin;
create or replace function public.office_capture_discover() returns jsonb language plpgsql security invoker set search_path='' as $$
declare e record; n int:=0; reason text; candidate record;
begin
 -- Private exact-text ingestions and periodic metadata scans share the same source key.
 -- Resolve each native thread once for the whole batch. Taking the limit only
 -- after the join keeps recent unmatched IDs from starving older genuine input.
 for e in with threads as materialized (
   select distinct on (channel,account_id,kind,thread_key) channel,account_id,kind,thread_key,id,recipient_id,name
   from public.office_capture_social_threads
   order by channel,account_id,kind,thread_key,remote_updated_at desc,id
 )
 select a.*,t.id thread_id,t.recipient_id,t.name from public.tc_social_inbox_activity a
   join threads t on (t.channel,t.account_id,t.kind,t.thread_key)=(a.provider,a.account_id,a.kind,a.thread_remote_id)
   where a.removed_at is null and a.occurred_at<=now() and not exists(select 1 from public.office_capture_inbound i
     where (i.channel,i.account_id,i.kind,i.source_id)=(a.provider,a.account_id,a.kind,a.remote_id))
   order by a.occurred_at desc,a.id desc limit 250
 loop
   perform public.office_capture_store(e.provider,e.account_id,e.kind,e.thread_remote_id,e.remote_id,e.occurred_at,null,true,e.thread_id,
     e.recipient_id,e.name,null,null,null,null,false); n:=n+1;
 end loop;
 -- Threads imported before the verified inbox ledger remain visible; a preview never opens a reply window.
 for e in select t.* from public.office_capture_social_threads t where not exists(select 1 from public.office_capture_opportunities o
   where (o.channel,o.account_id,o.kind,o.thread_key)=(t.channel,t.account_id,t.kind,t.thread_key))
   order by t.remote_updated_at desc,t.id limit 150
 loop
  perform public.office_capture_store(e.channel,e.account_id,e.kind,e.thread_key,'thread:'||e.id,coalesce(e.remote_created_at,e.remote_updated_at),
    null,false,e.id,e.recipient_id,e.name,null,null,null,null,false); n:=n+1;
 end loop;
 for e in select m.leadgen_id,m.page_id,m.form_id,m.captacion_lead_id,m.cliente_id,m.meta_created_at,c.pais,c.nombre,
   exists(select 1 from jsonb_array_elements(case when jsonb_typeof(m.payload#>'{lead,field_data}')='array' then m.payload#>'{lead,field_data}' else '[]' end) f
     where lower(f->>'name') in ('whatsapp_opt_in','consent_whatsapp','acepto_contacto_por_whatsapp','autorizo_contacto_por_whatsapp')
       and case when jsonb_typeof(f->'values')='array' then jsonb_array_length(f->'values')=1 else false end
       and lower(trim(f#>>'{values,0}')) in ('true','1','yes','sí','si','acepto','autorizo')) consent
   from public.meta_lead_events m join public.captacion_leads l on l.id=m.captacion_lead_id and l.cliente_id=m.cliente_id
   join public.crm_clientes c on c.id=m.cliente_id where m.status='processed' and m.meta_created_at<=now()
     and nullif(m.leadgen_id,'') is not null and coalesce(lower(c.origen),'') not like '%orion%' and coalesce(lower(l.origen),'') not like '%orion%'
     and not exists(select 1 from public.office_capture_inbound i where i.channel='meta_form' and i.kind='form' and i.source_id=m.leadgen_id
       and i.account_id=coalesce(nullif(m.page_id,''),'form:'||nullif(m.form_id,''),'meta-leads'))
   order by m.meta_created_at desc,m.leadgen_id limit 150
 loop
   perform public.office_capture_store('meta_form',coalesce(nullif(e.page_id,''),'form:'||nullif(e.form_id,''),'meta-leads'),'form',
     'lead:'||e.captacion_lead_id,e.leadgen_id,e.meta_created_at,null,true,null,null,e.nombre,null,e.cliente_id,e.captacion_lead_id,e.pais,e.consent);
   n:=n+1;
 end loop;
 -- A second inbound during dispatch remains in the private ledger. Re-arm it only after a definitive receipt.
 for e in select o.*,i.source_id newer_id,i.source_at newer_at,i.inbound_text newer_text from public.office_capture_opportunities o
   join lateral (select * from public.office_capture_inbound i where i.opportunity_id=o.id order by i.source_at desc,i.source_id desc limit 1) i on true
   where o.status='sent' and o.kind<>'form' and (i.source_at,i.source_id)>(o.latest_inbound_at,o.source_id) limit 100
 loop
   perform public.office_capture_store(e.channel,e.account_id,e.kind,e.thread_key,e.newer_id,e.newer_at,e.newer_text,true,e.thread_id,
     e.recipient_id,e.name,e.session_id,e.client_id,e.lead_id,e.market,e.whatsapp_consent); n:=n+1;
 end loop;
 update public.office_capture_opportunities set status='uncertain',last_error='dispatch_receipt_missing',lease_until=null,updated_at=now()
   where status='dispatching' and lease_until<=clock_timestamp();
 update public.office_capture_opportunities set status='pending',lease_token=null,lease_until=null,updated_at=now()
   where status='claimed' and lease_until<=clock_timestamp();
 update public.office_capture_opportunities x set status='purchased',last_error='purchased',lease_token=null,lease_until=null,updated_at=now()
 from (select distinct p.client_id from public.office_crm_purchase_evidence p where p.at<=now() and p.recorded_at<=now()) paid
 where paid.client_id=x.client_id and x.status not in ('purchased','dispatching','uncertain','opted_out');
 for candidate in select id,status from public.office_capture_opportunities x where x.status='pending'
   order by x.latest_inbound_at desc,x.id limit 250
 loop
   reason:=public.office_capture_guard(candidate.id,false);
   if reason is not null then
     update public.office_capture_opportunities set status=case when reason in ('opted_out','purchased','expired') then reason else 'handoff' end,
       last_error=reason,updated_at=now() where id=candidate.id and status=candidate.status;
   end if;
 end loop;
 return jsonb_build_object('processed',n);
end $$;
commit;
