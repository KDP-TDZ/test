import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Award, Info, Medal, Trophy } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { GradeLevel, LeaderboardEntry } from '../core/types';
import { gsap, MOTION_ALLOWED_MEDIA, useGSAP } from '../lib/gsapSetup';
import { listLeaderboard } from '../services/firestoreService';
import { GlassSurface } from './LiquidGlass/GlassSurface';
import { LiquidCard } from './LiquidGlass/LiquidCard';
import { WaterRippleButton } from './LiquidGlass/WaterRippleButton';

interface LeaderboardViewProps {
  onOpenExams?: () => void;
}

export const LeaderboardView: React.FC<LeaderboardViewProps> = ({ onOpenExams }) => {
  const { user } = useAuth();
  const leaderboardRef = useRef<HTMLDivElement>(null);
  const [gradeFilter, setGradeFilter] = useState<'all' | GradeLevel>('all');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listLeaderboard(gradeFilter)
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gradeFilter]);

  const myRankInfo = useMemo(() => {
    if (!user) return null;
    const idx = entries.findIndex((e) => e.uid === user.uid);
    if (idx === -1) return null;
    return { rank: idx + 1, entry: entries[idx] };
  }, [entries, user]);

  const topThree = entries.slice(0, 3);

  useGSAP(
    () => {
      if (loading || entries.length === 0) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_ALLOWED_MEDIA, () => {
        const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
        tl.from('.podium-card', {
          y: 18,
          scale: 0.97,
          autoAlpha: 0,
          duration: 0.36,
          stagger: 0.06,
          clearProps: 'transform,opacity,visibility',
        }).from(
          '.leaderboard-row',
          {
            y: 10,
            autoAlpha: 0,
            duration: 0.24,
            stagger: 0.025,
            clearProps: 'transform,opacity,visibility',
          },
          '-=0.18'
        );
      });
    },
    { scope: leaderboardRef, dependencies: [loading, gradeFilter, entries.length] }
  );

  return (
    <div ref={leaderboardRef} className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#16243E] dark:text-[#E6EFFC] flex items-center gap-2.5">
            <Trophy className="w-7 h-7 text-amber-500" />
            Bảng Xếp Hạng Đua Top
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1">
            Thi đua thành tích kiểm tra Giữa kỳ, Cuối kỳ và Ôn tập tổng hợp giữa các Khối 10 / 11 / 12
            và Toàn trường.
          </p>
        </div>

        {onOpenExams && (
          <WaterRippleButton onClick={onOpenExams}>Làm đề thi tăng hạng</WaterRippleButton>
        )}
      </div>

      {/* Scope Tabs */}
      <div className="glass-segment inline-flex flex-wrap gap-1.5 rounded-2xl p-1.5">
        {(
          [
            ['all', 'Toàn trường'],
            ['10', 'Khối 10'],
            ['11', 'Khối 11'],
            ['12', 'Khối 12'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setGradeFilter(id)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
              gradeFilter === id
                ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-800/60'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Anti-Farming Fair Rules Banner */}
      <div className="glass-panel-subtle rounded-2xl px-4 py-3 text-xs text-sky-950 dark:text-sky-100 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
        <span>
          <strong>Quy tắc tính điểm công bằng:</strong> Mỗi đề kiểm tra được quy đổi tối đa 100 điểm
          dựa trên kết quả cao nhất của bạn ở đề đó. Khi thi lại cùng một đề, hệ thống chỉ cộng
          phần điểm chênh lệch tăng thêm để đảm bảo công bằng tuyệt đối.
        </span>
      </div>

      {/* Current User Rank Card */}
      <LiquidCard enableTilt={false} className="rounded-3xl p-5 sm:p-6 border border-sky-200/80 dark:border-sky-800/60">
        {myRankInfo ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 text-white font-mono font-bold text-lg flex items-center justify-center shadow-sm">
                #{myRankInfo.rank}
              </div>
              <div>
                <p className="text-sm font-bold text-[#16243E] dark:text-[#E6EFFC]">
                  Thứ hạng của bạn ({gradeFilter === 'all' ? 'Toàn trường' : `Khối ${gradeFilter}`})
                </p>
                <p className="text-xs text-[#475B78] dark:text-[#B4C7E2]">
                  {myRankInfo.entry.displayName} · Khối {myRankInfo.entry.grade}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-6 font-mono text-xs tabular-nums">
              <div>
                <p className="text-[#475B78] dark:text-[#B4C7E2]">Tổng điểm</p>
                <p className="text-lg font-bold text-sky-700 dark:text-sky-400">
                  {myRankInfo.entry.totalScore}
                </p>
              </div>
              <div>
                <p className="text-[#475B78] dark:text-[#B4C7E2]">Số đề đã thi</p>
                <p className="text-lg font-bold text-[#16243E] dark:text-[#E6EFFC]">
                  {myRankInfo.entry.examCount}
                </p>
              </div>
              <div>
                <p className="text-[#475B78] dark:text-[#B4C7E2]">Điểm TB / đề</p>
                <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                  {myRankInfo.entry.averagePercent}%
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <p className="text-[#475B78] dark:text-[#B4C7E2]">
              Bạn chưa có điểm trong bảng xếp hạng{' '}
              {gradeFilter === 'all' ? 'Toàn trường' : `Khối ${gradeFilter}`}. Hãy hoàn thành ít
              nhất 1 đề kiểm tra để ghi danh.
            </p>
            {onOpenExams && (
              <button
                type="button"
                onClick={onOpenExams}
                className="font-semibold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
              >
                Vào Trung tâm Đề kiểm tra →
              </button>
            )}
          </div>
        )}
      </LiquidCard>

      {/* Top 3 Podium */}
      {!loading && topThree.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {topThree.map((item, idx) => (
            <LiquidCard
              key={item.uid}
              className={`podium-card rounded-3xl p-5 space-y-2 border ${
                idx === 0
                  ? 'border-amber-300/90 dark:border-amber-700/70'
                  : idx === 1
                  ? 'border-sky-300/80 dark:border-slate-600'
                  : 'border-orange-300/80 dark:border-orange-800/70'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 font-mono text-sm font-bold text-amber-600 dark:text-amber-400">
                  <Medal className="w-4 h-4" />
                  Hạng #{idx + 1}
                </span>
                <span className="text-xs font-mono text-[#475B78] dark:text-[#B4C7E2]">
                  Khối {item.grade}
                </span>
              </div>
              <p className="font-display text-base font-bold text-[#16243E] dark:text-[#E6EFFC] truncate">
                {item.displayName}
              </p>
              <div className="flex items-baseline justify-between font-mono text-xs tabular-nums pt-1">
                <span className="text-xl font-bold text-sky-700 dark:text-sky-400">
                  {item.totalScore} điểm
                </span>
                <span className="text-[#475B78] dark:text-[#B4C7E2]">
                  {item.examCount} đề · TB {item.averagePercent}%
                </span>
              </div>
            </LiquidCard>
          ))}
        </div>
      )}

      {/* Full Leaderboard Table */}
      <GlassSurface className="rounded-3xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Đang tải bảng xếp hạng...</div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center space-y-2 text-sm text-slate-600 dark:text-slate-300">
            <Award className="w-8 h-8 text-sky-600 dark:text-sky-400 mx-auto" />
            <p>Chưa có học sinh nào ghi điểm trong bảng xếp hạng này.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-sky-200/70 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-3.5 px-4 font-semibold">Hạng</th>
                  <th className="py-3.5 px-4 font-semibold">Học sinh</th>
                  <th className="py-3.5 px-4 font-semibold">Khối</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Số đề</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Cao nhất / đề</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Trung bình</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Tổng điểm Đua Top</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sky-200/50 dark:divide-slate-800">
                {entries.map((entry, idx) => {
                  const isMe = user?.uid === entry.uid;
                  return (
                    <tr
                      key={entry.uid}
                      className={`leaderboard-row ${
                        isMe
                          ? 'bg-sky-100/60 dark:bg-sky-950/45 font-semibold'
                          : 'hover:bg-white/60 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-3 px-4 font-mono tabular-nums">#{idx + 1}</td>
                      <td className="py-3 px-4 text-[#16243E] dark:text-[#E6EFFC]">
                        {entry.displayName} {isMe && '(Bạn)'}
                      </td>
                      <td className="py-3 px-4 font-mono">Lớp {entry.grade}</td>
                      <td className="py-3 px-4 font-mono text-right tabular-nums">
                        {entry.examCount}
                      </td>
                      <td className="py-3 px-4 font-mono text-right tabular-nums">
                        {entry.bestExamScore}/100
                      </td>
                      <td className="py-3 px-4 font-mono text-right tabular-nums">
                        {entry.averagePercent}%
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-right tabular-nums text-sky-700 dark:text-sky-400">
                        {entry.totalScore}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassSurface>
    </div>
  );
};
