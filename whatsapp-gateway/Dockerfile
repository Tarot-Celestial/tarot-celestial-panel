FROM node:22-slim
WORKDIR /app/whatsapp-gateway
ENV NODE_ENV=production \
    WA_DATA_DIR=/data \
    PORT=8787 \
    HOST=0.0.0.0
# Build from the repository root: docker build -f whatsapp-gateway/Dockerfile .
COPY whatsapp-gateway/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY whatsapp-gateway/server.mjs whatsapp-gateway/store.mjs whatsapp-gateway/captacion-journal.mjs whatsapp-gateway/captacion-sender.mjs ./
COPY public/images/captacion/tarot-celestial-beneficios-v1.png /app/public/images/captacion/tarot-celestial-beneficios-v1.png
# La sesión de WhatsApp y los chats se guardan aquí: monta un volumen persistente.
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "server.mjs"]
