FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
RUN install -d -m 0700 -o node -g node /data
COPY --from=build /app/dist ./dist
COPY server ./server
RUN chmod -R a+rX /app/dist /app/server
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 FOLIO_DB=/data/folio.sqlite
EXPOSE 3000
CMD ["node", "server/index.mjs"]
