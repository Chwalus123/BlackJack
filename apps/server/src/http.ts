import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import type { Config } from './config';

export interface Health {
  ok: boolean;
  rooms: number;
  connections: number;
  uptimeS: number;
  rssMB: number;
}

export async function buildHttp(cfg: Config, health: () => Health): Promise<FastifyInstance> {
  const app = Fastify({
    logger: cfg.LOG_LEVEL === 'silent' ? false : { level: cfg.LOG_LEVEL },
    trustProxy: cfg.trustProxy,
    bodyLimit: 16 * 1024,
    disableRequestLogging: true,
  });
  app.get('/healthz', async (_req, reply) => {
    const h = health();
    reply.header('cache-control', 'no-store');
    return reply.code(h.ok ? 200 : 503).send(h);
  });
  if (fs.existsSync(cfg.staticDir)) {
    await app.register(fastifyStatic, {
      root: cfg.staticDir,
      prefix: '/',
      wildcard: false,
      index: ['index.html'],
      setHeaders(res, filePath) {
        if (filePath.includes('/assets/')) res.header('cache-control', 'public, max-age=31536000, immutable');
        else res.header('cache-control', 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/socket.io')) return reply.type('text/html').sendFile('index.html');
      return reply.code(404).send({ error: 'not found' });
    });
  } else {
    app.log.warn({ dir: cfg.staticDir }, 'client build not found — serving API only');
  }
  return app;
}
