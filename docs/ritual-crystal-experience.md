# Cristales vivos de Mi Ritual

La sección `/cliente/ritual` presenta cinco apariencias: escudo ámbar (Protección), cuarzo azul (Limpieza), brote esmeralda (Prosperidad), corazón jade (Sanación) y dos orbes rosa/violeta (Amor y Armonización). Los gráficos fueron creados con la herramienta integrada imagegen a partir de las propuestas aprobadas. Los rayos interiores, la respiración luminosa y las partículas son animaciones CSS/SVG, sin un segundo renderizador WebGL.

## Datos y progresión

La API autenticada existente `/api/cliente/ritual` sigue siendo la fuente de fases, progreso, fechas, mensajes y estado. No se modifica el catálogo ni ninguna asignación en Supabase.

- Atlas WebP transparentes en `public/images/rituals/crystal/`: 1536 × 1024, tres columnas por dos filas, seis celdas de 512 × 512.
- Cuatro fases usan las celdas `0, 1, 3, 4`; cinco fases usan `0, 1, 2, 3, 4`.
- La celda `5` y la luminosidad completa requieren `estado = completado`. El porcentaje por sí solo no completa el ritual.
- Dentro de cada fase, el progreso sólo ajusta ligeramente la luminosidad. Una fase manual temprana conserva su aspecto aunque el porcentaje sea 100.
- `pendiente` y `cancelado` muestran un cristal tenue; `pausado` conserva la apariencia de su fase y detiene el movimiento.
- Si no hay un ritual activo, el último completado se presenta con su aspecto final y un rótulo explícito. Los detalles del historial no instancian gráficos ocultos.

## Movimiento y carga

La animación se detiene por estado, preferencia de movimiento reducido, pestaña oculta, salida del área visible o el botón «Pausar animación del ritual». La pausa manual se recuerda localmente. No hay animaciones por fotograma mediante React ni peticiones periódicas nuevas.

Sólo se carga el atlas de la apariencia visible, de aproximadamente 285–395 KB. Se decodifica antes de mostrarlo y se reutiliza al cambiar de etapa. El símbolo vectorial existente sirve como respaldo de carga/error o para tipos desconocidos. Los vídeos configurados para una fase conservan sus controles y su respaldo gráfico.

La presentación compensa pequeños desplazamientos entre celdas sin alterar las imágenes. Las máscaras usan el alfa del mismo atlas para contener los rayos dentro de la figura.

## Verificación

`tests/ritual-visual-state.test.cjs` verifica los catálogos de cuatro/cinco fases, estados, luminosidad, datos inválidos y fase manual. Las pruebas de navegador se ejecutan sobre la ruta real con sesión y respuestas ficticias; no escriben en datos de clientes. Comprobar inicio/final de cada apariencia, pausa, ocultación, movimiento reducido, móvil, respaldo de imágenes y cierre registrado antes de publicar.
