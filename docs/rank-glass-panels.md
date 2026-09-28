# Paneles de cristal por rango

La apariencia común se define en `src/app/panel-theme.css` y `PanelTheme`.
`src/lib/panel-theme.ts` traduce claves de rango a colores; no calcula niveles,
permisos ni recompensas. Una clave ausente o desconocida utiliza Celestial.

## Fuentes de datos

- Centrales: `useCentralXpData().data.progress.tier.key`, procedente de la API
  existente de XP y su configuración de Supabase. Está disponible en todas las
  pestañas para mantener el tema y la cabecera sincronizados.
- Tarotistas: `stats.stats.tarotista_rango`. C, B, A y S conservan sus nombres;
  solo reciben los acabados Bronce, Plata, Oro y Diamante respectivamente.
- Clientes: `cliente.rango_actual` de `/api/cliente/me`, incluyendo el rango
  efectivo y sus intervenciones temporales. No se usa metadata editable para
  decidir permisos. El tema se limpia al cambiar de cuenta.
- Administración: acabado Celestial, sin asignar un rango ficticio.

El tema predeterminado de Centrales es «Cristal · mi rango». Las preferencias
de apariencia v2 se migran a v3: Celestial Original con paneles del tema pasa
al nuevo acabado; otros temas personalizados se conservan. Tamaño, contraste,
transparencia, intensidad de cristal y sombras siguen disponibles.

Las superficies comunes y las secciones de XP, tienda, factura, clientes,
equipo, notificaciones, estadísticas y rangos consumen las mismas variables.
El panel conserva los controles y callbacks existentes. El selector de fecha
y los submenús son accesibles por teclado. El personalizador usa un portal
para evitar recortes dentro de superficies con desenfoque.

## Comprobaciones

```sh
node --test tests/panel-theme.test.cjs
npx tsc --noEmit
yarn build
```

Las pruebas de rango cubren configuración de niveles modificada, nombres
localizados, claves de cada rol, cambios de rango y claves desconocidas.
La comprobación visual local de Centrales usa sus componentes reales con
estados vacíos de prueba en 390, 820 y 1680 píxeles. La página temporal
`design-check` está excluida de Git y no se publica.

Para validar la vista previa con datos reales, iniciar sesión con cada rol y
revisar navegación, rango, XP, perfil, notificaciones y factura. Las consultas
y los permisos existentes se mantienen; este cambio no incluye migraciones,
modificaciones de RLS ni cambios de credenciales.
