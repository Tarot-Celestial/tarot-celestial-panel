# Cuenta PayPal del panel de clientes

La cuenta de cobro del panel de clientes se activa de forma independiente de Central. Vincular un banco a PayPal no confirma que exista una nueva cuenta Business, una app REST live o permiso para procesar tarjetas. Hasta comprobar esos requisitos, mantener la selección actual.

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

No activar `client_business_v1` hasta verificar la identidad de la cuenta Business nueva, su app REST y la habilitación de Expanded/Advanced Credit and Debit Card Payments. Una segunda app de la misma cuenta PayPal no cambia por sí sola el destinatario del cobro. El client ID público y el token de los campos de tarjeta deben proceder del perfil de la orden.

## Webhook

Registrar en la app nueva una URL HTTPS del despliegue correspondiente con ruta `/api/webhooks/paypal-cliente` y estos seis eventos, que son los admitidos por el flujo existente:

- `CHECKOUT.ORDER.APPROVED`
- `CHECKOUT.PAYMENT-APPROVAL.REVERSED`
- `PAYMENT.CAPTURE.COMPLETED`
- `PAYMENT.CAPTURE.PENDING`
- `PAYMENT.CAPTURE.DECLINED`
- `PAYMENT.CAPTURE.DENIED`

Guardar el ID obtenido en `PAYPAL_CUSTOMER_WEBHOOK_ID`. Mantener la suscripción y las credenciales de Central: PayPal distribuye eventos por app, y cada webhook debe verificarse con su configuración correspondiente.

## Pedidos anteriores y verificación

Cada pedido conserva el perfil con el que fue creado para consultas, capturas, conciliación y devoluciones. Cambiar la selección para compras nuevas no mueve pedidos existentes. No reemplazar las credenciales, Merchant ID o entorno de un perfil por los de otra cuenta; un cambio posterior de cuenta requiere otro perfil identificable y conservar el anterior mientras existan operaciones asociadas.

Comprobar primero con datos simulados y sandbox: selección de cuenta, token y client ID coherentes, carga tardía del SDK, cancelación, 3DS, capturas simuladas, confirmación de beneficios y webhooks. En live, obtener un token OAuth y consultar la configuración de webhooks no genera un cobro, pero tampoco acredita el recorrido completo de pago. La elegibilidad de `CardFields` debe comprobarse con la cuenta nueva. No crear ni capturar pagos reales como prueba de esta preparación.

Referencias oficiales: [SDK y cuenta receptora](https://developer.paypal.com/sdk/js/configuration/), [habilitación de tarjetas](https://developer.paypal.com/studio/checkout/advanced/integrate), [OAuth](https://developer.paypal.com/api/rest/authentication/) y [webhooks por app](https://developer.paypal.com/api/webhooks/overview/).
