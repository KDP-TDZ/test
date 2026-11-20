import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { usePrivacyBlur } from '../../context/PrivacyBlurContext';
import { useUiMode } from '../../context/UiModeContext';

interface PrivacyBlurToggleProps {
  className?: string;
  showLabelOnMobile?: boolean;
}

export const PrivacyBlurToggle: React.FC<PrivacyBlurToggleProps> = ({
  className = '',
  showLabelOnMobile = false,
}) => {
  const { privacyBlur, canUsePrivacyBlur, togglePrivacyBlur } = usePrivacyBlur();
  const { isEthereal } = useUiMode();

  if (!canUsePrivacyBlur) return null;

  return (
    <button
      type="button"
      data-privacy-exempt="true"
      onClick={togglePrivacyBlur}
      aria-pressed={privacyBlur}
      aria-label={
        privacyBlur
          ? 'Hiện lại chữ và nội dung trang (Ctrl+H)'
          : 'Che mờ toàn bộ chữ, giữ nguyên giao diện CSS (Ctrl+H)'
      }
      title={
        privacyBlur
          ? 'Đang che chữ · Bấm để hiện lại (Ctrl+H)'
          : 'Che mờ chữ để khoe giao diện CSS · Chỉ dành cho Admin (Ctrl+H)'
      }
      className={`inline-flex items-center gap-1.5 min-h-[38px] rounded-xl px-2.5 sm:px-3 py-2 text-xs font-medium cursor-pointer shrink-0 whitespace-nowrap transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 ${
        isEthereal ? 'focus-visible:ring-indigo-500' : 'focus-visible:ring-sky-500'
      } ${
        privacyBlur
          ? isEthereal
            ? 'privacy-blur-toggle-active privacy-blur-toggle-modern'
            : 'privacy-blur-toggle-active privacy-blur-toggle-classic'
          : 'glass-control'
      } ${className}`}
    >
      {privacyBlur ? (
        <Eye className="size-4 text-white shrink-0" />
      ) : (
        <EyeOff
          className={`size-4 shrink-0 ${
            isEthereal
              ? 'text-indigo-600 dark:text-indigo-300'
              : 'text-sky-700 dark:text-sky-400'
          }`}
        />
      )}
      <span className={showLabelOnMobile ? 'inline' : 'hidden xl:inline'}>
        {privacyBlur ? 'Hiện chữ' : 'Che chữ'}
      </span>
    </button>
  );
};
