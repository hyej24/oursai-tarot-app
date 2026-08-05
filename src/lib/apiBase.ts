const DEFAULT_REMOTE_API_BASE_URL = 'https://oursai-tarot-app.onrender.com';

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();

function getDefaultApiBaseUrl() {
  if (typeof window === 'undefined') return '';

  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const isRender = host.endsWith('onrender.com');

  // Toss app test/production can run the web bundle from a WebView-local origin.
  // In that environment, relative /api calls point to the app shell instead of Render.
  // Keep local dev relative only while Vite is running.
  if (isLocal && import.meta.env.DEV) return '';
  if (isRender) return '';
  return DEFAULT_REMOTE_API_BASE_URL;
}

export const API_BASE_URL = (rawApiBaseUrl || getDefaultApiBaseUrl()).replace(/\/+$/, '');

export function apiPath(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}
