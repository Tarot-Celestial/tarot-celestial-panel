# Oficina Celestial · Fase 1

En **Administración → Oficina Celestial**, junto a **Contabilidad**, el plano y el organigrama abren la misma ficha para cada uno de los quince departamentos. La ficha permite cambiar su responsable y consultar encargos, entregables e historial. En móvil, las salas también se eligen desde una lista.

## Recorrido de trabajo

1. Abre un departamento, pulsa **Ver encargos → Nuevo encargo** y registra el objetivo, la entrega esperada, la prioridad, el responsable y el plazo con su zona horaria. Puedes editar, reasignar y filtrar encargos.
2. Abre el encargo para añadir notas o presentar un entregable. Cada versión admite texto, un archivo privado o ambos. Los formatos admitidos son PDF, PNG, JPEG, WebP y TXT, con un máximo de 2 MiB por archivo.
3. En **Revisiones**, aprueba la versión, pide cambios o recházala. Una nueva versión vuelve a la bandeja de pendientes y conserva las anteriores. El historial registra quién hizo cada cambio y cuándo.

La asignación de trabajo a Atlas o a un equipo es un registro interno. La ejecución de agentes corresponde a la fase 2. Los departamentos muestran la planificación de sus capacidades, y los indicadores de encargos, entregables y revisiones se calculan a partir de los registros guardados.

## Instalación y acceso

La página está en `/admin/oficina`. Las [rutas de la Oficina](../src/app/api/admin/oficina/route.ts) y [la descarga](../src/app/api/admin/oficina/archivo/route.ts) validan la sesión y el permiso administrativo en el servidor. La [migración](../supabase/migrations/20261122185744_office_celestial_workspace.sql) añade las tablas y funciones de Oficina. Las versiones almacenan los archivos privados en Postgres, dentro de la misma transacción que los metadatos y el evento de auditoría. Los roles de navegador carecen de acceso directo a esos datos.

Para publicar, aplicar primero la migración revisada en el entorno de destino y desplegar después el código conforme al flujo del proyecto. Verificar con una sesión administrativa la entrada desde la cabecera. Para retirar el módulo, revertir la entrega de aplicación manteniendo las tablas y el historial.

## Verificación local

- `node --test --test-isolation=none tests/office-api.test.cjs tests/office-workspace.integration.cjs` comprueba el esquema, los permisos, los reintentos, los conflictos de edición y las revisiones por versión.
- `node tests/office-browser.cjs` recorre la aplicación Next con Chromium y Playwright. Comprueba navegación desde Contabilidad, edición, notas, dos versiones, revisión, descarga, recarga, filtros, móvil y denegación a un usuario sin permiso. Usa una identidad sintética y PostgreSQL local con PGlite. Admite `CHROMIUM_PATH` para elegir Chromium y `OFFICE_QA_OUTPUT` para guardar las capturas.
- `node tests/office-preview.cjs` abre una instancia local independiente en `http://localhost:3078/vista-previa`. Los cambios de esa instancia duran mientras siga activo el proceso. Los módulos de Oficina usan sus rutas y migración reales con datos de prueba. Los servicios de IA y las cuentas sociales quedan fuera de este recorrido.
