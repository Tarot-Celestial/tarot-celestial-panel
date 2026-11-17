# Recuperación de Contabilidad privada

El despliegue de producción de la rama `feat/contabilidad-privada-20261112`
(`cf28c5cb94ba8402a178db0424a59d3c2e418abf`) contenía el módulo privado, pero esa
rama no se había integrado en `main`. Las publicaciones posteriores desde
`main` lo dejaron fuera del sitio. No hubo un commit que borrase sus datos.

Se recuperan sus 33 archivos sobre `5e9d99ccb58a5106433963a39e6209e596efc122`,
conservando las mejoras posteriores de chat y CRM. La ruta es
`/admin/contabilidad`, accesible desde el botón Contabilidad de la cabecera.
La única adaptación del código histórico es usar una junction para el
servidor de pruebas local en Windows.

## Datos y acceso

- Supabase conserva las tablas `tc_accounting_*`, sus RPC y los permisos
  exclusivos de servidor. No se ejecuta ninguna migración ni escritura de datos.
- Vercel conserva `ACCOUNTING_PASSWORD_HASH` en producción. No se cambia ni
  se recupera su valor.
- El centro económico histórico y WELLDONE se conservan. No se importan
  registros de Flowly ni se modifican saldos de clientes.

## Verificación

- 78 pruebas de acceso, API, dominio, persistencia PostgreSQL y UI superadas.
- TypeScript: `tsc --noEmit`, correcto.
- Las pruebas financieras usan datos ficticios y una base local en memoria.

Integrar esta recuperación en `main` antes de publicar para que el siguiente
despliegue normal incluya también Contabilidad.
