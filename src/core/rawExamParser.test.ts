import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateExamBatchFromRawQuestions,
  parseRawExamQuestions,
  type RawBatchExamConfig,
} from './rawExamParser.js';

const BASE_CONFIG: RawBatchExamConfig = {
  baseTitle: 'Đề kiểm tra thử',
  grade: '10',
  subject: 'toan',
  textbookSeries: 'Kết nối tri thức với cuộc sống',
  examType: 'giua_ky_1',
  academicYear: '2026-2027',
  semester: '1',
  durationMinutes: 45,
  totalScore: 10,
  allowRetake: true,
  published: false,
  createdBy: 'admin_uid',
  mode: 'split_sequential',
  examCount: 2,
  questionsPerExam: 2,
  shuffleOptionsInVariants: true,
};

test('parseRawExamQuestions parses compact colon format Q1:Stem:A..:B...:C...:D...:Đáp án:X', () => {
  const raw = `
Q1:Ai là người giỏi nhất nhóm?:A. An:B. Bình:C. Chi:D. Dũng:Đáp án: B
Q2:Thủ đô của Việt Nam là thành phố nào?:A. TP.HCM:B. Hà Nội:C. Đà Nẵng:D. Huế:B
Q3:Cho hàm số: y = 2x + 1, giá trị tại x=1 là?:A. 1:B. 2:C. 3:D. 4:Đáp án: C
`;
  const res = parseRawExamQuestions(raw);
  assert.equal(res.questions.length, 3);
  assert.equal(res.abcdCount, 3);
  assert.equal(res.answeredCount, 3);

  assert.equal(res.questions[0].questionText, 'Ai là người giỏi nhất nhóm?');
  assert.equal(res.questions[0].optionA, 'An');
  assert.equal(res.questions[0].optionB, 'Bình');
  assert.equal(res.questions[0].correctAnswer, 'B');

  assert.equal(res.questions[1].correctAnswer, 'B');
  assert.equal(res.questions[2].questionText, 'Cho hàm số: y = 2x + 1, giá trị tại x=1 là?');
  assert.equal(res.questions[2].correctAnswer, 'C');
});

test('parseRawExamQuestions parses multi-line blocks with asterisk answers and trailing answer key', () => {
  const raw = `
Câu 1: Kết quả của 2 + 2 bằng bao nhiêu?
A. 3
*B. 4
C. 5
D. 6
Giải thích: 2 cộng 2 bằng 4.

Câu 2: Nước sôi ở nhiệt độ bao nhiêu độ C ở áp suất chuẩn?
A. 50   B. 80   C. 100   D. 120

Câu 3: Tính diện tích hình vuông cạnh 5cm? : Đáp án: 25 | 25cm2

ĐÁP ÁN:
1. B  2. C
`;
  const res = parseRawExamQuestions(raw);
  assert.equal(res.questions.length, 3);
  assert.equal(res.abcdCount, 2);
  assert.equal(res.shortAnswerCount, 1);
  assert.equal(res.questions[0].correctAnswer, 'B');
  assert.equal(res.questions[0].explanation, '2 cộng 2 bằng 4.');
  assert.equal(res.questions[1].optionC, '100');
  assert.equal(res.questions[1].correctAnswer, 'C');
  assert.deepEqual(res.questions[2].shortAnswerAccepted, ['25', '25cm2']);
});

test('generateExamBatchFromRawQuestions creates multiple non-overlapping or shuffled exam sets with exact scores', () => {
  const raw = [1, 2, 3, 4, 5, 6]
    .map(
      (i) =>
        `Q${i}:Câu hỏi mẫu số ${i}?:A. Phương án 1_${i}:B. Phương án 2_${i}:C. Phương án 3_${i}:D. Phương án 4_${i}:Đáp án: C`
    )
    .join('\n');

  const parsed = parseRawExamQuestions(raw);
  assert.equal(parsed.questions.length, 6);

  // Sequential split into 3 exams of 2 questions each
  const splitExams = generateExamBatchFromRawQuestions({
    pool: parsed.questions,
    config: { ...BASE_CONFIG, mode: 'split_sequential', questionsPerExam: 2 },
  });
  assert.equal(splitExams.length, 3);
  assert.equal(splitExams[0].questions.length, 2);
  assert.equal(splitExams[1].questions.length, 2);
  assert.equal(splitExams[2].questions.length, 2);

  for (const ex of splitExams) {
    const sum = Math.round(ex.questions.reduce((s, q) => s + q.scoreWeight, 0) * 100) / 100;
    assert.equal(sum, 10);
  }

  // Variant shuffle mode creating 4 exam sets with 4 questions each while preserving correct answer text
  const variantExams = generateExamBatchFromRawQuestions({
    pool: parsed.questions,
    config: {
      ...BASE_CONFIG,
      mode: 'shuffle_variants',
      examCount: 4,
      questionsPerExam: 4,
      shuffleOptionsInVariants: true,
    },
  });
  assert.equal(variantExams.length, 4);
  for (const ex of variantExams) {
    assert.equal(ex.questions.length, 4);
    for (const q of ex.questions) {
      const optMap = { A: q.optionA, B: q.optionB, C: q.optionC, D: q.optionD };
      const chosenText = optMap[q.correctAnswer || 'A'];
      assert.ok(chosenText?.startsWith('Phương án 3_'), `Expected answer text to follow shuffled option, got ${chosenText}`);
    }
  }
});
