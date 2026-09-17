FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json ./
COPY --chown=node:node src/ ./src/

RUN mkdir data && chown node:node data

USER node
CMD ["node", "src/index.js"]
