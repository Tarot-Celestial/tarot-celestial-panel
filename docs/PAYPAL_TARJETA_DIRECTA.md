# Pago directo con tarjeta — ZIP 16

## Instalación

1. Copia los archivos del ZIP sobre el proyecto, conservando las rutas `src/`, `tests/` y `docs/`.
2. Despliega de nuevo en Vercel. No hay SQL ni variables nuevas: usa las cinco variables PayPal ya configuradas.
3. En la aplicación **Live T Celestial** de PayPal, comprueba que está habilitada y aprobada la función de pagos avanzados con tarjeta (Expanded/Advanced Credit and Debit Card Payments). Autenticar correctamente con Client ID/Secret no comprueba esa habilitación.
4. Genera un **nuevo cobro** desde el CRM. Su enlace debe empezar por el dominio de `PAYPAL_PUBLIC_BASE_URL` seguido de `/pago-tarjeta?ref=…`.
5. Abre ese enlace en móvil. Si PayPal permite Card Fields, aparecerán titular, número, caducidad y CVV. No hay botón de acceso a una cuenta PayPal. La dirección de facturación se puede desplegar; el banco puede necesitarla para aceptar una tarjeta.

Los enlaces antiguos mantienen su flujo original. No cambies manualmente su URL: no convierten órdenes existentes en órdenes de tarjeta. Si hay un cobro previo pendiente, comprueba su estado antes de solicitar otro. No se crean automáticamente órdenes de sustitución para evitar duplicar cobros. Las órdenes de PayPal tienen duración limitada; esta página rechaza órdenes de más de tres horas y pide revisión a la central.

## Qué cambia

- El CRM genera una orden de tarjeta con `SCA_WHEN_REQUIRED` y envía por WhatsApp el enlace propio del panel. El operador sigue pulsando Enviar manualmente.
- Los campos sensibles son iframes de PayPal. Número, CVV y fecha no pasan por nuestras API ni se guardan en Supabase. La dirección opcional se envía a través del SDK a PayPal.
- El servidor determina el importe, el paquete y los beneficios. La clienta no puede sustituirlos desde su navegador.
- La referencia pública aleatoria permite consultar exclusivamente ese pago. No se devuelve el teléfono, datos del CRM, notas, claves secretas ni credenciales del servidor.
- El botón captura la misma orden; la confirmación, la conciliación de la central y el webhook utilizan la comprobación del servidor. Una aprobación no acredita beneficios: se exige captura completada y la operación SQL existente mantiene la acreditación única.
- Las verificaciones bancarias rechazadas, pendientes o desconocidas impiden solicitar la captura. Los resultados de 3DS se consultan en PayPal, no se confía en los valores del navegador.
- Si PayPal no ofrece Card Fields, se muestra un mensaje para contactar con la central. No hay redirección automática a un inicio de sesión de PayPal.

## Validación realizada y pendiente

Realizado: TypeScript sin errores; 37 pruebas locales de autenticación, rutas, comprobación de órdenes, 3DS y transacciones. La prueba SQL ejecuta la migración existente en PGlite y simula las funciones históricas de compra v2/v3 que el repositorio no incluye. Navegador: componente y CSS reales, SDK y respuestas PayPal simulados; escritorio 1440 y móvil 320/390/768 px, validación de formulario, doble clic, éxito, recarga de compra pagada, cuenta no elegible y enlace inválido.

Pendiente: elegibilidad de la cuenta Live, renderizado de los iframes reales de PayPal, aceptación de tarjetas, desafío 3DS y recepción del webhook en el despliegue real. No se ha realizado ningún cobro ni despliegue desde este entorno. Antes de usarlo con clientas, verifica el circuito completo en Sandbox con credenciales/webhook Sandbox separados del entorno Live. Después comprueba un pago autorizado y que la compra se acredita una sola vez.

No garantiza aceptación de todas las tarjetas ni que el banco nunca pida dirección o una verificación adicional. No se necesita una cuenta PayPal para el formulario de tarjeta.

## Documentación oficial

- https://developer.paypal.com/platforms/checkout/advanced/integrate
- https://developer.paypal.com/platforms/checkout/advanced/customize/3d-secure/sdk
- https://developer.paypal.com/platforms/checkout/advanced/customize/3d-secure/response-parameters

Se usa el SDK v5 CardFields, que PayPal mantiene soportado. No se añaden dependencias de npm.
