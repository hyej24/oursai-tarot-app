import { TarotCard, RelationshipType } from '../types';
import { calculateRelationshipTemperature, TAROT_DECK } from '../data/tarotCards';
import { classifyQuestion, getQuestionSpreadRoles, QuestionCategory } from './questionTarot';

export interface LocalStandardReadingResult {
  oneLineConclusion: string;
  questionCategory?: string;
  card1Meaning: string;
  card2Meaning: string;
  card3Meaning: string;
  totalFlow: string;
  caution: string;
  actionAdvice: string;
  followUpQuestions: string[];
  temperature: number;
  cards: Array<{
    role: string;
    cardName: string;
    orientation: string;
    coreMeaning: string;
    contextualMeaning: string;
  }>;
  conclusion?: string;
  todayEmotion?: string;
  incomingPersonOrEvent?: string;
  outwardAttitude?: string;
  realFeeling?: string;
  hiddenEmotion?: string;
  futureAction?: string;
  contactRecommendation?: string;
  partnerCondition?: string;
  expectedResponse?: string;
  conversationPossibility?: string;
  avoidMessage?: string;
  recommendedApproach?: string;
  partnerFeeling?: string;
  relationshipBarrier?: string;
  nearFuture?: string;
  earlyWeek?: string;
  midWeek?: string;
  lateWeek?: string;
  turningPoint?: string;
}

export interface LocalPaidReadingResult {
  premiumConclusion: string;
  partnerEmotionSituation: string;
  actionPossibility: string;
  relationshipBarrier: string;
  expectedResponse: string;
  detailedAdvice: string;
}

type EnrichedCard = TarotCard & {
  affection?: number;
  action?: number;
  defense?: number;
  communication?: number;
  stability?: number;
  closure?: number;
  newConnection?: number;
  reconciliation?: number;
};

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(value)));

function enrichCards(cards: TarotCard[]): EnrichedCard[] {
  return cards.map(card => {
    const full = TAROT_DECK.find(item => item.id === card.id) as TarotCard | undefined;
    return { ...(full || card), ...card };
  });
}

function score(card: EnrichedCard, key: keyof EnrichedCard, fallback = 50) {
  const raw = Number(card[key] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  if (!card.isReversed) return clamp(raw);
  if (key === 'affection') return clamp(raw + Number(card.reversedAffectionModifier || 0));
  if (key === 'action') return clamp(raw + Number(card.reversedContactModifier || 0));
  if (key === 'defense') return clamp(raw + Number(card.reversedDefenseModifier || 0));
  if (key === 'stability') return clamp(raw + Number(card.reversedStabilityModifier || 0));
  return clamp(raw - 8);
}

function average(cards: EnrichedCard[], key: keyof EnrichedCard, fallback = 50) {
  if (!cards.length) return fallback;
  return clamp(cards.reduce((sum, card) => sum + score(card, key, fallback), 0) / cards.length);
}

function normalize(text: string) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeSpeakerLabels<T>(value: T): T {
  if (typeof value === 'string') {
    return value
      .replace(/질문자님의/g, '질문자님의')
      .replace(/질문자님이/g, '질문자님이')
      .replace(/질문자님은/g, '질문자님은')
      .replace(/질문자님을/g, '질문자님을')
      .replace(/질문자님에게/g, '질문자님에게')
      .replace(/질문자님과/g, '질문자님과')
      .replace(/질문자님도/g, '질문자님도')
      .replace(/질문자님/g, '질문자님')
      .replace(/질문자의/g, '질문자님의')
      .replace(/질문자가/g, '질문자님이')
      .replace(/질문자는/g, '질문자님은')
      .replace(/질문자를/g, '질문자님을')
      .replace(/질문자에게/g, '질문자님에게')
      .replace(/질문자와/g, '질문자님과')
      .replace(/질문자도/g, '질문자님도') as T;
  }
  if (Array.isArray(value)) {
    return value.map(item => normalizeSpeakerLabels(item)) as T;
  }
  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      next[key] = normalizeSpeakerLabels(item);
    }
    return next as T;
  }
  return value;
}

function categoryFor(menuId: string, menuTitle: string, question: string): QuestionCategory {
  const joined = normalize(`${menuId} ${menuTitle} ${question}`);
  const menuCategory = menuId.startsWith('question-')
    ? menuId.replace('question-', '') as QuestionCategory
    : undefined;

  if (menuId === 'inner-mind') return '속마음';
  if (menuId === 'can-contact') return '연락';
  if (menuId === 'relation-flow' || menuId === 'relation-temp' || menuId === 'dating-luck') return '연애';

  if (/속마음|진짜 마음|진심|어떻게 생각|나를 생각|티 내지|숨기|좋아하|호감|관심|마음/.test(joined)) return '속마음';
  if (/연락|답장|카톡|문자|전화|읽씹/.test(joined)) return '연락';
  if (/재회|다시 만|헤어진|돌아올|전남친|전여친/.test(joined)) return '재회';

  if (menuCategory) return menuCategory;
  return classifyQuestion(question || menuTitle || '');
}

function rolesFor(menuId: string, category: QuestionCategory) {
  if (menuId === 'inner-mind') return ['겉으로 보이는 태도', '실제 속마음', '앞으로 보일 행동'];
  if (menuId === 'can-contact') return ['오늘 상대의 상태', '연락했을 때 반응', '오늘의 연락 조언'];
  if (menuId === 'relation-temp') return ['상대의 현재 감정', '관계를 막는 부분', '가까운 관계 흐름'];
  if (menuId === 'dating-luck') return ['오늘의 감정 흐름', '오늘 들어올 사람이나 사건', '오늘의 행동 조언'];
  if (menuId.startsWith('question-')) return getQuestionSpreadRoles(category);
  return getQuestionSpreadRoles(category);
}

function joinLines(lines: string[]) {
  return lines.filter(Boolean).join('\n');
}

function pickVariant<T>(cards: EnrichedCard[], variants: T[]) {
  const seed = cards.reduce((sum, card, index) => sum + card.id * (index + 3) + (card.isReversed ? 7 : 0), 0);
  return variants[Math.abs(seed) % variants.length];
}

function directMindAnswer(cards: EnrichedCard[], question: string) {
  const affection = average(cards, 'affection');
  const defense = average(cards, 'defense');
  const action = average(cards, 'action');
  const asksHiddenMind = /티\s*내지|숨기|진짜|속마음|진심|마음|어떻게 생각|나를 생각/.test(question);

  if (affection >= 72 && defense >= 62) {
    return pickVariant(cards, asksHiddenMind ? [
      '그 사람 속마음에는 질문자님이 꽤 크게 들어와 있어요. 좋아하는 티가 나면 주도권을 뺏길까 봐 일부러 담담한 척하는 마음이 강합니다.',
      '속으로는 이미 많이 신경 쓰고 있어요. 다만 먼저 좋아하는 쪽처럼 보이기 싫어서 말투와 반응을 일부러 눌러 두는 모습입니다.',
      '마음은 있는데 자존심이 같이 올라와 있어요. 질문자님에게 끌리면서도 괜히 아무렇지 않은 척하며 자기 페이스를 지키려 합니다.'
    ] : [
      '그 사람은 질문자님을 단순한 지인처럼 보고 있지 않아요. 마음은 있는데 먼저 들키고 싶지 않아서 반응을 조절하고 있습니다.',
      '그 사람은 질문자님을 의식하고 있어요. 가볍게 보는 마음은 아니고, 자기 감정이 드러날까 봐 한 번씩 선을 긋는 쪽입니다.',
      '질문자님에게 끌리는 마음이 분명히 있습니다. 다만 상대는 감정이 앞서 보이는 걸 싫어해서 먼저 여지를 크게 주진 않습니다.'
    ]);
  }
  if (affection >= 64) {
    return action >= 58
      ? pickVariant(cards, [
        '그 사람은 질문자님에게 호감과 궁금함을 느끼고 있어요. 속으로는 더 알고 싶어 하면서도 겉으로는 너무 티 나지 않게 선을 맞추는 중입니다.',
        '그 사람 마음에는 “조금 더 가까워지고 싶다”는 생각이 있어요. 다만 너무 빠르게 보이면 어색해질까 봐 자연스러운 계기를 기다립니다.',
        '그 사람은 질문자님을 볼 때 편안함과 설렘을 같이 느끼는 쪽이에요. 그래서 더 다가가고 싶지만, 아직은 분위기를 살피고 있습니다.'
      ])
      : pickVariant(cards, [
        '그 사람은 질문자님을 신경 쓰고 있어요. 다만 자기 마음을 확정해서 표현하기 전까지는 괜히 애매하게 굴 가능성이 큽니다.',
        '속으로는 관심이 있는데 아직 확신까지는 가지 않았어요. 그래서 가까워졌다가도 갑자기 조심스러워지는 모습이 나올 수 있습니다.',
        '그 사람은 질문자님이 눈에 밟히는 상태예요. 다만 마음을 인정하는 속도가 느려서 겉으로는 덜 적극적으로 보입니다.'
      ]);
  }
  if (defense >= 68) {
    return pickVariant(cards, [
      '그 사람 속마음은 닫힌 게 아니라 숨기는 쪽이에요. 끌림은 있는데 먼저 티 내면 약해 보인다고 느껴서 일부러 차분한 얼굴을 하고 있습니다.',
      '그 사람은 마음을 쉽게 보여 주는 타입이 아니에요. 관심이 생겨도 먼저 인정하기보다 한 발 물러서서 질문자님 반응을 살핍니다.',
      '속으로는 흔들리는 지점이 있는데, 겉으로는 티를 안 내려는 힘이 더 세요. 좋아도 먼저 다가가면 주도권을 놓치는 것처럼 느낄 수 있습니다.'
    ]);
  }
  if (affection <= 42) {
    return pickVariant(cards, [
      '그 사람 마음은 아직 크게 달아오르진 않았어요. 지금은 설렘보다 관찰이 앞서 있고, 질문자님이 어떤 사람인지 더 확인하려는 마음이 큽니다.',
      '지금 속마음은 강한 호감보다 조심스러운 관심에 머물러 있어요. 질문자님을 싫어한다기보다 아직 마음이 깊게 들어오진 않았습니다.',
      '그 사람은 아직 감정을 크게 키우지 않고 있어요. 편하게 느끼는 부분은 있지만, 연애 감정으로 확 넘어가려면 시간이 더 필요합니다.'
    ]);
  }
  return pickVariant(cards, [
    '그 사람은 질문자님을 의식하고 있어요. 속으로는 신경 쓰이는데, 그 마음을 바로 인정하기보다 혼자 한 번 더 생각해 보는 상태입니다.',
    '그 사람 마음에는 질문자님이 걸려 있어요. 엄청 뜨겁게 밀고 들어오는 마음은 아니지만, 그냥 지나치기엔 자꾸 신경 쓰이는 쪽입니다.',
    '속마음은 호기심과 경계가 같이 있어요. 질문자님에게 끌리는 부분은 있는데, 아직 자기 마음을 안전하게 확인하고 싶어 합니다.'
  ]);
}

function conclusionFor(category: QuestionCategory, cards: EnrichedCard[], temperature: number, question = '') {
  const affection = average(cards, 'affection');
  const action = average(cards, 'action');
  const defense = average(cards, 'defense');
  const stability = average(cards, 'stability');
  const q = normalize(question);

  if (category === '속마음') {
    const explicitlyAsksAction = /앞으로|먼저|다가올|행동/.test(q) && !/속마음|진짜 마음|진심|마음|어떻게 생각|나를 생각|티\s*내지|숨기/.test(q);
    if (explicitlyAsksAction) {
      if (action >= 62 && defense < 68) return '먼저 움직일 가능성은 있어요. 다만 고백처럼 크게 오기보다 말투나 연락 간격이 조금 달라지는 식으로 먼저 티가 날 수 있습니다.';
      return '먼저 확실하게 다가오긴 아직 조심스러워요. 관심은 있어도 자존심이나 상황을 보느라 한 번 더 재는 흐름입니다.';
    }
    if (/거리|멀어|물러|반응/.test(q)) {
      return defense >= 62
        ? '질문자님이 거리를 두면 상대도 바로 붙잡기보다 눈치를 볼 가능성이 커요. 마음이 없어서가 아니라 먼저 드러내는 걸 지는 일처럼 느끼는 쪽입니다.'
        : '질문자님이 살짝 거리를 두면 상대는 분위기 변화를 꽤 빨리 느낄 수 있어요. 그때부터 말투나 시선에서 신경 쓰는 티가 더 나올 수 있습니다.';
    }
    return directMindAnswer(cards, q);
  }

  if (category === '연락') {
    if (/다음 대화|이어질 가능성|대화가 이어/.test(q)) {
      return action >= 60
        ? '다음 대화는 이어질 가능성이 있어요. 다만 처음부터 깊게 파고들기보다 가벼운 말로 시작해야 상대가 편하게 받아요.'
        : '다음 대화가 바로 길게 이어지긴 어려워요. 짧게 반응을 확인하고, 답이 느려도 의미를 너무 크게 두지 않는 편이 좋습니다.';
    }
    if (/늦어|안 오|안읽|읽씹|답장/.test(q)) {
      return '연락이 늦어지는 건 마음이 아예 없어서라기보다 지금 답할 여유나 명분을 재고 있어서예요. 재촉하면 더 닫힐 수 있습니다.';
    }
    if (action >= 68 && defense < 62) return '연락해도 괜찮아요. 다만 길게 확인하려고 하기보다 가볍게 말을 여는 쪽이 훨씬 잘 받아들여집니다.';
    if (defense >= 70) return '오늘 바로 밀어붙이는 연락은 부담으로 닿을 수 있어요. 상대가 자기 페이스를 지키려는 마음이 강합니다.';
    return '연락 자체는 가능하지만 답이 빠르거나 다정하게 오진 않을 수 있어요. 짧게 던지고 반응을 보는 흐름이 좋습니다.';
  }

  if (category === '재회') {
    if (stability >= 64 && affection >= 58) return '재회 가능성은 남아 있어요. 다만 그리움만으로는 부족하고, 서로 자존심을 내려놓는 계기가 필요합니다.';
    return '지금 당장 재회를 밀어붙이긴 이릅니다. 감정은 남아도 현실적인 정리와 타이밍이 아직 덜 맞았습니다.';
  }

  if (category === '평판/시선') {
    return '사람들이 생각보다 질문자님을 나쁘게 보고 있진 않아요. 지금 더 크게 올라온 건 실제 평판보다 스스로 위축되는 마음입니다.';
  }

  if (category === '직장/이직') {
    if (/핵심 변수|놓치|변수/.test(q)) {
      return '지금 놓치고 있는 핵심 변수는 마음보다 현실 정리예요. 퇴사 후 수입, 업무 마무리, 주변과의 관계 정리가 흔들리면 선택이 더 무거워질 수 있습니다.';
    }
    if (/흔들릴|그만두면|퇴사하면/.test(q)) {
      return '그만두면 가장 먼저 흔들릴 부분은 돈보다 생활 리듬과 자신감이에요. 다음 루틴을 먼저 잡아두면 불안이 훨씬 줄어듭니다.';
    }
    if (/현실 조건|확인|퇴사 전/.test(q)) {
      return '퇴사 전에 확인할 건 세 가지예요. 버틸 자금, 다음 선택지, 지금 회사와 깔끔하게 마무리할 선을 먼저 정해야 합니다.';
    }
    return temperature >= 56
      ? '준비해서 움직여도 괜찮아요. 다만 바로 던지기보다 조건과 마무리 계획을 먼저 잡아야 안전합니다.'
      : '지금은 보류하고 조건을 더 확인하는 편이 좋아요. 마음은 급하지만 현실 기준표가 먼저 필요합니다.';
  }

  if (category === '금전') return '돈 흐름은 크게 무너지는 쪽은 아니지만 새는 구멍이 보여요. 지출 기준을 다시 잡으면 안정감이 빨리 돌아옵니다.';
  if (category === '시험/진로') return '가능성은 있어요. 운에 맡기기보다 반복 루틴과 방향 수정을 하면 결과가 훨씬 선명해집니다.';
  if (category === '선택 고민') return temperature >= 55 ? '선택해도 괜찮아요. 바로 확정하지 말고 작게 시험해 보면 더 안정적입니다.' : '지금은 한 박자 보류가 좋아요. 마음이 급해서 놓치는 조건이 하나 있습니다.';
  if (category === '새로운 인연') return '새로운 인연 흐름은 열려 있어요. 갑자기 불타는 만남보다 편하게 대화가 이어지는 사람이 잘 맞습니다.';
  if (category === '인간관계') return '관계를 바로 끊기보다 거리를 조절하는 편이 좋아요. 상대 반응에 끌려가지 않게 내 기준을 먼저 세우세요.';

  return '지금은 감정만 보고 움직이면 흔들릴 수 있어요. 상황의 조건과 내 기준을 같이 봐야 답이 선명해집니다.';
}

function mindCardText(card: EnrichedCard, index: number) {
  const affection = score(card, 'affection');
  const action = score(card, 'action');
  const defense = score(card, 'defense');
  const stability = score(card, 'stability');

  if (index === 0) {
    return joinLines([
      defense >= 62 ? '겉으로는 쉽게 흔들리지 않는 척하고 있어요.' : '겉으로 보이는 태도는 생각보다 부드러운 편이에요.',
      affection >= 64 ? '질문자님을 의식하는 기색은 분명히 있습니다.' : '다만 아직 적극적으로 드러내는 단계는 아니에요.',
      '말투나 행동이 애매해 보여도 아예 관심 밖으로 밀어낸 흐름은 아닙니다.',
      defense >= 62 ? '이 사람은 마음이 들수록 오히려 더 담담한 척하는 면이 있어요.' : '분위기가 편하면 작은 반응으로 마음이 조금씩 새어 나옵니다.',
      '그래서 겉모습만 보고 마음이 없다고 단정하면 실제 속도와 어긋날 수 있어요.'
    ]);
  }

  if (index === 1) {
    return joinLines([
      affection >= 68 ? '속으로는 질문자님을 꽤 신경 쓰고 있어요.' : '속마음은 아직 확신보다 관찰에 더 많이 머물러 있어요.',
      defense >= 60 ? '좋은 감정이 있어도 바로 보여 주면 불리하다고 느끼는 듯합니다.' : '감정이 숨겨져만 있진 않고, 작은 호기심이 살아 있습니다.',
      stability >= 58 ? '관계가 안정적으로 느껴지면 더 편하게 반응할 가능성이 있어요.' : '지금은 자기 생각이나 현실 문제 때문에 마음을 붙잡고 있습니다.',
      '핵심은 마음이 없어서가 아니라, 확신이 생기기 전까지 쉽게 움직이지 않는다는 점이에요.',
      action >= 60 ? '조금만 편해지면 말투나 연락 간격에서 변화가 보일 수 있습니다.' : '당장은 큰 표현보다 미묘한 시선과 반응으로 확인될 가능성이 큽니다.'
    ]);
  }

  return joinLines([
    action >= 65 ? '앞으로는 작은 행동 변화가 보일 수 있어요.' : '당장 큰 행동으로 나오기보다는 시간을 두고 반응할 가능성이 큽니다.',
    '고백처럼 선명한 표현보다 말투, 답장 온도, 눈치 보는 행동으로 먼저 나타납니다.',
    defense >= 62 ? '자존심 때문에 먼저 다가오면서도 아무렇지 않은 척할 수 있어요.' : '분위기가 편해지면 생각보다 자연스럽게 가까워질 수 있습니다.',
    stability >= 58 ? '관계가 무리 없이 이어지면 마음을 더 안정적으로 보여 줄 흐름입니다.' : '불안하게 압박하면 다시 숨는 쪽으로 움직일 수 있습니다.',
    '가볍게 여지를 남겨 두면 상대가 스스로 움직일 공간이 생깁니다.'
  ]);
}

function contextualCardText(card: EnrichedCard, role: string, category: QuestionCategory, index: number, cards: EnrichedCard[]) {
  const affection = score(card, 'affection');
  const action = score(card, 'action');
  const defense = score(card, 'defense');
  const stability = score(card, 'stability');

  if (category === '속마음') return mindCardText(card, index);

  if (category === '연락') {
    if (index === 0) {
      return joinLines([
        '상대는 지금 연락 자체보다 자기 상황을 먼저 정리하려는 상태예요.',
        stability >= 58 ? '생활 리듬은 무너지지 않았지만 마음의 여유가 넉넉하진 않습니다.' : '컨디션이나 현실 문제가 겹쳐서 반응이 느려질 수 있어요.',
        defense >= 60 ? '바로 다가오는 말에는 살짝 거리를 둘 가능성이 있습니다.' : '부담 없는 말에는 생각보다 부드럽게 반응할 수 있습니다.',
        '연락이 늦다고 마음이 완전히 식었다고 보긴 어렵습니다.',
        '지금은 상대의 속도가 느린 구간이라고 보는 게 맞아요.'
      ]);
    }
    if (index === 1) {
      return joinLines([
        action >= 60 ? '연락하면 반응 자체는 열릴 가능성이 있어요.' : '연락해도 바로 길게 이어지긴 어려울 수 있어요.',
        '첫 문장이 무겁거나 확인받으려는 느낌이면 부담이 커집니다.',
        affection >= 60 ? '완전히 귀찮아하는 흐름은 아니고, 어떻게 받아야 할지 재는 모습입니다.' : '상대는 감정보다 상황을 먼저 보고 답할 가능성이 큽니다.',
        '짧은 안부나 자연스러운 계기가 잘 맞습니다.',
        '답장의 길이보다 대화가 끊기지 않는지를 보는 게 더 정확해요.'
      ]);
    }
    return joinLines([
      action >= 65 ? '먼저 연락해도 괜찮아요. 다만 가볍고 짧게 시작해야 합니다.' : '오늘은 먼저 밀기보다 반응할 여지를 남기는 편이 좋아요.',
      '답을 요구하는 말은 피하는 게 좋습니다.',
      '상황을 자연스럽게 여는 문장 하나가 충분합니다.',
      defense >= 62 ? '상대가 방어적으로 굴어도 바로 실망하지 말고 한 박자 늦게 보세요.' : '분위기만 잘 잡으면 대화가 생각보다 편하게 이어질 수 있습니다.',
      '핵심은 연락 여부보다 부담을 얼마나 줄이느냐예요.'
    ]);
  }

  if (category === '평판/시선') {
    return joinLines([
      index === 0 ? '지금 걱정의 중심에는 남들의 말보다 내가 어떻게 보일지가 더 크게 올라와 있어요.' : index === 1 ? '사람들은 생각보다 각자 일에 바쁘고, 질문자님을 오래 붙잡고 판단하진 않습니다.' : '중요한 건 해명이 아니라 태도예요. 담담하면 시선은 빨리 옅어집니다.',
      defense >= 60 ? '스스로를 방어하려는 마음이 커지면 말이 길어질 수 있어요.' : '짧고 분명한 태도만으로도 충분히 정리될 수 있습니다.',
      stability >= 60 ? '현실적으로 크게 무너질 흐름은 아니니 너무 겁먹지 않아도 됩니다.' : '다만 예민하게 받아들이면 작은 말도 크게 들릴 수 있습니다.',
      '모두에게 이해받으려는 마음을 내려놓는 게 필요합니다.',
      '내가 흔들리지 않는 모습을 보이면 주변 반응도 오래 가지 않습니다.'
    ]);
  }

  return joinLines([
    index === 0 ? '현재 상황은 감정만으로 판단하기보다 현실 조건을 먼저 봐야 합니다.' : index === 1 ? '중간에서 걸리는 건 마음의 문제가 아니라 기준과 타이밍입니다.' : '마지막 흐름은 성급하게 확정하지 말고 작게 확인하라는 쪽입니다.',
    stability >= 60 ? '정리할 것만 정리하면 안정적으로 이어질 여지가 있습니다.' : '아직 확인하지 않은 조건이 남아 있어서 서두르면 흔들릴 수 있어요.',
    affection >= 65 ? '마음이 가는 방향은 분명하지만 표현 방식은 아직 조심스럽습니다.' : '감정만으로 밀어붙이기엔 현실적인 부담을 같이 살피고 있어요.',
    action >= 65 ? '작게라도 움직이면 흐름이 열릴 가능성이 있습니다.' : '지금은 결론보다 관찰과 조율이 먼저입니다.',
    '오늘 가능한 작은 확인부터 하는 편이 가장 안전합니다.'
  ]);
}

function totalFlowFor(cards: EnrichedCard[], category: QuestionCategory) {
  const affection = average(cards, 'affection');
  const action = average(cards, 'action');
  const defense = average(cards, 'defense');
  const stability = average(cards, 'stability');

  if (category === '속마음') {
    return joinLines([
      defense >= 62 ? '전체적으로 보면 마음은 있지만 쉽게 들키고 싶어 하지 않는 흐름이에요.' : '전체적으로 보면 감정의 문이 완전히 닫힌 상태는 아니에요.',
      affection >= 65 ? '상대는 질문자님을 의식하고 있지만 먼저 확실하게 드러내기까지 시간이 걸립니다.' : '아직 확신보다 관찰이 앞서 있어서 반응이 일정하지 않을 수 있습니다.',
      action >= 60 ? '앞으로는 아주 작은 행동이나 말투 변화로 마음이 새어 나올 가능성이 있어요.' : '당장 큰 움직임을 기대하기보다 상대가 편해지는 속도를 봐야 합니다.'
    ]);
  }

  if (category === '연락') {
    return joinLines([
      '전체 흐름은 연락을 무리하게 끌어내기보다 부담을 낮추는 쪽이 좋아요.',
      action >= 60 ? '가볍게 말을 열면 반응은 돌아올 수 있지만 처음부터 깊은 대화로 들어가면 무거워집니다.' : '상대의 반응이 느릴 수 있으니 답장 속도만 보고 마음을 단정하지 않는 게 좋습니다.',
      '핵심은 연락하느냐보다 어떤 톤으로 시작하느냐예요.'
    ]);
  }

  if (category === '평판/시선') {
    return joinLines([
      '전체 흐름은 사람들이 질문자님을 공격적으로 보고 있다기보다, 질문자님이 그 시선을 크게 의식하는 쪽입니다.',
      stability >= 58 ? '태도만 담담하게 유지하면 주변 반응은 생각보다 오래가지 않습니다.' : '다만 예민하게 반응하면 오해가 남을 수 있으니 짧고 분명한 정리가 필요합니다.',
      '모두에게 설명하려 하지 말고 내 기준을 잃지 않는 게 중요합니다.'
    ]);
  }

  return joinLines([
    '전체 흐름은 바로 결론을 내리기보다 상황을 한 번 더 확인하라는 쪽이에요.',
    stability >= 58 ? '이미 쌓아 둔 기준은 있으니 작은 실행으로 현실 반응을 보는 게 좋습니다.' : '아직 빠진 조건이 있어서 마음만 앞서면 다시 흔들릴 수 있습니다.',
    '오늘은 크게 밀어붙이기보다 확인 가능한 신호부터 차분히 보는 편이 안전합니다.'
  ]);
}

function cautionFor(category: QuestionCategory, cards: EnrichedCard[]) {
  const defense = average(cards, 'defense');
  const action = average(cards, 'action');

  if (category === '속마음') {
    return joinLines([
      '상대의 반응 하나로 마음 전체를 단정하지 마세요.',
      defense >= 62 ? '이 사람은 마음이 있을수록 오히려 더 무심한 척할 수 있습니다.' : '분위기가 괜찮아 보여도 너무 빨리 확인하려 들면 어색해질 수 있어요.',
      '지금은 말보다 반복되는 행동을 보는 게 더 정확합니다.'
    ]);
  }

  if (category === '연락') {
    return joinLines([
      '답을 빨리 받아내려는 느낌이 강하면 상대가 더 물러날 수 있어요.',
      '확인 질문을 길게 던지면 부담으로 닿을 가능성이 있습니다.',
      action >= 60 ? '연락은 가능하지만 시작은 가볍고 짧게 잡아야 합니다.' : '오늘은 반응을 숙제로 만들지 말고 한 번 기다리는 편이 낫습니다.'
    ]);
  }

  return joinLines([
    defense >= 65 ? '상대나 상황의 방어가 강해서 성급하게 밀어붙이면 반발이 생길 수 있어요.' : '흐름이 나쁘진 않지만 작은 신호를 과하게 해석하지 않는 게 좋아요.',
    '내가 원하는 답만 보려 하면 현실적인 조건을 놓칠 수 있습니다.',
    '오늘은 결론을 강요하지 말고 확인할 것과 기다릴 것을 나누는 태도가 필요합니다.'
  ]);
}

function adviceFor(category: QuestionCategory, cards: EnrichedCard[]) {
  const action = average(cards, 'action');
  const stability = average(cards, 'stability');

  if (category === '속마음') {
    return joinLines([
      '상대의 마음을 캐묻기보다 편하게 반응할 틈을 주세요.',
      '좋아하는지 아닌지 한 번에 결론 내리지 말고, 계속 같은 쪽으로 시선이 돌아오는지를 보세요.',
      '내 감정을 너무 먼저 꺼내기보다 여지를 남기는 쪽이 유리합니다.'
    ]);
  }

  if (category === '연락') {
    return joinLines([
      action >= 58 ? '연락한다면 짧은 안부나 가벼운 계기로 시작하세요.' : '오늘은 먼저 밀지 말고 상대의 여유가 생길 때까지 한 박자 기다리세요.',
      '말의 무게를 줄일수록 상대가 답하기 쉬워집니다.',
      '답장 속도에 매달리지 말고 대화가 닫히지 않는지를 기준으로 보세요.'
    ]);
  }

  if (category === '직장/이직' || category === '선택 고민') {
    return joinLines([
      '감정으로 바로 결정하지 말고 조건을 종이에 적어 비교해 보세요.',
      stability >= 58 ? '이미 준비된 부분이 꽤 있으니 작은 실행부터 해도 괜찮습니다.' : '아직 빈칸이 있으니 정보 확인을 먼저 하는 편이 안전합니다.',
      '지금 필요한 건 확신보다 기준입니다. 기준이 잡히면 선택도 덜 흔들립니다.'
    ]);
  }

  return joinLines([
    '오늘은 큰 결론을 내리기보다 작은 행동 하나를 정하는 게 좋아요.',
    '상대나 상황을 바꾸려 애쓰지 말고 내가 지킬 선을 먼저 잡아야 합니다.',
    '조금만 여유를 두면 다음 신호가 더 선명하게 보일 거예요.'
  ]);
}

function followUpsFor(category: QuestionCategory) {
  if (category === '속마음') return ['그 사람이 티 내지 않는 진짜 마음은 무엇일까요?', '이 사람은 앞으로 먼저 다가올까요?', '내가 조금 거리를 두면 상대는 어떻게 반응할까요?'];
  if (category === '연락') return ['오늘 먼저 연락하면 상대는 어떻게 받아들일까요?', '연락이 늦어지는 진짜 이유는 무엇일까요?', '다음 대화가 이어질 가능성은 얼마나 될까요?'];
  if (category === '재회') return ['재회를 막고 있는 가장 큰 감정은 무엇일까요?', '상대는 아직 나를 그리워하고 있을까요?', '다시 만나려면 어떤 계기가 필요할까요?'];
  if (category === '새로운 인연') return ['다가오는 인연은 어떤 사람일까요?', '새 인연을 만나기 전 내가 정리해야 할 마음은 무엇일까요?', '이번 달 연애 흐름은 어떻게 열릴까요?'];
  if (category === '평판/시선') return ['사람들이 실제로 나를 어떻게 보고 있을까요?', '내 선택이 시간이 지나면 어떻게 평가될까요?', '지금 내가 지켜야 할 태도는 무엇일까요?'];
  if (category === '직장/이직') return ['퇴사 전에 꼭 확인해야 할 현실 조건은 무엇일까요?', '지금 회사를 그만두면 가장 크게 흔들릴 부분은 무엇일까요?', '다음 직장이나 이직 준비에서 먼저 잡아야 할 기준은 무엇일까요?'];
  if (category === '금전') return ['이번 달 돈이 새는 가장 큰 구멍은 무엇일까요?', '수입을 늘리려면 먼저 정리해야 할 지출은 무엇일까요?', '지금 돈 문제에서 놓치고 있는 핵심은 무엇일까요?'];
  if (category === '시험/진로') return ['합격 가능성을 높이려면 지금 무엇을 바꿔야 할까요?', '내 진로에서 가장 먼저 확인해야 할 기준은 무엇일까요?', '지금 준비 방식에서 놓치고 있는 부분은 무엇일까요?'];
  return ['이 선택을 하면 다음 흐름은 어떻게 바뀔까요?', '지금 가장 먼저 확인해야 할 것은 무엇일까요?', '내가 놓치고 있는 핵심 변수는 무엇일까요?'];
}

export function generateLocalStandardReading(params: {
  menuId: string;
  menuTitle: string;
  cards: TarotCard[];
  question: string;
  situation?: string;
  relationship?: RelationshipType | string;
}): LocalStandardReadingResult {
  const cards = enrichCards(params.cards);
  const questionText = params.question || params.situation || params.menuTitle || '';
  const category = categoryFor(params.menuId, params.menuTitle, questionText);
  const roles = rolesFor(params.menuId, category);
  const temperature = calculateRelationshipTemperature(cards, params.relationship);
  const cardMeanings = cards.map((card, index) => contextualCardText(card, roles[index] || `${index + 1}번째 흐름`, category, index, cards));
  const oneLineConclusion = conclusionFor(category, cards, temperature, questionText);
  const totalFlow = totalFlowFor(cards, category);
  const caution = cautionFor(category, cards);
  const actionAdvice = adviceFor(category, cards);
  const normalizedQuestion = normalize(questionText);
  const followUpQuestions = followUpsFor(category)
    .filter(followUp => normalize(followUp) !== normalizedQuestion)
    .slice(0, 3);

  const result: LocalStandardReadingResult = {
    oneLineConclusion,
    questionCategory: category,
    card1Meaning: cardMeanings[0] || '',
    card2Meaning: cardMeanings[1] || '',
    card3Meaning: cardMeanings[2] || '',
    totalFlow,
    caution,
    actionAdvice,
    followUpQuestions,
    temperature,
    cards: cards.map((card, index) => ({
      role: roles[index] || `${index + 1}번째 흐름`,
      cardName: card.name,
      orientation: card.isReversed ? '역방향' : '정방향',
      coreMeaning: card.isReversed ? (card.reversedMeaningKr || card.keywordKr) : card.keywordKr,
      contextualMeaning: cardMeanings[index] || '',
    })),
  };

  result.conclusion = oneLineConclusion;
  result.todayEmotion = result.card1Meaning;
  result.incomingPersonOrEvent = result.card2Meaning;
  result.outwardAttitude = result.card1Meaning;
  result.realFeeling = result.card2Meaning;
  result.hiddenEmotion = result.card2Meaning;
  result.futureAction = result.card3Meaning;
  result.contactRecommendation = oneLineConclusion;
  result.partnerCondition = result.card1Meaning;
  result.expectedResponse = result.card2Meaning;
  result.conversationPossibility = result.card3Meaning;
  result.avoidMessage = caution;
  result.recommendedApproach = actionAdvice;
  result.partnerFeeling = result.card1Meaning;
  result.relationshipBarrier = result.card2Meaning;
  result.nearFuture = result.card3Meaning;
  result.earlyWeek = result.card1Meaning;
  result.midWeek = result.card2Meaning;
  result.lateWeek = result.card3Meaning;
  result.turningPoint = totalFlow;

  return normalizeSpeakerLabels(result);
}

export function generateLocalPaidReading(params: {
  menuId?: string;
  menuTitle?: string;
  cards: TarotCard[];
  question?: string;
  situation?: string;
  relationship?: RelationshipType | string;
}): LocalPaidReadingResult {
  const category = categoryFor(params.menuId || '', params.menuTitle || '', params.question || params.situation || '');
  const base = generateLocalStandardReading({
    menuId: params.menuId || `question-${category}`,
    menuTitle: params.menuTitle || category,
    cards: params.cards,
    question: params.question || params.situation || '이 질문을 더 깊게 보고 싶어요.',
    situation: params.situation,
    relationship: params.relationship,
  });

  return normalizeSpeakerLabels({
    premiumConclusion: `${base.oneLineConclusion}\n조금 더 깊게 보면 핵심은 감정의 크기보다 지금 어떤 타이밍으로 움직여야 하는지예요.`,
    partnerEmotionSituation: base.card1Meaning,
    actionPossibility: base.card3Meaning,
    relationshipBarrier: base.caution,
    expectedResponse: base.totalFlow,
    detailedAdvice: `${base.actionAdvice}\n지금은 한 번에 답을 받으려 하기보다, 상대나 상황이 편하게 반응할 수 있는 길을 좁게 열어 두는 게 좋습니다.`,
  });
}

