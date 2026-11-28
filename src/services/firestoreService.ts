import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { stripUndefinedDeep } from '../core/firestoreSanitizer';
import {
  calculateNextReviewSchedule,
  computeLeaderboardUpdate,
  gradeExamSubmission,
} from '../core/examScoring';
import { evaluateMasteryStatus } from '../core/scoring';
import { sanitizeReferenceChunkForFirestore } from '../core/retrieval';
import { repairUtf8Mojibake } from '../core/textEncoding';
import type {
  AnalysisRecord,
  GradeLevel,
  KnowledgeProgress,
  PracticeItem,
  QuizAttempt,
  QuizQuestion,
  QuizSet,
  ReferenceBook,
  ReferenceChunk,
  SubjectId,
  SystemAiConfig,
  UserProfile,
} from '../core/types';

function makeSafeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || `id_${Date.now()}`;
}

export function makeConceptId(subjectId: SubjectId, chapter: string, concept: string): string {
  const base = `${subjectId}_${chapter}_${concept}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return makeSafeId(base || `concept_${Date.now()}`);
}

export async function upsertUserProfile(params: {
  uid: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
}): Promise<UserProfile> {
  const path = `users/${params.uid}`;
  const ref = doc(db, 'users', params.uid);
  const now = new Date().toISOString();

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const existing = snap.data() as UserProfile;
      const updates: Partial<UserProfile> = {
        lastLoginAt: now,
      };
      if (!existing.displayName && params.displayName) {
        updates.displayName = params.displayName.slice(0, 100);
      }
      if (params.avatarUrl && params.avatarUrl !== existing.avatarUrl) {
        updates.avatarUrl = params.avatarUrl.slice(0, 1024);
      }
      await updateDoc(ref, stripUndefinedDeep(updates));
      return { ...existing, ...updates };
    }

    const profile: UserProfile = {
      uid: params.uid,
      displayName: (params.displayName || params.email.split('@')[0] || 'Học sinh').slice(0, 100),
      email: params.email.slice(0, 254),
      ...(params.avatarUrl ? { avatarUrl: params.avatarUrl.slice(0, 1024) } : {}),
      grade: '10',
      preferredSubjects: ['toan', 'hoa_hoc'],
      accountStatus: 'active',
      createdAt: now,
      lastLoginAt: now,
    };
    await setDoc(ref, stripUndefinedDeep(profile));
    return profile;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateUserPreferences(
  uid: string,
  updates: { displayName?: string; grade?: GradeLevel; preferredSubjects?: SubjectId[] }
): Promise<void> {
  const path = `users/${uid}`;
  try {
    const clean: Record<string, unknown> = {
      lastLoginAt: new Date().toISOString(),
    };
    if (updates.displayName) clean.displayName = updates.displayName.trim().slice(0, 100);
    if (updates.grade) clean.grade = updates.grade;
    if (updates.preferredSubjects) clean.preferredSubjects = updates.preferredSubjects.slice(0, 12);
    await updateDoc(doc(db, 'users', uid), stripUndefinedDeep(clean));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

function normalizeLoadedAnalysisRecord(record: AnalysisRecord): AnalysisRecord {
  return {
    ...record,
    documentTitle: repairUtf8Mojibake(record.documentTitle || 'Tài liệu kiểm định'),
    originalFileName: repairUtf8Mojibake(record.originalFileName || 'tai_lieu.txt'),
  };
}

export async function saveAnalysisRecord(record: AnalysisRecord): Promise<void> {
  const safeId = makeSafeId(record.analysisId);
  const path = `analyses/${safeId}`;
  try {
    const safeTitle =
      repairUtf8Mojibake(record.documentTitle || 'Tài liệu kiểm định').trim().slice(0, 200) ||
      'Tài liệu kiểm định';
    const safeFileName =
      repairUtf8Mojibake(record.originalFileName || 'tai_lieu.txt').trim().slice(0, 255) ||
      'tai_lieu.txt';

    const sanitizedPages = (record.extractedPages || []).slice(0, 50).map((p) => {
      const { imageUrl, ...rest } = p;
      const validHttpsUrl =
        typeof imageUrl === 'string' && imageUrl.startsWith('https://')
          ? imageUrl.slice(0, 1024)
          : null;
      return validHttpsUrl ? { ...rest, imageUrl: validHttpsUrl } : rest;
    });

    const sanitized = stripUndefinedDeep<AnalysisRecord>({
      ...record,
      analysisId: safeId,
      documentTitle: safeTitle,
      originalFileName: safeFileName,
      mimeType: (record.mimeType || 'text/plain').slice(0, 100),
      storagePath: (record.storagePath || '').slice(0, 500),
      storageDownloadUrl: (record.storageDownloadUrl || '').slice(0, 2048),
      textbookReferenceId: (record.textbookReferenceId || '').slice(0, 128),
      textbookTitle: (record.textbookTitle || '').slice(0, 200),
      textbookVersion: (record.textbookVersion || '').slice(0, 64),
      selectedChapters: (record.selectedChapters || []).slice(0, 30),
      scope: (record.scope || '').slice(0, 300),
      extractedPages: sanitizedPages,
      claims: (record.claims || []).slice(0, 150),
      coverageItems: (record.coverageItems || []).slice(0, 100),
      annotations: (record.annotations || []).slice(0, 200),
      strengths: (record.strengths || []).slice(0, 30),
      weaknesses: (record.weaknesses || []).slice(0, 50),
      suggestions: (record.suggestions || []).slice(0, 30),
      webSources: (record.webSources || []).slice(0, 30),
      ...(record.modelUsed ? { modelUsed: String(record.modelUsed).slice(0, 100) } : {}),
      ...(record.jobId ? { jobId: String(record.jobId).slice(0, 128) } : {}),
    });
    await setDoc(doc(db, 'analyses', safeId), sanitized);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function getAnalysisById(analysisId: string): Promise<AnalysisRecord | null> {
  const path = `analyses/${analysisId}`;
  try {
    const snap = await getDoc(doc(db, 'analyses', analysisId));
    return snap.exists() ? normalizeLoadedAnalysisRecord(snap.data() as AnalysisRecord) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function listUserAnalyses(
  uid: string,
  pageSize = 15,
  cursorDoc?: QueryDocumentSnapshot
): Promise<{ items: AnalysisRecord[]; lastDoc: QueryDocumentSnapshot | null; hasMore: boolean }> {
  const path = 'analyses';
  try {
    const q = cursorDoc
      ? query(
          collection(db, 'analyses'),
          where('ownerUid', '==', uid),
          orderBy('createdAt', 'desc'),
          startAfter(cursorDoc),
          limit(pageSize + 1)
        )
      : query(
          collection(db, 'analyses'),
          where('ownerUid', '==', uid),
          orderBy('createdAt', 'desc'),
          limit(pageSize + 1)
        );
    const snap = await getDocs(q);
    const docs = snap.docs;
    const hasMore = docs.length > pageSize;
    const sliced = hasMore ? docs.slice(0, pageSize) : docs;
    return {
      items: sliced.map((d) => normalizeLoadedAnalysisRecord(d.data() as AnalysisRecord)),
      lastDoc: sliced.length > 0 ? sliced[sliced.length - 1] : null,
      hasMore,
    };
  } catch (error) {
    // Fallback client-side sort if composite index (ownerUid + createdAt) is still building
    try {
      const fallbackSnap = await getDocs(
        query(collection(db, 'analyses'), where('ownerUid', '==', uid), limit(100))
      );
      const sorted = fallbackSnap.docs
        .map((d) => normalizeLoadedAnalysisRecord(d.data() as AnalysisRecord))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return {
        items: sorted.slice(0, pageSize),
        lastDoc: null,
        hasMore: false,
      };
    } catch (inner) {
      handleFirestoreError(inner || error, OperationType.LIST, path);
    }
  }
}

export async function deleteAnalysisRecord(analysisId: string): Promise<void> {
  const path = `analyses/${analysisId}`;
  try {
    await deleteDoc(doc(db, 'analyses', analysisId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// === Reference Library ===
export async function listReferenceBooks(onlyActive = false): Promise<ReferenceBook[]> {
  const path = 'referenceBooks';
  try {
    const q = onlyActive
      ? query(collection(db, 'referenceBooks'), where('status', '==', 'active'))
      : query(collection(db, 'referenceBooks'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as ReferenceBook);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveReferenceBookRecord(book: ReferenceBook): Promise<void> {
  const safeRefId = makeSafeId(book.referenceId);
  const path = `referenceBooks/${safeRefId}`;
  try {
    await setDoc(
      doc(db, 'referenceBooks', safeRefId),
      stripUndefinedDeep({
        ...book,
        referenceId: safeRefId,
        title: (book.title || 'Sách giáo khoa chuẩn').trim().slice(0, 195),
        textbookSeries: (book.textbookSeries || 'Chuẩn chương trình GDPT 2018').trim().slice(0, 95),
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveReferenceChunksBatch(chunks: ReferenceChunk[]): Promise<void> {
  if (chunks.length === 0) return;
  const path = 'referenceChunks';
  try {
    const BATCH_LIMIT = 400;
    for (let i = 0; i < chunks.length; i += BATCH_LIMIT) {
      const slice = chunks.slice(i, i + BATCH_LIMIT);
      const batch = writeBatch(db);
      slice.forEach((rawChunk, idx) => {
        const clean = sanitizeReferenceChunkForFirestore({
          ...rawChunk,
          fallbackIndex: i + idx + 1,
        });
        batch.set(doc(db, 'referenceChunks', clean.chunkId), stripUndefinedDeep(clean));
      });
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveReferenceBookWithChunks(
  book: ReferenceBook,
  chunks: ReferenceChunk[]
): Promise<void> {
  await saveReferenceBookRecord(book);
  await saveReferenceChunksBatch(chunks);
}

export async function listReferenceChunksForBook(referenceId: string): Promise<ReferenceChunk[]> {
  const path = 'referenceChunks';
  try {
    const q = query(collection(db, 'referenceChunks'), where('referenceId', '==', referenceId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as ReferenceChunk);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function updateReferenceBookStatus(
  referenceId: string,
  updates: Partial<
    Pick<
      ReferenceBook,
      | 'status'
      | 'title'
      | 'description'
      | 'textbookSeries'
      | 'editionYear'
      | 'publisher'
      | 'chapters'
      | 'chunkCount'
      | 'indexStatus'
      | 'indexError'
    >
  >
): Promise<void> {
  const safeRefId = makeSafeId(referenceId);
  const path = `referenceBooks/${safeRefId}`;
  try {
    await updateDoc(
      doc(db, 'referenceBooks', safeRefId),
      stripUndefinedDeep({
        ...updates,
        updatedAt: new Date().toISOString(),
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export const saveReferenceBookProgress = updateReferenceBookStatus;

export async function deleteReferenceBookAndChunks(referenceId: string): Promise<void> {
  const path = `referenceBooks/${referenceId}`;
  try {
    const chunks = await listReferenceChunksForBook(referenceId);
    for (const c of chunks) {
      await deleteDoc(doc(db, 'referenceChunks', c.chunkId));
    }
    await deleteDoc(doc(db, 'referenceBooks', referenceId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// === Quiz Sets & Practice Bank ===
export async function saveQuizSet(quizSet: QuizSet): Promise<void> {
  const safeId = makeSafeId(quizSet.quizSetId);
  const path = `quizSets/${safeId}`;
  try {
    await setDoc(doc(db, 'quizSets', safeId), stripUndefinedDeep({ ...quizSet, quizSetId: safeId }));
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function listUserQuizSets(uid: string): Promise<QuizSet[]> {
  const path = 'quizSets';
  try {
    const q = query(
      collection(db, 'quizSets'),
      where('ownerUid', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(30)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as QuizSet);
  } catch (error) {
    try {
      const snap = await getDocs(
        query(collection(db, 'quizSets'), where('ownerUid', '==', uid), limit(60))
      );
      return snap.docs
        .map((d) => d.data() as QuizSet)
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
        .slice(0, 30);
    } catch (inner) {
      handleFirestoreError(inner || error, OperationType.LIST, path);
    }
  }
}

export async function listPracticeItems(uid: string): Promise<PracticeItem[]> {
  const path = 'practiceItems';
  try {
    const q = query(
      collection(db, 'practiceItems'),
      where('ownerUid', '==', uid),
      orderBy('lastAttemptAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as PracticeItem);
  } catch (error) {
    try {
      const snap = await getDocs(
        query(collection(db, 'practiceItems'), where('ownerUid', '==', uid), limit(200))
      );
      return snap.docs
        .map((d) => d.data() as PracticeItem)
        .sort((a, b) => (b.lastAttemptAt || '').localeCompare(a.lastAttemptAt || ''));
    } catch (inner) {
      handleFirestoreError(inner || error, OperationType.LIST, path);
    }
  }
}

/**
 * Automatically saves or updates an incorrectly answered question in the Practice Bank.
 * Deduplicates by ownerUid + questionId.
 */
export async function saveWrongAnswerToPracticeBank(
  uid: string,
  question: QuizQuestion
): Promise<void> {
  const itemId = makeSafeId(`prac_${uid}_${question.questionId}`);
  const path = `practiceItems/${itemId}`;
  const now = new Date().toISOString();

  try {
    const existingSnap = await getDoc(doc(db, 'practiceItems', itemId));
    if (existingSnap.exists()) {
      const prev = existingSnap.data() as PracticeItem;
      await updateDoc(doc(db, 'practiceItems', itemId), {
        attemptCount: prev.attemptCount + 1,
        incorrectCount: prev.incorrectCount + 1,
        lastAttemptAt: now,
        lastResult: 'incorrect',
        masteryStatus: 'Cần ôn tập',
      });
      return;
    }

    const item: PracticeItem = {
      itemId,
      questionId: question.questionId,
      ownerUid: uid,
      questionText: question.questionText.slice(0, 2000),
      optionA: question.optionA.slice(0, 500),
      optionB: question.optionB.slice(0, 500),
      optionC: question.optionC.slice(0, 500),
      optionD: question.optionD.slice(0, 500),
      correctAnswer: question.correctAnswer,
      explanation: question.explanation.slice(0, 2000),
      sourceReference: (question.sourceReference || '').slice(0, 300),
      subject: question.subject,
      grade: question.grade,
      chapter: question.chapter.slice(0, 200),
      concept: question.concept.slice(0, 200),
      difficulty: question.difficulty,
      attemptCount: 1,
      correctCount: 0,
      incorrectCount: 1,
      lastAttemptAt: now,
      lastResult: 'incorrect',
      masteryStatus: 'Cần ôn tập',
      createdAt: now,
    };
    await setDoc(doc(db, 'practiceItems', itemId), stripUndefinedDeep(item));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Updates stats when practicing inside Practice Bank.
 * NEVER auto-deletes the item when answered correctly!
 */
export async function recordPracticeRetry(
  item: PracticeItem,
  isCorrect: boolean,
  updatedMasteryStatus?: PracticeItem['masteryStatus']
): Promise<PracticeItem> {
  const path = `practiceItems/${item.itemId}`;
  const now = new Date().toISOString();
  const nextAttemptCount = item.attemptCount + 1;
  const nextCorrectCount = item.correctCount + (isCorrect ? 1 : 0);
  const nextIncorrectCount = item.incorrectCount + (isCorrect ? 0 : 1);
  const nextStatus =
    updatedMasteryStatus ||
    (isCorrect && nextCorrectCount >= 3 ? 'Tạm nắm vững' : isCorrect ? 'Đang củng cố' : 'Cần ôn tập');

  try {
    await updateDoc(doc(db, 'practiceItems', item.itemId), {
      attemptCount: nextAttemptCount,
      correctCount: nextCorrectCount,
      incorrectCount: nextIncorrectCount,
      lastAttemptAt: now,
      lastResult: isCorrect ? 'correct' : 'incorrect',
      masteryStatus: nextStatus,
    });
    return {
      ...item,
      attemptCount: nextAttemptCount,
      correctCount: nextCorrectCount,
      incorrectCount: nextIncorrectCount,
      lastAttemptAt: now,
      lastResult: isCorrect ? 'correct' : 'incorrect',
      masteryStatus: nextStatus,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function manuallyDeletePracticeItem(itemId: string): Promise<void> {
  const path = `practiceItems/${itemId}`;
  try {
    await deleteDoc(doc(db, 'practiceItems', itemId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// === Learning Analytics (Thống kê kiến thức đã học) ===
export async function syncEncounteredConceptsFromAnalysis(
  uid: string,
  analysis: AnalysisRecord
): Promise<void> {
  const now = new Date().toISOString();
  const seenMap = new Map<string, { title: string; chapter: string; lesson?: string }>();

  for (const c of analysis.claims) {
    const cid = makeConceptId(analysis.subject, c.chapter, c.concept);
    if (!seenMap.has(cid)) {
      seenMap.set(cid, { title: c.concept, chapter: c.chapter });
    }
  }
  for (const cov of analysis.coverageItems) {
    const cid = makeConceptId(analysis.subject, cov.chapter, cov.concept);
    if (!seenMap.has(cid)) {
      seenMap.set(cid, { title: cov.concept, chapter: cov.chapter, lesson: cov.lesson });
    }
  }

  for (const [conceptId, info] of seenMap.entries()) {
    const path = `users/${uid}/knowledgeProgress/${conceptId}`;
    const ref = doc(db, 'users', uid, 'knowledgeProgress', conceptId);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const prev = snap.data() as KnowledgeProgress;
        await updateDoc(ref, {
          encounteredCount: prev.encounteredCount + 1,
          ...(analysis.textbookReferenceId ? { textbookReferenceId: analysis.textbookReferenceId } : {}),
          ...(analysis.textbookTitle ? { textbookTitle: analysis.textbookTitle.slice(0, 200) } : {}),
          ...(info.lesson ? { lesson: info.lesson.slice(0, 200) } : {}),
          updatedAt: now,
        });
      } else {
        const fresh: KnowledgeProgress & { ownerUid: string } = {
          conceptId,
          ownerUid: uid,
          conceptTitle: info.title.slice(0, 200),
          subjectId: analysis.subject,
          grade: analysis.grade,
          chapterId: info.chapter.slice(0, 200),
          ...(info.lesson ? { lesson: info.lesson.slice(0, 200) } : {}),
          ...(analysis.textbookReferenceId ? { textbookReferenceId: analysis.textbookReferenceId } : {}),
          ...(analysis.textbookTitle ? { textbookTitle: analysis.textbookTitle.slice(0, 200) } : {}),
          encounteredCount: 1,
          practiceAttemptCount: 0,
          correctAttempts: 0,
          incorrectAttempts: 0,
          recentResults: [],
          sessionIds: [],
          recentAccuracy: null,
          masteryStatus: 'Đã tiếp cận',
          firstSeenAt: now,
          updatedAt: now,
        };
        await setDoc(ref, stripUndefinedDeep(fresh));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }
}

export async function recordQuizAttemptAndProgress(params: {
  uid: string;
  question: QuizQuestion;
  quizSetId: string;
  selectedAnswer: 'A' | 'B' | 'C' | 'D';
  sessionId: string;
  idempotencyAttemptId: string;
}): Promise<KnowledgeProgress | null> {
  const { uid, question, quizSetId, selectedAnswer, sessionId, idempotencyAttemptId } = params;
  const attemptId = makeSafeId(idempotencyAttemptId);
  const attemptPath = `users/${uid}/quizAttempts/${attemptId}`;
  const attemptRef = doc(db, 'users', uid, 'quizAttempts', attemptId);
  const conceptId = makeConceptId(question.subject, question.chapter, question.concept);
  const progressPath = `users/${uid}/knowledgeProgress/${conceptId}`;
  const progressRef = doc(db, 'users', uid, 'knowledgeProgress', conceptId);
  const now = new Date().toISOString();
  const isCorrect = selectedAnswer === question.correctAnswer;

  try {
    // Idempotency check: prevent duplicate recording on double-click or retry
    const existingAttempt = await getDoc(attemptRef);
    if (existingAttempt.exists()) {
      const pSnap = await getDoc(progressRef);
      return pSnap.exists() ? (pSnap.data() as KnowledgeProgress) : null;
    }

    const attemptDoc: QuizAttempt = {
      attemptId,
      uid,
      questionId: question.questionId,
      quizSetId,
      conceptId,
      conceptTitle: question.concept.slice(0, 200),
      subjectId: question.subject,
      chapterId: question.chapter.slice(0, 200),
      selectedAnswer,
      correctAnswer: question.correctAnswer,
      isCorrect,
      attemptedAt: now,
      sessionId,
    };
    await setDoc(attemptRef, stripUndefinedDeep(attemptDoc));

    const pSnap = await getDoc(progressRef);
    if (pSnap.exists()) {
      const prev = pSnap.data() as KnowledgeProgress;
      const nextAttempts = prev.practiceAttemptCount + 1;
      const nextCorrect = prev.correctAttempts + (isCorrect ? 1 : 0);
      const nextIncorrect = prev.incorrectAttempts + (isCorrect ? 0 : 1);
      const nextRecent = [...(prev.recentResults || []), isCorrect].slice(-10);
      const nextSessions = Array.from(new Set([...(prev.sessionIds || []), sessionId])).slice(-50);

      const evaluated = evaluateMasteryStatus({
        encounteredCount: prev.encounteredCount,
        practiceAttemptCount: nextAttempts,
        correctAttempts: nextCorrect,
        incorrectAttempts: nextIncorrect,
        recentResults: nextRecent,
        distinctSessionCount: nextSessions.length,
        reviewedDocument: true,
      });

      const updatedFields = {
        practiceAttemptCount: nextAttempts,
        correctAttempts: nextCorrect,
        incorrectAttempts: nextIncorrect,
        recentResults: nextRecent,
        sessionIds: nextSessions,
        recentAccuracy: evaluated.recentAccuracy,
        masteryStatus: evaluated.masteryStatus,
        ...(isCorrect ? {} : { lastMistakeNote: question.questionText.slice(0, 200) }),
        lastAttemptAt: now,
        updatedAt: now,
      };
      await updateDoc(progressRef, updatedFields);
      return { ...prev, ...updatedFields };
    }

    const evaluated = evaluateMasteryStatus({
      encounteredCount: 1,
      practiceAttemptCount: 1,
      correctAttempts: isCorrect ? 1 : 0,
      incorrectAttempts: isCorrect ? 0 : 1,
      recentResults: [isCorrect],
      distinctSessionCount: 1,
      reviewedDocument: true,
    });

    const created: KnowledgeProgress & { ownerUid: string } = {
      conceptId,
      ownerUid: uid,
      conceptTitle: question.concept.slice(0, 200),
      subjectId: question.subject,
      grade: question.grade,
      chapterId: question.chapter.slice(0, 200),
      encounteredCount: 1,
      practiceAttemptCount: 1,
      correctAttempts: isCorrect ? 1 : 0,
      incorrectAttempts: isCorrect ? 0 : 1,
      recentResults: [isCorrect],
      sessionIds: [sessionId],
      recentAccuracy: evaluated.recentAccuracy,
      masteryStatus: evaluated.masteryStatus,
      ...(isCorrect ? {} : { lastMistakeNote: question.questionText.slice(0, 200) }),
      firstSeenAt: now,
      lastAttemptAt: now,
      updatedAt: now,
    };
    await setDoc(progressRef, stripUndefinedDeep(created));
    return created;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `${attemptPath} | ${progressPath}`);
  }
}

export async function listUserKnowledgeProgress(uid: string): Promise<KnowledgeProgress[]> {
  const path = `users/${uid}/knowledgeProgress`;
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'knowledgeProgress'));
    return snap.docs.map((d) => d.data() as KnowledgeProgress);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listUserQuizAttempts(uid: string): Promise<QuizAttempt[]> {
  const path = `users/${uid}/quizAttempts`;
  try {
    const q = query(
      collection(db, 'users', uid, 'quizAttempts'),
      orderBy('attemptedAt', 'desc'),
      limit(250)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as QuizAttempt);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listAllUsersForAdmin(): Promise<UserProfile[]> {
  const path = 'users';
  try {
    const snap = await getDocs(query(collection(db, 'users'), limit(100)));
    return snap.docs.map((d) => d.data() as UserProfile);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function fetchSystemAiConfigFromFirestore(): Promise<SystemAiConfig | null> {
  const path = 'systemConfig/aiService';
  try {
    const snap = await getDoc(doc(db, 'systemConfig', 'aiService'));
    return snap.exists() ? (snap.data() as SystemAiConfig) : null;
  } catch {
    return null;
  }
}

// === Extended Practice Bank (Flagging + Spaced Repetition 1/3/7) ===
export async function togglePracticeItemFlag(item: PracticeItem): Promise<PracticeItem> {
  const path = `practiceItems/${item.itemId}`;
  const nextFlag = !item.flaggedForReview;
  try {
    await updateDoc(doc(db, 'practiceItems', item.itemId), {
      flaggedForReview: nextFlag,
    });
    return { ...item, flaggedForReview: nextFlag };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function flagQuizQuestionForReview(
  uid: string,
  question: QuizQuestion
): Promise<boolean> {
  const itemId = makeSafeId(`prac_${uid}_${question.questionId}`);
  const path = `practiceItems/${itemId}`;
  const now = new Date().toISOString();
  try {
    const existingSnap = await getDoc(doc(db, 'practiceItems', itemId));
    if (existingSnap.exists()) {
      const prev = existingSnap.data() as PracticeItem;
      const nextFlag = !prev.flaggedForReview;
      await updateDoc(doc(db, 'practiceItems', itemId), { flaggedForReview: nextFlag });
      return nextFlag;
    }
    const item: PracticeItem = {
      itemId,
      questionId: question.questionId,
      ownerUid: uid,
      questionText: question.questionText.slice(0, 2000),
      optionA: question.optionA.slice(0, 500),
      optionB: question.optionB.slice(0, 500),
      optionC: question.optionC.slice(0, 500),
      optionD: question.optionD.slice(0, 500),
      correctAnswer: question.correctAnswer,
      explanation: question.explanation.slice(0, 2000),
      ...(question.distractorExplanations ? { distractorExplanations: question.distractorExplanations } : {}),
      sourceReference: (question.sourceReference || '').slice(0, 300),
      subject: question.subject,
      grade: question.grade,
      chapter: question.chapter.slice(0, 200),
      concept: question.concept.slice(0, 200),
      difficulty: question.difficulty,
      ...(question.cognitiveLevel ? { cognitiveLevel: question.cognitiveLevel } : {}),
      ...(question.knowledgeUnitType ? { knowledgeUnitType: question.knowledgeUnitType } : {}),
      flaggedForReview: true,
      reviewStage: 0,
      reviewIntervalDays: 1,
      nextReviewAt: new Date(Date.now() + 86400000).toISOString(),
      attemptCount: 0,
      correctCount: 0,
      incorrectCount: 0,
      lastAttemptAt: now,
      lastResult: 'correct',
      masteryStatus: 'Đang củng cố',
      createdAt: now,
    };
    await setDoc(doc(db, 'practiceItems', itemId), stripUndefinedDeep(item));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function recordPracticeRetryWithSchedule(
  item: PracticeItem,
  isCorrect: boolean
): Promise<PracticeItem> {
  const path = `practiceItems/${item.itemId}`;
  const now = new Date().toISOString();
  const nextAttemptCount = item.attemptCount + 1;
  const nextCorrectCount = item.correctCount + (isCorrect ? 1 : 0);
  const nextIncorrectCount = item.incorrectCount + (isCorrect ? 0 : 1);
  const nextStatus: PracticeItem['masteryStatus'] =
    isCorrect && nextCorrectCount >= 3 ? 'Tạm nắm vững' : isCorrect ? 'Đang củng cố' : 'Cần ôn tập';
  const schedule = calculateNextReviewSchedule({
    currentStage: item.reviewStage,
    isCorrect,
    fromIso: now,
  });

  try {
    await updateDoc(doc(db, 'practiceItems', item.itemId), {
      attemptCount: nextAttemptCount,
      correctCount: nextCorrectCount,
      incorrectCount: nextIncorrectCount,
      lastAttemptAt: now,
      lastResult: isCorrect ? 'correct' : 'incorrect',
      masteryStatus: nextStatus,
      reviewStage: schedule.nextStage,
      reviewIntervalDays: schedule.intervalDays,
      nextReviewAt: schedule.nextReviewAt,
    });
    return {
      ...item,
      attemptCount: nextAttemptCount,
      correctCount: nextCorrectCount,
      incorrectCount: nextIncorrectCount,
      lastAttemptAt: now,
      lastResult: isCorrect ? 'correct' : 'incorrect',
      masteryStatus: nextStatus,
      reviewStage: schedule.nextStage,
      reviewIntervalDays: schedule.intervalDays,
      nextReviewAt: schedule.nextReviewAt,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// === Flashcards ===
export async function listUserFlashcards(uid: string): Promise<import('../core/types').FlashcardItem[]> {
  const path = 'flashcards';
  try {
    const q = query(
      collection(db, 'flashcards'),
      where('ownerUid', '==', uid),
      orderBy('updatedAt', 'desc'),
      limit(150)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as import('../core/types').FlashcardItem);
  } catch (error) {
    try {
      const snap = await getDocs(
        query(collection(db, 'flashcards'), where('ownerUid', '==', uid), limit(150))
      );
      return snap.docs
        .map((d) => d.data() as import('../core/types').FlashcardItem)
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    } catch (inner) {
      handleFirestoreError(inner || error, OperationType.LIST, path);
    }
  }
}

export async function saveFlashcard(card: import('../core/types').FlashcardItem): Promise<void> {
  const safeId = makeSafeId(card.flashcardId);
  const path = `flashcards/${safeId}`;
  try {
    const safeFront = (card.front || 'Thuật ngữ / Khái niệm').trim().slice(0, 1000) || 'Thuật ngữ / Khái niệm';
    const safeBack = (card.back || 'Nội dung ghi nhớ').trim().slice(0, 2000) || 'Nội dung ghi nhớ';
    const safeChapter = (card.chapter || 'Chuyên đề tổng hợp').trim().slice(0, 200) || 'Chuyên đề tổng hợp';
    const safeConcept = (card.concept || 'Khái niệm trọng tâm').trim().slice(0, 200) || 'Khái niệm trọng tâm';
    await setDoc(
      doc(db, 'flashcards', safeId),
      stripUndefinedDeep({
        ...card,
        flashcardId: safeId,
        front: safeFront,
        back: safeBack,
        chapter: safeChapter,
        concept: safeConcept,
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateFlashcardMastery(
  flashcardId: string,
  masteryStatus: 'Mới tạo' | 'Đang ôn' | 'Đã nhớ',
  reviewStage: 0 | 1 | 2 | 3
): Promise<void> {
  const path = `flashcards/${flashcardId}`;
  const days = reviewStage === 0 ? 1 : reviewStage === 1 ? 3 : reviewStage === 2 ? 7 : 14;
  try {
    await updateDoc(doc(db, 'flashcards', flashcardId), {
      masteryStatus,
      reviewStage,
      nextReviewAt: new Date(Date.now() + days * 86400000).toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteFlashcard(flashcardId: string): Promise<void> {
  const path = `flashcards/${flashcardId}`;
  try {
    await deleteDoc(doc(db, 'flashcards', flashcardId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// === Reference Chunks Editing ===
export async function updateReferenceChunkContent(
  chunkId: string,
  updates: Partial<Pick<ReferenceChunk, 'chapter' | 'lesson' | 'pageNumber' | 'sectionTitle' | 'content'>>
): Promise<void> {
  const path = `referenceChunks/${chunkId}`;
  try {
    await updateDoc(doc(db, 'referenceChunks', chunkId), stripUndefinedDeep(updates));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// === Exam Center & Đua Top Leaderboard ===
export async function listExamBlueprints(): Promise<import('../core/types').ExamBlueprint[]> {
  const path = 'examBlueprints';
  try {
    const snap = await getDocs(query(collection(db, 'examBlueprints'), orderBy('updatedAt', 'desc'), limit(60)));
    return snap.docs.map((d) => d.data() as import('../core/types').ExamBlueprint);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveExamBlueprint(bp: import('../core/types').ExamBlueprint): Promise<void> {
  const safeId = makeSafeId(bp.blueprintId);
  const path = `examBlueprints/${safeId}`;
  try {
    await setDoc(doc(db, 'examBlueprints', safeId), stripUndefinedDeep({ ...bp, blueprintId: safeId }));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteExamBlueprint(blueprintId: string): Promise<void> {
  const path = `examBlueprints/${blueprintId}`;
  try {
    await deleteDoc(doc(db, 'examBlueprints', blueprintId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

function sanitizeExamForFirestore(
  exam: import('../core/types').ExamDocument
): import('../core/types').ExamDocument {
  const safeId = makeSafeId(exam.examId);
  const now = new Date().toISOString();
  const validGrades = new Set(['10', '11', '12']);
  const validExamTypes = new Set([
    'giua_ky_1',
    'cuoi_ky_1',
    'giua_ky_2',
    'cuoi_ky_2',
    'on_tap_tong_hop',
  ]);
  const grade = (validGrades.has(String(exam.grade)) ? exam.grade : '12') as GradeLevel;
  const examType = (
    validExamTypes.has(String(exam.examType)) ? exam.examType : 'giua_ky_1'
  ) as import('../core/types').ExamType;

  return stripUndefinedDeep({
    examId: safeId,
    blueprintId: String(exam.blueprintId || 'exam_file_json').slice(0, 128),
    title: (String(exam.title || 'Đề kiểm tra').trim().slice(0, 200)) || 'Đề kiểm tra',
    description: String(exam.description || '').trim().slice(0, 1000),
    grade,
    subject: (String(exam.subject || 'toan').trim().slice(0, 40) || 'toan') as SubjectId,
    textbookSeries:
      String(exam.textbookSeries || 'Kết nối tri thức với cuộc sống').trim().slice(0, 120) ||
      'Kết nối tri thức với cuộc sống',
    examType,
    academicYear: String(exam.academicYear || '2025-2026').trim().slice(0, 32) || '2025-2026',
    semester: exam.semester === '2' ? '2' : '1',
    chapters: Array.isArray(exam.chapters)
      ? exam.chapters.map((c) => String(c || '').trim()).filter(Boolean).slice(0, 40)
      : ['Chương tổng hợp'],
    durationMinutes: Math.max(5, Math.min(180, Number(exam.durationMinutes) || 45)),
    totalScore: Math.max(1, Math.min(100, Number(exam.totalScore) || 10)),
    allowRetake: typeof exam.allowRetake === 'boolean' ? exam.allowRetake : true,
    published: typeof exam.published === 'boolean' ? exam.published : true,
    validationStatus:
      exam.validationStatus === 'repaired' || exam.validationStatus === 'needs_review'
        ? exam.validationStatus
        : 'passed',
    questions: (exam.questions || []).slice(0, 60).map((q, idx) => ({
      ...q,
      orderIndex: idx + 1,
    })),
    createdBy: String(exam.createdBy || 'admin').slice(0, 128),
    createdAt: String(exam.createdAt || now).slice(0, 64),
    updatedAt: String(exam.updatedAt || now).slice(0, 64),
  });
}

export async function listExams(onlyPublished = true): Promise<import('../core/types').ExamDocument[]> {
  const path = 'exams';
  try {
    const q = onlyPublished
      ? query(collection(db, 'exams'), where('published', '==', true))
      : query(collection(db, 'exams'));
    const snap = await getDocs(q);
    const docs = snap.docs.map((d) => d.data() as import('../core/types').ExamDocument);
    return docs.sort((a, b) =>
      (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveExamDocument(exam: import('../core/types').ExamDocument): Promise<void> {
  const clean = sanitizeExamForFirestore(exam);
  const path = `exams/${clean.examId}`;
  try {
    await setDoc(doc(db, 'exams', clean.examId), clean);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveExamDocumentsBatch(
  examsList: import('../core/types').ExamDocument[]
): Promise<import('../core/types').ExamDocument[]> {
  if (examsList.length === 0) return [];
  const path = 'exams';
  const cleaned = examsList.map((e) => sanitizeExamForFirestore(e));
  try {
    const BATCH_LIMIT = 25;
    for (let i = 0; i < cleaned.length; i += BATCH_LIMIT) {
      const slice = cleaned.slice(i, i + BATCH_LIMIT);
      const batch = writeBatch(db);
      for (const item of slice) {
        batch.set(doc(db, 'exams', item.examId), item);
      }
      await batch.commit();
    }
    return cleaned;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteExamDocument(examId: string): Promise<void> {
  const path = `exams/${examId}`;
  try {
    await deleteDoc(doc(db, 'exams', examId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function listUserExamAttempts(uid: string): Promise<import('../core/types').ExamAttempt[]> {
  const path = 'examAttempts';
  try {
    const q = query(
      collection(db, 'examAttempts'),
      where('uid', '==', uid),
      orderBy('submittedAt', 'desc'),
      limit(60)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as import('../core/types').ExamAttempt);
  } catch (error) {
    try {
      const snap = await getDocs(
        query(collection(db, 'examAttempts'), where('uid', '==', uid), limit(100))
      );
      return snap.docs
        .map((d) => d.data() as import('../core/types').ExamAttempt)
        .sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''))
        .slice(0, 60);
    } catch (inner) {
      handleFirestoreError(inner || error, OperationType.LIST, path);
    }
  }
}

export async function submitExamAttemptAndSyncLeaderboard(params: {
  exam: import('../core/types').ExamDocument;
  uid: string;
  displayName: string;
  grade: GradeLevel;
  answers: import('../core/types').ExamQuestionAnswer[];
  durationSpentSeconds: number;
}): Promise<{
  attempt: import('../core/types').ExamAttempt;
  pointsDelta: number;
  examPoints: number;
  leaderboardEntry: import('../core/types').LeaderboardEntry;
}> {
  const { exam, uid, displayName, grade, answers, durationSpentSeconds } = params;
  const now = new Date().toISOString();
  const graded = gradeExamSubmission(exam, answers);

  // Check existing leaderboard entry for anti-farming improvement delta
  const lbRef = doc(db, 'leaderboard', uid);
  let existingLb: import('../core/types').LeaderboardEntry | null = null;
  try {
    const lbSnap = await getDoc(lbRef);
    if (lbSnap.exists()) {
      existingLb = lbSnap.data() as import('../core/types').LeaderboardEntry;
    }
  } catch {
    existingLb = null;
  }

  const lbUpdate = computeLeaderboardUpdate({
    existing: existingLb,
    uid,
    displayName,
    grade,
    examId: exam.examId,
    earnedScore: graded.earnedScore,
    maxScore: graded.maxScore,
    nowIso: now,
  });

  const attemptId = makeSafeId(`ea_${uid}_${exam.examId}_${Date.now()}`);
  const attempt: import('../core/types').ExamAttempt = {
    attemptId,
    examId: exam.examId,
    examTitle: exam.title,
    uid,
    displayName: displayName || 'Học sinh',
    grade,
    subject: exam.subject,
    examType: exam.examType,
    answers,
    earnedScore: graded.earnedScore,
    maxScore: graded.maxScore,
    percentScore: graded.percentScore,
    leaderboardPointsAwarded: lbUpdate.pointsDelta,
    durationSpentSeconds,
    breakdown: graded.breakdown,
    submittedAt: now,
  };

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'examAttempts', attemptId), stripUndefinedDeep(attempt));
    batch.set(lbRef, stripUndefinedDeep(lbUpdate.nextEntry));
    await batch.commit();
    return {
      attempt,
      pointsDelta: lbUpdate.pointsDelta,
      examPoints: lbUpdate.examPoints,
      leaderboardEntry: lbUpdate.nextEntry,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `examAttempts/${attemptId} | leaderboard/${uid}`);
  }
}

export async function listLeaderboard(
  gradeFilter?: GradeLevel | 'all'
): Promise<import('../core/types').LeaderboardEntry[]> {
  const path = 'leaderboard';
  try {
    const q =
      gradeFilter && gradeFilter !== 'all'
        ? query(
            collection(db, 'leaderboard'),
            where('grade', '==', gradeFilter),
            orderBy('totalScore', 'desc'),
            limit(100)
          )
        : query(collection(db, 'leaderboard'), orderBy('totalScore', 'desc'), limit(100));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as import('../core/types').LeaderboardEntry);
  } catch (error) {
    // Fallback client-side sort if composite index for grade + totalScore hasn't built yet
    try {
      const snap = await getDocs(query(collection(db, 'leaderboard'), limit(150)));
      const all = snap.docs.map((d) => d.data() as import('../core/types').LeaderboardEntry);
      const filtered =
        gradeFilter && gradeFilter !== 'all' ? all.filter((e) => e.grade === gradeFilter) : all;
      return filtered.sort((a, b) => b.totalScore - a.totalScore || b.bestExamScore - a.bestExamScore);
    } catch (inner) {
      handleFirestoreError(inner || error, OperationType.LIST, path);
    }
  }
}

// === Feedback & Moderation ===
export async function submitFeedback(
  entry: import('../core/types').FeedbackEntry
): Promise<void> {
  const safeId = makeSafeId(entry.feedbackId);
  const path = `feedback/${safeId}`;
  try {
    await setDoc(doc(db, 'feedback', safeId), stripUndefinedDeep({ ...entry, feedbackId: safeId }));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function listAllFeedbackForAdmin(): Promise<import('../core/types').FeedbackEntry[]> {
  const path = 'feedback';
  try {
    const q = query(collection(db, 'feedback'), orderBy('createdAt', 'desc'), limit(120));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as import('../core/types').FeedbackEntry);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function updateFeedbackStatus(
  feedbackId: string,
  status: 'pending' | 'reviewed' | 'resolved',
  aiClassification?: string
): Promise<void> {
  const path = `feedback/${feedbackId}`;
  try {
    await updateDoc(doc(db, 'feedback', feedbackId), stripUndefinedDeep({
      status,
      ...(aiClassification ? { aiClassification } : {}),
      updatedAt: new Date().toISOString(),
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// === Resumable AI Jobs ===
export async function saveAiJobRecord(job: import('../core/types').AiJobRecord): Promise<void> {
  const safeId = makeSafeId(job.jobId);
  const path = `aiJobs/${safeId}`;
  try {
    await setDoc(doc(db, 'aiJobs', safeId), stripUndefinedDeep({ ...job, jobId: safeId }));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function listUserAiJobs(uid: string): Promise<import('../core/types').AiJobRecord[]> {
  const path = 'aiJobs';
  try {
    const q = query(
      collection(db, 'aiJobs'),
      where('ownerUid', '==', uid),
      orderBy('updatedAt', 'desc'),
      limit(15)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as import('../core/types').AiJobRecord);
  } catch {
    return [];
  }
}

