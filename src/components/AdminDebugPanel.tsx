import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bug,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldAlert,
  Terminal,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  authorizedFetch,
  parseApiResponse,
  type ApiAttemptTraceItem,
  type ApiErrorDebugPayload,
  type ApiProviderHealthItem,
} from '../services/apiClient';
import { CalmDots, CalmProgressBar } from './CalmLoadingIndicator';
import { GlassSurface } from './LiquidGlass/GlassSurface';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';

export interface AdminDebugCapturedError {
  message: string;
  status?: number;
  code?: string;
  technicalDetail?: string;
  debug?: ApiErrorDebugPayload;
  endpoint?: string;
  capturedAt: string;
}

interface AdminDebugSnapshotResponse {
  serverTime: string;
  runtime: {
    nodeVersion: string;
    isVercel: boolean;
    uptimeSec: number;
    configVersion: number;
    aiEnabled: boolean;
  };
  activeModel: string;
  adaptiveLongTextThresholdChars: number;
  configuredProviders: {
    mistral: boolean;
    groq: boolean;
    cloudflare: boolean;
  };
  providerHealth: Record<'mistral' | 'groq' | 'cloudflare', ApiProviderHealthItem>;
  providerSources: {
    mistral: {
      source?: string;
      maskedKey?: string;
      lastTestStatus?: string;
      lastTestMessage?: string;
    };
    groq: {
      source?: string;
      maskedKey?: string;
      lastTestStatus?: string;
      lastTestMessage?: string;
    };
    cloudflare: {
      source?: string;
      maskedKey?: string;
      lastTestStatus?: string;
      lastTestMessage?: string;
    };
  };
  coldStartReadiness?: {
    ready: boolean;
    primaryProvider?: string;
    issues?: string[];
  };
  recentExecutions: Array<{
    executionId: string;
    taskType: string;
    requestedModel?: string;
    actualModel?: string;
    modelId: string;
    usedFallback?: boolean;
    status: string;
    durationMs: number;
    error?: string;
    timestamp: string;
  }>;
}

interface AdminDebugPanelProps {
  mode?: 'inline' | 'full';
  lastError?: AdminDebugCapturedError | null;
  onRetryAfterReset?: () => void;
}

const PROVIDER_LABELS: Record<'mistral' | 'groq' | 'cloudflare', string> = {
  mistral: 'Mistral AI',
  groq: 'Groq Cloud',
  cloudflare: 'Cloudflare Workers AI',
};

function renderHealthStatusBadge(item?: ApiProviderHealthItem) {
  if (!item || !item.configured || item.status === 'unconfigured') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        Chưa cấu hình
      </span>
    );
  }
  if (item.status === 'billing_blocked') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-200">
        <ShieldAlert className="w-3 h-3" />
        Chặn gói 402 ({item.remainingSeconds}s)
      </span>
    );
  }
  if (item.status === 'auth_error') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-200">
        <AlertTriangle className="w-3 h-3" />
        Lỗi khóa ({item.remainingSeconds}s)
      </span>
    );
  }
  if (item.coolingDown) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-200">
        Tạm nghỉ ({item.remainingSeconds}s)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200">
      <CheckCircle2 className="w-3 h-3" />
      Sẵn sàng
    </span>
  );
}

export const AdminDebugPanel: React.FC<AdminDebugPanelProps> = ({
  mode = 'inline',
  lastError = null,
  onRetryAfterReset,
}) => {
  const { isSuperAdmin } = useAuth();
  const [expanded, setExpanded] = useState(mode === 'full');
  const [snapshot, setSnapshot] = useState<AdminDebugSnapshotResponse | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadSnapshot = useCallback(async () => {
    if (!isSuperAdmin) return;
    setLoadingSnapshot(true);
    setFetchError(null);
    try {
      const res = await authorizedFetch('/api/admin/debug/snapshot', {
        method: 'GET',
        timeoutMs: 15_000,
      });
      const data = await parseApiResponse<AdminDebugSnapshotResponse>(
        res,
        'Không tải được bản chẩn đoán hệ thống.'
      );
      setSnapshot(data);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Không tải được dữ liệu debug.');
    } finally {
      setLoadingSnapshot(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    if (mode === 'full') {
      void loadSnapshot();
    }
  }, [isSuperAdmin, mode, loadSnapshot]);

  useEffect(() => {
    if (mode === 'inline' && lastError && isSuperAdmin) {
      setExpanded(true);
      void loadSnapshot();
    }
  }, [lastError, mode, isSuperAdmin, loadSnapshot]);

  const effectiveProviderHealth = useMemo(
    () => snapshot?.providerHealth || lastError?.debug?.providerHealth || null,
    [snapshot, lastError]
  );

  const effectiveExecutions = useMemo(() => {
    if (snapshot?.recentExecutions && snapshot.recentExecutions.length > 0) {
      return snapshot.recentExecutions;
    }
    return lastError?.debug?.recentExecutions || [];
  }, [snapshot, lastError]);

  const attemptTrace: ApiAttemptTraceItem[] = lastError?.debug?.attemptTrace || [];

  const isMistralBillingIssue = Boolean(
    lastError?.code === 'MISTRAL_BILLING_REQUIRED' ||
      lastError?.status === 402 ||
      effectiveProviderHealth?.mistral?.status === 'billing_blocked' ||
      (lastError?.technicalDetail || '').toLowerCase().includes('need a subscription')
  );

  const handleResetProviderHealth = async (
    provider?: 'mistral' | 'groq' | 'cloudflare',
    retryAfter = false
  ) => {
    if (!isSuperAdmin) return;
    setResetting(true);
    setStatusNotice(null);
    setFetchError(null);
    try {
      const res = await authorizedFetch('/api/admin/debug/reset-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, clearCache: true }),
        timeoutMs: 15_000,
      });
      await parseApiResponse(res, 'Không thể đặt lại trạng thái nhà cung cấp.');
      setStatusNotice(
        provider
          ? `Đã xóa trạng thái tạm nghỉ của ${PROVIDER_LABELS[provider]} và làm sạch cache AI.`
          : 'Đã đặt lại trạng thái sức khỏe cho cả 3 nhà cung cấp AI và làm sạch cache.'
      );
      await loadSnapshot();
      if (retryAfter && onRetryAfterReset) {
        onRetryAfterReset();
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Đặt lại trạng thái thất bại.');
    } finally {
      setResetting(false);
    }
  };

  const handleCopyJson = async () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      mode,
      lastError,
      snapshot,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatusNotice('Trình duyệt không cho phép sao chép tự động.');
    }
  };

  // Strictly hidden from all non-Super-Admin accounts
  if (!isSuperAdmin) {
    return null;
  }

  const toggleInline = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !snapshot && !loadingSnapshot) {
      void loadSnapshot();
    }
  };

  return (
    <GlassSurface className="rounded-2xl border border-slate-300/80 dark:border-slate-700/80 overflow-hidden">
      {/* Header Bar */}
      <div className="px-4 py-3 bg-slate-900 text-slate-100 dark:bg-slate-950 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-sky-500/20 border border-sky-400/30 flex items-center justify-center shrink-0">
            <Bug className="w-4 h-4 text-sky-300" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold tracking-wide uppercase text-sky-300">
                Bản Debug Riêng · Super Admin
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                (Học sinh không nhìn thấy bảng này)
              </span>
            </div>
            {lastError && (
              <p className="text-[11px] font-mono text-rose-300 truncate mt-0.5">
                Lỗi gần nhất: HTTP {lastError.status || 'ERR'} · {lastError.code || 'UNKNOWN'}
                {lastError.endpoint ? ` · ${lastError.endpoint}` : ''}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void loadSnapshot()}
            disabled={loadingSnapshot}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-[11px] font-medium border border-slate-700 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{loadingSnapshot ? 'Đang nạp' : 'Làm mới'}</span>
          </button>
          <button
            type="button"
            onClick={() => void handleCopyJson()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-[11px] font-medium border border-slate-700 cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Đã sao chép JSON' : 'Sao chép JSON'}</span>
          </button>
          {mode === 'inline' && (
            <button
              type="button"
              onClick={toggleInline}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold cursor-pointer"
            >
              {expanded ? (
                <>
                  <span>Thu gọn</span>
                  <ChevronUp className="w-3.5 h-3.5" />
                </>
              ) : (
                <>
                  <span>Mở Debug</span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="p-4 sm:p-5 space-y-4 text-xs">
          {loadingSnapshot && (
            <div className="space-y-1.5">
              <CalmProgressBar className="h-1 w-full" label="Đang đồng bộ snapshot debug" />
              <p className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                <span>Đang lấy dữ liệu chẩn đoán trực tiếp từ máy chủ</span>
                <CalmDots className="text-sky-600 dark:text-sky-400" />
              </p>
            </div>
          )}

          {fetchError && (
            <div className="rounded-xl border border-rose-200 dark:border-rose-800/70 bg-rose-50 dark:bg-rose-950/40 px-3.5 py-2.5 text-rose-800 dark:text-rose-200">
              {fetchError}
            </div>
          )}

          {statusNotice && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-2.5 text-emerald-800 dark:text-emerald-200">
              {statusNotice}
            </div>
          )}

          {/* Actionable Mistral 402 Playbook */}
          {isMistralBillingIssue && (
            <div className="rounded-xl border border-amber-300/80 dark:border-amber-700/70 bg-amber-50/90 dark:bg-amber-950/30 p-3.5 space-y-1.5">
              <p className="font-semibold text-amber-950 dark:text-amber-200 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                Nguyên nhân & cách xử lý lỗi Mistral HTTP 402 ("You need a subscription to access this API")
              </p>
              <ul className="list-disc pl-5 space-y-1 text-amber-900 dark:text-amber-200/90 leading-relaxed">
                <li>
                  <strong>Vì sao key miễn phí vẫn báo 402:</strong> Mistral hiện yêu cầu workspace phải{' '}
                  <strong>kích hoạt rõ gói Experiment (Miễn phí)</strong> kèm xác minh số điện thoại tại{' '}
                  <span className="font-mono">console.mistral.ai → Billing / Subscription</span>. Chỉ tạo API key mà chưa chọn gói sẽ bị HTTP 402.
                </li>
                <li>
                  <strong>Tự động chống gián đoạn đã bật:</strong> Ngay khi gặp 402, bộ định tuyến sẽ tự khoanh vùng Mistral 10 phút và chuyển thẳng sang{' '}
                  <strong>Groq Cloud</strong> hoặc <strong>Cloudflare Workers AI</strong> (nếu đã thêm key).
                </li>
                <li>
                  <strong>Sau khi kích hoạt gói Mistral hoặc thêm GROQ_API_KEY:</strong> Bấm nút{' '}
                  <strong>Đặt lại sức khỏe provider</strong> bên dưới để thử lại ngay mà không cần đợi hết 10 phút.
                </li>
              </ul>
            </div>
          )}

          {/* Last Captured Request Error & Raw Technical Detail */}
          {lastError && (
            <div className="rounded-xl border border-rose-200/80 dark:border-rose-800/60 bg-rose-50/60 dark:bg-rose-950/30 p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-rose-900 dark:text-rose-200 inline-flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5" />
                  Chi tiết kỹ thuật lỗi gần nhất
                </span>
                <span className="font-mono text-[11px] text-rose-700 dark:text-rose-300">
                  HTTP {lastError.status ?? 'N/A'} · {lastError.code || 'UNKNOWN'} ·{' '}
                  {new Date(lastError.capturedAt).toLocaleTimeString('vi-VN')}
                </span>
              </div>
              {lastError.technicalDetail && (
                <pre className="p-2.5 rounded-lg bg-slate-950 text-rose-200 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap break-all">
                  {lastError.technicalDetail}
                </pre>
              )}

              {attemptTrace.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    Chuỗi thử nghiệm nhà cung cấp (Attempt Trace — {attemptTrace.length} chặng):
                  </p>
                  <div className="space-y-1">
                    {attemptTrace.map((hop, idx) => (
                      <div
                        key={`${hop.provider}-${hop.modelId}-${idx}`}
                        className="rounded-lg bg-white/80 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 px-2.5 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1 font-mono text-[11px]"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-500">#{idx + 1}</span>
                          <span className="font-semibold text-[#16243E] dark:text-slate-100">
                            {hop.modelId}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300">
                            {hop.errorCode || hop.status}
                          </span>
                        </div>
                        <span className="text-slate-500">{hop.durationMs}ms</span>
                        {hop.error && (
                          <p className="w-full text-[11px] text-rose-700 dark:text-rose-300 break-all">
                            {hop.error}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 3-Provider Live Health & Circuit Breaker Cards */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC] inline-flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                Sức khỏe 3 nhà cung cấp AI & Circuit-Breaker
              </p>
              <div className="flex items-center gap-2">
                <WaterRippleButton
                  size="sm"
                  variant="secondary"
                  disabled={resetting}
                  onClick={() => void handleResetProviderHealth(undefined, Boolean(onRetryAfterReset))}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {onRetryAfterReset ? 'Reset lỗi provider & thử lại' : 'Reset trạng thái & cache AI'}
                </WaterRippleButton>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(['mistral', 'groq', 'cloudflare'] as const).map((providerId) => {
                const health = effectiveProviderHealth?.[providerId];
                const sourceInfo = snapshot?.providerSources?.[providerId];
                return (
                  <div
                    key={providerId}
                    className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white/75 dark:bg-slate-900/60 p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">
                        {PROVIDER_LABELS[providerId]}
                      </span>
                      {renderHealthStatusBadge(health)}
                    </div>
                    {sourceInfo && (
                      <p className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                        Nguồn: <strong>{sourceInfo.source || 'none'}</strong>
                        {' · '}
                        {sourceInfo.maskedKey || 'Chưa có'}
                      </p>
                    )}
                    {health?.lastError && (
                      <p className="font-mono text-[11px] text-rose-700 dark:text-rose-300 break-words bg-rose-50/70 dark:bg-rose-950/40 rounded-lg p-2">
                        {health.lastErrorCode ? `[${health.lastErrorCode}] ` : ''}
                        {health.lastError}
                      </p>
                    )}
                    {health?.coolingDown && (
                      <button
                        type="button"
                        disabled={resetting}
                        onClick={() => void handleResetProviderHealth(providerId, false)}
                        className="text-[11px] font-semibold text-sky-700 dark:text-sky-300 hover:underline cursor-pointer"
                      >
                        Mở khóa {PROVIDER_LABELS[providerId]} ngay
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Runtime Metadata Strip */}
          {snapshot && (
            <div className="rounded-xl bg-slate-100/80 dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-800 px-3.5 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-slate-700 dark:text-slate-300">
              <span>
                Model chính: <strong>{snapshot.activeModel}</strong>
              </span>
              <span>
                Ngưỡng 2-API: <strong>{snapshot.adaptiveLongTextThresholdChars} ký tự</strong>
              </span>
              <span>
                Môi trường: <strong>{snapshot.runtime.isVercel ? 'Vercel Serverless' : 'Node Server'}</strong>
              </span>
              <span>
                Config: <strong>v{snapshot.runtime.configVersion}</strong>
              </span>
              <span>
                Uptime: <strong>{snapshot.runtime.uptimeSec}s</strong>
              </span>
            </div>
          )}

          {/* Cold-Start Readiness Issues */}
          {snapshot?.coldStartReadiness &&
            !snapshot.coldStartReadiness.ready &&
            (snapshot.coldStartReadiness.issues?.length || 0) > 0 && (
              <div className="rounded-xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/70 dark:bg-amber-950/30 p-3 space-y-1">
                <p className="font-semibold text-amber-900 dark:text-amber-200">
                  Cảnh báo sẵn sàng môi trường (Cold-Start Readiness):
                </p>
                <ul className="list-disc pl-5 space-y-0.5 text-amber-900 dark:text-amber-200/90">
                  {snapshot.coldStartReadiness.issues!.map((issue, idx) => (
                    <li key={idx}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}

          {/* Recent AI Execution Trace */}
          <div className="space-y-2">
            <p className="font-semibold text-[#16243E] dark:text-[#E6EFFC]">
              Nhật ký thực thi AI gần nhất ({effectiveExecutions.length})
            </p>
            {effectiveExecutions.length === 0 ? (
              <p className="text-slate-500 dark:text-slate-400 italic">
                Chưa có lượt gọi AI nào được ghi nhận trong phiên máy chủ hiện tại.
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200/80 dark:border-slate-800 divide-y divide-slate-200/60 dark:divide-slate-800 bg-white/75 dark:bg-slate-900/50">
                {effectiveExecutions.map((row) => (
                  <div
                    key={row.executionId}
                    className="px-3 py-2 font-mono text-[11px] flex flex-col gap-1"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={
                            row.status === 'success'
                              ? 'px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 font-semibold'
                              : 'px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 font-semibold'
                          }
                        >
                          {row.status}
                        </span>
                        <span className="font-semibold text-[#16243E] dark:text-slate-100">
                          {row.taskType}
                        </span>
                        <span className="text-slate-600 dark:text-slate-300">
                          {row.requestedModel && row.actualModel && row.requestedModel !== row.actualModel
                            ? `${row.requestedModel} → ${row.actualModel}`
                            : row.actualModel || row.modelId}
                        </span>
                        {row.usedFallback && (
                          <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
                            fallback
                          </span>
                        )}
                      </div>
                      <span className="text-slate-500">
                        {row.durationMs}ms · {new Date(row.timestamp).toLocaleTimeString('vi-VN')}
                      </span>
                    </div>
                    {row.error && (
                      <p className="text-rose-700 dark:text-rose-300 break-all">{row.error}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </GlassSurface>
  );
};
