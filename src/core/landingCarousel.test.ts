import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeProgressPercent,
  formatSlideNumber,
  getUpcomingIndices,
  stepSlideIndex,
  toggleBookmarkId,
} from './landingCarousel';

test('stepSlideIndex wraps forward and backward across slide boundaries', () => {
  assert.equal(stepSlideIndex(0, 5, 1), 1);
  assert.equal(stepSlideIndex(4, 5, 1), 0);
  assert.equal(stepSlideIndex(0, 5, -1), 4);
  assert.equal(stepSlideIndex(2, 5, -3), 4);
  assert.equal(stepSlideIndex(0, 0, 1), 0);
});

test('getUpcomingIndices returns upcoming cards in circular order excluding active slide', () => {
  assert.deepEqual(getUpcomingIndices(0, 5), [1, 2, 3, 4]);
  assert.deepEqual(getUpcomingIndices(2, 5), [3, 4, 0, 1]);
  assert.deepEqual(getUpcomingIndices(4, 5), [0, 1, 2, 3]);
  assert.deepEqual(getUpcomingIndices(0, 1), []);
});

test('computeProgressPercent scales linearly across slides', () => {
  assert.equal(computeProgressPercent(0, 5), 20);
  assert.equal(computeProgressPercent(2, 5), 60);
  assert.equal(computeProgressPercent(4, 5), 100);
  assert.equal(computeProgressPercent(0, 0), 0);
});

test('formatSlideNumber formats 1-indexed zero-padded labels', () => {
  assert.equal(formatSlideNumber(0, 5), '01');
  assert.equal(formatSlideNumber(4, 5), '05');
  assert.equal(formatSlideNumber(9, 12), '10');
});

test('toggleBookmarkId adds and removes IDs immutably', () => {
  const initial = ['sgk-verify'];
  const added = toggleBookmarkId(initial, 'exam-2025');
  assert.deepEqual(added, ['sgk-verify', 'exam-2025']);
  assert.deepEqual(initial, ['sgk-verify']);

  const removed = toggleBookmarkId(added, 'sgk-verify');
  assert.deepEqual(removed, ['exam-2025']);
});
