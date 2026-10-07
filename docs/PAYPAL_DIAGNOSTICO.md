# Diagnóstico de autenticación PayPal · PP-AUTH-2

Actualización sobre el ZIP (12). Copia los archivos respetando sus rutas y despliega la nueva versión en Vercel. **No necesita SQL.**

En CRM → Realizar pago aparece **Comprobar conexión PayPal**. Púlsalo antes de crear otro enlace: solo solicita un token OAuth a PayPal; no crea órdenes, no cobra, no acredita beneficios ni abre WhatsApp. Está protegido con la misma autenticación de central/administración que el cobrador.

El resultado incluye `PP-AUTH-2` y el entorno realmente leído por el servidor (`LIVE` o `SANDBOX`). Si no aparece el botón, aún estás viendo una versión anterior del código.

- **Conexión de autenticación correcta:** PayPal aceptó las credenciales. Esto NO confirma todavía el webhook, la cuenta de correo receptora ni la entrega de beneficios.
- **invalid_client:** PayPal rechazó la pareja Client ID / Secret para el entorno indicado. El protocolo no permite saber cuál de los dos datos es incorrecto ni a qué correo pertenece. Ambos deben copiarse de la misma aplicación y entorno. No compartas esos valores por chat.
- **unauthorized_client / access_denied:** PayPal no autoriza la aplicación. Revisa sus permisos/estado con PayPal.
- **HTTP 429 / HTTP 5xx / NETWORK:** límite, fallo del servicio o problema de conexión. No se diagnostican automáticamente como claves incorrectas.
- **Variable ausente, duplicada, oculta o con espacios internos:** el código indica cuál revisar antes de contactar con PayPal.

El parche elimina espacios exteriores y comillas envolventes pegados al copiar. No altera caracteres internos, no prueba otras cuentas y no cambia Live por Sandbox. No imprime claves, tokens, cuerpos de respuesta ni descripciones del proveedor en mensajes o registros.

Las pruebas locales usan respuestas simuladas y la migración existente en PostgreSQL aislado. **No se ha verificado tu autenticación de producción**, porque sus credenciales solo están en Vercel. Tras instalar, comparte únicamente el mensaje de diagnóstico.

Los intentos de creación antiguos conservan su protección contra duplicados y su límite de reintento. Una conexión correcta no autoriza a eliminar/recrear intentos antiguos cuya situación de pago sea incierta.

Referencias: [autenticación de PayPal](https://developer.paypal.com/api/rest/authentication), [variables y nuevos despliegues de Vercel](https://vercel.com/docs/environment-variables/managing-environment-variables).
