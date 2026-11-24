import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_HINT_STORAGE_KEY,
  readHasSessionHint,
  writeHasSessionHint,
  type MinimalStorage,
} from './sessionHint';

function createMemoryStorage(): MinimalStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

test('readHasSessionHint defaults to false on empty or null storage', () => {
  const storage = createMemoryStorage();
  assert.equal(readHasSessionHint(storage), false);
  assert.equal(readHasSessionHint(null), false);
});

test('writeHasSessionHint persists and clears session flag cleanly', () => {
  const storage = createMemoryStorage();
  writeHasSessionHint(true, storage);
  assert.equal(storage.getItem(SESSION_HINT_STORAGE_KEY), '1');
  assert.equal(readHasSessionHint(storage), true);

  writeHasSessionHint(false, storage);
  assert.equal(storage.getItem(SESSION_HINT_STORAGE_KEY), null);
  assert.equal(readHasSessionHint(storage), false);
});

test('sessionHint safely handles throwing storage APIs', () => {
  const brokenStorage: MinimalStorage = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
    removeItem() {
      throw new Error('SecurityError');
    },
  };
  assert.equal(readHasSessionHint(brokenStorage), false);
  assert.doesNotThrow(() => writeHasSessionHint(true, brokenStorage));
  assert.doesNotThrow(() => writeHasSessionHint(false, brokenStorage));
});
