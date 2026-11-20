import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCarouselTargetIndex,
  computeDockItemTransform,
  computeTypewriterFrame,
} from './uiMotionMath';

test('computeDockItemTransform produces wave magnification around hovered item', () => {
  const hovered = computeDockItemTransform(2, 2);
  const near = computeDockItemTransform(1, 2);
  const far = computeDockItemTransform(0, 2);
  const outside = computeDockItemTransform(5, 2);

  assert.equal(hovered.scale, 1.26);
  assert.equal(hovered.liftY, -6);
  assert.ok(near.scale > far.scale && far.scale > outside.scale);
  assert.equal(outside.scale, 1);
  assert.equal(outside.liftY, 0);
});

test('computeDockItemTransform returns neutral transform when idle or reduced motion', () => {
  assert.deepEqual(computeDockItemTransform(2, null), { scale: 1, liftY: 0 });
  assert.deepEqual(computeDockItemTransform(2, 2, true), { scale: 1, liftY: 0 });
});

test('computeCarouselTargetIndex clamps without loop and wraps with loop', () => {
  assert.equal(computeCarouselTargetIndex(0, -1, 4, false), 0);
  assert.equal(computeCarouselTargetIndex(3, 1, 4, false), 3);
  assert.equal(computeCarouselTargetIndex(1, 1, 4, false), 2);

  assert.equal(computeCarouselTargetIndex(0, -1, 4, true), 3);
  assert.equal(computeCarouselTargetIndex(3, 1, 4, true), 0);
  assert.equal(computeCarouselTargetIndex(0, 1, 0, true), 0);
});

test('computeTypewriterFrame handles Vietnamese text and reduced motion deterministically', () => {
  const phrase = 'Nền tảng kiểm chứng học tập THPT · Lớp 10 · 11 · 12';
  const reduced = computeTypewriterFrame(phrase, 0, 30, true);
  assert.equal(reduced.visibleText, phrase);
  assert.equal(reduced.isComplete, true);

  const mid = computeTypewriterFrame(phrase, 300, 30, false);
  assert.equal(mid.charCount, 10);
  assert.equal(mid.visibleText, 'Nền tảng k');
  assert.equal(mid.isComplete, false);

  const done = computeTypewriterFrame(phrase, 5000, 30, false);
  assert.equal(done.visibleText, phrase);
  assert.equal(done.isComplete, true);
});
