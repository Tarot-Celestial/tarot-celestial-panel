-- READ ONLY. Export these result sets to validate against the actual Supabase schema.
select table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns where table_schema='public' and table_name in (
 'tc_client_rank_benefits','tc_client_benefit_events','tc_client_benefit_audit',
 'crm_clientes','crm_cliente_pagos','cliente_puntos_historial','rendimiento_llamadas',
 'client_rank_overrides','cliente_payment_attempts','client_rituals')
order by table_name,ordinal_position;

select p.oid::regprocedure as signature,pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and (p.proname in (
 'cliente_confirmar_compra_ruleta_v2','cliente_confirmar_compra_ruleta_v3',
 'cliente_confirmar_compra_promocion_v1','crm_register_call_atomic_v8',
 'tc_client_rank_state','tc_save_rank_benefit_config',
 'grant_cliente_oracle_credits','grant_cliente_oracle_questions',
 'get_cliente_oracle_balance','get_cliente_oracle_question_balance')
 or p.proname ilike '%benefit%');

select c.relname as table_name,t.tgname,pg_get_triggerdef(t.oid) as trigger_definition,
 pg_get_functiondef(t.tgfoid) as function_definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal and n.nspname='public' and c.relname in (
 'crm_cliente_pagos','crm_clientes','rendimiento_llamadas','cliente_payment_attempts','tc_client_rank_benefits');

select * from pg_policies where schemaname='public' and tablename in (
 'tc_client_rank_benefits','client_rituals','crm_cliente_pagos','crm_clientes');
select * from information_schema.role_routine_grants
where routine_schema='public' and routine_name in (
 'cliente_confirmar_compra_ruleta_v2','cliente_confirmar_compra_ruleta_v3',
 'cliente_confirmar_compra_promocion_v1','crm_register_call_atomic_v8','tc_save_rank_benefit_config');
