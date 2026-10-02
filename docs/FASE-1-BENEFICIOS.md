# Fase 1 — beneficios por rango

## Estado de la entrega

Código implementado y probado localmente. **Pendiente de validación e integración final con el esquema real de Supabase; no es una certificación de estabilidad en producción.** No se ha conectado ni modificado ninguna base de datos real.

El ZIP original no contiene migraciones, definiciones de funciones SQL, variables de entorno ni acceso a Supabase. Las funciones originales de compra no pueden verificarse leyendo únicamente las llamadas TypeScript. La consulta `migrations/20261002_00_inspect_existing.sql` permite obtener sus definiciones sin modificar datos.

**Bloqueo concreto:** se necesitan esas definiciones y las de sus triggers para confirmar el adaptador transaccional. Las compras independientes de tiradas/preguntas de Oráculo mantienen su flujo original y aún no reciben las nuevas Coins por rango; sus RPC también están incluidas en la consulta de inspección. No se han sustituido por una implementación inventada. Por tanto, el requisito de aplicar el beneficio a absolutamente todas las compras queda pendiente de esa integración.

## Implementación encontrada

- Aplicación Next.js 14, React 18, TypeScript y Supabase.
- Bronce, Plata, Oro y **Diamante ya existían** en cálculos, asignaciones manuales, colores y Panel Cliente. No se ha creado otro Diamante.
- El rango efectivo utiliza pagos y llamadas de los últimos 30 días, más intervenciones de `client_rank_overrides`.
- Existía código de beneficios que referencia `tc_client_rank_benefits` y otras RPC, pero su componente de administración no estaba conectado al menú. Ese módulo mezcla funciones de fases posteriores.
- Las compras de minutos y promociones ya llaman funciones SQL transaccionales. La ruta antigua de compras Stripe hacía escrituras separadas de pago, saldo e historial.
- «Mi ritual» se mostraba en el menú a todos, restringía el contenido a Diamante y mostraba un candado a los demás.
- Las comprobaciones compartidas de Admin y Cliente decodificaban JWT sin validar su firma; ahora consultan `auth.getUser(token)`. Los administradores desactivados no pueden guardar.

## Cambios incluidos

- Entrada **Beneficios de rangos y paquetes**, inmediatamente bajo WELLDONE.
- Módulo exclusivo de Fase 1: selector de rangos reales, Coins por compra y acceso a Mi ritual. Sin editor de paquetes ni activación de nuevos bonos, ruletas o permisos futuros.
- Guardado con estados de carga, confirmación real, errores y control de edición concurrente mediante `revision`. Los errores conservan lo escrito.
- Reutilización de `tc_client_rank_benefits`, sus claves `rank_key` y su campo `purchase_coins`. Se añade `ritual_access`; no se crea otro catálogo de rangos ni otro saldo de Coins.
- Los dos beneficios se mantienen tipados para poder validar cantidades y permisos en SQL. La relación por rango admite ampliar beneficios posteriormente sin rehacer clientes, compras o asignaciones; no se añaden columnas vacías para prestaciones todavía inexistentes.
- Un resolutor SQL compartido suministra los beneficios al Panel Cliente, ritual y adaptador de compras.
- «Mi ritual» no renderiza su enlace sin permiso; la página no presenta candados y la API no consulta ni devuelve rituales sin autorización. Tampoco acepta un cliente ajeno por parámetros.
- Actualización del menú cada 20 segundos mientras la pestaña está visible, al recuperar foco y al cambiar la sesión. Las comprobaciones del servidor consultan el permiso en cada petición.
- Las cantidades mostradas en minutos y promociones provienen de la configuración; no se modifican las definiciones de los paquetes.
- Adaptador preparado para compras de minutos, promociones, cobros manuales CRM/Mollie, registro de compras en llamadas y confirmaciones PayPal. Conserva las RPC originales de minutos/ruleta y sustituye únicamente su entrada de Coins.
- La ruta antigua de Stripe se lleva a la misma operación transaccional.
- Bloqueo por cliente, clave de operación e idempotencia persistente. `tc_rank_purchase_receipts` guarda la respuesta original para reintentos; **no es un segundo monedero**. El saldo sigue en `crm_clientes.puntos` y el historial original sigue activo.
- Validación de la variación real de saldo: una entrega antigua incompatible provoca rollback, no doble acreditación silenciosa.
- RLS y revocación de acceso directo de `anon`/`authenticated` a configuración, recibos, operaciones administrativas y rituales. Lecturas de cliente mediante API autenticada y limitadas a su ficha.

## Decisiones de funcionamiento

1. El beneficio se determina por el **rango efectivo antes de confirmar la nueva compra**, incluidas intervenciones temporales vigentes.
2. Si no hay rango, la compra no recibe Coins de rango. La compra puede contribuir al siguiente ascenso.
3. Las Coins configuradas sustituyen la anterior entrada de Coins de esas compras, no se suman como una segunda acreditación. Otros beneficios del paquete se conservan.
4. Los reintentos mantienen las Coins de la primera confirmación, aunque Admin haya cambiado el importe después.
5. Los pagos históricos ya procesados no se vuelven a premiar.
6. Los nuevos registros de configuración empiezan con 0 Coins, sin valores de ejemplo. Hay que configurar los beneficios deseados antes de abrir el sistema. Se conserva el acceso previo de Diamante al introducir por primera vez `ritual_access`.
7. Los flags existentes `is_active` y `coins_enabled` se respetan al resolver beneficios. Guardar Coins activa `coins_enabled`; no reactiva rangos desactivados.

## Archivos principales

- `src/app/admin/page.tsx`
- `src/components/admin/RankBenefitsPhaseOne.tsx` — reutiliza estilos y emblemas existentes.
- `src/app/api/admin/rank-benefits/phase-one/route.ts`
- `src/lib/rank-benefit-config.ts`
- `src/lib/server/rank-benefits.ts`
- `src/hooks/useClientPanelRank.ts`, `src/components/cliente/ClienteLayout.tsx`
- `src/app/api/cliente/me/route.ts`, API/página de ritual y presentación de promociones.
- Servicios de compras, rutas CRM y confirmación PayPal.
- `migrations/20261002_01_rank_benefits.sql`
- `migrations/20261002_02_rank_purchase_integration.sql`
- `tests/rank-benefits.test.cjs`, `tests/rank-benefits.integration.cjs`

## Validación local y límites

Se incluyen pruebas de PostgreSQL embebido (PGlite), React y endpoints. Los clientes de prueba existen únicamente dentro de la base aislada y efímera de las pruebas; las migraciones no crean clientes, compras ni beneficios de demostración.

- A: Diamante recibe 500 Coins configuradas.
- B: cambiar a 750 modifica la siguiente entrega sin cambiar código.
- C/D/E: permiso activado/desactivado en Diamante y otros rangos; renderizado real del menú condicionado por permiso.
- F: error de guardado, conservación del formulario, ausencia de éxito falso y rechazo de revisión obsoleta.
- G: callback repetido y cinco solicitudes encoladas para la misma operación acreditan una sola vez.
- Rollback de saldo, pago y recibo cuando falla una compra.
- Clientes sin rango, intervención manual y caducidad.
- Contratos de compras manuales, promociones, llamadas y PayPal.
- Rechazo de referencia asociada a otro cliente, permisos SQL, API Admin y acceso directo al ritual.
- Reejecución de migraciones sin borrar beneficios ni recibos.

**Límite de estas pruebas:** las RPC originales son dobles de prueba con los contratos observados en TypeScript. No reproducen el SQL real no entregado. PGlite utiliza una conexión; la concurrencia multiconexión debe probarse en staging. No se han realizado cobros reales, pruebas end-to-end contra proveedores ni inspección visual con una sesión real de Admin.

## Pasos para cerrar la integración

1. Ejecutar la consulta **de solo lectura** `20261002_00_inspect_existing.sql` en Supabase y revisar sus resultados. No exporta clientes ni credenciales.
2. Contrastar tipos, restricciones, funciones, triggers y concesiones existentes; ajustar el adaptador si las RPC entregan Coins adicionales o utilizan otro contrato. La migración aborta si faltan funciones o detecta ciertas referencias a entregas anteriores; esas comprobaciones no sustituyen la revisión del esquema completo.
3. Completar la integración de compras independientes de Oráculo sobre su mecanismo real de idempotencia.
4. Aplicar las migraciones 01 y 02 en una copia de desarrollo con las funciones originales, en ese orden. Cada script es transaccional. Validar también migración sobre datos/configuración existentes.
5. Configurar Admin y repetir A–G mediante los proveedores en sandbox, incluido doble callback simultáneo, cambio de rango, revisión obsoleta y rollback por fallo de base.
6. Desplegar el código solamente cuando ambas migraciones y las pruebas reales sean satisfactorias.

Para repetir las comprobaciones del repositorio:

```sh
npm ci
npm test
npm run typecheck
npm run build
```

La compilación necesita las variables de entorno habituales del proyecto. La validación local utilizó una URL y claves ficticias de compilación, sin consultar una base real. La instalación local de pruebas omitió scripts de instalación; el binario de ffmpeg no se probó porque no forma parte de esta fase.

Los cambios de Fase 2 no se han iniciado. No eliminar recibos ni historiales como método de rollback: conservan la protección contra reintentos de compras ya confirmadas.
