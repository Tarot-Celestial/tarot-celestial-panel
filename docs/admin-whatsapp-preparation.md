# WhatsApp en Admin: preparación de campañas

## Funciona en esta entrega

La navegación de Admin agrupa sus destinos existentes por secciones. Comunicación incluye WhatsApp, con dos espacios de preparación por administrador. Cada espacio guarda un nombre, teléfono remitente previsto, mensaje, imagen y lista de hasta 300 destinatarios. `{{nombre}}` se sustituye en la vista previa por el nombre revisado de la clienta.

Los teléfonos necesitan prefijo internacional. Se rechazan duplicados entre las dos listas. La consulta CRM sólo devuelve el nombre cuando hay una coincidencia exacta y única; nunca deduce consentimiento. Los contactos importados empiezan pendientes de confirmar permiso. El estado «No contactar» se guarda en el borrador, todavía no constituye una lista global de bajas.

Las imágenes admiten JPG, PNG y WebP de hasta 3 MB, comprobados por contenido. Las imágenes promocionales subidas son públicas mediante URL; los borradores y teléfonos son privados por administrador. No subir información personal a las imágenes. Los cambios se guardan expresamente y existe protección al salir con cambios pendientes.

## Todavía no activo

Esta entrega no conecta números, genera QR, envía mensajes, programa lotes ni afirma entrega o lectura. Tampoco modifica la sesión compartida de WhatsApp de Central. No hay nuevas colas, cron ni llamadas a proveedores de mensajería.

Antes de activar campañas hacen falta:

1. Conectar ambos números con WhatsApp Business Platform, comprobando en el proceso oficial si sus cuentas pueden conservar la aplicación mediante coexistencia. No asumir que el QR actual de Central sirve para ello.
2. Configurar y aprobar las plantillas promocionales con imagen y variable de nombre, y revisar las tarifas y destinos admitidos.
3. Implantar una lista global de bajas con recepción de solicitudes de no contacto, compartida por los dos remitentes. Un segundo número no debe usarse para eludir un bloqueo o una baja.
4. Cola persistente con aprobación de campaña, cancelación, reintentos idempotentes, límites efectivos del proveedor y pausa ante errores o deterioro de calidad. No reenviar automáticamente por el segundo número.
5. Webhooks verificados para los estados enviado, entregado, leído cuando exista confirmación y fallido. Aceptado por la API no equivale a entregado.
6. Prueba de extremo a extremo con un destinatario autorizado antes de cualquier campaña real.

## Criterios oficiales consultados el 26 de octubre de 2026

La [política de WhatsApp Business](https://whatsappbusiness.com/policy/) exige permiso y respetar bajas; iniciar conversaciones mediante la plataforma requiere plantillas aprobadas. No publica una cadencia que garantice evitar restricciones. «10 mensajes cada 10 minutos» puede ser una preferencia operativa, nunca una garantía de seguridad.

La [ayuda de marketing en WhatsApp Business](https://faq.whatsapp.com/652901706468344) describe funciones de difusión disponibles según cuenta y país. Su disponibilidad debe comprobarse en cada cuenta.

El [aviso oficial de Twilio sobre destinos de Estados Unidos](https://www.twilio.com/en-us/changelog/whatsapp-marketing-messages-to-u-s--numbers-no-longer-supported) documenta la pausa de plantillas de marketing a números estadounidenses desde abril de 2025. Comprobar las condiciones vigentes del proveedor y el destino concreto antes de activar; no tratar todos los números +1 como el mismo país.

## Validación y límites

42 comprobaciones automatizadas cubren navegación existente, salida con cambios, autorización, aislamiento por administrador, versiones concurrentes, reintentos, importación, permisos de almacenamiento y validación de imágenes. La integración SQL usa PGlite con la migración completa; no reproduce dos conexiones PostgreSQL simultáneas. La maqueta visual usa datos simulados y no prueba autenticación real.

La migración añade dos tablas privadas, cinco funciones de servidor y un bucket de imágenes. No cambia CRM, saldos, giros, compras ni colas de Central. Para desactivar conservando borradores se pueden revocar los permisos EXECUTE de las nuevas funciones a service_role y retirar el acceso de navegación.
