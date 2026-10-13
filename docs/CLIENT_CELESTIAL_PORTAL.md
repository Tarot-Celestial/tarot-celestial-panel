# Portal celestial del cliente

La portada `/cliente/dashboard` muestra un santuario con el emblema real de la marca, los saldos existentes y una fila horizontal de experiencias. La navegación superior agrupa todas las secciones en Inicio, Consultar, Mi camino, Experiencias y Mi cuenta. Las demás páginas conservan su universo planetario.

## Componentes y datos

- `CelestialPortal` mantiene el fondo, las capas CSS y la preferencia de movimiento. `PortalMotionControl` y `usePortalMotion` comparten el estado con logo y tarjetas.
- `HomeObservatory` recibe los mismos datos de la página existente. Conserva los anclajes `saldo-minutes`, `saldo-coins`, `canjear-coins` y `comprar-tiradas`, el bonus diario y el canje real de recompensas.
- `ExperienceRail` usa desplazamiento nativo, scroll snap, botones y arrastre de ratón. Las partículas son decoración; nunca añaden saldo ni indican premios recibidos.
- `ClientRitualAccess` reutiliza la respuesta autenticada del layout. Mi ritual sólo aparece cuando `rank_benefits.ritual_access` es explícitamente verdadero; la autorización definitiva sigue siendo del servidor.
- No se incorporan nuevas dependencias, endpoints, migraciones, precios ni reglas de negocio.

## Movimiento y recursos

El portal parte estático durante SSR. Respeta `prefers-reduced-motion`, pestaña oculta y la preferencia existente `tc-universe-motion`. El paralaje agrupa eventos en una única solicitud de frame pendiente, sin bucle continuo. Móvil y equipos limitados reciben menos decoración; ahorro de datos desactiva paralaje. Las tarjetas sólo animan cuando están visibles y el portal está activo.

Ocho WebP locales (3.25 MB en total): fondo de 1586 × 992, seis ilustraciones de 1536 × 1024 y emblema transparente de 1254 × 1254. Son recursos generados con la herramienta integrada de imágenes a partir del diseño aprobado. El emblema fue recortado de `Nuevo-logo-tarot.png`, preservando la identidad; la extracción generativa no es idéntica píxel a píxel. Los originales de marca permanecen intactos. No se presentan estos recursos como 8K.

## Comprobación

`tests/portal-motion.test.cjs` comprueba SSR, pausa persistida, movimiento reducido, visibilidad, eventos, ahorro y limpieza. Las pruebas existentes de rangos, guía, planetas y movimiento cubren los contratos compartidos. Antes de publicar se requiere comprobar el portal integrado en ordenador y móvil, navegación, permiso de ritual, canje existente, arrastre sin clic accidental y build completo.

Las pruebas de navegador usan sesión ficticia y todas las APIs interceptadas. No modifican cuentas reales. La comprobación pública posterior al despliegue compara los hashes de los ocho recursos y verifica que los bundles del dominio contienen el portal nuevo.

En la validación local de esta entrega pasaron 59 pruebas de regresión y 11 comprobaciones de navegador: escritorio y móvil, saldos, menú, arrastre, swipe, canje sin confirmarlo, pausa, visibilidad, movimiento reducido y permisos de ritual. Las imágenes del logo y tarjetas se sirven con tamaños adaptativos de Next Image.

La prueba de navegación real Inicio → Rangos → Ruleta → Inicio también pasó: se conserva un único canvas entre planetas y se desmonta al regresar al portal. Para repetir las pruebas de UI: ejecutar un servidor local con variables ficticias de Supabase, instalar Playwright si no está disponible y lanzar node tests/client-portal-browser.cjs. TC_PORTAL_QA_URL permite cambiar el puerto y TC_PORTAL_QA_OUTPUT el destino del informe. Sólo se permiten localhost y 127.0.0.1.

Limitación heredada: tres casos ajenos a esta entrega en tests/rank-benefits.test.cjs conservan contratos obsoletos de configuración/Admin y un mock incompleto. Fallan también al restituir el bloque original anterior. Los dos casos relevantes de permisos/navegación y denegación del endpoint ritual sí pasan.
