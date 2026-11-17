# Contabilidad mensual: recuperación del diseño aprobado

El panel privado vuelve al diseño mensual aprobado el 13 de noviembre: resumen de apertura y cierre, estadísticas, formulario visible, movimientos con filtros y exportación CSV, y columnas independientes de Celestial y Leonaris con su caja extra.

La fuente es el paquete original `contabilidad_celestial_redisenada.zip`, recuperado del chat «Publicar cambios directamente». Se integra sobre `main` posterior a #84; no se sustituye el repositorio por la versión antigua.

## Datos y acceso

- No importa datos, saldos ni movimientos de Flowly y no vacía la contabilidad existente.
- No modifica tablas, RPC, permisos, contraseña, configuración ni proveedores.
- Mantiene la API privada, el historial auditable y la separación de EUR y USD.
- Los saldos se calculan hasta el cierre del mes seleccionado, o hasta hoy en el mes actual. Los filtros de detalle no alteran los saldos acumulados.
- Los traspasos y movimientos de bóveda no inflan ingresos ni gastos operativos.
- Un resultado incierto conserva el identificador del movimiento para reintentar sin duplicarlo. Los rechazos definitivos permiten corregir los campos.

## Validación

Pruebas de acceso, API, SQL local, dominio, formularios y modelo mensual; comprobación TypeScript. La revisión interactiva usa datos ficticios en un servidor local aislado. La comprobación publicada se limita a lectura y controles de consulta; no añade movimientos reales.

Resultado previo a publicación: 104/104 pruebas aprobadas y TypeScript sin errores. En navegador local se comprobó un ingreso ficticio, filtros sin alterar saldos, cambio de mes, separación de EUR/USD y ausencia de desbordamiento horizontal a 390 px. También se verificaron gráficos vacíos por selección y se corrigió la hidratación del título SVG.

## Reversión

Revertir esta entrega recupera la interfaz anterior sin modificar los registros ni su estructura.
