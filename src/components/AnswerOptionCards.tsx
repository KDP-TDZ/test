import React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { AbcdChoice } from '../core/answerKeyboard';
import type { TrueFalseStatement } from '../core/types';

export interface AbcdOptionItem {
  key: AbcdChoice;
  text: string;
}

interface AbcdOptionGridProps {
  options: ReadonlyArray<AbcdOptionItem>;
  selectedOption?: AbcdChoice;
  correctOption?: AbcdChoice;
  isGraded: boolean;
  disabled?: boolean;
  showShortcutHints?: boolean;
  onSelect: (choice: AbcdChoice, btnEl?: HTMLButtonElement | null) => void;
}

const SHORTCUT_NUMBERS: Record<AbcdChoice, string> = {
  A: '1',
  B: '2',
  C: '3',
  D: '4',
};

/**
 * Unified editorial ABCD answer selector:
 * - Luxury Cobalt / Slate / Emerald / Rose palette matching the Landing Page studio aesthetic.
 * - Prominent rounded-xl A/B/C/D badges, desktop shortcut hints (1–4), min-h-[48px] touch targets,
 *   compositor-only transitions (<= 150ms), and dual-coded graded states (icon + Vietnamese label + color).
 */
export const AbcdOptionGrid: React.FC<AbcdOptionGridProps> = ({
  options,
  selectedOption,
  correctOption,
  isGraded,
  disabled = false,
  showShortcutHints = true,
  onSelect,
}) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Các phương án trả lời">
      {options.map((opt) => {
        const isSelected = selectedOption === opt.key;
        const isCorrect = correctOption === opt.key;

        let cardClass =
          'bg-[#FFFFFF] dark:bg-[#111B30] border-[#E6ECF5] dark:border-[#1E293B] text-[#172033] dark:text-[#E6EFFC] hover:border-[#2563EB]/60 dark:hover:border-[#3B82F6]/65 hover:bg-[#F8FAFC] dark:hover:bg-[#15223B]';
        let badgeClass =
          'bg-[#F1F5FA] dark:bg-[#0D1628] text-[#172033] dark:text-[#CBD5E1] border border-[#E6ECF5] dark:border-[#1E293B]';

        if (isGraded) {
          if (isCorrect) {
            cardClass =
              'bg-emerald-50/90 dark:bg-emerald-950/55 border-[#059669] dark:border-emerald-500/80 text-emerald-950 dark:text-emerald-100 font-semibold';
            badgeClass =
              'bg-[#059669] text-white border border-[#059669]';
          } else if (isSelected) {
            cardClass =
              'bg-rose-50/90 dark:bg-rose-950/55 border-[#E11D48] dark:border-rose-500/80 text-rose-950 dark:text-rose-100';
            badgeClass =
              'bg-[#E11D48] text-white border border-[#E11D48]';
          } else {
            cardClass =
              'bg-[#F8FAFC] dark:bg-[#0D1628]/70 border-[#E6ECF5] dark:border-[#1E293B] text-[#525E75] dark:text-[#94A3B8] opacity-80';
            badgeClass =
              'bg-[#F1F5FA] dark:bg-[#111B30] text-[#525E75] dark:text-[#94A3B8] border border-[#E6ECF5] dark:border-[#1E293B]';
          }
        } else if (isSelected) {
          cardClass =
            'bg-[#EAF2FF] dark:bg-[#2563EB]/20 border-[#2563EB] dark:border-[#3B82F6] text-[#172033] dark:text-[#E6EFFC] ring-2 ring-[#2563EB]/20 dark:ring-[#3B82F6]/25 font-semibold';
          badgeClass =
            'bg-[#2563EB] text-white border border-[#2563EB] shadow-sm';
        }

        return (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={disabled || isGraded}
            onClick={(e) => onSelect(opt.key, e.currentTarget)}
            className={`group min-h-[48px] text-left px-3.5 py-3 rounded-2xl border text-xs sm:text-sm flex items-center justify-between gap-3 cursor-pointer disabled:cursor-default transition-[transform,opacity,background-color,border-color] duration-150 ease-out active:not(:disabled):scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-[#09111E] ${cardClass}`}
          >
            <span className="flex items-start gap-3 min-w-0">
              <span
                aria-hidden="true"
                className={`size-8 rounded-xl inline-flex items-center justify-center font-mono text-xs font-bold shrink-0 transition-[transform,background-color,color] duration-150 ease-out ${badgeClass}`}
              >
                {opt.key}
              </span>
              <span className="leading-[1.55] pt-0.5 text-pretty">{opt.text}</span>
            </span>

            <span className="shrink-0 inline-flex items-center gap-1.5">
              {isGraded && isCorrect && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#059669] dark:text-emerald-300">
                  <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                  <span>Đúng</span>
                </span>
              )}
              {isGraded && isSelected && !isCorrect && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#E11D48] dark:text-rose-300">
                  <XCircle className="size-4 shrink-0" aria-hidden="true" />
                  <span>Bạn chọn</span>
                </span>
              )}
              {!isGraded && isSelected && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB] dark:text-[#60A5FA]">
                  <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                  <span className="sr-only">Đã chọn</span>
                </span>
              )}
              {!isGraded && !isSelected && showShortcutHints && (
                <kbd
                  aria-hidden="true"
                  className="hidden sm:inline-flex size-6 items-center justify-center rounded-lg border border-[#E6ECF5] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-[#0D1628] font-mono text-[11px] font-medium text-[#525E75] dark:text-[#94A3B8] tabular-nums"
                >
                  {SHORTCUT_NUMBERS[opt.key]}
                </kbd>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
};

interface TrueFalseOptionListProps {
  statements: ReadonlyArray<TrueFalseStatement>;
  choices?: Partial<Record<'a' | 'b' | 'c' | 'd', boolean>>;
  isGraded: boolean;
  onChoose: (label: 'a' | 'b' | 'c' | 'd', value: boolean) => void;
}

export const TrueFalseOptionList: React.FC<TrueFalseOptionListProps> = ({
  statements,
  choices,
  isGraded,
  onChoose,
}) => {
  return (
    <div className="space-y-2.5">
      {statements.map((stmt) => {
        const chosen = choices?.[stmt.label];
        const isMatch = chosen === stmt.isTrue;
        return (
          <div
            key={stmt.label}
            className="rounded-2xl border border-[#E6ECF5] dark:border-[#1E293B] bg-[#FFFFFF] dark:bg-[#111B30] px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs sm:text-sm"
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <span className="size-7 rounded-xl bg-[#EAF2FF] dark:bg-[#2563EB]/20 border border-[#BFDBFE] dark:border-[#2563EB]/40 text-[#2563EB] dark:text-[#60A5FA] font-mono text-xs font-bold inline-flex items-center justify-center shrink-0">
                {stmt.label}
              </span>
              <p className="text-[#172033] dark:text-[#E6EFFC] leading-[1.55] pt-0.5 text-pretty">
                {stmt.text}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {[
                { val: true, label: 'Đúng' },
                { val: false, label: 'Sai' },
              ].map((btn) => {
                const active = chosen === btn.val;
                return (
                  <button
                    key={btn.label}
                    type="button"
                    disabled={isGraded}
                    aria-pressed={active}
                    onClick={() => onChoose(stmt.label, btn.val)}
                    className={`min-h-[38px] px-3.5 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer disabled:cursor-default transition-[transform,background-color,border-color] duration-150 ease-out active:not(:disabled):scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] ${
                      active
                        ? 'bg-[#2563EB] text-white border-[#2563EB] shadow-sm'
                        : 'bg-[#F8FAFC] dark:bg-[#0D1628] text-[#172033] dark:text-[#E6EFFC] border-[#E6ECF5] dark:border-[#1E293B] hover:border-[#2563EB]/60'
                    }`}
                  >
                    {btn.label}
                  </button>
                );
              })}
              {isGraded && (
                <span
                  className={`inline-flex items-center gap-1 ml-1 font-mono text-xs font-semibold ${
                    isMatch
                      ? 'text-[#059669] dark:text-emerald-400'
                      : 'text-[#E11D48] dark:text-rose-400'
                  }`}
                >
                  {isMatch ? (
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                  ) : (
                    <XCircle className="size-4" aria-hidden="true" />
                  )}
                  Đáp án: {stmt.isTrue ? 'Đúng' : 'Sai'}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
