-- Atlas uses the same money/reward sources as the existing administration UI.
-- Proposal row, operation, audit and receipt commit together; retries return the receipt.
create or replace function public.tc_atlas_execute_action(p_user uuid,p_proposal uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare actor public.workers; proposal public.atlas_admin_proposals; v_result jsonb; promo public.tc_client_promotions; detail jsonb; disabled jsonb;
begin
 select * into actor from public.workers where user_id=p_user and role='admin' and is_active is distinct from false;
 if not found then raise exception 'FORBIDDEN'; end if;
 select * into proposal from public.atlas_admin_proposals where id=p_proposal and worker_id=actor.id for update;
 if not found then raise exception 'PROPOSAL_NOT_FOUND'; end if;
 if proposal.status='completed' then return jsonb_build_object('result',proposal.result,'replayed',true); end if;
 if proposal.status<>'pending' or proposal.expires_at<=now() then raise exception 'PROPOSAL_UNAVAILABLE'; end if;
 detail:=proposal.payload;
 if proposal.kind='grant_spins' then
   v_result:=public.tc_admin_adjust_spins(proposal.id,(detail->>'client_id')::uuid,p_user,(detail->>'level')::integer,(detail->>'amount')::integer,detail->>'reason');
 elsif proposal.kind='grant_coins' then
   v_result:=public.admin_gift_client_coins((detail->>'client_id')::uuid,actor.id,(detail->>'amount')::integer,detail->>'reason',proposal.id);
 elsif proposal.kind in ('activate_promotion','deactivate_promotion') then
   perform pg_advisory_xact_lock(hashtext('atlas-promotions'));
   lock table public.tc_client_promotions,public.tc_client_promotion_packages in share row exclusive mode;
   select * into promo from public.tc_client_promotions where id=(detail->>'promotion_id')::uuid for update;
   if not found then raise exception 'PROMOTION_NOT_FOUND'; end if;
   if promo.promotion_kind is distinct from 'standard' then raise exception 'INVALID_PROMOTION_KIND'; end if;
   if promo.updated_at is distinct from (detail->>'updated_at')::timestamptz then raise exception 'PROMOTION_CHANGED'; end if;
   if proposal.kind='activate_promotion' then
     if coalesce((select jsonb_agg(id order by id) from public.tc_client_promotions where status='active' and promotion_kind='standard' and id<>promo.id),'[]') is distinct from detail->'previous_active' then raise exception 'PROMOTION_CHANGED'; end if;
     if (select count(*) from public.tc_client_promotion_packages where promotion_id=promo.id and is_active)<>jsonb_array_length(detail->'package_versions') or exists(select 1 from public.tc_client_promotion_packages p where p.promotion_id=promo.id and p.is_active and not exists(select 1 from jsonb_array_elements(detail->'package_versions') v where (v->>'id')::uuid=p.id and (v->>'updated_at')::timestamptz is not distinct from p.updated_at)) then raise exception 'PROMOTION_CHANGED'; end if;
     if promo.status='archived' or (not coalesce(promo.active_until_disabled,false) and promo.ends_at<=now()) then raise exception 'PROMOTION_EXPIRED'; end if;
     if not exists(select 1 from public.tc_client_promotion_packages where promotion_id=promo.id and is_active=true and price>0) then raise exception 'PROMOTION_WITHOUT_PACKAGES'; end if;
     select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') into disabled from public.tc_client_promotions where status='active' and promotion_kind='standard' and id<>promo.id;
     update public.tc_client_promotions set status='inactive',deactivated_at=now(),updated_at=now() where status='active' and promotion_kind='standard' and id<>promo.id;
     update public.tc_client_promotions set status='active',activated_at=now(),activated_by=p_user,deactivated_at=null,starts_at=now(),updated_at=now() where id=promo.id returning * into promo;
   else
     update public.tc_client_promotions set status='inactive',deactivated_at=now(),updated_at=now() where id=promo.id returning * into promo;
   end if;
   v_result:=jsonb_build_object('promotion_id',promo.id,'name',promo.name,'status',promo.status,'deactivated_promotions',coalesce(disabled,'[]'));
   insert into public.tc_client_promotion_audit(promotion_id,action,actor_user_id,snapshot) values(promo.id,proposal.kind,p_user,v_result||jsonb_build_object('source','atlas','proposal_id',proposal.id));
 elsif proposal.kind='save_memory' then
   if length(btrim(coalesce(detail->>'content',''))) not between 1 and 2000 then raise exception 'INVALID_MEMORY'; end if;
   insert into public.atlas_admin_memories(worker_id,content) values(actor.id,btrim(detail->>'content')) returning jsonb_build_object('memory_id',id,'saved',true) into v_result;
 elsif proposal.kind='dispatch_contacts' or proposal.kind='create_task' then
   v_result:=public.tc_atlas_dispatch(p_user,detail,proposal.id);
 else raise exception 'UNKNOWN_ACTION'; end if;
 update public.atlas_admin_proposals set status='completed',result=v_result,executed_at=now(),updated_at=now() where id=proposal.id;
 insert into public.atlas_admin_audit(worker_id,operation_id,action,entity_type,entity_id,detail)
 values(actor.id,proposal.id,proposal.kind,'proposal',proposal.id::text,v_result);
 return jsonb_build_object('result',v_result,'replayed',false);
end $$;
revoke all on function public.tc_atlas_execute_action(uuid,uuid) from public,anon,authenticated;
grant execute on function public.tc_atlas_execute_action(uuid,uuid) to service_role;
