import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, Clock, Star, X } from 'lucide-react';
import {
  EXPERIENCE_MAX_AUTHOR_LENGTH,
  EXPERIENCE_MAX_COMMENT_LENGTH,
  EXPERIENCE_MIN_COMMENT_LENGTH,
  EXPERIENCE_REMIND_HOURS,
  EXPERIENCE_ROLE_OPTIONS,
  EXPERIENCE_STAR_LABELS,
  readPromptStorageState,
  savePromptRated,
  savePromptSnooze,
  shouldShowExperiencePrompt,
  type ExperienceRatingRecord,
  type ExperienceRoleLabel,
  type RatingPromptStorageState,
} from '../core/experienceRatings';

interface ExperienceRatingPromptProps {
  enabled?: boolean;
  userUid?: string | null;
  userEmailVerified?: boolean;
  defaultDisplayName?: string | null;
  defaultGrade?: '10' | '11' | '12' | null;
  externalOpenRequest: { id: number; initialStars?: 1 | 2 | 3 | 4 | 5 } | null;
  onStatusChange?: (status: { hasRated: boolean; lastRecord?: ExperienceRatingRecord | null }) => void;
}

const ASPECT_FIELDS = [
  { key: 'easeOfUse', label: 'Độ dễ sử dụng' },
  { key: 'usefulness', label: 'Độ hữu ích học tập' },
  { key: 'speedAndUi', label: 'Tốc độ & giao diện' },
] as const;

type AspectKey = (typeof ASPECT_FIELDS)[number]['key'];

function resolveDefaultRole(
  grade?: '10' | '11' | '12' | null,
  isSignedIn?: boolean
): ExperienceRoleLabel {
  if (grade === '10') return 'Học sinh lớp 10';
  if (grade === '11') return 'Học sinh lớp 11';
  if (grade === '12') return 'Học sinh lớp 12';
  return isSignedIn ? 'Học sinh lớp 12' : 'Khách trải nghiệm';
}

export const ExperienceRatingPrompt: React.FC<ExperienceRatingPromptProps> = ({
  enabled = true,
  userUid,
  userEmailVerified,
  defaultDisplayName,
  defaultGrade,
  externalOpenRequest,
  onStatusChange,
}) => {
  const modalTitleId = useId();
  const scopeKey = userUid && userEmailVerified ? `uid_${userUid}` : 'browser';

  const [storageState, setStorageState] = useState<RatingPromptStorageState>(() =>
    readPromptStorageState(typeof window !== 'undefined' ? window.localStorage : null, scopeKey)
  );
  const [remoteRecord, setRemoteRecord] = useState<ExperienceRatingRecord | null>(null);
  const [remoteChecked, setRemoteChecked] = useState<boolean>(!(userUid && userEmailVerified));
  const [bannerVisible, setBannerVisible] = useState<boolean>(false);
  const [statsSectionInView, setStatsSectionInView] = useState<boolean>(false);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [snoozeToast, setSnoozeToast] = useState<string | null>(null);

  // Form state
  const [stars, setStars] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [hoverStars, setHoverStars] = useState<number>(0);
  const [aspects, setAspects] = useState<Record<AspectKey, number>>({
    easeOfUse: 0,
    usefulness: 0,
    speedAndUi: 0,
  });
  const [roleLabel, setRoleLabel] = useState<ExperienceRoleLabel>(() =>
    resolveDefaultRole(defaultGrade, Boolean(userUid))
  );
  const [authorName, setAuthorName] = useState<string>(defaultDisplayName || '');
  const [comment, setComment] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedRecord, setSubmittedRecord] = useState<ExperienceRatingRecord | null>(null);

  const lastHandledRequestId = useRef<number>(0);
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);
  const shouldFocusCommentRef = useRef<boolean>(false);

  const hasRated = Boolean(remoteRecord || storageState.hasRated);

  // Sync local storage state when user scope changes
  useEffect(() => {
    const storage = typeof window !== 'undefined' ? window.localStorage : null;
    const browserState = readPromptStorageState(storage, 'browser');
    const scopedState =
      scopeKey === 'browser' ? browserState : readPromptStorageState(storage, scopeKey);

    // Respect prior snooze or rating across guest -> signed-in transition on same browser
    const merged: RatingPromptStorageState = {
      visitorId: browserState.visitorId,
      hasRated: scopedState.hasRated || browserState.hasRated,
      ratedRatingId: scopedState.ratedRatingId || browserState.ratedRatingId,
      ratedAt: scopedState.ratedAt || browserState.ratedAt,
      remindAfter: Math.max(scopedState.remindAfter || 0, browserState.remindAfter || 0) || undefined,
    };
    setStorageState(merged);
  }, [scopeKey]);

  // If signed in with verified account, check remote rating so rated users aren't re-prompted across devices
  useEffect(() => {
    let active = true;
    if (!userUid || !userEmailVerified) {
      setRemoteRecord(null);
      setRemoteChecked(true);
      return;
    }

    setRemoteChecked(false);
    const checkRemote = async () => {
      try {
        const { getUserExperienceRating } = await import(
          '../services/experienceRatingService'
        );
        const existing = await getUserExperienceRating(userUid);
        if (!active) return;
        setRemoteRecord(existing);
        if (existing) {
          const storage = typeof window !== 'undefined' ? window.localStorage : null;
          savePromptRated(storage, existing.ratingId, Date.now(), scopeKey);
          savePromptRated(storage, existing.ratingId, Date.now(), 'browser');
          setStorageState((prev) => ({
            ...prev,
            hasRated: true,
            ratedRatingId: existing.ratingId,
          }));
        }
      } catch {
        // Ignore transient lookup failure
      } finally {
        if (active) setRemoteChecked(true);
      }
    };

    void checkRemote();
    return () => {
      active = false;
    };
  }, [userUid, userEmailVerified, scopeKey]);

  // Notify parent when rated status changes
  useEffect(() => {
    onStatusChange?.({
      hasRated,
      lastRecord: submittedRecord || remoteRecord,
    });
  }, [hasRated, submittedRecord, remoteRecord, onStatusChange]);

  // Hide floating banner temporarily while user is looking directly at #experience-stats to avoid overlapping its CTA
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const statsEl = document.getElementById('experience-stats');
    if (!statsEl) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setStatsSectionInView(Boolean(entry?.isIntersecting));
      },
      { threshold: 0.25 }
    );
    observer.observe(statsEl);
    return () => observer.disconnect();
  }, [userUid]);

  // Decide whether to show arrival invitation banner
  useEffect(() => {
    if (!enabled) {
      setBannerVisible(false);
      setModalOpen(false);
      return;
    }
    if (!remoteChecked) return;
    if (modalOpen) {
      setBannerVisible(false);
      return;
    }

    const shouldShow = shouldShowExperiencePrompt({
      state: storageState,
      hasRemoteAccountRating: Boolean(remoteRecord),
      nowMs: Date.now(),
    });

    if (!shouldShow) {
      setBannerVisible(false);
      return;
    }

    // Gentle short delay so initial hero paint stays instant, then invites unrated visitors
    const timer = window.setTimeout(() => {
      setBannerVisible(true);
    }, 900);

    return () => window.clearTimeout(timer);
  }, [enabled, remoteChecked, storageState, remoteRecord, modalOpen]);

  const openModalWithPreset = useCallback(
    (initialStars?: 1 | 2 | 3 | 4 | 5) => {
      setBannerVisible(false);
      setSubmitError(null);
      setSubmittedRecord(null);

      if (remoteRecord && !initialStars) {
        setStars(remoteRecord.stars as 1 | 2 | 3 | 4 | 5);
        setAspects({
          easeOfUse: remoteRecord.easeOfUse,
          usefulness: remoteRecord.usefulness,
          speedAndUi: remoteRecord.speedAndUi,
        });
        setRoleLabel(remoteRecord.roleLabel);
        setAuthorName(remoteRecord.authorName);
        setComment(remoteRecord.comment || '');
      } else {
        const preset = initialStars ?? 0;
        setStars(preset);
        setAspects({
          easeOfUse: preset,
          usefulness: preset,
          speedAndUi: preset,
        });
        setRoleLabel(resolveDefaultRole(defaultGrade, Boolean(userUid)));
        if (defaultDisplayName && !authorName) {
          setAuthorName(defaultDisplayName);
        }
      }

      shouldFocusCommentRef.current = Boolean(initialStars);
      setModalOpen(true);
    },
    [remoteRecord, defaultGrade, userUid, defaultDisplayName, authorName]
  );

  // Focus written comment box immediately when opened via quick star selection
  useEffect(() => {
    if (!modalOpen || !shouldFocusCommentRef.current) return;
    shouldFocusCommentRef.current = false;
    const raf = window.requestAnimationFrame(() => {
      commentInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [modalOpen]);

  // Handle external open requests (e.g., from LandingExperienceStats CTA or quick star click)
  useEffect(() => {
    if (!enabled) return;
    if (!externalOpenRequest) return;
    if (externalOpenRequest.id === lastHandledRequestId.current) return;
    lastHandledRequestId.current = externalOpenRequest.id;
    openModalWithPreset(externalOpenRequest.initialStars);
  }, [enabled, externalOpenRequest, openModalWithPreset]);

  // Escape key closes modal
  useEffect(() => {
    if (!modalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        setModalOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [modalOpen, submitting]);

  // Auto-hide snooze confirmation toast
  useEffect(() => {
    if (!snoozeToast) return;
    const timer = window.setTimeout(() => setSnoozeToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [snoozeToast]);

  const handleRemindLater = useCallback(() => {
    const now = Date.now();
    const storage = typeof window !== 'undefined' ? window.localStorage : null;
    const nextBrowser = savePromptSnooze(storage, now, 'browser', EXPERIENCE_REMIND_HOURS);
    if (scopeKey !== 'browser') {
      savePromptSnooze(storage, now, scopeKey, EXPERIENCE_REMIND_HOURS);
    }
    setStorageState(nextBrowser);
    setBannerVisible(false);
    setModalOpen(false);
    setSnoozeToast(`Đã hẹn nhắc lại sau ${EXPERIENCE_REMIND_HOURS} giờ.`);
  }, [scopeKey]);

  const handleSelectOverallStars = (value: 1 | 2 | 3 | 4 | 5) => {
    setStars(value);
    setSubmitError(null);
    setAspects((prev) => ({
      easeOfUse: prev.easeOfUse || value,
      usefulness: prev.usefulness || value,
      speedAndUi: prev.speedAndUi || value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (stars < 1 || stars > 5) {
      setSubmitError('Vui lòng chọn từ 1 đến 5 sao trước khi gửi đánh giá.');
      return;
    }

    const trimmedComment = comment.trim();
    if (trimmedComment.length === 0) {
      setSubmitError('Vui lòng viết nhận xét về trải nghiệm của bạn trước khi gửi đánh giá.');
      commentInputRef.current?.focus();
      return;
    }
    if (trimmedComment.length < EXPERIENCE_MIN_COMMENT_LENGTH) {
      setSubmitError(
        `Nhận xét cần tối thiểu ${EXPERIENCE_MIN_COMMENT_LENGTH} ký tự để chia sẻ rõ trải nghiệm của bạn.`
      );
      commentInputRef.current?.focus();
      return;
    }
    if (trimmedComment.length > EXPERIENCE_MAX_COMMENT_LENGTH) {
      setSubmitError(`Nhận xét tối đa ${EXPERIENCE_MAX_COMMENT_LENGTH} ký tự.`);
      commentInputRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const { submitExperienceRating } = await import(
        '../services/experienceRatingService'
      );
      const saved = await submitExperienceRating({
        input: {
          stars,
          easeOfUse: aspects.easeOfUse || stars,
          usefulness: aspects.usefulness || stars,
          speedAndUi: aspects.speedAndUi || stars,
          roleLabel,
          authorName: authorName.trim(),
          comment: comment.trim(),
        },
        visitorId: storageState.visitorId,
        existingRecord: remoteRecord,
      });

      const now = Date.now();
      const storage = typeof window !== 'undefined' ? window.localStorage : null;
      const nextState = savePromptRated(storage, saved.ratingId, now, 'browser');
      if (scopeKey !== 'browser') {
        savePromptRated(storage, saved.ratingId, now, scopeKey);
      }
      setStorageState(nextState);
      if (userUid && userEmailVerified) {
        setRemoteRecord(saved);
      }
      setSubmittedRecord(saved);
      setBannerVisible(false);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Không thể gửi đánh giá lúc này. Vui lòng thử lại.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const activeStarValue = (hoverStars || stars) as 0 | 1 | 2 | 3 | 4 | 5;
  const isGuestAlreadyRated = hasRated && !(userUid && userEmailVerified);

  if (!enabled) {
    return null;
  }

  return (
    <>
      {/* 1. Arrival Invitation Notification for Unrated Visitors (with 6h Remind Later) */}
      {bannerVisible && !modalOpen && !statsSectionInView && (
        <aside
          role="region"
          aria-label="Thông báo mời đánh giá trang web"
          data-testid="experience-rating-prompt-banner"
          className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 w-[min(392px,calc(100vw-2rem))] rounded-2xl bg-white dark:bg-[#111B30] border border-[#DCE5F2] dark:border-slate-700/90 shadow-[0_20px_50px_-15px_rgba(10,15,26,0.35)] p-5 text-[#172033] dark:text-[#E6EFFC]"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                Mời đánh giá trải nghiệm
              </p>
              <h3 className="mt-0.5 text-base font-bold text-[#172033] dark:text-white leading-snug">
                Bạn thấy StudyCheck AI thế nào?
              </h3>
            </div>
            <button
              type="button"
              onClick={handleRemindLater}
              aria-label="Đóng thông báo và nhắc lại sau 6 giờ"
              className="w-8 h-8 -mt-1 -mr-1 rounded-full flex items-center justify-center text-[#5A677D] dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623]"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <p className="mt-1.5 text-xs sm:text-[13px] text-[#5A677D] dark:text-slate-300 leading-[1.55]">
            Chấm sao và viết vài dòng nhận xét thực tế. Đánh giá của bạn sẽ cập nhật trực tiếp lên bảng thống kê trang chủ.
          </p>

          {/* Quick 1-5 star picker inside notification */}
          <div
            className="mt-3.5 flex items-center justify-between gap-1 rounded-xl bg-[#F8FAFC] dark:bg-slate-900/70 border border-[#E6ECF5] dark:border-slate-800 px-3 py-2"
            role="group"
            aria-label="Chọn nhanh số sao để viết đánh giá"
          >
            <span className="text-xs font-medium text-[#5A677D] dark:text-slate-400">
              Chọn sao & viết:
            </span>
            <div className="flex items-center gap-0.5">
              {([1, 2, 3, 4, 5] as const).map((starVal) => (
                <button
                  key={starVal}
                  type="button"
                  onClick={() => openModalWithPreset(starVal)}
                  aria-label={`Đánh giá ${starVal} sao - ${EXPERIENCE_STAR_LABELS[starVal]}`}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-slate-400 hover:text-[#F5A623] hover:bg-amber-50 dark:hover:bg-amber-950/50 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623]"
                >
                  <Star className="w-4 h-4" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>

          {/* Primary + 6h Remind Later Actions */}
          <div className="mt-4 flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => openModalWithPreset()}
              className="flex-1 min-h-[40px] px-4 py-2 rounded-full bg-[#F5A623] hover:bg-[#E09212] text-[#0A0F1A] text-xs font-bold transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623]"
            >
              Viết đánh giá ngay
            </button>
            <button
              type="button"
              onClick={handleRemindLater}
              className="inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-full border border-[#D8E2F0] dark:border-slate-700 text-xs font-semibold text-[#5A677D] dark:text-slate-300 hover:text-[#172033] dark:hover:text-white hover:border-slate-400 transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623]"
            >
              <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Nhắc lại sau 6 giờ</span>
            </button>
          </div>
        </aside>
      )}

      {/* 2. Brief Confirmation Toast After Snoozing 6h */}
      {snoozeToast && (
        <div
          role="status"
          aria-live="polite"
          data-testid="experience-snooze-toast"
          className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 rounded-full bg-[#172033] dark:bg-slate-800 text-white border border-slate-700 px-4 py-2.5 text-xs font-medium shadow-lg flex items-center gap-2"
        >
          <Clock className="w-3.5 h-3.5 text-[#F5A623] shrink-0" aria-hidden="true" />
          <span>{snoozeToast}</span>
        </div>
      )}

      {/* 3. Full Accessible Experience Rating Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !submitting) {
              setModalOpen(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalTitleId}
            className="w-full max-w-lg max-h-[94dvh] overflow-y-auto rounded-3xl bg-white dark:bg-[#111B30] border border-[#E6ECF5] dark:border-slate-800 shadow-2xl p-5 sm:p-6 text-[#172033] dark:text-[#E6EFFC]"
          >
            <div className="flex items-start justify-between gap-4 pb-3 border-b border-[#E6ECF5] dark:border-slate-800">
              <div>
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                  Đóng góp trải nghiệm thực tế
                </p>
                <h2
                  id={modalTitleId}
                  className="mt-0.5 text-lg sm:text-xl font-bold text-[#172033] dark:text-white"
                >
                  Đánh giá trang web StudyCheck AI
                </h2>
              </div>
              <button
                type="button"
                onClick={() => !submitting && setModalOpen(false)}
                aria-label="Đóng hộp thoại đánh giá"
                className="w-9 h-9 rounded-full flex items-center justify-center text-[#5A677D] dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623]"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {submittedRecord || isGuestAlreadyRated ? (
              <div className="py-8 text-center space-y-4">
                <div className="mx-auto w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6" aria-hidden="true" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-lg font-bold text-[#172033] dark:text-white">
                    {submittedRecord
                      ? 'Cảm ơn bạn đã gửi đánh giá!'
                      : 'Bạn đã gửi đánh giá trên trình duyệt này'}
                  </h3>
                  <p className="text-sm text-[#5A677D] dark:text-slate-300 leading-[1.6]">
                    {submittedRecord
                      ? `Đánh giá ${submittedRecord.stars}/5 sao kèm nhận xét của bạn đã được ghi nhận và cập nhật ngay lên bảng thống kê thời gian thực trên trang chủ.`
                      : 'Đánh giá của bạn đã được tính vào bảng thống kê thời gian thực. Để đảm bảo minh bạch, mỗi trình duyệt chỉ gửi một lượt đánh giá khách; bạn có thể đăng nhập tài khoản để quản lý đánh giá riêng.'}
                  </p>
                  {submittedRecord?.comment && (
                    <blockquote className="mt-3 rounded-2xl bg-[#F8FAFC] dark:bg-slate-900/70 border border-[#E6ECF5] dark:border-slate-800 px-4 py-3 text-left text-xs sm:text-sm text-[#172033] dark:text-slate-200 leading-[1.6] break-words">
                      “{submittedRecord.comment}”
                    </blockquote>
                  )}
                </div>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="inline-flex items-center justify-center min-h-[42px] px-6 py-2 rounded-full bg-[#172033] dark:bg-[#F5A623] text-white dark:text-[#0A0F1A] text-sm font-bold hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    Hoàn tất
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="mt-4 space-y-3.5" noValidate>
                {/* Overall Star Rating */}
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-sm font-semibold text-[#172033] dark:text-white">
                      Mức độ hài lòng tổng thể <span className="text-rose-600">*</span>
                    </span>
                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 tabular-nums">
                      {activeStarValue > 0
                        ? `${activeStarValue} sao · ${
                            EXPERIENCE_STAR_LABELS[activeStarValue as 1 | 2 | 3 | 4 | 5]
                          }`
                        : 'Chưa chọn sao'}
                    </span>
                  </div>
                  <div
                    className="flex items-center gap-1.5"
                    role="radiogroup"
                    aria-label="Chọn số sao tổng thể từ 1 đến 5"
                  >
                    {([1, 2, 3, 4, 5] as const).map((val) => {
                      const active = val <= activeStarValue;
                      return (
                        <button
                          key={val}
                          type="button"
                          role="radio"
                          aria-checked={stars === val}
                          aria-label={`${val} sao - ${EXPERIENCE_STAR_LABELS[val]}`}
                          onMouseEnter={() => setHoverStars(val)}
                          onMouseLeave={() => setHoverStars(0)}
                          onClick={() => handleSelectOverallStars(val)}
                          className={`w-11 h-11 rounded-2xl border flex items-center justify-center transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623] ${
                            active
                              ? 'border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/50 text-[#F5A623]'
                              : 'border-[#E6ECF5] dark:border-slate-800 bg-[#F8FAFC] dark:bg-slate-900/60 text-slate-400 hover:border-amber-300'
                          }`}
                        >
                          <Star
                            className={`w-5 h-5 ${active ? 'fill-[#F5A623]' : ''}`}
                            aria-hidden="true"
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Required Written Review (front-and-center right below stars) */}
                <div className="pt-3 border-t border-[#E6ECF5] dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <label
                      htmlFor="experience-comment"
                      className="text-sm font-semibold text-[#172033] dark:text-white"
                    >
                      Nhận xét trải nghiệm của bạn <span className="text-rose-600">*</span>
                    </label>
                    <span className="text-[11px] text-[#5A677D] dark:text-slate-400 tabular-nums whitespace-nowrap">
                      {comment.trim().length < EXPERIENCE_MIN_COMMENT_LENGTH
                        ? `Tối thiểu ${EXPERIENCE_MIN_COMMENT_LENGTH} ký tự · ${comment.length}/${EXPERIENCE_MAX_COMMENT_LENGTH}`
                        : `${comment.length}/${EXPERIENCE_MAX_COMMENT_LENGTH}`}
                    </span>
                  </div>
                  <textarea
                    ref={commentInputRef}
                    id="experience-comment"
                    required
                    rows={3}
                    value={comment}
                    onChange={(e) => {
                      setComment(e.target.value);
                      if (submitError) setSubmitError(null);
                    }}
                    minLength={EXPERIENCE_MIN_COMMENT_LENGTH}
                    maxLength={EXPERIENCE_MAX_COMMENT_LENGTH}
                    aria-required="true"
                    aria-invalid={
                      Boolean(submitError) && comment.trim().length < EXPERIENCE_MIN_COMMENT_LENGTH
                    }
                    placeholder="Chia sẻ điều bạn thấy hữu ích nhất hoặc điểm StudyCheck AI cần cải thiện..."
                    className="w-full px-3.5 py-2 rounded-xl bg-[#F8FAFC] dark:bg-slate-900/70 border border-[#D8E2F0] dark:border-slate-700 text-sm text-[#172033] dark:text-white placeholder:text-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-[#F5A623]"
                  />
                </div>

                {/* 3 Experience Aspect Ratings */}
                <div className="space-y-2 pt-3 border-t border-[#E6ECF5] dark:border-slate-800">
                  <p className="text-xs font-semibold text-[#5A677D] dark:text-slate-400">
                    Đánh giá chi tiết từng khía cạnh
                  </p>
                  {ASPECT_FIELDS.map((field) => {
                    const currentVal = aspects[field.key];
                    return (
                      <div
                        key={field.key}
                        className="flex items-center justify-between gap-3"
                      >
                        <span className="text-xs sm:text-sm font-medium text-[#172033] dark:text-slate-200">
                          {field.label}
                        </span>
                        <div
                          className="flex items-center gap-1"
                          role="group"
                          aria-label={`${field.label} từ 1 đến 5 sao`}
                        >
                          {([1, 2, 3, 4, 5] as const).map((val) => {
                            const filled = val <= currentVal;
                            return (
                              <button
                                key={val}
                                type="button"
                                onClick={() =>
                                  setAspects((prev) => ({ ...prev, [field.key]: val }))
                                }
                                aria-label={`${field.label} ${val} sao`}
                                aria-pressed={currentVal === val}
                                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623]"
                              >
                                <Star
                                  className={`w-4 h-4 ${
                                    filled
                                      ? 'text-[#F5A623] fill-[#F5A623]'
                                      : 'text-slate-300 dark:text-slate-600'
                                  }`}
                                  aria-hidden="true"
                                />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Role Selector */}
                <div className="pt-3 border-t border-[#E6ECF5] dark:border-slate-800">
                  <p className="text-xs font-semibold text-[#5A677D] dark:text-slate-400 mb-1.5">
                    Vai trò của bạn
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {EXPERIENCE_ROLE_OPTIONS.map((option) => {
                      const active = roleLabel === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setRoleLabel(option)}
                          aria-pressed={active}
                          className={`min-h-[32px] px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                            active
                              ? 'bg-[#172033] dark:bg-[#F5A623] text-white dark:text-[#0A0F1A]'
                              : 'bg-[#F1F5F9] dark:bg-slate-800/80 text-[#5A677D] dark:text-slate-300 hover:text-[#172033] dark:hover:text-white'
                          }`}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Optional Display Name */}
                <div className="pt-3 border-t border-[#E6ECF5] dark:border-slate-800">
                  <label
                    htmlFor="experience-author-name"
                    className="block text-xs font-semibold text-[#5A677D] dark:text-slate-400 mb-1"
                  >
                    Tên hiển thị (không bắt buộc)
                  </label>
                  <input
                    id="experience-author-name"
                    type="text"
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    maxLength={EXPERIENCE_MAX_AUTHOR_LENGTH}
                    placeholder="Ví dụ: Minh Anh (để trống sẽ hiển thị theo vai trò)"
                    className="w-full h-9 px-3.5 rounded-xl bg-[#F8FAFC] dark:bg-slate-900/70 border border-[#D8E2F0] dark:border-slate-700 text-sm text-[#172033] dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#F5A623]"
                  />
                </div>

                {submitError && (
                  <p
                    role="alert"
                    className="text-xs font-semibold text-rose-700 dark:text-rose-400"
                  >
                    {submitError}
                  </p>
                )}

                <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                  {!hasRated ? (
                    <button
                      type="button"
                      onClick={handleRemindLater}
                      disabled={submitting}
                      className="inline-flex items-center gap-1.5 min-h-[42px] px-4 py-2 rounded-full border border-[#D8E2F0] dark:border-slate-700 text-xs font-semibold text-[#5A677D] dark:text-slate-300 hover:text-[#172033] dark:hover:text-white transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>Nhắc lại sau 6 giờ</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setModalOpen(false)}
                      disabled={submitting}
                      className="min-h-[42px] px-4 py-2 rounded-full border border-[#D8E2F0] dark:border-slate-700 text-xs font-semibold text-[#5A677D] dark:text-slate-300 hover:text-[#172033] dark:hover:text-white transition-colors cursor-pointer whitespace-nowrap"
                    >
                      Hủy
                    </button>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center justify-center min-h-[42px] px-6 py-2 rounded-full bg-[#F5A623] hover:bg-[#E09212] disabled:opacity-60 text-[#0A0F1A] text-sm font-bold transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623]"
                  >
                    {submitting
                      ? 'Đang gửi...'
                      : remoteRecord
                        ? 'Cập nhật đánh giá'
                        : 'Gửi đánh giá'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
};
