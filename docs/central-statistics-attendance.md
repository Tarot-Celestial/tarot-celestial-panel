# Estadísticas de centrales y registro de conexión

Implementación preparada localmente. No se han aplicado migraciones ni cambios de producción en esta tarea. Los ejemplos y fixtures usan identidades ficticias; los contratos individuales se configuran de forma privada y nunca se incluyen en este repositorio público.

## Activación

1. Revisar el diff y guardar la revisión desplegada anterior. Ejecutar las pruebas indicadas abajo.
2. Aplicar primero `20261028222646_panel_attendance_sessions.sql` y después `20261028222853_central_statistics.sql`. Ambas deben existir antes de publicar el código que las utiliza.
3. Configurar privadamente los contratos iniciales autorizados, con vigencia desde `central_statistics_activation.activated_at`. No editar `worker_schedules` ni `shift_schedules` históricos. No inventar el día de fin de semana o una tarifa: dejarlos pendientes hasta confirmación. Las modificaciones posteriores se guardan como versiones mediante la API administrativa.
4. Verificar RLS y privilegios: las nuevas tablas y RPC solo son accesibles con `service_role`; esa clave nunca llega al navegador. Revisar que los administradores autorizados estén activos.
5. Desplegar la aplicación y comprobar el recorrido real en navegador con cuentas de prueba autorizadas: login, panel bloqueado, conexión explícita, navegación, descanso, reconexión, expiración tras diez minutos sin actividad y sincronización entre pestañas. Un heartbeat no debe reconectar una sesión vencida.
6. Validar una llamada real autorizada antes de confiar en la protección de inactividad durante llamadas. La prueba viene de AMI en el servidor; un indicador del navegador no acredita una llamada. Si no existe evidencia disponible, se conserva el límite normal y la opción manual de mantenerse conectado.
7. Revisar las estadísticas, una planificación futura y una corrección de prueba autorizada. Contrastar un cobro conocido, su autor y su fecha; comprobar que los pagos web y los cobros enlazados a rendimiento no se duplican. Las pruebas locales no sustituyen esta comprobación de producción.

## Fuentes y alcance

Se incluye actividad de todas las marcas, con importes de cobros completados en EUR. `crm_cliente_pagos` es la fuente económica; no se suman importes de `rendimiento_llamadas`. La atribución resuelve el autor almacenado como identificador de trabajador o usuario. Los pagos web y los no atribuibles se muestran separados.

Las captaciones usan la primera confirmación de `crm_client_capture_audit`, atribuida al captor original, y se cuentan por fecha de confirmación. No se cambia la regla existente de primera gestión válida ni se vuelve a otorgar XP. Recuperaciones: `crm_client_recovery`; intentos y contactos válidos: `crm_recovery_contact_events`; gestiones de captación: `captacion_state_events`; seguimientos: `crm_client_followups`; llamadas/minutos: `rendimiento_llamadas`; XP aplicado: `worker_xp_events`. Las notas cuentan registros atribuibles de `crm_client_notes` sin tipo de evento automático; algunas se generan al registrar una gestión y no representan necesariamente redacción manual. No se exponen sus textos.

## Periodos, horas y límites

El mes usa `America/Guayaquil`. En el mes en curso se compara el mismo día y hora del mes anterior, con límite en el final de ese mes si era más corto. Los extremos y su carácter exclusivo se devuelven explícitamente. Una fuente iniciada a mitad del periodo conserva sus recuentos, pero no genera delta ni porcentaje. Las colas de leads/seguimientos solo representan el estado actual y son desconocidas al consultar meses cerrados.

Las horas empiezan en el marcador de activación; antes son `null`, no cero. Se unen intervalos solapados y se limita cada sesión a su cierre, caducidad o al instante consultado. El desglose diario separa minutos previstos, fuera de horario, sin clasificar y correcciones auditadas. No se reconstruyen horas exactas desde los antiguos heartbeats. Los descansos cierran la sesión de trabajo.

Los horarios y tarifas son versiones, aplicadas únicamente desde su fecha efectiva. La planificación permite un solo sábado o domingo por semana, incluso entre meses, y conserva fechas pasadas. Un fin de semana no asignado queda pendiente: no se convierte automáticamente en horas adicionales. Las correcciones por trabajo fuera del panel requieren fecha, minutos, categoría y motivo; no reescriben sesiones. Conservan autor, operación idempotente y tarifa de referencia, y controlan concurrencia y límites diarios.

“Fuera de horario” es una categoría operativa. No equivale a horas extraordinarias legales, no incluye automáticamente recargos nocturnos ni liquida nóminas. Cualquier importe es una estimación pendiente de revisión. Salario, jornada y recargos necesitan la validación correspondiente antes del pago.

## Contrato API

`GET /api/admin/central-statistics?month=YYYY-MM` exige bearer validado con `auth.getUser`, trabajador administrador activo y sesión de panel conectada. Devuelve `period`, `workers`, `totals`, `coverage` y la plantilla de mañana sin asignar. Cada trabajador incluye métricas actuales/anteriores, XP al corte, horas, desglose diario, configuración vigente, correcciones y `weekend_days`. Esta última lista contiene selecciones para planificación hasta el final del mes actual más doce meses; la interfaz debe filtrarla por el mes que está editando, no por el mes del informe.

`POST` al mismo endpoint exige `worker_id` y `operation_id` UUID nuevo por operación lógica. Reutilizarlo solo para reintentar exactamente la misma operación:

- `action: "settings"`: `monthly_salary_eur`, `overtime_hourly_rate_eur` (número o `null`), `weekday_start`, `weekday_end` (ambos `HH:mm` o ambos `null`), `weekend_start`, `weekend_end`. Crea una versión desde el instante del guardado.
- `action: "weekends"`: `month` y `days: string[]`. Sustituye las selecciones futuras de ese mes; las fechas pasadas se conservan. Recuperar la lista vigente antes de editar evita borrar selecciones no observadas.
- `action: "adjustment"`: `date`, `minutes` entero con signo, `category: "ordinary" | "outside_schedule"`, `reason`. Solo desde activación hasta hoy; el servidor obtiene los saldos de referencia y audita el cambio. Puede registrar trabajo confirmado en un día sin sesiones.

Errores de acceso: `401` sin sesión válida, `403` sin administrador activo, `423` si falta conexión; una colisión de edición devuelve `409`. No inferir cero ante un error de carga.

## Pruebas y reversión

`node --test --test-isolation=none tests/central-statistics.test.cjs tests/central-statistics.integration.cjs` verifica dieciséis escenarios, incluidos SQL real en PGlite, deduplicación, captor original, permisos, periodos Ecuador, cobertura incompleta, horas solapadas, cambios de tarifa, planificación entre meses y ajustes concurrentes. Los tests de presencia están en `tests/panel-attendance.test.cjs` y `tests/panel-attendance.integration.cjs`; confirmar sus nombres y comandos en el árbol de la revisión antes del rollout. Ejecutar también `node node_modules/typescript/bin/tsc --noEmit --pretty false` y el build de la aplicación.

Si hace falta revertir, restaurar el despliegue de aplicación anterior y conservar todas las tablas, versiones, sesiones y operaciones nuevas. No borrar filas, reaplicar horarios viejos sobre periodos medidos ni retirar columnas para ocultar un fallo. El código anterior puede seguir usando el registro legacy; marcar cualquier intervalo sin la nueva instrumentación como una interrupción de cobertura al volver a activarla y revisar ese tramo antes de calcular importes. Un build correcto o un despliegue READY no confirma por sí solo el recorrido operativo.
