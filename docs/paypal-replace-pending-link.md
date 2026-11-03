# Sustitución de enlaces pendientes de cobro CRM

Al generar un nuevo cobro, el servidor comprueba los enlaces pendientes de esa clienta en ambas cuentas PayPal y desactiva los que pueden sustituirse. La operación conserva el historial y enlaza el registro anterior con el nuevo. Las compras independientes del panel cliente quedan fuera de este flujo.

## Comportamiento

- «Crear otro enlace · Cambiar tarifa» vuelve al formulario sin cancelar nada todavía. La sustitución ocurre al generar el nuevo cobro.
- Cada referencia anterior se consulta con su cuenta y entorno originales, sin solicitar una captura.
- Un cobro completado, una captura iniciada o un resultado incierto bloquean la sustitución. Una referencia de tarjeta desaparecida en PayPal (404) o una consulta limitada (429) permiten desactivar únicamente el enlace local si no hay captura iniciada; el motivo queda registrado.
- El permiso sigue siendo creador o administrador. Una central no puede sustituir enlaces de otra central; administración puede hacerlo.
- La base de datos vuelve a comprobar las referencias bajo bloqueo, desactiva las pendientes y crea el nuevo intento en una transacción. Si la inserción falla, se conserva el enlace anterior.
- La creación remota de PayPal ocurre después de esa transacción. Si falla, el nuevo intento queda disponible para reintento con el mismo identificador; no se reactiva el enlace anterior.
- Una recarga o repetición del mismo identificador no cancela el nuevo enlace ni crea otro pedido PayPal. Un cambio concurrente exige volver a comprobarlo.
- Los enlaces sustituidos no pueden iniciar una captura a través del panel. Un pago realmente recibido con posterioridad sigue conciliándose, sin perder la verdad del dinero recibido.

## Alcance de la cancelación

Se desactiva el enlace de pago de la aplicación. No se emite un reembolso ni se afirma haber anulado un movimiento de dinero en PayPal. La API Orders v2 no ofrece una operación de cancelación para estos pedidos con intención CAPTURE; las anulaciones de autorizaciones corresponden a otro flujo.

Referencia: https://developer.paypal.com/docs/api/orders/v2/

## Despliegue y comprobaciones

Aplicar `20261103151228_paypal_crm_replace_pending_link.sql` antes de publicar la ruta nueva. La migración solo instala una función restringida a `service_role`: no modifica cobros históricos ni saldos al desplegar.

La validación incluye SQL real en PGlite, estados concurrentes de captura, reversión de la sustitución ante error de inserción, aislamiento de compras de clientes, permisos, reintentos, cuenta receptora, callback antiguo y formulario React. Las llamadas al proveedor se simulan: no se crean cobros, no se envían mensajes ni se consumen beneficios reales.
