# Compras del panel cliente con PayPal

El catálogo de minutos abre el formulario de tarjeta existente de PayPal. Los
importes de los nueve paquetes se cobran en EUR, manteniendo sus valores. Las
compras independientes de Oráculo y promociones conservan su circuito manual.

## Confirmación y saldos

`POST /api/cliente/pagos/paypal` verifica la sesión y exige una única ficha CRM
vinculada por `auth_user_id`. El servidor elige precio, paquete y reparto;
el navegador sólo aporta `packId` y una clave UUID persistente `attemptId`.

| Paquete | Normales | FREE |
| --- | ---: | ---: |
| 10 min | 10 | 0 |
| 20 min | 20 | 0 |
| 30 min | 20 | 10 |
| 40 min | 30 | 10 |
| 50 min | 30 | 20 |
| 60 min | 40 | 20 |
| 80 min | 50 | 30 |
| 120 min | 80 | 40 |
| 180 min | 120 | 60 |

Los extras de rango se añaden mediante el motor existente de beneficios; el
reparto anterior no sustituye esos extras. Se mantiene el consumo de FREE antes
que normales. No se recalculan compras ni saldos históricos.

Sólo una captura PayPal `COMPLETED`, con orden, referencia, importe y moneda
verificados por el servidor, llama a `tc_complete_paypal_client`. Esta función
ejecuta el motor `cliente_confirmar_compra_ruleta_v3`, recoge los beneficios
realmente concedidos y guarda compra, saldos, nota CRM y notificación en una
transacción. La nota contiene desglose, extras, referencia y saldos antes/después.

El webhook firmado y el retorno del navegador convergen en la misma función.
Los bloqueos y referencias únicas evitan acreditar dos veces. Si se recibió el
dinero pero falla el guardado, se reintenta la confirmación sin otro cobro.
Pendientes y rechazos no acreditan. Sólo se muestran motivos que el proveedor
comunica, sin inventar explicaciones ni almacenar datos de tarjeta.

## Operación

- La migración `20261013182658_paypal_client_purchase_checkout.sql` se aplica
  antes de publicar el código. Añade `checkout_kind`, actor y una compra
  pendiente máxima por cliente/entorno.
- `cliente_payment_settings.paypal_client_enabled` habilita nuevas compras
  PayPal. Desactivarlo no bloquea la reconciliación de pagos ya creados y no
  cambia el interruptor de Mollie `web_payments_enabled`.
- Los cobros de central siguen con `checkout_kind=crm_collection`: cobro y nota,
  sin alta automática de compra. Sus controles no seleccionan compras web.
- El dominio cliente `https://clientestarotcelestial.es` y el origen configurado
  de PayPal están permitidos para compras web. Los enlaces mantienen el origen
  validado del cliente; el flujo de centrales mantiene su origen configurado.
- Cancelar desactiva un intento aún no cobrado. No es un reembolso. Una captura
  en proceso impide cancelar; una captura real tardía se reconcilia igualmente.
- Un formulario caducado conserva la opción de cancelar para liberar la compra
  pendiente. Una creación interrumpida fuera de la ventana de idempotencia de
  PayPal requiere revisión de la central antes de generar otra orden.

## Validación

Pruebas de rutas/proveedor simuladas, PostgreSQL embebido con la definición
actual de RPC v3 y pruebas de navegador con SDK simulado. El subsistema de
beneficios usa un doble de contrato en la prueba SQL nueva; producción reutiliza
el motor existente y consulta sus eventos reales. No se realizan cargos reales
durante estas pruebas. La aceptación bancaria/3DS de una tarjeta concreta se
comprueba durante una compra real del titular.
