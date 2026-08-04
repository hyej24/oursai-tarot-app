import { SavedReading } from './readingStorage';

export const SHARED_READING_QUERY_KEY = 'sharedReading';

export interface SharedReadingPayload {
  question: string;
  cards: SavedReading['cards'];
  readingResult: SavedReading['readingResult'];
  dateTime?: string;
  partnerNickname?: string;
  relationship?: string;
  productType?: SavedReading['productType'];
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeSharedReading(reading: SavedReading): string {
  const payload: SharedReadingPayload = {
    question: reading.question,
    cards: reading.cards,
    readingResult: reading.readingResult,
    dateTime: reading.dateTime,
    partnerNickname: reading.partnerNickname,
    relationship: reading.relationship,
    productType: reading.productType,
  };

  return toBase64Url(JSON.stringify(payload));
}

export function decodeSharedReading(value: string): SharedReadingPayload | null {
  try {
    const parsed = JSON.parse(fromBase64Url(value));
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cards) || !parsed.readingResult) {
      return null;
    }

    return parsed as SharedReadingPayload;
  } catch (error) {
    console.warn('Failed to decode shared reading link:', error);
    return null;
  }
}

export function buildSharedReadingUrl(reading: SavedReading): string {
  const baseUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}`
    : 'https://oursai-tarot.onrender.com/';
  const url = new URL(baseUrl);
  url.searchParams.set(SHARED_READING_QUERY_KEY, encodeSharedReading(reading));
  return url.toString();
}
