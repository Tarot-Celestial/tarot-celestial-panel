# Corrección de compra y consumo — ZIP 23

Instalar primero instalar-compra-consumo-v2.sql en Supabase y después desplegar el ZIP. Recargar el navegador: formularios de compras anteriores se rechazan para no mezclar interpretaciones.

Los campos de compra son los minutos ANTES de usar. Ejemplo: compra 20 FREE + 20 normales, consumo 5 FREE: quedan 15 FREE + 20 normales de la compra. El saldo previo y los bonos se conservan. La función registra el antes, compra, consumo, bonos y después dentro de la misma transacción. Reintentos de la misma operación no duplican consumos ni cobros.

Diagnóstico real anonymus: 119 anteriores +15 Diamante primera compra +20 segunda compra +15 Diamante segunda compra =169 FREE; 20 normales. El consumo de 5 no se restó porque el sistema interpretaba Guarda como remanente. La nota omitía el antes y los bonos.

El SQL separado corregir-solo-prueba-anonymus-5-free.sql ajusta exclusivamente esos 5 FREE confirmados, conserva el historial y deja nota de ajuste. Es idempotente: ejecutarlo otra vez no resta otros 5. Si el saldo sigue en169, queda164; conserva los20normales. No modifica el minuto de la primera compra: pudo corresponder a una compra consumida por completo.

No aplicar descuentos históricos masivos: otras centrales pudieron haber introducido ya el remanente. Hay1157 compras históricas con guardar y consumir, lo cual identifica casos a revisar, no demuestra1157 errores.

Verificado localmente: función v8 instalada copiada como fixture, escenarios con bono15 simulado, reparto de minutos, reintentos, rollback, permisos, pruebas de API y navegador con datos simulados. No se han ejecutado cobros ni consumos de prueba en producción. No se ha desplegado ni ejecutado ninguno de los SQL entregados.
