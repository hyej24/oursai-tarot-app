import { TarotCard } from '../types';

export interface SavedReading {
  id: string; // Unique ID
  question: string; // The query menu title or primary topic question
  partnerNickname?: string; // Partner's nickname
  relationship?: string; // Relationship context status
  cards: TarotCard[]; // The 3 Tarot cards selected
  readingResult: {
    oneLineConclusion?: string;
    card1Meaning?: string;
    card2Meaning?: string;
    card3Meaning?: string;
    totalFlow?: string;
    caution?: string;
    actionAdvice?: string;
    followUpQuestions?: string[];
    premiumConclusion?: string;
    partnerEmotionSituation?: string;
    actionPossibility?: string;
    relationshipBarrier?: string;
    expectedResponse?: string;
    detailedAdvice?: string;
    fallbackText?: string;

    // 오늘의 연애운 (dating-luck)
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
    conversationPossibility?: string;
    avoidMessage?: string;
    recommendedApproach?: string;

    // 우리 사이 온도 (relation-temp)
    partnerFeeling?: string;
    nearFuture?: string;

    // 이번 주 관계 흐름 (relation-flow)
    earlyWeek?: string;
    midWeek?: string;
    lateWeek?: string;
    turningPoint?: string;
  };
  productType: 'free' | 'one-question' | 'true-mind' | 'context-reading'; // product type
  isPaid: boolean; // payment completion boolean
  dateTime: string; // formatting date and time
}

const STORAGE_KEY = 'tarot_user_readings';

/**
 * Modular data persistence interface.
 * Easily replace the localStorage engine here with a remote API/database (e.g. Firebase Firestore) 
 * without modifying any component views.
 */
export const readingStorage = {
  // Save a brand new reading
  saveReading: (reading: Omit<SavedReading, 'id' | 'dateTime'>): SavedReading => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const hours = String(today.getHours()).padStart(2, '0');
    const minutes = String(today.getMinutes()).padStart(2, '0');
    const formattedDateTime = `${year}-${month}-${day} ${hours}:${minutes}`;

    const newReading: SavedReading = {
      ...reading,
      id: `reading-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      dateTime: formattedDateTime
    };

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const list: SavedReading[] = stored ? JSON.parse(stored) : [];
      list.unshift(newReading);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.error("Local reading storage write failure:", e);
    }

    return newReading;
  },

  // Retrieve list of all previous readings
  getAllReadings: (): SavedReading[] => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("Local reading storage read failure:", e);
      return [];
    }
  },

  // Delete specific reading by ID
  deleteReading: (id: string): boolean => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return false;
      const list: SavedReading[] = JSON.parse(stored);
      const filtered = list.filter(item => item.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
      return true;
    } catch (e) {
      console.error("Local storage delete item error:", e);
      return false;
    }
  },

  // Clear all readings
  clearAll: () => {
    localStorage.removeItem(STORAGE_KEY);
  }
};
