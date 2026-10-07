# Cobrador PayPal · instalación sobre el ZIP (8)

El botón «Realizar pago» de la ficha CRM abre el mismo diseño de cobrador, ahora con PayPal. Seleccionar un paquete solo lo selecciona. El botón «Crear pago PayPal y abrir WhatsApp» crea la orden y abre la conversación con el texto preparado. La central pulsa **Enviar** en WhatsApp.

## Instalación

1. Copia los archivos del ZIP en la raíz del proyecto, respetando sus carpetas. No borres los archivos de Mollie: los enlaces antiguos conservan sus rutas de procesamiento.
2. Ejecuta una vez en el SQL Editor de Supabase:
   `supabase/migrations/20261006235223_paypal_crm_checkout.sql`.
   Este SQL sí es necesario: añade el registro privado de órdenes PayPal y la confirmación transaccional contra las funciones de compra que ya usa el panel. No modifica los precios ni crea otro motor de beneficios.
3. Configura estas variables **en el servidor**, nunca con prefijo `NEXT_PUBLIC_`:

   | Variable | Valor |
   | --- | --- |
   | `PAYPAL_ENVIRONMENT` | `sandbox` para pruebas; `live` para cobros reales |
   | `PAYPAL_CLIENT_ID` | Client ID de la aplicación REST de PayPal del entorno elegido |
   | `PAYPAL_CLIENT_SECRET` | Secret de esa misma aplicación |
   | `PAYPAL_WEBHOOK_ID` | ID del webhook de esa aplicación y entorno |
   | `PAYPAL_PUBLIC_BASE_URL` | Dominio HTTPS público donde se aloja este panel, sin rutas |

   Se reutilizan `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`, ya existentes. El nuevo cobrador elige la API a partir de `PAYPAL_ENVIRONMENT`; no usa la variable antigua `PAYPAL_BASE_URL`.
4. En la aplicación REST de PayPal, crea un webhook con URL:
   `https://TU-DOMINIO/api/webhooks/paypal-crm`.
   Suscribe `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING` y `PAYMENT.CAPTURE.DECLINED`. Guarda su ID en la variable anterior. El servidor también reconoce `PAYMENT.CAPTURE.DENIED` de integraciones antiguas.
5. Despliega/reinicia la aplicación para cargar las variables.

## Comprobación antes de activar cobros reales

Usa primero un despliegue de pruebas con **su propia base de datos**, las funciones de compra existentes y cuentas Sandbox de vendedor y comprador distintas. Sandbox no cobra dinero, pero una compra confirmada sí aplica beneficios en la base conectada: no lo conectes a clientas reales para probar.

- Abre una clienta de prueba, selecciona un paquete y genera el enlace. Comprueba importe, teléfono y texto de WhatsApp. Abrirlo no envía ningún mensaje.
- Paga con la cuenta compradora de Sandbox. Comprueba una sola compra en CRM y los minutos/Coins/giros correspondientes a la configuración real de esa base.
- Repite «Comprobar» y recarga la confirmación: no debe registrar otra compra.
- Prueba importe manual: no añade minutos de un paquete; usa el comportamiento existente de cobro manual.
- Comprueba la recepción del webhook y el caso en que la compradora cierra PayPal sin regresar al panel.
- Para producción configura credenciales, webhook y `PAYPAL_ENVIRONMENT=live` conjuntamente. No mezcles aplicaciones ni entornos.

## Estados y recuperación

- **Esperando pago:** crear o abrir el enlace no acredita nada. Aprobar la orden inicia la captura, pero una captura pendiente tampoco acredita beneficios.
- **Pago realizado correctamente:** PayPal confirmó la captura completa y la compra se registró en una misma transacción con el estado del cobro.
- **Pago recibido · procesamiento pendiente:** el dinero llegó, pero falló la entrega en la base. Pulsa «Comprobar» para reintentarla con la misma referencia; no pidas otro pago.
- **Pago no completado:** PayPal confirma un rechazo o una orden anulada. Puede prepararse un nuevo cobro.
- Salir con «Cancelar» de la página PayPal no prueba que la orden haya quedado anulada definitivamente. La página de regreso lo explica y consulta el estado real; nunca marca un cobro pagado como cancelado por un parámetro de URL.
- Si se interrumpe la creación, se conserva la misma operación. Pasadas cinco horas sin referencia remota guardada, el sistema exige revisión para no recrearla después de que caduque la protección de idempotencia de PayPal. Administración debe revisar la referencia `TC-<id>` en PayPal antes de resolver ese registro.
- Si el navegador bloquea la ventana nueva o la ficha no tiene teléfono válido, conserva el enlace y permite copiarlo o volver a abrir WhatsApp manualmente.

Las órdenes quedan en `crm_paypal_orders`, accesible solo por el servidor. Una central consulta sus propios cobros; administración puede consultarlos todos. La ficha recupera el último cobro visible. No se ha añadido una bandeja general de órdenes ni gestión automática de reembolsos o disputas.

## Verificación de esta entrega

Pruebas locales de servidor, migración PostgreSQL aislada y modal en Chrome a tamaños de escritorio y móvil. WhatsApp y PayPal se simularon: **no se realizaron cobros ni envíos reales**.

Las definiciones originales de `cliente_confirmar_compra_ruleta_v2/v3` no vienen en el ZIP de origen. La prueba SQL ejecuta esta migración usando sustitutos de ese contrato; la entrega real de beneficios con las funciones instaladas se debe comprobar en Sandbox. La migración comprueba que ambas funciones existan antes de instalarse.

Pruebas incluidas: `node --test tests/paypal-crm*.cjs`. En entornos que bloquean procesos hijos: `node --test --test-isolation=none tests/paypal-crm*.cjs`.

Referencias: [órdenes PayPal](https://developer.paypal.com/api/rest/integration/orders-api/), [verificación de webhooks](https://developer.paypal.com/api/rest/webhooks/rest/), [eventos de captura](https://developer.paypal.com/api/rest/webhooks/event-names/).
