import { distributeExamQuestionScores, syncShuffledAbcdExplanation } from './quizValidation.js';
import type {
  ExamDocument,
  ExamQuestion,
  ExamType,
  GradeLevel,
  SubjectId,
  TrueFalseStatement,
} from './types.js';

export interface ParsedRawQuestion {
  sourceIndex: number;
  questionType: 'abcd' | 'true_false' | 'short_answer';
  questionText: string;
  optionA?: string;
  optionB?: string;
  optionC?: string;
  optionD?: string;
  correctAnswer?: 'A' | 'B' | 'C' | 'D';
  trueFalseStatements?: TrueFalseStatement[];
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
  trueFalseCount: number;
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

const TF_LABELS: ReadonlyArray<'a' | 'b' | 'c' | 'd'> = ['a', 'b', 'c', 'd'];

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

function splitUnescaped(text: string, delimiter: ':' | '|'): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length && text[i + 1] === delimiter) {
      current += delimiter;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function stripLeadingQuestionNumber(raw: string, fallbackIndex: number): {
  sourceIndex: number;
  rest: string;
  hadPrefix: boolean;
} {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(?:Q|Câu|Question|Bài)\s*(\d+)\s*[:.)\-]?\s*(.*)$/i);
  if (match && match[1]) {
    return {
      sourceIndex: Number(match[1]),
      rest: (match[2] || '').trim(),
      hadPrefix: true,
    };
  }
  const numOnlyMatch = trimmed.match(/^(\d{1,3})\s*[.)\-]\s*(.+)$/);
  if (numOnlyMatch && numOnlyMatch[1]) {
    return {
      sourceIndex: Number(numOnlyMatch[1]),
      rest: (numOnlyMatch[2] || '').trim(),
      hadPrefix: true,
    };
  }
  return {
    sourceIndex: fallbackIndex,
    rest: trimmed,
    hadPrefix: false,
  };
}

function isPureQuestionNumberToken(token: string): number | null {
  const m = token.trim().match(/^(?:Q|Câu|Question|Bài)?\s*(\d{1,3})$/i);
  return m ? Number(m[1]) : null;
}

function parseBooleanToken(raw: string): boolean | null {
  const normalized = raw.trim().toLowerCase();
  if (['đ', 'd', 't', 'đúng', 'dung', 'true', '1'].includes(normalized)) return true;
  if (['s', 'f', 'sai', 'false', '0'].includes(normalized)) return false;
  return null;
}

/**
 * Parses flexible 4-item True/False answer strings:
 *   "Đ-S-Đ-Đ", "Đ S Đ S", "T-F-T-T", "D,S,D,D", "ĐSĐĐ", "a:Đ b:S c:Đ d:S"
 */
export function parseTrueFalseAnswerKey(raw: string): boolean[] | null {
  const cleaned = raw
    .trim()
    .replace(/^(?:đáp\s*án(?:\s*đúng)?|đ\.?a|answer|ans|key)\s*[:=\-]?\s*/i, '')
    .trim();
  if (!cleaned) return null;

  // Format: "a:Đ b:S c:Đ d:S" or "a) Đ, b) S, c) Đ, d) S"
  const labeledMap = new Map<'a' | 'b' | 'c' | 'd', boolean>();
  const labeledRegex =
    /(?:^|[\s,;/|])([a-d])\s*[:.)\-=]\s*(đúng|dung|true|sai|false|[đdtfs10])(?=$|[\s,;/|])/giu;
  let lm: RegExpExecArray | null;
  while ((lm = labeledRegex.exec(cleaned)) !== null) {
    const lbl = lm[1].toLowerCase() as 'a' | 'b' | 'c' | 'd';
    const val = parseBooleanToken(lm[2]);
    if (val !== null) labeledMap.set(lbl, val);
  }
  if (labeledMap.size === 4) {
    return TF_LABELS.map((l) => Boolean(labeledMap.get(l)));
  }

  // Format: compact 4-character string like "ĐSĐĐ", "TFTT", "DSDD"
  if (/^[đdtfsĐDTFS]{4}$/u.test(cleaned)) {
    const chars = Array.from(cleaned);
    const parsed = chars.map((c) => parseBooleanToken(c));
    if (parsed.every((v): v is boolean => v !== null)) return parsed;
  }

  // Format: separated tokens like "Đ-S-Đ-Đ", "T, F, T, T", "Đúng / Sai / Đúng / Sai"
  const tokens = cleaned
    .split(/[\s,\-;/|]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 4) {
    const parsed = tokens.map((t) => parseBooleanToken(t));
    if (parsed.every((v): v is boolean => v !== null)) return parsed;
  }

  return null;
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
  const stripped = trimmed.replace(/^(?:đáp\s*án|bảng\s*đáp\s*án|answer\s*key|key)\s*:\s*/i, '');
  const pairs = stripped.match(/(?:^|[\s,;|])(?:Q|Câu)?\s*\d{1,3}\s*[:.\-)]?\s*[A-D](?=$|[\s,;|])/gi);
  if (!pairs || pairs.length < 2) return false;
  const remainder = stripped
    .replace(/(?:^|[\s,;|])(?:Q|Câu)?\s*\d{1,3}\s*[:.\-)]?\s*[A-D](?=$|[\s,;|])/gi, '')
    .replace(/[\s,;|.]/g, '');
  return remainder.length === 0;
}

/**
 * RFC-4180 quote-aware CSV/TSV parser supporting multi-line quoted cells.
 */
function parseDelimitedRows(text: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
      continue;
    }
    if (ch === '\r') continue;
    if (ch === '\n') {
      row.push(cell.trim());
      if (row.some((c) => c.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }

  row.push(cell.trim());
  if (row.some((c) => c.length > 0)) {
    rows.push(row);
  }
  return rows;
}

function normalizeTableType(raw: string): 'abcd' | 'true_false' | 'short_answer' | null {
  const t = raw.trim().toLowerCase();
  if (['abcd', 'mc', 'mcq', 'trac_nghiem', 'trắc nghiệm', 'tn'].includes(t)) return 'abcd';
  if (['true_false', 'tf', 'ds', 'đs', 'dung_sai', 'đúng sai', 'đúng/sai'].includes(t)) {
    return 'true_false';
  }
  if (['short_answer', 'sa', 'tln', 'tra_loi_ngan', 'trả lời ngắn'].includes(t)) {
    return 'short_answer';
  }
  return null;
}

function tryParseDelimitedTable(cleanedInput: string): RawParseResult | null {
  const nonEmptyLines = cleanedInput
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (nonEmptyLines.length === 0) return null;

  const firstLine = nonEmptyLines[0];
  const isTsv = nonEmptyLines.filter((l) => l.includes('\t')).length >= Math.ceil(nonEmptyLines.length * 0.6);

  let delimiter: ',' | '\t' | null = null;
  if (isTsv) {
    delimiter = '\t';
  } else {
    const firstCsvRow = parseDelimitedRows(firstLine, ',')[0] || [];
    const headerCells = firstCsvRow.map((c) => c.toLowerCase().trim());
    const looksLikeHeader =
      headerCells.length >= 5 &&
      (headerCells.includes('question') ||
        headerCells.includes('cau_hoi') ||
        headerCells.includes('câu hỏi') ||
        headerCells.includes('type'));
    const looksLikeTypedCsvRow =
      firstCsvRow.length >= 5 && normalizeTableType(firstCsvRow[0]) !== null;
    if (looksLikeHeader || looksLikeTypedCsvRow) {
      delimiter = ',';
    }
  }

  if (!delimiter) return null;

  const rows = parseDelimitedRows(cleanedInput, delimiter);
  if (rows.length === 0) return null;

  // Detect optional header row
  const headerLower = rows[0].map((c) => c.toLowerCase().replace(/\s+/g, '_'));
  const hasHeader =
    headerLower.includes('question') ||
    headerLower.includes('cau_hoi') ||
    headerLower.includes('câu_hỏi') ||
    (headerLower.includes('type') && (headerLower.includes('answer') || headerLower.includes('a')));

  const findCol = (aliases: string[], fallback: number): number => {
    if (!hasHeader) return fallback;
    for (const alias of aliases) {
      const idx = headerLower.indexOf(alias);
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const dataRows = hasHeader ? rows.slice(1) : rows;
  if (dataRows.length === 0) return null;

  const colType = findCol(['type', 'loai', 'loại', 'question_type'], hasHeader ? -1 : 0);
  const hasPositionalTypeCol =
    !hasHeader && dataRows.some((r) => r.length > 0 && normalizeTableType(r[0]) !== null);

  const idxType = hasHeader ? colType : hasPositionalTypeCol ? 0 : -1;
  const idxQ = hasHeader
    ? findCol(['question', 'cau_hoi', 'câu_hỏi', 'stem', 'noi_dung'], idxType === 0 ? 1 : 0)
    : hasPositionalTypeCol
    ? 1
    : 0;
  const idxA = hasHeader ? findCol(['a', 'optiona', 'option_a', 'phuong_an_a'], idxQ + 1) : idxQ + 1;
  const idxB = hasHeader ? findCol(['b', 'optionb', 'option_b', 'phuong_an_b'], idxQ + 2) : idxQ + 2;
  const idxC = hasHeader ? findCol(['c', 'optionc', 'option_c', 'phuong_an_c'], idxQ + 3) : idxQ + 3;
  const idxD = hasHeader ? findCol(['d', 'optiond', 'option_d', 'phuong_an_d'], idxQ + 4) : idxQ + 4;
  const idxAns = hasHeader ? findCol(['answer', 'dap_an', 'đáp_án', 'key', 'correct'], idxQ + 5) : idxQ + 5;
  const idxExp = hasHeader
    ? findCol(['explanation', 'giai_thich', 'giải_thích', 'note'], idxQ + 6)
    : idxQ + 6;

  const questions: ParsedRawQuestion[] = [];
  const warnings: string[] = [];

  dataRows.forEach((rawRow, rowIdx) => {
    const sourceIndex = rowIdx + 1;
    // Normalize stray extra empty commas on short_answer rows (e.g. `short_answer,"Q",,,, ,3,"Exp"`)
    let row = [...rawRow];
    const explicitType = idxType >= 0 ? normalizeTableType(row[idxType] || '') : null;

    if (hasHeader && row.length > rows[0].length && explicitType === 'short_answer') {
      const excess = row.length - rows[0].length;
      let removed = 0;
      const compacted: string[] = [];
      for (let i = 0; i < row.length; i += 1) {
        if (i >= idxA && i <= idxD + excess && row[i] === '' && removed < excess) {
          removed += 1;
          continue;
        }
        compacted.push(row[i]);
      }
      row = compacted;
    }

    const get = (colIdx: number): string => (colIdx >= 0 && colIdx < row.length ? row[colIdx].trim() : '');
    const questionText = get(idxQ);
    if (!questionText) return;

    const rawA = get(idxA);
    const rawB = get(idxB);
    const rawC = get(idxC);
    const rawD = get(idxD);
    const rawAns = get(idxAns);
    const rawExp = get(idxExp);

    const inferredType: 'abcd' | 'true_false' | 'short_answer' =
      explicitType ||
      (parseTrueFalseAnswerKey(rawAns)
        ? 'true_false'
        : !rawA && !rawB && !rawC && !rawD && rawAns
        ? 'short_answer'
        : 'abcd');

    if (inferredType === 'short_answer') {
      const answerSource = rawAns || [rawA, rawB, rawC, rawD].find((v) => v.length > 0) || '';
      const accepted = answerSource
        .split(/[|;]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const qWarnings: string[] = [];
      if (accepted.length === 0) {
        qWarnings.push(`Câu ${sourceIndex} (Trả lời ngắn): chưa có đáp án trong bảng.`);
      }
      warnings.push(...qWarnings);
      questions.push({
        sourceIndex,
        questionType: 'short_answer',
        questionText,
        shortAnswerAccepted: accepted.length > 0 ? accepted : [''],
        explanation: rawExp || undefined,
        hasExplicitAnswer: accepted.length > 0,
        warnings: qWarnings,
      });
      return;
    }

    if (inferredType === 'true_false') {
      const rawStmts = [rawA, rawB, rawC, rawD];
      const starredFlags = rawStmts.map((s) => s.startsWith('*'));
      const keyFlags = parseTrueFalseAnswerKey(rawAns);
      const hasAnyStar = starredFlags.some(Boolean);
      const flags = keyFlags || (hasAnyStar ? starredFlags : [true, false, true, false]);
      const hasExplicitAnswer = Boolean(keyFlags || hasAnyStar);

      const qWarnings: string[] = [];
      if (!hasExplicitAnswer) {
        qWarnings.push(`Câu ${sourceIndex} (Đúng/Sai): chưa có chuỗi đáp án 4 ý, cần kiểm tra.`);
      }
      const statements: TrueFalseStatement[] = TF_LABELS.map((label, idx) => ({
        label,
        text: rawStmts[idx].replace(/^\*\s*/, '').replace(/^[a-d][.):\-]\s*/i, '').trim() || `Mệnh đề ${label}`,
        isTrue: Boolean(flags[idx]),
      }));
      warnings.push(...qWarnings);
      questions.push({
        sourceIndex,
        questionType: 'true_false',
        questionText,
        trueFalseStatements: statements,
        explanation: rawExp || undefined,
        hasExplicitAnswer,
        warnings: qWarnings,
      });
      return;
    }

    // ABCD row
    let correctAnswer: 'A' | 'B' | 'C' | 'D' | undefined;
    const rawOpts: Array<{ letter: 'A' | 'B' | 'C' | 'D'; val: string }> = [
      { letter: 'A', val: rawA },
      { letter: 'B', val: rawB },
      { letter: 'C', val: rawC },
      { letter: 'D', val: rawD },
    ];
    const cleanOpts: Record<'A' | 'B' | 'C' | 'D', string> = { A: '', B: '', C: '', D: '' };
    for (const item of rawOpts) {
      if (item.val.startsWith('*')) {
        correctAnswer = item.letter;
      }
      cleanOpts[item.letter] = item.val.replace(/^\*\s*/, '').replace(/^[A-D][.):\-]\s*/i, '').trim();
    }
    const ansLetter = rawAns.match(/^\s*([A-D])\b/i);
    if (ansLetter) {
      correctAnswer = ansLetter[1].toUpperCase() as 'A' | 'B' | 'C' | 'D';
    }
    const qWarnings: string[] = [];
    if (!correctAnswer) {
      qWarnings.push(`Câu ${sourceIndex}: chưa có đáp án đúng, tạm đặt mặc định A (cần kiểm tra).`);
    }
    warnings.push(...qWarnings);
    questions.push({
      sourceIndex,
      questionType: 'abcd',
      questionText,
      optionA: cleanOpts.A || '—',
      optionB: cleanOpts.B || '—',
      optionC: cleanOpts.C || '—',
      optionD: cleanOpts.D || '—',
      correctAnswer,
      explanation: rawExp || undefined,
      hasExplicitAnswer: Boolean(correctAnswer),
      warnings: qWarnings,
    });
  });

  if (questions.length === 0) return null;

  return {
    questions,
    warnings: Array.from(new Set(warnings)),
    answeredCount: questions.filter((q) => q.hasExplicitAnswer).length,
    abcdCount: questions.filter((q) => q.questionType === 'abcd').length,
    trueFalseCount: questions.filter((q) => q.questionType === 'true_false').length,
    shortAnswerCount: questions.filter((q) => q.questionType === 'short_answer').length,
  };
}

/**
 * Parses True/False 4-statement blocks (GDPT 2018):
 * - Single-line with `[ĐS]` / `[TF]` + `|` or `:` + `a) ... | b) ... | c) ... | d) ... : Đ-Đ-S-Đ : Giải thích`
 * - Multi-line with `[ĐS]` or `a)`/`b)`/`c)`/`d)` lines and optional `*a)` star markers
 */
function tryParseTrueFalseBlock(
  blockText: string,
  fallbackIndex: number
): ParsedRawQuestion | null {
  const trimmed = blockText.trim();
  const hasExplicitTag = /^(?:(?:Q|Câu|Question|Bài)\s*\d+\s*[:.)\-]?\s*)?\[(?:ĐS|DS|TF|ĐÚNG\s*\/?\s*SAI)\]/i.test(
    trimmed
  );

  // Strip optional leading question number and [ĐS]/[TF] tag
  const numStrip = stripLeadingQuestionNumber(trimmed, fallbackIndex);
  let body = numStrip.rest.replace(/^\[(?:ĐS|DS|TF|ĐÚNG\s*\/?\s*SAI)\]\s*/i, '').trim();
  let sourceIndex = numStrip.sourceIndex;
  if (!numStrip.hadPrefix) {
    const afterTagNum = stripLeadingQuestionNumber(body, fallbackIndex);
    if (afterTagNum.hadPrefix) {
      sourceIndex = afterTagNum.sourceIndex;
      body = afterTagNum.rest;
    }
  }

  // Must either have explicit [ĐS]/[TF] tag OR contain a), b), c), d) markers
  const stmtRegex = /(?:^|[\n|:]|\s{2,})\s*(\*?)([a-d])\s*[.)]\s*/gi;
  const matches: Array<{
    letter: 'a' | 'b' | 'c' | 'd';
    starred: boolean;
    start: number;
    contentStart: number;
  }> = [];
  let m: RegExpExecArray | null;
  while ((m = stmtRegex.exec(body)) !== null) {
    // Require lowercase a-d unless explicit [ĐS]/[TF] tag is present (avoids hijacking ABCD questions)
    const rawLetter = m[2];
    if (!hasExplicitTag && rawLetter !== rawLetter.toLowerCase()) continue;
    matches.push({
      letter: rawLetter.toLowerCase() as 'a' | 'b' | 'c' | 'd',
      starred: m[1] === '*',
      start: m.index,
      contentStart: m.index + m[0].length,
    });
  }

  const hitA = matches.find((h) => h.letter === 'a');
  const hitB = hitA ? matches.find((h) => h.letter === 'b' && h.start > hitA.start) : undefined;
  const hitC = hitB ? matches.find((h) => h.letter === 'c' && h.start > hitB.start) : undefined;
  const hitD = hitC ? matches.find((h) => h.letter === 'd' && h.start > hitC.start) : undefined;

  if (!hitA || !hitB || !hitC || !hitD) {
    // Also check pure positional `[ĐS] stem | s1 | s2 | s3 | s4 | Đ-S-Đ-S | explanation`
    if (!hasExplicitTag) return null;
    const sep: '|' | ':' = splitUnescaped(body, '|').length >= 5 ? '|' : ':';
    const parts = splitUnescaped(body, sep).map((p) => p.trim());
    if (parts.length < 5) return null;

    let answerFlags: boolean[] | null = null;
    let explanation: string | undefined;
    let optEnd = parts.length;

    if (parts.length >= 7 && parseTrueFalseAnswerKey(parts[parts.length - 2])) {
      answerFlags = parseTrueFalseAnswerKey(parts[parts.length - 2]);
      explanation = parts[parts.length - 1].replace(/^(?:giải\s*thích|explanation)\s*[:=\-]?\s*/i, '').trim() || undefined;
      optEnd = parts.length - 2;
    } else if (parts.length >= 6 && parseTrueFalseAnswerKey(parts[parts.length - 1])) {
      answerFlags = parseTrueFalseAnswerKey(parts[parts.length - 1]);
      optEnd = parts.length - 1;
    }

    if (optEnd < 5) return null;
    const rawStmts = parts.slice(optEnd - 4, optEnd);
    const stem = parts.slice(0, optEnd - 4).join(sep === ':' ? ': ' : ' ').replace(/[:|]\s*$/, '').trim();
    if (!stem) return null;

    const starredFlags = rawStmts.map((s) => s.startsWith('*'));
    const hasAnyStar = starredFlags.some(Boolean);
    const flags = answerFlags || (hasAnyStar ? starredFlags : [true, false, true, false]);
    const hasExplicitAnswer = Boolean(answerFlags || hasAnyStar);

    const warnings: string[] = [];
    if (!hasExplicitAnswer) {
      warnings.push(`Câu ${sourceIndex} (Đúng/Sai): chưa có đáp án 4 ý, vui lòng kiểm tra.`);
    }

    return {
      sourceIndex,
      questionType: 'true_false',
      questionText: stem,
      trueFalseStatements: TF_LABELS.map((label, idx) => ({
        label,
        text: rawStmts[idx].replace(/^\*\s*/, '').replace(/^[a-d][.):\-]\s*/i, '').trim(),
        isTrue: Boolean(flags[idx]),
      })),
      explanation,
      hasExplicitAnswer,
      warnings,
    };
  }

  const ordered = [hitA, hitB, hitC, hitD];
  const stem = body
    .slice(0, hitA.start)
    .replace(/[|:\s]+$/, '')
    .trim();
  if (!stem) return null;

  const rawTexts: string[] = [];
  let tailRaw = '';

  for (let i = 0; i < ordered.length; i += 1) {
    const cur = ordered[i];
    const nextStart = i + 1 < ordered.length ? ordered[i + 1].start : body.length;
    let slice = body.slice(cur.contentStart, nextStart).trim();
    if (i < ordered.length - 1) {
      slice = slice.replace(/[|:\s]+$/, '').trim();
      rawTexts.push(slice);
    } else {
      // Last statement (d): may be followed by newline answer/explanation OR `:Đ-Đ-S-Đ:Giải thích` OR `| Đ-Đ-S-Đ | Giải thích`
      const lines = slice.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const firstPart = lines[0] || '';
      const restLines = lines.slice(1);

      // Check inline separator inside firstPart for TF answer key
      const inlineKeyMatch = firstPart.match(
        /^(.*?)[:|]\s*((?:(?:đáp\s*án(?:\s*đúng)?|answer|ans|key)\s*[:=\-]?\s*)?(?:[đdtfsĐDTFS](?:[\s,\-;/]+[đdtfsĐDTFS]){3}|[đdtfsĐDTFS]{4}|(?:[a-d]\s*[:.)\-=]\s*(?:đúng|dung|true|sai|false|[đdtfs10])\s*[,;/\s]*){4}))(?:[:|]\s*(.+))?$/i
      );

      if (inlineKeyMatch) {
        rawTexts.push(inlineKeyMatch[1].replace(/[|:\s]+$/, '').trim());
        tailRaw = [inlineKeyMatch[2], inlineKeyMatch[3] ? `Giải thích: ${inlineKeyMatch[3]}` : '', ...restLines]
          .filter(Boolean)
          .join('\n');
      } else {
        // Also check inline Giải thích without explicit key (when * markers are used)
        const inlineExpMatch = firstPart.match(/^(.*?)[:|]\s*(?:giải\s*thích|explanation)\s*[:=\-]?\s*(.+)$/i);
        if (inlineExpMatch) {
          rawTexts.push(inlineExpMatch[1].replace(/[|:\s]+$/, '').trim());
          tailRaw = [`Giải thích: ${inlineExpMatch[2]}`, ...restLines].join('\n');
        } else {
          rawTexts.push(firstPart.replace(/[|:\s]+$/, '').trim());
          tailRaw = restLines.join('\n');
        }
      }
    }
  }

  let answerFlags: boolean[] | null = null;
  let explanation = '';

  if (tailRaw) {
    const tailLines = tailRaw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of tailLines) {
      const expMatch = line.match(/^(?:giải\s*thích|hướng\s*dẫn|hd|explanation)\s*[:=\-]\s*(.+)$/i);
      if (expMatch) {
        explanation = expMatch[1].trim();
        continue;
      }
      const parsedKey = parseTrueFalseAnswerKey(line);
      if (parsedKey && !answerFlags) {
        answerFlags = parsedKey;
        continue;
      }
      if (answerFlags && !explanation) {
        explanation = line.replace(/^[:.\-\s]+/, '').trim();
      }
    }
  }

  const starredFlags = ordered.map((h) => h.starred);
  const hasAnyStar = starredFlags.some(Boolean);
  const finalFlags = answerFlags || (hasAnyStar ? starredFlags : [true, false, true, false]);
  const hasExplicitAnswer = Boolean(answerFlags || hasAnyStar);

  const warnings: string[] = [];
  if (!hasExplicitAnswer) {
    warnings.push(`Câu ${sourceIndex} (Đúng/Sai): chưa có đáp án 4 ý, vui lòng kiểm tra.`);
  }

  return {
    sourceIndex,
    questionType: 'true_false',
    questionText: stem,
    trueFalseStatements: TF_LABELS.map((label, idx) => ({
      label,
      text: rawTexts[idx] || `Mệnh đề ${label}`,
      isTrue: Boolean(finalFlags[idx]),
    })),
    explanation: explanation || undefined,
    hasExplicitAnswer,
    warnings,
  };
}

/**
 * Parses Short-Answer blocks prefixed with `[TLN]` / `[SA]` / `[TRẢ LỜI NGẮN]`:
 *   `[TLN] Tính 15 x 4 bằng bao nhiêu?:60 | 60,0`
 *   `[TLN] Diện tích hình chữ nhật?:34 | 34,0 | 34 cm2`
 */
function tryParseTaggedShortAnswerBlock(
  blockText: string,
  fallbackIndex: number
): ParsedRawQuestion | null {
  const trimmed = blockText.trim();
  const hasTag = /^(?:(?:Q|Câu|Question|Bài)\s*\d+\s*[:.)\-]?\s*)?\[(?:TLN|SA|TRẢ\s*LỜI\s*NGẮN)\]/i.test(
    trimmed
  );
  if (!hasTag) return null;

  const numStrip = stripLeadingQuestionNumber(trimmed, fallbackIndex);
  let body = numStrip.rest.replace(/^\[(?:TLN|SA|TRẢ\s*LỜI\s*NGẮN)\]\s*/i, '').trim();
  let sourceIndex = numStrip.sourceIndex;
  if (!numStrip.hadPrefix) {
    const afterTagNum = stripLeadingQuestionNumber(body, fallbackIndex);
    if (afterTagNum.hadPrefix) {
      sourceIndex = afterTagNum.sourceIndex;
      body = afterTagNum.rest;
    }
  }

  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let explanation = '';
  let explicitAns = '';
  const stemLines: string[] = [];

  for (const line of lines) {
    const expMatch = line.match(/^(?:giải\s*thích|hướng\s*dẫn|hd|explanation)\s*[:=\-]\s*(.+)$/i);
    if (expMatch) {
      explanation = expMatch[1].trim();
      continue;
    }
    const ansLineMatch = line.match(/^(?:đáp\s*án(?:\s*đúng)?|đ\.?a|answer|ans|key)\s*[:=\-]\s*(.+)$/i);
    if (ansLineMatch) {
      explicitAns = ansLineMatch[1].trim();
      continue;
    }
    stemLines.push(line);
  }

  let stemText = stemLines.join(' ').trim();
  if (!explicitAns) {
    // Check explicit "Đáp án:" inline
    const inlineAnsMatch = stemText.match(
      /^(.*?)(?:[:|]\s*(?:đáp\s*án(?:\s*đúng)?|đ\.?a|answer|ans|key)\s*[:=\-]?\s*)(.+)$/i
    );
    if (inlineAnsMatch) {
      stemText = inlineAnsMatch[1].trim();
      explicitAns = inlineAnsMatch[2].trim();
    } else {
      // Split by unescaped ":" — last part (or second-to-last if explanation follows) is answer
      const colonParts = splitUnescaped(stemText, ':').map((p) => p.trim());
      if (colonParts.length >= 2) {
        // Check if last part starts with "Giải thích"
        if (
          colonParts.length >= 3 &&
          /^(?:giải\s*thích|explanation)\b/i.test(colonParts[colonParts.length - 1])
        ) {
          explanation =
            colonParts[colonParts.length - 1]
              .replace(/^(?:giải\s*thích|explanation)\s*[:=\-]?\s*/i, '')
              .trim() || explanation;
          explicitAns = colonParts[colonParts.length - 2];
          stemText = colonParts.slice(0, colonParts.length - 2).join(': ').trim();
        } else {
          explicitAns = colonParts[colonParts.length - 1];
          stemText = colonParts.slice(0, colonParts.length - 1).join(': ').trim();
        }
      }
    }
  }

  // If explanation was attached after "::" or "Giải thích:" inside explicitAns
  const trailingExp = explicitAns.match(/^(.*?)\s*[:|]\s*(?:giải\s*thích|explanation)\s*[:=\-]?\s*(.+)$/i);
  if (trailingExp) {
    explicitAns = trailingExp[1].trim();
    explanation = explanation || trailingExp[2].trim();
  }

  if (!stemText) return null;

  const accepted = explicitAns
    .split(/[|;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const warnings: string[] = [];
  if (accepted.length === 0) {
    warnings.push(`Câu ${sourceIndex} (Trả lời ngắn): chưa có đáp án.`);
  }

  return {
    sourceIndex,
    questionType: 'short_answer',
    questionText: stemText,
    shortAnswerAccepted: accepted.length > 0 ? accepted : [''],
    explanation: explanation || undefined,
    hasExplicitAnswer: accepted.length > 0,
    warnings,
  };
}

/**
 * Parses a single compact line with explicit A./B./C./D. markers such as:
 *   "Q1:Ai là người giỏi:A..:B...:C...:D...:Đáp án: A"
 *   "Q1: Ai là người giỏi | A. Nam | B. Hoa | C. Lan | D. Bình | B"
 */
function tryParseDelimitedSingleBlock(
  blockText: string,
  fallbackIndex: number
): ParsedRawQuestion | null {
  const singleLine = blockText.replace(/\r?\n+/g, ' ').trim();

  const hasColonOrPipeA = /(?:^|[:|])\s*\*?A(?:[.):\-]|\s+)/i.test(singleLine);
  const hasColonOrPipeB = /[:|]\s*\*?B(?:[.):\-]|\s+)/i.test(singleLine);
  if (!hasColonOrPipeA || !hasColonOrPipeB) {
    return null;
  }

  interface MarkerHit {
    sepIndex: number;
    tokenStart: number;
    type: 'A' | 'B' | 'C' | 'D' | 'ANS' | 'EXP';
    starred: boolean;
    contentStart: number;
  }

  const hits: MarkerHit[] = [];
  const markerScan =
    /([:|])\s*(?:(\*?)([A-D])(?=[.):\-\s])|(đáp\s*án(?:\s*đúng)?|đ\.?a|answer|ans|key)\s*[:=]?|(giải\s*thích|explanation)\s*[:=]?)/gi;

  let m: RegExpExecArray | null;
  while ((m = markerScan.exec(singleLine)) !== null) {
    const sepIndex = m.index;
    const tokenStart = sepIndex + m[1].length;
    if (m[3]) {
      const letter = m[3].toUpperCase() as 'A' | 'B' | 'C' | 'D';
      const starred = m[2] === '*';
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
 * Parses positional delimited ABCD lines WITHOUT A./B./C./D. prefixes:
 *   "Câu 1:Liên kết hydrogen...?:F, O, N:C, Si, P:Na, K, Ca:He, Ne, Ar:A:Giải thích..."
 *   "Câu 2:Thủ đô Việt Nam?:TP.HCM:*Hà Nội:Đà Nẵng:Hải Phòng:Đáp án là Hà Nội."
 *   "Giá trị của 2x + 5 tại x = 3?:9:10:11:12:C"
 *   "Cho hàm số y = 2x + 1: Tìm y tại x=1?:1:2:3:4:C"
 */
function tryParsePositionalDelimitedAbcd(
  blockText: string,
  fallbackIndex: number
): ParsedRawQuestion | null {
  const singleLine = blockText.replace(/\r?\n+/g, ' ').trim();
  const pipeParts = splitUnescaped(singleLine, '|').map((p) => p.trim());
  const colonParts = splitUnescaped(singleLine, ':').map((p) => p.trim());

  const delimiter: '|' | ':' | null =
    pipeParts.length >= 5 ? '|' : colonParts.length >= 5 ? ':' : null;
  if (!delimiter) return null;

  let parts = delimiter === '|' ? pipeParts : colonParts;
  let sourceIndex = fallbackIndex;

  // Strip optional leading pure number token like "Câu 1" or "Q1"
  if (parts.length >= 6) {
    const leadingNum = isPureQuestionNumberToken(parts[0]);
    if (leadingNum !== null) {
      sourceIndex = leadingNum;
      parts = parts.slice(1);
    }
  }

  if (parts.length < 5) return null;

  const isAnswerLetterToken = (token: string): 'A' | 'B' | 'C' | 'D' | null => {
    const m = token
      .trim()
      .match(/^(?:(?:đáp\s*án(?:\s*đúng)?|đ\.?a|answer|ans|key)\s*[:=\-]?\s*)?([A-D])$/i);
    return m ? (m[1].toUpperCase() as 'A' | 'B' | 'C' | 'D') : null;
  };
  const isAnswerLabelOnly = (token: string): boolean =>
    /^(?:đáp\s*án(?:\s*đúng)?|đ\.?a|answer|ans|key)$/i.test(token.trim());

  let optionSliceStart = -1;
  let correctAnswer: 'A' | 'B' | 'C' | 'D' | undefined;
  let explanation = '';

  const n = parts.length;
  // Pattern 1: [...stem, A, B, C, D, "Đáp án", "B", "Giải thích"]
  if (
    n >= 8 &&
    isAnswerLabelOnly(parts[n - 3]) &&
    isAnswerLetterToken(parts[n - 2]) !== null
  ) {
    correctAnswer = isAnswerLetterToken(parts[n - 2])!;
    explanation = parts[n - 1].replace(/^(?:giải\s*thích|explanation)\s*[:=\-]?\s*/i, '').trim();
    optionSliceStart = n - 7;
  }
  // Pattern 2: [...stem, A, B, C, D, "Đáp án", "B"]
  else if (
    n >= 7 &&
    isAnswerLabelOnly(parts[n - 2]) &&
    isAnswerLetterToken(parts[n - 1]) !== null
  ) {
    correctAnswer = isAnswerLetterToken(parts[n - 1])!;
    optionSliceStart = n - 6;
  }
  // Pattern 3: [...stem, A, B, C, D, "A", "Giải thích..."]
  else if (
    n >= 7 &&
    isAnswerLetterToken(parts[n - 2]) !== null &&
    isAnswerLetterToken(parts[n - 1]) === null &&
    parts[n - 1].length > 0
  ) {
    correctAnswer = isAnswerLetterToken(parts[n - 2])!;
    explanation = parts[n - 1].replace(/^(?:giải\s*thích|explanation)\s*[:=\-]?\s*/i, '').trim();
    optionSliceStart = n - 6;
  }
  // Pattern 4: [...stem, A, B, C, D, "B"]
  else if (n >= 6 && isAnswerLetterToken(parts[n - 1]) !== null) {
    correctAnswer = isAnswerLetterToken(parts[n - 1])!;
    optionSliceStart = n - 5;
  }
  // Pattern 5: [...stem, A, *B, C, D, "Giải thích..."] (starred option + trailing explanation)
  else if (n >= 6 && parts.slice(n - 5, n - 1).some((p) => p.startsWith('*'))) {
    explanation = parts[n - 1].replace(/^(?:giải\s*thích|explanation)\s*[:=\-]?\s*/i, '').trim();
    optionSliceStart = n - 5;
  }
  // Pattern 6: [...stem, A, B, C, D] (starred option or trailing key map)
  else if (n >= 5) {
    optionSliceStart = n - 4;
  }

  if (optionSliceStart < 1) return null;

  const rawStem = parts.slice(0, optionSliceStart).join(delimiter === ':' ? ': ' : ' ').trim();
  const numFromStem = stripLeadingQuestionNumber(rawStem, sourceIndex);
  sourceIndex = numFromStem.sourceIndex;
  const questionText = numFromStem.rest.trim();
  if (!questionText) return null;

  const optRaw = parts.slice(optionSliceStart, optionSliceStart + 4);
  if (optRaw.some((o) => !o)) return null;

  const letters: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
  const cleanedOpts: Record<'A' | 'B' | 'C' | 'D', string> = { A: '', B: '', C: '', D: '' };

  optRaw.forEach((rawOpt, idx) => {
    const letter = letters[idx];
    if (rawOpt.startsWith('*')) {
      correctAnswer = letter;
    }
    cleanedOpts[letter] = rawOpt.replace(/^\*\s*/, '').replace(/^[A-D][.):\-]\s*/i, '').trim();
  });

  return {
    sourceIndex,
    questionType: 'abcd',
    questionText,
    optionA: cleanedOpts.A || '—',
    optionB: cleanedOpts.B || '—',
    optionC: cleanedOpts.C || '—',
    optionD: cleanedOpts.D || '—',
    correctAnswer,
    explanation: explanation || undefined,
    hasExplicitAnswer: Boolean(correctAnswer),
    warnings: [],
  };
}

/**
 * Parses a multi-line or inline-option block (e.g. Q1: ... \n A. ... \n B. ... \n C. ... \n D. ... \n Đáp án: A)
 */
function parseGeneralQuestionBlock(
  blockText: string,
  fallbackIndex: number
): ParsedRawQuestion | null {
  // 1. Tagged short-answer `[TLN]` / `[SA]`
  const taggedShort = tryParseTaggedShortAnswerBlock(blockText, fallbackIndex);
  if (taggedShort) return taggedShort;

  // 2. True/False 4-statement block `[ĐS]` / `[TF]` or a)/b)/c)/d)
  const tfBlock = tryParseTrueFalseBlock(blockText, fallbackIndex);
  if (tfBlock) return tfBlock;

  // 3. Compact colon/pipe single-line style with explicit A./B./C./D. markers
  const compact = tryParseDelimitedSingleBlock(blockText, fallbackIndex);
  if (compact) return compact;

  // 4. Positional delimited ABCD without A./B./C./D. prefixes (`Câu hỏi:A:B:C:D:Đáp án`)
  const positional = tryParsePositionalDelimitedAbcd(blockText, fallbackIndex);
  if (positional) return positional;

  const lines = blockText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const firstLine = lines[0];
  const qHeaderMatch = firstLine.match(/^(?:Q|Câu|Question|Bài)?\s*(\d+)\s*[:.)\-]?\s*(.*)$/i);
  const sourceIndex = qHeaderMatch && qHeaderMatch[1] ? Number(qHeaderMatch[1]) : fallbackIndex;
  const firstRest = (qHeaderMatch ? qHeaderMatch[2] : firstLine).trim();

  const normalizedLines = [firstRest, ...lines.slice(1)].filter(Boolean);
  const fullText = normalizedLines.join('\n');

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
 * Parses raw question & answer text (supporting positional `Câu hỏi:A:B:C:D:Đáp án`,
 * explicit `Q1:...:A..:B...:C...:D...`, `[ĐS]`/`[TF]` True/False 4-statement blocks,
 * `[TLN]`/`[SA]` short-answer blocks, CSV/TSV tables, multi-line blocks, `*` answer markers,
 * and trailing answer key sections).
 */
export function parseRawExamQuestions(rawText: string): RawParseResult {
  const cleanedInput = (rawText || '').replace(/^\uFEFF/, '').trim();
  if (!cleanedInput) {
    return {
      questions: [],
      warnings: ['Nội dung văn bản thô đang trống.'],
      answeredCount: 0,
      abcdCount: 0,
      trueFalseCount: 0,
      shortAnswerCount: 0,
    };
  }

  // Try structured CSV / TSV table first
  const tableResult = tryParseDelimitedTable(cleanedInput);
  if (tableResult) return tableResult;

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
  const qStartLineRegex =
    /^(?:Q\d+|Câu\s+\d+|Question\s+\d+|Bài\s+\d+|\d+[.)]|\[(?:ĐS|DS|TF|TLN|SA|ĐÚNG\s*\/?\s*SAI|TRẢ\s*LỜI\s*NGẮN)\])\s*(?:[:.)\-]|\s|$)/i;

  const isStandaloneSingleLineQuestion = (line: string): boolean => {
    if (/^\[(?:TLN|SA|TRẢ\s*LỜI\s*NGẮN)\]/i.test(line)) {
      return splitUnescaped(line, ':').length >= 2 || /đáp\s*án/i.test(line);
    }
    if (/^\[(?:ĐS|DS|TF|ĐÚNG\s*\/?\s*SAI)\]/i.test(line)) {
      return splitUnescaped(line, '|').length >= 5 || splitUnescaped(line, ':').length >= 5;
    }
    return splitUnescaped(line, ':').length >= 5 || splitUnescaped(line, '|').length >= 5;
  };

  for (const rawLine of questionLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
        currentBlock = [];
      }
      continue;
    }

    if (currentBlock.length > 0) {
      const prevSingleStandalone =
        currentBlock.length === 1 && isStandaloneSingleLineQuestion(currentBlock[0]);
      if (qStartLineRegex.test(trimmed) || prevSingleStandalone || isStandaloneSingleLineQuestion(trimmed)) {
        blocks.push(currentBlock.join('\n'));
        currentBlock = [trimmed];
        continue;
      }
    }
    currentBlock.push(trimmed);
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
  const trueFalseCount = parsedQuestions.filter((q) => q.questionType === 'true_false').length;
  const shortAnswerCount = parsedQuestions.filter((q) => q.questionType === 'short_answer').length;

  return {
    questions: parsedQuestions,
    warnings: Array.from(new Set(warnings)),
    answeredCount,
    abcdCount,
    trueFalseCount,
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

  if (parsed.questionType === 'true_false') {
    const rawStatements = (parsed.trueFalseStatements || []).slice(0, 4);
    const statements: TrueFalseStatement[] = TF_LABELS.map((label, idx) => ({
      label,
      text: (rawStatements[idx]?.text || `Mệnh đề ${label}`).slice(0, 500),
      isTrue: Boolean(rawStatements[idx]?.isTrue),
    }));
    const answerSummary = statements.map((s) => `${s.label}) ${s.isTrue ? 'Đúng' : 'Sai'}`).join(' · ');

    return {
      questionId: qId,
      orderIndex,
      chapterId: 'Tổng hợp từ ngân hàng chữ thô',
      conceptId: 'Theo nội dung đề nhập',
      learningOutcome: 'Đánh giá Đúng / Sai 4 mệnh đề',
      cognitiveLevel: 'thong_hieu',
      questionType: 'true_false',
      scoreWeight: 1.0,
      questionText: parsed.questionText.slice(0, 2000),
      trueFalseStatements: statements,
      explanation: (
        parsed.explanation ||
        (parsed.hasExplicitAnswer
          ? `Đáp án chuẩn: ${answerSummary}.`
          : `Chưa có đáp án gốc cho 4 mệnh đề (${answerSummary}) — Admin vui lòng kiểm tra lại.`)
      ).slice(0, 2000),
      sourceReference: 'Admin nhập từ tệp chữ thô',
      sourceType: 'teacher_material',
      validationStatus: parsed.hasExplicitAnswer ? 'passed' : 'needs_review',
      validationIssues: parsed.warnings.length > 0 ? parsed.warnings : undefined,
    };
  }

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
  const origCorrect: 'A' | 'B' | 'C' | 'D' = parsed.correctAnswer || 'A';
  let correctAnswer: 'A' | 'B' | 'C' | 'D' = origCorrect;

  if (shuffleOptions) {
    const pairs: Array<{ key: 'A' | 'B' | 'C' | 'D'; text: string }> = [
      { key: 'A', text: optionA },
      { key: 'B', text: optionB },
      { key: 'C', text: optionC },
      { key: 'D', text: optionD },
    ];
    const shuffled = shuffleWithSeed(pairs, `${examSeed}:${qId}`);
    const letters: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
    const newCorrectIdx = shuffled.findIndex((p) => p.key === origCorrect);
    optionA = shuffled[0].text;
    optionB = shuffled[1].text;
    optionC = shuffled[2].text;
    optionD = shuffled[3].text;
    correctAnswer = letters[newCorrectIdx >= 0 ? newCorrectIdx : 0];
  }

  const rawExplanation =
    parsed.explanation ||
    (parsed.hasExplicitAnswer
      ? `Đáp án đúng theo tài liệu gốc là ${correctAnswer}.`
      : `Tạm đặt đáp án ${correctAnswer} do tệp thô chưa ghi đáp án — Admin vui lòng kiểm tra lại.`);
  const syncedExplanation =
    shuffleOptions && parsed.explanation
      ? syncShuffledAbcdExplanation(rawExplanation, origCorrect, correctAnswer)
      : rawExplanation;

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
    explanation: syncedExplanation.slice(0, 2000),
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
