FROM oven/bun:1.4.2

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src

RUN mkdir -p /data && chown -R 1000:1000 /app /data

ENV DB_PATH=/data/dailypoker.db
USER 1000:1000

CMD ["bun", "run", "src/index.ts"]
