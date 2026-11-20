import React, { useEffect, useState } from 'react';
import { X, Mail, Lock, User, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AnimatedModal } from './LiquidGlass/AnimatedModal';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';

interface AuthModalProps {
  open: boolean;
  initialMode?: 'login' | 'register' | 'reset';
  onClose: () => void;
}

function mapFirebaseAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code || '';
  const msg = err instanceof Error ? err.message : String(err);
  if (code === 'auth/operation-not-allowed') {
    return 'Phương thức đăng nhập Email/Mật khẩu chưa được bật trong Firebase Console. Bạn có thể đăng nhập nhanh bằng Google bên trên hoặc bật Email/Password trong Firebase Authentication.';
  }
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Email hoặc mật khẩu không chính xác.';
  }
  if (code === 'auth/email-already-in-use') {
    return 'Email này đã được đăng ký. Vui lòng chuyển sang đăng nhập.';
  }
  if (code === 'auth/weak-password') {
    return 'Mật khẩu cần tối thiểu 6 ký tự.';
  }
  if (code === 'auth/popup-closed-by-user') {
    return 'Cửa sổ đăng nhập Google đã được đóng trước khi hoàn tất.';
  }
  return msg;
}

export const AuthModal: React.FC<AuthModalProps> = ({ open, initialMode = 'login', onClose }) => {
  const { signInWithGoogle, signInWithEmail, registerWithEmail, resetPassword } = useAuth();
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setError(null);
      setNotice(null);
    }
  }, [open, initialMode]);

  const handleGoogle = async () => {
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await signInWithGoogle();
      onClose();
    } catch (err) {
      setError(mapFirebaseAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await signInWithEmail(email.trim(), password);
        onClose();
      } else if (mode === 'register') {
        const res = await registerWithEmail(email.trim(), password, displayName);
        if (res.needsVerification) {
          setNotice('Đã tạo tài khoản và gửi email xác minh. Vui lòng kiểm tra hộp thư trước khi tiếp tục.');
        } else {
          onClose();
        }
      } else {
        await resetPassword(email.trim());
        setNotice('Đã gửi liên kết đặt lại mật khẩu tới email của bạn.');
      }
    } catch (err) {
      setError(mapFirebaseAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatedModal
      open={open}
      onClose={onClose}
      ariaLabelledBy="auth-modal-title"
      maxWidthClassName="max-w-md"
      panelClassName="p-5 sm:p-8"
    >
      <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 id="auth-modal-title" className="text-lg sm:text-xl font-bold text-[#16243E] dark:text-[#E6EFFC]">
              {mode === 'login'
                ? 'Đăng nhập StudyCheck AI'
                : mode === 'register'
                ? 'Tạo tài khoản học sinh'
                : 'Khôi phục mật khẩu'}
            </h2>
            <p className="text-sm text-[#475B78] dark:text-[#B4C7E2] mt-1 leading-[1.6]">
              {mode === 'login'
                ? 'Truy cập kho tài liệu kiểm định, trung tâm đề thi và bảng xếp hạng.'
                : mode === 'register'
                ? 'Lưu toàn bộ lịch sử phân tích, thẻ ghi nhớ và tiến độ học tập.'
                : 'Nhập email đã đăng ký để nhận hướng dẫn đặt lại mật khẩu.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hộp thoại đăng nhập"
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-xl text-[#475B78] dark:text-[#B4C7E2] hover:text-[#16243E] dark:hover:text-[#E6EFFC] hover:bg-white/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-2xl border border-rose-200 dark:border-rose-800/70 bg-rose-50/90 dark:bg-rose-950/50 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {notice && (
          <div className="mb-4 rounded-2xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/90 dark:bg-emerald-950/50 px-3.5 py-2.5 text-xs text-emerald-800 dark:text-emerald-200 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
            <span>{notice}</span>
          </div>
        )}

        {mode !== 'reset' && (
          <div className="auth-stagger">
            <WaterRippleButton
              variant="secondary"
              size="lg"
              onClick={handleGoogle}
              disabled={submitting}
              className="w-full justify-center"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                />
              </svg>
              Tiếp tục với Google
            </WaterRippleButton>

            <div className="my-5 flex items-center gap-3 text-xs text-[#475B78] dark:text-[#B4C7E2]">
              <span className="h-px flex-1 bg-sky-200/70 dark:bg-slate-700" />
              <span>hoặc dùng email</span>
              <span className="h-px flex-1 bg-sky-200/70 dark:bg-slate-700" />
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-stagger space-y-4">
          {mode === 'register' && (
            <div>
              <label htmlFor="auth-name" className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                Họ và tên hiển thị
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 z-10" />
                <input
                  id="auth-name"
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Nguyễn Minh Anh"
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl glass-control text-sm placeholder:text-slate-400"
                />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="auth-email" className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">
              Địa chỉ email
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 z-10" />
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="hocsinh@example.com"
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl glass-control text-sm placeholder:text-slate-400"
              />
            </div>
          </div>

          {mode !== 'reset' && (
            <div>
              <label htmlFor="auth-password" className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                Mật khẩu
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 z-10" />
                <input
                  id="auth-password"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Tối thiểu 6 ký tự"
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl glass-control text-sm placeholder:text-slate-400"
                />
              </div>
            </div>
          )}

          <WaterRippleButton type="submit" disabled={submitting} size="lg" className="w-full justify-center">
            {submitting
              ? 'Đang xử lý...'
              : mode === 'login'
              ? 'Đăng nhập'
              : mode === 'register'
              ? 'Tạo tài khoản'
              : 'Gửi email đặt lại mật khẩu'}
          </WaterRippleButton>
        </form>

        <div className="auth-stagger mt-5 pt-4 border-t border-slate-200/80 dark:border-slate-700/80 flex flex-wrap items-center justify-between gap-2 text-xs text-[#475B78] dark:text-[#B4C7E2]">
          {mode === 'login' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                  setNotice(null);
                }}
                className="min-h-[36px] hover:text-sky-700 dark:hover:text-sky-400 font-medium cursor-pointer"
              >
                Chưa có tài khoản? Tạo mới
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('reset');
                  setError(null);
                  setNotice(null);
                }}
                className="min-h-[36px] hover:text-sky-700 dark:hover:text-sky-400 cursor-pointer"
              >
                Quên mật khẩu?
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
                setNotice(null);
              }}
              className="min-h-[36px] hover:text-sky-700 dark:hover:text-sky-400 font-medium cursor-pointer"
            >
              Quay lại đăng nhập
            </button>
          )}
        </div>
    </AnimatedModal>
  );
};
