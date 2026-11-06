-- Delegated administration adds a capability; workers.role remains the operational role.
-- No worker is promoted or granted access by this structural migration.
-- Created manually because the Supabase CLI is unavailable in this workspace.
create table if not exists public.worker_admin_access (
  worker_id uuid primary key references public.workers(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  is_active boolean not null default true,
  granted_at timestamptz not null default now(),
  granted_by_user_id uuid references auth.users(id) on delete set null,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  revoked_at timestamptz,
  check (revoked_at is null or revoked_at >= granted_at)
);
create unique index if not exists worker_admin_access_user_id_key on public.worker_admin_access(user_id);
alter table public.worker_admin_access enable row level security;
revoke all on public.worker_admin_access from public, anon, authenticated;
grant select, insert, update on public.worker_admin_access to service_role;
comment on table public.worker_admin_access is 'Explicit administrative capability bound to the current worker and Auth identity. Operational role and history are unchanged. Service-only grant/revoke.';

create table if not exists public.worker_admin_access_audit (
  id bigint generated always as identity primary key,
  worker_id uuid not null,
  user_id uuid not null,
  action text not null check (action in ('grant','change','revoke')),
  actor_user_id uuid,
  previous_state jsonb,
  next_state jsonb not null,
  occurred_at timestamptz not null default now()
);
alter table public.worker_admin_access_audit enable row level security;
revoke all on public.worker_admin_access_audit from public, anon, authenticated, service_role;
grant select on public.worker_admin_access_audit to service_role;

create schema if not exists private;
create or replace function private.tc_validate_admin_access_grant()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if not exists (
    select 1 from public.workers w
    where w.id = new.worker_id and w.user_id = new.user_id and w.role = 'central'
  ) then raise exception 'ADMIN_ACCESS_IDENTITY_MISMATCH'; end if;
  return new;
end $function$;
revoke all on function private.tc_validate_admin_access_grant() from public, anon, authenticated;

create or replace function private.tc_audit_admin_access_grant()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  insert into public.worker_admin_access_audit(worker_id,user_id,action,actor_user_id,previous_state,next_state)
  values(new.worker_id,new.user_id,
    case when tg_op='INSERT' then 'grant'
         when new.revoked_at is not null or not new.is_active then 'revoke' else 'change' end,
    coalesce(auth.uid(),new.granted_by_user_id),
    case when tg_op='INSERT' then null else to_jsonb(old) end,to_jsonb(new));
  return new;
end $function$;
revoke all on function private.tc_audit_admin_access_grant() from public, anon, authenticated;

drop trigger if exists tc_validate_admin_access_grant on public.worker_admin_access;
create trigger tc_validate_admin_access_grant before insert or update of worker_id,user_id on public.worker_admin_access
for each row execute function private.tc_validate_admin_access_grant();
drop trigger if exists tc_audit_admin_access_grant on public.worker_admin_access;
create trigger tc_audit_admin_access_grant after insert or update on public.worker_admin_access
for each row execute function private.tc_audit_admin_access_grant();

-- The private lookup bypasses workers RLS only to avoid current_role recursion.
-- Authenticated callers can inspect only their own current user_id; no email or
-- auth_user_id fallback, client metadata, cached role, or supplied JWT claim grants access.
create or replace function private.tc_admin_access_allowed(p_worker_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $function$
  select exists (
    select 1 from public.workers w
    where (p_worker_id is null or w.id=p_worker_id)
      and (p_user_id is null or w.user_id=p_user_id)
      and (p_worker_id is not null or p_user_id is not null)
      and w.user_id is not null
      and w.is_active is true
      and (w.user_id=(select auth.uid()) or (select auth.jwt()->>'role')='service_role')
      and (
        w.role='admin'
        or (w.role='central' and exists (
          select 1 from public.worker_admin_access a
          where a.worker_id=w.id and a.user_id=w.user_id
            and a.is_active and a.revoked_at is null
        ))
      )
  )
$function$;
revoke all on function private.tc_admin_access_allowed(uuid,uuid) from public, anon;
grant usage on schema private to authenticated, service_role;
grant execute on function private.tc_admin_access_allowed(uuid,uuid) to authenticated, service_role;

create or replace function public.tc_has_admin_access(p_user_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $function$
  select p_user_id is not null and private.tc_admin_access_allowed(null,p_user_id)
$function$;
create or replace function public.tc_worker_has_admin_access(p_worker_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $function$
  select p_worker_id is not null and private.tc_admin_access_allowed(p_worker_id,null)
$function$;
revoke all on function public.tc_has_admin_access(uuid), public.tc_worker_has_admin_access(uuid) from public, anon;
grant execute on function public.tc_has_admin_access(uuid), public.tc_worker_has_admin_access(uuid) to authenticated, service_role;

-- current_role is used by access policies; private.current_worker_role and
-- current_worker keep the original operational identity used by shifts and statistics.
create or replace function public."current_role"()
returns text language sql stable security invoker set search_path = 'pg_catalog' as $function$
  select case when public.tc_has_admin_access((select auth.uid()))
    then 'admin'::text else private.current_worker_role() end
$function$;
revoke all on function public."current_role"() from public, anon;
grant execute on function public."current_role"() to authenticated, service_role;

-- END ACCESS FOUNDATION

-- Exact, reviewed authorization predicates from the live 2026-11-06 functions.
-- Existing business bodies, locks, audit records, grants, signatures and owners
-- are preserved. A changed/missing source fails the whole migration for review.
do $patch_rpc$
declare r record; original text; changed text; actual_count integer; target regprocedure;
begin
  for r in select * from (values
('public.tc_admin_grant_oracle_draws(uuid,uuid,uuid,numeric,text)','role = ''admin''','(role = ''admin'' or public.tc_has_admin_access(p_actor_user_id))',1),
('public.tc_assert_benefit_admin(uuid)','w.role=''admin''','(w.role=''admin'' or public.tc_has_admin_access(p_actor))',1),
('public.tc_admin_adjust_spins(uuid,uuid,uuid,integer,integer,text)','role=''admin''','(role=''admin'' or public.tc_has_admin_access(p_actor_user_id))',1),
('public.tc_recovery_mission_overview(uuid)','role=''admin''','(role=''admin'' or public.tc_has_admin_access(p_user))',1),
('public.tc_atlas_admin(uuid)','role=''admin''','(role=''admin'' or public.tc_has_admin_access(p_user))',1),
('public.tc_atlas_execute_action(uuid,uuid)','role=''admin''','(role=''admin'' or public.tc_has_admin_access(p_user))',1),
('public.admin_gift_client_coins(uuid,uuid,integer,text,uuid)','w.role = ''admin''','(w.role = ''admin'' or public.tc_worker_has_admin_access(p_admin_worker_id))',1),
('public.tc_rendimiento_update(uuid,uuid,bigint,numeric,numeric,jsonb)','role::text=''admin''','(role::text=''admin'' or public.tc_worker_has_admin_access(p_worker))',1),
('public.tc_rendimiento_update_v2(uuid,uuid,bigint,numeric,numeric,text,jsonb)','role::text=''admin''','(role::text=''admin'' or public.tc_worker_has_admin_access(p_worker))',1),
('public.tc_rendimiento_list(uuid,jsonb,integer,integer)','role::text=''admin''','(role::text=''admin'' or public.tc_worker_has_admin_access(p_worker))',1),
('public.tc_captacion_whatsapp_claim(uuid,uuid,uuid,uuid,uuid,text,text,text,text,uuid,uuid,jsonb)','v_worker.role <> ''admin''','(v_worker.role <> ''admin'' and not public.tc_worker_has_admin_access(v_worker.id))',1),
('public.tc_captacion_whatsapp_qr_claim(uuid,uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,jsonb,text)','v_worker.role <> ''admin''','(v_worker.role <> ''admin'' and not public.tc_worker_has_admin_access(v_worker.id))',1),
('public.tc_raffle_action(uuid,uuid,text,jsonb)','w.role<>''admin''','(w.role<>''admin'' and not public.tc_worker_has_admin_access(w.id))',1),
('public.tc_raffle_state(uuid,uuid)','w.role=''admin''','(w.role=''admin'' or public.tc_worker_has_admin_access(w.id))',3),
('public.tc_admin_adjust_coins(uuid,uuid,uuid,numeric,text)','role=''admin''','(role=''admin'' or public.tc_has_admin_access(p_actor_user_id))',1),
('public.tc_admin_whatsapp_draft_get(uuid)','lower(w.role)=''admin''','(lower(w.role)=''admin'' or public.tc_has_admin_access(p_actor_user_id))',1),
('public.tc_admin_whatsapp_draft_save(uuid,uuid,bigint,jsonb)','lower(w.role)=''admin''','(lower(w.role)=''admin'' or public.tc_has_admin_access(p_actor_user_id))',1),
('public.tc_admin_whatsapp_draft_resolve(uuid,text[])','lower(w.role)=''admin''','(lower(w.role)=''admin'' or public.tc_has_admin_access(p_actor_user_id))',1),
('public.invoice_edit_atomic(uuid,uuid,text,uuid,jsonb)','role=''admin''','(role=''admin'' or public.tc_worker_has_admin_access(p_actor_id))',1),
('public.tarotista_bonus_save_rule(jsonb,uuid)','role=''admin''','(role=''admin'' or public.tc_worker_has_admin_access(p_actor))',1),
('public.tarotista_bonus_void(uuid,uuid,text)','role=''admin''','(role=''admin'' or public.tc_worker_has_admin_access(p_actor))',1),
('public.tc_central_statistics_update(uuid,uuid,text,jsonb,uuid)','role=''admin''','(role=''admin'' or public.tc_worker_has_admin_access(p_actor))',1),
('public.invoice_regenerate_preserving_manual(uuid,text,jsonb,jsonb)','role=''admin''','(role=''admin'' or public.tc_worker_has_admin_access((p_snapshot->>''actor_id'')::uuid))',1),
('public.staff_chat_mark_read(uuid,uuid,uuid)','v_role=''admin''','(v_role=''admin'' or public.tc_worker_has_admin_access(p_worker_id))',1),
('public.staff_chat_latest_incoming(uuid,uuid[])','w.role=''admin''','(w.role=''admin'' or public.tc_worker_has_admin_access(w.id))',1),
('public.staff_chat_send_media_message(uuid,uuid,text,text,uuid)','w.role<>''admin''','(w.role<>''admin'' and not public.tc_worker_has_admin_access(w.id))',1),
('public.tc_save_roulette_config(uuid,jsonb)','role=''admin''','(role=''admin'' or public.tc_has_admin_access(p_actor))',1),
('public.tc_save_rank_benefit_config(uuid,text,jsonb)','role=''admin''','(role=''admin'' or public.tc_has_admin_access(p_actor))',1),
('public.tc_save_benefit_rule(jsonb,uuid,integer)','lower(role) in (''admin'',''ceo'',''supervisor'')','(lower(role) in (''admin'',''ceo'',''supervisor'') or public.tc_worker_has_admin_access(p_actor))',1),
('public.tc_recovery_act(uuid,uuid,text,integer,uuid,text)','actor.role<>''admin''','(actor.role<>''admin'' and not public.tc_worker_has_admin_access(actor.id))',1)
  ) patches(signature,old_fragment,new_fragment,expected_count)
  loop
    target:=to_regprocedure(r.signature);
    if target is null then raise exception 'ADMIN_ACCESS_RPC_MISSING: %',r.signature; end if;
    original:=pg_get_functiondef(target);
    if strpos(original,r.new_fragment)>0 and strpos(replace(original,r.new_fragment,''),r.old_fragment)=0 then continue; end if;
    actual_count:=(length(original)-length(replace(original,r.old_fragment,'')))/length(r.old_fragment);
    if actual_count<>r.expected_count then raise exception 'ADMIN_ACCESS_RPC_CHANGED: %',r.signature; end if;
    changed:=replace(original,r.old_fragment,r.new_fragment);
    execute changed;
  end loop;
end $patch_rpc$;

-- END RPC PATCHES

-- Extend only the existing administrator branch, retaining every ownership,
-- row restriction, role list, command, permissive/restrictive flag and table grant.
do $patch_policies$
declare r record; current_qual text; current_check text; statement text;
begin
  for r in select * from (values
('public','billing_collaborators','billing_collaborators_admin_select','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ''admin''::text) AND (COALESCE(w.is_active, true) = true))))',null,'(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND (COALESCE(w.is_active, true) = true))))',null),
('public','billing_collaborator_report_exclusions','billing_collaborator_report_exclusions_admin_select','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ''admin''::text) AND (COALESCE(w.is_active, true) = true))))',null,'(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND (COALESCE(w.is_active, true) = true))))',null),
('public','billing_collaborator_report_exclusions','billing_collaborator_report_exclusions_admin_insert',null,'(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ''admin''::text) AND (COALESCE(w.is_active, true) = true) AND ((w.id)::text = billing_collaborator_report_exclusions.deleted_by_worker_id))))',null,'(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND (COALESCE(w.is_active, true) = true) AND ((w.id)::text = billing_collaborator_report_exclusions.deleted_by_worker_id))))'),
('public','crm_client_followups','followups_select_authorized_workers','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ANY (ARRAY[''admin''::text, ''central''::text])) AND ((w.role = ''admin''::text) OR (w.role = ''central''::text)))))',null,'(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ANY (ARRAY[''admin''::text, ''central''::text])) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id) OR (w.role = ''central''::text)))))',null),
('public','crm_client_followups','followups_update_authorized_workers','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ANY (ARRAY[''admin''::text, ''central''::text])) AND ((w.role = ''admin''::text) OR (w.id = crm_client_followups.worker_id)))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ANY (ARRAY[''admin''::text, ''central''::text])) AND ((w.role = ''admin''::text) OR (w.id = crm_client_followups.worker_id)))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ANY (ARRAY[''admin''::text, ''central''::text])) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id) OR (w.id = crm_client_followups.worker_id)))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ANY (ARRAY[''admin''::text, ''central''::text])) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id) OR (w.id = crm_client_followups.worker_id)))))'),
('public','client_rank_overrides','client_rank_overrides_admin_read','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (lower(w.role) = ANY (ARRAY[''admin''::text, ''ceo''::text, ''supervisor''::text])) AND (COALESCE(w.is_active, true) = true))))',null,'(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((lower(w.role) = ANY (ARRAY[''admin''::text, ''ceo''::text, ''supervisor''::text])) OR tc_worker_has_admin_access(w.id)) AND (COALESCE(w.is_active, true) = true))))',null),
('public','client_rank_override_audit','client_rank_override_audit_admin_read','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (lower(w.role) = ANY (ARRAY[''admin''::text, ''ceo''::text, ''supervisor''::text])) AND (COALESCE(w.is_active, true) = true))))',null,'(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((lower(w.role) = ANY (ARRAY[''admin''::text, ''ceo''::text, ''supervisor''::text])) OR tc_worker_has_admin_access(w.id)) AND (COALESCE(w.is_active, true) = true))))',null),
('public','crm_client_followups','crm_client_followups_select','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ANY (ARRAY[''admin''::text, ''ceo''::text, ''supervisor''::text])) OR ((w.role = ''central''::text) AND (EXISTS ( SELECT 1
           FROM crm_clientes c
          WHERE ((c.id = crm_client_followups.client_id) AND ((c.captured_by_worker_id IS NULL) OR (c.captured_by_worker_id = w.id))))))))))',null,'(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ANY (ARRAY[''admin''::text, ''ceo''::text, ''supervisor''::text])) OR tc_worker_has_admin_access(w.id) OR ((w.role = ''central''::text) AND (EXISTS ( SELECT 1
           FROM crm_clientes c
          WHERE ((c.id = crm_client_followups.client_id) AND ((c.captured_by_worker_id IS NULL) OR (c.captured_by_worker_id = w.id))))))))))',null),
('public','crm_client_followups','crm_client_followups_insert',null,'(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.id = crm_client_followups.worker_id) AND ((w.role = ANY (ARRAY[''admin''::text, ''ceo''::text, ''supervisor''::text])) OR ((w.role = ''central''::text) AND (EXISTS ( SELECT 1
           FROM crm_clientes c
          WHERE ((c.id = crm_client_followups.client_id) AND ((c.captured_by_worker_id IS NULL) OR (c.captured_by_worker_id = w.id))))))))))',null,'(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.id = crm_client_followups.worker_id) AND ((w.role = ANY (ARRAY[''admin''::text, ''ceo''::text, ''supervisor''::text])) OR tc_worker_has_admin_access(w.id) OR ((w.role = ''central''::text) AND (EXISTS ( SELECT 1
           FROM crm_clientes c
          WHERE ((c.id = crm_client_followups.client_id) AND ((c.captured_by_worker_id IS NULL) OR (c.captured_by_worker_id = w.id))))))))))'),
('public','crm_client_followups','crm_client_followups_update','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ANY (ARRAY[''admin''::text, ''ceo''::text, ''supervisor''::text])) OR (w.id = crm_client_followups.worker_id)))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ANY (ARRAY[''admin''::text, ''ceo''::text, ''supervisor''::text])) OR (w.id = crm_client_followups.worker_id)))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ANY (ARRAY[''admin''::text, ''ceo''::text, ''supervisor''::text])) OR tc_worker_has_admin_access(w.id) OR (w.id = crm_client_followups.worker_id)))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ANY (ARRAY[''admin''::text, ''ceo''::text, ''supervisor''::text])) OR tc_worker_has_admin_access(w.id) OR (w.id = crm_client_followups.worker_id)))))'),
('public','manual_invoices','manual_invoices_admin_select','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (lower(COALESCE(w.role, ''''::text)) = ''admin''::text) AND (COALESCE(w.is_active, true) = true))))',null,'(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((lower(COALESCE(w.role, ''''::text)) = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND (COALESCE(w.is_active, true) = true))))',null),
('public','manual_invoice_lines','manual_invoice_lines_admin_select','((EXISTS ( SELECT 1
   FROM manual_invoices mi
  WHERE (mi.id = manual_invoice_lines.invoice_id))) AND (EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (lower(COALESCE(w.role, ''''::text)) = ''admin''::text) AND (COALESCE(w.is_active, true) = true)))))',null,'((EXISTS ( SELECT 1
   FROM manual_invoices mi
  WHERE (mi.id = manual_invoice_lines.invoice_id))) AND (EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((lower(COALESCE(w.role, ''''::text)) = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND (COALESCE(w.is_active, true) = true)))))',null),
('public','manual_invoice_status_history','manual_invoice_history_admin_select','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (lower(COALESCE(w.role, ''''::text)) = ''admin''::text) AND (COALESCE(w.is_active, true) = true))))',null,'(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((lower(COALESCE(w.role, ''''::text)) = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND (COALESCE(w.is_active, true) = true))))',null),
('public','central_notifications','central_notifications_select_own','((recipient_worker_id IS NULL) OR (EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.id = central_notifications.recipient_worker_id) AND (w.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ANY (ARRAY[''admin''::text, ''ceo''::text, ''supervisor''::text]))))))',null,'((recipient_worker_id IS NULL) OR (EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.id = central_notifications.recipient_worker_id) AND (w.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ANY (ARRAY[''admin''::text, ''ceo''::text, ''supervisor''::text])) OR tc_worker_has_admin_access(w.id))))))',null),
('public','central_notifications','central_notifications_update_own','((EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.id = central_notifications.recipient_worker_id) AND (w.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ANY (ARRAY[''admin''::text, ''ceo''::text, ''supervisor''::text]))))))','true','((EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.id = central_notifications.recipient_worker_id) AND (w.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ANY (ARRAY[''admin''::text, ''ceo''::text, ''supervisor''::text])) OR tc_worker_has_admin_access(w.id))))))','true'),
('public','captacion_leads','captacion_leads_operational_read','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((COALESCE(w.user_id, w.auth_user_id) = ( SELECT auth.uid() AS uid)) AND (w.is_active = true) AND ((w.role = ''admin''::text) OR ((w.role = ''central''::text) AND ((captacion_leads.assigned_worker_id IS NULL) OR (captacion_leads.assigned_worker_id = w.id)))))))',null,'(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((COALESCE(w.user_id, w.auth_user_id) = ( SELECT auth.uid() AS uid)) AND (w.is_active = true) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id) OR ((w.role = ''central''::text) AND ((captacion_leads.assigned_worker_id IS NULL) OR (captacion_leads.assigned_worker_id = w.id)))))))',null),
('public','chat_threads','chat_threads_participant_select','(EXISTS ( SELECT 1
   FROM current_worker() cw(worker_id, role)
  WHERE ((cw.role = ''admin''::text) OR (cw.worker_id = chat_threads.central_worker_id) OR (cw.worker_id = chat_threads.tarotist_worker_id))))',null,'(EXISTS ( SELECT 1
   FROM current_worker() cw(worker_id, role)
  WHERE ((cw.role = ''admin''::text) OR tc_worker_has_admin_access(cw.worker_id) OR (cw.worker_id = chat_threads.central_worker_id) OR (cw.worker_id = chat_threads.tarotist_worker_id))))',null),
('public','chat_threads','chat_threads_participant_insert',null,'((central_worker_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM current_worker() cw(worker_id, role)
  WHERE ((cw.role = ''admin''::text) OR (cw.worker_id = chat_threads.central_worker_id) OR (cw.worker_id = chat_threads.tarotist_worker_id)))))',null,'((central_worker_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM current_worker() cw(worker_id, role)
  WHERE ((cw.role = ''admin''::text) OR tc_worker_has_admin_access(cw.worker_id) OR (cw.worker_id = chat_threads.central_worker_id) OR (cw.worker_id = chat_threads.tarotist_worker_id)))))'),
('public','chat_threads','chat_threads_participant_update','(EXISTS ( SELECT 1
   FROM current_worker() cw(worker_id, role)
  WHERE ((cw.role = ''admin''::text) OR (cw.worker_id = chat_threads.central_worker_id) OR (cw.worker_id = chat_threads.tarotist_worker_id))))','(EXISTS ( SELECT 1
   FROM current_worker() cw(worker_id, role)
  WHERE ((cw.role = ''admin''::text) OR (cw.worker_id = chat_threads.central_worker_id) OR (cw.worker_id = chat_threads.tarotist_worker_id))))','(EXISTS ( SELECT 1
   FROM current_worker() cw(worker_id, role)
  WHERE ((cw.role = ''admin''::text) OR tc_worker_has_admin_access(cw.worker_id) OR (cw.worker_id = chat_threads.central_worker_id) OR (cw.worker_id = chat_threads.tarotist_worker_id))))','(EXISTS ( SELECT 1
   FROM current_worker() cw(worker_id, role)
  WHERE ((cw.role = ''admin''::text) OR tc_worker_has_admin_access(cw.worker_id) OR (cw.worker_id = chat_threads.central_worker_id) OR (cw.worker_id = chat_threads.tarotist_worker_id))))'),
('public','chat_messages','chat_messages_participant_select','(EXISTS ( SELECT 1
   FROM (chat_threads t
     JOIN current_worker() cw(worker_id, role) ON (true))
  WHERE ((t.id = chat_messages.thread_id) AND ((cw.role = ''admin''::text) OR (cw.worker_id = t.central_worker_id) OR (cw.worker_id = t.tarotist_worker_id)))))',null,'(EXISTS ( SELECT 1
   FROM (chat_threads t
     JOIN current_worker() cw(worker_id, role) ON (true))
  WHERE ((t.id = chat_messages.thread_id) AND ((cw.role = ''admin''::text) OR tc_worker_has_admin_access(cw.worker_id) OR (cw.worker_id = t.central_worker_id) OR (cw.worker_id = t.tarotist_worker_id)))))',null),
('public','chat_messages','chat_messages_participant_insert',null,'(EXISTS ( SELECT 1
   FROM (chat_threads t
     JOIN current_worker() cw(worker_id, role) ON (true))
  WHERE ((t.id = chat_messages.thread_id) AND (cw.worker_id = chat_messages.sender_worker_id) AND ((cw.role = ''admin''::text) OR (cw.worker_id = t.central_worker_id) OR (cw.worker_id = t.tarotist_worker_id)))))',null,'(EXISTS ( SELECT 1
   FROM (chat_threads t
     JOIN current_worker() cw(worker_id, role) ON (true))
  WHERE ((t.id = chat_messages.thread_id) AND (cw.worker_id = chat_messages.sender_worker_id) AND ((cw.role = ''admin''::text) OR tc_worker_has_admin_access(cw.worker_id) OR (cw.worker_id = t.central_worker_id) OR (cw.worker_id = t.tarotist_worker_id)))))'),
('public','worker_store_claims','admin reads store claims','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = ( SELECT auth.uid() AS uid)) AND (w.role = ''admin''::text) AND (w.is_active IS NOT FALSE))))',null,'(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = ( SELECT auth.uid() AS uid)) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND (w.is_active IS NOT FALSE))))',null),
('public','cliente_payment_attempts','crm_link_staff_read','((provider = ''mollie''::text) AND (((provider_response -> ''metadata''::text) ->> ''source''::text) = ''crm_cobrador''::text) AND (EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = ( SELECT auth.uid() AS uid)) AND (w.is_active IS NOT FALSE) AND (w.role = ANY (ARRAY[''admin''::text, ''central''::text])) AND ((w.role = ''admin''::text) OR ((w.id)::text = ((cliente_payment_attempts.provider_response -> ''metadata''::text) ->> ''initiated_by_worker_id''::text)))))))',null,'((provider = ''mollie''::text) AND (((provider_response -> ''metadata''::text) ->> ''source''::text) = ''crm_cobrador''::text) AND (EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = ( SELECT auth.uid() AS uid)) AND (w.is_active IS NOT FALSE) AND (w.role = ANY (ARRAY[''admin''::text, ''central''::text])) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id) OR ((w.id)::text = ((cliente_payment_attempts.provider_response -> ''metadata''::text) ->> ''initiated_by_worker_id''::text)))))))',null),
('public','welldone_tariffs','welldone_tariffs_admin_select','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (lower(COALESCE(w.role, ''''::text)) = ''admin''::text) AND (COALESCE(w.is_active, true) = true))))',null,'(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((lower(COALESCE(w.role, ''''::text)) = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND (COALESCE(w.is_active, true) = true))))',null),
('public','welldone_tariffs','welldone_tariffs_admin_insert',null,'(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (lower(COALESCE(w.role, ''''::text)) = ''admin''::text) AND (COALESCE(w.is_active, true) = true))))',null,'(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((lower(COALESCE(w.role, ''''::text)) = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND (COALESCE(w.is_active, true) = true))))'),
('public','welldone_tariffs','welldone_tariffs_admin_update','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (lower(COALESCE(w.role, ''''::text)) = ''admin''::text) AND (COALESCE(w.is_active, true) = true))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (lower(COALESCE(w.role, ''''::text)) = ''admin''::text) AND (COALESCE(w.is_active, true) = true))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((lower(COALESCE(w.role, ''''::text)) = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND (COALESCE(w.is_active, true) = true))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((lower(COALESCE(w.role, ''''::text)) = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND (COALESCE(w.is_active, true) = true))))'),
('public','tc_client_roulette_campaigns','tc_roulette_campaigns_admin_read','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ''admin''::text) AND (COALESCE(w.is_active, true) = true))))',null,'(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND (COALESCE(w.is_active, true) = true))))',null),
('public','tc_client_roulette_rewards','tc_roulette_rewards_admin_read','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ''admin''::text) AND (COALESCE(w.is_active, true) = true))))',null,'(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND (COALESCE(w.is_active, true) = true))))',null),
('public','tc_client_roulette_entitlements','tc_roulette_entitlements_admin_read','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ''admin''::text) AND (COALESCE(w.is_active, true) = true))))',null,'(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND (COALESCE(w.is_active, true) = true))))',null),
('public','cliente_ruleta_giros','tc_roulette_spins_admin_read','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ''admin''::text) AND (COALESCE(w.is_active, true) = true))))',null,'(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND (COALESCE(w.is_active, true) = true))))',null),
('public','accounting_entries','finance_admin_all_accounting_entries','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ''admin''::text) AND COALESCE(w.is_active, true))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ''admin''::text) AND COALESCE(w.is_active, true))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND COALESCE(w.is_active, true))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND COALESCE(w.is_active, true))))'),
('public','accounting_movement_options','finance_admin_all_accounting_movement_options','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ''admin''::text) AND COALESCE(w.is_active, true))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ''admin''::text) AND COALESCE(w.is_active, true))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND COALESCE(w.is_active, true))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND COALESCE(w.is_active, true))))'),
('public','accounting_receivables','finance_admin_all_accounting_receivables','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ''admin''::text) AND COALESCE(w.is_active, true))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ''admin''::text) AND COALESCE(w.is_active, true))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND COALESCE(w.is_active, true))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND COALESCE(w.is_active, true))))'),
('public','accounting_settlements','finance_admin_all_accounting_settlements','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ''admin''::text) AND COALESCE(w.is_active, true))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ''admin''::text) AND COALESCE(w.is_active, true))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND COALESCE(w.is_active, true))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND COALESCE(w.is_active, true))))'),
('public','accounting_audit_log','finance_admin_all_accounting_audit_log','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ''admin''::text) AND COALESCE(w.is_active, true))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND (w.role = ''admin''::text) AND COALESCE(w.is_active, true))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND COALESCE(w.is_active, true))))','(EXISTS ( SELECT 1
   FROM workers w
  WHERE ((w.user_id = auth.uid()) AND ((w.role = ''admin''::text) OR tc_worker_has_admin_access(w.id)) AND COALESCE(w.is_active, true))))')
  ) patches(schema_name,table_name,policy_name,old_qual,old_check,new_qual,new_check)
  loop
    select qual,with_check into current_qual,current_check from pg_policies
      where schemaname=r.schema_name and tablename=r.table_name and policyname=r.policy_name;
    if not found then raise exception 'ADMIN_ACCESS_POLICY_MISSING: %.%',r.table_name,r.policy_name; end if;
    -- pg_get_expr omits a visible public schema qualifier when canonicalizing.
    if replace(current_qual,'public.tc_worker_has_admin_access','tc_worker_has_admin_access') is not distinct from replace(r.new_qual,'public.tc_worker_has_admin_access','tc_worker_has_admin_access')
       and replace(current_check,'public.tc_worker_has_admin_access','tc_worker_has_admin_access') is not distinct from replace(r.new_check,'public.tc_worker_has_admin_access','tc_worker_has_admin_access') then continue; end if;
    if current_qual is distinct from r.old_qual or current_check is distinct from r.old_check then
      raise exception 'ADMIN_ACCESS_POLICY_CHANGED: %.%',r.table_name,r.policy_name;
    end if;
    statement:=format('alter policy %I on %I.%I',r.policy_name,r.schema_name,r.table_name);
    if r.new_qual is not null then statement:=statement||' using ('||replace(replace(r.new_qual,'public.tc_worker_has_admin_access(','tc_worker_has_admin_access('),'tc_worker_has_admin_access(','public.tc_worker_has_admin_access(')||')'; end if;
    if r.new_check is not null then statement:=statement||' with check ('||replace(replace(r.new_check,'public.tc_worker_has_admin_access(','tc_worker_has_admin_access('),'tc_worker_has_admin_access(','public.tc_worker_has_admin_access(')||')'; end if;
    execute statement;
  end loop;
end $patch_policies$;

notify pgrst, 'reload schema';

