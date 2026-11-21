import type { AiExecutionLog } from '../core/types';

export type DebugLogCategory = 'api' | 'ai_pipeline' | 'firestore' | 'runtime';

export interface ServerErrorDebugPayload {
  activeModel?: string;
  configuredProviders?: {
    groq: boolean;
    gemini: boolean;
    cloudflare: boolean;
  };
  recentExecutions?: AiExecutionLog[];
  timestamp?: string;
}

export interface AdminDebugLogEntry {
  id: string;
  timestamp: string;
  category: DebugLogCategory;
  level: 'info' | 'warn' | 'error';
  method?: string;
  endpoint: string;
  status?: number;
  durationMs?: number;
  errorCode?: string;
  summary: string;
  technicalDetail?: string;
  requestPreview?: string;
  responsePreview?: string;
  serverDebug?: ServerErrorDebugPayload;
}

const MAX_DEBUG_LOGS = 80;
let entries: AdminDebugLogEntry[] = [];
const listeners = new Set<() => void>();
let globalListenersAttached = false;

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Ignore listener error
    }
  }
}

export function recordAdminDebugLog(
  input: Omit<AdminDebugLogEntry, 'id' | 'timestamp'> & { timestamp?: string }
): void {
  const entry: AdminDebugLogEntry = {
    ...input,
    id: `dbg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: input.timestamp || new Date().toISOString(),
  };
  entries = [entry, ...entries].slice(0, MAX_DEBUG_LOGS);
  notifyListeners();
}

export function getAdminDebugLogs(): AdminDebugLogEntry[] {
  return entries;
}

export function clearAdminDebugLogs(): void {
  entries = [];
  notifyListeners();
}

export function subscribeAdminDebugLogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function attachGlobalRuntimeDebugListeners(): void {
  if (globalListenersAttached || typeof window === 'undefined') return;
  globalListenersAttached = true;

  window.addEventListener('error', (event) => {
    const msg = event.error instanceof Error ? event.error.message : event.message || 'Unhandled window error';
    recordAdminDebugLog({
      category: 'runtime',
      level: 'error',
      endpoint: event.filename ? `${event.filename}:${event.lineno || 0}` : 'window.onerror',
      errorCode: 'CLIENT_RUNTIME_ERROR',
      summary: msg.slice(0, 220),
      technicalDetail: event.error instanceof Error ? event.error.stack || msg : msg,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg = reason instanceof Error ? reason.message : String(reason || 'Unhandled Promise Rejection');
    recordAdminDebugLog({
      category: 'runtime',
      level: 'error',
      endpoint: 'window.onunhandledrejection',
      errorCode: 'UNHANDLED_PROMISE_REJECTION',
      summary: msg.slice(0, 220),
      technicalDetail: reason instanceof Error ? reason.stack || msg : msg,
    });
  });
}
