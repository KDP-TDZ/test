import type { IncomingMessage, ServerResponse } from 'node:http';
import type express from 'express';
import { createApiApp } from './app.js';

let cachedApp: express.Express | null = null;
let initError: unknown = null;

function getOrInitApp(): express.Express | null {
  if (cachedApp || initError) {
    return cachedApp;
  }
  try {
    cachedApp = createApiApp();
  } catch (err) {
    initError = err;
    console.error('Failed to initialize StudyCheck AI API app:', err);
  }
  return cachedApp;
}

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  const app = getOrInitApp();
  if (!app) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const detail =
      initError instanceof Error
        ? initError.message
        : String(initError || 'Unknown server initialization error');
    res.end(
      JSON.stringify({
        code: 'API_INIT_FAILED',
        error: `Máy chủ API chưa thể khởi tạo: ${detail}`,
      })
    );
    return;
  }

  try {
    app(req as unknown as express.Request, res as unknown as express.Response);
  } catch (err) {
    console.error('Unhandled StudyCheck AI serverless invocation error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          code: 'API_INVOCATION_ERROR',
          error: err instanceof Error ? err.message : 'Lỗi thực thi máy chủ API.',
        })
      );
    }
  }
}
