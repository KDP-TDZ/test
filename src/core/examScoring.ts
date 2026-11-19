import type {
  AnalysisRecord,
  ExamAttemptBreakdownItem,
  ExamDocument,
  ExamQuestionAnswer,
  GradeLevel,
  LeaderboardEntry,
} from './types';

function normalizeShortAnswer(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/,/g, '.')
    .replace(/\s+/g, '');
}

/**
 * Deterministically grades an exam submission across ABCD, True/False (partial rubric), and Short Answer items.
 */
export function gradeExamSubmission(
  exam: ExamDocument,
  answers: ExamQuestionAnswer[]
): {
  earnedScore: number;
  maxScore: number;
  percentScore: number;
  breakdown: ExamAttemptBreakdownItem[];
} {
  const answerMap = new Map<string, ExamQuestionAnswer>();
  for (const ans of answers) {
    answerMap.set(ans.questionId, ans);
  }

  let earnedScore = 0;
  let maxScore = 0;
  const breakdown: ExamAttemptBreakdownItem[] = [];

  for (const q of exam.questions) {
    const qMax = q.scoreWeight || 0.25;
    maxScore += qMax;
    const ans = answerMap.get(q.questionId);
    let qEarned = 0;
    let isFullCorrect = false;
    let correctDisplay = '';
    let studentDisplay = 'Chưa trả lời';

    if (q.questionType === 'abcd') {
      correctDisplay = q.correctAnswer || 'A';
      studentDisplay = ans?.selectedOption || 'Chưa chọn';
      if (ans?.selectedOption && ans.selectedOption === q.correctAnswer) {
        qEarned = qMax;
        isFullCorrect = true;
      }
    } else if (q.questionType === 'true_false') {
      const statements = q.trueFalseStatements || [];
      correctDisplay = statements
        .map((s) => `${s.label}:${s.isTrue ? 'Đ' : 'S'}`)
        .join(' · ');

      const chosen = ans?.trueFalseChoices || {};
      studentDisplay = statements
        .map((s) => {
          const val = chosen[s.label];
          return `${s.label}:${val === undefined ? '-' : val ? 'Đ' : 'S'}`;
        })
        .join(' · ');

      let matchCount = 0;
      for (const s of statements) {
        if (chosen[s.label] !== undefined && chosen[s.label] === s.isTrue) {
          matchCount += 1;
        }
      }

      // Standard Vietnamese GDPT 2025 Đúng/Sai rubric: 1->0.1, 2->0.25, 3->0.5, 4->1.0 of question maxScore
      const ratio =
        matchCount === 4
          ? 1.0
          : matchCount === 3
            ? 0.5
            : matchCount === 2
              ? 0.25
              : matchCount === 1
                ? 0.1
                : 0;
      qEarned = Math.round(qMax * ratio * 1000) / 1000;
      isFullCorrect = statements.length > 0 && matchCount === statements.length;
    } else {
      const accepted = (q.shortAnswerAccepted || []).map(normalizeShortAnswer).filter(Boolean);
      correctDisplay = (q.shortAnswerAccepted || [])[0] || '';
      const rawInput = (ans?.shortAnswerText || '').trim();
      studentDisplay = rawInput || 'Chưa trả lời';
      const normalizedInput = normalizeShortAnswer(rawInput);

      if (normalizedInput && accepted.includes(normalizedInput)) {
        qEarned = qMax;
        isFullCorrect = true;
      } else if (normalizedInput) {
        const numInput = Number(normalizedInput);
        if (Number.isFinite(numInput)) {
          const numericMatch = accepted.some((acc) => {
            const accNum = Number(acc);
            return Number.isFinite(accNum) && Math.abs(accNum - numInput) <= 0.01;
          });
          if (numericMatch) {
            qEarned = qMax;
            isFullCorrect = true;
          }
        }
      }
    }

    earnedScore += qEarned;
    breakdown.push({
      questionId: q.questionId,
      questionType: q.questionType,
      earnedScore: Math.round(qEarned * 100) / 100,
      maxScore: qMax,
      isFullCorrect,
      correctDisplay,
      studentDisplay,
    });
  }

  earnedScore = Math.round(earnedScore * 100) / 100;
  maxScore = Math.round(maxScore * 100) / 100;
  const percentScore = maxScore > 0 ? Math.round((earnedScore / maxScore) * 1000) / 10 : 0;

  return {
    earnedScore,
    maxScore,
    percentScore,
    breakdown,
  };
}

/**
 * Calculates Đua Top leaderboard points from an exam attempt without allowing infinite score farming on retakes:
 * Each exam contributes up to 100 normalized points based on the student's BEST score on that exam.
 * Retaking an exam only awards the positive delta if the new score beats the prior best for that examId.
 */
export function computeLeaderboardUpdate(params: {
  existing: LeaderboardEntry | null;
  uid: string;
  displayName: string;
  grade: GradeLevel;
  examId: string;
  earnedScore: number;
  maxScore: number;
  nowIso: string;
}): {
  pointsDelta: number;
  examPoints: number;
  nextEntry: LeaderboardEntry;
} {
  const { existing, uid, displayName, grade, examId, earnedScore, maxScore, nowIso } = params;
  const examPoints = maxScore > 0 ? Math.round((earnedScore / maxScore) * 100) : 0;

  const prevScores = { ...(existing?.awardedExamScores || {}) };
  const prevBestForExam = typeof prevScores[examId] === 'number' ? prevScores[examId] : 0;
  const nextBestForExam = Math.max(prevBestForExam, examPoints);
  const pointsDelta = Math.max(0, nextBestForExam - prevBestForExam);

  prevScores[examId] = nextBestForExam;
  const allExamScores = Object.values(prevScores).filter((v) => typeof v === 'number');
  const totalScore = allExamScores.reduce((acc, v) => acc + v, 0);
  const examCount = allExamScores.length;
  const bestExamScore = allExamScores.length > 0 ? Math.max(...allExamScores) : 0;
  const averagePercent =
    examCount > 0 ? Math.round((totalScore / examCount) * 10) / 10 : 0;

  return {
    pointsDelta,
    examPoints,
    nextEntry: {
      uid,
      displayName: displayName || existing?.displayName || 'Học sinh',
      grade,
      totalScore,
      examCount,
      bestExamScore,
      averagePercent,
      awardedExamScores: prevScores,
      updatedAt: nowIso,
    },
  };
}

/**
 * Spaced Repetition interval scheduler (1 / 3 / 7 / 14 days). Pure code, 0 AI calls.
 */
export function calculateNextReviewSchedule(params: {
  currentStage: 0 | 1 | 2 | 3 | undefined;
  isCorrect: boolean;
  fromIso: string;
}): {
  nextStage: 0 | 1 | 2 | 3;
  intervalDays: number;
  nextReviewAt: string;
} {
  const current = params.currentStage ?? 0;
  let nextStage: 0 | 1 | 2 | 3 = 0;

  if (params.isCorrect) {
    nextStage = (Math.min(3, current + 1) as 0 | 1 | 2 | 3);
  } else {
    nextStage = 0;
  }

  const intervalMap: Record<0 | 1 | 2 | 3, number> = {
    0: 1,
    1: 3,
    2: 7,
    3: 14,
  };
  const intervalDays = intervalMap[nextStage];
  const baseMs = Date.parse(params.fromIso) || Date.now();
  const nextMs = baseMs + intervalDays * 24 * 60 * 60 * 1000;

  return {
    nextStage,
    intervalDays,
    nextReviewAt: new Date(nextMs).toISOString(),
  };
}

/**
 * Before/After analysis delta helper for comparing two analyses on the same subject/chapter.
 */
export function compareAnalysesBeforeAfter(
  older: AnalysisRecord,
  newer: AnalysisRecord
): {
  accuracyDelta: number | null;
  completenessDelta: number | null;
  incorrectDelta: number;
  summary: string;
} {
  const accDelta =
    older.accuracyScore !== null && newer.accuracyScore !== null
      ? Math.round((newer.accuracyScore - older.accuracyScore) * 10) / 10
      : null;

  const compDelta =
    older.completenessScore !== null && newer.completenessScore !== null
      ? Math.round((newer.completenessScore - older.completenessScore) * 10) / 10
      : null;

  const olderWrong = older.claims.filter((c) => c.evaluationStatus === 'INCORRECT').length;
  const newerWrong = newer.claims.filter((c) => c.evaluationStatus === 'INCORRECT').length;
  const incorrectDelta = newerWrong - olderWrong;

  const parts: string[] = [];
  if (accDelta !== null) {
    parts.push(
      accDelta >= 0
        ? `Độ chính xác tăng +${accDelta}%`
        : `Độ chính xác thay đổi ${accDelta}%`
    );
  }
  if (compDelta !== null) {
    parts.push(
      compDelta >= 0
        ? `Độ đầy đủ tăng +${compDelta}%`
        : `Độ đầy đủ thay đổi ${compDelta}%`
    );
  }
  if (incorrectDelta < 0) {
    parts.push(`Giảm ${Math.abs(incorrectDelta)} lỗi sai kiến thức`);
  }

  return {
    accuracyDelta: accDelta,
    completenessDelta: compDelta,
    incorrectDelta,
    summary: parts.length > 0 ? parts.join(' · ') : 'Hai bản phân tích có mức độ tương đương.',
  };
}
