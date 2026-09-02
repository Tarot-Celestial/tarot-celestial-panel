-- TAROT CELESTIAL · PRECIOS + RULETA POR NIVELES + 1 GIRO/COMPRA + STRIPE/REDSYS
-- Ejecutar una sola vez en Supabase SQL Editor.
-- El script también actualiza de forma segura una instalación anterior de esta misma ruleta.

create extension if not exists pgcrypto;

-- 1) Pasarela activa para nuevas compras del panel cliente.
create table if not exists public.cliente_payment_settings (
  id text primary key,
  provider text not null default 'redsys' check (provider in ('stripe','redsys')),
  updated_at timestamptz not null default now(),
  updated_by uuid null
);

insert into public.cliente_payment_settings (id, provider)
values ('default', 'redsys')
on conflict (id) do nothing;

alter table public.cliente_payment_settings enable row level security;

-- 2) Intentos Redsys. La confirmación real se realiza únicamente desde el webhook firmado.
create table if not exists public.cliente_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null,
  provider text not null check (provider in ('redsys','stripe')),
  order_id text not null unique,
  public_token uuid not null unique default gen_random_uuid(),
  pack_id text not null,
  amount numeric(12,2) not null,
  currency text not null default 'USD',
  total_minutes integer not null,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','cancelled')),
  provider_response jsonb null,
  last_error text null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cliente_payment_attempts_cliente_idx
  on public.cliente_payment_attempts (cliente_id, created_at desc);
create index if not exists cliente_payment_attempts_status_idx
  on public.cliente_payment_attempts (provider, status, created_at desc);

alter table public.cliente_payment_attempts enable row level security;

-- 3) Giros pendientes/usados.
-- payment_key hace idempotente la concesión: la misma compra nunca genera dos giros.
create table if not exists public.cliente_ruleta_giros (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null,
  payment_key text not null unique,
  source text not null,
  nivel smallint not null default 1,
  purchase_minutes integer null,
  estado text not null default 'pending' check (estado in ('pending','used')),
  premio_minutos integer null,
  created_at timestamptz not null default now(),
  used_at timestamptz null
);

-- Compatibilidad si ya se ejecutó la primera versión de la ruleta.
alter table public.cliente_ruleta_giros add column if not exists nivel smallint not null default 1;
alter table public.cliente_ruleta_giros add column if not exists purchase_minutes integer null;

alter table public.cliente_ruleta_giros
  drop constraint if exists cliente_ruleta_giros_nivel_check;
alter table public.cliente_ruleta_giros
  add constraint cliente_ruleta_giros_nivel_check check (nivel in (1,2));

alter table public.cliente_ruleta_giros
  drop constraint if exists cliente_ruleta_giros_premio_minutos_check;
alter table public.cliente_ruleta_giros
  add constraint cliente_ruleta_giros_premio_minutos_check
  check (premio_minutos is null or premio_minutos in (2,3,4,5,6,7,8,10,12,14,16,60,80));

create index if not exists cliente_ruleta_giros_cliente_estado_idx
  on public.cliente_ruleta_giros (cliente_id, estado, created_at);
create index if not exists cliente_ruleta_giros_cliente_nivel_estado_idx
  on public.cliente_ruleta_giros (cliente_id, nivel, estado, created_at);

alter table public.cliente_ruleta_giros enable row level security;

-- Ayudantes para detectar de forma robusta los minutos comprados tanto en pagos web
-- como en registros manuales, sin depender de un único nombre de columna histórico.
create or replace function public.tc_json_number(p_data jsonb, variadic p_keys text[])
returns numeric
language plpgsql
immutable
as $$
declare
  v_key text;
  v_raw text;
begin
  foreach v_key in array p_keys loop
    v_raw := nullif(trim(coalesce(p_data->>v_key, '')), '');
    if v_raw is not null and replace(v_raw, ',', '.') ~ '^[0-9]+([.][0-9]+)?$' then
      return replace(v_raw, ',', '.')::numeric;
    end if;
  end loop;
  return null;
end;
$$;

create or replace function public.tc_ruleta_purchase_minutes(p_data jsonb, p_source text default '')
returns integer
language plpgsql
immutable
as $$
declare
  v_minutes numeric;
  v_amount numeric;
  v_text text;
begin
  v_minutes := public.tc_json_number(
    p_data,
    'total_minutes', 'minutos_totales', 'minutes_total', 'paid_minutes', 'minutos_pagados', 'minutos_normales', 'normal_minutes'
  );

  if coalesce(v_minutes, 0) > 0 then
    return round(v_minutes)::integer;
  end if;

  if lower(coalesce(p_source, '')) = 'rendimiento_llamadas' then
    v_minutes :=
      coalesce(public.tc_json_number(p_data, 'minutos_1'), 0) +
      coalesce(public.tc_json_number(p_data, 'minutos_2'), 0) +
      coalesce(public.tc_json_number(p_data, 'minutos_guardados_free'), 0) +
      coalesce(public.tc_json_number(p_data, 'minutos_guardados_normales'), 0);

    if v_minutes > 0 then
      return round(v_minutes)::integer;
    end if;
  end if;

  -- Si el registro conserva el nombre/ID del paquete, intentamos extraer el tamaño.
  v_text := lower(concat_ws(' ',
    p_data->>'pack_id', p_data->>'paquete_nombre', p_data->>'package_name',
    p_data->>'paquete', p_data->>'package', p_data->>'producto_nombre', p_data->>'product_name',
    p_data->>'notas', p_data->>'resumen_codigo'
  ));

  if v_text ~ '(^|[^0-9])60([^0-9]|$)' then return 60; end if;
  if v_text ~ '(^|[^0-9])50([^0-9]|$)' then return 50; end if;
  if v_text ~ '(^|[^0-9])40([^0-9]|$)' then return 40; end if;
  if v_text ~ '(^|[^0-9])30([^0-9]|$)' then return 30; end if;
  if v_text ~ '(^|[^0-9])20([^0-9]|$)' then return 20; end if;
  if v_text ~ '(^|[^0-9])10([^0-9]|$)' then return 10; end if;

  -- Último fallback para compras con los nuevos precios exactos.
  v_amount := public.tc_json_number(p_data, 'importe', 'amount', 'amount_usd');
  if v_amount is not null then
    if abs(v_amount - 12) < 0.01 then return 10; end if;
    if abs(v_amount - 22) < 0.01 then return 20; end if;
    if abs(v_amount - 26) < 0.01 then return 30; end if;
    if abs(v_amount - 29) < 0.01 then return 40; end if;
    if abs(v_amount - 32) < 0.01 then return 50; end if;
    if abs(v_amount - 35) < 0.01 then return 60; end if;
  end if;

  return null;
end;
$$;

create or replace function public.tc_ruleta_level_for_minutes(p_minutes integer, p_amount numeric default null)
returns smallint
language plpgsql
immutable
as $$
begin
  if p_minutes in (10,20,30) then return 1; end if;
  if p_minutes in (40,50,60) then return 2; end if;
  if coalesce(p_minutes, 0) > 0 then return case when p_minutes <= 30 then 1 else 2 end; end if;
  if p_amount is not null then return case when p_amount >= 29 then 2 else 1 end; end if;
  return 1;
end;
$$;

-- 4) Una compra confirmada en crm_cliente_pagos = un giro del nivel de su paquete.
-- Si procede de rendimiento_llamadas, reutilizamos la misma clave para no duplicarlo.
create or replace function public.tc_ruleta_desde_pago()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_json jsonb := to_jsonb(new);
  v_cliente uuid;
  v_key text;
  v_source_rendimiento text;
  v_minutes integer;
  v_amount numeric;
  v_level smallint;
begin
  if lower(coalesce(v_json->>'estado', '')) <> 'completed' then
    return new;
  end if;

  if nullif(v_json->>'cliente_id', '') is null then
    return new;
  end if;

  v_cliente := (v_json->>'cliente_id')::uuid;
  v_source_rendimiento := nullif(v_json->>'source_rendimiento_id', '');
  v_minutes := public.tc_ruleta_purchase_minutes(v_json, 'crm_cliente_pagos');
  v_amount := public.tc_json_number(v_json, 'importe', 'amount', 'amount_usd');
  v_level := public.tc_ruleta_level_for_minutes(v_minutes, v_amount);

  v_key := case
    when v_source_rendimiento is not null then 'rendimiento:' || v_source_rendimiento
    else 'crm_pago:' || (v_json->>'id')
  end;

  insert into public.cliente_ruleta_giros (cliente_id, payment_key, source, nivel, purchase_minutes)
  values (v_cliente, v_key, 'crm_cliente_pagos', v_level, v_minutes)
  on conflict (payment_key) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_tc_ruleta_crm_pago on public.crm_cliente_pagos;
create trigger trg_tc_ruleta_crm_pago
after insert or update of estado on public.crm_cliente_pagos
for each row execute function public.tc_ruleta_desde_pago();

-- 5) Las compras manuales también generan 1 giro, con el nivel correspondiente.
create or replace function public.tc_ruleta_desde_compra_manual()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_json jsonb := to_jsonb(new);
  v_cliente uuid;
  v_importe numeric;
  v_es_compra boolean;
  v_key text;
  v_minutes integer;
  v_level smallint;
begin
  if nullif(v_json->>'cliente_id', '') is null then
    return new;
  end if;

  v_es_compra := lower(coalesce(v_json->>'cliente_compra_minutos','false')) in ('true','t','1','yes');
  v_importe := coalesce(public.tc_json_number(v_json, 'importe', 'amount'), 0);

  if not v_es_compra or v_importe <= 0 then
    return new;
  end if;

  v_cliente := (v_json->>'cliente_id')::uuid;
  v_key := 'rendimiento:' || (v_json->>'id');
  v_minutes := public.tc_ruleta_purchase_minutes(v_json, 'rendimiento_llamadas');
  v_level := public.tc_ruleta_level_for_minutes(v_minutes, v_importe);

  insert into public.cliente_ruleta_giros (cliente_id, payment_key, source, nivel, purchase_minutes)
  values (v_cliente, v_key, 'rendimiento_llamadas', v_level, v_minutes)
  on conflict (payment_key) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_tc_ruleta_compra_manual on public.rendimiento_llamadas;
create trigger trg_tc_ruleta_compra_manual
after insert or update of cliente_compra_minutos, importe on public.rendimiento_llamadas
for each row execute function public.tc_ruleta_desde_compra_manual();

-- 6) Giro atómico del lado servidor.
-- NIVEL 1 (compras 10/20/30 min): 2, 3, 4, 5 min; premio especial 60 min = 5%.
-- NIVEL 2 (compras 40/50/60 min): 6, 8, 10, 12, 14, 16 min; premio especial 80 min = 5%.
-- El 95% restante se reparte por igual entre los premios normales de cada nivel.
drop function if exists public.cliente_girar_ruleta(uuid);

create function public.cliente_girar_ruleta(p_cliente_id uuid)
returns table (
  prize_minutes integer,
  spin_level integer,
  available_spins bigint,
  next_spin_level integer,
  level_1_spins bigint,
  level_2_spins bigint,
  total_minutes numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spin uuid;
  v_level smallint;
  v_random double precision;
  v_prize integer;
  v_total numeric;
begin
  select id, nivel
    into v_spin, v_level
  from public.cliente_ruleta_giros
  where cliente_id = p_cliente_id
    and estado = 'pending'
  order by created_at asc
  for update skip locked
  limit 1;

  if v_spin is null then
    return;
  end if;

  v_level := coalesce(v_level, 1);
  v_random := random();

  if v_level = 2 then
    v_prize := case
      when v_random < 0.1583333333333333 then 6
      when v_random < 0.3166666666666667 then 8
      when v_random < 0.475 then 10
      when v_random < 0.6333333333333333 then 12
      when v_random < 0.7916666666666667 then 14
      when v_random < 0.95 then 16
      else 80
    end;
  else
    v_prize := case
      when v_random < 0.2375 then 2
      when v_random < 0.475 then 3
      when v_random < 0.7125 then 4
      when v_random < 0.95 then 5
      else 60
    end;
  end if;

  update public.cliente_ruleta_giros
  set estado = 'used', premio_minutos = v_prize, used_at = now()
  where id = v_spin and estado = 'pending';

  if not found then
    return;
  end if;

  update public.crm_clientes
  set minutos_free_pendientes = coalesce(minutos_free_pendientes, 0) + v_prize,
      updated_at = now()
  where id = p_cliente_id;

  insert into public.cliente_puntos_historial (cliente_id, tipo, puntos, descripcion, created_at)
  values (
    p_cliente_id,
    'ruleta_compra',
    0,
    'Ruleta Celestial nivel ' || v_level || ': +' || v_prize || ' minutos free.',
    now()
  );

  insert into public.cliente_notificaciones (cliente_id, tipo, titulo, mensaje, leida, created_at)
  values (
    p_cliente_id,
    'ruleta_compra',
    'Premio de la Ruleta Celestial',
    'Has ganado ' || v_prize || ' minutos en la ruleta nivel ' || v_level || '. Ya están disponibles en tu cuenta.',
    false,
    now()
  );

  insert into public.crm_client_notes (cliente_id, texto, author_user_id, author_name, author_email, is_pinned)
  values (
    p_cliente_id,
    '🎡 Ruleta Celestial nivel ' || v_level || ': +' || v_prize || ' minutos free acreditados.',
    null,
    'Sistema',
    null,
    false
  );

  select coalesce(c.minutos_free_pendientes,0) + coalesce(c.minutos_normales_pendientes,0)
    into v_total
  from public.crm_clientes c
  where c.id = p_cliente_id;

  return query
  select
    v_prize,
    v_level::integer,
    (select count(*) from public.cliente_ruleta_giros g where g.cliente_id = p_cliente_id and g.estado = 'pending'),
    coalesce((select g.nivel::integer from public.cliente_ruleta_giros g where g.cliente_id = p_cliente_id and g.estado = 'pending' order by g.created_at asc limit 1), 1),
    (select count(*) from public.cliente_ruleta_giros g where g.cliente_id = p_cliente_id and g.estado = 'pending' and g.nivel = 1),
    (select count(*) from public.cliente_ruleta_giros g where g.cliente_id = p_cliente_id and g.estado = 'pending' and g.nivel = 2),
    coalesce(v_total,0);
end;
$$;

revoke all on function public.cliente_girar_ruleta(uuid) from public;
revoke all on function public.cliente_girar_ruleta(uuid) from anon;
revoke all on function public.cliente_girar_ruleta(uuid) from authenticated;
grant execute on function public.cliente_girar_ruleta(uuid) to service_role;

-- No se hace backfill de compras históricas.
-- Las compras confirmadas después de ejecutar este SQL generan exactamente un giro nuevo.
