import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  BookOpen,
  CheckCircle2,
  FileUp,
  Globe,
  KeyRound,
  Loader2,
  PauseCircle,
  PlayCircle,
  Power,
  RefreshCw,
  ScrollText,
  Shield,
  Sliders,
  Trash2,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  SUBJECT_LABELS,
  type ApiUsageDaily,
  type AuditLogEntry,
  type GradeLevel,
  type RateLimitConfig,
  type ReferenceBook,
  type SingleApiKeyStatus,
  type SubjectId,
  type SystemAiConfig,
  type UserProfile,
} from '../core/types';
import { authorizedFetch } from '../services/apiClient';
import {
  deleteReferenceBookAndChunks,
  listAllUsersForAdmin,
  listReferenceBooks,
  saveReferenceBookWithChunks,
  updateReferenceBookStatus,
} from '../services/firestoreService';
import { GlassSurface } from './LiquidGlass/GlassSurface';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';

type AdminTab =
  | 'overview'
  | 'ai_switch'
  | 'api_keys'
  | 'usage'
  | 'references'
  | 'users'
  | 'limits'
  | 'audit';

export const AdminControlCenter: React.FC = () => {
  const { isSuperAdmin, refreshSystemStatus } = useAuth();
  const [tab, setTab] = useState<AdminTab>('overview');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [config, setConfig] = useState<SystemAiConfig | null>(null);
  const [usageStats, setUsageStats] = useState<{
    today: ApiUsageDaily;
    dailySeries: ApiUsageDaily[];
    perUserToday: Array<{ uid: string; email: string; requests: number; analyses: number; blocked: number; tokens: number }>;
  } | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [singleKeyStatus, setSingleKeyStatus] = useState<SingleApiKeyStatus | null>(null);
  const [books, setBooks] = useState<ReferenceBook[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);

  // AI Service Switch form
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [disabledReason, setDisabledReason] = useState('');
  const [activeModel, setActiveModel] = useState('gemini-4-hydrogen');
  const [savingConfig, setSavingConfig] = useState(false);

  // Rate Limits form
  const [limits, setLimits] = useState<RateLimitConfig>({
    requestsPerMinute: 12,
    requestsPerHour: 100,
    analysesPerDay: 25,
    cooldownSeconds: 4,
    maximumConcurrentJobs: 2,
    maximumPagesPerAnalysis: 25,
    maximumFileSizeMb: 20,
  });

  // Single API Key form
  const [newKeyLabel, setNewKeyLabel] = useState('Gemini API Key dùng chung');
  const [newRawKey, setNewRawKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; message: string; testedSource: string } | null>(null);

  // Reference Library Ingest form
  const [refTitle, setRefTitle] = useState('');
  const [refGrade, setRefGrade] = useState<GradeLevel>('10');
  const [refSubject, setRefSubject] = useState<SubjectId>('hoa_hoc');
  const [refSeries, setRefSeries] = useState('Kết nối tri thức với cuộc sống');
  const [refPublisher, setRefPublisher] = useState('NXB Giáo dục Việt Nam');
  const [refYear, setRefYear] = useState('2024');
  const [refDesc, setRefDesc] = useState('');
  const [refSourceType, setRefSourceType] = useState<'url' | 'upload'>('upload');
  const [refUrl, setRefUrl] = useState('');
  const [refPdfFile, setRefPdfFile] = useState<File | null>(null);
  const [ingestingRef, setIngestingRef] = useState(false);

  const loadAllAdminData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewRes, refList, userList] = await Promise.all([
        authorizedFetch('/api/admin/overview'),
        listReferenceBooks(false),
        listAllUsersForAdmin(),
      ]);

      if (!overviewRes.ok) {
        const body = await overviewRes.json().catch(() => ({}));
        throw new Error(body.error || 'Không thể tải dữ liệu Super Admin từ máy chủ.');
      }

      const data = await overviewRes.json();
      setConfig(data.config);
      setMaintenanceMessage(data.config?.maintenanceMessage || '');
      setDisabledReason(data.config?.disabledReason || '');
      setActiveModel(data.config?.activeModel || 'gemini-4-hydrogen');
      if (data.config?.rateLimitConfig) setLimits(data.config.rateLimitConfig);
      setUsageStats(data.usageStats);
      setAuditLogs(data.auditLogs || []);
      setSingleKeyStatus(data.singleKeyStatus || null);
      setBooks(refList);
      setUsers(userList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi tải khu vực quản trị.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isSuperAdmin) {
      loadAllAdminData();
    }
  }, [isSuperAdmin]);

  if (!isSuperAdmin) {
    return (
      <GlassSurface className="rounded-3xl p-8 text-center">
        <Shield className="w-10 h-10 text-rose-600 mx-auto mb-3" />
        <h1 className="font-display text-xl font-bold text-slate-950">
          Không có quyền truy cập khu vực quản trị
        </h1>
        <p className="text-xs text-slate-600 mt-1">
          Chỉ tài khoản Super Admin được xác thực mới có thể truy cập bảng điều khiển hệ thống.
        </p>
      </GlassSurface>
    );
  }

  const handlePatchAiConfig = async (patch: Partial<SystemAiConfig>) => {
    setSavingConfig(true);
    setError(null);
    setNotice(null);
    try {
      const res = await authorizedFetch('/api/admin/ai-service', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Không thể cập nhật cấu hình.');
      setConfig(data.config);
      await refreshSystemStatus();
      setNotice('Đã cập nhật cấu hình hệ thống trên máy chủ.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi cập nhật cấu hình.');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSaveSingleKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingKey(true);
    setError(null);
    setNotice(null);
    try {
      const res = await authorizedFetch('/api/admin/key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newKeyLabel, apiKey: newRawKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Không thể lưu API key.');
        return;
      }
      setSingleKeyStatus(data.singleKeyStatus);
      setNewRawKey('');
      setTestResult(null);
      setNotice(
        `Đã lưu API key duy nhất (${data.singleKeyStatus.maskedKey}). Key này được mã hóa trên máy chủ và dùng cho mọi tác vụ AI.`
      );
      await loadAllAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi lưu API key.');
    } finally {
      setSavingKey(false);
    }
  };

  const handleTestKey = async (rawKeyOverride?: string) => {
    setTestingKey(true);
    setError(null);
    try {
      const res = await authorizedFetch('/api/admin/key/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rawKeyOverride ? { apiKey: rawKeyOverride } : {}),
      });
      const data = await res.json();
      setTestResult(data);
      if (data.keyStatus) {
        setSingleKeyStatus(data.keyStatus);
      }
      await loadAllAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi kiểm tra API key.');
    } finally {
      setTestingKey(false);
    }
  };

  const handleClearAdminKey = async () => {
    setError(null);
    setNotice(null);
    try {
      const res = await authorizedFetch('/api/admin/key', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Không thể xóa API key quản trị.');
        return;
      }
      setSingleKeyStatus(data.singleKeyStatus);
      setTestResult(null);
      setNotice('Đã xóa API key cấu hình trong Admin UI.');
      await loadAllAdminData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi xóa API key.');
    }
  };

  const handleIngestReference = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setIngestingRef(true);

    const referenceId = `ref_${refSubject}_${refGrade}_${Date.now()}`;
    try {
      let ingestResult: { chunks: any[]; chapters: string[]; extractedSummary: string };
      let storagePath = '';

      if (refSourceType === 'url') {
        const res = await authorizedFetch('/api/admin/references/ingest-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: refUrl,
            referenceId,
            grade: refGrade,
            subject: refSubject,
            textbookSeries: refSeries,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Không thể lập chỉ mục từ URL.');
        ingestResult = data;
      } else {
        if (!refPdfFile) throw new Error('Vui lòng chọn tệp PDF sách giáo khoa.');

        const formData = new FormData();
        formData.append('file', refPdfFile);
        formData.append('referenceId', referenceId);
        formData.append('grade', refGrade);
        formData.append('subject', refSubject);
        formData.append('textbookSeries', refSeries);

        const res = await authorizedFetch('/api/admin/references/ingest-pdf', {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Không thể trích xuất và lập chỉ mục PDF.');
        ingestResult = data;
      }

      const now = new Date().toISOString();
      const newBook: ReferenceBook = {
        referenceId,
        title: refTitle.trim(),
        grade: refGrade,
        subject: refSubject,
        textbookSeries: refSeries.trim(),
        publisher: refPublisher.trim(),
        editionYear: refYear.trim(),
        description: refDesc.trim(),
        sourceType: refSourceType,
        ...(refSourceType === 'url' ? { sourceUrl: refUrl.trim() } : {}),
        ...(storagePath ? { storagePath } : {}),
        chapters: ingestResult.chapters || [],
        chunkCount: (ingestResult.chunks || []).length,
        status: 'active',
        indexStatus: 'indexed',
        createdAt: now,
        updatedAt: now,
      };

      await saveReferenceBookWithChunks(newBook, ingestResult.chunks || []);
      setBooks((prev) => [newBook, ...prev]);
      setRefTitle('');
      setRefDesc('');
      setRefUrl('');
      setRefPdfFile(null);
      setNotice(`Đã thêm sách “${newBook.title}” — ${ingestResult.extractedSummary}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi thêm sách giáo khoa.');
    } finally {
      setIngestingRef(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-sky-700">Khu vực quản trị tối cao (Super Admin)</p>
          <h1 className="font-display text-2xl font-bold text-slate-950">
            Trung tâm điều khiển StudyCheck AI
          </h1>
        </div>
        <WaterRippleButton variant="secondary" size="sm" onClick={loadAllAdminData}>
          <RefreshCw className="w-3.5 h-3.5" />
          Làm mới dữ liệu
        </WaterRippleButton>
      </div>

      {/* Sub-navigation */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['overview', 'Tổng quan', Activity],
            ['ai_switch', 'Công tắc AI', Power],
            ['api_keys', 'API Key duy nhất', KeyRound],
            ['usage', 'Thống kê API', ScrollText],
            ['references', 'Thư viện sách chuẩn', BookOpen],
            ['users', 'Người dùng', Users],
            ['limits', 'Giới hạn & Chống lạm dụng', Sliders],
            ['audit', 'Nhật ký kiểm toán', Shield],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border cursor-pointer transition-colors ${
              tab === id
                ? 'bg-sky-600 text-white border-sky-600'
                : 'bg-white/85 text-slate-700 border-slate-200 hover:bg-white'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span>{notice}</span>
        </div>
      )}

      {loading ? (
        <GlassSurface className="rounded-2xl p-10 text-center">
          <Loader2 className="w-8 h-8 text-sky-600 animate-spin mx-auto" />
        </GlassSurface>
      ) : (
        <>
          {/* OVERVIEW */}
          {tab === 'overview' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <GlassSurface className="rounded-2xl p-5">
                <p className="text-xs text-slate-500">Trạng thái dịch vụ AI</p>
                <p
                  className={`font-display text-xl font-bold mt-1 ${
                    config?.enabled ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {config?.enabled ? 'ĐANG HOẠT ĐỘNG' : 'ĐÃ TẠM NGỪNG'}
                </p>
                <p className="font-mono text-[11px] text-slate-500 mt-1">{config?.activeModel}</p>
              </GlassSurface>

              <GlassSurface className="rounded-2xl p-5">
                <p className="text-xs text-slate-500">Yêu cầu AI hôm nay</p>
                <p className="font-mono text-2xl font-bold text-slate-950 tabular-nums mt-1">
                  {usageStats?.today.requestCount ?? 0}
                </p>
                <p className="text-xs text-slate-600 mt-1">
                  Thành công: {usageStats?.today.successfulCount ?? 0} · Bị chặn:{' '}
                  {usageStats?.today.blockedCount ?? 0}
                </p>
              </GlassSurface>

              <GlassSurface className="rounded-2xl p-5">
                <p className="text-xs text-slate-500">Token Gemini thực tế hôm nay</p>
                <p className="font-mono text-2xl font-bold text-sky-700 tabular-nums mt-1">
                  {(usageStats?.today.actualTotalTokens ?? 0).toLocaleString('vi-VN')}
                </p>
                <p className="text-xs text-slate-600 mt-1">Theo usageMetadata từ Gemini</p>
              </GlassSurface>

              <GlassSurface className="rounded-2xl p-5">
                <p className="text-xs text-slate-500">Sách giáo khoa & Người dùng</p>
                <p className="font-mono text-2xl font-bold text-slate-950 tabular-nums mt-1">
                  {books.length} / {users.length}
                </p>
                <p className="text-xs text-slate-600 mt-1">Sách chuẩn / Tài khoản đã đồng bộ</p>
              </GlassSurface>
            </div>
          )}

          {/* GLOBAL AI SWITCH */}
          {tab === 'ai_switch' && config && (
            <GlassSurface className="rounded-3xl p-6 sm:p-8 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200/80">
                <div>
                  <h2 className="font-display text-lg font-bold text-slate-950">
                    Công tắc dịch vụ AI toàn hệ thống
                  </h2>
                  <p className="text-xs text-slate-600 mt-1">
                    Khi tắt AI, mọi endpoint OCR, phân tích và tạo câu hỏi mới đều bị chặn ở backend
                    (HTTP 503), trong khi học sinh vẫn xem được lịch sử, bài đã lưu và Ngân hàng luyện
                    tập bình thường.
                  </p>
                </div>

                <WaterRippleButton
                  variant={config.enabled ? 'danger' : 'primary'}
                  disabled={savingConfig}
                  onClick={() =>
                    handlePatchAiConfig({
                      enabled: !config.enabled,
                      maintenanceMessage,
                      disabledReason,
                      activeModel,
                    })
                  }
                >
                  <Power className="w-4 h-4" />
                  {config.enabled ? 'Tắt xử lý AI khẩn cấp' : 'Kích hoạt lại dịch vụ AI'}
                </WaterRippleButton>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Thông báo bảo trì hiển thị cho học sinh
                  </label>
                  <textarea
                    rows={3}
                    value={maintenanceMessage}
                    onChange={(e) => setMaintenanceMessage(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-xs"
                  />
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Lý do nội bộ (Audit Log)
                    </label>
                    <input
                      type="text"
                      value={disabledReason}
                      onChange={(e) => setDisabledReason(e.target.value)}
                      placeholder="Ví dụ: Bảo trì định kỳ / Chuyển đổi API key"
                      className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Model Gemini dùng chung (gợi ý các model hỗ trợ API miễn phí)
                    </label>
                    <select
                      value={activeModel}
                      onChange={(e) => setActiveModel(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl bg-white border border-slate-200 font-mono text-xs"
                    >
                      <option value="gemini-4-hydrogen">gemini-4-hydrogen (Mặc định Free Tier)</option>
                      <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Nhẹ, hạn mức cao Free Tier)</option>
                    </select>
                  </div>
                </div>
              </div>

              <WaterRippleButton
                disabled={savingConfig}
                onClick={() =>
                  handlePatchAiConfig({
                    maintenanceMessage,
                    disabledReason,
                    activeModel,
                  })
                }
              >
                Lưu nội dung thông báo & Model
              </WaterRippleButton>
            </GlassSurface>
          )}

          {/* SINGLE API KEY FOR ALL TASKS */}
          {tab === 'api_keys' && (
            <div className="space-y-6">
              <GlassSurface className="rounded-2xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-base font-bold text-slate-950">
                      API Key Gemini dùng chung cho toàn bộ tác vụ
                    </h2>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Sử dụng <strong>1 API key duy nhất</strong> cho tất cả chức năng: OCR, nhận diện môn
                      học, kiểm định + Google Search Grounding và tạo bộ câu hỏi trắc nghiệm. Không cần bật
                      Secret Manager hay Billing Account.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <WaterRippleButton
                      size="sm"
                      variant="secondary"
                      disabled={testingKey || !singleKeyStatus?.configured}
                      onClick={() => handleTestKey()}
                    >
                      {testingKey ? 'Đang kiểm tra...' : 'TEST API KEY ĐANG DÙNG'}
                    </WaterRippleButton>
                    {singleKeyStatus?.source === 'admin' && (
                      <button
                        type="button"
                        onClick={handleClearAdminKey}
                        className="px-3 py-1.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-semibold hover:bg-rose-100 cursor-pointer"
                      >
                        Gỡ key Admin
                      </button>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white/90 p-4 text-xs grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-slate-500">Trạng thái hiện tại</p>
                    <p
                      className={`font-semibold mt-0.5 ${
                        singleKeyStatus?.configured ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {singleKeyStatus?.configured
                        ? singleKeyStatus.source === 'admin'
                          ? 'Đang dùng Key của Quản trị viên'
                          : 'Đang dùng biến GEMINI_API_KEY của máy chủ'
                        : 'Chưa có API Key nào'}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Mã nhận diện (đã che)</p>
                    <p className="font-mono font-semibold text-slate-900 mt-0.5">
                      {singleKeyStatus?.maskedKey || '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Kiểm tra gần nhất</p>
                    <p className="font-semibold text-slate-900 mt-0.5">
                      {singleKeyStatus?.lastTestStatus || 'Untested'}
                    </p>
                  </div>
                </div>

                {testResult && (
                  <div
                    className={`rounded-xl border p-3.5 text-xs ${
                      testResult.status === 'Connected'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-rose-50 border-rose-200 text-rose-900'
                    }`}
                  >
                    <strong>Kết quả kiểm tra ({testResult.status}):</strong> {testResult.message}
                  </div>
                )}
              </GlassSurface>

              <GlassSurface className="rounded-2xl p-6 space-y-4">
                <div>
                  <h3 className="font-display text-base font-bold text-slate-950">
                    Cập nhật / Thay thế Gemini API Key duy nhất
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Key được mã hóa AES-256-GCM ở backend trước khi lưu bản sao dự phòng (tuyệt đối không gửi
                    ngược khóa thô xuống trình duyệt).
                  </p>
                </div>

                <form onSubmit={handleSaveSingleKey} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Tên gợi nhớ (tùy chọn)
                      </label>
                      <input
                        type="text"
                        value={newKeyLabel}
                        onChange={(e) => setNewKeyLabel(e.target.value)}
                        placeholder="Ví dụ: Gemini Key Production"
                        className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Gemini API Key
                      </label>
                      <input
                        type="password"
                        required
                        value={newRawKey}
                        onChange={(e) => setNewRawKey(e.target.value)}
                        placeholder="Dán API key vào đây (ví dụ AIza...)"
                        className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 font-mono text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <WaterRippleButton type="submit" disabled={savingKey}>
                      {savingKey ? 'Đang lưu...' : 'Lưu & Áp dụng cho toàn hệ thống'}
                    </WaterRippleButton>
                    <button
                      type="button"
                      disabled={testingKey || !newRawKey.trim()}
                      onClick={() => handleTestKey(newRawKey)}
                      className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-45 cursor-pointer"
                    >
                      Thử nghiệm key đang nhập
                    </button>
                  </div>
                </form>
              </GlassSurface>
            </div>
          )}

          {/* API USAGE DASHBOARD */}
          {tab === 'usage' && usageStats && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <GlassSurface className="rounded-2xl p-5">
                  <p className="text-xs text-slate-500">Tổng yêu cầu hôm nay</p>
                  <p className="font-mono text-2xl font-bold text-slate-950 mt-1">
                    {usageStats.today.requestCount}
                  </p>
                  <p className="text-xs text-slate-600 mt-1">
                    OCR: {usageStats.today.ocrCount} · Phân tích: {usageStats.today.analysisCount} ·
                    Quiz: {usageStats.today.quizGenerationCount}
                  </p>
                </GlassSurface>
                <GlassSurface className="rounded-2xl p-5">
                  <p className="text-xs text-slate-500">Prompt / Candidate Tokens (Thực tế)</p>
                  <p className="font-mono text-xl font-bold text-sky-700 mt-1">
                    {usageStats.today.actualPromptTokens.toLocaleString('vi-VN')} /{' '}
                    {usageStats.today.actualCandidateTokens.toLocaleString('vi-VN')}
                  </p>
                  <p className="text-xs text-slate-600 mt-1">Từ usageMetadata của Gemini</p>
                </GlassSurface>
                <GlassSurface className="rounded-2xl p-5">
                  <p className="text-xs text-slate-500">Lượt Web Grounding</p>
                  <p className="font-mono text-2xl font-bold text-indigo-700 mt-1">
                    {usageStats.today.webGroundedCount}
                  </p>
                </GlassSurface>
                <GlassSurface className="rounded-2xl p-5">
                  <p className="text-xs text-slate-500">Sự kiện giới hạn / lỗi</p>
                  <p className="font-mono text-2xl font-bold text-rose-700 mt-1">
                    {usageStats.today.quotaExceededEvents + usageStats.today.providerErrorEvents}
                  </p>
                  <p className="text-xs text-slate-600 mt-1">
                    429/Quota: {usageStats.today.quotaExceededEvents} · Provider:{' '}
                    {usageStats.today.providerErrorEvents}
                  </p>
                </GlassSurface>
              </div>

              <GlassSurface className="rounded-2xl p-6 space-y-4">
                <h2 className="font-display text-base font-bold text-slate-950">
                  Lịch sử sử dụng theo ngày
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2 pr-4">Ngày</th>
                        <th className="py-2 pr-4">Tổng Req</th>
                        <th className="py-2 pr-4">Thành công</th>
                        <th className="py-2 pr-4">Bị chặn</th>
                        <th className="py-2 pr-4">Token thực tế</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {usageStats.dailySeries.map((d) => (
                        <tr key={d.date}>
                          <td className="py-2 pr-4">{d.date}</td>
                          <td className="py-2 pr-4">{d.requestCount}</td>
                          <td className="py-2 pr-4 text-emerald-700">{d.successfulCount}</td>
                          <td className="py-2 pr-4 text-rose-700">{d.blockedCount}</td>
                          <td className="py-2 pr-4">{d.actualTotalTokens.toLocaleString('vi-VN')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </GlassSurface>
            </div>
          )}

          {/* REFERENCE LIBRARY */}
          {tab === 'references' && (
            <div className="space-y-6">
              <GlassSurface className="rounded-3xl p-6 space-y-5">
                <h2 className="font-display text-lg font-bold text-slate-950">
                  Thêm Sách giáo khoa / Tài liệu tham chiếu chuẩn
                </h2>

                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setRefSourceType('upload')}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-semibold border cursor-pointer ${
                      refSourceType === 'upload'
                        ? 'bg-sky-600 text-white border-sky-600'
                        : 'bg-white text-slate-700 border-slate-200'
                    }`}
                  >
                    <FileUp className="w-3.5 h-3.5" />
                    Tải PDF lên
                  </button>
                  <button
                    type="button"
                    onClick={() => setRefSourceType('url')}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-semibold border cursor-pointer ${
                      refSourceType === 'url'
                        ? 'bg-sky-600 text-white border-sky-600'
                        : 'bg-white text-slate-700 border-slate-200'
                    }`}
                  >
                    <Globe className="w-3.5 h-3.5" />
                    Nhập URL HTTPS công khai
                  </button>
                </div>

                <form onSubmit={handleIngestReference} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Tên sách</label>
                      <input
                        type="text"
                        required
                        value={refTitle}
                        onChange={(e) => setRefTitle(e.target.value)}
                        placeholder="Ví dụ: Hóa học 10 - Kết nối tri thức"
                        className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Khối lớp</label>
                      <select
                        value={refGrade}
                        onChange={(e) => setRefGrade(e.target.value as GradeLevel)}
                        className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs"
                      >
                        <option value="10">Lớp 10</option>
                        <option value="11">Lớp 11</option>
                        <option value="12">Lớp 12</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Môn học</label>
                      <select
                        value={refSubject}
                        onChange={(e) => setRefSubject(e.target.value as SubjectId)}
                        className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs"
                      >
                        {(Object.keys(SUBJECT_LABELS) as SubjectId[]).map((s) => (
                          <option key={s} value={s}>
                            {SUBJECT_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Bộ sách</label>
                      <input
                        type="text"
                        required
                        value={refSeries}
                        onChange={(e) => setRefSeries(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Nhà xuất bản</label>
                      <input
                        type="text"
                        value={refPublisher}
                        onChange={(e) => setRefPublisher(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Năm xuất bản</label>
                      <input
                        type="text"
                        value={refYear}
                        onChange={(e) => setRefYear(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs"
                      />
                    </div>
                  </div>

                  {refSourceType === 'url' ? (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        URL HTTPS tài liệu (hệ thống tự chặn IP nội bộ / SSRF)
                      </label>
                      <input
                        type="url"
                        required
                        value={refUrl}
                        onChange={(e) => setRefUrl(e.target.value)}
                        placeholder="https://example.edu.vn/sgk-hoa-10.pdf"
                        className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Chọn tệp PDF sách giáo khoa có lớp văn bản
                      </label>
                      <input
                        type="file"
                        accept="application/pdf"
                        required
                        onChange={(e) => setRefPdfFile(e.target.files?.[0] || null)}
                        className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs"
                      />
                    </div>
                  )}

                  <WaterRippleButton type="submit" disabled={ingestingRef}>
                    {ingestingRef ? 'Đang trích xuất & lập chỉ mục...' : 'Lập chỉ mục & Lưu sách chuẩn'}
                  </WaterRippleButton>
                </form>
              </GlassSurface>

              <div className="space-y-3">
                {books.map((book) => (
                  <GlassSurface
                    key={book.referenceId}
                    className="rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <p className="text-sm font-bold text-slate-950">{book.title}</p>
                      <p className="text-slate-600 mt-0.5">
                        {SUBJECT_LABELS[book.subject]} · Lớp {book.grade} · {book.textbookSeries} ·{' '}
                        <span className="font-mono">{book.chunkCount} đoạn</span> ·{' '}
                        {book.chapters.length} chương
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={async () => {
                          const next = book.status === 'active' ? 'paused' : 'active';
                          await updateReferenceBookStatus(book.referenceId, { status: next });
                          setBooks((prev) =>
                            prev.map((b) =>
                              b.referenceId === book.referenceId ? { ...b, status: next } : b
                            )
                          );
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white cursor-pointer"
                      >
                        {book.status === 'active' ? (
                          <>
                            <PauseCircle className="w-3.5 h-3.5 text-amber-600" />
                            Đang dùng (Tạm dừng)
                          </>
                        ) : (
                          <>
                            <PlayCircle className="w-3.5 h-3.5 text-emerald-600" />
                            Đang tạm dừng (Kích hoạt)
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await deleteReferenceBookAndChunks(book.referenceId);
                          setBooks((prev) => prev.filter((b) => b.referenceId !== book.referenceId));
                        }}
                        className="p-2 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 cursor-pointer"
                        aria-label="Xóa sách tham chiếu"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </GlassSurface>
                ))}
              </div>
            </div>
          )}

          {/* USERS */}
          {tab === 'users' && (
            <GlassSurface className="rounded-2xl p-6 space-y-4">
              <h2 className="font-display text-base font-bold text-slate-950">
                Danh sách tài khoản học sinh ({users.length})
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="py-2 pr-4">Tên hiển thị</th>
                      <th className="py-2 pr-4">Email</th>
                      <th className="py-2 pr-4">Lớp</th>
                      <th className="py-2 pr-4">Đăng nhập gần nhất</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.map((u) => (
                      <tr key={u.uid}>
                        <td className="py-2.5 pr-4 font-semibold text-slate-900">{u.displayName}</td>
                        <td className="py-2.5 pr-4 font-mono text-slate-700">{u.email}</td>
                        <td className="py-2.5 pr-4">Lớp {u.grade}</td>
                        <td className="py-2.5 pr-4 font-mono text-slate-500">
                          {new Date(u.lastLoginAt).toLocaleString('vi-VN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassSurface>
          )}

          {/* RATE LIMITS & UPLOAD PROTECTION */}
          {tab === 'limits' && (
            <GlassSurface className="rounded-3xl p-6 sm:p-8 space-y-5">
              <h2 className="font-display text-lg font-bold text-slate-950">
                Cấu hình giới hạn lưu lượng & Chống lạm dụng
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {(
                  [
                    ['requestsPerMinute', 'Yêu cầu / phút (mỗi học sinh)'],
                    ['requestsPerHour', 'Yêu cầu / giờ (mỗi học sinh)'],
                    ['analysesPerDay', 'Số lần phân tích / ngày'],
                    ['cooldownSeconds', 'Thời gian chờ giữa 2 lần (giây)'],
                    ['maximumConcurrentJobs', 'Số tác vụ chạy song song tối đa'],
                    ['maximumPagesPerAnalysis', 'Số trang tối đa mỗi lần phân tích'],
                    ['maximumFileSizeMb', 'Dung lượng tệp tối đa (MB)'],
                  ] as const
                ).map(([field, label]) => (
                  <div key={field}>
                    <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
                    <input
                      type="number"
                      min={1}
                      value={limits[field]}
                      onChange={(e) =>
                        setLimits((prev) => ({
                          ...prev,
                          [field]: Math.max(1, Number(e.target.value) || 1),
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 font-mono text-sm"
                    />
                  </div>
                ))}
              </div>
              <WaterRippleButton
                disabled={savingConfig}
                onClick={() => handlePatchAiConfig({ rateLimitConfig: limits })}
              >
                Áp dụng giới hạn hệ thống
              </WaterRippleButton>
            </GlassSurface>
          )}

          {/* AUDIT LOGS */}
          {tab === 'audit' && (
            <GlassSurface className="rounded-2xl p-6 space-y-4">
              <h2 className="font-display text-base font-bold text-slate-950">
                Nhật ký kiểm toán quản trị ({auditLogs.length})
              </h2>
              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {auditLogs.map((log) => (
                  <div
                    key={log.logId}
                    className="rounded-xl bg-white/85 border border-slate-200 p-3.5 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div>
                      <p className="font-mono font-semibold text-slate-900">
                        {log.action} · {log.resourceType}/{log.resourceId}
                      </p>
                      <p className="text-slate-500 mt-0.5">
                        Bởi {log.actorEmail || log.actorUid} · Trạng thái: {log.status}
                      </p>
                    </div>
                    <span className="font-mono text-[11px] text-slate-500 shrink-0">
                      {new Date(log.timestamp).toLocaleString('vi-VN')}
                    </span>
                  </div>
                ))}
              </div>
            </GlassSurface>
          )}
        </>
      )}
    </div>
  );
};
