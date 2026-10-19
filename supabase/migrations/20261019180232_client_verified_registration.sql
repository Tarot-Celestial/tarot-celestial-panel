-- Verification state is accessible only to the trusted registration API.
create table public.tc_client_registration_challenges (
  id uuid primary key,
  profile jsonb not null,
  code_hash text not null,
  ip_hash text not null,
  attempts integer not null default 0,
  state text not null default 'pending' check(state in ('pending','processing','completed','failed')),
  lease_id uuid,
  lease_until timestamptz,
  auth_user_id uuid,
  cliente_id uuid references public.crm_clientes(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
alter table public.tc_client_registration_challenges enable row level security;
revoke all on public.tc_client_registration_challenges from public, anon, authenticated;
grant all on public.tc_client_registration_challenges to service_role;
create index tc_client_registration_created_idx on public.tc_client_registration_challenges(created_at);
create index tc_client_registration_email_idx on public.tc_client_registration_challenges((profile->>'email'),created_at);
create index tc_client_registration_ip_idx on public.tc_client_registration_challenges(ip_hash,created_at);

create function public.tc_client_registration_start(p_id uuid,p_profile jsonb,p_code_hash text,p_ip_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_phone text := p_profile->>'phone'; v_email text := p_profile->>'email';
begin
  if v_phone is null or v_phone !~ '^[1-9][0-9]{6,14}$' or length(coalesce(v_email,'')) < 5
     or length(coalesce(p_profile->>'name','')) < 2 or length(p_code_hash) <> 64 then
    return jsonb_build_object('ok',false,'error','DATOS_INCOMPLETOS');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('registration-ip:'||p_ip_hash,0));
  perform pg_advisory_xact_lock(hashtextextended('registration-email:'||v_email,0));
  if (select count(*) from public.tc_client_registration_challenges where ip_hash=p_ip_hash and created_at>now()-interval '1 hour')>=10
     or (select count(*) from public.tc_client_registration_challenges where profile->>'email'=v_email and created_at>now()-interval '1 hour')>=3
     or exists(select 1 from public.tc_client_registration_challenges where profile->>'email'=v_email and created_at>now()-interval '1 minute') then
    return jsonb_build_object('ok',false,'error','REGISTRATION_RATE_LIMIT');
  end if;
  if exists(select 1 from public.crm_clientes c where lower(btrim(c.email))=v_email
      or regexp_replace(c.telefono_normalizado,'[^0-9]','','g')=v_phone
      or regexp_replace(c.telefono,'[^0-9]','','g')=v_phone
      or (left(v_phone,2)='34' and length(v_phone)=11 and (regexp_replace(c.telefono,'[^0-9]','','g')=right(v_phone,9) or regexp_replace(c.telefono_normalizado,'[^0-9]','','g')=right(v_phone,9)))) then
    return jsonb_build_object('ok',false,'error','REGISTRATION_ACCOUNT_EXISTS');
  end if;
  -- Discard old verification payloads, keeping no unnecessary PII indefinitely.
  delete from public.tc_client_registration_challenges where created_at<now()-interval '7 days';
  insert into public.tc_client_registration_challenges(id,profile,code_hash,ip_hash) values(p_id,p_profile,p_code_hash,p_ip_hash);
  return jsonb_build_object('ok',true);
end $$;

create function public.tc_client_registration_claim(p_id uuid,p_code_hash text,p_lease uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v public.tc_client_registration_challenges%rowtype;
begin
  select * into v from public.tc_client_registration_challenges where id=p_id for update;
  if not found or v.expires_at<now() or v.state='failed' or v.attempts>=5 then
    return jsonb_build_object('ok',false,'error','OTP_EXPIRED');
  end if;
  if v.code_hash<>p_code_hash then
    update public.tc_client_registration_challenges set attempts=attempts+1 where id=p_id;
    return jsonb_build_object('ok',false,'error','CODIGO_INVALIDO');
  end if;
  if v.state='completed' then return jsonb_build_object('ok',true,'completed',true,'email',v.profile->>'email'); end if;
  if v.state='processing' and v.lease_until>now() then return jsonb_build_object('ok',false,'error','REGISTRATION_IN_PROGRESS'); end if;
  update public.tc_client_registration_challenges set state='processing',lease_id=p_lease,lease_until=now()+interval '2 minutes' where id=p_id;
  return jsonb_build_object('ok',true,'profile',v.profile,'auth_user_id',v.auth_user_id);
end $$;

create function public.tc_client_registration_complete(p_id uuid,p_lease uuid,p_auth_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v public.tc_client_registration_challenges%rowtype; v_cliente uuid; v_tag uuid; v_phone text; v_email text;
begin
  select * into v from public.tc_client_registration_challenges where id=p_id for update;
  if not found or v.lease_id is distinct from p_lease or v.auth_user_id is distinct from p_auth_user_id then
    return jsonb_build_object('ok',false,'error','REGISTRATION_IN_PROGRESS');
  end if;
  if v.state='completed' then return jsonb_build_object('ok',true,'cliente_id',v.cliente_id); end if;
  if v.state<>'processing' or v.expires_at<now() then return jsonb_build_object('ok',false,'error','OTP_EXPIRED'); end if;
  v_phone:=v.profile->>'phone'; v_email:=v.profile->>'email';
  -- The service API has verified the exact Auth identity with the Auth admin API.
  if exists(select 1 from public.workers w where w.user_id=p_auth_user_id) then
    return jsonb_build_object('ok',false,'error','REGISTRATION_ACCOUNT_EXISTS');
  end if;
  -- Serialize registrations for the same phone/email; never merge into an old CRM record.
  perform pg_advisory_xact_lock(hashtextextended('registration-phone:'||v_phone,0));
  perform pg_advisory_xact_lock(hashtextextended('registration-email:'||v_email,0));
  if exists(select 1 from public.crm_clientes c where c.auth_user_id=p_auth_user_id or lower(btrim(c.email))=v_email
      or regexp_replace(c.telefono_normalizado,'[^0-9]','','g')=v_phone or regexp_replace(c.telefono,'[^0-9]','','g')=v_phone
      or (left(v_phone,2)='34' and length(v_phone)=11 and (regexp_replace(c.telefono,'[^0-9]','','g')=right(v_phone,9) or regexp_replace(c.telefono_normalizado,'[^0-9]','','g')=right(v_phone,9)))) then
    return jsonb_build_object('ok',false,'error','REGISTRATION_ACCOUNT_EXISTS');
  end if;
  insert into public.crm_clientes(nombre,apellido,telefono,telefono_normalizado,email,pais,auth_user_id,origen,lead_source,lead_status,lead_created_at)
  values(v.profile->>'name',nullif(v.profile->>'surname',''),v_phone,v_phone,v_email,v.profile->>'country',p_auth_user_id,
         case when v.profile->>'source'='instagram' then 'instagram' else 'registro_web' end,
         case when v.profile->>'source'='instagram' then 'instagram' else 'web' end,'nuevo',now()) returning id into v_cliente;
  if v.profile->>'source'='instagram' then
    perform pg_advisory_xact_lock(hashtextextended('crm-tag:cliente instagram',0));
    select id into v_tag from public.crm_etiquetas where nombre='cliente instagram' order by created_at limit 1;
    if v_tag is null then insert into public.crm_etiquetas(nombre,color,activa) values('cliente instagram','#d946ef',true) returning id into v_tag; end if;
    insert into public.crm_cliente_etiquetas(cliente_id,etiqueta_id) values(v_cliente,v_tag);
  end if;
  update public.tc_client_registration_challenges set state='completed',cliente_id=v_cliente where id=p_id;
  return jsonb_build_object('ok',true,'cliente_id',v_cliente);
end $$;

revoke all on function public.tc_client_registration_start(uuid,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.tc_client_registration_claim(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.tc_client_registration_complete(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.tc_client_registration_start(uuid,jsonb,text,text) to service_role;
grant execute on function public.tc_client_registration_claim(uuid,text,uuid) to service_role;
grant execute on function public.tc_client_registration_complete(uuid,uuid,uuid) to service_role;
