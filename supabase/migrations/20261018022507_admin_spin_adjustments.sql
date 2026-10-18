set local lock_timeout = '5s';
alter table public.cliente_ruleta_giros drop constraint if exists cliente_ruleta_giros_estado_check;
alter table public.cliente_ruleta_giros add constraint cliente_ruleta_giros_estado_check check (estado in ('pending','used','revoked'));
create table if not exists public.tc_admin_spin_adjustments (
 operation_id uuid primary key, cliente_id uuid not null references public.crm_clientes(id),
 actor_user_id uuid not null, nivel smallint not null check(nivel between 1 and 5),
 delta integer not null check(delta<>0 and abs(delta)<=100), reason text not null,
 before_count integer not null, after_count integer not null, spin_ids uuid[] not null,
 created_at timestamptz not null default now()
);
alter table public.tc_admin_spin_adjustments enable row level security;
revoke all on public.tc_admin_spin_adjustments from public, anon, authenticated;
grant select,insert on public.tc_admin_spin_adjustments to service_role;
create index if not exists tc_admin_spin_adjustments_client_date on public.tc_admin_spin_adjustments(cliente_id,created_at desc);
create or replace function public.tc_admin_adjust_spins(p_operation_id uuid,p_cliente_id uuid,p_actor_user_id uuid,p_level integer,p_delta integer,p_reason text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare prior public.tc_admin_spin_adjustments; ids uuid[]; n integer; actor text;
begin
 if p_operation_id is null or p_cliente_id is null or p_actor_user_id is null or p_level is null or p_level not between 1 and 5 or p_delta is null or p_delta=0 or abs(p_delta::bigint)>100 or length(trim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'INVALID_ADJUSTMENT'; end if;
 select coalesce(display_name,email,'Admin') into actor from public.workers where user_id=p_actor_user_id and role='admin' and is_active is distinct from false;
 if not found then raise exception 'FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtext('admin-spin:'||p_operation_id::text));
 select * into prior from public.tc_admin_spin_adjustments where operation_id=p_operation_id;
 if found then
  if prior.cliente_id<>p_cliente_id or prior.actor_user_id<>p_actor_user_id or prior.nivel<>p_level or prior.delta<>p_delta or prior.reason<>trim(p_reason) then raise exception 'OPERATION_CONFLICT'; end if;
  return to_jsonb(prior)||jsonb_build_object('replayed',true);
 end if;
 -- Same locking order as cliente_girar_ruleta_ultra_v1: client, then spin.
 perform 1 from public.crm_clientes where id=p_cliente_id for update;
 if not found then raise exception 'CLIENT_NOT_FOUND'; end if;
 select count(*) into n from public.cliente_ruleta_giros where cliente_id=p_cliente_id and nivel=p_level and estado='pending';
 if p_delta<0 and n < -p_delta then raise exception 'INSUFFICIENT_SPINS'; end if;
 if p_delta>0 then
  with added as (
   insert into public.cliente_ruleta_giros(cliente_id,payment_key,source,nivel,estado,required_rank)
   select p_cliente_id,'admin-adjustment:'||p_operation_id||':'||i,'admin_adjustment',p_level,'pending',case when p_level=5 then 'diamante' else null end from generate_series(1,p_delta) i returning id
  ) select array_agg(id) into ids from added;
 else
  select array_agg(id) into ids from (select id from public.cliente_ruleta_giros where cliente_id=p_cliente_id and nivel=p_level and estado='pending' order by created_at desc,id limit -p_delta for update) s;
  update public.cliente_ruleta_giros set estado='revoked' where id=any(ids) and estado='pending';
 end if;
 insert into public.tc_admin_spin_adjustments values(p_operation_id,p_cliente_id,p_actor_user_id,p_level,p_delta,trim(p_reason),n,n+p_delta,ids,now()) returning * into prior;
 insert into public.crm_client_notes(cliente_id,texto,author_user_id,author_name,event_type,event_data,is_pinned)
 values(p_cliente_id::text,format('Ajuste de giros · Nivel %s · %s → %s. %s',p_level,n,n+p_delta,trim(p_reason)),p_actor_user_id,actor,'admin_spin_adjustment',to_jsonb(prior),false);
 return to_jsonb(prior)||jsonb_build_object('replayed',false);
end $$;
revoke all on function public.tc_admin_adjust_spins(uuid,uuid,uuid,integer,integer,text) from public,anon,authenticated;
grant execute on function public.tc_admin_adjust_spins(uuid,uuid,uuid,integer,integer,text) to service_role;
