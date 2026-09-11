'use client';

import { useSyncExternalStore } from 'react';
import { resolveTheme, THEME_STORAGE_KEY, type Theme } from '../lib/theme';

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    'content', theme === 'dark' ? '#141c1b' : '#f7f8f6',
  );
  window.dispatchEvent(new Event('tripdock-theme-change'));
}

function subscribe(onChange: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key === THEME_STORAGE_KEY || event.key === null) {
      applyTheme(resolveTheme(event.newValue));
    }
  }
  window.addEventListener('tripdock-theme-change', onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('tripdock-theme-change', onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribe,
    () => resolveTheme(document.documentElement.dataset.theme),
    () => 'dark' as const,
  );
  return (
    <button
      className="button-secondary theme-toggle"
      type="button"
      aria-label="Dark mode"
      aria-pressed={theme === 'dark'}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      onClick={() => {
        const nextTheme = theme === 'dark' ? 'light' : 'dark';
        applyTheme(nextTheme);
        try { localStorage.setItem(THEME_STORAGE_KEY, nextTheme); } catch { /* Keep the session preference. */ }
      }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        {theme === 'dark' ? <path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>}
      </svg>
      <span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
    </button>
  );
}
