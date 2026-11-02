CREATE OR REPLACE FUNCTION public.tc_enforce_ruleta_spin_level_from_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row jsonb := to_jsonb(new);
  v_amount numeric := null;
  v_expected smallint := null;
  v_ref text;
  v_purchase_id uuid := null;
begin
  -- Los giros explícitos de rango/bono conservan exactamente el nivel configurado.
  if coalesce(new.source,'') in ('rank_package_matrix','rank_daily_bonus') then
    return new;
  end if;

  -- Nivel Especial queda fuera de la regla automática por importe.
  if new.nivel = 4 then return new; end if;

  v_ref := coalesce(new.payment_key, '');

  begin
    if v_ref like 'crm_pago:%' then
      select p.importe into v_amount
      from public.crm_cliente_pagos p
      where p.id = substring(v_ref from length('crm_pago:') + 1)::uuid;
    elsif v_ref like 'rendimiento:%' then
      select r.importe into v_amount
      from public.rendimiento_llamadas r
      where r.id = substring(v_ref from length('rendimiento:') + 1)::uuid;
    end if;
  exception when others then
    v_amount := null;
  end;

  if v_amount is null and nullif(v_row->>'purchase_id','') is not null then
    begin
      v_purchase_id := (v_row->>'purchase_id')::uuid;
      select p.importe into v_amount
      from public.crm_cliente_pagos p
      where p.id = v_purchase_id;
    exception when others then
      v_amount := null;
    end;
  end if;

  if v_amount is null then return new; end if;
  v_expected := public.tc_ruleta_level_for_amount(v_amount);
  if v_expected is null then return null; end if;

  new.nivel := v_expected;
  return new;
end;
$function$;
create trigger trg_tc_enforce_ruleta_spin_level_from_amount before insert or update on cliente_ruleta_giros
for each row execute function tc_enforce_ruleta_spin_level_from_amount();
