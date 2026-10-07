# Minutos guardados y consumo de llamadas — ZIP (20)

## Comprobación real, solo lectura

Se consultó Supabase de Tarot Celestial. En el momento de la revisión, Ángela tenía **42 free + 30 normales = 72 minutos**. La nota de la compra mostraba saldo anterior 0/0, incremento 42/30 y saldo resultante 42/30. No se modificó ese saldo ni se registró ninguna llamada de prueba en producción.

El historial también confirma consumos reales: una llamada descontó 20 free y dejó 0; otra descontó 8 free y 6 normales. No hay evidencia suficiente para atribuir los 15 minutos adicionales de la captura a una causa concreta. El saldo consultado y la nota de esa compra no contienen esos 15. Se elimina el riesgo de caché y de respuestas de ficha que llegan fuera de orden, sin inventar una reparación histórica.

## Reglas

- **Compra nueva:** «guarda» son los minutos que SOBRAN de esa compra. Se suman al saldo anterior. Los utilizados en esa misma compra ya quedan fuera de los guardados; restarlos otra vez sería descontarlos dos veces.
- **Saldo pendiente / pago ya confirmado:** se restan los minutos realmente utilizados. FREE consume free; los otros códigos válidos consumen normales. 7free consume exactamente 7 free.
- Si una compra contiene 72 minutos y todavía no ha habido llamada, indicar 72 restantes y 0 utilizados. Antes la interfaz exigía un uso positivo y podía incentivar introducir 1 ficticio. Ahora acepta 0 en compras que guardan saldo.
- Si una compra contiene 72 y ya se utilizó 1, declarar 71 restantes y 1 utilizado. Escribir 72 restantes y 1 utilizado declara una compra de 73.
- Los minutos anteriores nunca se eliminan al registrar una nueva compra. Los premios de ruleta, canjes o ajustes legítimos se mantienen.

## Cambios

1. `tc_register_call_minutes` calcula los deltas desde los códigos y minutos, bajo bloqueo transaccional del cliente. No confía en deltas enviados por el navegador.
2. Registra un recibo por `operation_id` para **todas** las llamadas, también las que solo gastan minutos. Reintentar la misma operación devuelve el mismo resultado sin volver a descontar. Reutilizar la operación con datos distintos produce conflicto.
3. La API devuelve el saldo real resultante. La ficha se recarga sin caché y descarta respuestas antiguas que podrían sobrescribir una actualización más reciente.
4. El resumen del formulario muestra saldo anterior, uso, minutos restantes de la nueva compra y saldo previsto. La ficha muestra además el total disponible.
5. Se mantienen los pagos existentes y su vínculo con la llamada; no se vuelve a generar una compra al gastar saldo.

## Instalación

1. Ejecutar **solo** `20261007233546_call_minute_accounting.sql` en el SQL Editor de Supabase. Requiere la migración de vinculación de pagos entregada con el ZIP (19), comprobada instalada en la revisión. Puede repetirse. No cambia saldos históricos.
2. Copiar los archivos del ZIP sobre el proyecto conservando rutas y desplegar en Vercel.
3. No ejecutar `tests/fixtures/crm-v8-verification.sql` en producción: es la copia de la función existente usada exclusivamente en las pruebas locales; no es una migración.
4. Para comprobar el despliegue, registrar una llamada real y comparar saldo anterior, minutos utilizados y saldo nuevo. No introducir llamadas ficticias en la ficha de Ángela.

## Validación

- 71 pruebas locales correctas y TypeScript sin errores.
- Pruebas SQL en PGlite con **la definición real de v8 obtenida de Supabase**, las dos migraciones de vinculación/consumo y esquemas mínimos compatibles. El subsistema independiente de premios se simula; no se han hecho cobros reales.
- Casos: 72−20=52; consumo free/normal mixto; 7free; reintentos; saldo insuficiente; datos negativos o inválidos; guardar 72 con uso 0; conservar saldo previo; llamada de un PayPal ya confirmado sin duplicar pago.
- Prueba de navegador del formulario real en escritorio y móvil, con APIs y datos simulados.
- La migración nueva no se ha aplicado a producción y el frontend no se ha desplegado desde esta sesión. Las consultas realizadas en producción fueron de lectura.

La idempotencia evita repetir una misma operación. Si se abre un formulario nuevo, se genera otra operación: dos llamadas distintas con la misma duración pueden ser legítimas y no se fusionan por nombre o importe.
