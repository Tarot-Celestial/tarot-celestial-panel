# WhatsApp en el panel de centrales

Apartado **WhatsApp** del panel de centrales: se escanea un QR, se ven los chats que llegan, se responde desde el panel y, con **Cerrar sesión**, se desvincula el número y aparece un QR nuevo para conectar otro.

> ⚠️ **Aviso importante.** Esto usa WhatsApp Web de forma **no oficial** (librería Baileys). Va contra los términos de WhatsApp y existe riesgo de que bloqueen el número, sobre todo si se envían mensajes masivos o automáticos. Úsalo para atender conversaciones a mano, no para campañas. Para uso intensivo, la vía estable es la Cloud API oficial de Meta.

## Cómo funciona

```
Navegador (panel central)
   │  /api/central/whatsapp/*   (comprueba que eres central/admin)
   ▼
Panel Next.js en Vercel ── secreto compartido ──►  whatsapp-gateway (este servicio)
                                                     │  mantiene la sesión de WhatsApp Web
                                                     ▼
                                                  WhatsApp
```

Vercel es *serverless*: no puede tener una conexión abierta 24 h. Por eso la sesión vive en este pequeño servicio Node, que debe ir en un servidor **siempre encendido** con **disco persistente** (ahí se guardan la sesión y los últimos mensajes de cada chat).

## 1. Desplegar el gateway

Necesitas Node 20 o superior. Elige una opción:

**Railway / Render / Fly.io (con Docker)**
1. Crea un servicio nuevo apuntando a la carpeta `whatsapp-gateway` del repositorio (usa el `Dockerfile` incluido).
2. Añade un **volumen persistente** montado en `/data`. Sin volumen, cada reinicio obliga a escanear el QR otra vez.
3. Variables de entorno:
   - `WA_GATEWAY_SECRET` → un secreto largo (`openssl rand -hex 32`).
4. Copia la URL pública HTTPS que te dé la plataforma.

**VPS propio**
```bash
cd whatsapp-gateway
docker build -t tc-whatsapp .
docker run -d --name tc-whatsapp --restart unless-stopped \
  -p 8787:8787 -v tc-whatsapp-data:/data \
  -e WA_GATEWAY_SECRET=TU_SECRETO tc-whatsapp
```
Ponlo detrás de HTTPS (Caddy, Nginx, Cloudflare Tunnel…).

Sin Docker: `npm install && WA_GATEWAY_SECRET=... node server.mjs`.

Comprueba que responde: `https://tu-gateway/health` → `{"ok":true,...}`.

Importante: ejecuta **una sola instancia** del gateway. Dos instancias con la misma sesión se desconectan entre sí.

## 2. Conectar el panel (Vercel)

En el proyecto de Vercel → *Settings → Environment Variables*:

| Variable | Valor |
|---|---|
| `WHATSAPP_GATEWAY_URL` | URL del gateway, sin barra final (`https://tc-whatsapp.up.railway.app`) |
| `WHATSAPP_GATEWAY_SECRET` | El mismo valor que `WA_GATEWAY_SECRET` |
| `WHATSAPP_SESSION_MODE` | `shared` (por defecto) o `per-worker` |

- `shared`: todas las centrales ven y usan el mismo WhatsApp (un número de empresa). Si una cierra sesión, se cierra para todas.
- `per-worker`: cada central vincula su propio WhatsApp.

Vuelve a desplegar el panel después de añadir las variables.

## 3. Uso

1. Panel central → **WhatsApp**. Aparece el QR automáticamente.
2. En el móvil: WhatsApp → *Dispositivos vinculados* → *Vincular un dispositivo* → escanear.
3. Se cargan los chats recientes; los nuevos mensajes aparecen solos (refresco cada 3 s).
4. Para cambiar de número: **Cerrar sesión** → se desvincula y sale un QR nuevo para el otro móvil.

Si se cierra la sesión desde el propio móvil, el panel lo detecta y ofrece un QR nuevo.

## Opciones del gateway

| Variable | Por defecto | Para qué sirve |
|---|---|---|
| `WA_GATEWAY_SECRET` | — (obligatoria) | Secreto que debe enviar el panel |
| `PORT` | `8787` | Puerto HTTP |
| `WA_DATA_DIR` | `./data` (`/data` en Docker) | Sesión y chats guardados |
| `WA_INCLUDE_GROUPS` | `false` | Mostrar también grupos |
| `WA_SEND_READ_RECEIPTS` | `true` | Doble check azul al abrir el chat en el panel |
| `WA_MAX_MESSAGES_PER_CHAT` | `300` | Mensajes guardados por chat |
| `WA_LOG_LEVEL` | `warn` | Nivel de logs |

## Limitaciones actuales

- Fotos, audios, vídeos y documentos se muestran como texto descriptivo (📷 Foto, 🎤 Nota de voz…), no se pueden abrir desde el panel; desde el panel se envía solo texto.
- Se cargan los chats recientes que WhatsApp sincroniza al vincular, no todo el historial.
- La versión de Baileys está fijada (`7.0.0-rc14`). Si WhatsApp cambia algo y deja de conectar, suele bastar con actualizarla y redesplegar.

## API interna (solo para el backend del panel)

Todas las rutas requieren `Authorization: Bearer <WA_GATEWAY_SECRET>`.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/sessions/:id/status` | Estado (`idle`, `connecting`, `qr`, `connected`), QR en data-URL y número conectado |
| POST | `/sessions/:id/start` | Inicia la conexión y genera el QR |
| POST | `/sessions/:id/logout` | Cierra sesión, borra los datos y (por defecto) genera un QR nuevo |
| GET | `/sessions/:id/chats` | Bandeja de chats |
| GET | `/sessions/:id/chats/:jid/messages?limit=` | Mensajes de un chat |
| POST | `/sessions/:id/chats/:jid/read` | Marca un chat como leído |
| POST | `/sessions/:id/send` | `{ jid, text }` o `{ phone, text }` |
