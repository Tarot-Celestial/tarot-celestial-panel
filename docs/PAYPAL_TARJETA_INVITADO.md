# Pago con tarjeta como invitada

Actualización sobre el ZIP (15). Solo cambia la preferencia de entrada de las NUEVAS órdenes: `payment_source.paypal.experience_context.landing_page = GUEST_CHECKOUT`.

Copia los archivos conservando sus rutas y despliega. No requiere SQL ni cambiar credenciales.

En tu cuenta PayPal Business comprueba: Configuración de la cuenta → Pagos en sitios web → Preferencias del sitio web → Cuenta PayPal opcional, activada. Los nombres pueden variar con el idioma. El correo debe estar confirmado.

La preferencia solicita la pantalla de tarjeta sin iniciar sesión. No garantiza que PayPal la ofrezca a cada compradora ni convierte el enlace en un checkout exclusivamente de tarjeta. PayPal decide la disponibilidad según cuenta, país, historial y controles de riesgo. También puede solicitar correo, datos de facturación y verificación bancaria.

Los enlaces y los intentos guardados ANTES de esta actualización conservan su configuración. No se recrean pagos pendientes, no se cambia su cuerpo durante un reintento y no se altera la protección contra duplicados. Para comprobar el cambio utiliza una nueva operación legítima; no borres una pendiente ni vuelvas a cobrar la misma compra. Ver el mismo enlace antiguo no prueba la nueva preferencia.

Si PayPal sigue exigiendo cuenta, el siguiente paso para un formulario exclusivamente de tarjeta es una integración de campos de tarjeta alojados por PayPal (Advanced/Expanded Checkout), previa comprobación de elegibilidad de la cuenta. No está incluida en este parche.

Validación local: pruebas del endpoint con PayPal simulado, incluida la preferencia enviada, validación de importes, autenticación y reutilización de la misma orden. No se ha probado la pantalla real de PayPal con esta cuenta.

Documentación oficial:
- https://developer.paypal.com/api/orders/v2/definitions/order_capture_request/
- https://www.paypal.com/c2/cshelp/article/how-do-i-accept-cards-with-checkout-using-the-guest-checkout-option--help307?locale.x=en_C2
