# Tarot Leonaris — Rangos por porcentajes (preparación)

## Estado y alcance
Esta rama contiene un editor de propuesta, una simulación administrativa de solo lectura y la vista previa del panel tarotista. **No activa nuevas condiciones, no confirma rangos, no modifica facturas ni migra datos.** La vista tarotista nueva solo se muestra dentro de la previsualización administrativa. El editor vigente se conserva íntegro y mantiene sus cambios no guardados al alternar vistas.

En administración → Rangos tarotistas → Abrir propuesta y simulación, se pueden probar dos objetivos por rango y comparar un mes. La propuesta inicial B 20/10, A 30/15 y S 40/20 no está validada ni activa. El cálculo utiliza Cliente / total atendido y Repite / total atendido, requiere ambos mínimos y no usa objetivos ocultos de minutos o captaciones. Sin minutos devuelve ausencia de evaluación, no un mal rendimiento de 0 %. Toda candidatura, incluso con poca actividad, requiere revisión; no se concede un rango automáticamente.

El endpoint POST /api/admin/tarotista-ranks/simulate requiere administración activa, pagina las lecturas, filtra la marca por la utilidad existente y no escribe en ninguna tabla. Usa los límites mensuales de Europe/Madrid. Una consulta incompleta, configuración ausente o exceso del límite de lectura devuelve error; no emplea reglas antiguas de reserva ni presenta una lectura parcial como completa. Solo compara salud, bono de rango y mejoras por minuto; no es una factura ni incluye otras recompensas.

## Beneficios y discrepancias
La propuesta representa los importes indicados por dirección: B salud 10 + rango 5; A salud 15 + rango 10 y mejora Repite 0,01 €/min; S salud 20 + rango 30 y mejoras Cliente/Repite de 0,01 €/min. Son incrementos, no las tarifas finales 0,11/0,13. El aviso de beneficios en texto detecta extras que mencionan importes, que no deben interpretarse como importes cobrables. No corrige la configuración económica en silencio.

## Pendiente antes de activar
1. Comparar al menos dos o tres meses completos, revisar volumen y mezcla de consultas y aprobar los porcentajes definitivos.
2. Confirmar y guardar correctamente los beneficios numéricos mediante un proceso económico aprobado.
3. Aprobar la vigencia mensual, suficiencia de datos y tratamiento de descensos. Implementar registro de rangos confirmados, reglas versionadas y aplicación a facturación sin recalcular documentos cerrados.
4. Integrar la vista nueva en la cuenta de la tarotista usando su rango confirmado, no la candidatura de la simulación.
5. Activar en una fecha acordada; entonces actualizar el PDF con capturas definitivas.

## Verificaciones
Ejecutado localmente: 20 pruebas del motor y del endpoint mediante adaptadores simulados, incluidos límites exactos, porcentajes sin redondeo para el ascenso, autorización, paginación de 1.250 y 50.000 registros, errores sin resultados parciales y ausencia de escrituras. Comando: `node --test tests/tarotista-percentage-ranks.test.cjs`.

Revisión local del diseño: HTML estático obtenido de los componentes mediante un runtime JSX mínimo; Chromium a 390, 768 y 1440 px para cuatro estados (12 combinaciones), sin desbordamiento horizontal ni contenido fuera de las tarjetas. Esta revisión no sustituye las pruebas de interacción React ni la compilación completa de Next. La comprobación de tipos del módulo puro pasó. La compilación completa se verifica en CI; no se afirma que haya pasado antes de leer su resultado.

Solo se realizaron lecturas del proyecto conectado. Ningún dato personal ni credencial se incluye en esta rama o en sus fixtures.
