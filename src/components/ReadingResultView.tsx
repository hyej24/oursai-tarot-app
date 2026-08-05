import React, { useState, useEffect, useRef } from 'react';
import { Heart, Save, ArrowLeft, HelpCircle, ArrowRight, ShieldCheck, Check, AlertTriangle, RefreshCcw, Sparkles } from 'lucide-react';
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

function generateDailyTemperatureReading(card: TarotCard | undefined): StandardReadingResult {
  if (!card) {
    return {
      oneLineConclusion: '오늘 우리 사이 온도는 36.8도예요. 서로의 반응을 조심스럽게 살피는 온도예요.',
      questionCategory: '우리 사이 온도',
      card1Meaning: '오늘은 서로의 눈치를 보며 온도를 맞춰 가는 흐름이에요.\n상대도 질문자님을 완전히 밖에 두고 있지는 않지만, 먼저 움직일 만큼 마음이 가볍지는 않아 보여요.\n작은 말투나 반응 하나에 분위기가 쉽게 달라질 수 있어요.\n그래서 오늘은 큰 확인보다 편한 접점 하나를 만드는 게 더 좋아요.',
      totalFlow: '오늘 우리 사이 온도는 36.8도예요.\n확 뜨겁게 몰아치는 날은 아니지만, 관계가 끊긴 느낌도 아니에요.\n서로 조심스럽게 거리를 재면서 반응을 살피는 흐름이에요.\n편하게 말을 열면 생각보다 분위기가 부드럽게 이어질 수 있어요.',
      caution: '상대의 반응을 너무 빨리 결론내리면 흐름이 어색해질 수 있어요.\n오늘은 답을 확인하려는 말보다 분위기를 풀어 주는 말이 더 잘 맞아요.\n질문자님 마음이 급해질수록 상대는 더 천천히 반응할 수 있어요.',
      actionAdvice: '짧고 편한 말로 시작해 보세요.\n무거운 질문보다 일상적인 한마디가 오늘은 더 자연스럽게 닿아요.\n답장을 기다릴 때도 바로 의미를 붙이지 말고, 전체 분위기를 보면서 천천히 이어가세요.',
      followUpQuestions: ['오늘 먼저 연락해도 괜찮을까요?', '그 사람의 진짜 마음은 무엇일까요?', '우리 관계는 앞으로 어떻게 흘러갈까요?'],
      temperature: 36.8,
    };
  }

  const affection = card.affectionScore ?? card.affection ?? 50;
  const contact = card.contactScore ?? card.communication ?? 50;
  const progress = card.progressScore ?? card.action ?? 50;
  const stability = card.stabilityScore ?? card.stability ?? 50;
  const defense = card.defenseScore ?? card.defense ?? 50;
  const cardIndex = Math.abs(Number(card.id || 0));
  const reversedPenalty = card.isReversed ? 0.35 : 0;
  const rawScore = affection * 0.34 + contact * 0.2 + progress * 0.18 + stability * 0.16 + (100 - defense) * 0.12;
  const suitTemperatureModifierMap: Record<string, number> = {
    cups: 0.18,
    wands: 0.08,
    pentacles: -0.12,
    swords: -0.22
  };
  const minorValueTemperatureModifierMap: Record<number, number> = {
    1: 0.18,
    2: 0.32,
    3: 0.18,
    4: -0.18,
    5: -0.62,
    6: 0.12,
    7: -0.24,
    8: -0.18,
    9: -0.08,
    10: 0.24,
    11: 0.08,
    12: 0.02,
    13: 0.18,
    14: 0.22
  };
  const majorTemperatureModifierMap: Record<number, number> = {
    0: 0.15,
    1: 0.32,
    2: -0.18,
    3: 0.58,
    4: 0.04,
    5: 0.08,
    6: 0.95,
    7: 0.38,
    8: 0.42,
    9: -0.42,
    10: 0.2,
    11: -0.06,
    12: -0.5,
    13: -0.75,
    14: 0.28,
    15: 0.54,
    16: -1.05,
    17: 0.68,
    18: -0.5,
    19: 1.05,
    20: 0.22,
    21: 0.78
  };
  const coldCardTemperatureModifierMap: Record<number, number> = {
    16: -1.1, // Tower
    18: -0.6, // Moon
    40: -0.7, // Five of Cups
    43: -0.8, // Eight of Cups
    52: -1.0, // Three of Swords
    54: -0.7, // Five of Swords
    57: -0.8, // Eight of Swords
    58: -0.9, // Nine of Swords
    59: -1.2, // Ten of Swords
    68: -1.3, // Five of Pentacles
  };
  const warmCardTemperatureModifierMap: Record<number, number> = {
    6: 0.8, // Lovers
    17: 0.5, // Star
    19: 0.9, // Sun
    36: 0.6, // Ace of Cups
    37: 0.8, // Two of Cups
    45: 0.7, // Ten of Cups
    69: 0.4, // Six of Pentacles
  };
  const cardTemperatureModifier =
    coldCardTemperatureModifierMap[Number(card.id)] ??
    warmCardTemperatureModifierMap[Number(card.id)] ??
    0;
  const suitTemperatureModifier = card.type === 'minor'
    ? suitTemperatureModifierMap[String(card.suit || '')] ?? 0
    : 0;
  const valueTemperatureModifier = card.type === 'minor'
    ? minorValueTemperatureModifierMap[Number(card.value)] ?? 0
    : majorTemperatureModifierMap[Number(card.id)] ?? 0;
  const cardFineTune = (((cardIndex * 37) % 13) - 6) * 0.045;
  const temperature = Number(Math.max(
    33.6,
    Math.min(
      40.2,
      34.25
        + rawScore * 0.056
        - reversedPenalty
        + suitTemperatureModifier
        + valueTemperatureModifier
        + cardTemperatureModifier
        + cardFineTune
    )
  ).toFixed(1));
  const temperatureFeel = temperature >= 39
    ? '꽤 뜨겁고 선명한 온도'
    : temperature >= 37.6
      ? '따뜻하게 살아 있는 온도'
      : temperature >= 36.4
        ? '조심스럽지만 꺼지지 않은 온도'
        : temperature >= 35.2
          ? '느리고 낮게 머무는 온도'
          : '서늘하고 조심스러운 온도';
  const cardTemperatureFlavorMap: Record<number, string> = {
    6: '서로를 의식하는 마음이 비교적 선명하게 살아 있는 흐름이에요.',
    9: '마음이 없는 것보다 혼자 정리할 시간이 더 필요한 흐름이에요.',
    12: '움직이고 싶어도 쉽게 움직이지 못하는 정체감이 보여요.',
    13: '예전 방식이 끝나고 다른 태도로 넘어가야 하는 전환점이 보여요.',
    16: '감정이 흔들린 뒤라 관계 온도가 갑자기 낮아지거나 불안정해질 수 있어요.',
    17: '당장 뜨겁진 않아도 다시 기대를 걸 수 있는 잔잔한 온기가 남아 있어요.',
    18: '마음보다 불안과 눈치가 앞서서 실제보다 더 차갑게 느껴질 수 있어요.',
    19: '감정이 비교적 밝고 숨김없이 드러나기 쉬운 따뜻한 흐름이에요.',
    37: '서로 마주 보는 감정선이 살아 있어서 관계 온도가 부드럽게 올라가기 쉬워요.',
    40: '아쉬움이나 후회가 남아 있어서 온기가 있어도 마음이 쉽게 가라앉을 수 있어요.',
    43: '마음을 접으려는 흐름이 섞여 있어서 다가가도 반응이 느리게 돌아올 수 있어요.',
    52: '상처나 섭섭함이 먼저 올라와서 오늘의 온도를 예민하게 만들 수 있어요.',
    57: '마음이 갇힌 듯해서 표현보다 고민이 많아지는 흐름이에요.',
    58: '걱정이 커져 실제 분위기보다 더 불안하게 느껴질 수 있어요.',
    59: '지친 마음이 강해서 지금은 온기를 바로 끌어올리기 어려워요.',
    68: '소외감이나 부족함이 먼저 느껴져서 오늘의 온도는 높게 잡기 어려워요.',
    69: '주고받는 균형이 맞으면 온도가 안정적으로 올라갈 수 있어요.',
  };
  const genericCardTemperatureFlavor = card.type === 'major'
    ? `오늘은 두 사람 사이의 큰 분위기가 먼저 움직여서, 작은 말보다 관계 전체의 흐름이 더 크게 느껴질 수 있어요.`
    : card.suit === 'cups'
      ? `감정의 물결이 예민하게 움직이는 날이에요. 좋아하는 마음이 있어도 기분과 분위기에 따라 온도가 달라질 수 있어요.`
      : card.suit === 'wands'
        ? `행동과 타이밍이 중요한 날이에요. 누가 먼저 움직이느냐에 따라 오늘 온도가 빠르게 달라질 수 있어요.`
        : card.suit === 'swords'
          ? `생각과 말의 온도가 크게 느껴지는 날이에요. 마음보다 판단이 앞서면 실제보다 차갑게 느껴질 수 있어요.`
          : `현실감과 안정감이 중요하게 작용하는 날이에요. 감정보다 상황, 여유, 거리감이 오늘 온도에 크게 작용해요.`;
  const cardTemperatureFlavor = cardTemperatureFlavorMap[Number(card.id)] || genericCardTemperatureFlavor;
  const heavyTemperatureCardIds = new Set([9, 12, 13, 16, 18, 40, 43, 52, 54, 57, 58, 59, 67, 68]);
  const isHeavyTemperatureCard = heavyTemperatureCardIds.has(Number(card.id)) || temperature < 36.2;
  const suitTone = card.type === 'major'
    ? '오늘은 작은 반응보다 관계 전체의 분위기가 더 크게 움직이는 날이에요.'
    : card.suit === 'cups'
      ? '감정선이 예민하게 살아 있어서 말투 하나에도 마음이 쉽게 흔들릴 수 있어요.'
      : card.suit === 'wands'
        ? '가만히 있기보다 어느 쪽이든 움직임이 생기기 쉬운 날이에요.'
        : card.suit === 'swords'
          ? '마음보다 생각이 앞서면서 서로의 말을 더 신중하게 재는 분위기예요.'
          : '현실적인 상황이나 각자의 일정이 관계 온도에 꽤 영향을 주는 날이에요.';
  const cardSpecificOpenings = [
    `오늘은 관계의 온도를 좌우하는 감정선이 평소보다 더 섬세하게 느껴져요.`,
    `오늘은 상대의 반응이 겉으로 보이는 것보다 한 번 더 걸러져 나올 수 있어요.`,
    `오늘은 평소보다 반응의 결이 조금 다르게 느껴질 수 있어요.`,
    `오늘은 마음이 바로 드러나기보다 한 번 더 생각을 거쳐 표현되는 흐름이에요.`,
    `오늘 두 사람 사이에는 작은 계기 하나가 생각보다 중요하게 작용해요.`,
    `지금 흐름은 단순히 좋다 싫다로 보기엔 결이 조금 섬세해요.`,
    `오늘은 상대의 속도와 질문자님의 기대 속도가 조금 다를 수 있어요.`,
    `오늘은 반응이 바로 오지 않아도 그 자체로 의미가 없다고 보긴 어려워요.`
  ];
  const cardSpecificOpening = cardSpecificOpenings[cardIndex % cardSpecificOpenings.length];
  const reversedNote = card.isReversed
    ? '다만 역방향의 기운이 섞여 있어서 마음이 있어도 표현이 꼬이거나, 괜히 반대로 행동할 수 있어요.'
    : '정방향의 흐름이라 마음과 행동이 완전히 따로 놀기보다는, 분위기만 맞으면 자연스럽게 이어질 여지가 있어요.';
  const cardSpecificCautions = [
    `먼저 결론을 정해 놓고 상대의 반응을 끼워 맞추면 마음이 더 복잡해질 수 있어요.\n오늘은 보이는 행동과 실제 마음 사이에 약간의 틈이 있을 수 있어요.\n한 번의 답장, 한 번의 표정만으로 전체 분위기를 확정하지 않는 게 좋아요.`,
    `오늘은 말투 하나가 크게 들릴 수 있는 날이에요.\n상대가 무심하게 보여도 정말 무심한 건지, 그냥 여유가 없는 건지는 조금 더 봐야 해요.\n질문자님 마음이 먼저 지치지 않게 해석의 속도를 늦춰 주세요.`,
    `오늘은 확인하려는 말이 상대에게 부담으로 닿을 수 있어요.\n속마음을 알고 싶어도 바로 캐묻기보다는 분위기를 먼저 보는 게 좋아요.\n답을 급하게 끌어내려 하면 오히려 상대가 말을 아낄 수 있어요.`,
    `오늘은 감정이 올라왔을 때 바로 표현하면 말이 조금 세게 나갈 수 있어요.\n특히 서운했던 부분을 꺼낼 때는 이유를 따지기보다 질문자님이 느낀 감정을 부드럽게 말하는 쪽이 나아요.\n대화의 시작을 날카롭게 만들지 않는 게 중요해요.`,
    `오늘은 관계의 균형을 같이 봐야 해요.\n질문자님만 애쓰는 느낌이 들면 마음이 금방 무거워질 수 있어요.\n오늘은 상대 반응을 확인하기 전에 질문자님이 편한 선을 먼저 정해 두는 게 좋아요.`,
    `오늘은 상대를 시험하듯 던지는 말이 흐름을 어색하게 만들 수 있어요.\n괜히 떠보거나 일부러 차갑게 굴면 상대도 방어적으로 받아들일 수 있어요.\n진짜 궁금한 마음은 돌려 말하기보다 담백하게 남기는 편이 나아요.`,
    `마음이 급하면 표현이 짧아지고 단단해질 수 있어요.\n그렇게 되면 질문자님 의도와 다르게 상대에게는 압박처럼 보일 수 있어요.\n오늘은 말의 내용보다 말의 톤을 먼저 살피는 게 좋아요.`,
    `오늘은 기대가 커질수록 작은 반응에도 마음이 흔들릴 수 있어요.\n좋은 신호를 찾고 싶은 마음은 자연스럽지만, 억지로 의미를 붙이면 오히려 더 불안해져요.\n흐름은 하루보다 며칠의 패턴으로 보는 게 더 정확해요.`,
    `오늘은 숨은 맥락을 놓치기 쉬워요.\n상대가 조용해 보인다고 해서 곧바로 멀어진 흐름으로 보긴 어려워요.\n겉으로 보이는 속도보다 관계 안쪽의 온도를 천천히 확인해 주세요.`,
    `오늘은 질문자님 마음이 앞서면 대화가 원하는 방향과 다르게 흘러갈 수 있어요.\n상대에게 답을 받아내려는 느낌이 생기면 둘 사이 공기가 무거워져요.\n궁금함은 남기되, 여유 있는 태도를 같이 보여 주는 게 좋아요.`
  ];
  const warmCardSpecificAdvices = [
    `오늘은 가볍고 편한 말부터 시작해 보세요.\n긴 설명보다 짧은 안부 하나가 더 자연스럽게 닿아요.\n상대가 답하기 쉬운 공기를 만들어 주면 다음 대화가 훨씬 부드러워져요.`,
    `오늘은 질문보다 리액션을 먼저 주는 게 좋아요.\n상대가 한 말을 받아 주고, 거기에 짧게 마음을 얹어 보세요.\n대화가 숙제처럼 느껴지지 않으면 온도도 자연스럽게 살아나요.`,
    `부담 없는 접점을 하나 만들어 보세요.\n갑자기 깊은 얘기로 들어가기보다 일상적인 말, 가벼운 농담, 짧은 공감이 잘 맞아요.\n오늘은 편안함이 호감보다 먼저 문을 열어 줘요.`,
    `질문자님이 먼저 여유 있는 태도를 보여 주면 분위기가 훨씬 부드러워져요.\n상대의 속도를 재촉하지 말고, 답할 공간을 남겨 주세요.\n그 여백이 오히려 좋은 반응을 끌어낼 수 있어요.`,
    `오늘은 한 문장만 담백하게 남기는 쪽이 더 잘 닿아요.\n마음을 길게 설명하기보다 “생각나서 연락했어”처럼 가볍게 시작해 보세요.\n말이 짧아도 온도는 충분히 전달될 수 있어요.`,
    `대화가 이어질 여지를 남기는 게 좋아요.\n결론을 한 번에 확인하려 하기보다 다음 말을 할 수 있는 작은 문을 열어 두세요.\n상대가 편해지면 반응도 조금씩 따라올 수 있어요.`,
    `답을 기다리는 동안 바로 의미를 붙이지 않는 게 좋아요.\n상대의 답장 속도보다 대화가 이어지는 질감을 봐 주세요.\n오늘은 느리더라도 부드럽게 이어지는 흐름이 더 중요해요.`,
    `오늘은 질문자님이 먼저 분위기를 편하게 열어 주면 좋아요.\n무거운 얘기는 조금 미루고, 서로 웃을 수 있는 말부터 꺼내 보세요.\n작은 편안함이 관계 온도를 안정적으로 올려 줄 수 있어요.`,
    `상대가 반응하기 쉬운 주제를 고르는 게 좋아요.\n둘 다 부담 없는 얘기부터 시작하면 어색함이 줄어들어요.\n편한 대화가 쌓이면 마음도 조금 더 자연스럽게 드러나요.`,
    `오늘은 먼저 다가가더라도 속도를 낮춰 주세요.\n한 번에 답을 확인하려 하기보다, 상대가 편하게 따라올 수 있는 만큼만 열어 두세요.\n조금 느린 템포가 오히려 관계를 더 안정적으로 만들어 줘요.`
  ];
  const heavyCardSpecificAdvices = [
    `오늘 올라오는 무거운 기운은 키우기보다 덜어내는 게 좋아요.\n오늘은 답을 캐내기보다 질문자님 마음을 먼저 진정시키는 쪽이 맞아요.\n짧고 편한 말 하나만 남기고, 나머지는 상대가 따라올 시간을 주세요.`,
    `오늘은 고민을 더 깊게 파고들수록 마음이 복잡해질 수 있어요.\n상대의 반응을 계속 되짚기보다, 지금 할 수 있는 작은 행동 하나만 정해 보세요.\n가벼운 안부 정도면 충분하고, 긴 확인은 미루는 게 좋아요.`,
    `오늘처럼 마음이 복잡한 날에는 대화를 무겁게 시작하지 않는 게 중요해요.\n상대에게 바로 답을 요구하기보다, 부담 없는 말로 공기를 가볍게 만들어 주세요.\n분위기가 풀린 뒤에야 진짜 얘기도 조금 더 편하게 나올 수 있어요.`,
    `오늘은 마음이 불안할수록 한 박자 늦게 움직이는 게 좋아요.\n보내고 싶은 말이 길어진다면 잠깐 저장해 두고, 핵심만 짧게 줄여 보세요.\n감정을 다 설명하지 않아도 질문자님의 온도는 충분히 전해질 수 있어요.`,
    `오늘의 무게를 줄이려면 질문자님이 먼저 편안한 태도를 잡아야 해요.\n상대가 느리거나 애매해 보여도 바로 몰아붙이지 말고, 대화가 숨 쉴 틈을 남겨 주세요.\n오늘은 선명한 답보다 안정된 분위기가 먼저예요.`,
    `오늘은 상대를 시험하거나 떠보는 말은 피하는 편이 좋아요.\n불안해서 확인하고 싶은 마음은 이해되지만, 돌려 말하면 오히려 관계가 더 꼬일 수 있어요.\n필요한 말만 담백하게 남기는 게 가장 안전해요.`,
    `생각이 많아지는 날이라 말이 딱딱하게 나갈 수 있어요.\n오늘은 문장을 보내기 전에 한 번만 더 부드럽게 바꿔 보세요.\n질문보다 공감, 확인보다 안부가 관계 온도를 지키는 데 더 좋아요.`,
    `오늘은 관계를 바로 결론내리기보다 질문자님 컨디션을 먼저 챙기는 게 좋아요.\n상대 반응을 기다리는 동안 다른 일로 마음을 조금 돌려 주세요.\n여유가 생기면 같은 상황도 덜 차갑게 보일 수 있어요.`,
    `오늘은 무리해서 끌어올리기보다 천천히 낮은 온도를 안정시키는 쪽이에요.\n짧게 말하고, 반응을 보고, 다음 말을 정하는 순서가 좋아요.\n오늘은 많이 하는 것보다 덜 부담스럽게 하는 게 더 효과적이에요.`,
    `오늘은 질문자님이 먼저 속도를 낮추면 관계가 덜 삐걱거려요.\n큰 고백이나 긴 설명보다, 상대가 편하게 받을 수 있는 한마디가 좋아요.\n조금 심심해 보일 정도의 담백함이 오히려 오늘은 안전해요.`
  ];
  const cardSpecificAdvices = isHeavyTemperatureCard ? heavyCardSpecificAdvices : warmCardSpecificAdvices;
  const cardSpecificCaution = cardSpecificCautions[(cardIndex + (card.isReversed ? 3 : 0)) % cardSpecificCautions.length];
  const cardSpecificAdvice = cardSpecificAdvices[(cardIndex + (card.isReversed ? 5 : 0)) % cardSpecificAdvices.length];

  let mood = '';
  let detail = '';
  let caution = '';
  let advice = '';

  if (temperature >= 38.5) {
    mood = `오늘 우리 사이 온도는 ${temperature}도예요. 감정이 꽤 뜨겁게 올라와 있고, 서로에게 끌리는 기운도 분명해요.`;
    detail = '오늘은 서로를 의식하는 기운이 꽤 선명해요.\n상대도 질문자님 쪽으로 마음이 기울어 있는 장면이 보여요.\n다만 감정이 바로 말로 튀어나오기보다 분위기를 보며 반응하려는 흐름이에요.\n자연스럽게 말을 건네면 생각보다 빠르게 온도가 올라갈 수 있어요.';
    caution = '너무 확인하려는 말만 던지면 좋은 온도도 부담으로 바뀔 수 있어요.\n오늘은 재촉보다 여유가 훨씬 예쁘게 먹혀요.\n상대가 반응할 틈을 남겨 두면 흐름이 더 부드럽게 이어져요.';
    advice = '먼저 다정하게 한마디 건네도 괜찮아요.\n답을 끌어내려 하기보다, 상대가 편하게 웃고 반응할 수 있는 말을 골라 보세요.\n오늘은 질문자님이 분위기를 부드럽게 열어 주는 쪽이 좋아요.';
  } else if (temperature >= 37) {
    mood = `오늘 우리 사이 온도는 ${temperature}도예요. 온기가 분명히 살아 있고, 서로를 의식하는 흐름이에요.`;
    detail = '상대가 마음을 바로 티 내지는 않아도 관심의 끈은 이어져 있어요.\n말투나 반응이 느려 보여도 질문자님을 완전히 밀어낸 흐름은 아니에요.\n지금은 상황을 보면서 조심스럽게 움직이려는 느낌이 강해요.\n가볍게 닿는 말에는 생각보다 부드럽게 반응할 수 있어요.';
    caution = '좋은 흐름이 있어도 너무 빨리 확인하려고 하면 분위기가 살짝 굳을 수 있어요.\n오늘은 마음을 묻기 전에 서로 편해지는 시간이 먼저예요.';
    advice = '짧은 안부나 가벼운 리액션부터 시작해 보세요.\n오늘은 깊게 파고들기보다 자연스럽게 이어지는 대화를 만드는 게 좋아요.';
  } else if (temperature >= 36) {
    mood = `오늘 우리 사이 온도는 ${temperature}도예요. 조심스럽고 천천히 풀리는 온도예요.`;
    detail = '작은 관심은 남아 있지만, 지금은 상대가 자기 생각이나 현실 문제에 더 묶여 있어 보여요.\n그래서 반응이 들쑥날쑥하거나 마음과 다르게 무심해 보일 수 있어요.\n질문자님을 싫어해서라기보다, 지금 자기 페이스를 먼저 지키려는 모습이 강해요.\n오늘은 천천히 풀어야 온도가 다시 올라가는 흐름이에요.';
    caution = '오늘은 큰 의미를 확인하려고 하면 답이 더 흐려질 수 있어요.\n상대 반응 하나하나에 감정을 크게 실으면 질문자님이 먼저 지칠 수 있어요.\n상대가 느리게 움직이는 날에는 질문자님도 속도를 조금 낮추는 게 좋아요.';
    advice = '오늘은 깊은 얘기보다 편한 분위기를 만드는 게 먼저예요.\n짧게 다가가고, 반응을 본 뒤 다음 말을 이어가세요.\n상대가 편안함을 느끼면 대화의 온도도 조금씩 살아날 수 있어요.';
  } else {
    mood = `오늘 우리 사이 온도는 ${temperature}도예요. 지금은 간격을 두고 살피는 흐름이라, 바로 밀어붙이면 상대가 더 물러날 수 있어요.`;
    detail = '상대도 신경은 쓰지만, 지금은 여유가 부족하거나 방어적으로 굳어 있는 흐름이에요.\n다가오는 말도 쉽게 부담으로 받아들일 수 있어요.\n질문자님이 먼저 세게 밀면 상대는 더 뒤로 물러날 가능성이 있어요.\n오늘은 관계를 확인하기보다 서로의 간격을 편하게 두는 쪽이 안전해요.';
    caution = '확인받고 싶은 마음으로 연락하면 실망이 커질 수 있어요.\n오늘은 상대 반응보다 질문자님 마음을 안정시키는 게 먼저예요.\n괜히 의미를 크게 붙이면 작은 반응도 크게 흔들릴 수 있어요.';
    advice = '오늘은 먼저 크게 움직이지 말고 한 박자 쉬어 가세요.\n마음이 급할수록 짧고 담백한 말만 남기는 게 좋아요.\n내일이나 분위기가 풀렸을 때 가볍게 다시 건네면 훨씬 자연스러워요.';
  }

  detail = `${cardSpecificOpening}\n오늘의 체감은 ${temperatureFeel}에 가까워요.\n${cardTemperatureFlavor}\n${suitTone}\n${reversedNote}\n${detail}`;
  caution = `${cardSpecificCaution}\n${caution}`;
  advice = `${cardSpecificAdvice}\n${advice}`;

  return {
    oneLineConclusion: mood,
    questionCategory: '우리 사이 온도',
    card1Meaning: detail,
    totalFlow: `${mood}\n${detail}\n오늘은 관계의 답을 단번에 확인하기보다, 서로가 편하게 반응할 수 있는 온도를 만드는 게 핵심이에요.`,
    caution,
    actionAdvice: advice,
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
  const [appShareMessage, setAppShareMessage] = useState('오늘 우리 사이 온도 봤어 🔮\n너도 한 번 확인해봐!');

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
      cards: props.cards.map(card => ({ id: card.id, isReversed: card.isReversed })),
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
        const duplicateFallback = props.menuId === 'daily-temperature'
          ? generateDailyTemperatureReading(props.cards[0])
          : generateSafeFallbackReading(props.cards, props.question || props.situation || '', props.menuTitle);
        readingResultCache.set(fetchKey, duplicateFallback);
        setResult(duplicateFallback);
        completedKeyRef.current = fetchKey;
        return;
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
              isReversed: Boolean(props.cards[0].isReversed),
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
      const fallbackReading = props.menuId === 'daily-temperature'
        ? generateDailyTemperatureReading(props.cards[0])
        : generateSafeFallbackReading(props.cards, props.question || props.situation || '', props.menuTitle);

      readingResultCache.set(fetchKey, fallbackReading);
      writePersistentReading(fetchKey, props.menuId, fallbackReading);

      if (props.menuId === 'daily-temperature' && props.cards[0] && typeof window !== 'undefined') {
        const temperature = Number(fallbackReading.temperature);
        if (Number.isFinite(temperature)) {
          localStorage.setItem(DAILY_TEMPERATURE_READING_KEY, JSON.stringify({
            date: getKstDateKey(),
            version: DAILY_TEMPERATURE_READING_VERSION,
            cardId: props.cards[0].id,
            isReversed: Boolean(props.cards[0].isReversed),
            temperature,
            readingResult: fallbackReading
          }));
        }
      }

      setFreeError(null);
      setResult(fallbackReading);
      completedKeyRef.current = fetchKey;

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
  const cardsSignature = props.cards.map(card => `${card.id}:${card.isReversed ? 'R' : 'U'}`).join('|');
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

    const granted = await props.onUseAdReadingAccess();
    if (!granted) return;

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
  const activeResult = result || (
    isDailyTemperature
      ? generateDailyTemperatureReading(props.cards[0])
      : generateSafeFallbackReading(props.cards, props.question || props.situation || '', props.menuTitle)
  );
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
            return (
              <div 
                key={`gallery-card-${card.id}`}
                className="transition-none"
              >
                <TarotCardImage card={card} />
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

      {isDailyTemperature && activeResult.card2Meaning && (
        <div className="p-4 rounded-xl bg-white/70 border border-[#EAE3D2] mb-4">
          <h4 className="font-serif text-[15px] font-bold text-[#3C2F2F] mb-2">
            5. 그 사람이 오늘 보일 수 있는 모습
          </h4>
          <p className="text-[14.5px] text-[#5C4F4F] leading-relaxed font-sans break-keep whitespace-pre-line">
            {activeResult.card2Meaning}
          </p>
        </div>
      )}

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

      {/* #4. 전체 흐름 */}
      {!isDailyTemperature && activeResult.totalFlow && (
        <div className="p-5 rounded-2xl bg-[#F3EFE6]/30 border border-[#EAE3D2] border-dashed mb-6">
          <h4 className="font-serif text-[15px] font-bold text-[#3C2F2F] tracking-wide uppercase mb-2 flex items-center gap-1.5">
            <span>5. 지금 흐름을 정리하면</span>
          </h4>
          <p className="text-[15.5px] text-[#5C4F4F] leading-relaxed font-sans block break-keep whitespace-pre-line">
            {activeResult.totalFlow}
          </p>
        </div>
      )}

      {/* #5. 지금 주의할 점 */}
      {!isDailyTemperature && activeResult.caution && (
        <div className="p-4 rounded-xl bg-[#FADBD8]/25 border border-[#F2D1CD] mb-6 space-y-1">
          <span className="text-[15px] font-bold text-[#C0392B] font-serif flex items-center gap-1">
            6. 지금 주의할 점
          </span>
          <p className="text-[15.5px] text-[#5C4F4F] leading-relaxed font-sans break-keep whitespace-pre-line">
            {activeResult.caution}
          </p>
        </div>
      )}

      {/* #6. 지금 필요한 핵심 조언 */}
      {!isDailyTemperature && activeResult.actionAdvice && (() => {
        let adviceTitle = "7. 지금 필요한 조언";
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
                    광고를 보면 오늘 한 번, 질문권 없이 이어서 볼 수 있어요.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAdFollowUpClick}
                  className="mt-4 min-h-[48px] w-full rounded-[14px] bg-[#BD6B65] text-[14px] font-serif font-bold text-white shadow-[0_10px_18px_rgba(189,107,101,0.18)]"
                >
                  광고 보고 이어서 보기
                </button>
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

