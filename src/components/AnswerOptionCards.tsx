import React from 'react';
import { Check, CheckCircle2, XCircle } from 'lucide-react';
import { useUiMode } from '../context/UiModeContext';
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
 * Dual-mode ABCD answer selector:
 * - Classic (`!isEthereal`): flat high-contrast paper-style bordered options with zero blur/ripple/lift.
 * - Modern (`isEthereal`): prominent rounded-square A/B/C/D badges, desktop shortcut hints (1–4),
 *   compositor-only transitions (<= 180ms), and dual-coded graded states (icon + text + color).
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
  const { isEthereal } = useUiMode();

  if (!isEthereal) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Các phương án trả lời">
        {options.map((opt) => {
          const isSelected = selectedOption === opt.key;
          const isCorrect = correctOption === opt.key;

          let cardClass =
            'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 hover:border-sky-600 dark:hover:border-sky-500';
          if (isGraded) {
            if (isCorrect) {
              cardClass =
                'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-600 dark:border-emerald-500 text-emerald-950 dark:text-emerald-100 font-semibold';
            } else if (isSelected) {
              cardClass =
                'bg-rose-50 dark:bg-rose-950/60 border-rose-600 dark:border-rose-500 text-rose-950 dark:text-rose-100';
            } else {
              cardClass =
                'bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400';
            }
          } else if (isSelected) {
            cardClass =
              'bg-sky-50 dark:bg-sky-950/55 border-sky-700 dark:border-sky-400 text-sky-950 dark:text-sky-100 font-semibold';
          }

          return (
            <button
              key={opt.key}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled || isGraded}
              onClick={(e) => onSelect(opt.key, e.currentTarget)}
              className={`min-h-[44px] text-left px-3.5 py-2.5 rounded-lg border text-xs sm:text-sm flex items-start justify-between gap-2.5 cursor-pointer disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 transition-colors duration-150 ${cardClass}`}
            >
              <span className="flex items-start gap-2 min-w-0">
                <span className="font-mono font-bold shrink-0">{opt.key}.</span>
                <span className="leading-[1.5] text-pretty">{opt.text}</span>
              </span>

              <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold mt-0.5">
                {isGraded && isCorrect && (
                  <>
                    <CheckCircle2 className="size-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                    <span className="text-emerald-800 dark:text-emerald-300">Đúng</span>
                  </>
                )}
                {isGraded && isSelected && !isCorrect && (
                  <>
                    <XCircle className="size-4 text-rose-700 dark:text-rose-400" aria-hidden="true" />
                    <span className="text-rose-800 dark:text-rose-300">Bạn chọn</span>
                  </>
                )}
                {!isGraded && isSelected && (
                  <>
                    <Check className="size-4 text-sky-700 dark:text-sky-400" aria-hidden="true" />
                    <span className="text-sky-800 dark:text-sky-300">Đã chọn</span>
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Các phương án trả lời">
      {options.map((opt) => {
        const isSelected = selectedOption === opt.key;
        const isCorrect = correctOption === opt.key;

        let cardClass =
          'bg-white/75 dark:bg-slate-900/65 border-indigo-200/75 dark:border-indigo-400/20 text-[#171B3A] dark:text-[#EEF1FF] hover:border-indigo-400/90 dark:hover:border-indigo-400/55 hover:bg-white/95 dark:hover:bg-slate-900/90';
        let badgeClass =
          'bg-indigo-50/90 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-200 border border-indigo-200/80 dark:border-indigo-400/30';

        if (isGraded) {
          if (isCorrect) {
            cardClass =
              'bg-emerald-50/90 dark:bg-emerald-950/60 border-emerald-500 dark:border-emerald-500/80 text-emerald-950 dark:text-emerald-100 font-semibold';
            badgeClass =
              'bg-emerald-600 text-white border border-emerald-500';
          } else if (isSelected) {
            cardClass =
              'bg-rose-50/90 dark:bg-rose-950/60 border-rose-500 dark:border-rose-500/80 text-rose-950 dark:text-rose-100';
            badgeClass =
              'bg-rose-600 text-white border border-rose-500';
          } else {
            cardClass =
              'bg-white/45 dark:bg-slate-900/40 border-slate-200/65 dark:border-slate-800 text-slate-500 dark:text-slate-400 opacity-80';
            badgeClass =
              'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700';
          }
        } else if (isSelected) {
          cardClass =
            'bg-indigo-50/95 dark:bg-indigo-950/65 border-indigo-500 dark:border-indigo-400 text-[#171B3A] dark:text-white ring-2 ring-indigo-500/20 dark:ring-indigo-400/25 font-semibold';
          badgeClass =
            'bg-gradient-to-br from-[#4338CA] via-[#4F46E5] to-[#7C3AED] text-white border border-indigo-400/50 shadow-sm';
        }

        return (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={disabled || isGraded}
            onClick={(e) => onSelect(opt.key, e.currentTarget)}
            className={`group min-h-[54px] text-left px-3.5 py-3 rounded-2xl border text-xs sm:text-sm flex items-center justify-between gap-3 cursor-pointer disabled:cursor-default transition-[transform,opacity,background-color,border-color] duration-150 ease-out active:not(:disabled):scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-950 ${cardClass}`}
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
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                  <span>Đúng</span>
                </span>
              )}
              {isGraded && isSelected && !isCorrect && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                  <XCircle className="size-4 shrink-0" aria-hidden="true" />
                  <span>Bạn chọn</span>
                </span>
              )}
              {!isGraded && isSelected && (
                <CheckCircle2 className="size-4 text-indigo-600 dark:text-indigo-300 shrink-0" aria-label="Đã chọn" />
              )}
              {!isGraded && !isSelected && showShortcutHints && (
                <kbd
                  aria-hidden="true"
                  className="hidden sm:inline-flex size-6 items-center justify-center rounded-lg border border-indigo-200/70 dark:border-indigo-400/20 bg-white/70 dark:bg-slate-800/70 font-mono text-[11px] font-medium text-[#6B7499] dark:text-[#A5B1D8] tabular-nums"
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
  const { isEthereal } = useUiMode();

  if (!isEthereal) {
    return (
      <div className="divide-y divide-slate-200 dark:divide-slate-700 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
        {statements.map((stmt) => {
          const chosen = choices?.[stmt.label];
          const isMatch = chosen === stmt.isTrue;
          return (
            <div
              key={stmt.label}
              className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs sm:text-sm"
            >
              <p className="text-slate-900 dark:text-slate-100 leading-[1.5]">
                <strong className="font-mono mr-1">{stmt.label})</strong>
                {stmt.text}
              </p>
              <div className="flex items-center gap-1.5 shrink-0">
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
                      className={`min-h-[34px] px-3 py-1 rounded-md border text-xs font-semibold cursor-pointer disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 transition-colors duration-150 ${
                        active
                          ? 'bg-sky-700 text-white border-sky-700 dark:bg-sky-600 dark:border-sky-600'
                          : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:border-sky-600'
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
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {isMatch ? (
                      <CheckCircle2 className="size-3.5" aria-hidden="true" />
                    ) : (
                      <XCircle className="size-3.5" aria-hidden="true" />
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
  }

  return (
    <div className="space-y-2.5">
      {statements.map((stmt) => {
        const chosen = choices?.[stmt.label];
        const isMatch = chosen === stmt.isTrue;
        return (
          <div
            key={stmt.label}
            className="rounded-2xl border border-indigo-200/70 dark:border-indigo-400/20 bg-white/75 dark:bg-slate-900/65 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs sm:text-sm"
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <span className="size-7 rounded-xl bg-indigo-50 dark:bg-indigo-950/75 border border-indigo-200/80 dark:border-indigo-400/30 text-indigo-700 dark:text-indigo-200 font-mono text-xs font-bold inline-flex items-center justify-center shrink-0">
                {stmt.label}
              </span>
              <p className="text-[#171B3A] dark:text-[#EEF1FF] leading-[1.55] pt-0.5 text-pretty">
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
                    className={`min-h-[36px] px-3.5 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer disabled:cursor-default transition-[transform,background-color,border-color] duration-150 ease-out active:not(:disabled):scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      active
                        ? 'bg-gradient-to-r from-[#4338CA] to-[#6366F1] text-white border-indigo-500 shadow-sm'
                        : 'bg-white/80 dark:bg-slate-900/80 text-[#171B3A] dark:text-[#E6ECFF] border-indigo-200/80 dark:border-indigo-400/25 hover:border-indigo-400'
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
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-rose-700 dark:text-rose-400'
                  }`}
                >
                  {isMatch ? (
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                  ) : (
                    <XCircle className="size-4" aria-hidden="true" />
                  )}
                  {stmt.isTrue ? 'Đúng' : 'Sai'}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
