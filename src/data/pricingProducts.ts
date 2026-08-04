export interface PremiumProduct {
  type: 'one-question' | 'true-mind' | 'context-reading';
  name: string;
  price: string;
  priceNumber: number;
  benefits: string[];
  topics?: string[];
}

export const PREMIUM_PRODUCTS: PremiumProduct[] = [
  {
    type: 'one-question',
    name: '질문 하나 깊게 보기',
    price: '1,900원',
    priceNumber: 1900,
    benefits: [
      '질문에 대한 결론',
      '현재 상황',
      '가까운 흐름',
      '상대 또는 상황의 핵심',
      '행동 조언'
    ]
  },
  {
    type: 'true-mind',
    name: '그 사람의 진짜 속마음',
    price: '2,900원',
    priceNumber: 2900,
    benefits: [
      '겉으로 보이는 태도',
      '실제 속마음',
      '숨기고 있는 감정',
      '연락하고 싶은 마음',
      '앞으로 보일 행동',
      '나에게 필요한 조언'
    ]
  },
  {
    type: 'context-reading',
    name: '상황별 집중 리딩',
    price: '4,900원',
    priceNumber: 4900,
    benefits: [
      '상황에만 완벽 집중하는 초정밀 해석',
      '둘 사이 보이지 않는 감정 마찰 해결',
      '답답함을 바로 걷어낼 실제 행동 조언'
    ],
    topics: [
      '재회할 가능성이 있을까',
      '썸이 연애로 이어질까',
      '연락이 끊긴 진짜 이유',
      '이 사람을 기다려도 될까',
      '새로운 인연은 언제 들어올까'
    ]
  }
];

export function getProductByType(type: 'one-question' | 'true-mind' | 'context-reading'): PremiumProduct {
  const found = PREMIUM_PRODUCTS.find(p => p.type === type);
  if (found) return found;
  return PREMIUM_PRODUCTS[0];
}

export interface SuggestedQuestion {
  question: string;
  productType: 'one-question' | 'true-mind' | 'context-reading';
}

/**
 * Dynamically suggests 3 highly relevant questions based on relationship context and current menu.
 * Fully personalized data structure instead of purely random generation.
 */
export function getSuggestedQuestions(
  relationship: string | undefined, 
  menuId: string
): SuggestedQuestion[] {
  const rel = relationship || '애매한 사이';
  
  if (rel === '짝사랑') {
    return [
      { question: '그 사람은 나를 이성으로 보고 있을까?', productType: 'true-mind' },
      { question: '질문자님이 먼저 다가가면 어떤 반응을 보일까?', productType: 'one-question' },
      { question: '이 관계가 썸으로 이어질 가능성은?', productType: 'context-reading' }
    ];
  } else if (rel === '썸') {
    return [
      { question: '상대도 나와 연애하고 싶은 마음이 있을까?', productType: 'true-mind' },
      { question: '지금 먼저 연락해도 괜찮을까?', productType: 'one-question' },
      { question: '이 썸이 연애로 이어질 수 있을까?', productType: 'context-reading' }
    ];
  } else if (rel === '헤어진 상태' || rel === '연락 단절') {
    return [
      { question: '그 사람은 아직 나를 생각하고 있을까?', productType: 'true-mind' },
      { question: '먼저 연락할 마음이 있을까?', productType: 'one-question' },
      { question: '다시 대화가 이어질 가능성은?', productType: 'context-reading' }
    ];
  } else if (rel === '연애 중') {
    return [
      { question: '상대가 요즘 나에게 느끼는 감정은?', productType: 'true-mind' },
      { question: '현재 관계에서 가장 큰 문제는 무엇일까?', productType: 'one-question' },
      { question: '앞으로 관계가 더 안정될 수 있을까?', productType: 'context-reading' }
    ];
  } else {
    // Default - 애매한 사이, 연락 중
    return [
      { question: '상대는 나를 어떤 관계로 생각하고 있을까?', productType: 'true-mind' },
      { question: '질문자님이 자연스럽게 다가가면 어떤 반응일까?', productType: 'one-question' },
      { question: '앞으로 관계가 가까워질 가능성은?', productType: 'context-reading' }
    ];
  }
}
