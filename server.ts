import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { createApiApp } from './src/server/app.js';

async function startServer() {
  const app = createApiApp();
  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port =
    Number(process.env.DEFAULT_APP_PORT) ||
    (process.env.NODE_ENV === 'production' ? Number(process.env.PORT) || 3000 : 3000);
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`StudyCheck AI server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start StudyCheck AI server:', err);
  process.exit(1);
});
