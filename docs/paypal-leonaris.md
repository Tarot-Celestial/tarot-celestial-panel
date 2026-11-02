# Cobros Leonaris

El CRM compartido por Administración y Central ofrece dos botones: Realizar pago conserva la cuenta habitual; Realizar pago Leonaris utiliza client_business_v1 (la cuenta identificada por Alex como leonarisignis@gmail.com). Los dos muestran los mismos packs y admiten importe manual. Leonaris tiene una presentación negra y dorada, también en el formulario de la clienta.

La cuenta, el Merchant ID, el importe y el contenido del pedido quedan guardados antes de llamar a PayPal. Consultas, captura, SDK, cancelación y webhooks utilizan esa cuenta guardada. Los pedidos antiguos sin marcador siguen en legacy. El selector PAYPAL_CUSTOMER_CHECKOUT_ACCOUNT solo afecta a compras nuevas del panel cliente.

Una función transaccional exclusiva del servidor impide crear otro cobro CRM pendiente para la misma clienta y entorno, incluso entre cuentas u operadores. Reintentar el mismo identificador recupera la operación original. Un cobro pendiente debe comprobarse o cancelarse antes de crear otro. Los registros históricos no se limpian ni se reescriben.

El historial muestra hasta 50 operaciones de la cuenta elegida, con pedido y captura. Comprobar actualiza reembolsos confirmados por PayPal sin emitir reembolsos ni retirar beneficios. Las notificaciones de reembolso requieren que la app PayPal esté suscrita también a sus eventos. El cobro CRM continúa siendo solo un recibo; Registrar llamada registra la compra por separado.

## Configuración

Se reutilizan los secretos de servidor PAYPAL_CUSTOMER_CLIENT_ID, PAYPAL_CUSTOMER_CLIENT_SECRET, PAYPAL_CUSTOMER_MERCHANT_ID, PAYPAL_CUSTOMER_WEBHOOK_ID y PAYPAL_CUSTOMER_ENVIRONMENT. PAYPAL_CUSTOMER_CHECKOUT_ACCOUNT=client_business_v1 activa Leonaris para compras nuevas del panel cliente. No se modifican PAYPAL_CLIENT_ID ni PAYPAL_CLIENT_SECRET de la cuenta habitual.

El build ejecuta scripts/check-paypal-leonaris.cjs: comprueba OAuth y la URL, identidad y eventos del webhook mediante una lectura. En producción exige Live. Un fallo impide publicar esa versión. El diagnóstico no prueba la recepción de eventos, la titularidad por sí sola ni un cobro completo.

## Validación

105 pruebas de rutas, cuentas, reintentos, capturas, cancelaciones, SQL, permisos, UI React y preflight, más TypeScript. Proveedores y compras simulados; no se han emitido pagos de prueba. Verificación visual en navegador y recorrido real siguen separados de estas pruebas.
