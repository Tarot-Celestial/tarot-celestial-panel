# Sala del Oráculo · noviembre de 2026

La página `/cliente/oraculo` reúne selección de tema, tirada, interpretación y preguntas en una sala violeta, negra y dorada. Conserva el sistema de compras y los saldos anteriores.

- 78 cartas: 22 arcanos mayores y 56 menores, con textos editoriales propios.
- Seis temas: general, amor, dinero, familia, energía y decisiones. Trece modalidades, de una a diez cartas; se conservan los identificadores antiguos.
- Una tirada premium reserva una unidad del saldo existente al empezar. Una sesión pendiente se recupera al volver. La carta gratuita mantiene su recarga de 24 horas.
- Historial de las últimas 30 lecturas, copia descargable, pregunta incluida y acceso a los packs existentes. Preguntas adicionales y precios siguen usando el checkout actual.
- Las preguntas y respuestas se guardan junto con el consumo en una transacción. Repetir la misma pregunta en la misma tirada recupera la respuesta guardada. Se serializa la reserva por cliente para evitar dos reservas simultáneas desde el nuevo endpoint.
- Las imágenes de las cartas tienen un sustituto con nombre y significado si la fuente externa falla. Se respetan movimiento reducido y tamaños móviles.

## Límites explícitos

La guía es una ilustración original estática, identificada como «Guía virtual», acompañada de transiciones de interfaz. No es una videollamada ni un avatar con labios o manos animados. La narración requiere una voz española local instalada en el dispositivo; no llama a una API de voz. Las respuestas del Oráculo son interpretaciones editoriales basadas en la tirada, no un modelo conversacional entrenado ni una medición de vibraciones. Los complementos de tarot no se incorporan como servicios embebidos.

No se modifican precios, cobros, historiales ni saldos por esta migración. No se realizan compras, tiradas o preguntas de prueba con clientes reales. Para volver a la interfaz anterior basta revertir los archivos de aplicación; las dos funciones nuevas pueden permanecer sin uso.

## Arte

- Archivo publicado: `public/images/oracle/guide.webp` (1536 × 1024, aproximadamente 124 KB).
- Generación: herramienta integrada ImageGen, edición guiada por la maqueta aprobada. Conversión posterior PNG a WebP mediante FFmpeg.
- Instrucción creativa: conservar la mujer ficticia de la maqueta como fotografía editorial, sin interfaz, letras ni cartas; mesa de terciopelo vacía en el 40 % inferior, iluminación dorada suave y estudio violeta con motivo lunar. Figura adulta original, rostro sereno, mirada cercana, aspecto elegante y natural.
- Referencias y atribución de los naipes históricos: `public/images/oracle/CREDITS.txt`.

## Comprobaciones

`node --test --test-isolation=none tests/oracle-room.test.cjs tests/oracle-room-db.test.cjs tests/paypal-oracle.test.cjs`

Pruebas de catálogo, posiciones sin cartas repetidas, reanudación antigua, aislamiento por cliente, actualizaciones concurrentes, y regresión de compras/webhooks PayPal. PostgreSQL embebido comprueba inclusión y compra de preguntas, recuperación de respuestas, rollback al fallar el guardado, permisos y reanudación sin otra reserva. No simula concurrencia real de varias conexiones PostgreSQL.

`node tests/oracle-room-browser.cjs` requiere el servidor local en el puerto 3020. Utiliza cuentas y transacciones ficticias interceptadas: escritorio, móvil de 390 y 320 píxeles, reanudación tras recarga, selección, historial, pregunta incluida y errores recuperables. La voz se prueba como control de interfaz con una voz simulada; no acredita el audio de cada dispositivo.

La comprobación TypeScript abarca `src` sin los archivos locales archivados bajo `outputs`. La compilación de Vercel comprueba el árbol publicado. Un despliegue listo no sustituye la comprobación autenticada en producción.
