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

## Refinamiento del santuario y las experiencias

El fondo conserva su arquitectura y recibe cascadas con textura de agua en cuatro regiones del escenario, tres nubes suaves y bruma local. Imagen y efectos comparten un plano de proporción 1586:992, por lo que las cascadas permanecen sobre sus islas al redimensionar. Sólo las texturas del agua, nubes y cielo cambian su transformación/opacidad; el arco y las estatuas quedan quietos. No se añade canvas ni un bucle de render continuo.

Los seis accesos usan objetos RGBA separados en public/images/portal/objects, servidos por Next Image en tamaños adaptativos. Los objetos flotan sobre fondos limpios con halo discreto, conservando el texto fuera de la ilustración. Flotación y partículas dependen de visibilidad, pausa y movimiento reducido.

Las flechas tienen 64px en escritorio y 48px en móvil. En pantallas anchas ocupan los márgenes exteriores del carrusel; en tamaños más pequeños tienen un canal reservado. A 320px se muestra una tarjeta completa. El arrastre y los enlaces siguen usando la implementación existente.

El nuevo fondo se editó con el generador integrado usando el anterior como referencia. Se solicitaron 3072×1920, pero la herramienta conservó 1586×992; no hubo ampliación artificial ni se presenta como 4K/8K. La nube transparente mide 2172×724; los seis objetos 1254×1254. Los cambios de calidad se basan en detalle visual, compresión y composición.

Validación local del refinamiento: 19 pruebas unitarias de movimiento y 16 comprobaciones de navegador aprobadas; TypeScript global correcto. Se comprobaron flechas laterales 64/48px, objetos flotantes, carga de seis imágenes, legibilidad 320px, swipe nativo, cascadas/nubes, pausa, movimiento reducido, canje sin confirmar y navegación entre portal y planetas. No se ejecutaron transacciones reales.
# Portales astrales y lectura clara

La propuesta visual 01 se aplica a las seis experiencias: cristal oscuro con doble borde, anillos zodiacales SVG decorativos, una base de luz y bruma. Los objetos siguen siendo imágenes independientes que flotan; los títulos y explicaciones son texto HTML. La textura compartida `public/images/portal/astral-mist.webp` pesa 182110 bytes (1254 × 1254, RGB) y se generó con ImageGen integrado. No se incorporan nuevas dependencias.

Las explicaciones usan 16 px, los detalles 14 px y las acciones 15 px con la configuración predeterminada del navegador. Se expresan en rem, las tarjetas crecen con el texto y la zona de lectura tiene una superficie oscura estable. Los saldos ahora indican explícitamente «min gratis» y «min normales»; mantienen los valores originales. La portada, navegación, bono diario y canje usan ayudas más legibles y controles de al menos 44 px cuando son acciones independientes.

En móvil los saldos se apilan y las flechas del carrusel quedan sobre los bordes exteriores del área decorativa, conservando espacio para el texto. Los anillos son estáticos; la bruma usa transform/opacity y respeta la pausa, visibilidad y preferencia de movimiento reducido existentes.

Validación local: 19 pruebas de movimiento, TypeScript global y 18 comprobaciones de navegador (1440, 390 y 320 px, texto al doble de tamaño, contraste de las superficies de lectura, arrastre, enlaces, permisos, pausa y navegación real entre rutas con API simulada). No se realizaron transacciones ni cambios de base de datos. La verificación del contraste de los recuadros no equivale a una auditoría integral de accesibilidad de todo el panel.

