import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquare, RefreshCw, Star } from 'lucide-react';
import {
  EXPERIENCE_STAR_LABELS,
  aggregateExperienceRatings,
  formatExperienceRelativeTime,
  type ExperienceRatingRecord,
} from '../core/experienceRatings';
import type { ExperienceDataSource } from '../services/experienceRatingService';

interface LandingExperienceStatsProps {
  hasUserRated: boolean;
  onOpenRatingModal: (initialStars?: 1 | 2 | 3 | 4 | 5) => void;
  latestSubmittedRating?: ExperienceRatingRecord | null;
}

const ASPECT_ITEMS = [
  { key: 'easeOfUse', label: 'Độ dễ sử dụng' },
  { key: 'usefulness', label: 'Độ hữu ích học tập' },
  { key: 'speedAndUi', label: 'Tốc độ & giao diện' },
] as const;

export const LandingExperienceStats: React.FC<LandingExperienceStatsProps> = ({
  hasUserRated,
  onOpenRatingModal,
  latestSubmittedRating,
}) => {
  const [ratings, setRatings] = useState<ExperienceRatingRecord[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<ExperienceDataSource | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [showAllComments, setShowAllComments] = useState(false);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;

    setStatus('loading');
    setErrorMessage(null);

    const connect = async () => {
      try {
        const { subscribeExperienceRatings } = await import(
          '../services/experienceRatingService'
        );
        if (!active) return;
        unsubscribe = subscribeExperienceRatings({
          onData: (records, source) => {
            if (!active) return;
            setRatings(records);
            setDataSource(source);
            setStatus('ready');
            setErrorMessage(null);
          },
          onError: (msg) => {
            if (!active) return;
            setErrorMessage(msg);
            setStatus('error');
          },
        });
      } catch {
        if (!active) return;
        setErrorMessage('Không thể khởi tạo luồng thống kê trải nghiệm trực tiếp.');
        setStatus('error');
      }
    };

    void connect();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [retryTick]);

  // Merge newly submitted rating optimistically if live stream has not echoed it yet
  const mergedRatings = useMemo(() => {
    if (!latestSubmittedRating) return ratings;
    const exists = ratings.some(
      (r) =>
        r.ratingId === latestSubmittedRating.ratingId &&
        r.updatedAt === latestSubmittedRating.updatedAt
    );
    if (exists) return ratings;
    return [
      latestSubmittedRating,
      ...ratings.filter((r) => r.ratingId !== latestSubmittedRating.ratingId),
    ];
  }, [ratings, latestSubmittedRating]);

  const stats = useMemo(() => aggregateExperienceRatings(mergedRatings), [mergedRatings]);
  const visibleComments = showAllComments
    ? stats.recentComments
    : stats.recentComments.slice(0, 4);

  const handleRetry = useCallback(() => {
    setRetryTick((t) => t + 1);
  }, []);

  return (
    <section
      id="experience-stats"
      aria-labelledby="experience-stats-heading"
      className="scroll-mt-8 mx-auto max-w-[1380px] px-4 sm:px-8 py-14 sm:py-20 border-t border-[#E6ECF5] dark:border-slate-800/80"
    >
      {/* Section Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 mb-8 sm:mb-10">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
            <span>Thống kê trải nghiệm người dùng</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1.5 text-[#5A677D] dark:text-slate-300 font-medium">
              {status === 'ready' && (
                <span
                  aria-hidden="true"
                  className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"
                />
              )}
              {status === 'ready'
                ? dataSource === 'firestore'
                  ? 'Cập nhật thời gian thực từ Firestore'
                  : 'Cập nhật trực tiếp theo thời gian thực'
                : status === 'loading'
                  ? 'Đang kết nối dữ liệu thực tế...'
                  : 'Mất kết nối luồng trực tiếp'}
            </span>
          </div>
          <h2
            id="experience-stats-heading"
            style={{ fontFamily: 'var(--font-condensed)' }}
            className="text-[clamp(2rem,3.8vw,3rem)] font-bold uppercase tracking-tight text-[#172033] dark:text-white mt-1 leading-[1.04] text-balance"
          >
            Đánh giá thực tế từ người dùng StudyCheck AI
          </h2>
          <p className="mt-2 text-sm text-[#5A677D] dark:text-slate-300 leading-[1.6]">
            Toàn bộ số liệu dưới đây được tổng hợp trực tiếp từ lượt đánh giá thật của người dùng, không sử dụng số liệu mẫu hay đánh giá giả lập.
          </p>
        </div>

        <div className="shrink-0">
          <button
            type="button"
            onClick={() => onOpenRatingModal()}
            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-full bg-[#F5A623] hover:bg-[#E09212] text-[#0A0F1A] text-sm font-bold transition-colors duration-150 cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#09111E]"
          >
            <Star className="w-4 h-4 fill-current shrink-0" aria-hidden="true" />
            <span>{hasUserRated ? 'Đã gửi đánh giá' : 'Viết đánh giá trải nghiệm'}</span>
          </button>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left Column: Real-Time Overall Rating & Star Distribution */}
        <div className="lg:col-span-5 rounded-3xl bg-white dark:bg-[#111B30] border border-[#E6ECF5] dark:border-slate-800 p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between gap-4 pb-6 border-b border-[#E6ECF5] dark:border-slate-800">
              <div>
                <p className="text-xs font-semibold text-[#5A677D] dark:text-slate-400">
                  Điểm trung bình tổng thể
                </p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span
                    data-testid="experience-average-score"
                    className="text-5xl font-bold tracking-tight text-[#172033] dark:text-white tabular-nums"
                  >
                    {stats.averageStars !== null ? stats.averageStars.toFixed(1) : '—'}
                  </span>
                  <span className="text-base font-semibold text-[#5A677D] dark:text-slate-400 tabular-nums">
                    / 5.0
                  </span>
                </div>

                <div
                  className="mt-2.5 flex items-center gap-1"
                  aria-label={
                    stats.averageStars !== null
                      ? `Điểm trung bình ${stats.averageStars.toFixed(1)} trên 5 sao`
                      : 'Chưa có điểm trung bình'
                  }
                >
                  {[1, 2, 3, 4, 5].map((starIndex) => {
                    const filled =
                      stats.averageStars !== null && starIndex <= Math.round(stats.averageStars);
                    return (
                      <Star
                        key={starIndex}
                        className={`w-4 h-4 ${
                          filled
                            ? 'text-[#F5A623] fill-[#F5A623]'
                            : 'text-slate-300 dark:text-slate-600'
                        }`}
                        aria-hidden="true"
                      />
                    );
                  })}
                </div>
              </div>

              <div className="text-right space-y-1">
                <p
                  data-testid="experience-total-count"
                  className="text-sm font-bold text-[#172033] dark:text-white tabular-nums"
                >
                  {stats.totalCount} lượt đánh giá
                </p>
                <p className="text-xs text-[#5A677D] dark:text-slate-400 tabular-nums">
                  {stats.satisfactionPercent !== null
                    ? `${stats.satisfactionPercent}% hài lòng (4–5 sao)`
                    : 'Chưa có thống kê hài lòng'}
                </p>
                {stats.verifiedAccountCount > 0 && (
                  <p className="text-xs text-emerald-700 dark:text-emerald-400 tabular-nums">
                    {stats.verifiedAccountCount} tài khoản đã xác thực
                  </p>
                )}
              </div>
            </div>

            {/* 5-star to 1-star Distribution Bars */}
            <div className="mt-6 space-y-3" aria-label="Phân bố theo số sao">
              {stats.distribution.map((bucket) => (
                <div key={bucket.star} className="flex items-center gap-3 text-xs">
                  <span className="w-11 font-semibold text-[#172033] dark:text-slate-200 tabular-nums shrink-0">
                    {bucket.star} sao
                  </span>
                  <div className="flex-1 h-2.5 rounded-full bg-[#EDF2F7] dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#F5A623] transition-[width] duration-300"
                      style={{ width: `${bucket.percent}%` }}
                    />
                  </div>
                  <span className="w-16 text-right text-[#5A677D] dark:text-slate-400 tabular-nums shrink-0">
                    {bucket.count} ({bucket.percent}%)
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Star Action Footer */}
          <div className="mt-7 pt-5 border-t border-[#E6ECF5] dark:border-slate-800">
            {hasUserRated ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5A677D] dark:text-slate-400">
                <span>Cảm ơn bạn đã gửi đánh giá trải nghiệm thực tế.</span>
                {stats.latestUpdatedAt && (
                  <span className="tabular-nums">
                    Cập nhật: {formatExperienceRelativeTime(stats.latestUpdatedAt)}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-medium text-[#5A677D] dark:text-slate-300">
                  Chọn sao để viết đánh giá:
                </span>
                <div className="flex items-center gap-1" role="group" aria-label="Chấm nhanh từ 1 đến 5 sao">
                  {([1, 2, 3, 4, 5] as const).map((starVal) => (
                    <button
                      key={starVal}
                      type="button"
                      onClick={() => onOpenRatingModal(starVal)}
                      aria-label={`Đánh giá ${starVal} sao - ${EXPERIENCE_STAR_LABELS[starVal]}`}
                      title={`${starVal} sao · ${EXPERIENCE_STAR_LABELS[starVal]}`}
                      className="w-9 h-9 rounded-full flex items-center justify-center text-slate-400 hover:text-[#F5A623] hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A623]"
                    >
                      <Star className="w-4 h-4" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Aspect Breakdown & Real User Comments */}
        <div className="lg:col-span-7 rounded-3xl bg-white dark:bg-[#111B30] border border-[#E6ECF5] dark:border-slate-800 p-6 sm:p-8 flex flex-col justify-between">
          <div>
            {/* Aspect Metrics Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 pb-6 border-b border-[#E6ECF5] dark:border-slate-800">
              {ASPECT_ITEMS.map((aspect) => {
                const avg = stats.aspectAverages[aspect.key];
                const pct = avg !== null ? Math.round((avg / 5) * 100) : 0;
                return (
                  <div key={aspect.key} className="space-y-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-xs font-semibold text-[#5A677D] dark:text-slate-400">
                        {aspect.label}
                      </p>
                      <span className="text-sm font-bold text-[#172033] dark:text-white tabular-nums">
                        {avg !== null ? `${avg.toFixed(1)}/5` : '—'}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#EDF2F7] dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#172033] dark:bg-[#F5A623] transition-[width] duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Real Comments Area */}
            <div className="mt-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h3 className="text-sm font-bold text-[#172033] dark:text-white">
                  Nhận xét thực tế gần đây
                </h3>
                <span className="text-xs text-[#5A677D] dark:text-slate-400 tabular-nums whitespace-nowrap shrink-0">
                  {stats.recentComments.length} nhận xét
                </span>
              </div>

              {status === 'loading' && stats.totalCount === 0 ? (
                <div className="space-y-4 py-4" aria-busy="true" aria-label="Đang tải đánh giá thực tế">
                  {[1, 2, 3].map((idx) => (
                    <div key={idx} className="space-y-2 animate-pulse">
                      <div className="h-3.5 w-44 rounded bg-slate-200 dark:bg-slate-800" />
                      <div className="h-4 w-full rounded bg-slate-100 dark:bg-slate-800/70" />
                    </div>
                  ))}
                </div>
              ) : status === 'error' && stats.totalCount === 0 ? (
                <div className="py-8 text-center space-y-3">
                  <p className="text-sm font-medium text-[#172033] dark:text-white">
                    {errorMessage || 'Không thể tải danh sách đánh giá lúc này.'}
                  </p>
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#D8E2F0] dark:border-slate-700 text-xs font-semibold text-[#172033] dark:text-white hover:border-[#F5A623] transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Thử kết nối lại</span>
                  </button>
                </div>
              ) : stats.totalCount === 0 ? (
                <div className="py-8 sm:py-10 text-center space-y-3">
                  <div className="mx-auto w-11 h-11 rounded-2xl bg-[#F8FAFC] dark:bg-slate-900 border border-[#E6ECF5] dark:border-slate-800 flex items-center justify-center text-[#5A677D] dark:text-slate-400">
                    <MessageSquare className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div className="space-y-1 max-w-md mx-auto">
                    <p className="text-sm font-bold text-[#172033] dark:text-white">
                      Chưa có lượt đánh giá nào được ghi nhận
                    </p>
                    <p className="text-xs sm:text-sm text-[#5A677D] dark:text-slate-400 leading-[1.6]">
                      Hệ thống chỉ thống kê từ đánh giá kèm nhận xét thật của người dùng và tuyệt đối không tạo số liệu giả. Hãy là người đầu tiên chia sẻ trải nghiệm của bạn.
                    </p>
                  </div>
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => onOpenRatingModal()}
                      className="inline-flex items-center justify-center min-h-[40px] px-4 py-2 rounded-full border border-[#172033] dark:border-slate-600 text-xs font-bold text-[#172033] dark:text-white hover:bg-[#172033] hover:text-white dark:hover:bg-white dark:hover:text-[#0A0F1A] transition-colors cursor-pointer"
                    >
                      Viết đánh giá đầu tiên
                    </button>
                  </div>
                </div>
              ) : stats.recentComments.length === 0 ? (
                <div className="py-8 text-center space-y-2">
                  <p className="text-sm font-semibold text-[#172033] dark:text-white tabular-nums">
                    Đã ghi nhận {stats.totalCount} lượt chấm điểm sao thực tế
                  </p>
                  <p className="text-xs sm:text-sm text-[#5A677D] dark:text-slate-400">
                    Chưa có nhận xét văn bản nào. Bạn có thể để lại góp ý chi tiết khi gửi đánh giá.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[#E6ECF5] dark:divide-slate-800">
                  {visibleComments.map((item) => (
                    <article key={item.ratingId} className="py-4 first:pt-1 last:pb-1">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex flex-wrap items-center gap-1.5 text-[#5A677D] dark:text-slate-400">
                          <span className="font-bold text-[#172033] dark:text-white">
                            {item.authorName}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{item.roleLabel}</span>
                          {item.isVerifiedAccount && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                                Đã xác thực
                              </span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <time dateTime={item.updatedAt || item.createdAt} className="tabular-nums">
                            {formatExperienceRelativeTime(item.updatedAt || item.createdAt)}
                          </time>
                        </div>

                        <div
                          className="inline-flex items-center gap-1.5 font-bold text-[#172033] dark:text-white tabular-nums shrink-0"
                          aria-label={`Đánh giá ${item.stars} trên 5 sao`}
                        >
                          <Star
                            className="w-3.5 h-3.5 text-[#F5A623] fill-[#F5A623]"
                            aria-hidden="true"
                          />
                          <span>{item.stars}/5</span>
                          {EXPERIENCE_STAR_LABELS[item.stars as 1 | 2 | 3 | 4 | 5] && (
                            <span className="text-[11px] font-medium text-[#5A677D] dark:text-slate-400">
                              · {EXPERIENCE_STAR_LABELS[item.stars as 1 | 2 | 3 | 4 | 5]}
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="mt-2 text-sm text-[#172033] dark:text-slate-200 leading-[1.65] break-words">
                        “{item.comment}”
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>

          {stats.recentComments.length > 4 && (
            <div className="mt-4 pt-4 border-t border-[#E6ECF5] dark:border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setShowAllComments((v) => !v)}
                className="text-xs font-bold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
              >
                {showAllComments
                  ? 'Thu gọn danh sách nhận xét'
                  : `Xem tất cả ${stats.recentComments.length} nhận xét`}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
