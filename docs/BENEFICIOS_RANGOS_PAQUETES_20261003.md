# Beneficios de rangos y paquetes · 2026-10-03

## Lo encontrado antes de modificar

- Rango efectivo: `tc_client_rank_state(uuid)`, con catálogo `tc_client_rank_benefits` y `client_rank_overrides`.
- Rangos usados por el proyecto: Bronce, Plata, Oro y Diamante.
- Los packs estándar estaban agrupados visualmente en tres grupos mediante `rouletteLevel`; no existía una fuente separada para **nivel de paquete**.
- Los niveles de paquete y de ruleta quedaban conceptualmente mezclados en el frontend. Esta ampliación crea una asignación administrable independiente.
- Los packs estándar ya pueden prometer beneficios propios (Coins, Oráculo y ruleta). Las promociones también tienen sus propios beneficios. La matriz nueva es **adicional** y nunca sustituye esas promesas.
- `Mi ritual` ya tenía una comprobación de servidor: sin `ritual_access`, la API no consulta ni devuelve rituales. El enlace de navegación también se oculta.
- El cliente ya disponía de un endpoint de bono de rango; se reutiliza y se convierte en un bono Diamante real, transaccional y diario.
- Las compras independientes de Oráculo usan sus propios RPC de créditos/preguntas y no representan un paquete de minutos de nivel 1/2/3. No se les aplica la matriz.

## Regla de rango en una compra

La matriz se resuelve cuando el pago ya está `completed`. Por tanto se utiliza el **rango efectivo resultante después de incluir esa compra** en el motor real de 30 días. Si esa compra provoca un ascenso, se aplica el nuevo rango.

Si el cliente no tiene rango efectivo, se registra el intento como `no_effective_rank` y no se entrega beneficio de matriz.

Si el pago no puede vincularse a un paquete con nivel administrado, se registra como `unmapped_package` y no se entrega la matriz. No se deduce el nivel por precio.

## Compatibilidad con beneficios existentes

La migración de entrega preserva los beneficios nativos del pack/promoción. La configuración global antigua de Coins/ruleta por rango se migra a las tres filas de nivel cuando todavía están vírgenes y después se desactiva el grant global para evitar duplicación.

Cada pago tiene una `delivery_key` única en `tc_client_benefit_events`. Un callback repetido no puede volver a acreditar la matriz.

## Bono diario Diamante

- Solo rango efectivo Diamante.
- Configuración única administrable.
- Día natural `Europe/Madrid`.
- Una restricción única `cliente + día` evita doble clic, pestañas simultáneas y reactivaciones el mismo día.
- El registro y la entrega de Coins, minutos FREE, Oráculo y giros se realizan dentro de una única transacción PostgreSQL.

## Devoluciones / cancelaciones

La integración marca la entrega afectada con `refund_review.automatic_reversal=false` si un pago deja de estar `completed`.

No se revocan automáticamente Coins, créditos de Oráculo ni giros ya entregados porque el proyecto actual no aporta una regla segura para recompensas ya consumidas. Hace falta definir esa política antes de automatizar la reversión. No considerar ese flujo cerrado hasta validarlo contra Supabase real.

## Orden de aplicación

1. Ejecutar `migrations/20261003_00_inspect_live_rank_benefits.sql` y guardar el resultado.
2. Comprobar especialmente firmas de RPC, constraints de `tc_client_benefit_events`, triggers de pagos y tipos.
3. Ejecutar `20261003_01_rank_package_matrix.sql`.
4. Ejecutar `20261003_02_diamond_daily_bonus.sql`.
5. Ejecutar `20261003_03_purchase_matrix_delivery.sql` solo si la inspección confirma las firmas requeridas. La propia migración vuelve a comprobarlas y aborta si no coinciden.
6. Desplegar el ZIP de aplicación.
7. Validar compras reales/controladas en Supabase antes de dar el flujo por cerrado.


## Verificación contra Supabase real (2026-10-03)

Confirmado en producción: `tc_client_rank_state`, `tc_apply_purchase_benefits`, `crm_register_call_atomic_v8`, `cliente_confirmar_compra_ruleta_v2`, `cliente_confirmar_compra_ruleta_v3`, `cliente_confirmar_compra_promocion_v1`, `grant_cliente_oracle_credits`, `get_cliente_oracle_balance`, `consume_cliente_oracle_credit` y `tc_touch_roulette_signal`.

No existen en producción `tc_confirm_rank_purchase` ni `tc_rank_phase_one_state`; por ello esta entrega no depende de ellas. La matriz se integra dentro de `tc_apply_purchase_benefits`, reutilizando el trigger nativo `tc_purchase_benefits`.

El bono diario usa únicamente recompensas verificadas: Coins, créditos de Oráculo y giros de ruleta. No se añadió un saldo paralelo ni minutos inventados.

Regla de rango: se resuelve el rango efectivo después de que el pago ya está `completed`, por lo que si esa compra provoca un ascenso, la matriz usa el nuevo rango efectivo.

Pagos sin nivel administrado: no reciben la matriz. Conservan los beneficios nativos/históricos existentes.

Reembolsos: la entrega queda marcada `refund_review` y no se revierte automáticamente porque las recompensas pueden haberse consumido.

Limitación pendiente: un rollback total de la transacción elimina también el snapshot; para conservar configuración a través de un fallo total sería necesario persistir el snapshot en el intento de pago antes de confirmar, adaptando cada proveedor real.
