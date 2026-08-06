import React, { useState, useEffect, useRef } from 'react';
import { Heart, Save, ArrowLeft, HelpCircle, ArrowRight, ShieldCheck, Check, AlertTriangle, RefreshCcw, Sparkles, Share2 } from 'lucide-react';
import { TarotCard, PartnerProfile, RelationshipType } from '../types';
import { getProductByType, getSuggestedQuestions, SuggestedQuestion } from '../data/pricingProducts';
import { calculateRelationshipTemperature } from '../data/tarotCards';
import { readingStorage } from '../lib/readingStorage';
import { TarotCardImage } from './TarotCardImage';
import { isRelationshipCategory, QuestionCategory } from '../lib/questionTarot';
import { DAILY_TEMPERATURE_READING_KEY, DAILY_TEMPERATURE_READING_VERSION, READING_TOKEN_COST } from '../lib/appConstants';
import { generateLocalPaidReading } from '../lib/localTarotReading';
import { apiPath } from '../lib/apiBase';
import { getKstDateKey } from '../lib/kstDate';

interface ReadingResultViewProps {
  menuId: string;
  menuTitle: string;
  cards: TarotCard[];
  partnerProfile: PartnerProfile | null;
  situation: string;
  question: string;
  onBackToHome: () => void;
  onGoToRecords: () => void;
  onAskFollowUp?: (question: string) => void;
  onReadingSuccess?: () => boolean | void;
  onChargeQuestionPass?: () => void;
  onUseAdReadingAccess?: () => Promise<boolean>;
  onClaimShareRewardPass?: () => Promise<boolean>;
  questionPassBalance?: number;
  initialReadingResult?: StandardReadingResult | null;
}

export interface StandardReadingResult {
  oneLineConclusion: string;
  questionCategory?: string;
  cards?: Array<{
    role?: string;
    cardName?: string;
    orientation?: string;
    coreMeaning?: string;
    contextualMeaning?: string;
  }>;
  card1Meaning?: string;
  card2Meaning?: string;
  card3Meaning?: string;
  totalFlow?: string;
  caution?: string;
  actionAdvice?: string;
  followUpQuestions?: string[];
  temperature: number;

  // 오늘의 연애운 (dating-luck)
  conclusion?: string;
  todayEmotion?: string;
  incomingPersonOrEvent?: string;

  // 그 사람의 속마음 (inner-mind)
  outwardAttitude?: string;
  realFeeling?: string;
  hiddenEmotion?: string;
  futureAction?: string;

  // 오늘 연락해도 될까 (can-contact)
  contactRecommendation?: string;
  partnerCondition?: string;
  expectedResponse?: string;
  conversationPossibility?: string;
  avoidMessage?: string;
  recommendedApproach?: string;

  // Legacy relationship temperature flow (relation-temp)
  partnerFeeling?: string;
  relationshipBarrier?: string;
  nearFuture?: string;

  // 이번 주 관계 흐름 (relation-flow)
  earlyWeek?: string;
  midWeek?: string;
  lateWeek?: string;
  turningPoint?: string;
}

interface PaidReadingResult {
  premiumConclusion: string;
  partnerEmotionSituation: string;
  actionPossibility: string;
  relationshipBarrier: string;
  expectedResponse: string;
  detailedAdvice: string;
}

const readingResultCache = new Map<string, StandardReadingResult>();
const readingRequestCache = new Map<string, Promise<StandardReadingResult>>();
const chargedReadingKeys = new Set<string>();
const isFreeTemperatureMenu = (menuId: string) => menuId === 'daily-temperature' || menuId === 'relation-temp';
const READING_CACHE_PREFIX = 'tarot_success_reading_cache_';
const READING_LOCK_PREFIX = 'tarot_inflight_reading_lock_';
const CHARGED_READING_KEYS_PREFIX = 'tarot_charged_reading_keys_';
const READING_LOCK_TTL_MS = 25000;

function hashReadingKey(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function getReadingCacheKey(fetchKey: string) {
  return `${READING_CACHE_PREFIX}${hashReadingKey(fetchKey)}`;
}

function getReadingLockKey(fetchKey: string) {
  return `${READING_LOCK_PREFIX}${hashReadingKey(fetchKey)}`;
}

function readPersistentReading(fetchKey: string): StandardReadingResult | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(getReadingCacheKey(fetchKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.fetchKeyHash !== hashReadingKey(fetchKey)) return null;
    const normalized = normalizeApiReading(parsed?.readingResult || parsed?.reading || parsed);
    return hasUsableReading(normalized, parsed?.menuId || '') ? normalized : null;
  } catch {
    return null;
  }
}

function writePersistentReading(fetchKey: string, menuId: string, readingResult: StandardReadingResult) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getReadingCacheKey(fetchKey), JSON.stringify({
      fetchKeyHash: hashReadingKey(fetchKey),
      menuId,
      savedAt: Date.now(),
      readingResult
    }));
  } catch {
    // Storage can fail in private/embedded browsers. Memory cache still protects current session.
  }
}

function readActiveReadingLock(fetchKey: string): { requestId: string; expiresAt: number } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(getReadingLockKey(fetchKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.requestId || Number(parsed?.expiresAt) <= Date.now()) {
      localStorage.removeItem(getReadingLockKey(fetchKey));
      return null;
    }
    return { requestId: String(parsed.requestId), expiresAt: Number(parsed.expiresAt) };
  } catch {
    return null;
  }
}

function writeReadingLock(fetchKey: string, requestId: string) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getReadingLockKey(fetchKey), JSON.stringify({
      requestId,
      startedAt: Date.now(),
      expiresAt: Date.now() + READING_LOCK_TTL_MS
    }));
  } catch {
    // Ignore storage failures.
  }
}

function clearReadingLock(fetchKey: string, requestId: string) {
  if (typeof window === 'undefined') return;
  try {
    const active = readActiveReadingLock(fetchKey);
    if (!active || active.requestId === requestId) {
      localStorage.removeItem(getReadingLockKey(fetchKey));
    }
  } catch {
    // Ignore storage failures.
  }
}

async function waitForPersistedReading(fetchKey: string, lock: { requestId: string; expiresAt: number }) {
  const endAt = Math.min(lock.expiresAt, Date.now() + 8000);
  while (Date.now() < endAt) {
    const stored = readPersistentReading(fetchKey);
    if (stored) return stored;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return null;
}

function getDailyChargedSetKey() {
  return `${CHARGED_READING_KEYS_PREFIX}${getKstDateKey()}`;
}

function hasPersistentlyChargedReading(fetchKey: string) {
  if (typeof window === 'undefined') return false;
  try {
    const charged = JSON.parse(localStorage.getItem(getDailyChargedSetKey()) || '[]');
    return Array.isArray(charged) && charged.includes(hashReadingKey(fetchKey));
  } catch {
    return false;
  }
}

function markPersistentlyChargedReading(fetchKey: string) {
  if (typeof window === 'undefined') return;
  try {
    const key = getDailyChargedSetKey();
    const charged = JSON.parse(localStorage.getItem(key) || '[]');
    const next = Array.isArray(charged) ? charged : [];
    const hash = hashReadingKey(fetchKey);
    if (!next.includes(hash)) {
      next.push(hash);
      localStorage.setItem(key, JSON.stringify(next.slice(-80)));
    }
  } catch {
    // Ignore storage failures.
  }
}

function replaceHanjaInKoreanText(text: string): string {
  const hanjaMap: Record<string, string> = {
    "\u614E": "\uC2E0",
    "\u613C": "\uC2E0",
    "\u611F": "\uAC10",
    "\u60C5": "\uC815",
    "\u5FC3": "\uC2EC",
    "\u5167": "\uB0B4",
    "\u5185": "\uB0B4",
    "\u5916": "\uC678",
    "\u4E2D": "\uC911",
    "\u7121": "\uBB34",
    "\u6709": "\uC720",
    "\u76F8": "\uC0C1",
    "\u5C0D": "\uB300",
    "\u4EBA": "\uC778",
    "\u81EA": "\uC790",
    "\u5C0A": "\uC874",
    "\u5F37": "\uAC15",
    "\u5F31": "\uC57D",
    "\u73FE": "\uD604",
    "\u5728": "\uC7AC",
    "\u672A": "\uBBF8",
    "\u4F86": "\uB798",
    "\u904E": "\uACFC",
    "\u53BB": "\uAC70",
    "\u95DC": "\uAD00",
    "\u4FC2": "\uACC4",
    "\u8DDD": "\uAC70",
    "\u96E2": "\uB9AC",
    "\u5B89": "\uC548",
    "\u5168": "\uC804",
  };

  return text.replace(/[\u3400-\u9FFF\uF900-\uFAFF]/g, (char) => hanjaMap[char] ?? "");
}

function sanitizeReadingValue<T>(value: T): T {
  if (typeof value === 'string') {
    return replaceHanjaInKoreanText(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitizeReadingValue(item)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sanitizeReadingValue(item)])
    ) as T;
  }

  return value;
}

const READING_LOADING_MESSAGES = [
  "선택한 카드의 흐름을 질문에 맞춰 보고 있어요.",
  "카드들이 이어지는 분위기를 조용히 살펴보고 있어요.",
  "지금 질문에서 가장 중요한 포인트를 정리하고 있어요.",
  "카드가 가리키는 흐름을 질문에 맞춰 정리하고 있어요.",
  "선택한 카드들의 공통된 방향을 맞춰 보고 있어요.",
  "지금 가장 궁금한 지점에 맞춰 답을 고르고 있어요.",
  "질문과 카드의 의미를 함께 살펴보는 중이에요."
];

function pickNextLoadingMessage(current: string) {
  const candidates = READING_LOADING_MESSAGES.filter(message => message !== current);
  return candidates[Math.floor(Math.random() * candidates.length)] || READING_LOADING_MESSAGES[0];
}

function normalizeApiReading(data: any): StandardReadingResult {
  const source = sanitizeReadingValue(data?.reading || data?.result || data?.data || data || {});
  const cards = Array.isArray(source?.cards) ? source.cards : [];
  const card1Meaning = source?.card1Meaning || cards[0]?.contextualMeaning || cards[0]?.coreMeaning || '';
  const totalFlow = source?.totalFlow || source?.combinedFlow || source?.conclusion || '';
  const card2Meaning = source?.card2Meaning || cards[1]?.contextualMeaning || cards[1]?.coreMeaning || totalFlow || '';
  const card3Meaning = source?.card3Meaning || cards[2]?.contextualMeaning || cards[2]?.coreMeaning || source?.actionAdvice || '';
  const oneLineConclusion = source?.oneLineConclusion || source?.conclusion || source?.totalFlow || source?.combinedFlow || card1Meaning || '';
  return {
    ...source,
    oneLineConclusion,
    questionCategory: source?.questionCategory,
    card1Meaning,
    card2Meaning,
    card3Meaning,
    totalFlow: totalFlow || oneLineConclusion,
    caution: source?.caution || '',
    actionAdvice: source?.actionAdvice || '',
    followUpQuestions: Array.isArray(source?.followUpQuestions) ? source.followUpQuestions : [],
    temperature: Number(source?.temperature || 50),
  };
}

function hasUsableReading(data: StandardReadingResult | null | undefined, menuId = '') {
  if (!data) return false;
  if (menuId === 'daily-temperature') {
    return Boolean(data.oneLineConclusion || data.card1Meaning || data.totalFlow);
  }
  return Boolean(
    data.oneLineConclusion ||
    data.card1Meaning ||
    data.card2Meaning ||
    data.card3Meaning ||
    data.totalFlow ||
    data.caution ||
    data.actionAdvice
  );
}

function getStoredDailyTemperatureReading(card: TarotCard | undefined): StandardReadingResult | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = localStorage.getItem(DAILY_TEMPERATURE_READING_KEY);
    if (!raw) {
      return null;
    }

    const saved = JSON.parse(raw);
    if (saved?.date !== getKstDateKey()) {
      return null;
    }

    if (saved?.version !== DAILY_TEMPERATURE_READING_VERSION) {
      return null;
    }

    const savedReading = saved?.readingResult || saved?.reading || saved?.result || null;
    if (!savedReading) {
      return null;
    }

    const normalized = normalizeApiReading(savedReading);
    const temperature = Number(normalized.temperature);
    if (
      !hasUsableReading(normalized, 'daily-temperature') ||
      !Number.isFinite(temperature)
    ) {
      return null;
    }

    return {
      ...normalized,
      temperature,
    };
  } catch {
    return null;
  }
}

async function postTarotReadingWithFallback(payload: Record<string, unknown>) {
  const primaryUrl = apiPath('/api/tarot/read');
  const urls = [primaryUrl];
  let lastError: Error | null = null;
  const clientRequestId = String(payload.requestId || `reading-${Date.now().toString(36)}`);

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Request-Id': clientRequestId
        },
        body: JSON.stringify({ ...payload, requestId: clientRequestId }),
      });

      const resJson = await response.json().catch(() => null);
      const apiReading = resJson?.reading || resJson?.result || resJson?.data || resJson;
      if (apiReading && (resJson?.success === true || resJson?.recovered === true)) {
        const normalized = normalizeApiReading(apiReading);
        if (hasUsableReading(normalized, String(payload.menuId || ''))) {
          return normalized;
        }
      }

      if (!response.ok || resJson?.ok === false || resJson?.success === false) {
        throw new Error(resJson?.code || resJson?.error || resJson?.message || 'NETWORK_ERROR');
      }

      if (!apiReading) {
        throw new Error('AI_RESPONSE_EMPTY');
      }

      const normalized = normalizeApiReading(apiReading);
      if (!hasUsableReading(normalized, String(payload.menuId || ''))) {
        throw new Error('AI_RESPONSE_INCOMPLETE');
      }
      return normalized;
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error || 'NETWORK_ERROR'));
      console.warn(`AI reading request failed at ${url}. Trying fallback if available:`, lastError);
    }
  }

  throw lastError || new Error('NETWORK_ERROR');
}

type DailyTemperatureCardProfile = {
  tone: string;
  detail: string;
  person: string;
  caution: string;
  advice: string;
};

function getDailyTemperatureCardProfile(card: TarotCard, temperature: number): DailyTemperatureCardProfile {
  const reversed = Boolean(card.isReversed);
  const value = Number(card.value || 0);
  const id = Number(card.id);

  const majorProfiles: Record<number, DailyTemperatureCardProfile> = {
    0: {
      tone: '가볍게 마음이 열리고, 아직 정해지지 않은 가능성이 살아 있는 날이에요.',
      detail: '오늘은 둘 사이가 무겁게 굳어 있다기보다, 작은 호기심과 편안한 반응에서 흐름이 시작될 수 있어요.\n상대도 깊게 계산하기보다 순간의 분위기에 따라 움직일 가능성이 있어요.\n다만 아직 확실히 자리 잡은 온도는 아니라서, 즐겁게 이어질 수도 있고 금방 흩어질 수도 있어요.\n처음부터 의미를 크게 묻기보다 자연스럽게 분위기를 타는 편이 좋아요.',
      person: '상대는 오늘 질문자님을 볼 때 부담보다 호기심을 먼저 느낄 수 있어요.\n진지한 확답보다는 편안한 반응, 즉흥적인 말, 가벼운 웃음으로 마음을 보여 줄 가능성이 커요.\n아직 깊은 약속을 떠올리기보다 지금 이 순간의 느낌에 반응하는 쪽이에요.\n그래서 말투가 가벼워 보여도 완전히 마음이 없는 흐름은 아니에요.',
      caution: '오늘은 너무 빨리 관계의 이름을 붙이려 하면 좋은 흐름이 갑자기 무거워질 수 있어요.\n가볍게 시작된 온도는 가볍게 받아 줄 때 더 자연스럽게 살아나요.\n상대가 즉흥적으로 움직인다고 해서 그 반응을 바로 확답으로 보지는 마세요.\n오늘은 가능성을 열어 두되, 결론은 조금 뒤로 미루는 게 좋아요.',
      advice: '편하게 웃을 수 있는 말부터 건네 보세요.\n긴 설명보다 짧고 밝은 안부가 오늘의 온도에 잘 맞아요.\n상대가 반응하면 바로 깊게 파고들기보다 그 리듬을 조금 더 이어가 보세요.\n오늘은 부담 없는 시작이 관계를 더 부드럽게 열어 줄 수 있어요.'
    },
    1: {
      tone: '말과 행동으로 흐름을 만들어 낼 수 있는 날이에요.',
      detail: '오늘은 가만히 기다리기보다 작은 한마디가 분위기를 바꿀 수 있어요.\n상대도 신호가 오면 반응할 준비가 어느 정도 되어 있는 흐름이에요.\n질문자님이 어떻게 말을 여느냐에 따라 온도가 꽤 빠르게 달라질 수 있어요.\n오늘은 애매하게 떠보기보다 분명하지만 가볍게 표현하는 쪽이 잘 맞아요.',
      person: '상대는 오늘 질문자님의 말과 태도에 민감하게 반응할 수 있어요.\n먼저 움직일 계기만 생기면 생각보다 빠르게 대화에 올라탈 가능성이 있어요.\n마음을 오래 숨기기보다 상황이 맞으면 자연스럽게 반응이 나오는 쪽이에요.\n다만 분위기를 주도하려는 기질도 있어서 말의 흐름을 잘 잡는 게 중요해요.',
      caution: '오늘은 말을 너무 돌려 하면 오히려 의도가 흐려질 수 있어요.\n상대가 눈치를 보게 만들기보다, 질문자님이 원하는 온도를 담백하게 보여 주는 게 좋아요.\n다만 확답을 강하게 요구하면 주도권 싸움처럼 느껴질 수 있어요.\n선명하되 가볍게, 이 균형이 중요해요.',
      advice: '오늘은 먼저 짧게 말을 열어 봐도 괜찮아요.\n상대가 답하기 쉬운 질문이나 일상적인 이야기가 좋아요.\n반응이 오면 바로 결론을 묻지 말고 대화의 템포를 이어가 보세요.\n질문자님이 분위기를 잘 잡으면 온도가 자연스럽게 올라갈 수 있어요.'
    },
    6: {
      tone: '서로를 의식하는 마음이 비교적 선명한 날이에요.',
      detail: '오늘은 둘 사이에 끌림과 선택의 감각이 함께 올라와요.\n상대도 질문자님을 완전히 지나치는 흐름은 아니고, 관계의 의미를 어느 정도 의식할 수 있어요.\n다만 마음이 선명한 만큼 작은 말에도 기대가 커질 수 있어요.\n오늘은 서로를 향한 호감이 살아 있지만, 분위기를 예쁘게 다루는 게 중요해요.',
      person: '상대는 오늘 질문자님을 볼 때 단순한 관심보다 조금 더 관계적인 감각을 느낄 수 있어요.\n같이 있을 때의 분위기나 말투를 신경 쓰고, 질문자님 반응도 꽤 의식하는 모습이에요.\n마음이 아예 없는 사람처럼 무심하게 지나가긴 어려운 흐름이에요.\n다만 표현 방식은 상황에 따라 조심스러울 수 있어요.',
      caution: '오늘은 좋은 온도가 있는 만큼 확인 욕구도 커질 수 있어요.\n상대의 마음을 당장 듣고 싶어도 너무 직접적으로 몰아가면 분위기가 부담스러워질 수 있어요.\n좋은 신호를 받았을 때 바로 결론을 요구하기보다 조금 더 머물러 주세요.\n호감은 재촉보다 여유 안에서 더 잘 드러나요.',
      advice: '오늘은 다정하고 자연스러운 리액션이 좋아요.\n상대가 편하게 웃거나 말할 수 있도록 부드럽게 받아 주세요.\n질문자님도 마음을 숨기기보다 따뜻한 태도를 조금 보여 주면 좋아요.\n오늘은 서로에게 좋은 인상을 남기는 쪽으로 움직이는 게 가장 잘 맞아요.'
    },
    9: {
      tone: '마음이 밖으로 빠르게 나오기보다 안쪽에서 조용히 정리되는 날이에요.',
      detail: '오늘은 온도가 낮다기보다 표현이 조용한 쪽에 가까워요.\n상대가 질문자님을 생각하지 않는 흐름이라기보다, 자기 안에서 한 번 더 살피는 모습이 강해요.\n반응이 크지 않아도 속으로는 꽤 많은 생각이 오갈 수 있어요.\n오늘은 빠른 확인보다 여백과 침착함이 더 잘 맞아요.',
      person: '상대는 오늘 적극적으로 드러내기보다 관찰하는 태도를 보일 수 있어요.\n마음이 없는 사람처럼 차갑다기보다, 자기 감정을 쉽게 말로 꺼내지 않는 쪽이에요.\n질문자님이 너무 밀고 들어오면 더 조용해질 수 있어요.\n반대로 편안한 공기가 생기면 조금씩 속마음을 보여 줄 가능성이 있어요.',
      caution: '오늘은 침묵을 곧바로 거절로 받아들이지 않는 게 좋아요.\n상대의 느린 반응을 해석하다 보면 질문자님 마음이 먼저 지칠 수 있어요.\n확답을 요구하면 상대는 더 깊이 들어가 버릴 수 있어요.\n기다림이 필요한 온도라는 걸 인정하는 편이 안전해요.',
      advice: '오늘은 긴 질문보다 짧고 편한 말을 남겨 보세요.\n상대가 혼자 정리할 공간을 남겨 주는 게 좋아요.\n대답이 늦어도 바로 의미를 붙이지 말고 조금 더 지켜보세요.\n잔잔한 태도가 오히려 상대를 편하게 만들 수 있어요.'
    },
    12: {
      tone: '움직이고 싶어도 쉽게 움직이지 못하는 정체감이 있는 날이에요.',
      detail: '오늘은 마음이 없어서 멈춘다기보다 상황이나 생각 때문에 속도가 느려질 수 있어요.\n서로의 온도가 아예 끊긴 흐름은 아니지만, 바로 행동으로 이어지긴 어려워요.\n상대도 어떤 반응이 맞는지 재고 있을 가능성이 있어요.\n오늘은 조급하게 밀기보다 흐름이 풀릴 시간을 주는 게 좋아요.',
      person: '상대는 오늘 마음이 있어도 바로 움직이지 못하는 모습으로 보일 수 있어요.\n답답하게 느껴질 수 있지만, 그 안에는 고민이나 부담도 함께 있어요.\n질문자님을 향한 감정이 완전히 사라졌다기보다 표현의 타이밍을 못 잡는 쪽이에요.\n그래서 반응이 애매해도 너무 빨리 단정하지 않는 게 좋아요.',
      caution: '오늘은 움직임을 억지로 만들려고 하면 더 굳어질 수 있어요.\n질문자님이 답답해서 재촉하면 상대는 부담을 더 크게 느낄 수 있어요.\n지금은 관계를 당겨오기보다 잠시 각자의 생각을 정리하는 시간이 필요해요.\n멈춤을 실패로 보지 않는 게 중요해요.',
      advice: '오늘은 기다림을 전략처럼 써 보세요.\n연락을 한다면 짧고 부담 없는 말이 좋아요.\n답을 요구하지 않는 태도가 상대를 편하게 만들 수 있어요.\n흐름이 풀리면 그때 조금 더 자연스럽게 가까워질 여지가 있어요.'
    },
    13: {
      tone: '예전 방식이 끝나고 새로운 태도로 넘어가야 하는 날이에요.',
      detail: '오늘은 익숙했던 패턴을 그대로 반복하면 온도가 쉽게 올라가지 않아요.\n마음이 완전히 끝났다는 뜻보다, 지금의 방식으로는 더 이상 자연스럽게 흐르기 어렵다는 신호에 가까워요.\n관계의 공기를 바꾸려면 말투나 접근 방식도 달라져야 해요.\n오늘은 과거를 붙잡기보다 새로운 흐름을 만드는 쪽이 중요해요.',
      person: '상대는 오늘 이전과 같은 반응을 보이지 않을 수 있어요.\n그 변화가 꼭 마음이 사라졌다는 뜻은 아니지만, 관계를 다르게 보고 있는 건 맞아요.\n익숙한 방식으로 다가가면 상대가 부담을 느낄 수 있어요.\n새로운 태도와 여백이 있어야 다시 온도가 살아날 수 있어요.',
      caution: '오늘은 예전처럼 하면 통할 거라는 기대를 내려놓는 게 좋아요.\n상대의 변화를 거부하면 질문자님 마음만 더 힘들어질 수 있어요.\n끝난 감정보다 바뀌어야 할 방식에 초점을 맞춰 보세요.\n관계를 살리고 싶다면 먼저 분위기의 방향을 바꾸는 게 필요해요.',
      advice: '오늘은 오래된 말을 반복하기보다 새롭게 시작하는 태도가 좋아요.\n가볍고 담백하게, 이전의 서운함을 모두 꺼내지 않는 쪽이 안전해요.\n질문자님이 달라진 공기를 보여 주면 상대도 다시 반응할 여지가 생겨요.\n작은 변화가 오늘의 온도를 다시 움직일 수 있어요.'
    },
    16: {
      tone: '갑작스러운 말이나 감정이 온도를 크게 흔들 수 있는 날이에요.',
      detail: '오늘은 관계의 공기가 예민해서 작은 자극도 크게 번질 수 있어요.\n상대도 마음이 없어서가 아니라 당황하거나 방어적으로 반응할 가능성이 있어요.\n숨겨진 감정이 갑자기 튀어나오면 분위기가 흔들릴 수 있어요.\n오늘은 진실을 확인하는 것보다 충돌을 줄이는 게 먼저예요.',
      person: '상대는 오늘 안정적으로 반응하기보다 순간적으로 예민해질 수 있어요.\n갑자기 말을 세게 하거나, 반대로 피하는 모습이 나올 수 있어요.\n그 반응만으로 마음 전체를 판단하면 오해가 커질 수 있어요.\n지금은 상대도 감정을 정리할 시간이 필요한 흐름이에요.',
      caution: '오늘은 쌓인 말을 한꺼번에 터뜨리지 않는 게 좋아요.\n확인하려는 말이 추궁처럼 들리면 관계 온도가 더 흔들릴 수 있어요.\n상대의 반응이 거칠어도 바로 맞받아치지 마세요.\n불안한 날일수록 말의 강도를 낮추는 게 중요해요.',
      advice: '오늘은 대화를 짧고 차분하게 가져가세요.\n감정이 올라오면 바로 보내지 말고 한 번 더 다듬어 보세요.\n상대가 예민하게 반응해도 질문자님은 속도를 낮추는 쪽이 좋아요.\n충돌을 피하는 것만으로도 온도를 지킬 수 있어요.'
    },
    17: {
      tone: '잔잔한 기대와 회복의 온기가 남아 있는 날이에요.',
      detail: '오늘은 확 뜨겁게 밀어붙이는 흐름보다 조용히 좋아지는 기운이 강해요.\n상대도 질문자님과의 가능성을 완전히 닫아 둔 모습은 아니에요.\n다만 바로 큰 표현을 하기보다 천천히 믿음을 회복하려는 쪽이에요.\n오늘은 작은 희망을 오래 지켜 가는 태도가 잘 맞아요.',
      person: '상대는 오늘 질문자님을 떠올릴 때 차갑게 끊어내기보다 부드럽게 남겨 두는 모습이에요.\n마음의 속도는 느려도 호의나 기대가 완전히 꺼진 흐름은 아니에요.\n대화가 편안하면 다시 연결될 여지를 느낄 수 있어요.\n다만 너무 급하게 확답을 요구하면 그 온기가 사라질 수 있어요.',
      caution: '오늘은 기대가 생겨도 현실보다 앞서가진 않는 게 좋아요.\n좋은 상상만으로 결론을 만들면 작은 반응에 크게 흔들릴 수 있어요.\n상대도 아직 확신을 다 드러내기 전일 수 있어요.\n천천히 확인하는 마음이 오늘의 온도를 더 안정적으로 지켜 줘요.',
      advice: '오늘은 다정한 말 한마디를 조용히 남겨 보세요.\n상대가 부담 없이 받아들일 수 있는 온도가 좋아요.\n큰 고백보다 따뜻한 관심이 더 오래 남을 수 있어요.\n질문자님이 안정된 태도를 보여 주면 흐름이 부드럽게 이어질 수 있어요.'
    },
    18: {
      tone: '불안과 상상이 실제 온도보다 크게 느껴질 수 있는 날이에요.',
      detail: '오늘은 둘 사이가 실제보다 더 애매하거나 차갑게 느껴질 수 있어요.\n상대의 반응이 분명하지 않으면 질문자님 마음속에서 여러 해석이 커질 수 있어요.\n하지만 그 불안이 곧 관계의 결론은 아니에요.\n오늘은 마음보다 확인되지 않은 생각이 분위기를 흔들기 쉬워요.',
      person: '상대는 오늘 마음을 명확하게 보여 주기보다 흐릿하게 반응할 수 있어요.\n말의 의도가 헷갈리거나, 가까워졌다가 멀어지는 듯한 느낌이 있을 수 있어요.\n상대도 자기 감정을 완전히 정리하지 못했을 가능성이 있어요.\n그래서 오늘은 반응 하나로 확정하기 어려운 날이에요.',
      caution: '오늘은 추측을 사실처럼 믿지 않는 게 가장 중요해요.\n상대가 늦거나 애매하게 반응해도 바로 부정적으로 결론내리면 마음이 더 흔들려요.\n불안해서 확인하려는 말은 오히려 분위기를 무겁게 만들 수 있어요.\n확실하지 않은 것은 잠시 보류해 주세요.',
      advice: '오늘은 깊은 확인보다 편안한 분위기를 먼저 만들어 보세요.\n상대의 마음을 캐묻기보다 가벼운 말로 공기를 열어 주세요.\n질문자님도 불안한 마음을 바로 대화에 싣지 않는 게 좋아요.\n조금 시간이 지나면 지금보다 더 선명하게 보일 수 있어요.'
    },
    19: {
      tone: '밝고 따뜻한 반응이 비교적 잘 살아나는 날이에요.',
      detail: '오늘은 감정이 숨기기보다 자연스럽게 드러나기 쉬워요.\n상대도 질문자님을 볼 때 좋은 인상이나 편안함을 느낄 가능성이 커요.\n대화가 시작되면 분위기가 밝게 풀릴 수 있어요.\n오늘은 관계 온도를 올리기 좋은 날에 가까워요.',
      person: '상대는 오늘 질문자님에게 비교적 솔직하고 밝게 반응할 수 있어요.\n표정이나 말투에서 좋은 느낌이 새어 나올 가능성이 있어요.\n마음을 복잡하게 숨기기보다 분위기 그대로 따뜻하게 받아들이는 쪽이에요.\n질문자님도 너무 어렵게 생각하지 않아도 되는 흐름이에요.',
      caution: '좋은 흐름이라고 해서 모든 답이 한 번에 정리되는 건 아니에요.\n너무 기대를 크게 걸면 작은 흔들림에도 실망할 수 있어요.\n상대의 밝은 반응을 압박으로 바꾸지 않는 게 중요해요.\n좋은 날일수록 가볍고 자연스럽게 이어 가세요.',
      advice: '오늘은 먼저 웃을 수 있는 말을 건네 보세요.\n긍정적인 리액션이 관계 온도를 더 올려 줄 수 있어요.\n상대가 반응하면 질문자님도 따뜻하게 받아 주세요.\n오늘은 편안하게 즐기는 태도가 가장 잘 맞아요.'
    }
  };

  const majorProfile = majorProfiles[id];
  if (card.type === 'major' && majorProfile) {
    return reversed
      ? {
          tone: majorProfile.tone,
          detail: `${majorProfile.detail}\n다만 오늘은 그 온기가 바로 크게 드러나기보다 조금 천천히 표현될 수 있어요.\n마음이 없다는 뜻보다는 확신이나 타이밍을 조금 더 살피는 흐름에 가까워요.`,
          person: `${majorProfile.person}\n상대의 표현이 일정하지 않아도 마음 자체를 바로 부정할 필요는 없어요.`,
          caution: `오늘은 좋은 의도도 너무 서두르면 부담으로 느껴질 수 있어요.\n${majorProfile.caution}`,
          advice: `속도를 조금 낮추고 말의 온도를 부드럽게 조절해 보세요.\n${majorProfile.advice}`
        }
      : majorProfile;
  }

  if (card.suit === 'wands') {
    const profiles: Record<number, DailyTemperatureCardProfile> = {
      1: {
        tone: '새로운 끌림이나 먼저 움직이고 싶은 마음이 피어나는 날이에요.',
        detail: '오늘은 감정이 아주 오래 묵혀지기보다 작은 행동으로 시작될 수 있어요.\n상대도 질문자님에게 호기심이나 설렘을 느끼면 티가 조금 날 수 있어요.\n아직 깊게 자리 잡은 온도라기보다 막 불이 붙기 시작하는 느낌이에요.\n가벼운 계기만 있어도 분위기가 살아날 수 있어요.',
        person: '상대는 오늘 질문자님에게 새롭게 반응하거나 먼저 신호를 보내고 싶어질 수 있어요.\n표현이 아주 완성되어 있진 않아도, 호기심과 설렘은 비교적 솔직하게 움직일 수 있어요.\n마음이 복잡하게 숨는 흐름보다는 시작하려는 힘이 더 강해요.\n다만 아직 오래 지속될지까지는 더 지켜봐야 해요.',
        caution: '처음 붙는 불꽃을 너무 빨리 큰 감정으로 단정하지 마세요.\n상대가 적극적으로 보여도 아직은 시작 단계일 수 있어요.\n질문자님이 너무 큰 의미를 얹으면 오히려 부담이 생길 수 있어요.\n오늘은 시작의 가벼움을 지키는 게 좋아요.',
        advice: '짧고 밝은 말로 접점을 만들어 보세요.\n상대가 반응하면 바로 깊게 묻지 말고 그 분위기를 조금 더 이어가세요.\n오늘은 작게 시작하는 움직임이 가장 잘 맞아요.\n가벼운 호감의 불씨를 꺼뜨리지 않는 게 중요해요.'
      },
      2: {
        tone: '다음 단계를 생각하며 서로의 거리를 재는 날이에요.',
        detail: '오늘은 감정이 없어서 멈춘다기보다 앞으로 어떻게 움직일지 살피는 흐름이에요.\n상대도 질문자님과의 가능성을 계산하거나, 다음 행동을 고민할 수 있어요.\n바로 달려오기보다는 방향을 정하려는 기운이 강해요.\n온도는 살아 있지만 아직 선택과 타이밍이 중요해요.',
        person: '상대는 오늘 질문자님을 보며 한 걸음 더 갈지, 지금 거리를 유지할지 생각할 수 있어요.\n마음이 아예 없는 흐름은 아니지만 행동으로 바로 나오기 전 준비 단계에 가까워요.\n먼저 움직일 명분이나 안정감이 있으면 반응이 달라질 수 있어요.\n질문자님이 어떤 태도를 보이는지도 꽤 의식하는 날이에요.',
        caution: '오늘은 상대가 고민하는 시간을 너무 답답하게 몰아붙이지 않는 게 좋아요.\n방향을 정하기 전에 압박을 받으면 오히려 뒤로 물러날 수 있어요.\n기대는 남기되 선택을 강요하지 마세요.\n관계의 다음 장면은 여유 안에서 더 잘 열려요.',
        advice: '상대가 움직이기 쉬운 작은 계기를 만들어 보세요.\n가볍게 가능성을 열어 두는 말이 좋아요.\n지금 당장 확답을 묻기보다 자연스럽게 다음 대화로 이어질 여지를 남겨 보세요.\n오늘은 방향을 예쁘게 제안하는 태도가 잘 맞아요.'
      },
      3: {
        tone: '기다리던 흐름이 조금씩 앞으로 열릴 수 있는 날이에요.',
        detail: '오늘은 둘 사이의 온도가 멈춰 있기보다 바깥으로 확장되는 느낌이 있어요.\n상대도 질문자님과의 가능성을 이전보다 넓게 볼 수 있어요.\n다만 바로 눈앞의 답보다 앞으로 이어질 분위기가 더 중요해요.\n기대가 생기더라도 천천히 확인하는 쪽이 좋아요.',
        person: '상대는 오늘 질문자님과의 흐름을 완전히 닫기보다 조금 더 지켜보고 싶어 할 수 있어요.\n말이나 행동이 즉각적이지 않아도 장기적으로 가능성을 보는 느낌이 있어요.\n반응은 멀리서 오는 것처럼 느릴 수 있지만 방향 자체는 나쁘지 않아요.\n관계가 조금씩 펼쳐지는 장면에 가까워요.',
        caution: '오늘은 기다리는 마음이 커져서 답이 늦으면 불안해질 수 있어요.\n하지만 지금은 바로 결과를 확인하기보다 흐름이 오고 있는지 보는 게 더 중요해요.\n작은 지연을 관계의 부정으로 보지 마세요.\n기대와 조급함을 구분하는 게 좋아요.',
        advice: '오늘은 다음을 기약할 수 있는 말을 남겨 보세요.\n가볍게 이어질 여지를 만들면 상대도 부담 없이 반응할 수 있어요.\n당장 답을 받으려 하기보다 좋은 방향을 열어 두는 태도가 좋아요.\n관계의 시야를 조금 넓게 보는 게 도움이 돼요.'
      },
      4: {
        tone: '편안함과 안정감이 살아나기 좋은 날이에요.',
        detail: '오늘은 둘 사이가 거칠게 흔들리기보다 편안한 온도를 만들기 쉬워요.\n상대도 질문자님과 있을 때 부담보다 안정감을 느낄 수 있어요.\n서로 웃거나 자연스럽게 이야기를 나누는 장면이 잘 맞아요.\n오늘은 큰 확인보다 좋은 분위기를 함께 만드는 게 중요해요.',
        person: '상대는 오늘 질문자님에게 안정적이고 편한 반응을 보일 수 있어요.\n특별히 과장된 표현은 아니어도, 같이 있을 때의 분위기를 좋게 느낄 가능성이 커요.\n마음이 급하게 튀어나오기보다 편안함으로 드러나는 쪽이에요.\n따뜻한 공기가 오래 남을 수 있는 흐름이에요.',
        caution: '좋은 분위기라고 해서 바로 관계를 확정하려고 하면 부담이 생길 수 있어요.\n오늘은 편안함 자체를 즐기는 게 더 좋아요.\n상대가 안정감을 느끼는 동안 질문자님도 조급함을 내려놓아야 해요.\n화목한 온도를 무거운 질문으로 바꾸지 마세요.',
        advice: '오늘은 편하게 웃고 이야기할 수 있는 자리를 만들어 보세요.\n가벼운 칭찬이나 다정한 리액션이 잘 맞아요.\n상대가 편안함을 느끼면 마음도 자연스럽게 더 열릴 수 있어요.\n오늘은 안정감을 주는 태도가 가장 좋아요.'
      },
      5: {
        tone: '서로의 자존심이나 신경전이 온도를 흔들 수 있는 날이에요.',
        detail: '오늘은 마음이 없어서라기보다 서로 지지 않으려는 기운이 생길 수 있어요.\n상대도 질문자님에게 관심이 있어도 말투가 삐딱하거나 경쟁적으로 나올 수 있어요.\n작은 말이 장난처럼 시작돼도 감정이 섞이면 쉽게 예민해질 수 있어요.\n온도는 살아 있지만 다루는 방식이 거칠어질 수 있는 날이에요.',
        person: '상대는 오늘 질문자님에게 반응이 빠를 수 있지만 부드럽지만은 않을 수 있어요.\n관심이 있어도 장난, 반박, 자존심 섞인 태도로 드러날 가능성이 있어요.\n질문자님을 밀어내기보다 자신의 존재감을 보이고 싶어 하는 쪽에 가까워요.\n다만 말투가 세게 느껴질 수 있어요.',
        caution: '오늘은 말싸움으로 번지지 않게 조심해야 해요.\n상대의 반응에 바로 맞받아치면 온도가 뜨겁게 올라가도 좋은 방향은 아닐 수 있어요.\n자존심을 확인하려 들면 둘 다 피곤해질 수 있어요.\n가벼운 농담도 선을 넘지 않게 봐 주세요.',
        advice: '오늘은 반박보다 웃고 넘기는 여유가 좋아요.\n상대가 살짝 날카롭게 나와도 감정적으로 받아치지 말고 분위기를 부드럽게 돌려 보세요.\n말을 짧게 정리하면 신경전이 줄어들어요.\n질문자님이 여유를 보이면 관계 온도도 덜 거칠어져요.'
      },
      6: {
        tone: '상대가 자신감 있게 반응하거나 눈에 띄게 다가올 수 있는 날이에요.',
        detail: '오늘은 마음이 안쪽에만 머무르기보다 겉으로 드러날 가능성이 있어요.\n상대도 질문자님 앞에서 좋은 모습을 보이고 싶어 할 수 있어요.\n칭찬받고 싶거나 인정받고 싶은 기운이 섞여 있어서 반응이 비교적 선명할 수 있어요.\n온도는 살아 있고, 분위기도 꽤 밝게 움직일 수 있어요.',
        person: '상대는 오늘 질문자님에게 당당하게 보이고 싶어 할 수 있어요.\n먼저 말하거나, 자기 장점을 보여 주거나, 은근히 주도권을 잡으려는 모습이 나올 수 있어요.\n마음을 숨기고 느리게 재는 흐름보다는 자신감을 드러내는 쪽이에요.\n질문자님 반응을 통해 확신을 얻고 싶어 할 수도 있어요.',
        caution: '오늘은 상대의 자신감이 자칫 자존심처럼 보일 수 있어요.\n칭찬받고 싶은 마음을 무시하면 분위기가 살짝 굳을 수 있어요.\n다만 상대가 주도권을 잡으려 해도 질문자님이 너무 끌려가진 마세요.\n좋은 반응과 과한 자존심을 구분하는 게 좋아요.',
        advice: '오늘은 좋은 부분을 가볍게 인정해 주는 말이 잘 맞아요.\n상대가 뭔가 보여 주려 한다면 너무 무심하게 넘기지 말고 짧게 반응해 주세요.\n질문자님도 자신감 있는 태도를 유지하면 균형이 좋아져요.\n밝고 당당한 온도로 대화를 이어가 보세요.'
      },
      7: {
        tone: '방어적이지만 쉽게 물러나지 않는 기운이 강한 날이에요.',
        detail: '오늘은 상대가 마음이 없어서라기보다 자기 입장을 지키려는 모습이 강해질 수 있어요.\n질문자님에게 관심이 있어도 바로 부드럽게 열리기보다 경계와 의지가 같이 보일 수 있어요.\n관계 온도는 살아 있지만 다가가는 방식이 조금 빡빡하게 느껴질 수 있어요.\n상대의 방어를 정면으로 밀면 더 단단해질 수 있어요.',
        person: '상대는 오늘 쉽게 져 주거나 순하게 따라오는 흐름은 아니에요.\n자기 생각을 지키고 싶어 하고, 질문자님 반응도 조심스럽게 살필 수 있어요.\n마음을 숨긴다기보다 쉽게 밀리지 않으려는 태도에 가까워요.\n그래도 관심이 완전히 없으면 이렇게 신경 쓰는 흐름도 잘 나오지 않아요.',
        caution: '오늘은 상대를 설득하려고 세게 밀어붙이면 역효과가 날 수 있어요.\n상대가 방어적으로 나올 때 질문자님도 같이 날을 세우면 관계 온도가 거칠어져요.\n이기고 지는 대화로 만들지 않는 게 중요해요.\n상대의 입장을 인정하면서 천천히 풀어야 해요.',
        advice: '오늘은 부드럽지만 분명한 태도가 좋아요.\n상대가 경계해도 공격으로 받아들이지 말고 차분하게 말해 보세요.\n짧고 안정적인 표현이 오히려 더 잘 닿을 수 있어요.\n질문자님이 여유를 잃지 않으면 상대의 방어도 조금씩 풀릴 수 있어요.'
      },
      8: {
        tone: '연락이나 분위기가 빠르게 움직일 수 있는 날이에요.',
        detail: '오늘은 반응이 느리게 묵히기보다 갑자기 빠르게 오갈 가능성이 커요.\n상대도 마음이 움직이면 생각보다 즉각적으로 표현할 수 있어요.\n메시지, 약속, 짧은 대화처럼 속도감 있는 흐름이 잘 맞아요.\n온도는 한 번 움직이기 시작하면 빠르게 올라갈 수 있어요.',
        person: '상대는 오늘 질문자님에게 빠른 반응을 보일 수 있어요.\n오래 고민해서 숨기기보다 순간의 타이밍을 타고 움직이는 쪽이에요.\n답장이나 말투가 가볍게 튀어나올 수 있고, 갑작스러운 제안도 가능해요.\n다만 속도가 빠른 만큼 깊이까지 바로 확정하긴 어려워요.',
        caution: '오늘은 속도가 빠른 만큼 말실수나 오해도 빨리 생길 수 있어요.\n상대가 즉각적으로 반응한다고 해서 모든 게 결정된 건 아니에요.\n반대로 답이 빨리 안 온다고 해도 흐름이 완전히 끊긴 건 아닐 수 있어요.\n속도에 휘둘리지 말고 내용의 온도를 같이 봐 주세요.',
        advice: '오늘은 타이밍을 놓치지 않는 게 좋아요.\n가볍게 연락하거나 짧게 반응하면 흐름이 잘 이어질 수 있어요.\n다만 긴 설명보다 간단하고 선명한 말이 더 잘 맞아요.\n대화가 열리면 자연스럽게 다음 말로 이어가 보세요.'
      },
      9: {
        tone: '마음은 남아 있지만 조심스럽게 경계하는 날이에요.',
        detail: '오늘은 관심이 꺼진 흐름이라기보다 지난 피로감이나 상처 때문에 조심스러워지는 온도예요.\n상대도 질문자님을 의식하지만 쉽게 무장 해제되지는 않을 수 있어요.\n반응이 있어도 한쪽 발은 뒤로 빼고 있는 느낌이 섞일 수 있어요.\n온도를 올리려면 안전하다는 느낌이 먼저 필요해요.',
        person: '상대는 오늘 질문자님에게 완전히 무심하진 않지만 경계심이 섞인 태도를 보일 수 있어요.\n먼저 움직이고 싶어도 다시 다칠까 봐 조심할 수 있어요.\n말투가 짧거나 단단해 보여도 안쪽에는 신경 쓰는 마음이 남아 있을 수 있어요.\n지금은 밀어붙이기보다 안심시키는 쪽이 중요해요.',
        caution: '오늘은 상대의 경계를 무너뜨리려고 강하게 들어가면 더 닫힐 수 있어요.\n질문자님이 답답해도 상대의 조심스러움을 인정해야 해요.\n상처나 피로가 남아 있는 흐름에서는 재촉이 가장 위험해요.\n오늘은 관계를 빨리 확인하기보다 안전한 공기를 만드는 게 좋아요.',
        advice: '오늘은 부드러운 안부가 가장 좋아요.\n상대가 부담을 느끼지 않을 만큼 짧고 안정적으로 다가가세요.\n대답이 느리더라도 바로 실망하지 말고, 조금 더 여유를 주세요.\n안전하다는 느낌이 생기면 상대도 조금씩 풀릴 수 있어요.'
      },
      10: {
        tone: '마음보다 부담과 책임감이 크게 느껴질 수 있는 날이에요.',
        detail: '오늘은 감정이 없어서라기보다 관계를 생각할수록 무거워지는 흐름이에요.\n상대도 질문자님을 신경 쓰지만 현실적인 부담이나 피로 때문에 가볍게 반응하지 못할 수 있어요.\n온도는 완전히 꺼졌다기보다 짐을 진 채로 느리게 움직이는 느낌이에요.\n오늘은 덜어 주는 태도가 필요해요.',
        person: '상대는 오늘 질문자님에게 마음이 있어도 여유가 부족해 보일 수 있어요.\n답장을 하거나 다가가는 일조차 하나의 부담처럼 느낄 수 있어요.\n무심해서가 아니라 자기 안의 무게가 큰 상태일 가능성이 있어요.\n그래서 반응이 늦거나 피곤하게 느껴질 수 있어요.',
        caution: '오늘은 상대에게 더 많은 설명이나 결정을 요구하면 부담이 커질 수 있어요.\n질문자님도 혼자 너무 많은 의미를 짊어지지 않는 게 좋아요.\n관계를 살리려는 마음이 과해지면 오히려 둘 다 지칠 수 있어요.\n오늘은 무게를 줄이는 방향이 맞아요.',
        advice: '오늘은 가볍고 짧은 말로 부담을 낮춰 주세요.\n상대가 답하기 쉬운 한마디가 좋아요.\n필요하다면 오늘은 쉬어 가도 괜찮아요.\n온도를 올리려 하기보다 지치지 않게 지키는 게 더 중요해요.'
      },
      11: {
        tone: '서툴지만 밝은 호기심이 살아나는 날이에요.',
        detail: '오늘은 감정이 완성된 고백처럼 나오기보다 귀엽고 서툰 신호로 드러날 수 있어요.\n상대도 질문자님에게 관심이 생기면 조심스럽게 말을 걸거나 반응을 살필 가능성이 있어요.\n표현은 조금 어색해도 온도는 밝은 쪽이에요.\n작은 장난이나 가벼운 대화가 잘 맞아요.',
        person: '상대는 오늘 질문자님에게 어린아이처럼 호기심 어린 반응을 보일 수 있어요.\n잘 보이고 싶지만 표현이 매끄럽진 않을 수 있어요.\n마음을 무겁게 숨기는 흐름보다, 서툴게 티가 나는 쪽에 가까워요.\n질문자님이 편하게 받아 주면 더 밝게 열릴 수 있어요.',
        caution: '서툰 표현을 가볍게 무시하면 상대가 금방 머쓱해질 수 있어요.\n오늘은 완벽한 태도를 기대하기보다 작은 관심을 알아봐 주는 게 좋아요.\n다만 장난이 과해지면 진심이 흐려질 수 있으니 선은 지켜야 해요.\n가볍지만 따뜻하게 받아 주세요.',
        advice: '오늘은 상대의 작은 신호에 웃으며 반응해 보세요.\n짧은 농담이나 귀여운 리액션이 잘 맞아요.\n질문자님이 편한 분위기를 만들어 주면 상대도 더 쉽게 다가올 수 있어요.\n서툰 시작을 예쁘게 키워 가는 날이에요.'
      },
      12: {
        tone: '감정이 오래 머물기보다 빠르게 행동으로 튀어나오기 쉬운 날이에요.',
        detail: '오늘은 상대가 마음을 숨기고 오래 재는 흐름이 아니에요.\n분위기가 맞으면 갑자기 다가오거나 반응이 빨라질 수 있어요.\n뜨겁고 솔직한 온도가 살아 있지만, 그만큼 오래 고민하고 조심스럽게 다듬는 느낌은 약해요.\n오늘은 속도감과 충동성이 함께 움직이는 날이에요.',
        person: '상대는 오늘 질문자님에게 적극적으로 보일 수 있어요.\n먼저 연락하거나, 갑자기 제안하거나, 말보다 행동으로 다가올 가능성이 있어요.\n마음을 바로 티 내지 않는 사람처럼 느리게 굴기보다는 순간의 끌림을 따라 움직이는 쪽이에요.\n다만 뜨거운 반응이 곧 깊은 안정감까지 보장하는 건 아니에요.',
        caution: '오늘은 상대의 빠른 반응에 질문자님 마음도 같이 급해질 수 있어요.\n적극적인 태도가 반갑더라도 너무 빨리 모든 결론을 내리지는 마세요.\n뜨거운 온도는 좋지만 속도가 과하면 금방 피곤해질 수 있어요.\n한 번의 강한 반응보다 이후의 지속성을 같이 봐야 해요.',
        advice: '오늘은 상대가 움직이면 자연스럽게 받아 주되, 질문자님 중심도 잃지 마세요.\n가벼운 만남이나 짧은 대화는 잘 맞지만, 중요한 확인은 조금 천천히 해도 좋아요.\n상대의 빠른 에너지에 휩쓸리기보다 즐겁게 속도를 조절해 보세요.\n뜨거움은 살리고 부담은 줄이는 게 포인트예요.'
      },
      13: {
        tone: '매력과 자신감이 잘 드러나는 따뜻한 날이에요.',
        detail: '오늘은 둘 사이에 활기와 호감이 비교적 선명하게 살아나요.\n상대도 질문자님의 매력이나 존재감을 쉽게 의식할 수 있어요.\n대화가 열리면 밝고 자연스럽게 분위기가 올라갈 수 있어요.\n오늘은 자신감 있는 태도가 온도를 예쁘게 올려 줘요.',
        person: '상대는 오늘 질문자님을 매력적으로 보거나 더 가까이 다가가고 싶어 할 수 있어요.\n반응이 숨겨진다기보다 표정이나 말투에서 어느 정도 드러날 가능성이 커요.\n다정함과 활기가 함께 느껴지는 흐름이에요.\n질문자님이 자기 매력을 편하게 보여 줄수록 상대도 더 끌릴 수 있어요.',
        caution: '오늘은 자신감이 과하면 상대가 조금 부담스럽게 느낄 수 있어요.\n매력은 충분히 살아 있으니 굳이 확인받으려 애쓰지 않아도 돼요.\n상대의 반응을 끌어내려고 과하게 밀면 흐름이 흐려질 수 있어요.\n자연스러운 여유를 유지하는 게 좋아요.',
        advice: '오늘은 질문자님답게 밝고 당당하게 움직여 보세요.\n상대에게 좋은 리액션을 주면서도 스스로의 분위기를 잃지 않는 게 좋아요.\n가벼운 칭찬이나 웃음이 잘 맞아요.\n오늘은 매력을 숨기기보다 편하게 드러내도 괜찮아요.'
      },
      14: {
        tone: '확실한 의지와 뜨거운 추진력이 느껴지는 날이에요.',
        detail: '오늘은 관계 온도가 흔들리기보다 한쪽에서 강하게 밀고 나가려는 기운이 있어요.\n상대도 마음이 움직이면 꽤 분명한 태도를 보일 수 있어요.\n다만 주도권과 자존심이 함께 작용해서 부드럽지만은 않을 수 있어요.\n뜨거운 온도를 안정적으로 쓰는 게 중요해요.',
        person: '상대는 오늘 질문자님에게 확실한 인상을 남기고 싶어 할 수 있어요.\n먼저 행동하거나 자기 생각을 분명히 말하는 모습이 나올 수 있어요.\n마음을 숨기기보다 주도적으로 끌고 가려는 쪽이에요.\n다만 자기 방식이 강해서 질문자님 속도를 놓칠 수 있어요.',
        caution: '오늘은 상대의 강한 태도에 휩쓸리지 않는 게 좋아요.\n뜨거운 흐름은 좋지만 질문자님의 기준도 같이 지켜야 해요.\n주도권 싸움이 되면 관계 온도가 거칠어질 수 있어요.\n분명하되 부드러운 균형을 잡아 주세요.',
        advice: '오늘은 당당하게 반응하되 말의 온도는 부드럽게 유지해 보세요.\n상대가 적극적으로 나오면 좋은 부분은 받아 주고, 부담스러운 부분은 가볍게 선을 잡아도 돼요.\n둘 다 뜨거워질 수 있는 날이라 여유가 중요해요.\n서로의 에너지를 좋은 방향으로 맞춰 보세요.'
      }
    };
    const base = profiles[value] || profiles[1];
    return reversed ? invertTemperatureProfile(base, 'wands') : base;
  }

  if (card.suit === 'cups') {
    const profiles: Record<number, DailyTemperatureCardProfile> = {
      1: {
        tone: '새로운 감정이 맑게 올라오는 날이에요.',
        detail: '오늘은 둘 사이에 부드러운 감정이 새롭게 피어날 수 있어요.\n상대도 질문자님을 향해 다정한 느낌이나 설렘을 느낄 가능성이 있어요.\n표현이 크지 않아도 마음의 결은 따뜻한 쪽이에요.\n오늘은 감정이 자연스럽게 흐를 수 있도록 편안함을 만들어 주는 게 좋아요.',
        person: '상대는 오늘 질문자님에게 순한 호감이나 다정한 관심을 느낄 수 있어요.\n마음을 차갑게 막기보다 부드럽게 받아들이는 흐름이에요.\n감정 표현이 서툴러도 속으로는 좋은 느낌이 올라올 수 있어요.\n질문자님이 따뜻하게 반응하면 더 쉽게 열릴 수 있어요.',
        caution: '오늘은 좋은 감정이 생긴다고 해서 바로 깊은 확답을 기대하지 않는 게 좋아요.\n새로운 온기는 조심스럽게 다뤄야 오래 가요.\n상대의 작은 다정함을 너무 크게 몰아가면 부담이 될 수 있어요.\n감정이 흐를 시간을 주세요.',
        advice: '오늘은 다정하고 편안한 말이 좋아요.\n상대가 마음을 열 수 있도록 부드럽게 받아 주세요.\n짧은 칭찬이나 따뜻한 리액션이 잘 맞아요.\n오늘은 질문보다 감정의 분위기를 살리는 게 더 중요해요.'
      },
      2: {
        tone: '서로 마주 보는 감정선이 살아나는 날이에요.',
        detail: '오늘은 둘 사이의 온도가 서로에게 닿기 쉬워요.\n상대도 질문자님의 반응을 의식하고, 마음을 맞춰 보고 싶어 할 수 있어요.\n대화가 잘 열리면 서로 비슷한 온도를 느낄 가능성이 커요.\n오늘은 관계가 부드럽게 가까워질 수 있는 흐름이에요.',
        person: '상대는 오늘 질문자님에게 호감이나 정서적 끌림을 비교적 분명하게 느낄 수 있어요.\n같이 있을 때 편안함과 설렘이 함께 올라오는 모습이에요.\n마음을 숨기기보다 눈빛이나 말투에서 조금씩 드러날 수 있어요.\n질문자님 반응도 중요하게 보는 날이에요.',
        caution: '좋은 온도일수록 기대가 커져서 작은 어긋남에도 서운해질 수 있어요.\n상대가 완벽하게 맞춰 주길 바라기보다 서로 맞춰 가는 흐름으로 봐 주세요.\n확답을 서두르면 예쁜 분위기가 부담이 될 수 있어요.\n오늘은 부드러운 균형이 중요해요.',
        advice: '오늘은 마음을 조금 보여 줘도 괜찮아요.\n상대가 편하게 다가올 수 있도록 따뜻하게 받아 주세요.\n서로의 말에 공감하고 리액션을 잘 해 주면 온도가 더 올라갈 수 있어요.\n오늘은 다정한 호흡을 맞추는 게 좋아요.'
      },
      3: {
        tone: '함께 있을 때 기분 좋은 온도가 살아나는 날이에요.',
        detail: '오늘은 무거운 확인보다 즐거운 분위기에서 관계 온도가 올라갈 수 있어요.\n상대도 질문자님과 편하게 웃고 이야기하는 장면을 좋게 느낄 가능성이 있어요.\n친근함과 호감이 섞여 있어서 대화가 가볍게 잘 흐를 수 있어요.\n오늘은 같이 즐거운 감각을 만드는 게 중요해요.',
        person: '상대는 오늘 질문자님에게 편안하고 밝은 반응을 보일 수 있어요.\n깊은 고백보다 같이 있을 때의 즐거움으로 마음이 드러날 가능성이 커요.\n친근한 말투나 장난 속에 호감이 섞일 수 있어요.\n질문자님과의 분위기를 좋게 기억할 수 있는 날이에요.',
        caution: '오늘은 가벼운 분위기가 좋아도 진심이 흐려지지 않게 조심해야 해요.\n장난이 너무 많으면 상대의 마음을 정확히 보기 어려울 수 있어요.\n또 주변 사람이나 상황이 끼어들면 둘만의 온도가 흩어질 수 있어요.\n즐거움 안에서도 서로의 반응을 살펴 주세요.',
        advice: '오늘은 즐겁고 부담 없는 대화가 잘 맞아요.\n웃을 수 있는 주제나 가벼운 제안을 해 보세요.\n상대가 편안하게 반응하면 그 분위기를 조금 더 이어가면 좋아요.\n오늘은 즐거움이 호감으로 이어질 수 있어요.'
      },
      4: {
        tone: '감정은 있지만 반응이 무덤덤하게 보일 수 있는 날이에요.',
        detail: '오늘은 온도가 아주 차갑다기보다 마음이 정체되어 표현이 덜 나오는 흐름이에요.\n상대도 질문자님에게 무언가 느끼면서도 쉽게 반응하지 않을 수 있어요.\n호의가 와도 바로 받아들이기보다 혼자 생각에 잠기는 느낌이 있어요.\n오늘은 감정을 억지로 끌어내기보다 분위기를 가볍게 풀어야 해요.',
        person: '상대는 오늘 질문자님을 싫어해서 조용한 게 아니라, 자기 감정에 둔감하거나 피곤해져 있을 수 있어요.\n다정한 신호가 와도 반응이 늦거나 심심하게 보일 수 있어요.\n마음이 아예 없는 흐름은 아니지만 적극성은 낮아요.\n질문자님이 편하게 열어 주면 조금씩 반응이 살아날 수 있어요.',
        caution: '오늘은 상대의 무덤덤함을 바로 거절로 받아들이지 않는 게 좋아요.\n다만 계속 확인하려 들면 상대가 더 닫힐 수 있어요.\n좋은 말을 해도 반응이 작을 수 있으니 질문자님 마음이 먼저 지치지 않게 조절하세요.\n오늘은 기대를 조금 낮추는 게 안전해요.',
        advice: '오늘은 짧고 가벼운 말로 분위기를 환기해 보세요.\n상대가 크게 반응하지 않아도 바로 실망하지 않는 게 좋아요.\n깊은 감정 질문보다 일상적인 접점이 더 잘 맞아요.\n편안함이 쌓이면 온도가 조금씩 살아날 수 있어요.'
      },
      5: {
        tone: '아쉬움이나 서운함이 온도를 낮출 수 있는 날이에요.',
        detail: '오늘은 마음이 없어서라기보다 실망이나 후회가 먼저 떠오를 수 있어요.\n상대도 질문자님에게 남은 감정이 있어도 그것을 밝게 표현하기 어려울 수 있어요.\n지난 일이나 어긋난 감정이 현재 분위기에 영향을 줄 수 있어요.\n온도를 올리려면 먼저 서운함을 가볍게 풀어야 해요.',
        person: '상대는 오늘 질문자님을 생각하면서도 밝게 다가오기보다 아쉬운 부분을 떠올릴 수 있어요.\n마음이 남아 있어도 미안함, 후회, 서운함이 섞여 반응이 무겁게 보일 수 있어요.\n완전히 끝난 느낌이라기보다 감정의 그늘이 있는 날이에요.\n질문자님이 몰아붙이면 더 가라앉을 수 있어요.',
        caution: '오늘은 지난 서운함을 한꺼번에 꺼내면 분위기가 더 무거워질 수 있어요.\n상대의 반응이 낮아 보여도 바로 절망적으로 보지 마세요.\n감정이 예민한 날이라 작은 말도 크게 남을 수 있어요.\n오늘은 상처를 더 키우지 않는 게 중요해요.',
        advice: '오늘은 부드럽게 안부를 묻거나, 무거운 이야기는 조금 미루는 게 좋아요.\n필요한 말이 있다면 탓하기보다 질문자님 마음을 차분히 말해 보세요.\n상대가 부담 없이 받아들일 수 있는 온도가 필요해요.\n오늘은 회복의 문을 작게 열어 두는 정도가 좋아요.'
      },
      6: {
        tone: '익숙한 다정함과 그리움이 따뜻하게 살아나는 날이에요.',
        detail: '오늘은 새로운 자극보다 편안했던 기억이나 익숙한 정서가 관계 온도를 올려 줄 수 있어요.\n상대도 질문자님을 생각할 때 차갑게 끊어내기보다 부드러운 장면을 떠올릴 가능성이 있어요.\n마음이 아주 격하게 밀려오기보다 따뜻하게 되살아나는 흐름이에요.\n오늘은 편안함과 다정함이 핵심이에요.',
        person: '상대는 오늘 질문자님에게 익숙한 호감이나 정을 느낄 수 있어요.\n예전의 좋은 분위기, 편했던 대화, 따뜻했던 기억이 마음을 움직일 수 있어요.\n표현이 화려하지 않아도 안쪽에는 부드러운 감정이 남아 있는 모습이에요.\n질문자님 쪽으로 마음이 기울어 있는 장면도 보여요.',
        caution: '오늘은 과거의 좋은 기억을 너무 무겁게 꺼내면 오히려 부담이 될 수 있어요.\n따뜻한 흐름은 가볍고 편안하게 다룰 때 더 오래 이어져요.\n상대가 다정하게 반응해도 바로 확답을 요구하지 않는 게 좋아요.\n좋은 온기를 재촉하지 말고 자연스럽게 이어 주세요.',
        advice: '오늘은 익숙하고 편안한 이야기를 가볍게 꺼내 보세요.\n둘 다 웃을 수 있는 추억이나 다정한 리액션이 잘 맞아요.\n상대가 편안함을 느끼면 마음도 더 자연스럽게 가까워질 수 있어요.\n오늘은 질문보다 따뜻한 분위기를 먼저 만들어 주세요.'
      },
      7: {
        tone: '상상과 기대가 많아져 실제 온도가 흐릿하게 느껴질 수 있는 날이에요.',
        detail: '오늘은 마음이 없는 흐름이라기보다 가능성이 너무 많아 보여서 오히려 헷갈릴 수 있어요.\n상대도 질문자님에게 관심이 있어도 자기 감정을 뚜렷하게 정하지 못할 수 있어요.\n좋은 상상과 불안한 상상이 번갈아 올라오기 쉬워요.\n오늘은 실제 행동과 상상을 구분하는 게 중요해요.',
        person: '상대는 오늘 질문자님에 대해 여러 감정을 동시에 느낄 수 있어요.\n끌림은 있지만 확실한 선택이나 행동으로 바로 정리되진 않을 수 있어요.\n말이 달콤하거나 가능성을 열어 두는 듯해도 실제 움직임은 아직 흐릿할 수 있어요.\n그래서 질문자님이 헷갈리기 쉬운 날이에요.',
        caution: '오늘은 좋은 상상만 믿고 앞서가면 실망이 커질 수 있어요.\n상대의 말보다 실제 행동을 같이 봐야 해요.\n애매한 신호를 확정적인 마음으로 해석하지 않는 게 좋아요.\n오늘은 환상보다 현실적인 반응을 확인하세요.',
        advice: '오늘은 질문을 단순하게 가져가 보세요.\n상대가 실제로 어떻게 행동하는지 차분히 보는 게 좋아요.\n확답을 몰아붙이기보다 작은 약속이나 구체적인 반응을 확인해 보세요.\n흐릿한 분위기를 조금씩 선명하게 만드는 게 핵심이에요.'
      },
      8: {
        tone: '마음을 정리하거나 한 걸음 물러나는 기운이 있는 날이에요.',
        detail: '오늘은 온도가 뜨겁게 올라가기보다 조용히 거리를 두고 생각하는 흐름이에요.\n상대도 질문자님을 완전히 잊었다기보다 자기 감정을 다시 정리하고 싶어 할 수 있어요.\n가까이 다가오는 말보다 한 발 물러나는 태도가 보일 수 있어요.\n오늘은 붙잡기보다 마음의 방향을 확인하는 날이에요.',
        person: '상대는 오늘 질문자님에게 감정이 남아 있어도 쉽게 다가오지 않을 수 있어요.\n무언가를 내려놓거나, 지금은 더 이상 같은 방식으로 이어가기 어렵다고 느낄 수 있어요.\n차갑다기보다 지쳐서 거리를 두는 모습에 가까워요.\n질문자님이 억지로 당기면 더 멀어질 수 있어요.',
        caution: '오늘은 상대를 붙잡으려는 말이 부담으로 닿을 수 있어요.\n멀어지는 듯한 반응을 바로 쫓아가면 관계 온도가 더 낮아질 수 있어요.\n질문자님도 마음을 정리할 부분이 있는지 봐야 해요.\n오늘은 집착보다 여백이 필요해요.',
        advice: '오늘은 무리해서 다가가기보다 잠시 공간을 주세요.\n연락을 한다면 아주 짧고 담백하게 하는 게 좋아요.\n상대의 거리감을 존중하면 오히려 나중에 다시 말할 여지가 생길 수 있어요.\n질문자님 마음도 같이 정리해 보는 날로 쓰세요.'
      },
      9: {
        tone: '스스로 만족하거나 감정의 여유를 느낄 수 있는 날이에요.',
        detail: '오늘은 관계 온도가 급하게 흔들리기보다 각자의 기분과 만족감이 중요해요.\n상대도 질문자님에게 좋은 감정을 느낄 수 있지만, 그것을 굳이 급하게 관계로 묶으려 하진 않을 수 있어요.\n편안하고 기분 좋은 반응은 가능하지만 약간 자기중심적인 여유도 섞여 있어요.\n오늘은 즐거움을 나누되 기대를 과하게 키우지 않는 게 좋아요.',
        person: '상대는 오늘 질문자님과의 분위기를 기분 좋게 받아들일 수 있어요.\n다만 질문자님에게 온 마음을 쏟기보다 자기 컨디션과 만족을 우선할 수 있어요.\n반응은 부드럽고 호의적일 수 있지만 깊은 헌신까지 바로 보이진 않아요.\n그래도 오늘의 정서는 나쁘지 않은 편이에요.',
        caution: '오늘은 상대의 호의적인 반응을 너무 크게 확장해서 기대하지 않는 게 좋아요.\n좋은 분위기와 깊은 약속은 다른 문제일 수 있어요.\n상대가 편해 보인다고 해서 질문자님 마음도 전부 맞춰 줄 거라 보진 마세요.\n즐거움 안에서도 균형을 봐야 해요.',
        advice: '오늘은 함께 기분 좋아질 수 있는 이야기가 잘 맞아요.\n칭찬이나 가벼운 공감으로 분위기를 부드럽게 만들어 보세요.\n상대가 편안하게 웃으면 그 흐름을 즐기되, 무거운 확인은 미뤄도 괜찮아요.\n오늘은 좋은 기분을 쌓는 게 먼저예요.'
      },
      10: {
        tone: '정서적 안정감과 따뜻한 유대가 강하게 살아나는 날이에요.',
        detail: '오늘은 둘 사이의 온도가 꽤 안정적이고 따뜻하게 느껴질 수 있어요.\n상대도 질문자님과의 관계에서 편안함이나 소속감을 느낄 가능성이 커요.\n마음이 단순한 설렘을 넘어 정서적인 안식 쪽으로 움직일 수 있어요.\n오늘은 함께 있으면 마음이 놓이는 흐름이에요.',
        person: '상대는 오늘 질문자님을 따뜻하고 안정적인 사람으로 느낄 수 있어요.\n같이 있을 때 마음이 편해지고, 관계를 긍정적으로 바라볼 가능성이 커요.\n표현이 크지 않아도 속으로는 좋은 유대감을 느끼는 쪽이에요.\n질문자님과의 분위기를 오래 가져가고 싶어 할 수 있어요.',
        caution: '좋은 온도라고 해서 당장 모든 불안이 사라지는 건 아니에요.\n상대에게 완벽한 안정감을 기대하면 작은 실망도 크게 느껴질 수 있어요.\n따뜻한 흐름일수록 서로의 현실적인 속도도 존중해야 해요.\n오늘은 좋은 분위기를 유지하는 데 집중하세요.',
        advice: '오늘은 다정함을 아끼지 않아도 괜찮아요.\n상대에게 편안한 말과 안정적인 태도를 보여 주세요.\n함께 있는 느낌을 좋게 남기면 관계 온도가 더 단단해질 수 있어요.\n오늘은 따뜻한 유대감을 키우는 행동이 잘 맞아요.'
      },
      11: {
        tone: '순수하고 귀여운 감정 표현이 올라올 수 있는 날이에요.',
        detail: '오늘은 마음이 서툴지만 예쁘게 드러날 수 있어요.\n상대도 질문자님에게 다정한 호기심이나 작은 설렘을 느낄 가능성이 있어요.\n표현은 어색하거나 조심스러워도 감정의 결은 부드러운 편이에요.\n오늘은 작은 말 하나가 마음을 몽글하게 만들 수 있어요.',
        person: '상대는 오늘 질문자님에게 귀엽고 섬세한 방식으로 반응할 수 있어요.\n직접적인 고백보다 작은 관심, 조심스러운 질문, 다정한 말투로 마음이 새어 나올 수 있어요.\n감정이 아주 성숙하게 정리된 건 아니지만 순수한 호감은 살아 있어요.\n질문자님이 편하게 받아 주면 더 잘 열릴 수 있어요.',
        caution: '오늘은 상대의 서툰 표현을 너무 가볍게 넘기지 않는 게 좋아요.\n작은 신호에도 마음이 담겨 있을 수 있어요.\n다만 너무 빨리 진지하게 몰아가면 상대가 쑥스러워질 수 있어요.\n부드럽게 받아 주되 부담은 주지 마세요.',
        advice: '오늘은 귀엽고 다정한 리액션이 잘 맞아요.\n상대의 작은 말에 따뜻하게 반응해 주세요.\n무거운 질문보다 가벼운 감정 표현이 더 자연스럽게 닿아요.\n오늘은 섬세한 호감을 키우는 날이에요.'
      },
      12: {
        tone: '부드럽고 로맨틱한 온기가 움직일 수 있는 날이에요.',
        detail: '오늘은 감정이 차갑게 굳기보다 다정한 방향으로 흐를 가능성이 커요.\n상대도 질문자님에게 좋은 말을 건네고 싶거나 부드럽게 다가가고 싶어 할 수 있어요.\n분위기가 맞으면 애정 어린 표현이 자연스럽게 나올 수 있어요.\n오늘은 말의 온도와 분위기가 특히 중요해요.',
        person: '상대는 오늘 질문자님에게 다정하고 섬세하게 반응할 수 있어요.\n마음을 숨기기보다 분위기에 맞춰 부드럽게 표현하려는 쪽이에요.\n직접적인 행동보다 감성적인 말, 배려, 은근한 관심으로 마음을 보여 줄 가능성이 커요.\n질문자님도 그 흐름을 따뜻하게 받아 주면 좋아요.',
        caution: '오늘은 분위기에 취해 너무 앞서가면 현실감이 약해질 수 있어요.\n달콤한 말이 있어도 실제 행동이 따라오는지 천천히 봐야 해요.\n상대의 로맨틱한 반응을 바로 약속처럼 받아들이지는 마세요.\n감정과 현실의 균형이 필요해요.',
        advice: '오늘은 부드럽고 예쁜 말이 잘 맞아요.\n상대가 다가오면 따뜻하게 받아 주고, 질문자님도 감정을 조금 표현해 보세요.\n단, 너무 깊은 확인보다 분위기를 살리는 대화가 좋아요.\n오늘은 다정함으로 온도를 올리는 날이에요.'
      },
      13: {
        tone: '깊은 공감과 배려의 온도가 살아나는 날이에요.',
        detail: '오늘은 둘 사이의 감정이 예민하면서도 따뜻하게 흐를 수 있어요.\n상대도 질문자님의 마음을 살피거나, 질문자님이 어떤 상태인지 신경 쓸 가능성이 있어요.\n말보다 분위기와 눈치가 더 크게 작용하는 날이에요.\n오늘은 서로를 부드럽게 이해하려는 태도가 중요해요.',
        person: '상대는 오늘 질문자님에게 다정한 마음이나 보호하고 싶은 감정을 느낄 수 있어요.\n겉으로는 조용해도 안쪽에서는 질문자님 기분을 꽤 신경 쓰는 모습이에요.\n감정이 깊어서 쉽게 가볍게 넘기지 못할 수 있어요.\n질문자님이 편안하게 마음을 열면 더 부드럽게 반응할 가능성이 커요.',
        caution: '오늘은 감정이 깊은 만큼 예민함도 같이 올라올 수 있어요.\n상대의 작은 말에 너무 크게 상처받지 않도록 조심하세요.\n질문자님이 모든 것을 이해해 줘야 한다는 부담도 내려놓는 게 좋아요.\n배려와 자기 보호의 균형이 필요해요.',
        advice: '오늘은 차분하고 다정한 태도가 잘 맞아요.\n상대의 기분을 살피되 질문자님 마음도 부드럽게 표현해 보세요.\n깊은 이야기를 하더라도 비난보다 공감으로 시작하는 게 좋아요.\n오늘은 따뜻한 이해가 온도를 지켜 줘요.'
      },
      14: {
        tone: '감정을 안정적으로 다루는 깊은 온도가 느껴지는 날이에요.',
        detail: '오늘은 감정이 가볍게 흔들리기보다 차분하고 성숙하게 흐를 수 있어요.\n상대도 질문자님에게 마음이 있어도 과하게 들뜨기보다 안정적으로 조절하려는 모습이에요.\n겉으로는 아주 뜨거워 보이지 않아도 안쪽의 온도는 깊을 수 있어요.\n오늘은 신뢰와 배려가 중요한 날이에요.',
        person: '상대는 오늘 질문자님에게 속 깊은 배려나 안정적인 관심을 보일 수 있어요.\n마음을 크게 과시하기보다 차분하게 챙기고 지켜보는 쪽이에요.\n감정을 숨긴다기보다 성급하게 드러내지 않고 조율하는 흐름이에요.\n질문자님이 안정감을 느낄 만한 반응이 있을 수 있어요.',
        caution: '오늘은 상대가 차분하다고 해서 마음이 약하다고 보지 않는 게 좋아요.\n깊은 감정은 항상 큰 표현으로 나오지 않아요.\n다만 질문자님이 더 선명한 반응을 원하면 답답하게 느낄 수 있어요.\n오늘은 표현의 크기보다 태도의 안정감을 봐야 해요.',
        advice: '오늘은 차분하고 진심 어린 말이 잘 맞아요.\n상대의 안정적인 태도를 알아봐 주면 관계 온도가 더 단단해질 수 있어요.\n급하게 확인하려 하기보다 신뢰를 쌓는 대화가 좋아요.\n오늘은 편안하고 성숙한 온도로 다가가 보세요.'
      }
    };
    const base = profiles[value] || profiles[1];
    return reversed ? invertTemperatureProfile(base, 'cups') : base;
  }

  if (card.suit === 'swords') {
    const profiles: Record<number, DailyTemperatureCardProfile> = {
      1: {
        tone: '말과 판단이 선명해져 관계 온도가 또렷하게 느껴지는 날이에요.',
        detail: '오늘은 감정보다 생각과 말이 먼저 움직일 수 있어요.\n상대도 질문자님에게 애매하게 둘러대기보다 비교적 분명한 태도를 보일 가능성이 있어요.\n좋게 쓰이면 솔직한 대화가 열리지만, 날카롭게 쓰이면 차갑게 느껴질 수 있어요.\n오늘은 말의 방향이 온도를 결정해요.',
        person: '상대는 오늘 감정을 길게 숨기기보다 자기 생각을 분명히 하려는 모습이에요.\n말투가 차분하거나 이성적으로 느껴질 수 있어요.\n마음이 없는 게 아니라 감정보다 판단을 앞세우는 쪽이에요.\n질문자님도 말의 핵심을 정확히 보는 게 좋아요.',
        caution: '오늘은 말이 너무 날카로워지면 좋은 의도도 차갑게 전달될 수 있어요.\n상대의 단호한 표현을 바로 거절로 받아들이기보다 맥락을 같이 봐야 해요.\n질문자님도 감정적으로 몰아붙이면 대화가 딱딱해질 수 있어요.\n선명함과 부드러움의 균형이 필요해요.',
        advice: '오늘은 돌려 말하기보다 담백하고 분명한 표현이 좋아요.\n다만 말의 끝을 부드럽게 정리해 주세요.\n상대가 이성적으로 반응해도 감정이 없다고 단정하지 마세요.\n차분한 대화가 오히려 관계 온도를 안정시킬 수 있어요.'
      },
      2: {
        tone: '서로 결정을 미루며 마음을 가늠하는 날이에요.',
        detail: '오늘은 마음이 없어서가 아니라 어떤 선택이 맞는지 망설이는 흐름이에요.\n상대도 질문자님에게 반응하고 싶으면서도 선뜻 결론을 내리지 못할 수 있어요.\n겉으로는 조용하거나 무표정해 보여도 안쪽에서는 생각이 오가고 있어요.\n오늘은 서두르기보다 막힌 지점을 부드럽게 풀어야 해요.',
        person: '상대는 오늘 질문자님에게 확실한 답을 주기보다 잠시 멈춰 있을 수 있어요.\n좋다 싫다를 바로 정하기보다 양쪽 가능성을 모두 붙잡고 있는 모습이에요.\n마음이 없는 사람처럼 보일 수 있지만 실제로는 판단을 유예하는 쪽이에요.\n질문자님이 압박하면 더 닫힐 수 있어요.',
        caution: '오늘은 상대에게 지금 당장 선택하라고 몰아붙이지 않는 게 좋아요.\n침묵이나 애매함을 바로 부정적으로 해석하면 질문자님 마음만 더 힘들어져요.\n상대가 생각을 정리할 시간을 주는 게 필요해요.\n오늘은 결론보다 균형을 먼저 봐야 해요.',
        advice: '오늘은 선택지를 좁혀 주는 담백한 말이 좋아요.\n상대가 부담 없이 답할 수 있는 정도로만 물어보세요.\n큰 결론보다 작은 확인부터 시작하면 대화가 덜 막혀요.\n서로의 마음을 천천히 맞춰 보는 날로 쓰세요.'
      },
      3: {
        tone: '상처나 서운함이 온도를 예민하게 만들 수 있는 날이에요.',
        detail: '오늘은 마음이 없는 것보다 아픈 감정이 먼저 떠오르기 쉬워요.\n상대도 질문자님을 생각하면서 서운함이나 미안함을 같이 느낄 수 있어요.\n좋은 말을 하고 싶어도 상처가 끼어들면 반응이 차갑게 보일 수 있어요.\n오늘은 감정을 건드리는 방식이 특히 중요해요.',
        person: '상대는 오늘 질문자님에게 마음이 남아 있어도 쉽게 부드럽게 나오기 어려울 수 있어요.\n지난 말이나 상황이 마음에 걸려 방어적으로 반응할 수 있어요.\n상처받은 부분이 먼저 떠오르면 좋은 감정도 가려질 수 있어요.\n그래서 오늘은 반응을 조심스럽게 봐야 해요.',
        caution: '오늘은 서운했던 일을 세게 꺼내면 관계 온도가 더 낮아질 수 있어요.\n상대의 차가운 말에 바로 맞받아치면 상처가 커질 수 있어요.\n질문자님도 마음이 아픈 상태라면 대화를 잠시 미루는 게 나을 수 있어요.\n오늘은 아픈 감정을 더 찌르지 않는 게 중요해요.',
        advice: '오늘은 감정을 인정하되 비난으로 시작하지 마세요.\n말을 해야 한다면 짧고 차분하게, 질문자님이 느낀 점만 말하는 게 좋아요.\n상대가 방어적으로 보여도 바로 결론내리지 마세요.\n회복은 부드러운 말에서 시작될 수 있어요.'
      },
      4: {
        tone: '잠시 쉬어 가며 마음을 가라앉히는 날이에요.',
        detail: '오늘은 관계 온도가 빠르게 오르기보다 조용히 정리되는 흐름이에요.\n상대도 질문자님에게 마음이 없어서 멈춘다기보다 피로하거나 생각할 시간이 필요할 수 있어요.\n연락이나 반응이 적어도 그 자체가 끝을 의미하진 않아요.\n오늘은 쉬어 가는 온도를 인정하는 게 좋아요.',
        person: '상대는 오늘 적극적으로 움직이기보다 조용히 자기 상태를 회복하려는 모습이에요.\n질문자님을 밀어내는 것처럼 보여도 실제로는 여유가 부족한 것일 수 있어요.\n감정을 표현하기보다 마음을 가라앉히는 데 집중할 가능성이 커요.\n상대에게 숨 쉴 틈이 필요한 날이에요.',
        caution: '오늘은 조용한 반응을 억지로 깨우려 하지 않는 게 좋아요.\n계속 확인하면 상대가 더 피곤하게 느낄 수 있어요.\n질문자님도 답을 기다리며 스스로를 소모하지 않게 조심하세요.\n오늘은 멈춤을 부정적으로만 보지 않는 게 중요해요.',
        advice: '오늘은 무리해서 연락을 이어가기보다 잠시 템포를 낮춰 보세요.\n짧은 안부 정도는 괜찮지만 긴 확인은 미루는 게 좋아요.\n상대가 쉬어 갈 공간을 주면 나중에 반응이 더 부드러워질 수 있어요.\n질문자님도 마음을 정돈하는 시간을 가져 보세요.'
      },
      5: {
        tone: '말싸움이나 자존심 충돌이 온도를 거칠게 만들 수 있는 날이에요.',
        detail: '오늘은 마음이 없어서라기보다 이기고 지는 감각이 끼어들기 쉬워요.\n상대도 질문자님에게 감정이 있어도 말이 날카롭게 나올 수 있어요.\n작은 오해가 신경전으로 번지면 온도가 빠르게 낮아질 수 있어요.\n오늘은 대화의 승패보다 관계의 안전이 더 중요해요.',
        person: '상대는 오늘 방어적이거나 자기 입장을 강하게 주장할 수 있어요.\n마음보다 자존심이 앞서면 질문자님에게 상처가 되는 말을 할 가능성도 있어요.\n그렇다고 마음이 전혀 없다는 뜻은 아니지만, 표현 방식은 조심해야 해요.\n오늘은 상대의 말투를 그대로 받아치면 위험해요.',
        caution: '오늘은 이기려고 하는 대화를 피해야 해요.\n상대가 날카롭게 나와도 질문자님이 똑같이 세게 대응하면 관계 온도가 더 낮아져요.\n상처 주는 말은 오래 남을 수 있어요.\n오늘은 할 말이 있어도 톤을 낮추는 게 좋아요.',
        advice: '오늘은 대화를 짧게 정리하고 감정이 커지기 전에 멈추는 게 좋아요.\n상대가 자존심을 세우면 바로 설득하려 하지 마세요.\n필요한 말만 담백하게 남기고 한 박자 쉬어 가세요.\n질문자님이 차분함을 지키는 게 가장 큰 방어예요.'
      },
      6: {
        tone: '조심스럽게 멀어지거나 더 나은 방향을 찾는 날이에요.',
        detail: '오늘은 관계 온도가 갑자기 뜨거워지기보다 조용히 이동하는 흐름이에요.\n상대도 질문자님과의 관계를 완전히 놓았다기보다 더 편한 방향을 찾고 있을 수 있어요.\n이전의 불편함을 지나 조금씩 안정되는 과정에 가까워요.\n오늘은 서두르기보다 부드러운 전환을 봐야 해요.',
        person: '상대는 오늘 질문자님에게 바로 적극적으로 다가오기보다 조심스럽게 상황을 살필 수 있어요.\n불편했던 감정에서 벗어나고 싶지만 급하게 부딪히고 싶진 않은 모습이에요.\n마음이 남아 있어도 표현은 천천히 나올 가능성이 커요.\n안전한 분위기가 생기면 조금씩 움직일 수 있어요.',
        caution: '오늘은 상대의 느린 이동을 멈춤으로 착각하지 않는 게 좋아요.\n다만 너무 따라붙으면 상대가 부담을 느낄 수 있어요.\n관계가 회복되는 과정에는 시간이 필요해요.\n오늘은 속도보다 방향을 보는 게 중요해요.',
        advice: '오늘은 부드럽고 안정적인 말을 남겨 보세요.\n상대가 편하게 느낄 수 있는 거리에서 다가가는 게 좋아요.\n무거운 확인보다 괜찮은 분위기를 만드는 쪽이 맞아요.\n조금씩 편안한 방향으로 이동하는 데 집중하세요.'
      },
      7: {
        tone: '숨기거나 조심스럽게 살피는 기운이 강한 날이에요.',
        detail: '오늘은 마음이 완전히 드러나기보다 한쪽에서 조심스럽게 관찰하는 흐름이에요.\n상대도 질문자님에게 관심이 있어도 솔직하게 다 말하기보다 상황을 보며 움직일 수 있어요.\n말과 실제 마음 사이에 약간의 거리감이 생길 수 있어요.\n오늘은 겉으로 보이는 것만 보고 판단하기 어려워요.',
        person: '상대는 오늘 질문자님을 신경 쓰면서도 자기 마음을 숨기거나 우회적으로 표현할 수 있어요.\n직접 다가오기보다 눈치 보기, 간접적인 신호, 애매한 말로 반응할 가능성이 있어요.\n마음이 없어서라기보다 들키고 싶지 않은 기운이 강해요.\n질문자님이 너무 캐물으면 더 피할 수 있어요.',
        caution: '오늘은 상대의 애매한 신호를 바로 확신으로 보지 않는 게 좋아요.\n숨겨진 마음이 있을 수 있지만, 동시에 솔직하지 않은 태도도 섞여 있어요.\n질문자님이 의심을 키우면 관계 온도가 더 차가워질 수 있어요.\n오늘은 관찰하되 단정하지 마세요.',
        advice: '오늘은 상대를 몰아세우기보다 편하게 말할 틈을 주세요.\n간접적인 신호가 보이면 부드럽게 받아 주되, 바로 답을 요구하지 마세요.\n질문자님도 너무 많은 의미를 캐내려 하지 않는 게 좋아요.\n안심되는 분위기가 생기면 상대도 조금 더 솔직해질 수 있어요.'
      },
      8: {
        tone: '생각에 갇혀 마음을 표현하기 어려운 날이에요.',
        detail: '오늘은 실제 관계보다 머릿속 걱정이 온도를 낮게 느끼게 할 수 있어요.\n상대도 질문자님에게 마음이 있어도 자기 상황이나 두려움 때문에 움직이지 못할 수 있어요.\n표현이 막히고 반응이 제한된 듯 보일 가능성이 커요.\n오늘은 막힘의 원인을 마음 없음으로 단정하지 않는 게 좋아요.',
        person: '상대는 오늘 질문자님에게 다가가고 싶어도 스스로 만든 생각의 벽 때문에 멈춰 있을 수 있어요.\n마음이 없어서라기보다 어떻게 해야 할지 모르거나 자신감이 부족한 흐름이에요.\n반응이 답답하게 느껴져도 안쪽에서는 꽤 많은 고민이 있을 수 있어요.\n질문자님이 압박하면 더 갇힐 수 있어요.',
        caution: '오늘은 상대의 막힌 반응을 억지로 뚫으려 하지 마세요.\n질문자님도 불안한 상상을 키우면 스스로 더 힘들어질 수 있어요.\n상황을 단번에 풀려 하기보다 작은 여지를 보는 게 좋아요.\n오늘은 답답함을 키우지 않는 게 중요해요.',
        advice: '오늘은 아주 작은 말부터 시작해 보세요.\n상대가 부담 없이 답할 수 있는 정도가 좋아요.\n무거운 확인보다 편한 분위기가 막힌 흐름을 조금 풀 수 있어요.\n질문자님도 마음을 안정시키며 천천히 보세요.'
      },
      9: {
        tone: '걱정과 불안이 실제 온도보다 크게 느껴질 수 있는 날이에요.',
        detail: '오늘은 마음이 없는 것보다 생각이 너무 많아져 관계 온도가 낮게 느껴질 수 있어요.\n상대도 질문자님을 신경 쓰면서도 걱정이나 후회 때문에 편하게 반응하지 못할 수 있어요.\n밤새 고민하듯 마음이 복잡해지는 흐름이에요.\n오늘은 불안과 현실을 구분하는 게 중요해요.',
        person: '상대는 오늘 질문자님에게 마음이 있어도 편안하게 드러내기보다 혼자 걱정할 가능성이 커요.\n미안함이나 부담, 후회가 섞이면 반응이 늦거나 어색해질 수 있어요.\n마음이 없어서 차갑다기보다 마음이 복잡해서 굳어 있는 쪽이에요.\n질문자님도 상대의 불안을 자극하지 않는 게 좋아요.',
        caution: '오늘은 불안해서 확인하려는 말이 오히려 더 불안을 키울 수 있어요.\n상대의 작은 반응을 계속 되짚으면 질문자님 마음도 지칠 수 있어요.\n부정적인 상상을 사실처럼 믿지 마세요.\n오늘은 마음을 먼저 진정시키는 게 필요해요.',
        advice: '오늘은 깊은 질문보다 짧은 안부가 좋아요.\n상대가 편하게 숨 쉴 수 있는 분위기를 만들어 주세요.\n답이 늦어도 바로 의미를 붙이지 말고 조금 기다려 보세요.\n질문자님도 스스로를 안정시키는 행동을 먼저 해 주세요.'
      },
      10: {
        tone: '지친 마음이 바닥을 치고 다시 정리되는 날이에요.',
        detail: '오늘은 관계 온도가 낮게 느껴질 수 있지만, 완전한 끝만을 뜻하진 않아요.\n상대도 질문자님과의 흐름에서 피로감이나 포기하고 싶은 마음을 느낄 수 있어요.\n다만 바닥을 지나면 오히려 더 이상 끌고 가지 않아도 되는 부분이 보일 수 있어요.\n오늘은 무리해서 살리기보다 지친 부분을 인정해야 해요.',
        person: '상대는 오늘 질문자님에게 바로 따뜻하게 다가오기 어려울 수 있어요.\n마음이 지쳤거나, 더 이상 같은 방식으로 버티기 어렵다고 느낄 수 있어요.\n반응이 차갑게 보여도 그 안에는 피로와 체념이 섞여 있을 가능성이 커요.\n지금은 억지로 끌어올리기보다 회복할 시간이 필요해요.',
        caution: '오늘은 관계를 끝까지 밀어붙이려 하면 더 지칠 수 있어요.\n상대의 낮은 온도를 억지로 바꾸려 하지 마세요.\n질문자님도 상처를 키우는 말을 피해야 해요.\n오늘은 결론보다 회복이 먼저예요.',
        advice: '오늘은 연락이나 대화를 최소한으로 가볍게 가져가세요.\n마음을 다 쏟아내기보다 질문자님 컨디션을 먼저 챙기는 게 좋아요.\n시간이 지나야 다시 보이는 것이 있을 수 있어요.\n오늘은 쉬어 가는 선택도 충분히 좋은 행동이에요.'
      },
      11: {
        tone: '궁금해하면서도 조심스럽게 살피는 날이에요.',
        detail: '오늘은 상대가 질문자님을 신경 쓰되 직접적으로 표현하기보다 관찰하는 흐름이에요.\n메시지나 SNS, 작은 반응을 통해 분위기를 살필 가능성이 있어요.\n호기심은 있지만 말이 조금 날카롭거나 서툴게 나올 수 있어요.\n오늘은 관심과 경계가 함께 있는 온도예요.',
        person: '상대는 오늘 질문자님에 대해 궁금해하고 확인하고 싶어 할 수 있어요.\n다만 마음을 부드럽게 표현하기보다 조심스럽게 떠보거나 관찰하는 쪽이에요.\n반응이 미숙해 보여도 관심 자체는 살아 있을 수 있어요.\n질문자님이 안정적으로 받아 주면 대화가 풀릴 수 있어요.',
        caution: '오늘은 서로를 떠보는 말이 오해를 만들 수 있어요.\n상대의 미숙한 표현에 바로 상처받지 않는 게 좋아요.\n질문자님도 일부러 차갑게 반응하면 관계 온도가 금방 낮아질 수 있어요.\n오늘은 솔직하되 부드럽게 말해야 해요.',
        advice: '오늘은 가볍고 명확한 말이 좋아요.\n상대가 조심스럽게 다가오면 부담 없이 받아 주세요.\n서툰 질문에도 너무 예민하게 반응하지 않으면 흐름이 이어질 수 있어요.\n오늘은 작은 호기심을 편한 대화로 바꾸는 게 포인트예요.'
      },
      12: {
        tone: '말과 행동이 빠르게 튀어나와 온도가 급격히 움직일 수 있는 날이에요.',
        detail: '오늘은 마음보다 판단과 속도가 먼저 나올 수 있어요.\n상대가 갑자기 연락하거나 단호하게 말할 가능성이 있지만, 그 표현이 부드럽지만은 않을 수 있어요.\n온도는 빠르게 움직이지만 말이 세게 느껴질 수 있어요.\n오늘은 속도보다 방향을 잘 잡아야 해요.',
        person: '상대는 오늘 질문자님에게 빠르고 직접적인 반응을 보일 수 있어요.\n생각나는 대로 말하거나 행동할 가능성이 있어 질문자님이 당황할 수 있어요.\n마음을 숨기고 오래 재는 흐름은 아니지만, 말의 온도 조절은 부족할 수 있어요.\n급한 반응 안에 진심과 성급함이 같이 섞여 있어요.',
        caution: '오늘은 말이 너무 빨라져 상처가 될 수 있어요.\n상대가 세게 나오면 질문자님도 바로 맞받아치기 쉬우니 조심하세요.\n속도가 빠른 만큼 오해도 빠르게 커질 수 있어요.\n중요한 말은 한 번 더 생각하고 꺼내는 게 좋아요.',
        advice: '오늘은 짧고 분명하게 말하되 공격적으로 가지 않는 게 좋아요.\n상대가 급하게 나오면 질문자님이 템포를 조금 낮춰 주세요.\n빠른 흐름을 잘 정리하면 오히려 대화가 시원하게 풀릴 수 있어요.\n오늘은 속도를 다루는 태도가 중요해요.'
      },
      13: {
        tone: '차분하고 선명한 경계가 관계 온도에 영향을 주는 날이에요.',
        detail: '오늘은 감정보다 이성적인 판단과 기준이 먼저 보일 수 있어요.\n상대도 질문자님에게 마음이 있어도 쉽게 흐트러지기보다 선을 지키려는 모습이에요.\n말투가 차갑게 느껴질 수 있지만 그 안에 배려가 섞여 있을 수 있어요.\n오늘은 감정보다 태도의 정확함이 중요해요.',
        person: '상대는 오늘 질문자님에게 단정하고 조심스러운 반응을 보일 수 있어요.\n마음을 과하게 드러내기보다 필요한 말만 정확히 하려는 쪽이에요.\n차갑게 보일 수 있지만 완전히 무심한 흐름과는 달라요.\n상대는 자기 기준을 지키면서도 질문자님 반응을 보고 있을 수 있어요.',
        caution: '오늘은 상대의 선을 무시하면 관계 온도가 더 낮아질 수 있어요.\n질문자님도 감정적으로 설득하려 하면 상대가 더 단호해질 수 있어요.\n차분한 태도를 차가움으로만 받아들이지 마세요.\n오늘은 존중과 거리 조절이 필요해요.',
        advice: '오늘은 예의 있고 담백한 대화가 잘 맞아요.\n상대의 기준을 인정하면서 질문자님 생각도 차분히 말해 보세요.\n감정 표현은 과하지 않게, 대신 진심은 분명하게 전달하는 게 좋아요.\n오늘은 깔끔한 말투가 온도를 지켜 줘요.'
      },
      14: {
        tone: '이성적이고 단단한 판단이 앞서는 날이에요.',
        detail: '오늘은 감정이 뜨겁게 튀어나오기보다 현실적 판단과 원칙이 관계 온도를 좌우해요.\n상대도 질문자님에게 마음이 있어도 쉽게 흔들리지 않으려 할 수 있어요.\n표현은 절제되어 보이지만 생각은 꽤 분명한 쪽이에요.\n오늘은 안정감과 신뢰를 보여 주는 태도가 중요해요.',
        person: '상대는 오늘 질문자님에게 신중하고 단단한 반응을 보일 수 있어요.\n마음을 숨긴다기보다 감정을 통제하고 상황을 이성적으로 보려는 모습이에요.\n가벼운 말보다 책임감 있는 태도에 더 반응할 가능성이 커요.\n질문자님도 감정만으로 밀어붙이면 잘 통하지 않을 수 있어요.',
        caution: '오늘은 논리로만 이기려 들면 관계 온도가 차갑게 굳을 수 있어요.\n상대가 단호해 보여도 그 안에 마음이 전혀 없다고 단정하지 마세요.\n다만 감정적인 압박은 잘 먹히지 않는 날이에요.\n차분하게 신뢰를 쌓는 쪽이 좋아요.',
        advice: '오늘은 안정적이고 책임감 있는 태도가 잘 맞아요.\n말을 짧고 분명하게 하되 상대가 방어하지 않게 부드럽게 마무리하세요.\n질문자님도 감정의 파도보다 기준을 보여 주는 게 좋아요.\n오늘은 신뢰가 온도를 천천히 올려 줘요.'
      }
    };
    const base = profiles[value] || profiles[1];
    return reversed ? invertTemperatureProfile(base, 'swords') : base;
  }

  const profiles: Record<number, DailyTemperatureCardProfile> = {
    1: {
      tone: '현실적인 가능성과 안정적인 시작이 보이는 날이에요.',
      detail: '오늘은 감정이 화려하게 튀기보다 실제로 이어질 수 있는 작은 기반이 중요해요.\n상대도 질문자님에게 안정감이나 현실적인 호감을 느낄 수 있어요.\n대화가 크진 않아도 신뢰를 쌓는 방향으로 움직일 수 있어요.\n오늘은 천천히 단단해지는 온도에 가까워요.',
      person: '상대는 오늘 질문자님을 가볍게 보기보다 현실적으로 괜찮은 사람으로 느낄 수 있어요.\n표현은 크지 않아도 오래 볼 수 있는 안정감을 살필 가능성이 있어요.\n마음이 즉흥적으로 튀기보다 차분하게 자리 잡는 쪽이에요.\n작은 약속이나 성실한 반응이 중요해요.',
      caution: '오늘은 빠른 감정 확인을 기대하면 답답할 수 있어요.\n현실적인 흐름은 천천히 쌓여야 안정됩니다.\n상대가 크게 표현하지 않아도 성실한 반응이 있는지 봐 주세요.\n조급함이 좋은 기반을 흔들 수 있어요.',
      advice: '오늘은 작은 약속을 지키거나 성실한 태도를 보여 주세요.\n가벼운 말보다 실제 행동이 더 잘 닿아요.\n상대가 안정감을 느낄 수 있는 대화가 좋아요.\n오늘은 천천히 신뢰를 쌓는 행동이 온도를 올려 줘요.'
    },
    2: {
      tone: '바쁜 현실 속에서 관계 온도를 조율하는 날이에요.',
      detail: '오늘은 마음보다 일정, 상황, 현실적인 균형이 크게 작용해요.\n상대도 질문자님에게 관심이 있어도 여러 일을 함께 신경 쓰느라 반응이 들쑥날쑥할 수 있어요.\n온도는 완전히 꺼진 게 아니라 균형을 잡느라 흔들리는 쪽이에요.\n오늘은 여유와 타이밍이 중요해요.',
      person: '상대는 오늘 질문자님에게 마음이 있어도 자기 일이나 상황 때문에 집중도가 나뉠 수 있어요.\n답장이 빠르다가 늦거나, 가까워졌다가 다시 바빠지는 모습이 나올 수 있어요.\n무심함보다는 조율의 어려움에 가까워요.\n질문자님이 그 리듬을 이해하면 흐름이 덜 흔들려요.',
      caution: '오늘은 반응의 기복을 마음의 크기로만 보지 않는 게 좋아요.\n상대가 바빠 보인다고 바로 서운함을 키우면 온도가 낮아질 수 있어요.\n다만 질문자님만 계속 맞추는 흐름도 조심해야 해요.\n서로의 여유를 확인하는 게 중요해요.',
      advice: '오늘은 부담 없는 시간대에 짧게 말을 걸어 보세요.\n상대가 바쁘다면 바로 답을 요구하지 않는 게 좋아요.\n질문자님도 자신의 리듬을 지키면서 대화를 이어가세요.\n균형을 잘 맞추면 온도가 안정될 수 있어요.'
    },
    3: {
      tone: '천천히 공들여 쌓아 가는 온도가 살아나는 날이에요.',
      detail: '오늘은 한 번에 뜨거워지기보다 서로를 알아가며 안정적으로 가까워지는 흐름이에요.\n상대도 질문자님과의 관계를 현실적으로 쌓아 볼 만하다고 느낄 수 있어요.\n작은 협력, 대화, 함께한 시간이 관계 온도를 단단하게 만들어 줘요.\n오늘은 성급함보다 꾸준함이 좋아요.',
      person: '상대는 오늘 질문자님을 쉽게 지나치는 사람으로 보기보다 함께 맞춰 볼 수 있는 사람으로 느낄 수 있어요.\n마음이 화려하게 드러나진 않아도 인정과 호감이 섞일 수 있어요.\n질문자님과 호흡을 맞추는 과정에서 온도가 올라갈 가능성이 있어요.\n실제 접점이 있을수록 흐름이 좋아져요.',
      caution: '오늘은 당장 확답을 기대하면 답답할 수 있어요.\n이 흐름은 빠른 고백보다 차근차근 쌓이는 쪽이에요.\n상대가 크게 티 내지 않아도 꾸준한 반응이 있는지 봐 주세요.\n작은 과정을 무시하지 않는 게 좋아요.',
      advice: '오늘은 같이 할 수 있는 작은 주제나 실질적인 대화를 만들어 보세요.\n상대가 편하게 참여할 수 있는 말이 좋아요.\n칭찬이나 인정의 말도 잘 맞아요.\n오늘은 함께 맞춰 가는 느낌이 온도를 올려 줘요.'
    },
    4: {
      tone: '마음을 지키려는 태도 때문에 온도가 답답하게 느껴질 수 있는 날이에요.',
      detail: '오늘은 상대가 마음이 있어도 쉽게 열지 않고 자기 영역을 지키려 할 수 있어요.\n감정보다 안정, 소유, 현재 상태를 유지하려는 마음이 강해요.\n질문자님 입장에서는 답이 막혀 있는 것처럼 느껴질 수 있어요.\n온도를 올리려면 상대가 안전하다고 느껴야 해요.',
      person: '상대는 오늘 질문자님에게 관심이 있어도 자기 마음을 꽉 붙잡고 있을 수 있어요.\n쉽게 내어 주거나 확 열리는 태도는 기대하기 어려워요.\n마음을 숨긴다기보다 잃고 싶지 않아 움켜쥐는 쪽에 가까워요.\n질문자님이 너무 밀면 더 닫힐 수 있어요.',
      caution: '오늘은 상대의 닫힌 태도를 억지로 열려고 하지 마세요.\n확인하려는 말이 상대에게 침범처럼 느껴질 수 있어요.\n질문자님도 상대 반응에 매달리면 마음이 답답해질 수 있어요.\n오늘은 거리와 안정감을 같이 지켜야 해요.',
      advice: '오늘은 신뢰를 주는 말이 좋아요.\n상대가 마음을 조금씩 열 수 있도록 부담을 낮춰 주세요.\n질문자님도 너무 많은 것을 요구하기보다 편안한 접점을 만들어 보세요.\n안전하다는 느낌이 생기면 온도가 조금씩 풀릴 수 있어요.'
    },
    5: {
      tone: '소외감이나 부족함 때문에 온도가 낮게 느껴질 수 있는 날이에요.',
      detail: '오늘은 둘 사이에 따뜻함이 아예 없는 것보다 현실적인 고단함이나 마음의 허전함이 먼저 느껴질 수 있어요.\n상대도 질문자님을 신경 쓰면서도 자기 상황 때문에 다정하게 반응하기 어려울 수 있어요.\n서로 가까이 있고 싶어도 여유가 부족한 흐름이에요.\n오늘은 온도를 억지로 높이기보다 외로움을 덜어 주는 태도가 필요해요.',
      person: '상대는 오늘 질문자님에게 마음이 있어도 자기 문제나 부족함에 더 묶여 있을 수 있어요.\n반응이 차갑거나 빈약하게 느껴질 수 있지만, 그게 곧 마음 없음은 아닐 수 있어요.\n다만 지금은 따뜻하게 표현할 여력이 낮아 보여요.\n질문자님도 상대의 현실적인 상태를 함께 봐야 해요.',
      caution: '오늘은 작은 반응을 크게 부정적으로 받아들이기 쉬워요.\n상대가 부족하게 보인다고 해서 질문자님 가치까지 낮게 볼 필요는 없어요.\n다만 계속 애쓰며 온기를 구걸하는 흐름은 피해야 해요.\n오늘은 질문자님 마음을 먼저 보호하는 게 중요해요.',
      advice: '오늘은 무리해서 따뜻한 답을 끌어내려 하지 마세요.\n짧은 안부나 부담 없는 말 정도가 좋아요.\n상대가 여유를 회복할 시간을 주면서 질문자님도 스스로를 챙겨 주세요.\n온도는 천천히 회복될 수 있어요.'
    },
    6: {
      tone: '주고받는 균형이 맞으면 온도가 안정적으로 올라가는 날이에요.',
      detail: '오늘은 둘 사이의 온도가 일방적으로 흐르기보다 서로 얼마나 맞춰 주느냐에 따라 달라져요.\n상대도 질문자님에게 배려나 호의를 보일 수 있어요.\n작은 친절, 답장, 도움 같은 현실적인 표현이 마음을 보여 줄 수 있어요.\n오늘은 균형 있는 다정함이 핵심이에요.',
      person: '상대는 오늘 질문자님에게 어느 정도 마음을 나누려는 태도를 보일 수 있어요.\n크게 뜨겁진 않아도 챙겨 주거나 맞춰 주는 식의 반응이 있을 수 있어요.\n마음을 말보다 행동으로 보여 주는 쪽이에요.\n질문자님도 그 균형을 잘 받아 주면 좋아요.',
      caution: '오늘은 질문자님만 주거나 상대만 받는 흐름이 되지 않게 봐야 해요.\n작은 배려가 있어도 당연하게 여기면 온도가 흐려질 수 있어요.\n반대로 너무 많이 해 주고 보상을 기대하는 것도 조심해야 해요.\n서로의 선을 지키는 다정함이 필요해요.',
      advice: '오늘은 작은 배려를 주고받아 보세요.\n상대가 해 준 것을 알아봐 주고, 질문자님도 부담 없는 친절을 보여 주세요.\n말보다 행동으로 마음을 전하는 게 잘 맞아요.\n균형 있는 호의가 관계 온도를 안정시켜 줄 수 있어요.'
    },
    7: {
      tone: '기다리며 더 노력할지 고민하는 날이에요.',
      detail: '오늘은 관계 온도가 확 움직이기보다 지금까지 쌓아 온 흐름을 돌아보는 쪽이에요.\n상대도 질문자님과의 관계를 계속 키워 갈지, 잠시 멈춰 볼지 생각할 수 있어요.\n마음이 없는 것은 아니지만 결과가 바로 보이지 않아 답답함이 생길 수 있어요.\n오늘은 조급함보다 관찰이 필요해요.',
      person: '상대는 오늘 질문자님에게 관심이 있어도 바로 행동하기보다 상황을 지켜볼 수 있어요.\n지금까지의 반응과 앞으로의 가능성을 재는 모습이에요.\n마음이 느리게 자라는 흐름이라 즉각적인 표현은 약할 수 있어요.\n하지만 완전히 끊긴 온도는 아니에요.',
      caution: '오늘은 기다림이 길어지면서 질문자님이 지칠 수 있어요.\n상대의 느린 태도를 무조건 부정적으로 보진 말되, 질문자님만 애쓰는지도 봐야 해요.\n계속 투자할 가치가 있는지 차분히 확인하는 게 필요해요.\n조급한 결론은 피하세요.',
      advice: '오늘은 한 발 물러서서 흐름을 관찰해 보세요.\n상대가 어떤 행동을 꾸준히 보이는지 보는 게 좋아요.\n연락을 한다면 부담 없는 정도로만 남기세요.\n오늘은 무리한 추진보다 현실적인 판단이 도움이 돼요.'
    },
    8: {
      tone: '성실하게 쌓아 가는 마음이 온도를 지켜 주는 날이에요.',
      detail: '오늘은 갑작스러운 설렘보다 꾸준함과 정성이 관계 온도를 올려 줘요.\n상대도 질문자님에게 쉽게 불타오르기보다 차근차근 마음을 확인하려 할 수 있어요.\n작은 반복과 성실한 태도가 좋은 인상을 남겨요.\n오늘은 느려도 단단하게 가까워지는 흐름이에요.',
      person: '상대는 오늘 질문자님을 진지하게 보고 있을 수 있어요.\n말보다 태도, 행동, 꾸준함을 통해 마음을 판단하려는 쪽이에요.\n화려한 표현은 적어도 성실한 반응이 있다면 좋은 신호예요.\n질문자님도 안정적인 태도를 보이면 온도가 올라갈 수 있어요.',
      caution: '오늘은 빨리 결과를 보려 하면 지칠 수 있어요.\n성실한 흐름은 시간이 필요해요.\n상대가 크게 표현하지 않아도 꾸준한 접점이 있는지 봐 주세요.\n다만 질문자님만 일방적으로 노력하는지는 조심해야 해요.',
      advice: '오늘은 작은 약속이나 반복되는 배려가 좋아요.\n상대에게 신뢰를 줄 수 있는 행동을 해 보세요.\n말로만 확인하려 하기보다 실제로 편안함을 쌓는 쪽이 잘 맞아요.\n오늘의 온도는 꾸준함으로 올라가요.'
    },
    9: {
      tone: '각자의 여유와 매력이 관계 온도에 영향을 주는 날이에요.',
      detail: '오늘은 둘 사이가 너무 달라붙기보다 각자의 안정감이 중요해요.\n상대도 질문자님을 매력적으로 볼 수 있지만, 바로 의존적인 관계로 들어가려 하진 않을 수 있어요.\n혼자서도 괜찮은 태도가 오히려 더 좋은 인상을 줘요.\n오늘은 여유가 온도를 올려 주는 날이에요.',
      person: '상대는 오늘 질문자님에게 독립적이고 매력적인 느낌을 받을 수 있어요.\n질문자님이 자기 삶을 잘 지키는 모습에 호감을 느낄 가능성이 있어요.\n다만 상대도 자기 시간을 중요하게 여길 수 있어요.\n가까워지고 싶어도 너무 붙는 흐름은 아닐 수 있어요.',
      caution: '오늘은 상대의 여유를 거리감으로만 해석하지 않는 게 좋아요.\n하지만 질문자님도 상대에게 모든 관심을 쏟아붓지 않아야 해요.\n너무 의존적으로 보이면 매력이 흐려질 수 있어요.\n오늘은 자기 중심을 지키는 게 중요해요.',
      advice: '오늘은 질문자님만의 여유를 보여 주세요.\n상대에게 다가가더라도 너무 매달리지 않는 태도가 좋아요.\n가벼운 칭찬이나 편안한 대화가 잘 맞아요.\n스스로를 잘 돌보는 모습이 관계 온도에도 도움이 돼요.'
    },
    10: {
      tone: '안정적인 유대와 오래 갈 가능성이 느껴지는 날이에요.',
      detail: '오늘은 둘 사이의 온도가 현실적으로 단단하게 느껴질 수 있어요.\n상대도 질문자님과의 관계를 가볍게만 보기보다 안정적인 그림으로 볼 가능성이 있어요.\n가족 같은 편안함이나 오래 이어지는 신뢰가 중요하게 작용해요.\n오늘은 관계의 기반을 확인하기 좋은 흐름이에요.',
      person: '상대는 오늘 질문자님에게 안정감과 신뢰를 느낄 수 있어요.\n당장 뜨거운 표현보다 오래 볼 수 있는 사람인지에 마음이 갈 가능성이 커요.\n질문자님과의 관계를 현실적으로 긍정하게 되는 장면이 있어요.\n따뜻함이 차분하고 단단하게 깔린 날이에요.',
      caution: '좋은 안정감이 있어도 너무 빨리 큰 약속으로 몰아가진 마세요.\n상대가 편안함을 느끼는 속도를 존중해야 해요.\n관계가 안정적일수록 작은 배려를 소홀히 하지 않는 게 중요해요.\n당연하게 여기는 순간 온도가 무뎌질 수 있어요.',
      advice: '오늘은 신뢰를 주는 행동이 좋아요.\n작은 약속을 지키고, 편안한 말투로 상대를 대해 보세요.\n오래 이어질 수 있는 안정감을 보여 주면 관계 온도가 더 단단해져요.\n오늘은 진심을 행동으로 남기는 게 잘 맞아요.'
    },
    11: {
      tone: '조심스럽지만 성실한 호감이 시작될 수 있는 날이에요.',
      detail: '오늘은 마음이 크게 튀어나오기보다 작은 관심과 배움의 태도로 드러나요.\n상대도 질문자님에게 호감이 있어도 서두르지 않고 하나씩 확인하려 할 수 있어요.\n표현은 어색하거나 느려 보여도 진지함은 살아 있어요.\n오늘은 작은 시작을 소중히 보는 게 좋아요.',
      person: '상대는 오늘 질문자님에게 조심스럽고 성실하게 반응할 수 있어요.\n감정을 크게 말하기보다 작은 질문, 관심, 꾸준한 태도로 마음을 보여 줄 가능성이 있어요.\n서툴지만 가볍게만 보는 흐름은 아니에요.\n질문자님이 안정적으로 받아 주면 조금씩 더 가까워질 수 있어요.',
      caution: '오늘은 느린 표현을 답답하게만 보지 않는 게 좋아요.\n상대가 신중한 만큼 확답도 천천히 나올 수 있어요.\n다만 질문자님이 모든 걸 기다려야 한다는 뜻은 아니에요.\n작은 성실함이 실제로 있는지 봐 주세요.',
      advice: '오늘은 상대가 반응하기 쉬운 작은 질문이 좋아요.\n가볍지만 진심 있는 대화로 시작해 보세요.\n상대의 서툰 관심을 알아봐 주면 온도가 조금씩 올라갈 수 있어요.\n오늘은 천천히 배우듯 가까워지는 태도가 잘 맞아요.'
    },
    12: {
      tone: '느리지만 한결같은 온도가 느껴지는 날이에요.',
      detail: '오늘은 관계 온도가 빠르게 치솟기보다 천천히 안정적으로 움직여요.\n상대도 질문자님에게 마음이 있다면 쉽게 흔들리기보다 꾸준히 지켜보는 쪽이에요.\n표현은 느릴 수 있지만 무게감과 신뢰가 있어요.\n오늘은 속도보다 지속성이 더 중요해요.',
      person: '상대는 오늘 질문자님에게 성실하고 차분한 반응을 보일 수 있어요.\n마음을 숨긴다기보다 쉽게 과장하지 않는 쪽이에요.\n확 뜨거운 말은 적어도 꾸준한 태도로 마음이 드러날 수 있어요.\n질문자님이 느리다고 불안해하지 않는 게 좋아요.',
      caution: '오늘은 느린 속도를 마음 없음으로 단정하지 마세요.\n다만 상대가 너무 움직이지 않는다면 질문자님만 기다리게 되는 흐름도 봐야 해요.\n꾸준함과 정체를 구분하는 게 중요해요.\n오늘은 기대 속도를 낮추는 게 안전해요.',
      advice: '오늘은 안정적인 태도로 천천히 다가가세요.\n짧은 안부나 성실한 반응이 잘 맞아요.\n상대가 느려도 꾸준한 신호가 있다면 그 흐름을 믿어 봐도 좋아요.\n오늘은 오래 가는 온도를 만드는 날이에요.'
    },
    13: {
      tone: '따뜻하게 돌보고 품어 주는 온도가 살아나는 날이에요.',
      detail: '오늘은 현실적인 배려와 다정함이 관계 온도를 부드럽게 만들어 줘요.\n상대도 질문자님에게 편안함이나 보호받는 느낌을 받을 수 있어요.\n화려한 설렘보다 안정적이고 포근한 호감이 강해요.\n오늘은 마음을 편하게 해 주는 태도가 중요해요.',
      person: '상대는 오늘 질문자님에게 따뜻하고 안정적인 매력을 느낄 수 있어요.\n질문자님이 현실적으로 챙겨 주거나 편안한 태도를 보이면 마음이 더 열릴 수 있어요.\n감정이 과하게 흔들리기보다 부드럽게 자리 잡는 흐름이에요.\n상대도 다정한 방식으로 반응할 가능성이 있어요.',
      caution: '오늘은 너무 많이 챙기다가 질문자님이 지치지 않게 조심해야 해요.\n배려가 일방적이면 온도가 무거워질 수 있어요.\n상대에게 편안함을 주되 질문자님 선도 지켜야 해요.\n따뜻함과 자기 보호가 같이 필요해요.',
      advice: '오늘은 작은 배려가 잘 맞아요.\n상대가 편안하게 느낄 수 있는 말이나 행동을 해 보세요.\n다만 모든 걸 대신해 주려 하지 말고 자연스럽게 챙기는 정도가 좋아요.\n포근한 온도가 관계를 부드럽게 만들어 줄 수 있어요.'
    },
    14: {
      tone: '든든하고 현실적인 안정감이 관계 온도를 지켜 주는 날이에요.',
      detail: '오늘은 감정이 흔들리기보다 믿음과 책임감이 중요하게 작용해요.\n상대도 질문자님에게 진중하고 안정적인 태도를 보일 수 있어요.\n뜨거운 말보다 실질적인 행동에서 마음이 드러날 가능성이 커요.\n오늘은 든든함이 온도를 올려 주는 날이에요.',
      person: '상대는 오늘 질문자님에게 현실적인 신뢰와 안정감을 느낄 수 있어요.\n마음을 가볍게 표현하기보다 꾸준한 태도나 책임감 있는 행동으로 보여 줄 수 있어요.\n조용하지만 단단한 호감이 살아 있는 흐름이에요.\n질문자님도 안정적인 태도를 보이면 좋게 이어질 수 있어요.',
      caution: '오늘은 너무 현실적인 기준만 앞세우면 감정의 부드러움이 줄어들 수 있어요.\n상대가 든든해 보여도 다정한 표현이 아예 필요 없는 건 아니에요.\n무뚝뚝함을 안정감으로만 넘기면 서운함이 생길 수 있어요.\n현실과 감정의 온도를 같이 챙겨야 해요.',
      advice: '오늘은 믿음을 주는 행동이 좋아요.\n말보다 실제로 지키는 태도, 차분한 배려, 안정적인 반응이 잘 맞아요.\n상대에게 따뜻한 말도 조금 얹어 주세요.\n든든함에 다정함이 더해지면 온도가 훨씬 좋아져요.'
    }
  };
  const base = profiles[value] || profiles[1];
  return reversed ? invertTemperatureProfile(base, 'pentacles') : base;
}

function invertTemperatureProfile(profile: DailyTemperatureCardProfile, _suit?: string): DailyTemperatureCardProfile {
  return {
    tone: profile.tone,
    detail: `${profile.detail}\n오늘은 같은 마음도 곧장 드러나기보다 조금 늦거나 조심스럽게 표현될 수 있어요.\n그래도 흐름 전체를 보면 마음이 완전히 반대로 꺾였다기보다는, 확신과 타이밍을 더 살피는 쪽에 가까워요.`,
    person: `${profile.person}\n다만 오늘은 상대가 마음을 보여 주는 방식이 조금 서툴거나 조심스러울 수 있어요.`,
    caution: `${profile.caution}\n특히 오늘은 한 번의 반응만 보고 마음 전체를 확정하지 않는 게 좋아요.`,
    advice: `${profile.advice}\n상대 반응이 예상과 조금 달라도 바로 밀어붙이기보다, 질문자님 쪽에서 먼저 편안한 리듬을 잡아 주세요.`
  };
}

function generateDailyTemperatureReading(card: TarotCard | undefined): StandardReadingResult {
  const selectedCard = card || ({
    id: 41,
    type: 'minor',
    suit: 'cups',
    value: 6,
    isReversed: false,
    affectionScore: 56,
    contactScore: 52,
    progressScore: 48,
    stabilityScore: 54,
    defenseScore: 42,
  } as TarotCard);

  const cardId = Math.abs(Number(selectedCard.id || 0));
  const value = Math.max(1, Number(selectedCard.value || 0));
  const suit = String(selectedCard.suit || '');
  const reversed = false;
  const affection = selectedCard.affectionScore ?? selectedCard.affection ?? 50;
  const contact = selectedCard.contactScore ?? selectedCard.communication ?? 50;
  const progress = selectedCard.progressScore ?? selectedCard.action ?? 50;
  const stability = selectedCard.stabilityScore ?? selectedCard.stability ?? 50;
  const defense = selectedCard.defenseScore ?? selectedCard.defense ?? 50;

  const majorTemperature: Record<number, number> = {
    0: 37.1, 1: 37.8, 2: 36.2, 3: 38.1, 4: 36.9, 5: 37.0, 6: 38.6, 7: 37.8, 8: 37.5, 9: 35.9,
    10: 37.2, 11: 36.7, 12: 35.8, 13: 35.2, 14: 37.3, 15: 38.0, 16: 34.8, 17: 37.6, 18: 35.7, 19: 39.0,
    20: 37.4, 21: 38.3,
  };
  const suitBase: Record<string, number> = { cups: 37.1, wands: 37.3, swords: 35.9, pentacles: 36.4 };
  const valueShift: Record<number, number> = {
    1: 0.4, 2: 0.7, 3: 0.3, 4: -0.3, 5: -0.9, 6: 0.2, 7: -0.3,
    8: -0.2, 9: -0.1, 10: 0.5, 11: 0.2, 12: 0.4, 13: 0.3, 14: 0.4,
  };
  const scoreShift = ((affection - 50) * 0.012) + ((contact - 50) * 0.006) + ((progress - 50) * 0.006) + ((stability - 50) * 0.006) - ((defense - 50) * 0.008);
  const cardTemperatureOverride: Record<number, number> = {
    39: 35.9,
    43: 35.4,
    40: 35.5,
  };
  const baseTemperature = cardTemperatureOverride[cardId] ?? (selectedCard.type === 'major'
    ? majorTemperature[cardId] ?? 36.8
    : (suitBase[suit] ?? 36.6) + (valueShift[value] ?? 0));
  const cardFineTune = (((cardId * 31) % 9) - 4) * 0.04;
  const temperature = Number(Math.max(33.8, Math.min(40.1, baseTemperature + (cardTemperatureOverride[cardId] ? scoreShift * 0.25 : scoreShift) + cardFineTune)).toFixed(1));

  const tempMood = temperature >= 38.4
    ? '따뜻함이 선명한 온도'
    : temperature >= 37.2
      ? '온기가 분명히 살아 있는 온도'
      : temperature >= 36.1
        ? '조심스럽게 유지되는 온도'
        : temperature >= 35
          ? '천천히 살펴야 하는 낮은 온도'
          : '거리감이 먼저 느껴지는 온도';

  const majorProfiles: Record<number, { mood: string; person: string; caution: string; advice: string }> = {
    0: { mood: '가볍고 열린 분위기에서 작은 호기심이 살아나요.', person: '상대는 무겁게 확정하기보다 순간의 편안함에 반응할 수 있어요.', caution: '가벼운 신호를 너무 큰 약속처럼 해석하지 않는 게 좋아요.', advice: '부담 없는 농담이나 짧은 안부로 시작해 보세요.' },
    1: { mood: '말과 행동이 관계 온도를 직접 움직이는 날이에요.', person: '상대는 선명한 신호가 오면 생각보다 빠르게 반응할 수 있어요.', caution: '의도를 너무 돌리면 오히려 흐름이 흐려질 수 있어요.', advice: '답하기 쉬운 말로 대화의 문을 열어 보세요.' },
    2: { mood: '겉보다 속으로 살피는 기운이 강해요.', person: '상대는 마음을 크게 드러내기보다 질문자님의 태도를 조용히 보고 있을 수 있어요.', caution: '침묵을 바로 거절로 단정하지 않는 게 좋아요.', advice: '조급하게 캐묻기보다 편안한 여백을 남겨 주세요.' },
    3: { mood: '다정함과 포근한 호감이 살아나기 쉬워요.', person: '상대는 질문자님에게 편안함과 부드러운 매력을 느낄 수 있어요.', caution: '너무 많이 챙기다가 질문자님이 지치지 않게 조심하세요.', advice: '작은 배려와 따뜻한 리액션을 가볍게 보여 주세요.' },
    4: { mood: '안정감과 거리 조절이 함께 필요한 날이에요.', person: '상대는 감정보다 태도의 신뢰감과 일관성을 먼저 볼 수 있어요.', caution: '딱딱한 태도가 다정함을 가리지 않게 해야 해요.', advice: '분명하지만 부드러운 말투로 안정감을 주세요.' },
    5: { mood: '익숙한 방식과 현실적인 기준이 온도에 영향을 줘요.', person: '상대는 관계를 가볍게 보기보다 신중하게 판단하려 할 수 있어요.', caution: '정답을 강요하면 마음이 더 닫힐 수 있어요.', advice: '서로의 입장을 존중하는 말로 대화를 풀어 보세요.' },
    6: { mood: '서로를 의식하는 마음이 비교적 선명해요.', person: '상대는 질문자님의 반응과 분위기를 꽤 신경 쓸 수 있어요.', caution: '호감이 느껴져도 확답을 서두르면 부담이 생길 수 있어요.', advice: '다정한 리액션으로 좋은 인상을 남겨 보세요.' },
    7: { mood: '움직임과 방향성이 살아나는 날이에요.', person: '상대는 마음이 정리되면 행동으로 반응하려는 쪽에 가까워요.', caution: '속도를 너무 밀어붙이면 관계가 거칠어질 수 있어요.', advice: '짧고 분명한 말로 자연스럽게 계기를 만들어 보세요.' },
    8: { mood: '절제된 호감과 힘 있는 안정감이 함께 보여요.', person: '상대는 마음을 크게 드러내기보다 차분히 조절하려 할 수 있어요.', caution: '상대의 차분함을 무관심으로만 보지 마세요.', advice: '따뜻하되 흔들리지 않는 태도를 보여 주세요.' },
    9: { mood: '마음이 안쪽에서 천천히 정리되는 날이에요.', person: '상대는 질문자님을 의식해도 혼자 생각할 시간이 필요할 수 있어요.', caution: '느린 반응을 재촉하면 더 조용해질 수 있어요.', advice: '짧은 말 하나만 남기고 기다릴 공간을 주세요.' },
    10: { mood: '분위기가 바뀔 여지가 있는 날이에요.', person: '상대는 상황의 흐름에 따라 태도가 달라질 수 있어요.', caution: '하루의 반응만으로 전체 관계를 확정하지 마세요.', advice: '좋은 타이밍이 오면 가볍게 올라타 보세요.' },
    11: { mood: '균형과 공정함이 관계 온도를 좌우해요.', person: '상대는 감정보다 서로의 태도와 선을 먼저 볼 수 있어요.', caution: '옳고 그름만 따지면 분위기가 차가워질 수 있어요.', advice: '감정과 상황을 같이 인정하는 말이 좋아요.' },
    12: { mood: '바로 움직이기보다 잠시 멈춰 보는 온도예요.', person: '상대는 마음이 있어도 지금은 표현의 타이밍을 못 잡을 수 있어요.', caution: '멈춤을 실패로 보지 않는 게 좋아요.', advice: '기다림을 전략처럼 쓰고 부담 없는 말만 남겨 보세요.' },
    13: { mood: '예전 방식보다 새로운 태도가 필요한 날이에요.', person: '상대는 이전과 같은 반응을 반복하지 않을 수 있어요.', caution: '과거 방식으로 밀어붙이면 온도가 낮아질 수 있어요.', advice: '가볍고 새롭게 시작하는 말투가 좋아요.' },
    14: { mood: '천천히 섞이며 안정되는 온도예요.', person: '상대는 급한 감정보다 편안한 균형을 원할 수 있어요.', caution: '조급하게 끌어올리려 하면 오히려 흐름이 흐려져요.', advice: '말의 속도를 낮추고 부드럽게 맞춰 보세요.' },
    15: { mood: '강한 끌림과 집착 사이의 온도가 올라올 수 있어요.', person: '상대는 질문자님에게 강하게 끌리면서도 쉽게 편안해지진 못할 수 있어요.', caution: '확인 욕구가 커지면 관계가 무거워질 수 있어요.', advice: '매력은 살리되 압박은 덜어내는 태도가 좋아요.' },
    16: { mood: '예민한 말 하나가 온도를 크게 흔들 수 있어요.', person: '상대는 당황하거나 방어적으로 반응할 가능성이 있어요.', caution: '쌓인 말을 한꺼번에 터뜨리지 않는 게 좋아요.', advice: '중요한 말은 짧고 차분하게 정리해서 전하세요.' },
    17: { mood: '잔잔한 기대와 회복의 온기가 남아 있어요.', person: '상대는 관계를 차갑게 끊기보다 부드럽게 남겨 두고 있을 수 있어요.', caution: '희망이 보여도 현실보다 앞서가진 않는 게 좋아요.', advice: '따뜻한 말 한마디를 조용히 남겨 보세요.' },
    18: { mood: '불안과 상상이 실제 온도보다 크게 느껴질 수 있어요.', person: '상대는 마음을 선명하게 보여 주기보다 흐릿하게 반응할 수 있어요.', caution: '추측을 사실처럼 믿지 않는 게 가장 중요해요.', advice: '깊은 확인보다 편안한 분위기를 먼저 만들어 보세요.' },
    19: { mood: '밝고 따뜻한 반응이 살아나기 좋은 날이에요.', person: '상대는 질문자님에게 좋은 인상이나 편안함을 느낄 수 있어요.', caution: '좋은 반응을 바로 압박으로 바꾸지 마세요.', advice: '웃을 수 있는 말과 긍정적인 리액션이 좋아요.' },
    20: { mood: '미뤄 둔 감정이 다시 떠오를 수 있는 날이에요.', person: '상대는 질문자님과의 관계를 다시 생각해 볼 수 있어요.', caution: '과거 이야기를 너무 무겁게 꺼내면 부담이 될 수 있어요.', advice: '정리된 마음으로 담백하게 말을 열어 보세요.' },
    21: { mood: '관계의 그림을 조금 더 넓게 볼 수 있는 날이에요.', person: '상대는 질문자님과의 흐름을 완전히 닫기보다 전체적으로 살피는 모습이에요.', caution: '완성된 느낌에 취해 세부 신호를 놓치지 마세요.', advice: '좋은 흐름은 차분히 이어 가는 태도가 잘 맞아요.' },
  };

  const suitProfiles: Record<string, { mood: string; person: string; caution: string; advice: string }> = {
    wands: {
      mood: '행동과 타이밍이 오늘의 온도를 크게 움직여요.',
      person: '상대는 생각이 정리되면 말보다 행동으로 먼저 반응할 수 있어요.',
      caution: '속도가 빨라질수록 말실수나 충동적인 반응을 조심해야 해요.',
      advice: '가볍게 먼저 움직이되, 상대가 따라올 여지를 남겨 주세요.',
    },
    cups: {
      mood: '감정의 결이 부드럽게 살아나는 날이에요.',
      person: '상대는 분위기와 말투에 따라 마음이 쉽게 열리거나 조심스러워질 수 있어요.',
      caution: '작은 반응을 너무 크게 해석하면 질문자님 마음이 먼저 흔들릴 수 있어요.',
      advice: '다정한 리액션과 편안한 공감으로 온도를 살려 보세요.',
    },
    swords: {
      mood: '생각과 말의 온도가 관계 분위기를 좌우해요.',
      person: '상대는 마음보다 판단과 상황 정리를 먼저 앞세울 수 있어요.',
      caution: '날카로운 확인이나 시험하는 말은 분위기를 차갑게 만들 수 있어요.',
      advice: '짧고 담백하게 말하고, 감정보다 톤을 부드럽게 잡아 주세요.',
    },
    pentacles: {
      mood: '현실적인 여유와 안정감이 온도에 크게 작용해요.',
      person: '상대는 큰 표현보다 꾸준함이나 실제 행동에서 마음을 보여 줄 수 있어요.',
      caution: '느린 속도를 마음 없음으로 단정하지 않는 게 좋아요.',
      advice: '작은 약속을 지키고 안정적인 태도를 보여 주세요.',
    },
  };

  const valueProfiles: Record<number, { mood: string; person: string; caution: string; advice: string }> = {
    1: { mood: '새로운 신호가 시작될 수 있어요.', person: '상대는 작은 계기에 반응할 준비가 되어 있을 수 있어요.', caution: '시작의 신호를 너무 큰 결론으로 키우지 마세요.', advice: '짧고 밝은 첫마디가 좋아요.' },
    2: { mood: '서로의 반응을 맞춰 보는 온도예요.', person: '상대는 질문자님의 태도를 보며 거리를 조절할 수 있어요.', caution: '상대가 고민하는 시간을 압박하지 마세요.', advice: '선택을 강요하기보다 가능성을 열어 주세요.' },
    3: { mood: '관계가 조금씩 밖으로 펼쳐지는 흐름이에요.', person: '상대는 이어질 가능성을 완전히 닫지 않고 볼 수 있어요.', caution: '기대가 커져도 조급하게 확인하지 마세요.', advice: '다음 대화로 이어질 여지를 남겨 보세요.' },
    4: { mood: '감정이 살아나기보다 잠시 멈춰 있는 온도예요.', person: '상대는 호의가 있어도 바로 반응하기보다 자기 안에 머물 수 있어요.', caution: '무덤덤한 반응을 억지로 끌어내려 하면 더 닫힐 수 있어요.', advice: '큰 확인보다 짧고 가벼운 말로 분위기만 환기해 주세요.' },
    5: { mood: '서운함이나 부족함이 먼저 올라올 수 있어요.', person: '상대는 마음이 있어도 여유가 없어 낮게 반응할 수 있어요.', caution: '부족한 반응을 질문자님 가치와 연결하지 마세요.', advice: '무리해서 끌어올리기보다 마음을 먼저 보호하세요.' },
    6: { mood: '익숙함과 다정한 기억이 온도를 살려요.', person: '상대는 질문자님에게 편안함이나 아련한 호감을 느낄 수 있어요.', caution: '좋았던 분위기를 바로 확답으로 몰아가지 마세요.', advice: '편안했던 이야기나 가벼운 안부가 잘 맞아요.' },
    7: { mood: '겉으로 보이는 것보다 살피는 마음이 많아요.', person: '상대는 쉽게 속을 보이기보다 질문자님의 반응을 지켜볼 수 있어요.', caution: '애매한 신호를 확정적인 답으로 보지 마세요.', advice: '관찰하되 단정하지 않는 태도가 좋아요.' },
    8: { mood: '속도와 거리 조절이 중요한 날이에요.', person: '상대는 움직이고 싶어도 부담을 계산할 수 있어요.', caution: '따라붙듯 확인하면 상대가 더 느려질 수 있어요.', advice: '짧게 말하고 반응을 본 뒤 다음을 정하세요.' },
    9: { mood: '기대와 불안이 함께 커질 수 있어요.', person: '상대는 마음이 있어도 혼자 생각이 많아질 수 있어요.', caution: '걱정을 사실처럼 믿지 않는 게 좋아요.', advice: '긴 확인보다 질문자님 마음을 먼저 진정시켜 주세요.' },
    10: { mood: '하나의 흐름이 정리되고 다음 단계가 보여요.', person: '상대는 관계를 더 크게 보거나 현실적인 결론을 생각할 수 있어요.', caution: '한 번에 모든 답을 받으려 하지 마세요.', advice: '오늘은 차분히 정리하고 다음 연결점을 만들어 보세요.' },
    11: { mood: '가볍고 서툰 신호가 먼저 보일 수 있어요.', person: '상대는 진심을 완성된 말보다 작은 관심으로 보일 수 있어요.', caution: '서툰 표현을 너무 가볍게 넘기지 마세요.', advice: '작은 신호를 부드럽게 받아 주세요.' },
    12: { mood: '빠른 움직임과 들뜬 온도가 살아나요.', person: '상대는 마음이 움직이면 직진하거나 티가 날 수 있어요.', caution: '뜨거운 반응이 오래 갈지는 조금 더 봐야 해요.', advice: '가볍게 호응하되 속도는 함께 조절하세요.' },
    13: { mood: '성숙하고 깊은 반응이 가능해요.', person: '상대는 감정을 가볍게 던지기보다 자신만의 방식으로 보여 줄 수 있어요.', caution: '상대의 스타일을 질문자님 방식으로만 재단하지 마세요.', advice: '상대의 리듬을 존중하면서 따뜻하게 받아 주세요.' },
    14: { mood: '안정감과 책임감이 온도를 지켜요.', person: '상대는 크게 표현하지 않아도 꾸준한 태도로 마음을 보일 수 있어요.', caution: '느린 표현을 답답하게만 보지 마세요.', advice: '차분하고 믿을 수 있는 태도가 좋아요.' },
  };

  const base = selectedCard.type === 'major'
    ? (majorProfiles[cardId] || majorProfiles[10])
    : {
        mood: `${suitProfiles[suit]?.mood || '오늘은 서로의 속도를 조심스럽게 맞춰 가는 날이에요'} ${valueProfiles[value]?.mood || ''}`.trim(),
        person: `${suitProfiles[suit]?.person || '상대는 질문자님의 반응을 보며 거리를 조절할 수 있어요'} ${valueProfiles[value]?.person || ''}`.trim(),
        caution: `${suitProfiles[suit]?.caution || '작은 반응 하나로 전체 마음을 단정하지 마세요'} ${valueProfiles[value]?.caution || ''}`.trim(),
        advice: `${suitProfiles[suit]?.advice || '편안한 말투로 천천히 다가가 보세요'} ${valueProfiles[value]?.advice || ''}`.trim(),
      };

  const reversedSoftener = reversed
    ? {
        mood: '다만 오늘은 그 흐름이 바로 크게 드러나기보다 한 박자 늦게 표현될 수 있어요.',
        person: '상대도 마음을 숨긴다기보다 확신과 타이밍을 조금 더 살피는 모습이에요.',
        caution: '오늘은 답을 빨리 끌어내려 하기보다 반응이 자연스럽게 나올 시간을 주는 게 좋아요.',
        advice: '예상보다 반응이 작아도 바로 밀어붙이지 말고, 편안한 리듬을 먼저 만들어 주세요.',
      }
    : {
        mood: '오늘은 분위기만 잘 맞으면 마음이 비교적 자연스럽게 이어질 수 있어요.',
        person: '상대도 편안한 공기가 만들어지면 질문자님 쪽으로 반응을 보여 줄 여지가 있어요.',
        caution: '좋은 신호가 보여도 하루 안에 전부 확인하려 들지는 않는 게 좋아요.',
        advice: '가볍고 다정한 말로 대화가 이어질 공간을 열어 주세요.',
      };

  const fiveLines = (lines: string[]) => lines.map(line => line.trim()).filter(Boolean).slice(0, 5).join('\n');
  const clean = (text: string) => text
    .replace(/원래는/g, '')
    .replace(/꼬여 보이는/g, '천천히 정리되는')
    .replace(/꼬여/g, '조심스러워')
    .replace(/비틀려/g, '조심스럽게')
    .replace(/어긋나/g, '늦어지')
    .replace(/반대로 행동/g, '다르게 표현')
    .replace(/그 흐름을 살리면/g, '오늘은')
    .replace(/검\s*\d+번|컵\s*\d+번|지팡이\s*\d+번|펜타클\s*\d+번/g, '')
    .replace(/THE\s+[A-Z\s]+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const oneLineConclusion = clean(`오늘 우리 사이 온도는 ${temperature}도예요. ${tempMood}예요.`);
  const card1Meaning = clean(fiveLines([
    `오늘 우리 사이 온도는 ${temperature}도예요.`,
    base.mood,
    reversedSoftener.mood,
    temperature >= 37.2 ? '따뜻함은 살아 있지만, 그 온도를 오래 유지하려면 부담 없이 다루는 게 중요해요.' : '온도가 낮게 느껴져도 관계가 바로 끊긴 뜻은 아니고, 지금은 속도를 낮춰 살피는 쪽에 가까워요.',
    '오늘은 작은 말투와 반응의 편안함이 관계 분위기를 크게 바꿀 수 있어요.',
  ]));
  const caution = clean(fiveLines([
    base.caution,
    reversedSoftener.caution,
    temperature >= 37.2 ? '좋은 온도가 느껴져도 바로 확답을 요구하면 분위기가 무거워질 수 있어요.' : '반응이 작다고 해서 마음 전체를 낮게 단정하면 질문자님 마음이 먼저 지칠 수 있어요.',
    '오늘은 확인하려는 말보다 상대가 편하게 답할 수 있는 공기가 더 중요해요.',
    '한 번의 답장, 한 번의 표정만으로 결론내리지 않는 게 좋아요.',
  ]));
  const actionAdvice = clean(fiveLines([
    base.advice,
    reversedSoftener.advice,
    progress >= 58 ? '먼저 움직여도 괜찮지만, 말은 짧고 산뜻하게 시작하는 게 좋아요.' : '오늘은 크게 움직이기보다 짧은 안부나 가벼운 리액션 정도가 잘 맞아요.',
    '상대가 답하기 쉬운 말로 시작하면 온도가 덜 부담스럽게 올라갈 수 있어요.',
    '대화가 이어지면 바로 결론을 묻지 말고 그 분위기를 조금 더 살려 보세요.',
  ]));

  return {
    oneLineConclusion,
    questionCategory: '우리 사이 온도',
    card1Meaning,
    totalFlow: clean(`${oneLineConclusion}\n${card1Meaning}`),
    caution,
    actionAdvice,
    followUpQuestions: ['오늘 먼저 연락해도 괜찮을까요?', '그 사람의 진짜 마음은 무엇일까요?', '우리 관계는 앞으로 어떻게 흘러갈까요?'],
    temperature,
  };
}

function generateSafeFallbackReading(cards: TarotCard[], question: string, menuTitle: string): StandardReadingResult {
  const [first, second, third] = cards;
  const firstName = first?.nameKo || first?.name || '첫 번째 카드';
  const secondName = second?.nameKo || second?.name || '두 번째 카드';
  const thirdName = third?.nameKo || third?.name || '세 번째 카드';
  const topic = question || menuTitle || '지금 궁금한 마음';

  return {
    oneLineConclusion: `질문자님이 궁금해한 흐름은 아직 한쪽으로 완전히 정리되기보다, 서로의 반응을 보며 천천히 움직이는 모습이에요.`,
    questionCategory: menuTitle || '타로 리딩',
    card1Meaning: `${firstName}의 흐름을 보면 지금 상황은 겉으로 보이는 말보다 안쪽의 조심스러움이 더 크게 느껴져요.\n상대가 바로 확실한 태도를 보여 주지 않더라도, 질문자님이 던진 질문 자체를 가볍게 넘기는 분위기는 아니에요.\n다만 지금은 마음을 드러내기 전에 자기 페이스를 먼저 지키려는 모습이 있어요.\n그래서 질문자님 입장에서는 답이 느리거나 애매하게 느껴질 수 있어요.`,
    card2Meaning: `${secondName}의 흐름에서는 상대가 감정을 단순하게 정리하지 못하고 있다는 점이 보여요.\n좋고 싫음처럼 딱 잘라 말하기보다, 상황과 감정을 같이 재고 있는 모습이에요.\n질문자님이 너무 빨리 결론을 확인하려 하면 상대가 더 움츠러들 수 있어요.\n지금은 반응을 끌어내기보다 편하게 말이 이어질 수 있는 분위기를 만드는 쪽이 좋아요.`,
    card3Meaning: `${thirdName}의 흐름을 보면 앞으로는 작은 접점에서 분위기가 달라질 가능성이 있어요.\n큰 고백이나 확답보다, 짧은 대화와 자연스러운 반응이 흐름을 다시 살리는 열쇠가 될 수 있어요.\n질문자님이 먼저 여유를 잡으면 상대도 부담을 덜 느끼고 반응하기 쉬워져요.\n오늘은 한 번에 답을 얻으려 하기보다, 다음 대화가 이어질 여지를 남기는 게 좋아요.`,
    totalFlow: `질문자님이 물어본 “${topic}”에 대해 보면, 지금은 확답보다 흐름을 살피는 시기예요.\n상대의 태도가 분명하지 않아 답답할 수 있지만, 완전히 닫힌 분위기라고 보기는 어려워요.\n다만 질문자님이 급하게 확인하려고 하면 오히려 상대가 방어적으로 굳을 수 있어요.\n오늘은 마음을 압박하기보다 편하게 말을 열고, 상대가 자연스럽게 반응할 공간을 남겨 두는 게 좋습니다.`,
    caution: `오늘은 작은 반응 하나로 모든 결론을 내리지 않는 게 좋아요.\n답이 늦거나 말이 짧아도 바로 부정적으로 받아들이면 질문자님 마음이 먼저 지칠 수 있어요.\n상대의 속도를 보면서 질문자님도 한 박자 여유를 두는 편이 안정적이에요.`,
    actionAdvice: `지금은 짧고 담백하게 다가가는 게 좋아요.\n무거운 확인보다 일상적인 말, 부담 없는 질문, 편한 리액션이 더 잘 닿을 수 있어요.\n질문자님이 먼저 분위기를 부드럽게 열어 주면 관계의 온도도 조금씩 다시 움직일 수 있어요.`,
    followUpQuestions: [
      '상대가 지금 가장 신경 쓰는 부분은 무엇일까요?',
      '제가 먼저 다가가도 괜찮을까요?',
      '이 관계를 더 편하게 풀려면 무엇이 필요할까요?'
    ],
    temperature: 36.8,
  };
}

export const getSpreadRoles = (menuId: string): string[] => {
  return [
    "질문과 현재 상황을 보고 정할 1번째 해석 포인트",
    "질문과 현재 상황을 보고 정할 2번째 해석 포인트",
    "질문과 현재 상황을 보고 정할 3번째 해석 포인트",
  ];
};

export function formatKoreanTextWithNowrap(text: string | null | undefined): React.ReactNode {
  if (!text) return "";
  text = replaceHanjaInKoreanText(text);
  const phrases = [
    "잠시만 기다려 주세요",
    "잠시 기다려 주세요",
    "다시 시도해 주세요",
    "다시 시도하기",
    "확인해 보세요",
    "카드를 선택해 주세요",
    "리딩을 정리하고 있어요",
    "리딩을 정리하지 못했어요",
    "리딩을 정리하는 데"
  ];
  
  let result: React.ReactNode[] = [text];
  
  for (const phrase of phrases) {
    const nextResult: React.ReactNode[] = [];
    for (const item of result) {
      if (typeof item === 'string') {
        const parts = item.split(phrase);
        if (parts.length > 1) {
          parts.forEach((part, index) => {
            if (part) nextResult.push(part);
            if (index < parts.length - 1) {
              nextResult.push(
                <span key={`${phrase}-${index}`} className="whitespace-nowrap inline-block">
                  {phrase}
                </span>
              );
            }
          });
        } else {
          nextResult.push(item);
        }
      } else {
        nextResult.push(item);
      }
    }
    result = nextResult;
  }
  
  return <>{result}</>;
}

const ERROR_DETAILS: Record<string, { title: string; description: string }> = {
  AI_NOT_CONFIGURED: {
    title: "현재 리딩 서비스를 준비 중이에요",
    description: "서비스 연결 상태를 확인한 뒤 다시 이용해 주세요."
  },
  AI_RATE_LIMIT: {
    title: "리딩을 잠시 정리하지 못했어요",
    description: "선택한 카드는 그대로 유지돼요. 다시 시도해 주세요."
  },
  AI_BUSY: {
    title: "리딩 정리가 잠시 멈췄어요",
    description: "선택한 카드와 질문은 그대로 유지돼요. 잠시 후 다시 시도해 주세요."
  },
  AI_MODEL_UNAVAILABLE: {
    title: "리딩 설정을 확인해 주세요",
    description: "앱 리딩 값을 정리하지 못했어요. 다시 시도해 주세요."
  },
  AI_TIMEOUT: {
    title: "리딩을 정리하는 데 시간이 걸리고 있어요",
    description: "선택한 카드는 그대로 유지돼요. 다시 시도해 주세요."
  },
  AI_RESPONSE_EMPTY: {
    title: "리딩 결과를 받지 못했어요",
    description: "선택한 카드는 그대로 유지돼요. 다시 시도해 주세요."
  },
  AI_RESPONSE_INVALID: {
    title: "리딩 결과를 정리하지 못했어요",
    description: "선택한 카드와 결제 내역은 그대로 유지돼요. 추가 결제 없이 다시 시도해 주세요."
  },
  AI_RESPONSE_INCOMPLETE: {
    title: "정밀 리딩 값을 완성하지 못했어요",
    description: "풍부한 서술 필터에 맞추어 리딩을 한 번 더 보완하고 있습니다. 카드는 보존되니 안심하고 다시 시도해 주세요."
  },
  NETWORK_ERROR: {
    title: "서비스에 연결하지 못했어요",
    description: "인터넷 연결을 확인한 뒤 다시 시도해 주세요."
  }
};

function getStandardReadingErrorCode(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || 'NETWORK_ERROR');
  if (ERROR_DETAILS[raw]) return raw;
  if (raw.includes('timeout') || raw.includes('TIMEOUT')) return 'AI_TIMEOUT';
  if (raw.includes('rate') || raw.includes('429')) return 'AI_RATE_LIMIT';
  if (raw.includes('network') || raw.includes('fetch') || raw.includes('Failed to fetch')) return 'NETWORK_ERROR';
  return 'AI_RESPONSE_INVALID';
}

export function ReadingResultView(props: ReadingResultViewProps) {
  // Loading states
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingStep, setLoadingStep] = useState<string>("선택한 카드의 흐름을 연결하고 있어요.");
  const [loadingSub, setLoadingSub] = useState<string>("질문과 카드의 의미를 함께 살펴보는 중이에요. 잠시만 기다려 주세요.");
  const [loadingSession, setLoadingSession] = useState<number>(0);
  
  // Standard free results state
  const [result, setResult] = useState<StandardReadingResult | null>(null);
  const [freeError, setFreeError] = useState<string | null>(null);

  // Premium modal states
  const [showPaidModal, setShowPaidModal] = useState<boolean>(false);
  const [selectedProductType, setSelectedProductType] = useState<'one-question' | 'true-mind' | 'context-reading'>('one-question');
  
  // Premium user profile input questionnaire states (유료 리딩 사전 입력 항목)
  const [paidNickname, setPaidNickname] = useState<string>('');
  const [paidRelationship, setPaidRelationship] = useState<RelationshipType>('애매한 사이');
  const [paidLastContact, setPaidLastContact] = useState<string>('');
  const [paidSituation, setPaidSituation] = useState<string>('');
  const [paidQuestion, setPaidQuestion] = useState<string>('');

  // Premium checkout states
  const [modalStage, setModalStage] = useState<'questionnaire' | 'checkout' | 'result'>('questionnaire');
  const [checkoutStatus, setCheckoutStatus] = useState<'idle' | 'processing' | 'success' | 'failed' | 'canceled'>('idle');
  const [unlockedPaidResult, setUnlockedPaidResult] = useState<PaidReadingResult | null>(null);
  const [paidError, setPaidError] = useState<string | null>(null);
  const [paidAiLoading, setPaidAiLoading] = useState<boolean>(false);

  const [showInlinePassPrompt, setShowInlinePassPrompt] = useState(false);
  const [pendingFollowUpQuestion, setPendingFollowUpQuestion] = useState<string>('');
  const [adFollowUpLoading, setAdFollowUpLoading] = useState(false);
  const [adFollowUpMessage, setAdFollowUpMessage] = useState('');
  const [appShareMessage, setAppShareMessage] = useState('오늘 우리 사이 온도 봤어 🔮\n너도 한 번 확인해봐!');
  const [appShareLoading, setAppShareLoading] = useState(false);

  // States to animate cards and save records
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [hasChargedAccess, setHasChargedAccess] = useState<boolean>(false);
  const fetchKeyRef = useRef<string>('');
  const inFlightKeyRef = useRef<string>('');
  const completedKeyRef = useRef<string>('');
  const hasChargedAccessRef = useRef(false);

  // Suggested follow-up questions (dynamic based on relationship status and active menu)
  const [suggestedQuestions, setSuggestedQuestions] = useState<SuggestedQuestion[]>([]);

  useEffect(() => {
    setShowInlinePassPrompt(false);
    setPendingFollowUpQuestion('');
  }, [props.question, props.cards]);

  useEffect(() => {
    if (!props.initialReadingResult) {
      return;
    }

    setResult(normalizeApiReading(props.initialReadingResult));
    setFreeError(null);
    setLoading(false);
    completedKeyRef.current = 'shared-reading';
  }, [props.initialReadingResult]);

  useEffect(() => {
    if (!loading) {
      return;
    }

    const timer = window.setInterval(() => {
      setLoadingSub(current => pickNextLoadingMessage(current));
    }, 1800);

    return () => window.clearInterval(timer);
  }, [loading, loadingSession]);

  // Robust decoupled fetch reading supporting auto retries
  const fetchReading = async (isRetry = false) => {
    const fetchKey = JSON.stringify({
      version: props.menuId === 'daily-temperature' ? DAILY_TEMPERATURE_READING_VERSION : 'standard',
      menuId: props.menuId,
      question: props.question,
      situation: props.situation,
      cards: props.cards.map(card => ({
        id: card.id,
        isReversed: props.menuId === 'daily-temperature' ? false : card.isReversed,
      })),
      partnerId: props.partnerProfile?.id || '',
    });
    const requestId = `reading-${Date.now().toString(36)}-${hashReadingKey(fetchKey)}`;

    if (!isRetry && (inFlightKeyRef.current === fetchKey || completedKeyRef.current === fetchKey)) {
      return;
    }

    inFlightKeyRef.current = fetchKey;
    fetchKeyRef.current = fetchKey;
    setLoadingSession(current => current + 1);

    const loadingStartedAt = Date.now();
    const minimumLoadingMs = props.menuId === 'daily-temperature'
      ? (isRetry ? 800 : 1200)
      : (isRetry ? 250 : 350);

    if (props.menuId === 'daily-temperature') {
      setLoadingStep("오늘 우리 사이의 온도를 확인하고 있어요.");
      setLoadingSub("선택한 카드 한 장으로 오늘의 분위기를 읽는 중이에요. 잠시만 기다려 주세요.");
    } else {
      setLoadingStep("선택한 카드의 흐름을 연결하고 있어요.");
      setLoadingSub("질문과 카드의 의미를 함께 살펴보는 중이에요. 잠시만 기다려 주세요.");
    }

    try {
      setLoading(true);
      setFreeError(null);

      const persistentCachedResult = !isRetry ? readPersistentReading(fetchKey) : null;
      if (persistentCachedResult) {
        readingResultCache.set(fetchKey, persistentCachedResult);
        setResult(persistentCachedResult);
        completedKeyRef.current = fetchKey;
        return;
      }

      const activeLock = !isRetry ? readActiveReadingLock(fetchKey) : null;
      if (activeLock) {
        console.warn(`[READING_DUPLICATE_BLOCKED] ${requestId} skipped because ${activeLock.requestId} is still running for the same cards/question.`);
        const waitedResult = await waitForPersistedReading(fetchKey, activeLock);
        if (waitedResult) {
          readingResultCache.set(fetchKey, waitedResult);
          setResult(waitedResult);
          completedKeyRef.current = fetchKey;
          return;
        }
        if (props.menuId === 'daily-temperature') {
          const duplicateFallback = generateDailyTemperatureReading(props.cards[0]);
          readingResultCache.set(fetchKey, duplicateFallback);
          setResult(duplicateFallback);
          completedKeyRef.current = fetchKey;
          return;
        }
        throw new Error('AI_BUSY');
      }

      const cachedResult = !isRetry ? readingResultCache.get(fetchKey) : undefined;
      if (cachedResult) {
        setResult(cachedResult);
        completedKeyRef.current = fetchKey;
        return;
      }

      const storedDailyTemperatureReading = !isRetry && props.menuId === 'daily-temperature'
        ? getStoredDailyTemperatureReading(props.cards[0])
        : null;
      if (storedDailyTemperatureReading) {
        readingResultCache.set(fetchKey, storedDailyTemperatureReading);
        setResult(storedDailyTemperatureReading);
        completedKeyRef.current = fetchKey;
        return;
      }

      const existingRequest = !isRetry ? readingRequestCache.get(fetchKey) : undefined;
      if (!existingRequest) {
        writeReadingLock(fetchKey, requestId);
      }
      const requestPromise = existingRequest || (async () => {
        if (props.menuId === 'daily-temperature' || props.menuId === 'relation-temp') {
          return generateDailyTemperatureReading(props.cards[0]);
        }

        return postTarotReadingWithFallback({
          menuId: props.menuId,
          menuTitle: props.menuTitle,
          cards: props.cards,
          partnerNickname: props.partnerProfile?.nickname,
          relationship: props.partnerProfile?.relationship,
          lastContact: props.partnerProfile?.lastContact,
          contactStatus: props.partnerProfile?.contactStatus,
          question: props.question,
          situation: props.situation,
          questionCategory: props.menuId.startsWith('question-')
            ? props.menuId.replace('question-', '')
            : props.menuTitle,
          spreadRoles: getSpreadRoles(props.menuId),
          requestId,
        });
      })().catch((error) => {
        console.warn('AI reading failed, local fallback is disabled:', error);
        throw error;
      });

      if (!existingRequest && !isRetry) {
        readingRequestCache.set(fetchKey, requestPromise);
      }

      const readingData = await requestPromise;
      readingResultCache.set(fetchKey, readingData);
      writePersistentReading(fetchKey, props.menuId, readingData);

      if (readingData) {
        if (props.menuId === 'daily-temperature' && props.cards[0] && typeof window !== 'undefined') {
          const temperature = Number(readingData.temperature);
          if (Number.isFinite(temperature)) {
            localStorage.setItem(DAILY_TEMPERATURE_READING_KEY, JSON.stringify({
              date: getKstDateKey(),
              version: DAILY_TEMPERATURE_READING_VERSION,
              cardId: props.cards[0].id,
              isReversed: false,
              temperature,
              readingResult: readingData
            }));
          }
        }

        if (fetchKeyRef.current !== fetchKey) {
          return;
        }
        setFreeError(null);
        setResult(readingData);
        completedKeyRef.current = fetchKey;
      } else {
        throw new Error("AI_RESPONSE_EMPTY");
      }
    } catch (err: any) {
      if (fetchKeyRef.current !== fetchKey) {
        return;
      }
      console.error("Standard Reading Fetch Error:", err);
      if (props.menuId === 'daily-temperature') {
        const fallbackReading = generateDailyTemperatureReading(props.cards[0]);
        readingResultCache.set(fetchKey, fallbackReading);
        writePersistentReading(fetchKey, props.menuId, fallbackReading);
        const temperature = Number(fallbackReading.temperature);
        if (props.cards[0] && typeof window !== 'undefined' && Number.isFinite(temperature)) {
          localStorage.setItem(DAILY_TEMPERATURE_READING_KEY, JSON.stringify({
            date: getKstDateKey(),
            version: DAILY_TEMPERATURE_READING_VERSION,
            cardId: props.cards[0].id,
            isReversed: false,
            temperature,
            readingResult: fallbackReading
          }));
        }

        setFreeError(null);
        setResult(fallbackReading);
        completedKeyRef.current = fetchKey;
        return;
      }

      setResult(null);
      setFreeError(getStandardReadingErrorCode(err));

    } finally {
      if (inFlightKeyRef.current === fetchKey) {
        inFlightKeyRef.current = '';
      }
      if (readingRequestCache.get(fetchKey)) {
        readingRequestCache.delete(fetchKey);
      }
      clearReadingLock(fetchKey, requestId);
      const remainingLoadingMs = minimumLoadingMs - (Date.now() - loadingStartedAt);
      if (remainingLoadingMs > 0) {
        await new Promise(resolve => setTimeout(resolve, remainingLoadingMs));
      }
      if (fetchKeyRef.current === fetchKey) {
        setLoading(false);
      }
    }
  };

  // 1. Initial Standard Reading fetch on mount
  const cardsSignature = props.cards
    .map(card => `${card.id}:${props.menuId === 'daily-temperature' ? 'U' : (card.isReversed ? 'R' : 'U')}`)
    .join('|');
  const partnerSignature = props.partnerProfile?.id || '';

  useEffect(() => {
    const queries = getSuggestedQuestions(props.partnerProfile?.relationship, props.menuId);
    setSuggestedQuestions(queries);

    if (props.initialReadingResult) {
      return;
    }

    fetchReading();
  }, [props.menuId, cardsSignature, partnerSignature, props.situation, props.question]);

  useEffect(() => {
    if (loading || freeError || !result || isFreeTemperatureMenu(props.menuId) || props.initialReadingResult) {
      return;
    }

    const chargedKey = completedKeyRef.current || fetchKeyRef.current;
    if (!chargedKey || chargedReadingKeys.has(chargedKey)) {
      return;
    }

    if (hasPersistentlyChargedReading(chargedKey)) {
      chargedReadingKeys.add(chargedKey);
      hasChargedAccessRef.current = true;
      setHasChargedAccess(true);
      return;
    }

    const chargeAfterSuccessfulPaint = window.setTimeout(() => {
      if (freeError || !result || completedKeyRef.current !== chargedKey || chargedReadingKeys.has(chargedKey)) {
        return;
      }

      const charged = props.onReadingSuccess?.();
      if (charged === false) {
        return;
      }

      chargedReadingKeys.add(chargedKey);
      markPersistentlyChargedReading(chargedKey);
      hasChargedAccessRef.current = true;
      setHasChargedAccess(true);
    }, 0);

    return () => window.clearTimeout(chargeAfterSuccessfulPaint);
  }, [loading, freeError, result, props.menuId, props.onReadingSuccess]);

  // Handle click on suggested questions or directly buying a product
  const handleTriggerPremium = (productType: 'one-question' | 'true-mind' | 'context-reading', presetQuestion?: string) => {
    setSelectedProductType(productType);
    
    // Auto populate questionnaire states with existing partner info or presets
    setPaidNickname(props.partnerProfile?.nickname || '');
    setPaidRelationship((props.partnerProfile?.relationship as RelationshipType) || '애매한 사이');
    setPaidLastContact(props.partnerProfile?.lastContact || '');
    setPaidSituation(props.situation || '');
    setPaidQuestion(presetQuestion || '');

    setModalStage('questionnaire');
    setCheckoutStatus('idle');
    setUnlockedPaidResult(null);
    setPaidError(null);
    setPaidAiLoading(false);
    setShowPaidModal(true);
  };

  // Payment must be unlocked only by a real app/payment success callback.
  const handlePaymentUnavailable = () => {
    setPaidError(null);
    alert('결제는 곧 열릴 예정이에요.');
  };

  // Local premium deep reading logic. API/Gemini is intentionally not used.
  const handleFetchPremiumDeepReading = async (isRetry = false) => {
    setPaidAiLoading(true);
    setPaidError(null);

    try {
      await new Promise(resolve => setTimeout(resolve, isRetry ? 350 : 650));
      const parsedData = generateLocalPaidReading({
        cards: props.cards,
        question: paidQuestion || props.question,
        relationship: paidRelationship || props.partnerProfile?.relationship,
      }) as PaidReadingResult;
      setUnlockedPaidResult(parsedData);
    } catch (err: any) {
      console.error("Premium Local Reading Error:", err);
      setPaidError("AI_RESPONSE_INVALID");

    } finally {
      setPaidAiLoading(false);
    }
  };

  // Quick manual save configuration
  const handleSaveDiary = () => {
    if (!result && !unlockedPaidResult) return;
    
    // 1. Save reading result to local readingStorage history
    if (unlockedPaidResult) {
      readingStorage.saveReading({
        question: paidQuestion || `[심층] ${getProductByType(selectedProductType).name}`,
        partnerNickname: paidNickname || '그 사람',
        relationship: paidRelationship || '애매한 사이',
        cards: props.cards,
        readingResult: {
          premiumConclusion: unlockedPaidResult.premiumConclusion,
          partnerEmotionSituation: unlockedPaidResult.partnerEmotionSituation,
          actionPossibility: unlockedPaidResult.actionPossibility,
          relationshipBarrier: unlockedPaidResult.relationshipBarrier,
          expectedResponse: unlockedPaidResult.expectedResponse,
          detailedAdvice: unlockedPaidResult.detailedAdvice
        },
        productType: selectedProductType,
        isPaid: true
      });
    } else if (result) {
      const defaultResultMap = {
        card1Meaning: result.card1Meaning || (result as any).todayEmotion || (result as any).outwardAttitude || (result as any).partnerCondition || (result as any).partnerFeeling || (result as any).earlyWeek,
        card2Meaning: result.card2Meaning || (result as any).incomingPersonOrEvent || (result as any).realFeeling || (result as any).expectedResponse || (result as any).relationshipBarrier || (result as any).midWeek,
        card3Meaning: result.card3Meaning || (result as any).actionAdvice || (result as any).futureAction || (result as any).recommendedApproach || (result as any).nearFuture || (result as any).lateWeek,
        totalFlow: result.totalFlow || (result as any).conclusion || (result as any).hiddenEmotion || (result as any).conversationPossibility || (result as any).turningPoint,
        caution: result.caution || (result as any).avoidMessage,
        actionAdvice: result.actionAdvice || (result as any).recommendedApproach
      };

      readingStorage.saveReading({
        question: props.question || `[${props.menuTitle}]`,
        partnerNickname: props.partnerProfile?.nickname,
        relationship: props.partnerProfile?.relationship,
        cards: props.cards,
        readingResult: {
          oneLineConclusion: result.oneLineConclusion,
          ...defaultResultMap,
          ...result
        },
        productType: 'free',
        isPaid: false
      });
    }

    // A general question should never create a fictional relationship profile.
    const category = props.menuTitle as QuestionCategory;
    if (props.menuId.startsWith('question-') && (!props.partnerProfile || !isRelationshipCategory(category))) {
      setIsSaved(true);
      return;
    }

    // 2. Save to partner profile temperature logs
    const storedProfiles = localStorage.getItem('tarot_partner_profiles');
    let currentProfiles: PartnerProfile[] = [];
    if (storedProfiles) {
      try {
        const parsed = JSON.parse(storedProfiles);
        currentProfiles = Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        console.error("Local profile parse error during diary update:", err);
      }
    }

    const todayDateStr = `${new Date().getMonth() + 1}.${new Date().getDate()}`;
    const temperatureVal = result ? (result.temperature || 45) : 55;
    const summaryStr = unlockedPaidResult 
      ? `[심층] ${props.cards.map(c => c.nameKr).join(', ')} 카드로 분석한 깊은 속마음`
      : `[${props.menuTitle}] ${props.cards.map(c => c.nameKr).join(', ')} 카드로 확인한 온도 (한 줄평: ${result?.oneLineConclusion?.substring(0, 20)}...)`;

    let activeProfile = props.partnerProfile;
    if (!activeProfile) {
      activeProfile = {
        id: `partner-${Date.now()}`,
        nickname: unlockedPaidResult ? paidNickname : '그 사람',
        relationship: unlockedPaidResult ? paidRelationship : '애매한 사이',
        lastContact: unlockedPaidResult ? paidLastContact : '최근 연락 없음',
        contactStatus: '자세히 지켜보는 중',
        temperatureHistory: []
      };
    }

    const targetIndex = currentProfiles.findIndex(p => p.id === activeProfile?.id);
    if (targetIndex !== -1) {
      currentProfiles[targetIndex].temperatureHistory.push({
        date: todayDateStr,
        temperature: temperatureVal,
        summary: summaryStr
      });
      if (currentProfiles[targetIndex].temperatureHistory.length > 7) {
        currentProfiles[targetIndex].temperatureHistory.shift();
      }
    } else {
      const finalId = activeProfile.id?.startsWith('opinion-') || !activeProfile.id ? `partner-${Date.now()}` : activeProfile.id;
      const newRealProfile: PartnerProfile = {
        id: finalId,
        nickname: activeProfile.nickname || '그 사람',
        relationship: activeProfile.relationship || '애매한 사이',
        lastContact: activeProfile.lastContact || '최근 연락 없음',
        contactStatus: activeProfile.contactStatus || '자세히 지켜보는 중',
        temperatureHistory: [
          {
            date: todayDateStr,
            temperature: temperatureVal,
            summary: summaryStr
          }
        ]
      };
      currentProfiles.unshift(newRealProfile);
    }

    localStorage.setItem('tarot_partner_profiles', JSON.stringify(currentProfiles));
    setIsSaved(true);
  };

  const handleShareAppFromResult = async () => {
    if (appShareLoading) return;
    setAppShareLoading(true);

    const rewarded = props.onClaimShareRewardPass
      ? await props.onClaimShareRewardPass()
      : false;

    setAppShareLoading(false);

    if (rewarded) {
      setAppShareMessage('앱 공유가 완료됐어요. 질문권 1개가 지급됐어요.');
    }
  };

  const handleFollowUpClick = (followUp: string) => {
    if ((props.questionPassBalance ?? 0) < READING_TOKEN_COST) {
      setPendingFollowUpQuestion(followUp);
      setShowInlinePassPrompt(true);
      return;
    }

    props.onAskFollowUp?.(followUp);
  };

  const handleAdFollowUpClick = async () => {
    if (!pendingFollowUpQuestion || !props.onUseAdReadingAccess) {
      props.onChargeQuestionPass?.();
      return;
    }

    if (adFollowUpLoading) return;
    setAdFollowUpMessage('광고를 여는 중이에요.');
    setAdFollowUpLoading(true);
    const granted = await props.onUseAdReadingAccess();
    setAdFollowUpLoading(false);
    if (!granted) {
      setAdFollowUpMessage('광고를 열지 못했어요. 토스 앱 최신 버전에서 다시 시도해 주세요.');
      return;
    }

    setAdFollowUpMessage('');
    setShowInlinePassPrompt(false);
    props.onAskFollowUp?.(pendingFollowUpQuestion);
  };

  // Rendering Loading View
  if (loading && (!result || props.menuId === 'daily-temperature')) {
    return (
      <div className="flex-grow flex flex-col items-center justify-center py-20 px-8 text-center bg-[#FAF9F5]/70 h-full">
        <div className="w-16 h-16 rounded-full bg-[#F3EFE6] flex items-center justify-center border-4 border-dashed border-[#BD6B65] animate-spin">
          <Heart className="w-8 h-8 text-[#BD6B65] fill-[#F7D7D3]" />
        </div>
        <h3 className="font-serif text-lg font-bold text-[#3C2F2F] mt-8 animate-pulse">
          {formatKoreanTextWithNowrap(loadingStep)}
        </h3>
        <p className="text-xs text-[#8A7A71] mt-3 tracking-wide px-4 leading-relaxed break-keep">
          {formatKoreanTextWithNowrap(loadingSub)}
        </p>
      </div>
    );
  }

  const isDailyTemperature = props.menuId === 'daily-temperature';
  if (!result && !isDailyTemperature) {
    const errorDetail = ERROR_DETAILS[freeError || 'AI_RESPONSE_INVALID'] || ERROR_DETAILS.AI_RESPONSE_INVALID;
    return (
      <div className="flex-grow flex flex-col items-center justify-center px-8 py-20 text-center bg-[#FAF9F5]">
        <AlertTriangle className="w-12 h-12 text-[#BD6B65] mb-5" />
        <h3 className="font-serif text-[18px] font-bold text-[#3C2F2F]">
          {errorDetail.title}
        </h3>
        <p className="mt-3 text-[14px] leading-relaxed text-[#8A7A71] break-keep">
          {errorDetail.description}
        </p>
        <button
          type="button"
          onClick={() => void fetchReading(true)}
          className="mt-7 min-h-[48px] w-full max-w-[320px] rounded-[14px] bg-[#BD6B65] text-[14px] font-serif font-bold text-white shadow-[0_10px_18px_rgba(189,107,101,0.18)]"
        >
          다시 시도하기
        </button>
        <button
          type="button"
          onClick={props.onBackToHome}
          className="mt-3 text-[13px] font-serif font-bold text-[#8A7A71]"
        >
          홈으로
        </button>
      </div>
    );
  }

  const activeResult = result || generateDailyTemperatureReading(props.cards[0]);
  const finalTemp = activeResult.temperature ?? 45;
  const displayMenuTitle = activeResult.questionCategory || props.menuTitle;
  const dailyTemperatureMeaning = (activeResult.card1Meaning || activeResult.totalFlow || activeResult.oneLineConclusion || '')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 7)
    .join('\n');

  return (
    <div className="flex-grow flex flex-col justify-start px-6 pb-24 overflow-y-auto selection:bg-rose-100 animate-fadeIn bg-[#FAF9F5]">
      
      {/* 1. Header Navigation */}
      <div className="flex justify-between items-center py-3 border-b border-[#EAE3D2] mb-5">
        <span className="text-[13px] font-serif font-bold text-[#BD6B65] bg-rose-50 px-3 py-1 rounded-full uppercase">
          {displayMenuTitle} 결과
        </span>
        <button
          onClick={props.onBackToHome}
          className="text-[14px] text-[#8A7A71] hover:text-[#BD6B65] font-semibold cursor-pointer"
        >
          홈으로
        </button>
      </div>

      {/* #1. 사용자가 입력한 질문 */}
      <div className="mb-4 p-4 rounded-2xl bg-white border border-[#EAE3D2]">
        <span className="text-[13px] font-bold text-[#BD6B65] font-serif">1. 내가 물어본 질문</span>
        <p className="mt-1.5 text-[17px] font-serif font-bold text-[#3C2F2F] leading-relaxed break-keep">
          “{props.question || props.situation || props.menuTitle}”
        </p>
      </div>

      {/* #2. 질문에 대한 답 */}
      {activeResult.oneLineConclusion && (
        <div className="p-6 rounded-2xl bg-[#F3EFE6] border border-[#EAE3D2] relative overflow-hidden mb-6 text-center shadow-xs">
          <div className="absolute right-4 top-4">
            <Heart className="w-5 h-5 text-[#E6A19C]/40 fill-[#E6A19C]/20 animate-pulse" />
          </div>
          <span className="text-[13px] font-serif font-bold tracking-widest text-[#8A7A71]">2. 질문에 대한 답</span>
          <h2 className="font-serif text-[18px] font-bold text-[#BD6B65] mt-1.5 leading-[1.55] break-keep px-2">
            “{activeResult.oneLineConclusion}”
          </h2>
          {!props.menuId.startsWith('question-') && !isDailyTemperature && (
            <>
              <div className="w-8 h-[1px] bg-[#EAE3D2] mx-auto my-3" />
              <p className="text-[14px] text-[#8A7A71] leading-relaxed font-sans">
                오늘 우리 사이 온도는 <strong className="text-[#BD6B65]">{finalTemp}°C</strong> 입니다.
              </p>
            </>
          )}
        </div>
      )}

      {/* #2. 사용자가 선택한 카드 */}
      <div className="space-y-4 mb-6">
        <h4 className="font-serif text-[15px] font-bold text-[#3C2F2F] tracking-wide uppercase flex items-center gap-1.5 break-keep">
          <span>{isDailyTemperature ? '3. 오늘의 온도 카드' : '3. 선택한 카드 3장'}</span>
        </h4>

        <div className={isDailyTemperature ? "mx-auto grid max-w-[120px] grid-cols-1 gap-3" : "grid grid-cols-3 gap-3"}>
          {props.cards.map((card) => {
            const displayCard = isDailyTemperature ? { ...card, isReversed: false } : card;
            return (
              <div 
                key={`gallery-card-${card.id}`}
                className="transition-none"
              >
                <TarotCardImage card={displayCard} />
              </div>
            );
          })}
        </div>
      </div>

      {/* #3. 상황별 해석 */}
      <div className={isDailyTemperature ? "mb-4" : "space-y-3.5 mb-6"}>
        {!isDailyTemperature && (
          <h4 className="font-serif text-[15px] font-bold text-[#3C2F2F] tracking-wide uppercase">
            4. 상황별 해석
          </h4>
        )}

        <div className="space-y-3">
          {props.cards.map((card, idx) => {
            const aiRole = typeof activeResult.cards?.[idx]?.role === 'string'
              ? activeResult.cards[idx].role.trim()
              : '';
            const cleanAiRole = aiRole
              .replace(/^(첫|두|세)\s*번째\s*카드\s*[:：]\s*/g, '')
              .replace(/^\d+\s*번째\s*카드\s*[:：]\s*/g, '')
              .trim();
            let roleLabel = cleanAiRole
              ? `${idx + 1}번째 카드: ${cleanAiRole}`
              : `${idx + 1}번째 카드`;
            if (isDailyTemperature) {
              roleLabel = '오늘의 온도를 보여주는 카드';
            }

            const interpretationText = idx === 0 
              ? activeResult.card1Meaning 
              : idx === 1 
              ? activeResult.card2Meaning 
              : activeResult.card3Meaning;

            return (
              <div
                key={`meanings-tile-${idx}`}
                className={isDailyTemperature
                  ? "p-4 rounded-xl bg-white/70 border border-[#EAE3D2] flex flex-col space-y-1"
                  : "p-4 rounded-xl bg-[#F3EFE6]/30 border border-[#EAE3D2] flex flex-col space-y-1"
                }
              >
                {isDailyTemperature && (
                  <h4 className="font-serif text-[15px] font-bold text-[#3C2F2F] mb-2">
                    4. 오늘의 온도 해석
                  </h4>
                )}
                {!isDailyTemperature && (
                  <span className="text-[13px] font-bold text-[#BD6B65] font-serif uppercase tracking-tight">
                    {roleLabel}
                  </span>
                )}
                {!isDailyTemperature && (
                  <span className="text-[15px] font-bold text-[#3C2F2F] font-serif">
                    {`${idx + 1}번째 흐름`}
                  </span>
                )}
                <p className="text-[14.5px] text-[#5C4F4F] leading-relaxed pt-1.5 font-sans break-keep whitespace-pre-line">
                  {isDailyTemperature ? dailyTemperatureMeaning : interpretationText}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {isDailyTemperature && activeResult.caution && (
        <div className="mb-4 rounded-xl border border-[#F2D1CD] bg-[#FADBD8]/25 p-4">
          <h4 className="mb-2 font-serif text-[15px] font-bold text-[#C0392B]">
            6. 오늘 조심할 점
          </h4>
          <p className="text-[14.5px] text-[#5C4F4F] leading-relaxed font-sans break-keep whitespace-pre-line">
            {activeResult.caution}
          </p>
        </div>
      )}

      {isDailyTemperature && activeResult.actionAdvice && (
        <div className="mb-6 rounded-[20px] border border-[#E8D7C5] bg-[linear-gradient(135deg,#FFFDF8_0%,#F8EFE4_100%)] p-4 shadow-[0_8px_18px_rgba(130,93,74,0.045)]">
          <h4 className="mb-2 font-serif text-[15px] font-bold text-[#8F6B58]">
            7. 오늘 해보면 좋은 행동
          </h4>
          <p className="text-[14.5px] text-[#5C4F4F] leading-relaxed font-sans break-keep whitespace-pre-line">
            {activeResult.actionAdvice}
          </p>
        </div>
      )}

      {/* #5. 지금 주의할 점 */}
      {!isDailyTemperature && activeResult.caution && (
        <div className="p-4 rounded-xl bg-[#FADBD8]/25 border border-[#F2D1CD] mb-6 space-y-1">
          <span className="text-[15px] font-bold text-[#C0392B] font-serif flex items-center gap-1">
            5. 지금 주의할 점
          </span>
          <p className="text-[15.5px] text-[#5C4F4F] leading-relaxed font-sans break-keep whitespace-pre-line">
            {activeResult.caution}
          </p>
        </div>
      )}

      {/* #6. 지금 필요한 핵심 조언 */}
      {!isDailyTemperature && activeResult.actionAdvice && (() => {
        let adviceTitle = "6. 지금 필요한 조언";
        if (!props.menuId.startsWith('question-')) {
          if (props.menuId === 'dating-luck') adviceTitle = "오늘의 연애 조언";
          else if (props.menuId === 'inner-mind') adviceTitle = "지금 필요한 조언";
          else if (props.menuId === 'can-contact') adviceTitle = "연락할 때 참고할 점";
          else if (props.menuId === 'relation-temp') adviceTitle = "관계를 위한 조언";
          else if (props.menuId === 'relation-flow') adviceTitle = "이번 주 행동 조언";
        }

        return (
          <div className="p-5 rounded-2xl bg-[#F3EFE6]/30 border border-[#EAE3D2] mb-6">
            <h4 className="font-serif text-sm font-bold text-[#3C2F2F]">
              {adviceTitle}
            </h4>
            <div className="w-full h-[1px] bg-[#EAE3D2] my-2" />
            <p className="text-[15.5px] text-[#5C4F4F] leading-relaxed font-sans break-keep whitespace-pre-line">
              {activeResult.actionAdvice}
            </p>
          </div>
        );
      })()}

      {!isDailyTemperature && activeResult.followUpQuestions && activeResult.followUpQuestions.length > 0 && (
        <div className="relative w-full max-w-full overflow-visible p-5 rounded-2xl bg-[#FFFDFC] border border-[#E6A19C] mb-6">
          <h4 className="font-serif text-sm font-bold text-[#3C2F2F]">
            이어서 보면 더 선명해지는 질문
          </h4>
          <p className="mt-1 text-[14px] text-[#8A7A71] leading-relaxed">
            지금 리딩에서 걸린 부분은 질문권 {READING_TOKEN_COST}개로 새 카드 3장을 뽑아 바로 확인할 수 있어요.
          </p>
          <div className="mt-3 inline-flex items-center rounded-full border border-[#E6A19C] bg-[#FFFDFC] px-3 py-1.5 text-[13px] font-serif font-bold text-[#BD6B65]">
            남은 질문권 {props.questionPassBalance ?? 0}개
          </div>

          {showInlinePassPrompt && (props.questionPassBalance ?? 0) < READING_TOKEN_COST && (
            <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-[#3C2F2F]/10 px-3 backdrop-blur-[1px] animate-fadeIn">
              <div className="w-full max-w-[340px] rounded-[24px] border border-[#E6A19C] bg-[#FAF9F5] p-5 text-center shadow-[0_18px_40px_rgba(60,47,47,0.18)]">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-[#EAE3D2] bg-[#F3EFE6]">
                  <Sparkles className="h-4 w-4 text-[#BD6B65]" />
                </div>
                <div className="text-center">
                  <p className="font-serif text-[16px] font-bold text-[#3C2F2F]">질문권이 필요해요</p>
                  <p className="mt-2 text-[14px] leading-relaxed text-[#8A7A71] break-keep">
                    광고를 보면 하루 한 번 질문권 1개가 지급돼요.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={adFollowUpLoading}
                  onClick={handleAdFollowUpClick}
                  className="mt-4 min-h-[48px] w-full rounded-[14px] bg-[#BD6B65] text-[14px] font-serif font-bold text-white shadow-[0_10px_18px_rgba(189,107,101,0.18)] disabled:opacity-70"
                >
                  {adFollowUpLoading ? '광고 여는 중...' : '광고 보고 질문권 1개 받기'}
                </button>
                {adFollowUpMessage && (
                  <p className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-center text-[12px] leading-relaxed text-[#8A7A71] break-keep">
                    {adFollowUpMessage}
                  </p>
                )}
                <button
                  type="button"
                  onClick={props.onChargeQuestionPass}
                  className="mt-2 min-h-[42px] w-full rounded-[14px] border border-[#EAE3D2] bg-[#FFFDFC] text-[13px] font-serif font-bold text-[#BD6B65]"
                >
                  질문권 충전하기
                </button>
                <button
                  type="button"
                  onClick={() => setShowInlinePassPrompt(false)}
                  className="mt-2 w-full py-1.5 text-[12px] font-serif text-[#A69785]"
                >
                  닫기
                </button>
              </div>
            </div>
          )}

          <div className="mt-3 space-y-2">
            {activeResult.followUpQuestions.slice(0, 3).map((followUp, idx) => (
              <button
                key={`follow-up-${idx}`}
                type="button"
                onClick={() => handleFollowUpClick(followUp)}
                className="follow-up-question-button w-full min-w-0 max-w-full overflow-hidden text-left px-3.5 py-3 rounded-xl bg-[#F3EFE6]/55 border border-[#EAE3D2] text-[#3C2F2F] font-serif hover:border-[#E6A19C] hover:text-[#BD6B65] transition-colors"
              >
                <span className="block w-full min-w-0 max-w-full font-sans text-[14.5px] leading-relaxed">
                  {followUp}
                </span>
                <span className="mt-2 inline-flex w-fit max-w-full items-center rounded-full bg-white border border-[#E6A19C] text-[#BD6B65] text-[13px] px-3 py-1 font-bold">
                  새 카드 3장 · 질문권 {READING_TOKEN_COST}개
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* HORIZONTAL GAUGE DETAIL ON RELATION TEMPERATURE MENU */}
      {props.menuId === 'relation-temp' && (
        <div className="p-5 rounded-2xl bg-[#F3EFE6]/40 border border-[#EAE3D2] mb-6 space-y-3">
          <h4 className="font-serif text-xs font-bold text-[#3C2F2F] tracking-wide uppercase flex items-center gap-1.5">
            <Heart className="w-3 h-3 text-[#E6A19C]" />
            <span>우리 사이의 현재 상태</span>
          </h4>
          <div className="space-y-2.5">
            {[
              { label: '상대의 감정', val: Math.round(finalTemp * 0.9) },
              { label: '연락하고 싶은 마음', val: Math.round(finalTemp * 0.8) },
              { label: '방어심', val: Math.round(100 - finalTemp * 0.7) },
              { label: '관계 진전 가능성', val: finalTemp }
            ].map((bar, bIdx) => (
              <div key={`gauge-${bIdx}`} className="space-y-1">
                <div className="flex justify-between items-center text-[10.5px]">
                  <span className="text-[#3C2F2F] font-semibold font-serif">{bar.label}</span>
                  <span className="font-mono font-semibold text-[#BD6B65]">{bar.val}%</span>
                </div>
                <div className="w-full h-2 bg-[#FADBD8]/40 rounded-full overflow-hidden">
                  <div className="h-full bg-[#BD6B65] rounded-full" style={{ width: `${bar.val}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* QUICK WORKBOOK SAVING DIARY BUTTON */}
      <div className="mb-8 space-y-2">
        <button
          onClick={handleSaveDiary}
          disabled={isSaved}
          className={`w-full py-3.5 rounded-xl text-[15px] font-serif flex items-center justify-center space-x-2 transition-all ${
            isSaved 
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-700 cursor-default' 
              : 'bg-[#BD6B65] hover:bg-[#AC5B55] text-white cursor-pointer shadow-xs'
          }`}
        >
          <Save className="w-3.5 h-3.5" />
          <span>{isSaved ? "리딩 저장 완료!" : "8. 이 리딩 저장하기"}</span>
        </button>
        <button
          type="button"
          onClick={handleShareAppFromResult}
          disabled={appShareLoading}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#E6A19C] bg-[#FFFDFC] py-3.5 font-serif text-[15px] font-bold text-[#BD6B65] shadow-sm transition-colors hover:bg-[#FFF7F5] disabled:opacity-70 cursor-pointer"
        >
          <Share2 className="h-3.5 w-3.5" />
          <span>{appShareLoading ? '공유 여는 중...' : '앱 공유하고 질문권 1개 받기'}</span>
        </button>
        <button
          type="button"
          onClick={props.onBackToHome}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#3C2F2F] py-3.5 font-serif text-[15px] font-bold text-white shadow-sm transition-colors hover:bg-black cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>홈으로 돌아가기</span>
        </button>
        {isSaved && (
          <p className="mt-2 text-center text-[13px] text-[#8A7A71] font-sans">
            마이페이지의 저장한 리딩에서 다시 확인할 수 있어요.
          </p>
        )}
      </div>

      {false && !props.menuId.startsWith('question-') && (
      <>
      <div className="p-4 p-y-5 rounded-2xl bg-[#F3EFE6]/40 border border-[#E6A19C] text-center space-y-1 mb-6">
        <h3 className="font-serif text-[12.5px] font-bold text-[#BD6B65]">
          {formatKoreanTextWithNowrap("더 깊은 속마음과 앞으로의 행동까지 확인해 보세요.")}
        </h3>
        <p className="text-[10.5px] text-[#8A7A71] leading-relaxed max-w-xs mx-auto">
          {formatKoreanTextWithNowrap("지금 가장 궁금한 질문을 골라 더 자세히 확인해 보세요.")}
        </p>
      </div>

      {/* #7. 이어서 궁금해할 추가 질문 (Interactive deep questions) */}
      <div className="space-y-4 pt-4 border-t border-[#EAE3D2]">
        <div className="flex items-center space-x-1.5">
          <HelpCircle className="w-4 h-4 text-[#BD6B65]" />
          <h4 className="font-serif text-xs font-bold text-[#3C2F2F] uppercase">
            이어서 궁금한 질문
          </h4>
        </div>

        <div className="space-y-2.5">
          {suggestedQuestions.map((sq, sqIdx) => {
            const prod = getProductByType(sq.productType);
            return (
              <div 
                key={`suggested-q-${sqIdx}`}
                className="p-4 rounded-xl bg-amber-50/20 border border-[#E6A19C]/40 flex flex-col justify-between items-stretch gap-3 hover:bg-amber-50/50 transition-colors"
              >
                <div className="flex items-start space-x-2.5">
                  <span className="text-lg">🔮</span>
                  <div className="flex flex-col">
                    <span className="text-[10.5px] font-bold font-serif text-[#BD6B65]">
                      {prod.name} ({prod.price})
                    </span>
                    <span className="text-xs font-serif font-bold text-[#3C2F2F] leading-snug mt-1">
                      "{sq.question}"
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => handleTriggerPremium(sq.productType, sq.question)}
                  className="w-full py-2 bg-[#BD6B65] hover:bg-[#AC5B55] text-white text-[10.5px] font-serif rounded-lg flex items-center justify-center space-x-1 transition-transform cursor-pointer"
                >
                  <span>이 주제로 심층 리딩 확인하기 ({prod.price})</span>
                  <ArrowRight className="w-3 M-3" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      </>
      )}

      {/* DISCLAIMER TEXT (하단 필수 참고 문구) */}
      <div className="mx-auto mt-8 flex min-h-[96px] max-w-sm items-center justify-center px-4 text-center font-sans text-[13px] leading-relaxed text-[#A69785]">
        <p>타로는 지금의 흐름을 이해하고 방향을 잡기 위한 작은 나침반입니다.</p>
      </div>

      {/* 10. MOCKUP PAYMENTS DRAWER & CONFIGURATION FORM SLIDE-UP */}
      {showPaidModal && (
        <div className="fixed inset-0 bg-[#3C2F2F]/65 backdrop-blur-xs flex items-end justify-center z-[100] animate-fadeIn">
          <div className="w-full max-w-md bg-[#FAF9F5] rounded-t-[28px] p-6 border-t border-[#EAE3D2] shadow-2xl flex flex-col space-y-4 animate-slideUp max-h-[92vh] overflow-y-auto">
            
            <div className="flex justify-between items-center pb-2 border-b border-[#EAE3D2]/50">
              <span className="text-xs font-bold text-[#BD6B65] font-serif flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>{getProductByType(selectedProductType).name} ({getProductByType(selectedProductType).price})</span>
              </span>
              <button
                onClick={() => {
                  setShowPaidModal(false);
                  setCheckoutStatus('idle');
                  setUnlockedPaidResult(null);
                }}
                className="text-xs text-[#8A7A71] hover:text-[#BD6B65] cursor-pointer font-bold px-2 py-1"
              >
                닫기
              </button>
            </div>

            {/* WIZARD ENGINE */}
            {modalStage === 'questionnaire' && (
              <div className="space-y-4 text-left">
                <div className="bg-[#F3EFE6] p-3 rounded-xl border border-[#EAE3D2] text-[10.5px] leading-relaxed text-[#3C2F2F]">
                  <strong>💡 심층 리딩 추가 질문</strong><br />
                  {props.menuId.startsWith('question-')
                    ? '처음 질문에서 더 확인하고 싶은 부분을 적어 주세요. 같은 카드 3장을 바탕으로 더 구체적으로 답해 드려요.'
                    : '심층 리딩을 생성하기 전 기본 정보와 추가 질문을 설정해 주세요.'}
                </div>

                <div className="space-y-3">
                  {!props.menuId.startsWith('question-') && (
                  <>
                  {/* Name */}
                  <div className="flex flex-col space-y-1">
                    <label className="text-xs font-semibold text-[#3C2F2F]">그 사람 별명 * :</label>
                    <input
                      type="text"
                      value={paidNickname}
                      onChange={(e) => setPaidNickname(e.target.value)}
                      placeholder="예: 그 사람, 하늘이, 연우"
                      className="w-full px-3 py-2 bg-[#FAF9F5] border border-[#EAE3D2] rounded-xl text-xs focus:outline-none focus:border-[#BD6B65]"
                    />
                  </div>

                  {/* Relationship */}
                  <div className="flex flex-col space-y-1">
                    <label className="text-xs font-semibold text-[#3C2F2F]">현재 관계 흐름 :</label>
                    <select
                      value={paidRelationship}
                      onChange={(e) => setPaidRelationship(e.target.value as RelationshipType)}
                      className="w-full px-3 py-2 bg-[#FAF9F5] border border-[#EAE3D2] rounded-xl text-xs focus:outline-none focus:border-[#BD6B65]"
                    >
                      <option value="짝사랑">짝사랑</option>
                      <option value="썸">썸</option>
                      <option value="연락 중">연락 중</option>
                      <option value="연애 중">연애 중</option>
                      <option value="헤어진 상태">헤어진 상태</option>
                      <option value="연락 단절">연락 단절</option>
                      <option value="애매한 사이">애매한 사이</option>
                    </select>
                  </div>

                  {/* Last Contact */}
                  <div className="flex flex-col space-y-1">
                    <label className="text-xs font-semibold text-[#3C2F2F]">마지막 물리적 연락 시점 :</label>
                    <input
                      type="text"
                      value={paidLastContact}
                      onChange={(e) => setPaidLastContact(e.target.value)}
                      placeholder="예: 어제 저녁 짧게, 일주일 전 다툼 이후 끊김"
                      className="w-full px-3 py-2 bg-[#FAF9F5] border border-[#EAE3D2] rounded-xl text-xs focus:outline-none focus:border-[#BD6B65]"
                    />
                  </div>

                  {/* Situation (Max 200) */}
                  <div className="flex flex-col space-y-1">
                    <label className="text-xs font-semibold text-[#3C2F2F]">두 사람의 최근 상황 사연 (최대 200자) :</label>
                    <textarea
                      value={paidSituation}
                      onChange={(e) => setPaidSituation(e.target.value.substring(0, 200))}
                      placeholder="서로 오해한 부분이나 마음 졸이는 사정 등을 기입해 주세요."
                      className="w-full h-14 p-2 bg-[#FAF9F5] border border-[#EAE3D2] rounded-xl text-xs focus:outline-none focus:border-[#BD6B65] resize-none"
                    />
                    <span className="text-[9.5px] text-right text-[#8A7A71] block">{paidSituation.length} / 200자</span>
                  </div>
                  </>
                  )}

                  {/* Goal Question (Max 200) */}
                  <div className="flex flex-col space-y-1">
                    <label className="text-xs font-semibold text-[#3C2F2F]">지금 마음에 가장 궁금한 심층 질문 (최대 200자) :</label>
                    <textarea
                      value={paidQuestion}
                      onChange={(e) => setPaidQuestion(e.target.value.substring(0, 200))}
                      placeholder={props.menuId.startsWith('question-') ? "예: 이 선택을 하기 전에 가장 먼저 확인해야 할 조건은 무엇일까요?" : "예: 이 상황에서 제가 가장 먼저 확인해야 할 것은 무엇일까요?"}
                      className="w-full h-14 p-2 bg-[#FAF9F5] border border-[#EAE3D2] rounded-xl text-xs focus:outline-none focus:border-[#BD6B65] resize-none"
                    />
                    <span className="text-[9.5px] text-right text-[#8A7A71] block">{paidQuestion.length} / 200자</span>
                  </div>
                </div>

                <button
                  onClick={handlePaymentUnavailable}
                  disabled={!paidQuestion.trim() || (!props.menuId.startsWith('question-') && !paidNickname.trim())}
                  className={`w-full py-3.5 rounded-xl text-xs font-serif text-center cursor-pointer transition-colors ${
                    paidQuestion.trim() && (props.menuId.startsWith('question-') || paidNickname.trim())
                      ? 'bg-[#BD6B65] text-white hover:bg-[#AC5B55]'
                      : 'bg-gray-200 text-[#A69785] cursor-not-allowed'
                  }`}
                >
                  추가 질문 입력 완료
                </button>
              </div>
            )}

            {modalStage === 'checkout' && (
              <div className="space-y-4 text-center">
                <p className="text-[14px] text-[#3C2F2F] leading-relaxed font-sans px-2">
                  결제는 곧 열릴 예정이에요.
                </p>

                <div className="p-3 bg-[#F3EFE6]/60 rounded-xl border border-[#EAE3D2] text-[13px] text-left leading-relaxed text-[#3C2F2F] space-y-1">
                  <p className="truncate">질문: “{paidQuestion}”</p>
                  <p>상품: {getProductByType(selectedProductType).name} · {getProductByType(selectedProductType).price}</p>
                </div>

                {checkoutStatus === 'processing' ? (
                  <div className="py-6 flex flex-col items-center justify-center space-y-2">
                    <div className="w-8 h-8 rounded-full border-4 border-[#BD6B65] border-t-transparent animate-spin" />
                    <p className="text-xs text-[#8A7A71]">결제 승인 상태를 확인하고 있습니다...</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={handlePaymentUnavailable}
                      className="w-full py-3.5 bg-[#BD6B65] hover:bg-[#AC5B55] text-white text-xs font-serif rounded-xl cursor-pointer font-bold"
                    >
                      결제하기
                    </button>
                    
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      <button
                        onClick={handlePaymentUnavailable}
                        className="py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs rounded-xl cursor-pointer"
                      >
                        결제 실패 안내
                      </button>
                      <button
                        onClick={handlePaymentUnavailable}
                        className="py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs rounded-xl cursor-pointer"
                      >
                        결제 취소 안내
                      </button>
                    </div>
                  </div>
                )}

                {/* Display Payment Error Statuses */}
                {paidError === 'payment-failed' && (
                  <div className="p-3 rounded-lg bg-rose-50 text-rose-700 text-xs border border-rose-100">
                    결제 전송에 실패하였습니다. 다시 거래를 체결해 주세요.
                  </div>
                )}
                {paidError === 'payment-canceled' && (
                  <div className="p-3 rounded-lg bg-gray-50 text-gray-600 text-xs border border-gray-100">
                    결제가 중도에 취소되었습니다. 다시 진행해 주세요.
                  </div>
                )}
              </div>
            )}

            {modalStage === 'result' && (
              <div className="space-y-4 text-left">
                {paidAiLoading ? (
                  <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
                    <div className="w-10 h-10 rounded-full border-4 border-solid border-[#BD6B65] border-t-transparent animate-spin" />
                    <h5 className="font-serif text-sm font-bold text-[#3C2F2F]">프리미엄 집중 분석 독해 가동 중</h5>
                    <p className="text-[10.5px] text-[#8A7A71]">추가 질문과 카드의 의미를 깊이 연결하는 중이에요...</p>
                  </div>
                ) : paidError ? (
                  /* Paid Reading creation failed */
                  <div className="p-6 text-center space-y-4">
                    <AlertTriangle className="w-10 h-10 text-[#BD6B65] mx-auto animate-bounce" />
                    <div>
                      <h4 className="font-serif text-sm font-bold text-[#3C2F2F]">
                        {formatKoreanTextWithNowrap(ERROR_DETAILS[paidError]?.title || "리딩 결과를 정리하지 못했어요")}
                      </h4>
                      <p className="text-[11px] text-[#8A7A71] mt-1.5 leading-relaxed break-keep font-sans animate-fadeIn">
                        {formatKoreanTextWithNowrap(ERROR_DETAILS[paidError]?.description || "선택한 카드와 결제 내역은 그대로 유지돼요. 추가 결제 없이 다시 시도해 주세요.")}
                      </p>
                    </div>
                    <button
                      onClick={() => handleFetchPremiumDeepReading()}
                      className="w-full py-2.5 bg-[#BD6B65] text-white text-xs font-serif rounded-xl flex items-center justify-center gap-1.5 hover:bg-[#AC5B55] transition-colors cursor-pointer shadow-sm"
                    >
                      <RefreshCcw className="w-3.5 h-3.5" />
                      <span>추가 결제 없이 다시 시도하기</span>
                    </button>
                    
                  </div>
                ) : unlockedPaidResult ? (
                  /* Unlocked paid deep results sequence inside the modal drawer */
                  <div className="space-y-4 animate-fadeIn text-left">
                    <div className="p-3 bg-emerald-50 text-emerald-800 text-[11px] flex items-center gap-1.5 rounded-lg border border-emerald-100 font-sans">
                      <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                      <span>심층 리딩 분석이 완료되었습니다.</span>
                    </div>

                    <div className="space-y-3.5 max-h-[360px] overflow-y-auto pr-1">
                      {/* Premium Conclusion */}
                      <div className="p-4 rounded-xl bg-amber-50/30 border border-amber-200 text-xs">
                        <span className="text-[10px] text-[#BD6B65] font-serif font-bold uppercase block mb-1">심층 분석 결론</span>
                        <p className="font-serif text-[#3C2F2F] leading-relaxed italic block break-keep">
                          “{unlockedPaidResult.premiumConclusion}”
                        </p>
                      </div>

                      {/* Partner real emotions */}
                      <div className="p-4 rounded-xl bg-[#FAF9F5] border border-[#EAE3D2] text-xs">
                        <span className="text-[10px] text-[#BD6B65] font-serif font-bold uppercase block mb-1">
                          {props.menuId.startsWith('question-') ? '현재 상황의 핵심' : '상대의 현재 감정'}
                        </span>
                        <p className="text-[#5C4F4F] leading-relaxed block break-keep font-sans">
                          {unlockedPaidResult.partnerEmotionSituation}
                        </p>
                      </div>

                      {/* Moving action possibility */}
                      <div className="p-4 rounded-xl bg-[#FAF9F5] border border-[#EAE3D2] text-xs">
                        <span className="text-[10px] text-[#BD6B65] font-serif font-bold uppercase block mb-1">
                          {props.menuId.startsWith('question-') ? '앞으로의 가능성' : '앞으로 보일 행동'}
                        </span>
                        <p className="text-[#5C4F4F] leading-relaxed block break-keep font-sans">
                          {unlockedPaidResult.actionPossibility}
                        </p>
                      </div>

                      {/* Relationship barrier */}
                      <div className="p-4 rounded-xl bg-[#FAF9F5] border border-[#EAE3D2] text-xs">
                        <span className="text-[10px] text-[#BD6B65] font-serif font-bold uppercase block mb-1">
                          {props.menuId.startsWith('question-') ? '흐름을 막는 조건' : '관계를 막는 부분'}
                        </span>
                        <p className="text-[#5C4F4F] leading-relaxed block break-keep font-sans">
                          {unlockedPaidResult.relationshipBarrier}
                        </p>
                      </div>

                      {/* Expected reaction */}
                      <div className="p-4 rounded-xl bg-[#FAF9F5] border border-[#EAE3D2] text-xs">
                        <span className="text-[10px] text-[#BD6B65] font-serif font-bold uppercase block mb-1">
                          {props.menuId.startsWith('question-') ? '작게 실행했을 때의 흐름' : '질문자님이 연락했을 때 상대의 예상 반응'}
                        </span>
                        <p className="text-[#5C4F4F] leading-relaxed block break-keep font-sans">
                          {unlockedPaidResult.expectedResponse}
                        </p>
                      </div>

                      {/* Core action advice prescription */}
                      <div className="p-4 rounded-xl bg-teal-50/20 border border-teal-200/50 text-xs font-sans">
                        <span className="text-[10px] text-[#BD6B65] font-serif font-bold block mb-1">지금 필요한 조언</span>
                        <p className="text-teal-900 leading-relaxed block break-keep">
                          {unlockedPaidResult.detailedAdvice}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setShowPaidModal(false);
                        setCheckoutStatus('idle');
                        setUnlockedPaidResult(null);
                      }}
                      className="w-full py-3.5 bg-[#3C2F2F] hover:bg-black text-white text-xs font-serif rounded-xl text-center cursor-pointer font-bold shadow-xs transition-colors"
                    >
                      확인 완료
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

