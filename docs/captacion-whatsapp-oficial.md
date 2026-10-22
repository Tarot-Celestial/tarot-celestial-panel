# WhatsApp oficial para Captación

El bloque de Captación permite enviar una bienvenida aprobada con el nombre del contacto y la imagen de beneficios. La API obtiene el destinatario del CRM y comprueba la sesión, la marca y la asignación del contacto. El navegador no puede proporcionar otro teléfono, texto o imagen para el envío oficial.

## Configuración de producción

Guardar estas variables únicamente en el servidor de Vercel, en el entorno Production. No usar el prefijo `NEXT_PUBLIC_`, incluir sus valores en documentación ni guardarlos en el repositorio.

| Variable | Contenido |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | Identificador de la cuenta Twilio que posee el remitente y la plantilla. |
| `TWILIO_AUTH_TOKEN` | Credencial de esa cuenta; también verifica la firma de los callbacks. |
| `TWILIO_WHATSAPP_FROM` | Remitente registrado con formato `whatsapp:+<número internacional>`. El remitente Sandbox se rechaza. |
| `TWILIO_WHATSAPP_CAPTACION_CONTENT_SID` | Identificador `HX…` de la plantilla de bienvenida. |
| `CAPTACION_WHATSAPP_ENABLED` | Mantener ausente o `false` durante la configuración. Solo `true` habilita el envío. |

La aplicación también necesita su conexión de servidor existente con Supabase. `VERCEL_ENV` lo proporciona Vercel: el envío exige `production`; una preview no puede enviar aunque tenga la bandera activada.

Aplicar la migración `supabase/migrations/20261022195347_captacion_whatsapp_delivery_ledger.sql` antes de habilitar la función. Crea el registro de solicitudes y estados, con acceso exclusivo del servidor y protección frente a solicitudes duplicadas. No envía mensajes ni cambia el estado de gestión de los contactos.

## Plantilla e imagen

Crear un contenido `twilio/media` en Twilio y solicitar su aprobación para WhatsApp como categoría **MARKETING**.

- El cuerpo debe coincidir con `CAPTACION_WHATSAPP_BODY`, en `src/lib/server/captacion-whatsapp.ts`. Se genera mediante `buildCaptacionMessage` de `src/lib/captacion-whatsapp.ts`; esta es la fuente del texto, para evitar mantener otra copia en este documento.
- La única variable es `{{1}}`, para el nombre del contacto. El servidor envía su valor desde el CRM.
- Debe incluir exactamente una imagen: `https://clientestarotcelestial.es/images/captacion/tarot-celestial-beneficios-v1.png`.
- El estado de aprobación debe ser `approved`. La API compara cuenta, contenido, categoría e imagen antes de cada envío. Una plantilla distinta o pendiente no habilita el botón.

Publicar primero la imagen y comprobar que su URL devuelve el PNG. Si se cambia el texto o la imagen del producto, actualizar también la plantilla y obtener su aprobación antes de volver a habilitar el envío oficial.

## Permiso de contacto en el formulario de Meta

Antes de habilitar envíos de captación, verificar en el formulario de Meta que la persona haya autorizado recibir este tipo de comunicación por WhatsApp de Tarot Celestial. Esa condición debe aparecer en la captura del contacto, junto a la información y el consentimiento del formulario, y su evidencia debe poder consultarse en el proceso operativo existente.

La llegada de un formulario y la aprobación de una plantilla son datos distintos de ese consentimiento. Esta implementación no añade una columna que lo dé por supuesto ni certifica automáticamente su existencia. Si el formulario no permite verificarlo, mantener desactivado el envío oficial hasta resolver ese requisito.

## Callback de entrega

La ruta pública de producción es:

`https://clientestarotcelestial.es/api/webhooks/captacion-whatsapp`

El servidor la incluye como `StatusCallback` en cada solicitud, con sus parámetros `delivery_id` y `token`; no es necesario inventarlos ni pegarlos manualmente. La ruta valida `X-Twilio-Signature`, la cuenta, el identificador del mensaje y su correspondencia con el destinatario registrado. Mantener el dominio y la ruta canónicos sin redirecciones que alteren la URL firmada.

Los estados aceptado, enviado, entregado y leído se registran de forma separada. Los callbacks antiguos no pueden hacer retroceder una entrega ya confirmada.

## Comprobación antes de activar

1. Mantener `CAPTACION_WHATSAPP_ENABLED=false` y completar la configuración, la migración, el remitente y la aprobación de la plantilla.
2. Entrar como central o administrador y seleccionar un contacto autorizado en Captación. «Comprobar estado» usa `GET /api/captacion/whatsapp?brand=celestial&lead_id=<id>` con la sesión del panel; no envía mensajes.
3. Revisar el nombre, el teléfono del CRM, el texto de la plantilla y la imagen. Mientras la bandera esté desactivada, `ready` seguirá siendo `false`, aunque la configuración y la aprobación ya sean correctas.
4. Ejecutar las pruebas del composer, de la API oficial y del registro SQL. Son fixtures y no contactan a clientes reales.
5. Tras verificar también el permiso de contacto, activar la bandera en Production y publicar la configuración. La activación no envía nada por sí sola: cada envío requiere pulsar «Enviar WhatsApp».

El POST admite solamente `{ lead_id, request_id }`. El servidor reserva un único envío por contacto y solicitud de Meta, incluso si dos centrales pulsan a la vez. Ante un resultado desconocido, hay que consultar el estado; no se reenvía automáticamente. Un resultado fallido necesita revisión, no un nuevo identificador para saltarse la protección.

## Preparación manual y gestión

El apartado manual conserva mensaje editable, copiar texto, copiar PNG, descargar la imagen y abrir WhatsApp con texto preparado. Las ediciones de ese apartado no cambian la plantilla oficial ni el teléfono del CRM. Al abrir WhatsApp manualmente, la imagen debe pegarse o adjuntarse dentro del chat.

Un envío aceptado está pendiente de confirmación de entrega. Enviar, copiar o abrir WhatsApp no marca automáticamente al contacto como gestionado: la central registra el resultado mediante las acciones de Captación.
