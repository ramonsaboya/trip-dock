import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptedTagDrop } from '../lib/packing-drag.ts';

test('day drops accept only active tags in the current personal library', () => {
  const tags = [{ id: 'personal-beach-tag', archived: false }, { id: 'archived-hike-tag', archived: true }];
  assert.equal(acceptedTagDrop('personal-beach-tag', tags), 'personal-beach-tag');
  for (const payload of ['', 'foreign-tag', 'archived-hike-tag', 'https://example.com', '{"id":"personal-beach-tag"}']) {
    assert.equal(acceptedTagDrop(payload, tags), null);
  }
  assert.equal(acceptedTagDrop('personal-beach-tag', []), null, 'an old drag cannot reintroduce a removed tag');
});
