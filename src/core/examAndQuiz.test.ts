import test from 'node:test';
import assert from 'node:assert/strict';
import {
  distributeExamQuestionScores,
  generateShuffledExamVariant,
  validateExamBlueprint,
  validateQuizQuestionSet,
} from './quizValidation';
import {
  calculateNextReviewSchedule,
  compareAnalysesBeforeAfter,
  computeLeaderboardUpdate,
  gradeExamSubmission,
} from './examScoring';
import { BoundedTtlCache, buildDeterministicCacheKey } from './cache';
import type { AnalysisRecord, ExamBlueprint, ExamDocument, QuizQuestion } from './types';

function makeQuizQuestion(overrides: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    questionId: 'q1',
    questionText: 'Nguyên phân diễn ra qua mấy kỳ chính trong chu kỳ tế bào?',
    optionA: '2 kỳ',
    optionB: '3 kỳ',
    optionC: '4 kỳ',
    optionD: '5 kỳ',
    correctAnswer: 'C',
    explanation: 'Nguyên phân gồm 4 kỳ chính: kỳ đầu, kỳ giữa, kỳ sau và kỳ cuối.',
    difficulty: 'basic',
    subject: 'sinh_hoc',
    grade: '10',
    chapter: 'Chu kỳ tế bào',
    concept: 'Nguyên phân',
    sourceReference: 'SGK Sinh học 10',
    createdAt: '2026-11-19T00:00:00Z',
    ...overrides,
  };
}

test('validateQuizQuestionSet removes duplicates and flags length bias cleanly', () => {
  const q1 = makeQuizQuestion({ questionId: 'q1' });
  const qDup = makeQuizQuestion({ questionId: 'q2' });
  const qLongBias = makeQuizQuestion({
    questionId: 'q3',
    questionText: 'Điều kiện để dòng điện xoay chiều đạt cộng hưởng trong mạch RLC?',
    optionA: 'Cảm kháng bằng dung kháng trong mạch nối tiếp làm tổng trở đạt giá trị cực tiểu bằng điện trở thuần',
    optionB: 'R bằng không',
    optionC: 'L bằng không',
    optionD: 'C bằng không',
    correctAnswer: 'A',
  });

  const report = validateQuizQuestionSet([q1, qDup, qLongBias]);
  assert.equal(report.rejectedCount, 1);
  assert.equal(report.questions.length, 2);
  assert.equal(report.questions[0].validationStatus, 'passed');
  assert.equal(report.questions[1].validationStatus, 'needs_review');
});

test('validateExamBlueprint detects score mismatch and confirms valid blueprint', () => {
  const bp: ExamBlueprint = {
    blueprintId: 'bp1',
    title: 'Đề giữa kỳ I Toán 10',
    grade: '10',
    subject: 'toan',
    textbookSeries: 'Kết nối tri thức với cuộc sống',
    examType: 'giua_ky_1',
    academicYear: '2026-2027',
    semester: '1',
    chapters: ['Chương 1'],
    durationMinutes: 45,
    totalScore: 10,
    cognitiveDistribution: {
      nhan_biet: 30,
      thong_hieu: 30,
      van_dung: 25,
      van_dung_cao: 15,
    },
    rows: [
      {
        rowId: 'r1',
        chapter: 'Chương 1',
        topic: 'Mệnh đề',
        cognitiveLevel: 'nhan_biet',
        questionType: 'abcd',
        questionCount: 10,
        scorePerQuestion: 0.5,
        learningOutcome: 'Nhận biết mệnh đề đúng sai',
      },
      {
        rowId: 'r2',
        chapter: 'Chương 1',
        topic: 'Tập hợp',
        cognitiveLevel: 'thong_hieu',
        questionType: 'true_false',
        questionCount: 5,
        scorePerQuestion: 1.0,
        learningOutcome: 'Xác định các phép toán tập hợp',
      },
    ],
    status: 'draft',
    createdBy: 'admin1',
    createdAt: '2026-11-19T00:00:00Z',
    updatedAt: '2026-11-19T00:00:00Z',
  };

  const ok = validateExamBlueprint(bp);
  assert.equal(ok.valid, true);
  assert.equal(ok.computedScore, 10);
  assert.equal(ok.totalQuestions, 15);

  const bad = validateExamBlueprint({ ...bp, totalScore: 12 });
  assert.equal(bad.valid, false);
});

test('gradeExamSubmission & generateShuffledExamVariant grade all 3 question formats accurately', () => {
  const exam: ExamDocument = {
    examId: 'ex1',
    blueprintId: 'bp1',
    title: 'Kiểm tra Vật lý 11',
    description: 'Đề chuẩn GDPT 2018',
    grade: '11',
    subject: 'vat_ly',
    textbookSeries: 'Chân trời sáng tạo',
    examType: 'cuoi_ky_1',
    academicYear: '2026-2027',
    semester: '1',
    chapters: ['Dao động'],
    durationMinutes: 45,
    totalScore: 4,
    allowRetake: true,
    published: true,
    validationStatus: 'passed',
    questions: [
      {
        questionId: 'eq1',
        orderIndex: 1,
        chapterId: 'Dao động',
        conceptId: 'Tần số góc',
        learningOutcome: 'Tính tần số góc',
        cognitiveLevel: 'nhan_biet',
        questionType: 'abcd',
        scoreWeight: 1,
        questionText: 'Công thức liên hệ tần số góc và chu kỳ?',
        optionA: 'ω = 2π/T',
        optionB: 'ω = 2πT',
        optionC: 'ω = T/2π',
        optionD: 'ω = 1/T',
        correctAnswer: 'A',
        explanation: 'ω = 2π / T.',
        sourceReference: 'SGK Vật lý 11',
        sourceType: 'textbook_reference',
        validationStatus: 'passed',
      },
      {
        questionId: 'eq2',
        orderIndex: 2,
        chapterId: 'Dao động',
        conceptId: 'Con lắc lò xo',
        learningOutcome: 'Phân tích lực kéo về',
        cognitiveLevel: 'thong_hieu',
        questionType: 'true_false',
        scoreWeight: 2,
        questionText: 'Xét dao động điều hòa:',
        trueFalseStatements: [
          { label: 'a', text: 'Vận tốc cực đại tại VTCB', isTrue: true },
          { label: 'b', text: 'Gia tốc hướng về VTCB', isTrue: true },
          { label: 'c', text: 'Biên độ đổi theo thời gian', isTrue: false },
          { label: 'd', text: 'Cơ năng tỉ lệ với A', isTrue: false },
        ],
        explanation: 'Cơ năng tỉ lệ với A^2.',
        sourceReference: 'SGK Vật lý 11',
        sourceType: 'textbook_reference',
        validationStatus: 'passed',
      },
      {
        questionId: 'eq3',
        orderIndex: 3,
        chapterId: 'Dao động',
        conceptId: 'Chu kỳ',
        learningOutcome: 'Tính chu kỳ',
        cognitiveLevel: 'van_dung',
        questionType: 'short_answer',
        scoreWeight: 1,
        questionText: 'Nếu f = 2 Hz thì chu kỳ T bằng bao nhiêu giây?',
        shortAnswerAccepted: ['0.5', '0,5'],
        explanation: 'T = 1/f = 0.5 s.',
        sourceReference: 'SGK Vật lý 11',
        sourceType: 'textbook_reference',
        validationStatus: 'passed',
      },
    ],
    createdBy: 'admin',
    createdAt: '2026-11-19T00:00:00Z',
    updatedAt: '2026-11-19T00:00:00Z',
  };

  // Shuffling preserves exact correct option text
  const variant102 = generateShuffledExamVariant(exam, '102');
  const eq1Shuffled = variant102.questions.find((q) => q.questionId === 'eq1')!;
  const chosenLetter = eq1Shuffled.correctAnswer!;
  const mappedText = eq1Shuffled[`option${chosenLetter}`];
  assert.equal(mappedText, 'ω = 2π/T');

  // Grading: eq1 correct (1.0), eq2 3/4 correct (0.5 * 2 = 1.0), eq3 comma decimal '0,5' (1.0) => total 3.0 / 4.0
  const result = gradeExamSubmission(exam, [
    { questionId: 'eq1', selectedOption: 'A' },
    {
      questionId: 'eq2',
      trueFalseChoices: { a: true, b: true, c: false, d: true },
    },
    { questionId: 'eq3', shortAnswerText: ' 0,5 ' },
  ]);
  assert.equal(result.earnedScore, 3);
  assert.equal(result.maxScore, 4);
  assert.equal(result.percentScore, 75);
});

test('computeLeaderboardUpdate awards positive improvement delta without score farming', () => {
  const first = computeLeaderboardUpdate({
    existing: null,
    uid: 'stu1',
    displayName: 'Minh Anh',
    grade: '11',
    examId: 'ex1',
    earnedScore: 7,
    maxScore: 10,
    nowIso: '2026-11-19T10:00:00Z',
  });
  assert.equal(first.examPoints, 70);
  assert.equal(first.pointsDelta, 70);
  assert.equal(first.nextEntry.totalScore, 70);

  // Lower retake score yields 0 extra points
  const lowerRetake = computeLeaderboardUpdate({
    existing: first.nextEntry,
    uid: 'stu1',
    displayName: 'Minh Anh',
    grade: '11',
    examId: 'ex1',
    earnedScore: 5,
    maxScore: 10,
    nowIso: '2026-11-19T11:00:00Z',
  });
  assert.equal(lowerRetake.pointsDelta, 0);
  assert.equal(lowerRetake.nextEntry.totalScore, 70);

  // Higher retake score awards only the +20 difference
  const betterRetake = computeLeaderboardUpdate({
    existing: lowerRetake.nextEntry,
    uid: 'stu1',
    displayName: 'Minh Anh',
    grade: '11',
    examId: 'ex1',
    earnedScore: 9,
    maxScore: 10,
    nowIso: '2026-11-19T12:00:00Z',
  });
  assert.equal(betterRetake.pointsDelta, 20);
  assert.equal(betterRetake.nextEntry.totalScore, 90);
});

test('spaced repetition schedule, before/after comparison, and deterministic cache', () => {
  const s1 = calculateNextReviewSchedule({
    currentStage: 0,
    isCorrect: true,
    fromIso: '2026-11-19T00:00:00.000Z',
  });
  assert.equal(s1.nextStage, 1);
  assert.equal(s1.intervalDays, 3);

  const reset = calculateNextReviewSchedule({
    currentStage: 2,
    isCorrect: false,
    fromIso: '2026-11-19T00:00:00.000Z',
  });
  assert.equal(reset.nextStage, 0);
  assert.equal(reset.intervalDays, 1);

  const keyA = buildDeterministicCacheKey({ task: 'quiz', text: 'abc', model: 'gemini-4-hydrogen' });
  const keyB = buildDeterministicCacheKey({ model: 'gemini-4-hydrogen', text: 'abc', task: 'quiz' });
  assert.equal(keyA, keyB);

  const cache = new BoundedTtlCache<string>(2, 60000);
  cache.set('k1', 'v1');
  cache.set('k2', 'v2');
  cache.set('k3', 'v3');
  assert.equal(cache.get('k1'), undefined);
  assert.equal(cache.get('k3'), 'v3');

  const older = {
    accuracyScore: 60,
    completenessScore: 50,
    claims: [{ evaluationStatus: 'INCORRECT' }, { evaluationStatus: 'INCORRECT' }],
  } as unknown as AnalysisRecord;
  const newer = {
    accuracyScore: 90,
    completenessScore: 85,
    claims: [{ evaluationStatus: 'CORRECT' }],
  } as unknown as AnalysisRecord;
  const delta = compareAnalysesBeforeAfter(older, newer);
  assert.equal(delta.accuracyDelta, 30);
  assert.equal(delta.completenessDelta, 35);
  assert.equal(delta.incorrectDelta, -2);
});

test('distributeExamQuestionScores distributes totalScore exactly across questions', () => {
  const sampleQs = Array.from({ length: 7 }, (_, i) => ({
    questionId: `eq_${i + 1}`,
    orderIndex: i + 1,
    chapterId: 'Theo đề mẫu',
    conceptId: 'Theo đề mẫu',
    learningOutcome: 'Theo đề mẫu',
    cognitiveLevel: 'thong_hieu' as const,
    questionType: (i < 5 ? 'abcd' : 'short_answer') as 'abcd' | 'short_answer',
    scoreWeight: 0.25,
    questionText: `Câu ${i + 1}`,
    explanation: 'Giải thích',
    sourceReference: 'Đề mẫu',
    sourceType: 'public_exam_reference' as const,
    validationStatus: 'passed' as const,
  }));

  const distributed = distributeExamQuestionScores(sampleQs, 10);
  const sum = Math.round(distributed.reduce((s, q) => s + q.scoreWeight, 0) * 100) / 100;
  assert.equal(sum, 10);
  assert.equal(distributed[0].orderIndex, 1);
  assert.equal(distributed[6].orderIndex, 7);
});

test('gradeExamSubmission awards full 100% score when a 2-statement or 3-statement true_false question is answered completely right', () => {
  const exam: ExamDocument = {
    examId: 'ex_tf2',
    blueprintId: 'bp1',
    title: 'Đề kiểm tra 2 ý Đúng/Sai',
    description: 'Kiểm tra thang điểm < 4 ý',
    grade: '10',
    subject: 'hoa_hoc',
    textbookSeries: 'Kết nối tri thức với cuộc sống',
    examType: 'giua_ky_1',
    academicYear: '2026-2027',
    semester: '1',
    chapters: ['Cấu tạo nguyên tử'],
    durationMinutes: 15,
    totalScore: 2,
    allowRetake: true,
    published: true,
    validationStatus: 'passed',
    questions: [
      {
        questionId: 'tf_2st',
        orderIndex: 1,
        chapterId: 'Cấu tạo nguyên tử',
        conceptId: 'Hạt nhân',
        learningOutcome: 'Xác định hạt trong hạt nhân',
        cognitiveLevel: 'nhan_biet',
        questionType: 'true_false',
        scoreWeight: 2,
        questionText: 'Xét các mệnh đề sau:',
        trueFalseStatements: [
          { label: 'a', text: 'Proton mang điện tích dương', isTrue: true },
          { label: 'b', text: 'Neutron mang điện tích âm', isTrue: false },
        ],
        explanation: 'Neutron không mang điện.',
        sourceReference: 'SGK Hóa 10',
        sourceType: 'textbook_reference',
        validationStatus: 'passed',
      },
    ],
    createdBy: 'admin',
    createdAt: '2026-11-19T00:00:00Z',
    updatedAt: '2026-11-19T00:00:00Z',
  };

  const fullRes = gradeExamSubmission(exam, [
    { questionId: 'tf_2st', trueFalseChoices: { a: true, b: false } },
  ]);
  assert.equal(fullRes.earnedScore, 2);
  assert.equal(fullRes.percentScore, 100);
  assert.equal(fullRes.breakdown[0].isFullCorrect, true);

  const halfRes = gradeExamSubmission(exam, [
    { questionId: 'tf_2st', trueFalseChoices: { a: true, b: true } },
  ]);
  assert.equal(halfRes.earnedScore, 1);
  assert.equal(halfRes.percentScore, 50);
  assert.equal(halfRes.breakdown[0].isFullCorrect, false);
});

test('gradeExamSubmission supports fraction short answers and prevents "0" from matching small non-zero answers', () => {
  const exam: ExamDocument = {
    examId: 'ex_short_frac',
    blueprintId: 'bp1',
    title: 'Đề trả lời ngắn phân số & số nhỏ',
    description: 'Kiểm tra phân số và sai số tương đối',
    grade: '11',
    subject: 'vat_ly',
    textbookSeries: 'Kết nối tri thức với cuộc sống',
    examType: 'giua_ky_1',
    academicYear: '2026-2027',
    semester: '1',
    chapters: ['Dao động'],
    durationMinutes: 15,
    totalScore: 2,
    allowRetake: true,
    published: true,
    validationStatus: 'passed',
    questions: [
      {
        questionId: 'sa_frac',
        orderIndex: 1,
        chapterId: 'Dao động',
        conceptId: 'Chu kỳ',
        learningOutcome: 'Tính chu kỳ',
        cognitiveLevel: 'van_dung',
        questionType: 'short_answer',
        scoreWeight: 1,
        questionText: 'Chu kỳ dao động bằng bao nhiêu giây?',
        shortAnswerAccepted: ['0.5'],
        explanation: 'T = 1/2 = 0.5 s.',
        sourceReference: 'SGK',
        sourceType: 'textbook_reference',
        validationStatus: 'passed',
      },
      {
        questionId: 'sa_small',
        orderIndex: 2,
        chapterId: 'Dao động',
        conceptId: 'Biên độ nhỏ',
        learningOutcome: 'Tính độ giãn nhỏ',
        cognitiveLevel: 'van_dung',
        questionType: 'short_answer',
        scoreWeight: 1,
        questionText: 'Độ biến dạng Δl bằng bao nhiêu mét?',
        shortAnswerAccepted: ['0.005'],
        explanation: 'Δl = 0.005 m.',
        sourceReference: 'SGK',
        sourceType: 'textbook_reference',
        validationStatus: 'passed',
      },
    ],
    createdBy: 'admin',
    createdAt: '2026-11-19T00:00:00Z',
    updatedAt: '2026-11-19T00:00:00Z',
  };

  // Fraction "1/2" matches "0.5", while "0" must NOT match "0.005"
  const res = gradeExamSubmission(exam, [
    { questionId: 'sa_frac', shortAnswerText: '1/2' },
    { questionId: 'sa_small', shortAnswerText: '0' },
  ]);
  assert.equal(res.breakdown[0].isFullCorrect, true);
  assert.equal(res.breakdown[1].isFullCorrect, false);
  assert.equal(res.earnedScore, 1);

  // Exact small number "0,005" or fraction "1/200" matches "0.005"
  const resExact = gradeExamSubmission(exam, [
    { questionId: 'sa_frac', shortAnswerText: '0,5' },
    { questionId: 'sa_small', shortAnswerText: '1/200' },
  ]);
  assert.equal(resExact.earnedScore, 2);
});
