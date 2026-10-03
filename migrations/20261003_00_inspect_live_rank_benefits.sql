-- READ ONLY · ejecutar primero contra Supabase real.
-- No crea, altera ni borra nada. Sirve para comprobar qué está realmente aplicado.

select table_name, column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name in (
  'tc_client_rank_benefits','tc_rank_package_benefits','tc_purchase_package_levels',
  'tc_client_benefit_events','tc_client_benefit_audit','tc_rank_daily_bonus_config',
  'tc_client_promotions','tc_client_promotion_packages','crm_cliente_pagos',
  'cliente_payment_attempts','cliente_ruleta_giros','client_rank_overrides','client_rituals'
)
order by table_name, ordinal_position;

select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as result,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'tc_client_rank_state','tc_rank_phase_one_state','tc_apply_purchase_benefits',
  'tc_purchase_benefits_trigger','cliente_confirmar_compra_ruleta_v2',
  'cliente_confirmar_compra_ruleta_v3','cliente_confirmar_compra_promocion_v1',
  'crm_register_call_atomic_v8','crm_cancel_call_payment_atomic',
  'grant_cliente_oracle_credits','get_cliente_oracle_balance',
  'tc_available_rank_bonuses','tc_claim_rank_bonus','tc_confirm_rank_purchase'
)
order by p.proname, arguments;

select c.relname as table_name, t.tgname as trigger_name,
       pg_get_triggerdef(t.oid) as trigger_definition,
       p.proname as trigger_function
from pg_trigger t
join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
join pg_proc p on p.oid=t.tgfoid
where n.nspname='public' and not t.tgisinternal
  and c.relname in ('crm_cliente_pagos','rendimiento_llamadas','cliente_ruleta_giros','crm_clientes')
order by c.relname,t.tgname;

select c.relname as table_name, con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class c on c.oid=con.conrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in (
  'tc_client_rank_benefits','tc_client_benefit_events','crm_cliente_pagos','cliente_ruleta_giros','client_rank_overrides'
)
order by c.relname,con.conname;

select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies
where schemaname='public' and tablename in (
  'tc_client_rank_benefits','tc_client_benefit_events','tc_client_benefit_audit','crm_cliente_pagos','cliente_ruleta_giros','client_rituals'
)
order by tablename,policyname;
