# Orden de clientes al filtrar por etiqueta

Al cargar una etiqueta en el CRM de Admin o Central, todos sus resultados se
ordenan por importe histórico registrado descendente, número de compras
descendente, última actividad real descendente y UUID ascendente para resolver
empates. Los clientes sin compras quedan después de los compradores; entre ellos
se prioriza la actividad reciente. No cambia el orden del directorio sin etiqueta.

El gasto sigue el criterio existente del CRM: pagos positivos completados y
compras antiguas en rendimiento sin ningún pago vinculado. Un pago vinculado,
incluso cancelado o devuelto, impide volver a contar esa llamada. No se incluyen
enlaces de cobro pendientes ni se suman otra vez los recibos de PayPal. La compra
operativa de minutos mantiene su registro actual. Los productos independientes
de Oráculo aportan actividad comprobada, pero no alteran este histórico de compras
CRM ni los rangos.

Alex confirmó el 15 de noviembre de 2026 que los importes deberían estar en euros
y que para esta prioridad se utilicen sus valores registrados. Se mantiene ese
criterio nominal sin inventar conversiones ni cambiar las monedas de las filas
históricas. La interfaz presenta el total en euros y el número de compras.

La actividad usa las fuentes de gestión de la automatización mensual: llamadas,
compras, captación confirmada y compras web verificadas. Entrar al panel no mejora
esta prioridad. Se conserva el mes asignado y todas las demás etiquetas.

## Paginación y acceso

`tc_crm_client_priority_page` calcula el orden en PostgreSQL antes de devolver
121 posiciones (120 visibles y una de continuidad). La ruta verifica primero la
sesión y el rol activo Admin/Central; la función nueva es `SECURITY INVOKER`, solo
de lectura y solo ejecutable por `service_role`. No cambia permisos existentes.

El cursor incluye el corte temporal y la última posición completa, vinculados a
los filtros. Nuevos registros posteriores al corte no cambian esa paginación.
No es una instantánea transaccional entre peticiones: correcciones, devoluciones
o cambios de etiqueta durante la navegación requieren volver a cargar el CRM.
La UI conserva el orden del servidor, elimina duplicados al añadir páginas y
mantiene la etiqueta de la búsqueda cargada aunque se edite el selector.

## Validación

- 45 pruebas locales de SQL, API y UI: orden global, más de 120 resultados,
  empates, clientes sin compras, duplicados, registros anulados, filtros,
  aislamiento de roles, cursores y conservación de saldos.
- TypeScript: comprobación completa sin errores.
- Migración aditiva: una función de consulta y un índice parcial de captaciones
  confirmadas para evitar recorrer las importaciones históricas; no actualiza clientes, pagos,
  llamadas, saldos, rangos o etiquetas.

Aplicar la migración antes de publicar la ruta. Las pruebas usan datos ficticios;
la comprobación de producción consulta los registros existentes sin crear compras.

