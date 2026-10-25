# Compras, promociones y ruletas — 25/10/2026

Este documento sustituye la explicación histórica de `PAYPAL-LLAMADAS-SIN-DUPLICAR.md` para los cobros de Central. El flujo vigente se comprobó contra el código de producción `4fb20bcaf101144bf9da635ed5ad3ae18ce0451a` y las funciones instaladas en Supabase.

## Momento de acreditación

- **Panel cliente:** crear o aprobar el pedido no acredita beneficios. PayPal debe confirmar una captura `COMPLETED`, con importe, moneda e identificadores correctos. `reconcilePayPal` llama a `tc_complete_paypal_client`, que registra la compra y sus beneficios de forma atómica.
- **Central → Realizar pago:** `tc_complete_paypal_crm` confirma el cobro en modo `collection_only`. No suma minutos, Coins ni giros en ese momento.
- **Central → Registrar llamada → compra nueva:** `tc_register_call_minutes` o `tc_register_call_recovery` registra la compra económica y acredita los beneficios. La llamada que únicamente consume saldo no es una compra nueva.

## Política acordada

| Origen / clasificación | Coins | Giros |
| --- | --- | --- |
| Paquete web normal | Matriz real de rango y nivel | Base del nivel y extras configurados |
| Paquete web promocional | Ninguna | Ninguno |
| Compra nueva: Nada | Matriz real de rango y nivel | Base del nivel y extras configurados |
| Compra nueva: Captado / Recuperado | Igual que tarifa normal | Igual que tarifa normal |
| Compra nueva: Promo | Ninguna | Ninguno |
| Cobro con Importe manual | Ninguna, aunque coincida con una tarifa | Ninguno, también si después se marca Nada o Super Promo |
| Super Promo Ruleta | Ninguna | Exactamente un giro especial; sin giros normales ni extras de rango |

Una promoción activa no desactiva las recompensas de los paquetes normales. No se revocan recompensas históricas. Los minutos y los beneficios de Oráculo siguen sus contratos existentes.

La matriz de Supabase es la autoridad para las Coins y extras de rango. El importe de una compra regular determina su nivel mediante las bandas configuradas; nunca se sustituye por `importe × 10` ni por una promoción que casualmente tenga el mismo precio. Los paquetes normales de 80/120/180 minutos conservan sus 1/2/3 tiradas nativas de Oráculo, además de las que correspondan por la matriz. En un cobro vinculado se leen del pedido guardado; en una compra regular externa de precio exacto se resuelven desde el catálogo del servidor.

## Cobro PayPal de Central vinculado a la compra

En el paso del importe se elige explícitamente el cobro confirmado. La API lista únicamente cobros de la clienta, del entorno PayPal actual, en EUR, capturados, de tipo `crm_collection` y todavía sin compra registrada. No se selecciona automáticamente uno por coincidir en importe.

El POST transmite `paypal_collection_order_id` y `paypal_collection_source`. Supabase bloquea y comprueba el cobro seleccionado: cliente, importe, EUR, entorno, captura, tipo y uso previo. Un cobro con `pack_id = crm_manual_amount` conserva su exclusión de Coins y ruletas. La vinculación con `payment_id` se guarda en la misma transacción que la compra. No pueden reutilizarlo otras operaciones.

Un pago PayPal realizado fuera de Realizar pago requiere seleccionar expresamente el origen externo. Esta elección deriva en el servidor la confirmación de que se trata de otro cobro; no requiere un campo oculto adicional del navegador. Si existe un cobro compatible y falta la selección, la operación pide elegir el origen. Los reintentos pasan la misma validación e idempotencia; cambiar la clasificación de una operación anterior no concede nuevos premios.

## Instantáneas y respuesta

Los pedidos nuevos guardan `reward_policy_version`, `pricing_mode`, `purchase_classification` y `rewards_eligible` junto con su paquete y sus minutos. Estos campos se crean en el servidor. El motor de Supabase verifica además el origen persistido y no concede beneficios basándose solamente en indicadores enviados por el navegador.

Las promociones guardan Coins y giros a cero, incluso si una configuración antigua los anuncia. Los cobros manuales guardan el identificador `crm_manual_amount` explícito. Super Promo se acredita en la transacción de compra; no hay un segundo alta de giro desde la API después de guardar.

Los mensajes de confirmación consultan los eventos y giros que se guardaron realmente, utilizando `payment_id` / `purchase_id`. No anuncian premios por la clasificación solicitada ni por una estimación de la tarifa.

## Validación

Pruebas locales de API y proveedor simulado cubren precios e identidades manipulados, promo versus tarifa regular, importe manual igual a un paquete, selección y origen explícitos, entorno controlado por servidor, exclusión de cobros no capturados/ajenos/consumidos y reintentos. Las pruebas SQL de la migración cubren el motor de beneficios y la vinculación atómica. No se ejecutan cargos reales para probar estos cambios.

La compilación o estas pruebas no sustituyen la revisión del recorrido real en el navegador después del despliegue.
