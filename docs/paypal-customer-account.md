# Cuenta PayPal del panel de clientes

La cuenta de cobro del panel de clientes se activa de forma independiente de Central. El 27 de octubre de 2026 se comprobó en la interfaz Live de PayPal una cuenta Business y su app REST con Advanced Credit and Debit Card Payments marcada. La app todavía no tiene webhook configurado. Esta comprobación de configuración no acredita un cobro completo con la cuenta nueva.

La preparación queda pendiente de activación. Las 92 pruebas locales y la comprobación de TypeScript pasaron. La preview de Vercel está bloqueada por el proveedor; el usuario ha pospuesto resolver esa incidencia. No se ha activado el perfil nuevo ni se han guardado sus credenciales.

## Configuración

Configurar los siguientes valores en el gestor de secretos del entorno de ejecución, sin copiarlos al chat, al repositorio ni a registros:

| Variable | Contenido |
| --- | --- |
| `PAYPAL_CUSTOMER_CLIENT_ID` | Client ID de la app REST de la cuenta destinada al panel de clientes. |
| `PAYPAL_CUSTOMER_CLIENT_SECRET` | Secret de esa misma app; solo servidor. |
| `PAYPAL_CUSTOMER_WEBHOOK_ID` | ID de la suscripción webhook registrada en esa app y entorno. |
| `PAYPAL_CUSTOMER_MERCHANT_ID` | Merchant ID de la cuenta receptora, para validar el destinatario. |
| `PAYPAL_CUSTOMER_ENVIRONMENT` | `sandbox` para pruebas o `live` para producción; debe coincidir con todas las credenciales. |

`PAYPAL_CUSTOMER_CHECKOUT_ACCOUNT=client_business_v1` selecciona el perfil nuevo para compras nuevas del cliente. Ausente o con valor `legacy`, conserva el perfil anterior. Los valores `PAYPAL_*` de Central se mantienen sin cambios.

Mantener `client_business_v1` sin activar hasta completar la configuración del webhook y la validación del despliegue. Una segunda app de la misma cuenta PayPal no cambia por sí sola el destinatario del cobro. El client ID público y el token de los campos de tarjeta deben proceder del perfil de la orden.

## Webhook

Registrar en la app nueva una URL HTTPS del despliegue correspondiente con ruta `/api/webhooks/paypal-cliente` y estas cinco suscripciones requeridas, disponibles en el formulario Live revisado:

- `CHECKOUT.ORDER.APPROVED`
- `PAYMENT.CAPTURE.COMPLETED`
- `PAYMENT.CAPTURE.PENDING`
- `PAYMENT.CAPTURE.DECLINED`
- `PAYMENT.CAPTURE.DENIED`

El handler también admite `CHECKOUT.PAYMENT-APPROVAL.REVERSED`, pero el formulario actual no lo ofrece. Es una sexta suscripción opcional si PayPal la muestra; su ausencia en el selector no impide configurar las cinco anteriores. No seleccionar `All Events` para suplirla.

Guardar el ID obtenido en `PAYPAL_CUSTOMER_WEBHOOK_ID`. Mantener la suscripción y las credenciales de Central: PayPal distribuye eventos por app, y cada webhook debe verificarse con su configuración correspondiente.

## Pedidos anteriores y verificación

Cada pedido conserva el perfil con el que fue creado para consultas, capturas y conciliación. Cambiar la selección para compras nuevas no mueve pedidos existentes. No reemplazar las credenciales, Merchant ID o entorno de un perfil por los de otra cuenta; un cambio posterior de cuenta requiere otro perfil identificable y conservar el anterior mientras existan operaciones asociadas.

Comprobar primero con datos simulados y sandbox: selección de cuenta, token y client ID coherentes, carga tardía del SDK, cancelación, 3DS, capturas simuladas, confirmación de beneficios y webhooks. En live, obtener un token OAuth y consultar la configuración de webhooks no genera un cobro, pero tampoco acredita el recorrido completo de pago. La elegibilidad de `CardFields` debe comprobarse con la cuenta nueva. No crear ni capturar pagos reales como prueba de esta preparación.

Referencias oficiales: [SDK y cuenta receptora](https://developer.paypal.com/sdk/js/configuration/), [habilitación de tarjetas](https://developer.paypal.com/studio/checkout/advanced/integrate), [OAuth](https://developer.paypal.com/api/rest/authentication/) y [webhooks por app](https://developer.paypal.com/api/webhooks/overview/).

