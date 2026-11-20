import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNextQuestionIndex,
  isEditableKeyboardTarget,
  mapKeyToAbcdChoice,
} from './answerKeyboard.js';

test('mapKeyToAbcdChoice maps 1-4 and A-D case-insensitively and ignores unrelated keys', () => {
  assert.equal(mapKeyToAbcdChoice('1'), 'A');
  assert.equal(mapKeyToAbcdChoice('2'), 'B');
  assert.equal(mapKeyToAbcdChoice('3'), 'C');
  assert.equal(mapKeyToAbcdChoice('4'), 'D');
  assert.equal(mapKeyToAbcdChoice('a'), 'A');
  assert.equal(mapKeyToAbcdChoice('B'), 'B');
  assert.equal(mapKeyToAbcdChoice('c'), 'C');
  assert.equal(mapKeyToAbcdChoice('d'), 'D');
  assert.equal(mapKeyToAbcdChoice('5'), null);
  assert.equal(mapKeyToAbcdChoice('Enter'), null);
});

test('isEditableKeyboardTarget blocks shortcuts when typing in inputs, textareas, selects, or contentEditable', () => {
  assert.equal(isEditableKeyboardTarget({ tagName: 'INPUT' }), true);
  assert.equal(isEditableKeyboardTarget({ tagName: 'textarea' }), true);
  assert.equal(isEditableKeyboardTarget({ tagName: 'SELECT' }), true);
  assert.equal(isEditableKeyboardTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(
    isEditableKeyboardTarget({ tagName: 'DIV', getAttribute: (n) => (n === 'role' ? 'textbox' : null) }),
    true
  );
  assert.equal(isEditableKeyboardTarget({ tagName: 'BUTTON', isContentEditable: false }), false);
  assert.equal(isEditableKeyboardTarget({ tagName: 'BODY' }), false);
  assert.equal(isEditableKeyboardTarget(null), false);
});

test('computeNextQuestionIndex clamps ArrowUp and ArrowDown within bounds', () => {
  assert.equal(computeNextQuestionIndex(0, 'ArrowDown', 5), 1);
  assert.equal(computeNextQuestionIndex(4, 'ArrowDown', 5), 4);
  assert.equal(computeNextQuestionIndex(2, 'ArrowUp', 5), 1);
  assert.equal(computeNextQuestionIndex(0, 'ArrowUp', 5), 0);
  assert.equal(computeNextQuestionIndex(1, 'ArrowLeft', 5), null);
  assert.equal(computeNextQuestionIndex(0, 'ArrowDown', 0), null);
});
