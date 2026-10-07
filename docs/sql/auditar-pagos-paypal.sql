-- SOLO LECTURA. No borra pagos, no cambia saldos ni devuelve dinero.
-- Ejecutar en el SQL Editor de Supabase con una cuenta administradora.
-- Una coincidencia por nombre, importe o fecha NO demuestra duplicación.
-- Resultado 1: movimientos de las clientas mencionadas (ampliar nombres/fechas si hace falta).
select p.id as pago_id, p.cliente_id,
  concat_ws(' ',c.nombre,c.apellido) as clienta,
  p.created_at, p.importe, p.moneda, p.metodo, p.estado,
  p.referencia_externa, p.source_rendimiento_id,
  to_jsonb(p)->>'paypal_order_id' as paypal_order_id,
  to_jsonb(p)->>'paypal_capture_id' as paypal_capture_id,
  o.order_id as orden_confirmada, o.capture_id as captura_confirmada,
  o.status as estado_orden
from public.crm_cliente_pagos p
join public.crm_clientes c on c.id=p.cliente_id
left join public.crm_paypal_orders o on o.payment_id=p.id
where p.created_at >= '2026-10-01T00:00:00Z'::timestamptz
  and p.created_at < '2026-10-09T00:00:00Z'::timestamptz
  and (concat_ws(' ',c.nombre,c.apellido) ilike any(array[
    '%Ivy%','%Anavitate%','%Anavitate%','%Angela%','%Ángela%','%Yuriani%','%Yutriani%','%Yurian%'
  ]))
order by p.cliente_id,p.created_at;

-- Resultado 2: candidato enlace confirmado + registro manual del mismo importe
-- y cliente en 24 horas. Revisar cada candidato contra el historial de PayPal.
-- NO usar esta consulta como criterio automático de eliminación.
select concat_ws(' ',c.nombre,c.apellido) as clienta, manual.cliente_id,
  link.id as pago_enlace_id, manual.id as pago_manual_id,
  link.importe, link.created_at as fecha_enlace, manual.created_at as fecha_manual,
  o.order_id, o.capture_id,
  manual.referencia_externa as referencia_manual,
  manual.source_rendimiento_id as llamada_manual,
  link.source_rendimiento_id as llamada_enlace
from public.crm_cliente_pagos manual
join public.crm_cliente_pagos link on link.cliente_id=manual.cliente_id
  and link.importe=manual.importe and link.id<>manual.id
join public.crm_paypal_orders o on o.payment_id=link.id and o.status='completed'
join public.crm_clientes c on c.id=manual.cliente_id
where manual.metodo='paypal_manual' and manual.estado='completed' and link.estado='completed'
  and manual.created_at between link.created_at - interval '24 hours' and link.created_at + interval '24 hours'
  and manual.created_at >= '2026-10-01T00:00:00Z'::timestamptz
  and manual.created_at < '2026-10-09T00:00:00Z'::timestamptz
order by manual.cliente_id,manual.created_at;

-- Resultado 3: referencias/capturas repetidas entre pagos completados.
-- Requiere revisar los registros completos incluso cuando exista coincidencia.
with references_to_check as (
 select id, 'referencia_externa' as tipo, nullif(referencia_externa,'') as referencia
 from public.crm_cliente_pagos where estado='completed'
 union all
 select id, 'paypal_capture_id', nullif(to_jsonb(p)->>'paypal_capture_id','')
 from public.crm_cliente_pagos p where estado='completed'
)
select tipo,referencia,count(*) as registros,array_agg(id) as pago_ids
from references_to_check where referencia is not null
group by tipo,referencia having count(*)>1 order by registros desc;
