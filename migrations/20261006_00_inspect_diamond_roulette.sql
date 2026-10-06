-- Read-only preflight against project eparrucwxmebscsgvldj.
-- These results contain schema/configuration, not customer rows or credentials.
select table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns where table_schema='public' and table_name in (
 'crm_clientes','cliente_ruleta_giros','tc_client_roulette_campaigns','tc_client_roulette_rewards',
 'tc_client_roulette_audit','cliente_notificaciones','cliente_oracle_credit_movements')
order by table_name,ordinal_position;

select c.conrelid::regclass as table_name,c.conname,pg_get_constraintdef(c.oid) as definition
from pg_constraint c where c.conrelid in (
 'public.cliente_ruleta_giros'::regclass,'public.tc_client_roulette_rewards'::regclass,
 'public.tc_client_roulette_campaigns'::regclass,'public.cliente_notificaciones'::regclass,
 'public.tc_client_roulette_audit'::regclass)
order by table_name,conname;

select p.oid::regprocedure as signature,p.prosecdef as security_definer,p.proacl as privileges
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
 'tc_assert_benefit_admin','tc_touch_roulette_signal','grant_cliente_oracle_credits',
 'tc_client_rank_state','tc_client_state_snapshot','cliente_ruleta_resumen_ultra_v1',
 'cliente_girar_ruleta_ultra_v1','cliente_ruleta_reclamar_beneficio_v1')
order by signature::text;

select id,status,diamond_enabled,starts_at,ends_at,active_until_disabled
from public.tc_client_roulette_campaigns where status='active';
select campaign_id,nivel,count(*) as prizes,sum(weight) as weight_total
from public.tc_client_roulette_rewards where is_active group by campaign_id,nivel order by campaign_id,nivel;
select source,nivel,estado,count(*) as spins from public.cliente_ruleta_giros
where source in ('diamond_rank_purchase','admin_manual_diamond') group by source,nivel,estado;
