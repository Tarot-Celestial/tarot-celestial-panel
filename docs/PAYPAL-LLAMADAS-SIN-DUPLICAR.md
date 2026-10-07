# Pago confirmado → registrar llamada

## Causa encontrada en el código

PayPal registra la compra con referencia `paypal-crm:<orden>`. Después, el formulario de llamadas permitía marcar «Sí, compra minutos» y PAYPAL, creando otra compra con referencia `registrar_llamada:<operación>`. La protección contra reintentos de cada flujo no relacionaba esas dos operaciones. Esto puede duplicar el registro interno y los beneficios; registrar manualmente la llamada no ejecuta por sí mismo un segundo cargo a la tarjeta.

La captura del Diario no demuestra qué movimientos históricos están duplicados. Importes iguales a distintas horas pueden ser compras reales diferentes.

## Instalación

1. Ejecutar en Supabase el SQL `20261007173256_paypal_link_existing_call.sql` completo. Es transaccional y se puede repetir. Requiere las tablas actuales, `crm_paypal_orders` y la función instalada `crm_register_call_atomic_v8(jsonb)`. No elimina pagos ni reemplaza v8.
2. Copiar los archivos del ZIP sobre el proyecto conservando rutas y desplegar en Vercel. Incluye solo archivos nuevos/modificados respecto al ZIP (19).
3. No hacen falta nuevas credenciales PayPal ni variables de entorno.
4. Comprobar primero con una clienta de prueba y un pago de prueba ya confirmado, preferiblemente en un entorno de pruebas. El SQL de auditoría se ejecuta aparte y no cambia datos.

## Flujo de la central

- Confirmar el pago del enlace. La compra y sus beneficios ya están registrados.
- Abrir «Registrar llamada». En «Pago PayPal ya confirmado», elegir la operación concreta por importe, fecha, paquete y referencia.
- Anotar los minutos realmente usados y la tarotista. El saldo restante queda disponible.
- Guardar. Se vincula el pago existente con la llamada, sin crear otra compra ni repetir Coins/giros. El Diario conserva una sola fila económica y muestra la tarotista.
- Para otra llamada con los minutos restantes, usar «Usar saldo pendiente · sin nueva compra». Cada pago solo se vincula a su primera llamada; las siguientes usan el saldo.
- «Registrar una compra nueva» se mantiene para cobros distintos. Si un pago manual PayPal coincide con un enlace confirmado sin llamada, se bloquea hasta seleccionar el pago existente o confirmar expresamente que es OTRO cobro real.

Los importes manuales del cobrador siguen sin incluir minutos de paquete automáticamente. Un pago manual sin minutos disponibles no permite inventar saldo: debe resolverse la asignación en el procedimiento administrativo existente.

La llamada vinculada se registra operativamente con importe 0 para no volver a generar una venta. El importe económico permanece en `crm_cliente_pagos`. Los informes que consulten exclusivamente el importe de `rendimiento_llamadas` no deben sumar este pago de nuevo; el Diario ya utiliza la tabla económica.

## Garantías y límites

- Operación atómica: llamada, consumo de saldo y vínculo se guardan juntos o se revierten.
- Reintentos de la misma operación devuelven la llamada previa. Otra operación no puede reutilizar ese pago.
- Solo admin/central activos pueden usar la API. El cliente y el estado confirmado se verifican en la base de datos. La tabla de vínculos y su función no se exponen a anon/authenticated.
- No se ejecutan eliminaciones ni reparaciones históricas automáticas. `docs/sql/auditar-pagos-paypal.sql` muestra movimientos y candidatos para contrastar con PayPal antes de corregir saldos/beneficios o borrar nada.
- No se ha accedido a la base de datos de producción ni realizado cobros reales.
- La definición original de v8 no viene en el ZIP recibido. Las pruebas SQL ejecutan la migración real contra una implementación de prueba de su contrato. El adaptador comprueba que v8 devuelve una llamada sin crear pago; si incumple ese contrato, revierte todo y muestra error. La compatibilidad definitiva debe comprobarse contra v8 instalada en un entorno de pruebas.

## Validación local

TypeScript sin errores; pruebas de PayPal existentes, pruebas SQL con PGlite y pruebas de la API de llamadas. Comprobación visual del formulario real en escritorio y móvil con APIs/datos simulados. PGlite ejecuta solicitudes concurrentes desde el cliente pero no sustituye una prueba de concurrencia en PostgreSQL de producción.
