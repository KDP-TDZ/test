import { distributeExamQuestionScores } from './quizValidation.js';
import type {
  ExamDocument,
  ExamQuestion,
  ExamType,
  GradeLevel,
  SubjectId,
} from './types.js';

export interface ParsedRawQuestion {
  sourceIndex: number;
  questionType: 'abcd' | 'short_answer';
  questionText: string;
  optionA?: string;
  optionB?: string;
  optionC?: string;
  optionD?: string;
  correctAnswer?: 'A' | 'B' | 'C' | 'D';
  shortAnswerAccepted?: string[];
  explanation?: string;
  hasExplicitAnswer: boolean;
  warnings: string[];
}

export interface RawParseResult {
  questions: ParsedRawQuestion[];
  warnings: string[];
  answeredCount: number;
  abcdCount: number;
  shortAnswerCount: number;
}

export type BatchGenerationMode =
  | 'split_sequential'
  | 'split_random'
  | 'shuffle_variants'
  | 'per_file';

export interface RawBatchExamConfig {
  baseTitle: string;
  grade: GradeLevel;
  subject: SubjectId;
  textbookSeries: string;
  examType: ExamType;
  academicYear: string;
  semester: '1' | '2';
  durationMinutes: number;
  totalScore: number;
  allowRetake: boolean;
  published: boolean;
  createdBy: string;
  mode: BatchGenerationMode;
  examCount: number;
  questionsPerExam: number;
  shuffleOptionsInVariants: boolean;
}

function deterministicHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffleWithSeed<T>(items: T[], seedStr: string): T[] {
  const copy = [...items];
  let state = deterministicHash(seedStr);
  for (let i = copy.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function cleanOptionText(raw: string): string {
  return raw
    .replace(/^\*?\s*/, '')
    .replace(/^[.):\-]\s*/, '')
    .trim();
}

function extractInlineAnswerKeyMap(text: string): Map<number, string> {
  const keyMap = new Map<number, string>();
  const pairRegex = /(?:^|[\s,;|])(?:Q|Câu|Question|Bài)?\s*(\d{1,3})\s*[:.\-)]\s*([A-D])\b/gi;
  let match: RegExpExecArray | null;
  while ((match = pairRegex.exec(text)) !== null) {
    const qNum = Number(match[1]);
    const ans = match[2].toUpperCase();
    if (qNum > 0 && ['A', 'B', 'C', 'D'].includes(ans)) {
      keyMap.set(qNum, ans);
    }
  }
  return keyMap;
}

function isAnswerKeyHeaderLine(line: string): boolean {
  return /^(?:#+\s*)?(?:đáp\s*án(?:\s+chi\s+tiết|\s+đề)?|bảng\s*đáp\s*án|answer\s*key|key)\s*:?\s*$/i.test(
    line.trim()
  );
}

function isCompactAnswerKeyLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  // E.g. "ĐÁP ÁN: 1A 2B 3C 4D" or "1.A  2.B  3.C  4.D" (no option B./C. sentences)
  const stripped = trimmed.replace(/^(?:đáp\s*án|bảng\s*đáp\s*án|answer\s*key|key)\s*:\s*/i, '');
  const pairs = stripped.match(/(?:^|[\s,;|])(?:Q|Câu)?\s*\d{1,3}\s*[:.\-)]?\s*[A-D](?=$|[\s,;|])/gi);
  if (!pairs || pairs.length < 2) return false;
  const remainder = stripped
    .replace(/(?:^|[\s,;|])(?:Q|Câu)?\s*\d{1,3}\s*[:.\-)]?\s*[A-D](?=$|[\s,;|])/gi, '')
    .replace(/[\s,;|.]/g, '');
  return remainder.length === 0;
}

/**
 * Parses a single compact line such as:
 *   "Q1:Ai là người giỏi:A..:B...:C...:D...:Đáp án: A"
 *   "Q1: Ai là người giỏi | A. Nam | B. Hoa | C. Lan | D. Bình | B"
 */
function tryParseDelimitedSingleBlock(
  blockText: string,
  fallbackIndex: number
): ParsedRawQuestion | null {
  const singleLine = blockText.replace(/\r?\n+/g, ' ').trim();
  // Match compact colon or pipe delimiters before A.. / A. / *A. etc.
  const delimiterRegex = /([:|])\s*(\*?[A-D](?:[.):\-]|\s+)|(?:đáp\s*án(?:\s*đúng)?|đ\.?a|answer|ans|key|giải\s*thích|explanation)\s*:?)/gi;

  // Quick pre-check: must contain at least A and B markers preceded by : or |
  const hasColonOrPipeA = /(?:^|[:|])\s*\*?A(?:[.):\-]|\s+)/i.test(singleLine);
  const hasColonOrPipeB = /[:|]\s*\*?B(?:[.):\-]|\s+)/i.test(singleLine);
  if (!hasColonOrPipeA || !hasColonOrPipeB) {
    return null;
  }

  // Find indices where option or answer tokens start right after : or |
  interface MarkerHit {
    sepIndex: number;
    tokenStart: number;
    type: 'A' | 'B' | 'C' | 'D' | 'ANS' | 'EXP';
    starred: boolean;
    contentStart: number;
  }

  const hits: MarkerHit[] = [];
  const markerScan = /([:|])\s*(?:(\*?)([A-D])(?=[.):\-\s])|(đáp\s*án(?:\s*đúng)?|đ\.?a|answer|ans|key)\s*[:=]?|(giải\s*thích|explanation)\s*[:=]?)/gi;

  let m: RegExpExecArray | null;
  while ((m = markerScan.exec(singleLine)) !== null) {
    const sepIndex = m.index;
    const tokenStart = sepIndex + m[1].length;
    if (m[3]) {
      const letter = m[3].toUpperCase() as 'A' | 'B' | 'C' | 'D';
      const starred = m[2] === '*';
      // Ensure we don't accidentally match a trailing single answer letter after D (handled separately)
      hits.push({
        sepIndex,
        tokenStart,
        type: letter,
        starred,
        contentStart: m.index + m[0].length,
      });
    } else if (m[4]) {
      hits.push({
        sepIndex,
        tokenStart,
        type: 'ANS',
        starred: false,
        contentStart: m.index + m[0].length,
      });
    } else if (m[5]) {
      hits.push({
        sepIndex,
        tokenStart,
        type: 'EXP',
        starred: false,
        contentStart: m.index + m[0].length,
      });
    }
  }

  // We need ordered A, B (and usually C, D)
  const firstA = hits.find((h) => h.type === 'A');
  const firstB = firstA ? hits.find((h) => h.type === 'B' && h.sepIndex > firstA.sepIndex) : undefined;
  if (!firstA || !firstB) return null;

  const firstC = hits.find((h) => h.type === 'C' && h.sepIndex > firstB.sepIndex);
  const firstD = firstC ? hits.find((h) => h.type === 'D' && h.sepIndex > firstC.sepIndex) : undefined;

  const orderedHits: MarkerHit[] = [firstA, firstB];
  if (firstC) orderedHits.push(firstC);
  if (firstD) orderedHits.push(firstD);

  const lastOptSep = orderedHits[orderedHits.length - 1].sepIndex;
  for (const h of hits) {
    if ((h.type === 'ANS' || h.type === 'EXP') && h.sepIndex > lastOptSep) {
      orderedHits.push(h);
    }
  }
  orderedHits.sort((a, b) => a.sepIndex - b.sepIndex);

  // Extract question stem (before firstA.sepIndex)
  const rawStem = singleLine.slice(0, firstA.sepIndex).trim();
  const stemNumMatch = rawStem.match(/^(?:Q|Câu|Question|Bài)?\s*(\d+)\s*[:.)\-]?\s*(.*)$/i);
  const sourceIndex = stemNumMatch && stemNumMatch[1] ? Number(stemNumMatch[1]) : fallbackIndex;
  const questionText = (stemNumMatch ? stemNumMatch[2] : rawStem).trim();

  if (!questionText) return null;

  let optionA = '';
  let optionB = '';
  let optionC = '';
  let optionD = '';
  let correctAnswer: 'A' | 'B' | 'C' | 'D' | undefined;
  let explanation = '';

  for (let i = 0; i < orderedHits.length; i += 1) {
    const cur = orderedHits[i];
    const nextSep = i + 1 < orderedHits.length ? orderedHits[i + 1].sepIndex : singleLine.length;
    let slice = singleLine.slice(cur.contentStart, nextSep).trim();

    if (cur.type === 'A' || cur.type === 'B' || cur.type === 'C' || cur.type === 'D') {
      if (cur.starred) correctAnswer = cur.type;
      // Check if the last option has a trailing ":A" / "| B" shorthand answer without "Đáp án:"
      if (i === orderedHits.length - 1 || orderedHits[i + 1].type === 'EXP') {
        const trailingAnsMatch = slice.match(/^(.*?)[:|]\s*([A-D])\s*$/i);
        if (trailingAnsMatch && !correctAnswer) {
          slice = trailingAnsMatch[1].trim();
          correctAnswer = trailingAnsMatch[2].toUpperCase() as 'A' | 'B' | 'C' | 'D';
        }
      }
      const cleaned = cleanOptionText(slice);
      if (cur.type === 'A') optionA = cleaned;
      if (cur.type === 'B') optionB = cleaned;
      if (cur.type === 'C') optionC = cleaned;
      if (cur.type === 'D') optionD = cleaned;
    } else if (cur.type === 'ANS') {
      const letterMatch = slice.match(/\b([A-D])\b/i);
      if (letterMatch) {
        correctAnswer = letterMatch[1].toUpperCase() as 'A' | 'B' | 'C' | 'D';
      }
    } else if (cur.type === 'EXP') {
      explanation = slice.replace(/^[:.\-\s]+/, '').trim();
    }
  }

  // Silence unused regex var
  void delimiterRegex;

  const warnings: string[] = [];
  if (!optionC || !optionD) {
    warnings.push(`Câu ${sourceIndex}: thiếu lựa chọn C hoặc D.`);
  }

  return {
    sourceIndex,
    questionType: 'abcd',
    questionText,
    optionA: optionA || '—',
    optionB: optionB || '—',
    optionC: optionC || '—',
    optionD: optionD || '—',
    correctAnswer,
    explanation: explanation || undefined,
    hasExplicitAnswer: Boolean(correctAnswer),
    warnings,
  };
}

/**
 * Parses a multi-line or inline-option block (e.g. Q1: ... \n A. ... \n B. ... \n C. ... \n D. ... \n Đáp án: A)
 */
function parseGeneralQuestionBlock(
  blockText: string,
  fallbackIndex: number
): ParsedRawQuestion | null {
  // First try compact colon/pipe single-line style (e.g. Q1:...:A..:B...:C...:D...)
  const compact = tryParseDelimitedSingleBlock(blockText, fallbackIndex);
  if (compact) return compact;

  const lines = blockText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  // Extract question number & stem start from first line
  const firstLine = lines[0];
  const qHeaderMatch = firstLine.match(/^(?:Q|Câu|Question|Bài)?\s*(\d+)\s*[:.)\-]?\s*(.*)$/i);
  const sourceIndex = qHeaderMatch && qHeaderMatch[1] ? Number(qHeaderMatch[1]) : fallbackIndex;
  const firstRest = (qHeaderMatch ? qHeaderMatch[2] : firstLine).trim();

  const normalizedLines = [firstRest, ...lines.slice(1)].filter(Boolean);
  const fullText = normalizedLines.join('\n');

  // Check for explicit answer / explanation lines first
  let correctAnswer: 'A' | 'B' | 'C' | 'D' | undefined;
  let shortAnswerRaw = '';
  let explanation = '';
  const bodyLines: string[] = [];

  for (const line of normalizedLines) {
    const expMatch = line.match(/^(?:giải\s*thích|hướng\s*dẫn|hd|explanation)\s*[:=\-]\s*(.+)$/i);
    if (expMatch) {
      explanation = expMatch[1].trim();
      continue;
    }

    const ansMatch = line.match(
      /^(?:đáp\s*án(?:\s*đúng)?|đ\.?a|answer|ans|key)\s*[:=\-]\s*(.+)$/i
    );
    if (ansMatch) {
      const val = ansMatch[1].trim();
      const singleLetter = val.match(/^([A-D])(?:[.):\-\s]|$)/i);
      if (singleLetter) {
        correctAnswer = singleLetter[1].toUpperCase() as 'A' | 'B' | 'C' | 'D';
      } else {
        shortAnswerRaw = val;
      }
      continue;
    }

    bodyLines.push(line);
  }

  const bodyText = bodyLines.join('\n').trim();
  if (!bodyText) return null;

  // Split inline options on the same line (e.g. "A. 1   B. 2   C. 3   D. 4") or multi-line options
  const optRegex = /(?:^|\n|\s{2,}|\t)(\*?[A-D]\*?)\s*[.):\-]\s*/g;
  const optMatches: Array<{ letter: 'A' | 'B' | 'C' | 'D'; starred: boolean; index: number; end: number }> = [];
  let om: RegExpExecArray | null;
  while ((om = optRegex.exec(bodyText)) !== null) {
    const rawToken = om[1];
    const starred = rawToken.includes('*');
    const letter = rawToken.replace(/\*/g, '').toUpperCase() as 'A' | 'B' | 'C' | 'D';
    optMatches.push({
      letter,
      starred,
      index: om.index,
      end: om.index + om[0].length,
    });
  }

  // Pick sequential A -> B -> C -> D
  const idxA = optMatches.find((m) => m.letter === 'A');
  const idxB = idxA ? optMatches.find((m) => m.letter === 'B' && m.index > idxA.index) : undefined;
  const idxC = idxB ? optMatches.find((m) => m.letter === 'C' && m.index > idxB.index) : undefined;
  const idxD = idxC ? optMatches.find((m) => m.letter === 'D' && m.index > idxC.index) : undefined;

  if (idxA && idxB) {
    const chosen = [idxA, idxB, ...(idxC ? [idxC] : []), ...(idxD ? [idxD] : [])];
    const questionText = bodyText.slice(0, idxA.index).trim();
    if (!questionText) return null;

    const optionMap: Record<'A' | 'B' | 'C' | 'D', string> = { A: '', B: '', C: '', D: '' };
    for (let i = 0; i < chosen.length; i += 1) {
      const cur = chosen[i];
      const nextStart = i + 1 < chosen.length ? chosen[i + 1].index : bodyText.length;
      let optVal = bodyText.slice(cur.end, nextStart).trim();
      if (cur.starred) correctAnswer = cur.letter;

      // Check inline "Đáp án: X" or "Giải thích: ..." stuck at end of last option
      if (i === chosen.length - 1) {
        const inlineAns = optVal.match(/^(.*?)\s*(?:đáp\s*án(?:\s*đúng)?|answer|key)\s*[:=\-]\s*([A-D])\b(.*)$/i);
        if (inlineAns) {
          optVal = inlineAns[1].trim();
          correctAnswer = inlineAns[2].toUpperCase() as 'A' | 'B' | 'C' | 'D';
          if (inlineAns[3]?.trim() && !explanation) {
            explanation = inlineAns[3].replace(/^[:.\-\s]+/, '').trim();
          }
        }
      }
      optionMap[cur.letter] = optVal;
    }

    const warnings: string[] = [];
    if (!optionMap.C || !optionMap.D) {
      warnings.push(`Câu ${sourceIndex}: thiếu lựa chọn C hoặc D.`);
    }

    return {
      sourceIndex,
      questionType: 'abcd',
      questionText,
      optionA: optionMap.A || '—',
      optionB: optionMap.B || '—',
      optionC: optionMap.C || '—',
      optionD: optionMap.D || '—',
      correctAnswer,
      explanation: explanation || undefined,
      hasExplicitAnswer: Boolean(correctAnswer),
      warnings,
    };
  }

  // Fallback: Short-answer question if explicit answer was found (e.g. "Q5: 2+3=? : Đáp án: 5")
  const colonShortMatch = fullText.match(
    /^(.*?)(?:[:|]\s*(?:đáp\s*án(?:\s*đúng)?|đ\.?a|answer|ans|key)\s*[:=\-]?\s*)(.+)$/i
  );
  if (shortAnswerRaw || colonShortMatch) {
    const stem = colonShortMatch
      ? colonShortMatch[1].replace(/^(?:Q|Câu|Question|Bài)?\s*\d+\s*[:.)\-]?\s*/i, '').trim()
      : bodyText;
    const rawAns = shortAnswerRaw || (colonShortMatch ? colonShortMatch[2].trim() : '');
    const accepted = rawAns
      .split(/[|;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (stem && accepted.length > 0) {
      return {
        sourceIndex,
        questionType: 'short_answer',
        questionText: stem,
        shortAnswerAccepted: accepted,
        explanation: explanation || undefined,
        hasExplicitAnswer: true,
        warnings: [],
      };
    }
  }

  return null;
}

/**
 * Parses raw question & answer text (supporting compact single-line `Q1:...:A..:B...:C...:D...`,
 * standard multi-line blocks, `*` answer markers, and trailing answer key sections).
 */
export function parseRawExamQuestions(rawText: string): RawParseResult {
  const cleanedInput = (rawText || '').replace(/^\uFEFF/, '').trim();
  if (!cleanedInput) {
    return {
      questions: [],
      warnings: ['Nội dung văn bản thô đang trống.'],
      answeredCount: 0,
      abcdCount: 0,
      shortAnswerCount: 0,
    };
  }

  const lines = cleanedInput.split(/\r?\n/);
  const questionLines: string[] = [];
  const trailingKeyLines: string[] = [];
  let inAnswerKeySection = false;

  for (const line of lines) {
    if (isAnswerKeyHeaderLine(line)) {
      inAnswerKeySection = true;
      continue;
    }
    if (inAnswerKeySection) {
      trailingKeyLines.push(line);
      continue;
    }
    if (isCompactAnswerKeyLine(line)) {
      trailingKeyLines.push(line);
      continue;
    }
    questionLines.push(line);
  }

  const answerKeyMap = extractInlineAnswerKeyMap(trailingKeyLines.join('\n'));

  // Segment questionLines into discrete question blocks
  const blocks: string[] = [];
  let currentBlock: string[] = [];
  const qStartLineRegex = /^(?:Q\d+|Câu\s+\d+|Question\s+\d+|Bài\s+\d+|\d+[.)])\s*(?:[:.)\-]|\s|$)/i;

  for (const rawLine of questionLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
        currentBlock = [];
      }
      continue;
    }

    // If a new question header starts immediately without blank line, flush previous block
    if (currentBlock.length > 0 && qStartLineRegex.test(trimmed)) {
      blocks.push(currentBlock.join('\n'));
      currentBlock = [trimmed];
    } else {
      currentBlock.push(trimmed);
    }
  }
  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join('\n'));
  }

  const parsedQuestions: ParsedRawQuestion[] = [];
  const warnings: string[] = [];

  blocks.forEach((block, idx) => {
    const parsed = parseGeneralQuestionBlock(block, idx + 1);
    if (!parsed) {
      const preview = block.replace(/\s+/g, ' ').slice(0, 70);
      if (preview.length > 3) {
        warnings.push(`Không thể đọc định dạng câu ở đoạn: "${preview}${block.length > 70 ? '...' : ''}"`);
      }
      return;
    }

    // Apply trailing answer key if inline answer wasn't specified
    if (parsed.questionType === 'abcd' && !parsed.correctAnswer) {
      const keyAns = answerKeyMap.get(parsed.sourceIndex) || answerKeyMap.get(parsedQuestions.length + 1);
      if (keyAns && ['A', 'B', 'C', 'D'].includes(keyAns)) {
        parsed.correctAnswer = keyAns as 'A' | 'B' | 'C' | 'D';
        parsed.hasExplicitAnswer = true;
      } else {
        parsed.warnings.push(`Câu ${parsed.sourceIndex}: chưa có đáp án đúng, tạm đặt mặc định A (cần kiểm tra).`);
      }
    }

    warnings.push(...parsed.warnings);
    parsedQuestions.push(parsed);
  });

  const answeredCount = parsedQuestions.filter((q) => q.hasExplicitAnswer).length;
  const abcdCount = parsedQuestions.filter((q) => q.questionType === 'abcd').length;
  const shortAnswerCount = parsedQuestions.filter((q) => q.questionType === 'short_answer').length;

  return {
    questions: parsedQuestions,
    warnings: Array.from(new Set(warnings)),
    answeredCount,
    abcdCount,
    shortAnswerCount,
  };
}

function toExamQuestion(
  parsed: ParsedRawQuestion,
  orderIndex: number,
  examSeed: string,
  shuffleOptions: boolean
): ExamQuestion {
  const qId = `eq_raw_${deterministicHash(`${examSeed}:${orderIndex}:${parsed.questionText}`).toString(36)}_${orderIndex}`;
  if (parsed.questionType === 'short_answer') {
    return {
      questionId: qId,
      orderIndex,
      chapterId: 'Tổng hợp từ ngân hàng chữ thô',
      conceptId: 'Theo nội dung đề nhập',
      learningOutcome: 'Trả lời ngắn theo đề gốc',
      cognitiveLevel: 'thong_hieu',
      questionType: 'short_answer',
      scoreWeight: 0.5,
      questionText: parsed.questionText.slice(0, 2000),
      shortAnswerAccepted: (parsed.shortAnswerAccepted || ['']).slice(0, 10),
      explanation: (
        parsed.explanation ||
        `Đáp án đúng: ${(parsed.shortAnswerAccepted || []).join(' | ')}.`
      ).slice(0, 2000),
      sourceReference: 'Admin nhập từ tệp chữ thô',
      sourceType: 'teacher_material',
      validationStatus: parsed.hasExplicitAnswer ? 'passed' : 'needs_review',
      validationIssues: parsed.warnings.length > 0 ? parsed.warnings : undefined,
    };
  }

  let optionA = (parsed.optionA || '—').slice(0, 500);
  let optionB = (parsed.optionB || '—').slice(0, 500);
  let optionC = (parsed.optionC || '—').slice(0, 500);
  let optionD = (parsed.optionD || '—').slice(0, 500);
  let correctAnswer: 'A' | 'B' | 'C' | 'D' = parsed.correctAnswer || 'A';

  if (shuffleOptions) {
    const pairs: Array<{ key: 'A' | 'B' | 'C' | 'D'; text: string }> = [
      { key: 'A', text: optionA },
      { key: 'B', text: optionB },
      { key: 'C', text: optionC },
      { key: 'D', text: optionD },
    ];
    const shuffled = shuffleWithSeed(pairs, `${examSeed}:${qId}`);
    const letters: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
    const newCorrectIdx = shuffled.findIndex((p) => p.key === correctAnswer);
    optionA = shuffled[0].text;
    optionB = shuffled[1].text;
    optionC = shuffled[2].text;
    optionD = shuffled[3].text;
    correctAnswer = letters[newCorrectIdx >= 0 ? newCorrectIdx : 0];
  }

  return {
    questionId: qId,
    orderIndex,
    chapterId: 'Tổng hợp từ ngân hàng chữ thô',
    conceptId: 'Theo nội dung đề nhập',
    learningOutcome: 'Kiến thức theo tệp câu hỏi gốc',
    cognitiveLevel: 'thong_hieu',
    questionType: 'abcd',
    scoreWeight: 0.25,
    questionText: parsed.questionText.slice(0, 2000),
    optionA,
    optionB,
    optionC,
    optionD,
    correctAnswer,
    explanation: (
      parsed.explanation ||
      (parsed.hasExplicitAnswer
        ? `Đáp án đúng theo tài liệu gốc là ${correctAnswer}.`
        : `Tạm đặt đáp án ${correctAnswer} do tệp thô chưa ghi đáp án — Admin vui lòng kiểm tra lại.`)
    ).slice(0, 2000),
    sourceReference: 'Admin nhập từ tệp chữ thô',
    sourceType: 'teacher_material',
    validationStatus: parsed.hasExplicitAnswer ? 'passed' : 'needs_review',
    validationIssues: parsed.warnings.length > 0 ? parsed.warnings : undefined,
  };
}

/**
 * Generates one or multiple ExamDocuments from parsed raw questions according to the chosen batch mode.
 */
export function generateExamBatchFromRawQuestions(params: {
  pool: ParsedRawQuestion[];
  fileGroups?: Array<{ fileName: string; questions: ParsedRawQuestion[] }>;
  config: RawBatchExamConfig;
}): ExamDocument[] {
  const { pool, fileGroups, config } = params;
  const now = new Date().toISOString();
  const baseStamp = Date.now();
  const clampedPerExam = Math.max(1, Math.min(60, Math.floor(config.questionsPerExam) || 10));
  const clampedExamCount = Math.max(1, Math.min(20, Math.floor(config.examCount) || 1));

  const buildExamDoc = (
    rawQuestions: ParsedRawQuestion[],
    titleSuffix: string,
    idx: number,
    shuffleOpts: boolean
  ): ExamDocument => {
    const capped = rawQuestions.slice(0, 60);
    const examId = `exam_raw_${baseStamp}_${idx + 1}`;
    const examQuestions = distributeExamQuestionScores(
      capped.map((q, qIdx) => toExamQuestion(q, qIdx + 1, `${examId}_${titleSuffix}`, shuffleOpts)),
      config.totalScore
    );
    const needsReview = examQuestions.some((q) => q.validationStatus === 'needs_review');

    const baseTitle = config.baseTitle.trim() || 'Đề kiểm tra từ kho câu hỏi thô';
    const fullTitle = `${baseTitle}${titleSuffix}`.slice(0, 200);

    return {
      examId,
      blueprintId: 'raw_text_batch',
      title: fullTitle,
      description: `Tạo từ nguồn văn bản thô (${examQuestions.length} câu · ${config.totalScore} điểm).`,
      grade: config.grade,
      subject: config.subject,
      textbookSeries: config.textbookSeries,
      examType: config.examType,
      academicYear: config.academicYear,
      semester: config.semester,
      chapters: ['Tổng hợp từ tệp chữ thô'],
      durationMinutes: Math.max(5, Math.min(180, Math.floor(config.durationMinutes) || 45)),
      totalScore: Math.max(1, Math.min(100, Number(config.totalScore) || 10)),
      allowRetake: config.allowRetake,
      published: config.published,
      validationStatus: needsReview ? 'needs_review' : 'passed',
      questions: examQuestions,
      createdBy: config.createdBy || 'admin',
      createdAt: now,
      updatedAt: now,
    };
  };

  if (config.mode === 'per_file' && fileGroups && fileGroups.length > 0) {
    return fileGroups
      .filter((g) => g.questions.length > 0)
      .slice(0, 20)
      .map((group, idx) => {
        const cleanFileLabel = group.fileName.replace(/\.[^.]+$/, '').trim();
        const suffix = fileGroups.length > 1 || !config.baseTitle.trim() ? ` - ${cleanFileLabel}` : '';
        return buildExamDoc(
          group.questions,
          suffix,
          idx,
          config.shuffleOptionsInVariants
        );
      });
  }

  if (pool.length === 0) return [];

  if (config.mode === 'split_sequential' || config.mode === 'split_random') {
    const orderedPool =
      config.mode === 'split_random'
        ? shuffleWithSeed(pool, `split_rand_${baseStamp}_${pool.length}`)
        : pool;
    const chunks: ParsedRawQuestion[][] = [];
    for (let i = 0; i < orderedPool.length && chunks.length < 20; i += clampedPerExam) {
      chunks.push(orderedPool.slice(i, i + clampedPerExam));
    }
    return chunks.map((chunk, idx) =>
      buildExamDoc(
        chunk,
        chunks.length > 1 ? ` - Đề số ${String(idx + 1).padStart(2, '0')}` : '',
        idx,
        config.shuffleOptionsInVariants
      )
    );
  }

  // 'shuffle_variants': generate N distinct shuffled exam sets from the pool
  const docs: ExamDocument[] = [];
  const takeCount = Math.min(clampedPerExam, pool.length);
  for (let i = 0; i < clampedExamCount; i += 1) {
    const shuffledPool = shuffleWithSeed(pool, `variant_${baseStamp}_${i + 1}_${pool.length}`);
    const subset = shuffledPool.slice(0, takeCount);
    docs.push(
      buildExamDoc(
        subset,
        clampedExamCount > 1 ? ` - Đề ${String(i + 1).padStart(2, '0')}` : '',
        i,
        config.shuffleOptionsInVariants
      )
    );
  }
  return docs;
}
