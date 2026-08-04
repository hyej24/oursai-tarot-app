export interface TarotCard {
  id: number; // 0 to 77
  name: string; // English name
  nameKr: string; // Korean name
  nameEn?: string; // Explicit nameEn as requested matching prompt
  imagePath?: string; // Path to real folder images
  type: 'major' | 'minor';
  suit?: 'wands' | 'cups' | 'swords' | 'pentacles';
  value: number; // 0-21 for major, 1-14 for minor
  keywordKr: string; // Core emotional keyword in Korean
  emoji: string; // Icon representation
  isReversed?: boolean; // Upright or Reversed orientation
  
  // Relationship score metrics (0 - 100)
  affectionScore: number;
  contactScore: number;
  defenseScore: number;
  progressScore: number;
  stabilityScore: number;

  affection: number;       // 감정과 호감 (0 - 100)
  action: number;          // 행동력과 연락 가능성 (0 - 100)
  defense: number;         // 경계심과 거리두기 (0 - 100)
  communication: number;   // 대화와 소통 (0 - 100)
  stability: number;       // 관계 지속성 (0 - 100)
  closure: number;         // 정리와 단절 가능성 (0 - 100)
  newConnection: number;   // 새로운 인연 가능성 (0 - 100)
  reconciliation: number;  // 재회 가능성 (0 - 100)

  // Reversed modifiers (-100 to 100)
  reversedAffectionModifier: number;
  reversedContactModifier: number;
  reversedDefenseModifier: number;
  reversedProgressModifier: number;
  reversedStabilityModifier: number;
  reversedMeaningKr?: string;
}

export type RelationshipType = 
  | '짝사랑' // One-sided
  | '썸' // Some
  | '연락 중' // In contact
  | '연애 중' // In a relationship
  | '헤어진 상태' // Broken up
  | '연락 단절' // No contact
  | '애매한 사이'; // Complicated

export interface PartnerProfile {
  id: string;
  nickname: string;
  relationship: RelationshipType;
  lastContact: string;
  contactStatus?: string;
  temperatureHistory: {
    date: string;
    temperature: number;
    summary: string;
  }[];
}

export interface ReadingHistoryItem {
  id: string;
  date: string;
  partnerNickname?: string;
  relationship?: RelationshipType;
  menuId: string;
  menuTitle: string;
  cards: TarotCard[];
  interpretation: {
    overall?: string;
    card1Meaning: string;
    card2Meaning: string;
    card3Meaning: string;
    advice?: string;
    temperature?: number;
    additionalQuestionsHeading?: string;
  };
  isPaidUnlocked?: boolean;
}

export interface SavedRelationshipRecord {
  id: string;
  date: string;
  partnerNickname: string;
  relationship: RelationshipType;
  temperature: number;
  summary: string;
  cards: TarotCard[];
  advice: string;
}
