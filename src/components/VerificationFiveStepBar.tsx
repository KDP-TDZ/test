import React from 'react';
import {
  getStepProgressFraction,
  VERIFICATION_STEPS,
  type VerificationStepId,
} from '../core/verificationStepper';

export interface VerificationFiveStepBarProps {
  activeStep: VerificationStepId;
  /** Optional override for fine-grained progress percentage inside a step (0..100) */
  customProgressPct?: number;
  /** Optional list of step IDs that the user can click to navigate directly */
  interactiveSteps?: VerificationStepId[];
  onSelectStep?: (stepId: VerificationStepId) => void;
  /** Optional right-side status caption (rendered as clean unboxed metadata) */
  statusSummaryText?: string;
  /** Shows a calm horizontal light glide on the progress rail while background AI work runs */
  indeterminate?: boolean;
  /** Optional embedded detail slot rendered below the continuous bottom progress rail */
  children?: React.ReactNode;
}

export const VerificationFiveStepBar: React.FC<VerificationFiveStepBarProps> = ({
  activeStep,
  customProgressPct,
  interactiveSteps = [],
  onSelectStep,
  statusSummaryText,
  indeterminate = false,
  children,
}) => {
  const activeSpec = VERIFICATION_STEPS.find((s) => s.id === activeStep) || VERIFICATION_STEPS[0];
  const scaleFraction =
    typeof customProgressPct === 'number'
      ? Math.max(0.06, Math.min(1, customProgressPct / 100))
      : getStepProgressFraction(activeStep);
  const progressValuePct = Math.round(scaleFraction * 100);

  return (
    <section
      aria-label="Quy trình kiểm định và sửa lỗi bài tập 5 bước"
      className="no-print space-y-2.5"
    >
      {/* Top quiet editorial metadata bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-[#525E75] dark:text-[#94A3B8]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-[#2563EB] dark:text-[#60A5FA] font-mono tabular-nums">
            Bước {activeSpec.id}/5
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-semibold text-[#172033] dark:text-[#E6EFFC]">
            {activeSpec.label}
          </span>
          <span aria-hidden="true" className="hidden sm:inline">
            ·
          </span>
          <span className="hidden sm:inline">{statusSummaryText || activeSpec.description}</span>
        </div>

        <span className="font-mono text-[11px] font-semibold text-[#2563EB] dark:text-[#60A5FA] tabular-nums">
          Tiến độ {progressValuePct}%
        </span>
      </div>

      {/* Single-Elevation Compact Cobalt & Slate Stepper Card */}
      <div className="w-full rounded-2xl bg-white dark:bg-[#111B30] border border-[#E6ECF5] dark:border-[#1E293B] shadow-[0_2px_10px_-4px_rgba(15,23,42,0.06)] px-3.5 py-3.5 sm:px-6 sm:py-4">
        <ol className="mx-auto max-w-4xl grid grid-cols-5 gap-1 sm:gap-3 items-center">
          {VERIFICATION_STEPS.map((step) => {
            const isCurrent = step.id === activeStep;
            const isCompleted = step.id < activeStep;
            const canClick =
              Boolean(onSelectStep) &&
              (interactiveSteps.includes(step.id) || isCurrent);

            return (
              <li key={step.id} className="flex flex-col items-center text-center min-w-0">
                <button
                  type="button"
                  disabled={!canClick}
                  onClick={() => {
                    if (canClick && onSelectStep) {
                      onSelectStep(step.id);
                    }
                  }}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-label={`Bước ${step.id}: ${step.label}${
                    isCurrent
                      ? ' (Đang thực hiện)'
                      : isCompleted
                      ? ' (Đã hoàn thành)'
                      : ' (Chưa mở)'
                  }`}
                  className={`group flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 w-full min-h-[38px] rounded-xl py-1 px-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] transition-colors duration-150 ${
                    canClick
                      ? 'cursor-pointer hover:bg-[#F8FAFC] dark:hover:bg-[#0D1628]'
                      : 'cursor-default'
                  }`}
                >
                  <span
                    className={`size-7 sm:size-7 rounded-full inline-flex items-center justify-center font-mono text-[11px] sm:text-xs font-semibold tabular-nums shrink-0 transition-colors duration-150 ${
                      isCurrent
                        ? 'bg-[#2563EB] text-white shadow-[0_4px_12px_-3px_rgba(37,99,235,0.5)]'
                        : isCompleted
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-[#059669] dark:text-emerald-400 border border-[#059669] dark:border-emerald-400/80'
                        : 'bg-[#F8FAFC] dark:bg-[#0D1628] text-[#525E75] dark:text-[#94A3B8] border border-[#CBD5E1] dark:border-[#334155]'
                    }`}
                  >
                    {isCompleted ? (
                      <svg
                        viewBox="0 0 16 16"
                        className="size-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
                      </svg>
                    ) : (
                      step.id
                    )}
                  </span>

                  <span
                    className={`font-display text-[11px] sm:text-xs leading-tight tracking-tight truncate max-w-full whitespace-nowrap ${
                      isCurrent
                        ? 'font-bold text-[#172033] dark:text-[#E6EFFC]'
                        : isCompleted
                        ? 'font-semibold text-[#059669] dark:text-emerald-400 group-hover:text-[#172033] dark:group-hover:text-white'
                        : 'font-medium text-[#525E75] dark:text-[#94A3B8]'
                    }`}
                  >
                    <span className="hidden md:inline">{step.label}</span>
                    <span className="md:hidden">{step.shortLabel}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {/* Continuous Bottom Progress Rail (Cobalt #2563EB GPU scaleX fill) */}
        <div className="mx-auto max-w-4xl mt-3 px-1 sm:px-2">
          <div
            role="progressbar"
            aria-label="Tiến độ quy trình kiểm định và sửa lỗi"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressValuePct}
            aria-valuetext={`Bước ${activeSpec.id}/5: ${activeSpec.label} (${progressValuePct}%)`}
            className="h-1.5 w-full rounded-full bg-[#E6ECF5] dark:bg-[#1E293B] overflow-hidden"
          >
            <div
              className={`h-full w-full origin-left rounded-full bg-[#2563EB] dark:bg-[#3B82F6] transition-transform duration-300 ease-out ${
                indeterminate ? 'sc-rail-sheen' : ''
              }`}
              style={{ transform: `scaleX(${scaleFraction})` }}
            />
          </div>
        </div>

        {children && (
          <div className="mt-4 pt-4 border-t border-[#E6ECF5] dark:border-[#1E293B]">
            {children}
          </div>
        )}
      </div>
    </section>
  );
};
