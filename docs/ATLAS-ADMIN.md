# Atlas en administración

Acceso: `/admin?tab=atlas`. El acceso flotante abre la misma pestaña, sin iniciar otro consumidor de datos.

## Uso

- «Atlas, ¿cómo vamos hoy?» consulta metas, misiones, pendientes y señales con evidencia.
- «Atlas, activa una promo» muestra las promociones estándar actuales y sus packs. Elegir una prepara el cambio; el botón **Ejecutar esta acción** lo aplica.
- «Atlas, agrega un giro de nivel 1 a Ana» y «Atlas, agrega 20 Coins a Ana» resuelven la ficha, muestran el destinatario y reutilizan los ajustes auditados existentes.
- «Atlas, comprueba la última compra de Ana» y «Atlas, dime el último registro de llamada de Ana» distinguen pagos confirmados, llamadas y notas.
- «Atlas, cambia la contraseña de Ana» abre un campo protegido. La contraseña se envía exclusivamente a Auth al ejecutar; no se guarda en conversación, memoria ni auditoría, ni se envía al modelo. Se rechazan accesos de personal y cuentas compartidas entre fichas.
- «Atlas, envía 10 contactos para recuperar a Isa» mantiene la responsable solicitada. Los contactos se seleccionan por elegibilidad y prioridad explicable, sin inventar probabilidades. Confirmar crea encargos visibles en **Tareas** de la mascota.
- «Atlas, prepara un encargo para mejorar la recuperación» prepara responsables, pasos y plazos. Las centrales pueden empezar, registrar resultados, completar o pedir ayuda.
- «Atlas, recuerda que…» prepara una memoria privada del administrador, revisable y eliminable.

Las propuestas caducan a los 30 minutos. La confirmación vuelve a comprobar identidad, elegibilidad y versiones. Reintentar una operación conserva su identificador y devuelve el recibo sin repetir el efecto.

## Cifras y alcance

Los objetivos son del conjunto: **superar 300 EUR diarios** y **al menos 10 captaciones mensuales**, con calendario `America/Guayaquil`. La facturación usa pagos positivos `completed` en EUR de Tarot Celestial; no suma otra vez la llamada vinculada. Una captación requiere registro confirmado y primera compra verificada.

Las misiones de recuperación mantienen los turnos existentes de Isa y María y sus reglas de XP: 30 gestiones / +10, cada recuperación con compra confirmada / +75 y cinco recuperaciones / +200. La celebración de compra muestra el premio `assigned_client_purchase` ya persistido; no concede otro premio.

Los patrones de 7 y 30 días describen asociaciones, muestran su muestra y distinguen resultados declarados de compras verificadas. Atlas no detecta llamadas reales ni actividad fuera del panel. La memoria orienta la conversación; guardar una preferencia no crea por sí solo una nueva regla automática o una penalización.

## Configuración y operación

Aplicar las migraciones de Atlas en orden cronológico antes del despliegue. Las tablas y RPC son de acceso exclusivo del servidor, con RLS habilitado y permisos de navegador revocados. Las rutas verifican el bearer con Auth y enlazan `workers.user_id`; no aceptan identidades suministradas por el navegador.

La conversación libre reutiliza la integración Responses existente: `OPENAI_API_KEY` y el primer modelo configurado de `ATLAS_ASSISTANT_MODEL`, `CENTRAL_ASSISTANT_MODEL`, `OPENAI_TEXT_MODEL`. Las consultas y propuestas guiadas siguen disponibles si el proveedor falla. Los datos de herramientas, CRM e historial se tratan como datos, no como permisos o instrucciones de ejecución.

Validación local:

```sh
node --test --experimental-test-isolation=none tests/atlas-*.cjs tests/central-atlas*.cjs tests/central-purchase-celebrations*.cjs
node node_modules/typescript/bin/tsc --noEmit
yarn build
```

Las pruebas de autorización y concurrencia usan datos sintéticos; no requieren cambiar saldos, contraseñas, promociones ni compras reales. La comprobación visual de producción requiere una sesión de administrador iniciada por su propietario.
