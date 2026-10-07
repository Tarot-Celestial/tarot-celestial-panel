# Motivos de rechazo y cancelación — base ZIP 18

## Instalación

Sustituir los archivos del ZIP conservando sus rutas y redesplegar en Vercel. No requiere SQL ni variables nuevas. Se mantiene la tabla y la función de acreditación existentes.

## Comportamiento

- El cobrador y la página de la clienta muestran el motivo comunicado por PayPal. Se traducen los códigos documentados de saldo insuficiente (5120), CVV (5110), tarjeta caducada (5400) y rechazo genérico del emisor (5100), además de determinados errores de la API. Los códigos desconocidos se muestran sin atribuirles una causa inventada. No se publican descripciones arbitrarias del proveedor ni datos de tarjeta.
- Si PayPal no comunica el motivo, se indica expresamente. No es posible garantizar que todos los bancos faciliten una explicación. Al pulsar Comprobar también se puede recuperar el detalle de un rechazo anterior si PayPal aún lo devuelve.
- Junto a Comprobar aparecen **Cancelar enlace** y **Cambiar tarifa** mientras está pendiente. Cambiar tarifa cancela primero el enlace y vuelve a los paquetes. El siguiente cobro usa una referencia nueva.
- Una vez rechazado o cancelado, **Elegir tarifa · Nuevo cobro** permite volver a seleccionar el importe. El historial anterior permanece guardado.
- Cancelar no captura ni devuelve dinero. Antes se consulta PayPal: un pago recibido, pendiente de captura bancaria o con una solicitud de captura en curso no se puede cancelar. El panel indica que hay que comprobarlo.
- La cancelación bloquea el cobro desde nuestras rutas, la conciliación y el webhook, incluso si la clienta conservaba el formulario abierto. La actualización de estado compite de forma atómica con la reserva de captura para evitar que una callback antigua vuelva a cobrar el enlace.
- La orden original permanece en PayPal: no se afirma que se haya eliminado allí ni se emite un reembolso. Un enlace antiguo alojado directamente en PayPal podría seguir mostrando su pantalla, pero este servidor ya no lo captura. Un pago realmente completado por otra vía se concilia para no ocultar dinero recibido.
- Solamente quien creó el cobro o un administrador puede cancelarlo. La referencia pública de la clienta no permite cancelar desde el CRM.

## Verificación

45 pruebas locales aprobadas y TypeScript sin errores. Incluyen carrera entre captura y cancelación, callbacks antiguas, captura pendiente/completada, conservación del motivo, control de acceso y transacción de acreditación única. La prueba SQL usa PGlite con las funciones históricas de compra simuladas; no se modifica la base de datos de producción.

Revisión de los componentes y CSS reales en navegador de escritorio y móvil con API/PayPal/WhatsApp simulados: cancelar, volver a paquetes, nuevo identificador, motivo visible en ambas pantallas y enlace cancelado sin formulario. No se han realizado cobros, cancelaciones reales ni despliegues en tu cuenta durante estas pruebas.

Referencias: https://developer.paypal.com/sandbox-testing/card-testing y https://developer.paypal.com/api/payments/v2/definitions/processor_response/
