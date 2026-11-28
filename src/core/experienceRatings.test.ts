import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPERIENCE_MAX_COMMENT_LENGTH,
  EXPERIENCE_MIN_COMMENT_LENGTH,
  EXPERIENCE_REMIND_MS,
  aggregateExperienceRatings,
  buildExperienceRatingRecord,
  computeSnoozeUntil,
  formatExperienceRelativeTime,
  generateGuestRatingId,
  isValidGuestRatingId,
  readPromptStorageState,
  savePromptRated,
  savePromptSnooze,
  shouldShowExperiencePrompt,
  validateExperienceRatingInput,
  type ExperienceRatingRecord,
  type MinimalStorage,
} from './experienceRatings';

function createMemoryStorage(): MinimalStorage {
  const store = new Map<string, string>();
  return {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

test('aggregateExperienceRatings returns honest empty zero state with no fabricated numbers', () => {
  const stats = aggregateExperienceRatings([]);
  assert.equal(stats.totalCount, 0);
  assert.equal(stats.averageStars, null);
  assert.equal(stats.satisfactionPercent, null);
  assert.equal(stats.fiveStarPercent, null);
  assert.equal(stats.verifiedAccountCount, 0);
  assert.equal(stats.latestUpdatedAt, null);
  assert.deepEqual(stats.aspectAverages, {
    easeOfUse: null,
    usefulness: null,
    speedAndUi: null,
  });
  assert.deepEqual(stats.recentComments, []);
  assert.equal(stats.distribution.length, 5);
  assert.equal(stats.distribution[0].star, 5);
  assert.equal(stats.distribution[4].star, 1);
  assert.ok(stats.distribution.every((b) => b.count === 0 && b.percent === 0));
});

test('aggregateExperienceRatings calculates real averages, distribution, and sorts comments newest-first', () => {
  const records: ExperienceRatingRecord[] = [
    {
      ratingId: 'guest_11111111',
      ownerUid: 'guest',
      authorName: 'Minh Anh',
      roleLabel: 'Học sinh lớp 12',
      stars: 5,
      easeOfUse: 5,
      usefulness: 5,
      speedAndUi: 4,
      comment: 'Chấm lỗi công thức rất rõ ràng.',
      isVerifiedAccount: false,
      visibility: 'public',
      createdAt: '2026-11-27T10:00:00.000Z',
      updatedAt: '2026-11-27T10:00:00.000Z',
    },
    {
      ratingId: 'user_abc123',
      ownerUid: 'user_abc123',
      authorName: 'Quốc Bảo',
      roleLabel: 'Học sinh lớp 11',
      stars: 4,
      easeOfUse: 4,
      usefulness: 5,
      speedAndUi: 4,
      comment: '',
      isVerifiedAccount: true,
      visibility: 'public',
      createdAt: '2026-11-27T11:00:00.000Z',
      updatedAt: '2026-11-27T11:00:00.000Z',
    },
    {
      ratingId: 'guest_22222222',
      ownerUid: 'guest',
      authorName: 'Thảo Vy',
      roleLabel: 'Học sinh lớp 10',
      stars: 3,
      easeOfUse: 3,
      usefulness: 4,
      speedAndUi: 3,
      comment: 'Cần tải OCR nhanh hơn một chút.',
      isVerifiedAccount: false,
      visibility: 'public',
      createdAt: '2026-11-27T12:30:00.000Z',
      updatedAt: '2026-11-27T12:30:00.000Z',
    },
  ];

  const stats = aggregateExperienceRatings(records);
  assert.equal(stats.totalCount, 3);
  assert.equal(stats.averageStars, 4); // (5+4+3)/3 = 4.0
  assert.equal(stats.satisfactionPercent, 67); // 2/3 >= 4 stars
  assert.equal(stats.fiveStarPercent, 33); // 1/3 === 5 stars
  assert.equal(stats.verifiedAccountCount, 1);
  assert.equal(stats.aspectAverages.easeOfUse, 4);
  assert.equal(stats.aspectAverages.usefulness, 4.7); // (5+5+4)/3 = 4.666 -> 4.7
  assert.equal(stats.aspectAverages.speedAndUi, 3.7); // (4+4+3)/3 = 3.666 -> 3.7
  assert.equal(stats.latestUpdatedAt, '2026-11-27T12:30:00.000Z');
  assert.equal(stats.recentComments.length, 2);
  assert.equal(stats.recentComments[0].authorName, 'Thảo Vy');
  assert.equal(stats.recentComments[1].authorName, 'Minh Anh');

  const bucket5 = stats.distribution.find((b) => b.star === 5);
  const bucket4 = stats.distribution.find((b) => b.star === 4);
  const bucket3 = stats.distribution.find((b) => b.star === 3);
  const bucket2 = stats.distribution.find((b) => b.star === 2);
  assert.equal(bucket5?.count, 1);
  assert.equal(bucket4?.count, 1);
  assert.equal(bucket3?.count, 1);
  assert.equal(bucket2?.count, 0);
});

test('6-hour snooze and prompt visibility state machine behaves deterministically', () => {
  const storage = createMemoryStorage();
  const t0 = 1_700_000_000_000;

  // Fresh visitor has not rated -> prompt SHOULD show
  const initialState = readPromptStorageState(storage);
  assert.equal(initialState.hasRated, false);
  assert.equal(isValidGuestRatingId(initialState.visitorId), true);
  assert.equal(
    shouldShowExperiencePrompt({
      state: initialState,
      hasRemoteAccountRating: false,
      nowMs: t0,
    }),
    true
  );

  // User clicks "Nhắc lại sau 6 giờ"
  const snoozed = savePromptSnooze(storage, t0);
  assert.equal(snoozed.remindAfter, computeSnoozeUntil(t0, 6));
  assert.equal(snoozed.remindAfter! - t0, EXPERIENCE_REMIND_MS);

  // 1ms before 6 hours -> MUST stay hidden
  assert.equal(
    shouldShowExperiencePrompt({
      state: snoozed,
      hasRemoteAccountRating: false,
      nowMs: t0 + EXPERIENCE_REMIND_MS - 1,
    }),
    false
  );

  // Exactly at 6 hours -> SHOULD show again
  assert.equal(
    shouldShowExperiencePrompt({
      state: snoozed,
      hasRemoteAccountRating: false,
      nowMs: t0 + EXPERIENCE_REMIND_MS,
    }),
    true
  );

  // Once user submits a rating -> MUST NEVER show again even after 6+ hours
  const rated = savePromptRated(storage, snoozed.visitorId, t0 + EXPERIENCE_REMIND_MS);
  assert.equal(rated.hasRated, true);
  assert.equal(rated.remindAfter, undefined);
  assert.equal(
    shouldShowExperiencePrompt({
      state: rated,
      hasRemoteAccountRating: false,
      nowMs: t0 + EXPERIENCE_REMIND_MS * 10,
    }),
    false
  );

  // Signed-in user who already rated on another device -> MUST stay hidden even on fresh browser
  const freshBrowser = readPromptStorageState(createMemoryStorage());
  assert.equal(
    shouldShowExperiencePrompt({
      state: freshBrowser,
      hasRemoteAccountRating: true,
      nowMs: t0,
    }),
    false
  );
});

test('validateExperienceRatingInput enforces blueprint bounds and defaults cleanly', () => {
  const missingStars = validateExperienceRatingInput({ roleLabel: 'Học sinh lớp 12' });
  assert.equal(missingStars.ok, false);

  const outOfRange = validateExperienceRatingInput({ stars: 6, roleLabel: 'Học sinh lớp 12' });
  assert.equal(outOfRange.ok, false);

  const emptyComment = validateExperienceRatingInput({
    stars: 5,
    roleLabel: 'Học sinh lớp 12',
    comment: '    ',
  });
  assert.equal(emptyComment.ok, false);

  const tooShortComment = validateExperienceRatingInput({
    stars: 5,
    roleLabel: 'Học sinh lớp 12',
    comment: 'a'.repeat(EXPERIENCE_MIN_COMMENT_LENGTH - 1),
  });
  assert.equal(tooShortComment.ok, false);

  const tooLongComment = validateExperienceRatingInput({
    stars: 5,
    roleLabel: 'Học sinh lớp 12',
    comment: 'a'.repeat(EXPERIENCE_MAX_COMMENT_LENGTH + 1),
  });
  assert.equal(tooLongComment.ok, false);

  const valid = validateExperienceRatingInput({
    stars: 5,
    easeOfUse: 4,
    usefulness: 5,
    speedAndUi: 5,
    roleLabel: 'Học sinh lớp 12',
    authorName: '  ',
    comment: '  Rất hữu ích khi ôn thi!  ',
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.sanitized.authorName, 'Học sinh lớp 12');
    assert.equal(valid.sanitized.comment, 'Rất hữu ích khi ôn thi!');
    const guestId = generateGuestRatingId();
    assert.equal(isValidGuestRatingId(guestId), true);
    const rec = buildExperienceRatingRecord({
      ratingId: guestId,
      ownerUid: 'guest',
      isVerifiedAccount: false,
      sanitized: valid.sanitized,
      nowIso: '2026-11-27T12:00:00.000Z',
    });
    assert.equal(rec.visibility, 'public');
    assert.equal(rec.createdAt, '2026-11-27T12:00:00.000Z');
  }
});

test('formatExperienceRelativeTime formats recent and older timestamps in Vietnamese', () => {
  const now = Date.parse('2026-11-27T12:00:00.000Z');
  assert.equal(formatExperienceRelativeTime('2026-11-27T11:59:40.000Z', now), 'Vừa xong');
  assert.equal(formatExperienceRelativeTime('2026-11-27T11:45:00.000Z', now), '15 phút trước');
  assert.equal(formatExperienceRelativeTime('2026-11-27T09:00:00.000Z', now), '3 giờ trước');
  assert.equal(formatExperienceRelativeTime('2026-11-25T12:00:00.000Z', now), '2 ngày trước');
});
