-- Pruebas transaccionales: no envían push ni conservan cambios.
begin;
do $$
declare client uuid; actor uuid; campaign uuid:=gen_random_uuid(); second_campaign uuid:=gen_random_uuid(); job public.tc_client_campaign_deliveries; n integer; doc jsonb;
begin
 select id,auth_user_id into client,actor from public.crm_clientes where auth_user_id is not null limit 1;
 if client is null then raise exception 'Se necesita una cuenta web vinculada para esta prueba.'; end if;
 perform public.tc_campaign_preference(client,actor,true);
 doc:=jsonb_build_object('title','Prueba transaccional','message','Se revierte sin enviar.','image_url','','action_url','/cliente/notificaciones','expires_at',now()+interval '1 day','channels',jsonb_build_array('panel'),'audience',jsonb_build_object('mode','selected','client_ids',jsonb_build_array(client::text)));
 perform public.tc_campaign_save(campaign,doc,actor);
 perform public.tc_campaign_schedule(campaign,now());perform public.tc_campaign_schedule(campaign,now());
 select count(*) into n from public.tc_client_campaign_deliveries where campaign_id=campaign;
 if n<>1 then raise exception 'Programación duplicada: %',n;end if;
 select * into job from public.tc_campaign_claim(30,campaign);
 if job.id is null then raise exception 'No se reclamó el trabajo.';end if;
 select count(*) into n from public.tc_campaign_claim(30,campaign);
 if n<>0 then raise exception 'Un trabajo se reclamó dos veces.';end if;
 perform public.tc_campaign_prepare(job.id,job.attempt_token);perform public.tc_campaign_prepare(job.id,job.attempt_token);
 select count(*) into n from public.cliente_notificaciones where campaign_id=campaign;
 if n<>1 then raise exception 'Notificación duplicada.';end if;
 perform public.tc_campaign_finish();
 if (select status from public.tc_client_campaigns where id=campaign)<>'completed' then raise exception 'La campaña no finalizó.';end if;
 perform public.tc_campaign_save(second_campaign,doc,actor);
 perform public.tc_campaign_schedule(second_campaign,now()+interval '1 hour');
 select count(*) into n from public.tc_campaign_claim(30,second_campaign);
 if n<>0 then raise exception 'Envío antes de tiempo.';end if;
 update public.tc_client_campaigns set scheduled_at=now() where id=second_campaign;
 select * into job from public.tc_campaign_claim(30,second_campaign);
 perform public.tc_campaign_preference(client,actor,false);
 perform public.tc_campaign_prepare(job.id,job.attempt_token);
 if (select state from public.tc_client_campaign_deliveries where id=job.id)<>'skipped' then raise exception 'La baja no se respetó.';end if;
 perform public.tc_campaign_action(campaign,'cancel');
 if exists(select 1 from public.cliente_notificaciones where campaign_id=campaign and expires_at>now()) then raise exception 'Cancelar no retiró los avisos.';end if;
 if has_table_privilege('anon','public.tc_client_campaigns','SELECT') or has_table_privilege('authenticated','public.tc_client_campaign_deliveries','SELECT') then raise exception 'Acceso público inesperado.';end if;
 if has_function_privilege('anon','public.tc_campaign_schedule(uuid,timestamptz)','EXECUTE') or has_function_privilege('authenticated','public.tc_campaign_prepare(uuid,uuid)','EXECUTE') then raise exception 'RPC pública inesperada.';end if;
end $$;
set local role service_role;
select public.tc_campaign_preview('{"mode":"all"}'::jsonb)->'eligible' is not null as service_role_can_preview;
rollback;
