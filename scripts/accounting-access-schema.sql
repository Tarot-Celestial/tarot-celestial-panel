-- Reviewed schema source. Generate a versioned migration with the Supabase CLI
-- before applying in an environment with migration history.
-- No password, hash of a user password, or reusable access token is seeded here.

create table if not exists public.tc_accounting_login_attempts (
  user_id uuid primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts between 0 and 5)
);
alter table public.tc_accounting_login_attempts enable row level security;
revoke all on public.tc_accounting_login_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.tc_accounting_login_attempts to service_role;

create table if not exists public.tc_accounting_access_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null,
  auth_session_id uuid not null,
  password_version text not null check (password_version ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '1 hour')
);
create index if not exists tc_accounting_access_sessions_user_expiry
  on public.tc_accounting_access_sessions(user_id, expires_at);
create unique index if not exists tc_accounting_access_sessions_auth_session
  on public.tc_accounting_access_sessions(user_id, auth_session_id);
alter table public.tc_accounting_access_sessions enable row level security;
revoke all on public.tc_accounting_access_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.tc_accounting_access_sessions to service_role;

-- service_role deliberately has no SELECT on auth.sessions. This private,
-- boolean-only lookup is the sole SECURITY DEFINER boundary; it does not grant
-- table/schema access to Auth and exposes no session data to browser roles.
create schema if not exists private;
grant usage on schema private to service_role;
create or replace function private.tc_accounting_auth_session_active(p_actor uuid, p_auth_session_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $function$
declare v_subject uuid;
begin
  -- current_user is the definer here; the role setting retains the actual caller.
  if current_setting('role', true) is distinct from 'service_role'
     or p_actor is null or p_auth_session_id is null then return false; end if;
  v_subject := auth.uid();
  if v_subject is not null and v_subject <> p_actor then return false; end if;
  if public.tc_has_admin_access(p_actor) is not true then return false; end if;
  return exists (
    select 1 from auth.sessions s
    where s.id = p_auth_session_id and s.user_id = p_actor
      and (s.not_after is null or s.not_after > now())
  );
end $function$;
revoke all on function private.tc_accounting_auth_session_active(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function private.tc_accounting_auth_session_active(uuid,uuid) to service_role;

create or replace function public.tc_accounting_reserve_login_attempt(p_actor uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare
  v_attempt public.tc_accounting_login_attempts%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_actor is null or public.tc_has_admin_access(p_actor) is not true then raise exception 'FORBIDDEN'; end if;
  insert into public.tc_accounting_login_attempts(user_id, window_started_at, attempts)
    values(p_actor, v_now, 0) on conflict(user_id) do nothing;
  select * into v_attempt from public.tc_accounting_login_attempts where user_id = p_actor for update;
  if v_attempt.window_started_at + interval '15 minutes' <= v_now then
    update public.tc_accounting_login_attempts set window_started_at = v_now, attempts = 1 where user_id = p_actor;
    return jsonb_build_object('allowed', true, 'remaining', 4, 'retry_after', 0);
  end if;
  if v_attempt.attempts >= 5 then
    return jsonb_build_object('allowed', false, 'remaining', 0,
      'retry_after', greatest(1, ceil(extract(epoch from v_attempt.window_started_at + interval '15 minutes' - v_now))::integer));
  end if;
  update public.tc_accounting_login_attempts set attempts = attempts + 1 where user_id = p_actor;
  return jsonb_build_object('allowed', true, 'remaining', 4 - v_attempt.attempts, 'retry_after', 0);
end $function$;

create or replace function public.tc_accounting_open_session(
  p_actor uuid, p_auth_session_id uuid, p_token_hash text, p_password_version text
)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_expires timestamptz := v_now + interval '1 hour';
begin
  if p_actor is null or public.tc_has_admin_access(p_actor) is not true then raise exception 'FORBIDDEN'; end if;
  if p_auth_session_id is null or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
     or p_password_version is null or p_password_version !~ '^[a-f0-9]{64}$' then
    raise exception 'INVALID_SESSION';
  end if;
  if private.tc_accounting_auth_session_active(p_actor, p_auth_session_id) is not true then
    raise exception 'AUTH_SESSION_REVOKED';
  end if;
  -- One module session per Auth session; re-unlock invalidates its previous cookie.
  delete from public.tc_accounting_access_sessions
    where user_id = p_actor and (expires_at <= v_now or auth_session_id = p_auth_session_id);
  insert into public.tc_accounting_access_sessions(token_hash, user_id, auth_session_id, password_version, created_at, expires_at)
    values(p_token_hash, p_actor, p_auth_session_id, p_password_version, v_now, v_expires);
  update public.tc_accounting_login_attempts set attempts = 0, window_started_at = v_now where user_id = p_actor;
  return jsonb_build_object('expires_at', v_expires);
end $function$;

create or replace function public.tc_accounting_read_session(
  p_actor uuid, p_auth_session_id uuid, p_token_hash text, p_password_version text
)
returns jsonb language plpgsql stable security invoker set search_path = '' as $function$
declare v_expires timestamptz;
begin
  if p_actor is null or public.tc_has_admin_access(p_actor) is not true then raise exception 'FORBIDDEN'; end if;
  if private.tc_accounting_auth_session_active(p_actor, p_auth_session_id) is not true then
    return jsonb_build_object('valid', false);
  end if;
  select expires_at into v_expires from public.tc_accounting_access_sessions
    where token_hash = p_token_hash and user_id = p_actor and auth_session_id = p_auth_session_id
      and password_version = p_password_version and expires_at > now();
  if v_expires is null then return jsonb_build_object('valid', false); end if;
  return jsonb_build_object('valid', true, 'expires_at', v_expires);
end $function$;

create or replace function public.tc_accounting_close_session(p_actor uuid, p_token_hash text)
returns boolean language plpgsql security invoker set search_path = '' as $function$
begin
  if p_actor is null or public.tc_has_admin_access(p_actor) is not true then raise exception 'FORBIDDEN'; end if;
  delete from public.tc_accounting_access_sessions where token_hash = p_token_hash and user_id = p_actor;
  return true;
end $function$;

revoke all on function public.tc_accounting_reserve_login_attempt(uuid) from public, anon, authenticated;
revoke all on function public.tc_accounting_open_session(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.tc_accounting_read_session(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.tc_accounting_close_session(uuid,text) from public, anon, authenticated;
grant execute on function public.tc_accounting_reserve_login_attempt(uuid) to service_role;
grant execute on function public.tc_accounting_open_session(uuid,uuid,text,text) to service_role;
grant execute on function public.tc_accounting_read_session(uuid,uuid,text,text) to service_role;
grant execute on function public.tc_accounting_close_session(uuid,text) to service_role;
