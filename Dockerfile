FROM oven/bun:latest AS base
WORKDIR /usr/src/app

FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --production

FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .
RUN bun run build

FROM base AS release
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

COPY --from=install /temp/prod/node_modules node_modules
COPY --from=prerelease /usr/src/app/src ./src
COPY --from=prerelease /usr/src/app/scripts ./scripts
COPY --from=prerelease /usr/src/app/static ./static
COPY --from=prerelease /usr/src/app/build ./build
COPY --from=prerelease /usr/src/app/package.json .
COPY --from=prerelease /usr/src/app/tsconfig.json .
COPY --from=prerelease /usr/src/app/svelte.config.js .
COPY --from=prerelease /usr/src/app/vite.config.ts .
COPY --from=prerelease /usr/src/app/logger.json .

RUN mkdir -p /usr/src/app/logs && chown bun:bun /usr/src/app/logs
RUN mkdir -p /usr/src/app/cache && chown bun:bun /usr/src/app/cache

USER bun
WORKDIR /usr/src/app

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
	CMD bun -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT [ "bun", "run" ]
CMD [ "start" ]
