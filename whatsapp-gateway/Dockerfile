FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    WA_DATA_DIR=/data \
    PORT=8787
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.mjs store.mjs ./
# La sesión de WhatsApp y los chats se guardan aquí: monta un volumen persistente.
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "server.mjs"]
