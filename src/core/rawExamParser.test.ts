import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSampleExamFileJson,
  generateExamBatchFromRawQuestions,
  parseExamFileJson,
  parseRawExamQuestions,
  parseTrueFalseAnswerKey,
  type Exam,
  type ExamFile,
  type Question,
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

test('parseRawExamQuestions parses positional ABCD without A./B./C./D. prefixes including colons in stem and explanations', () => {
  const raw = `
Câu 1:Liên kết hydrogen chỉ hình thành mạnh nhất giữa nguyên tử H với các nguyên tử có độ âm điện lớn nào sau đây?:F, O, N:C, Si, P:Na, K, Ca:He, Ne, Ar:A:Hợp chất chứa F, O, N phân cực mạnh.
Câu 2:Thủ đô của nước Việt Nam là thành phố nào?:Thành phố Hồ Chí Minh:*Hà Nội:Đà Nẵng:Hải Phòng:Đáp án là Hà Nội.
Giá trị của biểu thức 2x + 5 tại x = 3 bằng bao nhiêu?:9:10:11:12:C
Cho hàm số y = 2x + 1: Tìm y tại x = 1?:1:2:3:4:C
`;
  const res = parseRawExamQuestions(raw);
  assert.equal(res.questions.length, 4);
  assert.equal(res.abcdCount, 4);
  assert.equal(res.answeredCount, 4);

  assert.equal(res.questions[0].optionA, 'F, O, N');
  assert.equal(res.questions[0].optionD, 'He, Ne, Ar');
  assert.equal(res.questions[0].correctAnswer, 'A');
  assert.equal(res.questions[0].explanation, 'Hợp chất chứa F, O, N phân cực mạnh.');

  assert.equal(res.questions[1].optionB, 'Hà Nội');
  assert.equal(res.questions[1].correctAnswer, 'B');
  assert.equal(res.questions[1].explanation, 'Đáp án là Hà Nội.');

  assert.equal(res.questions[2].questionText, 'Giá trị của biểu thức 2x + 5 tại x = 3 bằng bao nhiêu?');
  assert.equal(res.questions[2].optionC, '11');
  assert.equal(res.questions[2].correctAnswer, 'C');

  assert.equal(res.questions[3].questionText, 'Cho hàm số y = 2x + 1: Tìm y tại x = 1?');
  assert.equal(res.questions[3].optionC, '3');
  assert.equal(res.questions[3].correctAnswer, 'C');
});

test('parseRawExamQuestions parses True/False 4-statement blocks ([ĐS]/[TF]) and Short Answer ([TLN]) preserving decimal commas', () => {
  const raw = `
[ĐS] Xét các nhận định sau về cấu tạo nguyên tử:|a) Hạt nhân chứa proton và neutron.|b) Số proton bằng số electron.|c) Cùng chu kỳ có cùng số electron lớp ngoài cùng.|d) Độ âm điện tăng từ trái sang phải.:Đ-Đ-S-Đ:Ý c sai vì cùng số lớp electron.

[ĐS] Cho hàm số y = x^2 - 4x + 3.|*a) Đồ thị là parabol bề lõm hướng lên.|*b) Trục đối xứng là x = 2.|c) Giá trị nhỏ nhất bằng 1.|*d) Có hai nghiệm x = 1 và x = 3.

[TLN] Kết quả của phép tính 25 x 4 + 12 bằng bao nhiêu?:112
[TLN] Diện tích hình chữ nhật bằng bao nhiêu cm²?:34 | 34,0 | 34 cm2
`;
  const res = parseRawExamQuestions(raw);
  assert.equal(res.questions.length, 4);
  assert.equal(res.trueFalseCount, 2);
  assert.equal(res.shortAnswerCount, 2);
  assert.equal(res.answeredCount, 4);

  const q0 = res.questions[0];
  assert.equal(q0.questionType, 'true_false');
  assert.equal(q0.trueFalseStatements?.length, 4);
  assert.deepEqual(
    q0.trueFalseStatements?.map((s) => s.isTrue),
    [true, true, false, true]
  );
  assert.equal(q0.explanation, 'Ý c sai vì cùng số lớp electron.');

  const q1 = res.questions[1];
  assert.equal(q1.questionType, 'true_false');
  assert.deepEqual(
    q1.trueFalseStatements?.map((s) => s.isTrue),
    [true, true, false, true]
  );

  assert.deepEqual(res.questions[2].shortAnswerAccepted, ['112']);
  assert.deepEqual(res.questions[3].shortAnswerAccepted, ['34', '34,0', '34 cm2']);

  assert.deepEqual(parseTrueFalseAnswerKey('T-F-T-T'), [true, false, true, true]);
  assert.deepEqual(parseTrueFalseAnswerKey('a:Đ b:S c:Đ d:S'), [true, false, true, false]);
});

test('parseRawExamQuestions parses structured CSV tables with all 3 GDPT 2018 question types', () => {
  const csv = `type,question,a,b,c,d,answer,explanation
abcd,"Đơn vị đo cường độ dòng điện trong hệ SI là gì?",Vôn (V),Ampe (A),Ôm (Ω),Oát (W),B,"Cường độ dòng điện đo bằng Ampe."
true_false,"Xét tính chất vật lý của nước tinh khiết:","Sôi ở 100°C","Đông đặc ở 0°C","Là dung môi phân cực kém","Nhiệt độ sôi cao hơn H2S",Đ-Đ-S-Đ,"Nước là dung môi phân cực mạnh."
short_answer,"Tính nghiệm dương của phương trình x^2 - 9 = 0",,,, ,3,"Nghiệm dương là 3."
`;
  const res = parseRawExamQuestions(csv);
  assert.equal(res.questions.length, 3);
  assert.equal(res.abcdCount, 1);
  assert.equal(res.trueFalseCount, 1);
  assert.equal(res.shortAnswerCount, 1);
  assert.equal(res.answeredCount, 3);

  assert.equal(res.questions[0].optionB, 'Ampe (A)');
  assert.equal(res.questions[0].correctAnswer, 'B');
  assert.deepEqual(
    res.questions[1].trueFalseStatements?.map((s) => s.isTrue),
    [true, true, false, true]
  );
  assert.deepEqual(res.questions[2].shortAnswerAccepted, ['3']);
  assert.equal(res.questions[2].explanation, 'Nghiệm dương là 3.');
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

test('generateExamBatchFromRawQuestions creates multiple non-overlapping or shuffled exam sets preserving ABCD & TF truth values', () => {
  const raw = [
    ...[1, 2, 3, 4].map(
      (i) =>
        `Q${i}:Câu hỏi mẫu số ${i}?:A. Phương án 1_${i}:B. Phương án 2_${i}:C. Phương án 3_${i}:D. Phương án 4_${i}:Đáp án: C`
    ),
    `[ĐS] Mệnh đề hóa học:|a) Ý 1 đúng|b) Ý 2 sai|c) Ý 3 đúng|d) Ý 4 sai:Đ-S-Đ-S`,
    `[TLN] Tính 5 x 6?:30`,
  ].join('\n');

  const parsed = parseRawExamQuestions(raw);
  assert.equal(parsed.questions.length, 6);
  assert.equal(parsed.abcdCount, 4);
  assert.equal(parsed.trueFalseCount, 1);
  assert.equal(parsed.shortAnswerCount, 1);

  const splitExams = generateExamBatchFromRawQuestions({
    pool: parsed.questions,
    config: { ...BASE_CONFIG, mode: 'split_sequential', questionsPerExam: 2 },
  });
  assert.equal(splitExams.length, 3);
  for (const ex of splitExams) {
    const sum = Math.round(ex.questions.reduce((s, q) => s + q.scoreWeight, 0) * 100) / 100;
    assert.equal(sum, 10);
  }

  const tfQuestion = splitExams[2].questions.find((q) => q.questionType === 'true_false');
  assert.ok(tfQuestion);
  assert.deepEqual(
    tfQuestion.trueFalseStatements?.map((s) => s.isTrue),
    [true, false, true, false]
  );

  const variantExams = generateExamBatchFromRawQuestions({
    pool: parsed.questions,
    config: {
      ...BASE_CONFIG,
      mode: 'shuffle_variants',
      examCount: 3,
      questionsPerExam: 6,
      shuffleOptionsInVariants: true,
    },
  });
  assert.equal(variantExams.length, 3);
  for (const ex of variantExams) {
    for (const q of ex.questions) {
      if (q.questionType === 'abcd') {
        const optMap = { A: q.optionA, B: q.optionB, C: q.optionC, D: q.optionD };
        const chosenText = optMap[q.correctAnswer || 'A'];
        assert.ok(
          chosenText?.startsWith('Phương án 3_'),
          `Expected answer text to follow shuffled option, got ${chosenText}`
        );
      }
      if (q.questionType === 'true_false') {
        assert.deepEqual(
          q.trueFalseStatements?.map((s) => s.isTrue),
          [true, false, true, false]
        );
      }
    }
  }
});

test('parseRawExamQuestions & parseExamFileJson parse ExamFile JSON format with LaTeX $...$ and all 3 Question variants', () => {
  const sampleJson = buildSampleExamFileJson();
  const parsed = parseRawExamQuestions(sampleJson);

  assert.equal(parsed.format, 'exam_file');
  assert.equal(parsed.examCount, 1);
  assert.equal(parsed.questions.length, 4);
  assert.equal(parsed.abcdCount, 2);
  assert.equal(parsed.trueFalseCount, 1);
  assert.equal(parsed.shortAnswerCount, 1);
  assert.equal(parsed.answeredCount, 4);
  assert.equal(parsed.warnings.length, 0);

  const examDoc = parsed.examDocuments?.[0];
  assert.ok(examDoc);
  assert.equal(examDoc.title, 'Đề kiểm tra Giữa kỳ I - Toán 11 (THPT Việt Đức 2025-2026)');
  assert.equal(examDoc.subject, 'toan');
  assert.equal(examDoc.grade, '11');
  assert.equal(examDoc.textbookSeries, 'Kết nối tri thức với cuộc sống');
  assert.equal(examDoc.examType, 'giua_ky_1');
  assert.equal(examDoc.academicYear, '2025-2026');
  assert.equal(examDoc.semester, '1');
  assert.equal(examDoc.durationMinutes, 45);
  assert.equal(examDoc.totalScore, 10);
  assert.equal(examDoc.published, true);
  assert.equal(examDoc.chapters.length, 2);

  const qAbcd = examDoc.questions[0];
  assert.equal(qAbcd.questionType, 'abcd');
  assert.equal(qAbcd.optionA, '$T = 2\\pi$');
  assert.equal(qAbcd.optionC, '$T = \\frac{\\pi}{2}$');
  assert.equal(qAbcd.correctAnswer, 'A');
  assert.equal(qAbcd.cognitiveLevel, 'nhan_biet');
  assert.equal(qAbcd.chapterId, 'Chương I: Hàm số lượng giác và phương trình lượng giác');

  const qTf = examDoc.questions[2];
  assert.equal(qTf.questionType, 'true_false');
  assert.equal(qTf.trueFalseStatements?.length, 4);
  assert.deepEqual(
    qTf.trueFalseStatements?.map((s) => s.label),
    ['a', 'b', 'c', 'd']
  );
  assert.deepEqual(
    qTf.trueFalseStatements?.map((s) => s.isTrue),
    [true, false, true, true]
  );
  assert.equal(qTf.cognitiveLevel, 'van_dung');

  const qSa = examDoc.questions[3];
  assert.equal(qSa.questionType, 'short_answer');
  assert.deepEqual(qSa.shortAnswerAccepted, ['6', '6.0', '6,0']);
  assert.equal(qSa.cognitiveLevel, 'van_dung_cao');
});

test('parseExamFileJson recovers unescaped single-backslash LaTeX commands inside JSON strings and handles 60-exam subject files', () => {
  // Raw string containing single-backslash \frac, \beta, \theta, \tau, \tan, \neq, \rightarrow, \sqrt
  const rawWithUnescapedLatex = `{
    "exams": [
      {
        "title": "Đề Vật lý 12 - Chuẩn LaTeX",
        "description": "Kiểm tra công thức LaTeX",
        "subject": "vat_ly",
        "grade": "12",
        "textbookSeries": "Kết nối tri thức với cuộc sống",
        "examType": "cuoi_ky_1",
        "academicYear": "2025-2026",
        "semester": "1",
        "durationMinutes": 50,
        "totalScore": 10,
        "published": true,
        "chapters": ["Chương 1: Vật lý nhiệt"],
        "questions": [
          {
            "questionType": "abcd",
            "options": ["$\\frac{\\beta + \\theta}{\\tau}$", "$\\tan x \\neq 0$", "$\\sqrt{2}$", "$A \\rightarrow B$"],
            "correctAnswer": "A",
            "chapterId": "Chương 1: Vật lý nhiệt",
            "cognitiveLevel": "thong_hieu",
            "questionText": "Biểu thức nào chứa $\\frac{\\beta + \\theta}{\\tau}$?",
            "explanation": "Ta có $\\frac{\\beta + \\theta}{\\tau}$ là đáp án A.",
            "sourceReference": "Đề gốc THPT"
          }
        ]
      }
    ]
  }`;

  const latexRes = parseExamFileJson(rawWithUnescapedLatex);
  assert.ok(latexRes);
  assert.equal(latexRes.examCount, 1);
  assert.equal(latexRes.questions.length, 1);
  assert.equal(latexRes.questions[0].optionA, '$\\frac{\\beta + \\theta}{\\tau}$');
  assert.equal(latexRes.questions[0].optionB, '$\\tan x \\neq 0$');

  // Test a full 60-exam ExamFile with 20 questions per exam (1,200 questions total)
  const makeQuestion = (qIdx: number): Question => {
    if (qIdx % 10 === 8) {
      return {
        questionType: 'true_false',
        statements: [
          { text: 'Mệnh đề a với $x^2 \\ge 0$', isTrue: true },
          { text: 'Mệnh đề b', isTrue: false },
          { text: 'Mệnh đề c', isTrue: true },
          { text: 'Mệnh đề d', isTrue: false },
        ],
        chapterId: 'Chương 1',
        cognitiveLevel: 'van_dung',
        questionText: `Câu Đúng/Sai số ${qIdx + 1}`,
        explanation: 'Giải thích chi tiết',
        sourceReference: 'Nguồn đề gốc',
      };
    }
    if (qIdx % 10 === 9) {
      return {
        questionType: 'short_answer',
        shortAnswerAccepted: ['6', '6.0', '6,0'],
        chapterId: 'Chương 2',
        cognitiveLevel: 'van_dung_cao',
        questionText: `Câu trả lời ngắn số ${qIdx + 1}`,
        explanation: 'Giải thích chi tiết',
        sourceReference: 'Nguồn đề gốc',
      };
    }
    return {
      questionType: 'abcd',
      options: ['Phương án A', 'Phương án B', 'Phương án C', 'Phương án D'],
      correctAnswer: 'B',
      chapterId: 'Chương 1',
      cognitiveLevel: 'nhan_biet',
      questionText: `Câu ABCD số ${qIdx + 1}: Tính $\\int_0^1 x dx$`,
      explanation: 'Lời giải chi tiết',
      sourceReference: 'Nguồn đề gốc',
    };
  };

  const exams60: Exam[] = Array.from({ length: 60 }, (_, eIdx) => ({
    title: `Đề kiểm tra Giữa kỳ I - Toán 11 - Đề số ${eIdx + 1}`,
    description: 'Đề chuẩn 20 câu',
    subject: 'toan',
    grade: '11',
    textbookSeries: 'Kết nối tri thức với cuộc sống',
    examType: 'giua_ky_1',
    academicYear: '2025-2026',
    semester: '1',
    durationMinutes: 45,
    totalScore: 10,
    published: true,
    chapters: ['Chương 1', 'Chương 2'],
    questions: Array.from({ length: 20 }, (__, qIdx) => makeQuestion(qIdx)),
  }));

  const examFile60: ExamFile = { exams: exams60 };
  const parsed60 = parseRawExamQuestions(JSON.stringify(examFile60));
  assert.equal(parsed60.format, 'exam_file');
  assert.equal(parsed60.examCount, 60);
  assert.equal(parsed60.questions.length, 60 * 20);

  const generatedDocs = generateExamBatchFromRawQuestions({
    pool: parsed60.questions,
    examFile: parsed60.examFile,
    config: { ...BASE_CONFIG, mode: 'exam_file', shuffleOptionsInVariants: false },
  });
  assert.equal(generatedDocs.length, 60);
  assert.equal(generatedDocs[0].questions.length, 20);
  assert.equal(generatedDocs[59].title, 'Đề kiểm tra Giữa kỳ I - Toán 11 - Đề số 60');
});

