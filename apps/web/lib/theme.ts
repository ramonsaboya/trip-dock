export type Theme = 'dark' | 'light';
export const THEME_STORAGE_KEY = 'tripdock-theme';

export function resolveTheme(value: string | null | undefined): Theme {
  return value === 'light' ? 'light' : 'dark';
}

// Runs before the body is painted, including when storage is unavailable.
export const themeBootstrapScript = `(() => {
  let theme = 'dark';
  try { if (localStorage.getItem('${THEME_STORAGE_KEY}') === 'light') theme = 'light'; } catch {}
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#141c1b' : '#f7f8f6');
})();`;
