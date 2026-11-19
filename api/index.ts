import type { IncomingMessage, ServerResponse } from 'node:http';
import type express from 'express';
import { createApiApp } from '../src/server/app.js';

let cachedApp: express.Express | null = null;
let initError: unknown = null;

try {
  cachedApp = createApiApp();
} catch (err) {
  initError = err;
  console.error('Failed to initialize StudyCheck AI API app:', err);
}

export default function handler(req: IncomingMessage, res: ServerResponse) {
  if (!cachedApp) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const detail =
      initError instanceof Error ? initError.message : String(initError || 'Unknown server initialization error');
    res.end(
      JSON.stringify({
        code: 'API_INIT_FAILED',
        error: `Máy chủ API chưa thể khởi tạo: ${detail}`,
      })
    );
    return;
  }
  return cachedApp(req as unknown as express.Request, res as unknown as express.Response);
}
