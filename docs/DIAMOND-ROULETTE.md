# Premios de la Ruleta Diamante

Implementación preparada para `Tarot-Celestial/tarot-celestial-panel`, Supabase
`eparrucwxmebscsgvldj` y el equipo Vercel `caudetricky-3164s-projects`.
No se ha aplicado ni desplegado en estos servicios desde esta sesión: sus APIs
están bloqueadas por el proxy y no hay credenciales de Supabase/Vercel inyectadas.
La API de GitHub también responde Forbidden; la lectura Git por HTTPS funciona.

## Catálogo solicitado

| Premio | Probabilidad | Entrega |
|---|---:|---|
| 7 minutos | 21,30 % | Minutos FREE automáticos |
| 9 minutos | 17,00 % | Minutos FREE automáticos |
| 10 minutos | 15,00 % | Minutos FREE automáticos |
| 15 minutos | 12,00 % | Minutos FREE automáticos |
| Giro Nivel 1 | 9,00 % | 1 giro nivel 1 |
| 30 minutos | 7,50 % | Minutos FREE automáticos |
| Giro Nivel 2 | 5,50 % | 1 giro nivel 2 |
| 2 tiradas del Oráculo | 4,50 % | Créditos del ledger existente |
| Runa Milenaria | 2,80 % | Gestión manual |
| 50 minutos | 2,20 % | Minutos FREE automáticos |
| 70 minutos | 1,20 % | Minutos FREE automáticos |
| Giro Nivel Especial | 0,80 % | 1 giro nivel 4 |
| 100 minutos | 0,50 % | Minutos FREE automáticos |
| 10 min diarios × 7 días | 0,35 % | Reclamación diaria |
| Consulta 10 min con Tarotista Rango A | 0,25 % | Gestión manual |
| Bono Misterioso Diamante | 0,10 % | Gestión manual |
| **Total** | **100,00 %** | |

El premio diario comienza el día natural del giro en `Europe/Madrid`, permite
una reclamación por fecha durante siete días y caduca a medianoche al comenzar
el octavo día. Los días omitidos no se acumulan. Esta regla se muestra en Inicio
y en Ruleta. Leonaris avisa cuando hay una reclamación disponible; el saldo se
refresca después de confirmarla. Un cambio posterior de rango no revoca premios
ya ganados ni giros concedidos sin `required_rank`.

Los tres premios manuales quedan pendientes, con referencia del giro e
instrucciones para tomar una captura y enviarla a Tarot Celestial o llamar.
Se reutilizan los teléfonos de España, Estados Unidos y Puerto Rico ya definidos
en el proyecto. No se inventa un número WhatsApp. Administración puede marcar
la gestión completada, con identidad y auditoría; el cliente no puede hacerlo.

## Integridad

- Sorteo en PostgreSQL con 10.000 intervalos y aleatoriedad UUID v4 con rechazo
  para evitar sesgo. Las probabilidades deben sumar exactamente 100 %.
- La transacción bloquea cliente/giro, entrega el premio, guarda un recibo
  permanente, consume el giro y crea la notificación. Cualquier error revierte
  toda la operación. El cliente nunca envía el premio, los minutos ni la fecha.
- `tc_diamond_roulette_results` conserva el resultado por `spin_id`. Reintentos
  devuelven ese mismo premio incluso si la campaña o el rango cambian después.
- `tc_diamond_roulette_claims` tiene clave única por beneficio y día de Madrid.
  La última reclamación de los siete días también admite reintentos seguros.
- Las nuevas tablas tienen RLS y no conceden acceso a `anon`/`authenticated`.
  Las RPC de negocio solo se exponen al servidor `service_role`; la API verifica
  la identidad y obtiene el cliente de `auth_user_id`.
- Los premios de giros/Oráculo se guardan como `perk` más `metadata.delivery_kind`
  en el catálogo existente para conservar sus tipos SQL. Las respuestas al
  cliente y el editor presentan su tipo concreto.
- Nivel 4 sigue siendo Especial y nivel 5 es Diamante. Solo se normalizan giros
  pendientes con los orígenes históricos explícitos `diamond_rank_purchase` y
  `admin_manual_diamond`. Un trigger protege futuras concesiones de esos orígenes.
  Los giros consumidos y los demás giros Especiales conservan su historial.
- El snapshot nuevo extiende la función canónica existente, preservando sus
  campos y distinguiendo los contadores Especial/Diamante.
- El guardado de porcentajes del administrador es una única RPC transaccional.
  El motor antiguo no puede consumir un giro Diamante sin recibo del motor nuevo.

## Aplicación en infraestructura real

1. Habilitar las conexiones Supabase/Vercel o configurar sus credenciales por la
   vía segura del entorno. Se han guardado como requisitos `SUPABASE_ACCESS_TOKEN`
   (destino `api.supabase.com`) y `VERCEL_TOKEN` (destino `api.vercel.com`). El borrador
   añade esos dominios, `api.github.com` y `eparrucwxmebscsgvldj.supabase.co`, y propone
   `NEXT_PUBLIC_SUPABASE_URL=https://eparrucwxmebscsgvldj.supabase.co`.
   Guardar el borrador no aplica ni publica estos cambios. Para validar la app
   se necesitan además sus claves Supabase reales; nunca deben ir en Git ni chat.
2. Ejecutar `migrations/20261006_00_inspect_diamond_roulette.sql` en el proyecto
   indicado. Contrastar columnas, restricciones, firmas y permisos reales con
   la migración. Confirmar que nivel 5 está permitido, que los valores de estado
   usados son aceptados, que la auditoría permite actor nulo para migraciones de
   sistema y que la función compartida del Oráculo acredita de forma idempotente.
   Inspeccionar los cuerpos desplegados de las RPC base si difieren del contrato.
   La infraestructura histórica completa no está versionada en este repositorio:
   **la fixture de pruebas no sustituye esa comprobación**.
3. Preparar el despliegue del código. Aplicar la migración
   `20261006_01_diamond_roulette_rewards.sql` y desplegar el código como una entrega
   coordinada: el código necesita las nuevas RPC y el motor antiguo no admite
   giros Diamante después de instalar la protección. Los demás niveles mantienen
   su motor. No ejecutar giros ni compras reales como prueba automática.
4. La migración instala y habilita el catálogo en la única campaña vigente. Si
   hay varias campañas vigentes, se detiene y revierte. Si no hay ninguna, crea
   la infraestructura y permite instalar los premios mediante el botón
   **Cargar los 16 premios Diamante** de la campaña elegida en Administración.
   Archiva los premios previos del nivel 5 conservando su historial y el catálogo
   previo en auditoría. Reaplicar la migración no duplica premios ni sobrescribe
   ediciones posteriores de un catálogo ya instalado.
5. Consultar en Supabase los 16 premios activos del nivel 5, suma 100, sus modos
   de entrega y los permisos. Verificar en una cuenta de prueba autorizada los
   recibos, saldos, giros y reclamaciones sin mover saldos de clientes reales.
   En Vercel identificar el proyecto enlazado al repositorio dentro del equipo
   proporcionado y verificar su despliegue antes de promover a producción.
6. Validar con sesión real Inicio, Ruleta Diamante, Oráculo y Administración;
   comprobar recarga, doble clic y resultado recuperado. Confirmar la señal
   privada de actualización de saldos. No se ha verificado todavía ninguna de
   estas operaciones contra infraestructura real en esta sesión.

## Validación local

Desde `/workspace/tarot-celestial-panel`, Node 24 y dependencias instaladas:

```sh
node --test tests/diamond-roulette.test.cjs tests/diamond-roulette.integration.cjs
npm run typecheck
npm test
```

23 pruebas nuevas pasan: catálogo exacto, todas las entregas, 70 minutos en siete
reclamaciones, límites por fecha y cambios de horario, reintentos, autorizaciones,
rollback, separación de ruletas, conservación de datos y contratos HTTP/UI.
La suite completa ejecuta 71 pruebas: 59 pasan y 12 fallan, los mismos fallos
anteriores en `rank-benefits.*` (fixtures SQL incompletas, export antiguo,
respuesta de UI desactualizada y resolución de alias en su cargador).

Las pruebas de SQL usan PGlite con la migración real y fixtures explícitas de
las dependencias históricas. Verifican el uso del ledger compartido del Oráculo,
pero no su implementación desplegada. No equivalen a una prueba de carga con
sesiones PostgreSQL simultáneas ni a una validación del esquema remoto.

El build compiló correctamente y pasó su validación de tipos, pero falló en la
recopilación de `/api/chat/register` con `supabaseKey is required`. Requiere las
claves Supabase reales durante la recopilación de rutas.
No se han fabricado claves para simular un despliegue correcto.
