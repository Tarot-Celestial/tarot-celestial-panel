# Beneficios de clientes — noviembre 2026

Base revisada: f3e7cffb92363113b80d48763f6aa960e04c426a.

Las reglas se aplican exclusivamente a clientes. Se conservan saldos, movimientos, premios y el sistema de personal.

Decisiones confirmadas por Alex: la cuenta atrás de los giros antiguos empieza el 2 de noviembre de 2026 a las 02:55:09 UTC (03:55:09 Madrid); el pase nuevo descuenta usos del ciclo actual; Diamante copia los premios y pesos existentes de Especial y conserva Especial.

El cofre de nueva tarotista usa crm_new_tarotista_gift_policy, crm_new_tarotista_releases y crm_new_tarotista_gift_uses. La concesión y el consumo se confirman juntos mediante tc_register_new_tarotista_gift y tc_register_call_minutes. La consulta inicial de siete minutos es independiente.

La configuración vigente verificada describe un mes de seguimiento postritual para Diamante. Se conserva esa condición y el acceso a Mi ritual.

El régimen de compra se decide por la operación original, no por la fecha de un reintento. Las claves de concesión no incluyen la versión de política.

Reglas compartidas: presentación 7/8/9/12; bono regular 0/3/5/8; pase único 0/5/10/12 con compra en los últimos 30 días. Se preservan el ancla del ciclo y los usos previos. Una nueva compra o un cambio de rango no reinician el pase.

Diamante recibe 300 Coins totales y un giro de nivel 5 por compra de nivel 1/2/3, también en promociones. Las operaciones anteriores conservan el régimen original. El catálogo Especial de nivel 4 se copia con los mismos pesos a nivel 5 sin modificar el original. Canjes: 800/1200/1800/3000 Coins por 10/20/30/60 minutos.

Los giros pendientes 1/2/3/5 anteriores al instante confirmado vencen el 4 de noviembre a las 02:55:09 UTC (03:55:09 Madrid). Los concedidos posteriormente conservan sus 48 horas individuales. El servidor comprueba el vencimiento al consumir; los registros históricos, Coins y premios no se borran. Especial no cambia su caducidad.

El número de rango usa el sorteo activo y origen rank, con unicidad por cliente y sorteo. La sincronización considera compradores recientes, llamadas válidas y asignaciones manuales de rango; no crea un sorteo artificial. Si el sorteo se llena, la concesión queda pendiente hasta que Central amplíe su capacidad; no se inventan números fuera del límite.

Validación local: 129 comprobaciones de interfaz/API/reglas y otras 61 de cobros y sorteos existentes. La integración SQL ejecuta la migración real sobre DDL y funciones inspeccionados en producción, con clientes sintéticos en PGlite. Incluye reintentos, caducidad, cambio de rango, canjes, cofre y transición de compras. PGlite serializa las peticiones: estas pruebas no acreditan por sí solas carreras entre dos conexiones PostgreSQL independientes; los bloqueos y restricciones de unicidad están en el servidor.

El archivo antiguo tests/rank-benefits.test.cjs ya tiene cuatro fallos en la base f3e7cff (validador retirado, dependencias del montaje y navegación antigua). Se verificaron contra la copia sin cambios. No se presenta toda la suite histórica como aprobada.

La revisión visual autenticada está pendiente: Work devuelve “Local browser use is disabled in Work settings”. No se han creado compras, consumos, clientes ficticios ni sorteos de prueba en producción.

Publicación: aplicar la migración 20261102025228_customer_benefits_november_2026 una vez validado el candidato de Vercel; ejecutar tc_sync_rank_raffles para el sorteo real y comprobar configuración, plazos y saldos con consultas de lectura. La activación es idempotente y queda auditada. Revertir el frontend no revierte los movimientos de beneficios; cualquier corrección posterior debe conservar sus recibos e historial.
