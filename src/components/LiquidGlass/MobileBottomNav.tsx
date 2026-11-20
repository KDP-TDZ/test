import React from 'react';
import { Award, LayoutDashboard, Repeat, Upload } from 'lucide-react';
import { useUiMode } from '../../context/UiModeContext';

export type MobileTabId = 'dashboard' | 'upload' | 'practice' | 'exams';

interface MobileBottomNavProps {
  activeId: string;
  duePracticeCount?: number;
  onSelect: (id: MobileTabId) => void;
}

const MOBILE_TABS: Array<{
  id: MobileTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'upload', label: 'Kiểm định', icon: Upload },
  { id: 'practice', label: 'Luyện tập', icon: Repeat },
  { id: 'exams', label: 'Phòng thi', icon: Award },
];

/**
 * Lightweight, native-feeling Fixed Bottom Tab Bar for Mobile (< 768px).
 * Zero backdrop-filter blur, solid high-contrast surfaces, >= 48px touch hitboxes,
 * and <= 60px bar height to keep total mobile sticky chrome strictly under 15%.
 */
export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeId,
  duePracticeCount = 0,
  onSelect,
}) => {
  const { isEthereal } = useUiMode();

  return (
    <nav
      aria-label="Điều hướng chính trên điện thoại"
      className="md:hidden no-print fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-[#111827] border-t border-slate-200 dark:border-slate-800 pb-[env(safe-area-inset-bottom)]"
    >
      <div className="grid grid-cols-4 h-[60px] max-w-lg mx-auto">
        {MOBILE_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive =
            activeId === tab.id || (activeId === 'report' && tab.id === 'upload');
          const showBadge = tab.id === 'practice' && duePracticeCount > 0;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelect(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex flex-col items-center justify-center gap-0.5 min-h-[48px] px-1 cursor-pointer select-none active:scale-95 transition-transform duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ${
                isEthereal
                  ? 'focus-visible:ring-indigo-500'
                  : 'focus-visible:ring-sky-500'
              } ${
                isActive
                  ? isEthereal
                    ? 'text-indigo-600 dark:text-indigo-400 font-semibold'
                    : 'text-sky-700 dark:text-sky-400 font-semibold'
                  : 'text-slate-500 dark:text-slate-400 font-medium'
              }`}
            >
              {/* Crisp top active indicator bar */}
              <span
                aria-hidden="true"
                className={`absolute top-0 left-1/2 -translate-x-1/2 h-[2.5px] rounded-b-full transition-opacity duration-150 ${
                  isActive
                    ? isEthereal
                      ? 'w-7 opacity-100 bg-indigo-600 dark:bg-indigo-400'
                      : 'w-7 opacity-100 bg-sky-700 dark:bg-sky-400'
                    : 'w-0 opacity-0'
                }`}
              />

              <span className="relative inline-flex items-center justify-center">
                <Icon className="size-[21px]" />
                {showBadge && (
                  <span
                    aria-label={`${duePracticeCount} câu cần ôn`}
                    className="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold tabular-nums flex items-center justify-center"
                  >
                    {duePracticeCount > 99 ? '99+' : duePracticeCount}
                  </span>
                )}
              </span>

              <span className="text-[11px] leading-tight tracking-tight truncate max-w-full">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
