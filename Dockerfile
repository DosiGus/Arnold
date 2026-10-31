FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# Privacy notice, terms and support, served as /datenschutz, /bedingungen, /support.
COPY --from=build --chown=node:node /app/public ./public
RUN mkdir -p data && chown node:node data
USER node
EXPOSE 8787
CMD ["node", "dist/server/main.js"]
