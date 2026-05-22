FROM node:22-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY tsconfig.json ./

RUN npm install -D tsx typescript && npx tsc

RUN mkdir -p data

ENV DB_PATH=/app/data/perfin.db
ENV PORT=3001

EXPOSE 3001

CMD ["node", "dist/server.js"]
