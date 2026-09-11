import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { resolveTheme, themeBootstrapScript, THEME_STORAGE_KEY } from '../lib/theme.ts';

test('only an explicit light preference overrides the dark default', () => {
  for (const value of [null, undefined, '', 'dark', 'system', 'invalid']) {
    assert.equal(resolveTheme(value), 'dark');
  }
  assert.equal(resolveTheme('light'), 'light');
});

for (const stored of [null, 'light', 'dark', 'invalid', 'blocked']) {
  test(`pre-paint initialization handles ${stored ?? 'fresh storage'}`, () => {
    const root = { dataset: {} as Record<string, string> };
    let themeColor = '';
    runInNewContext(themeBootstrapScript, {
      localStorage: {
        getItem(key: string) {
          assert.equal(key, THEME_STORAGE_KEY);
          if (stored === 'blocked') throw new Error('Storage denied');
          return stored;
        },
      },
      document: {
        documentElement: root,
        querySelector: () => ({ setAttribute: (_: string, value: string) => { themeColor = value; } }),
      },
    });
    assert.equal(root.dataset.theme, stored === 'light' ? 'light' : 'dark');
    assert.equal(themeColor, stored === 'light' ? '#f7f8f6' : '#141c1b');
  });
}

test('initialization tolerates an absent browser chrome meta tag', () => {
  const root = { dataset: {} as Record<string, string> };
  runInNewContext(themeBootstrapScript, {
    document: { documentElement: root, querySelector: () => null },
  });
  assert.equal(root.dataset.theme, 'dark');
});
