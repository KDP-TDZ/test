import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  FileText,
  LayoutGrid,
  LogOut,
  Moon,
  Sparkles,
  Sun,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePrivacyBlur } from '../../context/PrivacyBlurContext';
import { useTheme } from '../../context/ThemeContext';
import { useUiMode } from '../../context/UiModeContext';
import type { GradeLevel } from '../../core/types';
import { useIsMobileViewport } from '../../hooks/useIsMobileViewport';
import { updateUserPreferences } from '../../services/firestoreService';

const GRADES: GradeLevel[] = ['10', '11', '12'];

interface AccountMenuProps {
  /** Show compact display name next to avatar on desktop Classic header */
  showIdentityText?: boolean;
}

/**
 * Unified Account Avatar Popover consolidating Theme (Sáng/Tối), Privacy Text Blur (Che chữ),
 * UI Mode (Cổ điển/Hiện đại), Quick Grade Switcher (Lớp 10/11/12), and Logout into a single
 * clean header zone so Laptop/Tablet/Mobile headers never overflow or clip controls.
 */
export const AccountMenu: React.FC<AccountMenuProps> = ({ showIdentityText = false }) => {
  const { user, profile, isSuperAdmin, logout, refreshProfile } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { uiMode, isEthereal, setUiMode } = useUiMode();
  const { privacyBlur, canUsePrivacyBlur, togglePrivacyBlur } = usePrivacyBlur();
  const isMobile = useIsMobileViewport();

  const [open, setOpen] = useState(false);
  const [savingGrade, setSavingGrade] = useState<GradeLevel | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const displayName = profile?.displayName || user?.displayName || user?.email || 'Học sinh';
  const currentGrade: GradeLevel = profile?.grade || '10';
  const userInitial = displayName.trim().charAt(0).toUpperCase() || 'H';

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleSelectGrade = async (nextGrade: GradeLevel) => {
    if (!user || savingGrade || nextGrade === currentGrade) return;
    setSavingGrade(nextGrade);
    try {
      await updateUserPreferences(user.uid, { grade: nextGrade });
      await refreshProfile();
    } finally {
      setSavingGrade(null);
    }
  };

  return (
    <div ref={containerRef} className="relative flex items-center gap-1.5 sm:gap-2 shrink-0">
      {/* When Privacy Blur is active (Admin-only), keep an unmistakable 1-tap restore button right in the header */}
      {canUsePrivacyBlur && privacyBlur && (
        <button
          type="button"
          data-privacy-exempt="true"
          onClick={togglePrivacyBlur}
          aria-pressed={true}
          aria-label="Hiện lại chữ và nội dung trang (Ctrl+H)"
          title="Đang che chữ · Bấm để hiện lại (Ctrl+H)"
          className={`inline-flex items-center gap-1.5 min-h-[36px] sm:min-h-[38px] rounded-xl px-2.5 sm:px-3 py-1.5 text-xs font-semibold cursor-pointer shrink-0 whitespace-nowrap transition-opacity duration-150 focus-visible:outline-none focus-visible:ring-2 ${
            isEthereal
              ? 'privacy-blur-toggle-active privacy-blur-toggle-modern focus-visible:ring-indigo-500'
              : 'privacy-blur-toggle-active privacy-blur-toggle-classic focus-visible:ring-sky-500'
          }`}
        >
          <Eye className="size-4 shrink-0" />
          <span className="hidden sm:inline">Hiện chữ</span>
        </button>
      )}

      {/* Avatar Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Mở menu tài khoản và cài đặt hiển thị"
        title={`${displayName} · Cài đặt & Đăng xuất`}
        className={`inline-flex items-center gap-2 rounded-full min-h-[40px] cursor-pointer shrink-0 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 ${
          isEthereal ? 'focus-visible:ring-indigo-500' : 'focus-visible:ring-sky-500'
        } ${
          showIdentityText
            ? 'pl-1 pr-2.5 py-1 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/80'
            : 'p-0.5 hover:ring-2 hover:ring-indigo-300/70 dark:hover:ring-indigo-400/40'
        }`}
      >
        <span
          className={`flex items-center justify-center size-9 rounded-full text-white font-display text-xs font-bold select-none shrink-0 ${
            isEthereal && !isMobile
              ? 'bg-gradient-to-br from-[#6366F1] to-[#A855F7] shadow-[0_6px_14px_-4px_rgba(99,102,241,0.5)]'
              : isEthereal
                ? 'bg-indigo-600'
                : 'bg-sky-700'
          }`}
        >
          {userInitial}
        </span>

        {showIdentityText && (
          <span className="hidden md:flex flex-col text-left leading-tight max-w-[130px]">
            <span className="text-xs font-semibold text-[#16243E] dark:text-[#E6EFFC] truncate">
              {displayName}
            </span>
            <span className="text-[11px] text-[#475B78] dark:text-[#B4C7E2] truncate">
              {isSuperAdmin ? 'Super Admin' : `Lớp ${currentGrade}`}
            </span>
          </span>
        )}

        {showIdentityText && (
          <ChevronDown
            className={`hidden md:block size-3.5 text-slate-500 dark:text-slate-400 transition-transform duration-150 ${
              open ? 'rotate-180' : ''
            }`}
          />
        )}
      </button>

      {/* Account & Settings Popover */}
      {open && (
        <div
          role="menu"
          aria-label="Cài đặt tài khoản và giao diện"
          className="absolute right-0 top-[calc(100%+8px)] z-[60] w-[280px] sm:w-[300px] rounded-2xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700/90 shadow-xl shadow-slate-900/12 dark:shadow-black/50 p-3 space-y-3"
        >
          {/* User Identity Summary */}
          <div className="flex items-center gap-3 px-1 pb-2.5 border-b border-slate-100 dark:border-slate-800">
            <span
              className={`flex items-center justify-center size-10 rounded-full text-white font-display text-sm font-bold shrink-0 ${
                isEthereal ? 'bg-indigo-600' : 'bg-sky-700'
              }`}
            >
              {userInitial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                {displayName}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {isSuperAdmin
                  ? 'Quản trị viên hệ thống'
                  : `${user?.email || `Học sinh · Lớp ${currentGrade}`}`}
              </p>
            </div>
          </div>

          {/* Quick Grade Switcher */}
          <div className="space-y-1.5 px-1">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              <span>Khối lớp hiện tại</span>
              {savingGrade && (
                <span className="text-indigo-600 dark:text-indigo-400">Đang lưu...</span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {GRADES.map((g) => {
                const active = currentGrade === g;
                return (
                  <button
                    key={g}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    disabled={savingGrade !== null}
                    onClick={() => handleSelectGrade(g)}
                    className={`min-h-[36px] rounded-xl text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer transition-colors duration-150 ${
                      active
                        ? isEthereal
                          ? 'bg-indigo-600 text-white'
                          : 'bg-sky-700 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200/80 dark:hover:bg-slate-700'
                    }`}
                  >
                    {active && <Check className="size-3 shrink-0" />}
                    <span>Lớp {g}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Desktop/Tablet UI Mode Switcher */}
          <div className="space-y-1.5 px-1">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              <span>Phong cách giao diện</span>
              {isMobile && (
                <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  Mobile siêu nhẹ
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={uiMode === 'classic'}
                onClick={() => setUiMode('classic')}
                className={`min-h-[34px] rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors duration-150 ${
                  uiMode === 'classic'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <LayoutGrid className="size-3.5 shrink-0" />
                <span>Cổ điển</span>
              </button>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={uiMode === 'ethereal'}
                onClick={() => setUiMode('ethereal')}
                className={`min-h-[34px] rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors duration-150 ${
                  uiMode === 'ethereal'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Sparkles className="size-3.5 shrink-0" />
                <span>Hiện đại</span>
              </button>
            </div>
            {isMobile && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                Điện thoại tự dùng CSS phẳng chống lag; chọn phong cách trên sẽ áp dụng cho máy tính.
              </p>
            )}
          </div>

          {/* Display Toggles: Light/Dark & Privacy Blur */}
          <div className="space-y-1 pt-1 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              role="menuitem"
              onClick={toggleTheme}
              className="w-full min-h-[40px] px-2.5 py-2 rounded-xl flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
            >
              <span className="inline-flex items-center gap-2.5">
                {theme === 'light' ? (
                  <Moon className="size-4 text-sky-600 dark:text-sky-400" />
                ) : (
                  <Sun className="size-4 text-amber-500" />
                )}
                <span>Giao diện màu</span>
              </span>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {theme === 'light' ? 'Sáng' : 'Tối'}
              </span>
            </button>

            {canUsePrivacyBlur && (
              <button
                type="button"
                role="menuitem"
                data-privacy-exempt="true"
                onClick={togglePrivacyBlur}
                className={`w-full min-h-[40px] px-2.5 py-2 rounded-xl flex items-center justify-between text-xs font-medium cursor-pointer transition-colors ${
                  privacyBlur
                    ? isEthereal
                      ? 'privacy-blur-toggle-active privacy-blur-toggle-modern'
                      : 'privacy-blur-toggle-active privacy-blur-toggle-classic'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <span className="inline-flex items-center gap-2.5">
                  {privacyBlur ? (
                    <Eye className="size-4 shrink-0" />
                  ) : (
                    <EyeOff className="size-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
                  )}
                  <span>{privacyBlur ? 'Đang che chữ · Bấm hiện lại' : 'Che chữ khoe CSS (Admin)'}</span>
                </span>
                <span className="text-[10px] font-mono opacity-80">Ctrl+H</span>
              </button>
            )}

            <a
              href="/TONG_KET_HE_THONG_STUDYCHECK_AI.txt"
              download="TONG_KET_HE_THONG_STUDYCHECK_AI.txt"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="w-full min-h-[40px] px-2.5 py-2 rounded-xl flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
            >
              <span className="inline-flex items-center gap-2.5">
                <FileText className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>Tải bản Tổng kết hệ thống</span>
              </span>
              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">.txt</span>
            </a>
          </div>

          {/* Sign Out */}
          <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                logout();
              }}
              className="w-full min-h-[42px] px-2.5 py-2 rounded-xl flex items-center justify-center gap-2 text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-50/80 dark:bg-rose-950/35 hover:bg-rose-100 dark:hover:bg-rose-950/60 cursor-pointer transition-colors"
            >
              <LogOut className="size-4 shrink-0" />
              <span>Đăng xuất</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
