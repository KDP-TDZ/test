import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  FileText,
  LogOut,
  Moon,
  Sun,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePrivacyBlur } from '../../context/PrivacyBlurContext';
import { useTheme } from '../../context/ThemeContext';
import type { GradeLevel } from '../../core/types';
import { updateUserPreferences } from '../../services/firestoreService';
import {
  isWaterDropSoundEnabled,
  playWaterDropSound,
  setWaterDropSoundEnabled,
} from './AmbientCanvas';

const GRADES: GradeLevel[] = ['10', '11', '12'];

interface AccountMenuProps {
  /** Show compact display name next to avatar on desktop header */
  showIdentityText?: boolean;
}

/**
 * Unified Account Avatar Popover consolidating Theme (Sáng/Tối), Privacy Text Blur (Che chữ),
 * Quick Grade Switcher (Lớp 10/11/12), Water Drop Audio Toggle, System Summary Download,
 * and Logout into a single clean header zone.
 */
export const AccountMenu: React.FC<AccountMenuProps> = ({ showIdentityText = false }) => {
  const { user, profile, isSuperAdmin, logout, refreshProfile } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { privacyBlur, canUsePrivacyBlur, togglePrivacyBlur } = usePrivacyBlur();

  const [open, setOpen] = useState(false);
  const [savingGrade, setSavingGrade] = useState<GradeLevel | null>(null);
  const [waterSoundOn, setWaterSoundOn] = useState<boolean>(() => isWaterDropSoundEnabled());
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
          className="inline-flex items-center gap-1.5 min-h-[38px] rounded-xl px-2.5 sm:px-3 py-1.5 text-xs font-semibold cursor-pointer shrink-0 whitespace-nowrap transition-opacity duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] privacy-blur-toggle-active"
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
        className={`inline-flex items-center gap-2 rounded-full min-h-[40px] cursor-pointer shrink-0 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] ${
          showIdentityText
            ? 'p-0.5 md:pl-1 md:pr-2.5 md:py-1 border border-[#E6ECF5] dark:border-[#1E293B] bg-white dark:bg-[#111B30] hover:bg-[#F1F5FA] dark:hover:bg-[#1E293B]/80'
            : 'p-0.5 hover:ring-2 hover:ring-[#BFDBFE] dark:hover:ring-[#3B82F6]/40'
        }`}
      >
        <span className="flex items-center justify-center size-9 rounded-full bg-[#2563EB] text-white font-display text-xs font-bold select-none shrink-0 shadow-[0_4px_12px_-4px_rgba(37,99,235,0.5)]">
          {userInitial}
        </span>

        {showIdentityText && (
          <span className="hidden md:flex flex-col text-left leading-tight max-w-[130px]">
            <span className="text-xs font-semibold text-[#172033] dark:text-[#E6EFFC] truncate">
              {displayName}
            </span>
            <span className="text-[11px] text-[#525E75] dark:text-[#94A3B8] truncate">
              {isSuperAdmin ? 'Super Admin' : `Lớp ${currentGrade}`}
            </span>
          </span>
        )}

        {showIdentityText && (
          <ChevronDown
            className={`hidden md:block size-3.5 text-[#525E75] dark:text-[#94A3B8] transition-transform duration-150 ${
              open ? 'rotate-180' : ''
            }`}
          />
        )}
      </button>

      {/* Account & Settings Popover */}
      {open && (
        <div
          role="menu"
          aria-label="Cài đặt tài khoản và hiển thị"
          className="absolute right-0 top-[calc(100%+8px)] z-[60] w-[280px] sm:w-[300px] rounded-2xl bg-white dark:bg-[#111B30] border border-[#E6ECF5] dark:border-[#1E293B] shadow-xl shadow-slate-900/12 dark:shadow-black/55 p-3 space-y-3"
        >
          {/* User Identity Summary */}
          <div className="flex items-center gap-3 px-1 pb-2.5 border-b border-[#E6ECF5] dark:border-[#1E293B]">
            <span className="flex items-center justify-center size-10 rounded-full bg-[#2563EB] text-white font-display text-sm font-bold shrink-0">
              {userInitial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-[#172033] dark:text-[#E6EFFC] truncate">
                {displayName}
              </p>
              <p className="text-xs text-[#525E75] dark:text-[#94A3B8] truncate">
                {isSuperAdmin
                  ? 'Quản trị viên hệ thống'
                  : `${user?.email || `Học sinh · Lớp ${currentGrade}`}`}
              </p>
            </div>
          </div>

          {/* Quick Grade Switcher */}
          <div className="space-y-1.5 px-1">
            <div className="flex items-center justify-between text-[11px] font-semibold text-[#525E75] dark:text-[#94A3B8]">
              <span>Khối lớp hiện tại</span>
              {savingGrade && (
                <span className="text-[#2563EB] dark:text-[#60A5FA]">Đang lưu...</span>
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
                    className={`min-h-[38px] rounded-xl text-xs font-semibold flex items-center justify-center gap-1 cursor-pointer transition-colors duration-150 ${
                      active
                        ? 'bg-[#2563EB] text-white shadow-xs'
                        : 'bg-[#F1F5FA] dark:bg-[#0D1628] text-[#172033] dark:text-[#CBD5E1] hover:bg-[#EAF2FF] dark:hover:bg-[#1E293B] border border-[#E6ECF5] dark:border-[#1E293B]'
                    }`}
                  >
                    {active && <Check className="size-3 shrink-0" />}
                    <span>Lớp {g}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Display Toggles: Light/Dark, Sound & Privacy Blur */}
          <div className="space-y-1 pt-1 border-t border-[#E6ECF5] dark:border-[#1E293B]">
            <button
              type="button"
              role="menuitem"
              onClick={toggleTheme}
              className="w-full min-h-[40px] px-2.5 py-2 rounded-xl flex items-center justify-between text-xs font-medium text-[#172033] dark:text-[#E6EFFC] hover:bg-[#F1F5FA] dark:hover:bg-[#0D1628] cursor-pointer transition-colors"
            >
              <span className="inline-flex items-center gap-2.5">
                {theme === 'light' ? (
                  <Moon className="size-4 text-[#2563EB]" />
                ) : (
                  <Sun className="size-4 text-[#F5A623]" />
                )}
                <span>Giao diện màu</span>
              </span>
              <span className="text-[11px] font-semibold text-[#525E75] dark:text-[#94A3B8]">
                {theme === 'light' ? 'Sáng' : 'Tối'}
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const next = !waterSoundOn;
                setWaterSoundOn(next);
                setWaterDropSoundEnabled(next);
                if (next) playWaterDropSound();
              }}
              className="w-full min-h-[40px] px-2.5 py-2 rounded-xl flex items-center justify-between text-xs font-medium text-[#172033] dark:text-[#E6EFFC] hover:bg-[#F1F5FA] dark:hover:bg-[#0D1628] cursor-pointer transition-colors"
            >
              <span className="inline-flex items-center gap-2.5">
                {waterSoundOn ? (
                  <Volume2 className="size-4 text-[#2563EB] dark:text-[#60A5FA]" />
                ) : (
                  <VolumeX className="size-4 text-[#525E75] dark:text-[#94A3B8]" />
                )}
                <span>Âm thanh click giọt nước</span>
              </span>
              <span className="text-[11px] font-semibold text-[#525E75] dark:text-[#94A3B8]">
                {waterSoundOn ? 'Bật' : 'Tắt'}
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
                    ? 'privacy-blur-toggle-active'
                    : 'text-[#172033] dark:text-[#E6EFFC] hover:bg-[#F1F5FA] dark:hover:bg-[#0D1628]'
                }`}
              >
                <span className="inline-flex items-center gap-2.5">
                  {privacyBlur ? (
                    <Eye className="size-4 shrink-0" />
                  ) : (
                    <EyeOff className="size-4 shrink-0 text-[#2563EB] dark:text-[#60A5FA]" />
                  )}
                  <span>{privacyBlur ? 'Đang che chữ · Bấm hiện lại' : 'Che chữ trình chiếu (Admin)'}</span>
                </span>
                <span className="text-[10px] font-mono opacity-80">Ctrl+H</span>
              </button>
            )}

            <a
              href="/TONG_KET_HE_THONG_STUDYCHECK_AI.txt"
              download="TONG_KET_HE_THONG_STUDYCHECK_AI.txt"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="w-full min-h-[40px] px-2.5 py-2 rounded-xl flex items-center justify-between text-xs font-medium text-[#172033] dark:text-[#E6EFFC] hover:bg-[#F1F5FA] dark:hover:bg-[#0D1628] cursor-pointer transition-colors"
            >
              <span className="inline-flex items-center gap-2.5">
                <FileText className="size-4 shrink-0 text-[#059669] dark:text-emerald-400" />
                <span>Tải bản Tổng kết hệ thống</span>
              </span>
              <span className="text-[10px] font-mono text-[#525E75] dark:text-[#94A3B8]">.txt</span>
            </a>
          </div>

          {/* Sign Out */}
          <div className="pt-1 border-t border-[#E6ECF5] dark:border-[#1E293B]">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                logout();
              }}
              className="w-full min-h-[42px] px-2.5 py-2 rounded-xl flex items-center justify-center gap-2 text-xs font-semibold text-[#E11D48] dark:text-rose-400 bg-rose-50/80 dark:bg-rose-950/35 hover:bg-rose-100 dark:hover:bg-rose-950/60 cursor-pointer transition-colors"
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
