# Acceso protegido a Contabilidad

Contabilidad requiere dos comprobaciones: una sesión válida del panel con autorización administrativa vigente y su propia contraseña. Conocer la contraseña no permite acceder sin una cuenta administrativa.

## Separación del centro económico existente

El libro privado de `/admin/contabilidad` es independiente del centro económico histórico. Sus tablas son `tc_accounting_ledger_entries`, `tc_accounting_categories`, `tc_accounting_methods` y `tc_accounting_option_audit`. No modifica ni importa automáticamente movimientos de `accounting_entries`, `accounting_movement_options`, `accounting_receivables`, `accounting_settlements` o `accounting_audit_log`.

El módulo comienza sin importes: hay que registrar el saldo inicial de cada cuenta y moneda. Celestial y Leonaris mantienen saldos separados; la vista conjunta consolida únicamente la moneda seleccionada. Un traspaso entre estas cuentas no crea beneficio. La bóveda aparta dinero del disponible y conserva su cuenta de origen. Los repartos se registran por destinatario, sin porcentajes predeterminados ni ejecución de pagos bancarios.

Los ingresos, gastos y categorías se introducen manualmente. Las velas representan la apertura, máximo, mínimo y cierre del saldo disponible registrado en cada día; no son cotizaciones ni datos bancarios. Para rectificar un movimiento se anula con un motivo y se registra uno nuevo, conservando la trazabilidad.

## Configuración del servidor

1. Aplica la migración de acceso revisada en `scripts/accounting-access-schema.sql` y la del libro contable. Las tablas nuevas llevan RLS y no conceden acceso a los roles del navegador (`anon` y `authenticated`). Los RPC públicos de acceso son `SECURITY INVOKER` y solo pueden ejecutarse con `service_role`. Una función privada `SECURITY DEFINER`, con búsqueda de esquemas vacía y ejecución exclusiva del servidor, comprueba que la sesión siga existiendo en `auth.sessions` sin otorgar permisos generales sobre esa tabla.
2. Genera el hash con Node, suministrando la contraseña por entrada estándar desde un archivo **privado fuera del repositorio** o desde un gestor de secretos:

   ```sh
   node scripts/accounting-password-hash.cjs < /ruta/privada/clave.txt
   ```

   El programa no acepta argumentos ni entrada interactiva con eco. Conserva espacios y elimina solamente un salto de línea final (LF o CRLF). Acepta de 1 a 256 caracteres. Su salida contiene únicamente un hash con sal aleatoria, en formato `scrypt$sal_hex$hash_hex`.

3. Guarda ese resultado en la variable **solo de servidor** `ACCOUNTING_PASSWORD_HASH` del entorno que vayas a desplegar. No uses un nombre que empiece por `NEXT_PUBLIC_`, ni lo incluyas en archivos TS/JS, capturas, registros o archivos versionados. No subas al repositorio la contraseña original, el archivo de entrada ni el hash generado.
4. Despliega el código y comprueba el acceso. Si falta la variable o su formato no es válido, el módulo permanece bloqueado: no hay contraseña predeterminada ni acceso alternativo.

El generador y el verificador usan scrypt con sal aleatoria de 16 bytes, clave de 64 bytes y parámetros `N=16384`, `r=8`, `p=1`. Para cambiar la contraseña, genera un nuevo hash, sustituye la variable y vuelve a desplegar. El cambio de versión invalida las sesiones adicionales existentes.

## Sesión y permisos

- La sesión adicional dura **una hora** y está vinculada a la identidad verificada y al `session_id` de Supabase.
- Se comprueba la existencia, el propietario y el límite `not_after` de la sesión de Supabase en cada lectura de acceso y al desbloquear. Si se elimina la sesión al cerrar sesión o se vence ese límite, el acceso adicional deja de ser válido aunque todavía no haya caducado el JWT.
- La cookie es `HttpOnly`, `SameSite=Strict` y `Secure` en producción. En la base de datos solo se guarda el hash del token.
- Hay un máximo de **cinco intentos cada quince minutos**, controlado de forma persistente y atómica en la base de datos. Un acceso correcto restablece el contador.
- Todas las API contables vuelven a comprobar la autorización administrativa y la sesión adicional; las escrituras también comprueban el origen y exigen JSON.
- El botón de bloqueo revoca la sesión adicional en el servidor y elimina la cookie. La revocación de permisos administrativos también bloquea inmediatamente nuevas solicitudes.
- Los importes, los movimientos y las contraseñas no deben incluirse en registros de depuración.

Las operaciones registradas son contabilidad interna: **no ejecutan transferencias bancarias ni pagos reales**.

## Verificación

```sh
node --test tests/accounting-access.test.cjs tests/accounting-access.integration.cjs tests/accounting-password-hash.test.cjs
```

Estas pruebas usan credenciales ficticias y una base Postgres local en memoria; no modifican las cuentas ni los datos de producción.

La prueba integral local `node tests/accounting-http.integration.cjs` ejecuta los handlers reales de Next contra un transporte Auth/PostgREST sintético y el SQL real en PGlite. `node tests/accounting-browser.cjs` añade el recorrido visual de escritorio/móvil cuando Chromium está autorizado en el entorno. Ninguna de estas pruebas necesita credenciales de producción.
