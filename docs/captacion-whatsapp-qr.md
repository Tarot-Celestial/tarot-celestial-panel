# WhatsApp por QR para Captación

Captación envía la imagen de beneficios y el mensaje de bienvenida personalizado mediante la sesión de WhatsApp vinculada desde la pestaña WhatsApp de Centrales. El gateway local ejecuta un único envío de imagen con texto. La página no controla WhatsApp Web mediante clics ni ofrece un envío de texto e imagen a través de `wa.me`.

## Configuración

Las variables de conexión son exclusivamente de servidor; nunca deben llevar el prefijo `NEXT_PUBLIC_` ni aparecer con valores en el repositorio.

| Variable | Uso |
| --- | --- |
| `WHATSAPP_GATEWAY_MODE` | `bridge` para que el PC consulte las órdenes mediante conexiones salientes. |
| `WHATSAPP_GATEWAY_SECRET` | Secreto fuerte compartido por el servidor y el proceso local. |
| `WHATSAPP_SESSION_MODE` | `shared` para la cuenta del equipo; `per-worker` para cuentas individuales. No cambiarlo durante un envío. |
| `CAPTACION_WHATSAPP_QR_ENABLED` | Ausente o `false` durante preparación. `true` habilita envíos solo cuando `VERCEL_ENV=production`. |
| `CAPTACION_WHATSAPP_ENABLED` | Mantener `false`: la alternativa oficial anterior no interviene en este flujo. |

El PC necesita mantenerse encendido, con el proceso local activo y conectado a Internet. La sesión se vincula escaneando el QR mostrado en WhatsApp de Centrales. No es necesario exponer un puerto público del PC. Las credenciales de la sesión permanecen en el almacenamiento privado del gateway; no se incorporan a los assets ni a la respuesta del panel.

Aplicar primero las migraciones del ledger original, `20261022201312_captacion_whatsapp_qr_provider.sql` y la del puente local. La migración QR es aditiva: conserva recibos antiguos y la restricción de una entrega por contacto y solicitud de Meta, incluso entre proveedores.

## Destinatario, contenido y autorización

`POST /api/captacion/whatsapp?brand=celestial` acepta únicamente `{ lead_id, request_id }`. El servidor valida la sesión con Supabase, el rol central/admin activo, la asignación y la marca. Obtiene teléfono y nombre del CRM y vuelve a comprobar el registro bajo bloqueo antes de reservar el envío. Un teléfono local sin país reconocido no se completa adivinando el prefijo.

El texto procede de `buildCaptacionMessage` en `src/lib/captacion-whatsapp.ts`. La imagen es `/images/captacion/tarot-celestial-beneficios-v1.png`. El gateway usa la misma versión de contenido; el navegador no puede cambiar el teléfono, el texto automático ni la imagen. El editor de preparación manual es una alternativa independiente.

Antes de habilitar la captación, verificar que el formulario de Meta y el proceso operativo conservan la autorización de la persona para recibir esta comunicación por WhatsApp. La llegada de un formulario no se convierte automáticamente en una evidencia adicional de consentimiento en la base de datos.

## Estado y protección frente a duplicados

`GET /api/captacion/whatsapp?brand=celestial&lead_id=<id>` consulta la sesión y el recibo existente, sin enviar. Devuelve `provider: "qr"`, `configured`, `ready`, `reason`, `session`, `preview_message`, `media_url` y `delivery`.

El estado `accepted` confirma la aceptación por WhatsApp, no la entrega al teléfono. `delivered` y `read` requieren eventos de confirmación. `sending` o `unknown` impiden reenviar automáticamente. Un fallo también conserva la reserva para revisión: cambiar el UUID no evita la protección.

El gateway guarda la operación antes de llamar a WhatsApp y conserva el resultado ante reinicios o cierres de sesión. Repetir una operación con otro remitente, destinatario o contenido se rechaza. El servidor consulta el recibo en la sesión original y verifica su remitente e identificador antes de guardarlo. Un envío confirmado nunca retrocede a pendiente por una respuesta tardía.

La preparación, el envío y la entrega no marcan al contacto como gestionado. La central registra el resultado mediante las acciones habituales de Captación.

## Comprobación sin contactar a clientes

1. Mantener la bandera QR desactivada mientras se aplican migraciones y se inicia el gateway.
2. Vincular la cuenta mediante QR desde Centrales y comprobar la sesión con GET.
3. Revisar el contacto, el teléfono internacional del CRM y la vista previa. No pulsar enviar como prueba sobre contactos reales.
4. Ejecutar las pruebas fixture de API, ledger, gateway, puente y compositor. Estas pruebas no envían mensajes reales.
5. Habilitar la bandera en Production cuando conexión, contenido y condiciones de contacto estén verificados. La habilitación por sí sola no envía mensajes: cada envío requiere una acción de la central.

Si el PC está apagado o desconectado, el panel muestra que la conexión no está disponible. La alternativa manual permite copiar texto, copiar o descargar la imagen y abrir el chat; la imagen se pega o adjunta dentro de WhatsApp.
