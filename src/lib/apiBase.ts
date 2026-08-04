const DEFAULT_REMOTE_API_BASE_URL = 'https://oursai-tarot.onrender.com';

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();

function getDefaultApiBaseUrl() {
  if (typeof window === 'undefined') return '';

  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const isRender = host.endsWith('onrender.com');

  // Local preview runs through the same Express server, so use the local API.
  if (isLocal) return '';
  if (isRender) return '';
  return DEFAULT_REMOTE_API_BASE_URL;
}

export const API_BASE_URL = (rawApiBaseUrl || getDefaultApiBaseUrl()).replace(/\/+$/, '');

export function apiPath(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}
