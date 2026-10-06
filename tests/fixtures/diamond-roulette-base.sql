-- Isolated contract fixture for infrastructure not versioned in this repository.
-- It does not claim to reproduce or validate the deployed Supabase schema.
create role anon; create role authenticated; create role service_role bypassrls;
create table crm_clientes(id uuid primary key, minutos_free_pendientes numeric default 0,minutos_normales_pendientes numeric default 0,updated_at timestamptz default now(),rank text default 'diamante');
create table tc_client_roulette_campaigns(id uuid primary key default gen_random_uuid(),status text default 'active',starts_at timestamptz,ends_at timestamptz,active_until_disabled boolean default true,diamond_enabled boolean default false,created_at timestamptz default now(),updated_at timestamptz default now());
create table tc_client_roulette_rewards(id uuid primary key default gen_random_uuid(),campaign_id uuid references tc_client_roulette_campaigns(id),nivel integer check(nivel between 1 and 5),name text,description text,reward_type text check(reward_type in ('minutes','coins','rank','ritual','streak_minutes','perk')),reward_value numeric,rarity text,weight numeric,special boolean,fulfillment_mode text,metadata jsonb,is_active boolean,sort_order integer,updated_at timestamptz default now());
create table cliente_ruleta_giros(id uuid primary key default gen_random_uuid(),cliente_id uuid references crm_clientes(id),payment_key text unique,source text,nivel smallint check(nivel between 1 and 5),estado text,required_rank text,created_at timestamptz default now(),used_at timestamptz,campaign_id uuid,reward_id uuid,reward_type text,reward_value numeric,reward_label text,reward_rarity text,result_status text);
create table tc_client_roulette_audit(id uuid primary key default gen_random_uuid(),campaign_id uuid,reward_id uuid,actor_user_id uuid,action text,snapshot jsonb);
create table cliente_notificaciones(id uuid primary key default gen_random_uuid(),cliente_id uuid,tipo text,titulo text,mensaje text,meta jsonb,leida boolean,created_at timestamptz);
create table fixture_oracle_ledger(cliente_id uuid,amount integer,delivery_key text primary key,meta jsonb);
create table fixture_signals(cliente_id uuid primary key,revision integer default 0);
create function tc_assert_benefit_admin(p_actor uuid) returns void language plpgsql as $$ begin
 if p_actor is distinct from 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid then raise exception 'FORBIDDEN'; end if;
end $$;
create function tc_touch_roulette_signal(p_cliente_id uuid) returns void language sql as $$
 insert into fixture_signals(cliente_id,revision) values(p_cliente_id,1) on conflict(cliente_id) do update set revision=fixture_signals.revision+1;
$$;
create function tc_client_rank_state(p_cliente_id uuid) returns jsonb language sql as $$ select jsonb_build_object('effective',rank) from crm_clientes where id=p_cliente_id $$;
create function tc_client_state_snapshot(p_cliente_id uuid) returns jsonb language sql as $$
 select jsonb_build_object('cliente_id',id,'minutes_free',minutos_free_pendientes,'minutes_normal',minutos_normales_pendientes,'spins',jsonb_build_object('diamond',999),'preserved_field',true) from crm_clientes where id=p_cliente_id;
$$;
create function grant_cliente_oracle_credits(p_cliente_id uuid,p_amount integer,p_key text,p_source text,p_label text,p_meta jsonb) returns void language sql as $$
 insert into fixture_oracle_ledger values(p_cliente_id,p_amount,p_key,p_meta) on conflict(delivery_key) do nothing;
$$;
