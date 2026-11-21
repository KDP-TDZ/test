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
  /** Optional embedded detail slot rendered below the continuous bottom progress rail */
  children?: React.ReactNode;
}

export const VerificationFiveStepBar: React.FC<VerificationFiveStepBarProps> = ({
  activeStep,
  customProgressPct,
  interactiveSteps = [],
  onSelectStep,
  statusSummaryText,
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
      {/* Top quiet editorial bar with current step metadata */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-[#475B78] dark:text-[#B4C7E2]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-[#0E4D5D] dark:text-cyan-300 font-mono tabular-nums">
            Bước {activeSpec.id}/5
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-medium text-[#16243E] dark:text-[#E6EFFC]">
            {activeSpec.label}
          </span>
          <span aria-hidden="true" className="hidden sm:inline">
            ·
          </span>
          <span className="hidden sm:inline">{statusSummaryText || activeSpec.description}</span>
        </div>

        <span className="font-mono text-[11px] font-semibold text-[#0E4D5D] dark:text-cyan-300 tabular-nums">
          Tiến độ {progressValuePct}%
        </span>
      </div>

      {/* Atmospheric Teal-to-Ice Backdrop framing the Floating Center White Stepper Card */}
      <div className="rounded-[30px] sm:rounded-[36px] p-3.5 sm:p-6 bg-gradient-to-b from-[#0E4B5A] via-[#6AA5B3] to-[#EAF4F6] dark:from-[#08141E] dark:via-[#0C2230] dark:to-[#0F172A] shadow-[0_18px_42px_-18px_rgba(14,75,90,0.28)]">
        <div className="mx-auto max-w-4xl rounded-[26px] sm:rounded-[30px] bg-white dark:bg-[#111C2D] border border-slate-200/75 dark:border-slate-800/90 shadow-[0_24px_56px_-16px_rgba(14,75,90,0.22)] dark:shadow-[0_24px_56px_-16px_rgba(2,6,23,0.7)] px-3.5 py-5 sm:px-10 sm:py-8">
          {/* 5 Standalone Step Circles + Centered Labels Below (NO horizontal connecting lines between circles) */}
          <ol className="grid grid-cols-5 gap-1 sm:gap-4 items-start">
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
                    className={`group flex flex-col items-center justify-start w-full min-h-[44px] rounded-2xl py-1 px-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#06B6D4] transition-transform duration-150 ${
                      canClick ? 'cursor-pointer hover:-translate-y-0.5' : 'cursor-default'
                    }`}
                  >
                    {/* 40px x 40px Standalone Numbered Circle */}
                    <span
                      className={`size-9 sm:size-10 rounded-full inline-flex items-center justify-center font-mono text-xs sm:text-sm font-semibold tabular-nums transition-colors duration-150 ${
                        isCurrent
                          ? 'bg-[#0E4D5D] dark:bg-[#0891B2] text-white shadow-[0_6px_16px_-4px_rgba(14,77,93,0.48)]'
                          : isCompleted
                          ? 'bg-[#F0FDFA] dark:bg-cyan-950/60 text-[#0E4D5D] dark:text-cyan-300 border-[1.25px] border-[#0E4D5D] dark:border-cyan-400/80'
                          : 'bg-white dark:bg-[#111C2D] text-[#475569] dark:text-[#94A3B8] border-[1.25px] border-[#64748B] dark:border-slate-600'
                      }`}
                    >
                      {step.id}
                    </span>

                    {/* Centered Step Title 14px Below Circle */}
                    <span
                      className={`mt-2.5 sm:mt-3.5 font-display text-[11px] sm:text-sm leading-tight tracking-tight truncate max-w-full sm:whitespace-nowrap ${
                        isCurrent
                          ? 'font-bold text-[#0F172A] dark:text-white'
                          : isCompleted
                          ? 'font-semibold text-[#0E4D5D] dark:text-cyan-300 group-hover:text-[#0F172A] dark:group-hover:text-white'
                          : 'font-normal text-[#475569] dark:text-[#94A3B8]'
                      }`}
                    >
                      <span className="hidden sm:inline">{step.label}</span>
                      <span className="sm:hidden">{step.shortLabel}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          {/* Continuous Bottom Progress Rail (6px height, rounded-full, Cyan #06B6D4 GPU scaleX fill) */}
          <div className="mt-5 sm:mt-7 px-2 sm:px-4">
            <div
              role="progressbar"
              aria-label="Tiến độ quy trình kiểm định và sửa lỗi"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressValuePct}
              aria-valuetext={`Bước ${activeSpec.id}/5: ${activeSpec.label} (${progressValuePct}%)`}
              className="h-1.5 w-full rounded-full bg-[#E2E8F0] dark:bg-[#1E293B] overflow-hidden"
            >
              <div
                className="h-full w-full origin-left rounded-full bg-[#06B6D4] transition-transform duration-200 ease-out"
                style={{ transform: `scaleX(${scaleFraction})` }}
              />
            </div>
          </div>

          {children && (
            <div className="mt-6 pt-5 border-t border-slate-200/80 dark:border-slate-800/80">
              {children}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
