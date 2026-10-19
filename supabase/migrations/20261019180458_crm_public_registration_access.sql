-- Public registration must not make the existing CRM a public Data API.
-- CRM/profile mutations already use authenticated server routes and service_role.
-- Keep browser SELECT for staff Realtime and a customer's own CRM record only.
alter table public.crm_clientes enable row level security;
alter table public.crm_cliente_etiquetas enable row level security;
alter table public.crm_etiquetas enable row level security;

revoke all on table public.crm_clientes, public.crm_cliente_etiquetas, public.crm_etiquetas
  from public, anon, authenticated;
grant select on table public.crm_clientes, public.crm_cliente_etiquetas, public.crm_etiquetas
  to authenticated;
grant all on table public.crm_clientes, public.crm_cliente_etiquetas, public.crm_etiquetas
  to service_role;

-- The workers lookup runs as the authenticated caller. Its existing SELECT policy
-- exposes their own row; no new SECURITY DEFINER or editable JWT claims are needed.
drop policy if exists crm_clientes_staff_or_owner_select on public.crm_clientes;
create policy crm_clientes_staff_or_owner_select on public.crm_clientes
  for select to authenticated
  using (
    auth_user_id = (select auth.uid())
    or (select exists (
      select 1 from public.workers w
      where w.user_id = (select auth.uid())
        and w.is_active is true
        and w.role in ('admin', 'central')
    ))
  );

drop policy if exists crm_cliente_etiquetas_staff_or_owner_select on public.crm_cliente_etiquetas;
create policy crm_cliente_etiquetas_staff_or_owner_select on public.crm_cliente_etiquetas
  for select to authenticated
  using (
    (select exists (
      select 1 from public.workers w
      where w.user_id = (select auth.uid())
        and w.is_active is true
        and w.role in ('admin', 'central')
    ))
    or exists (
      select 1 from public.crm_clientes c
      where c.id = crm_cliente_etiquetas.cliente_id
        and c.auth_user_id = (select auth.uid())
    )
  );

drop policy if exists crm_etiquetas_staff_select on public.crm_etiquetas;
create policy crm_etiquetas_staff_select on public.crm_etiquetas
  for select to authenticated
  using ((select exists (
    select 1 from public.workers w
    where w.user_id = (select auth.uid())
      and w.is_active is true
      and w.role in ('admin', 'central')
  )));

-- These unused legacy entry points bypass RLS and trust arbitrary client/payment
-- identifiers in their payload. The current call flow uses the service-only v8
-- and tc_register_call_recovery wrappers. Preserve legacy server compatibility.
do $$
declare signature text;
begin
  foreach signature in array array[
    'public.crm_register_call_atomic_v3(jsonb)',
    'public.crm_register_call_atomic_v4(jsonb)'
  ] loop
    if to_regprocedure(signature) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', signature);
      execute format('grant execute on function %s to service_role', signature);
    end if;
  end loop;
end;
$$;
