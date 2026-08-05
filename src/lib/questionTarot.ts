export type QuestionCategory =
  | '연애'
  | '속마음'
  | '연락'
  | '재회'
  | '새로운 인연'
  | '인간관계'
  | '평판/시선'
  | '직장/이직'
  | '금전'
  | '시험/진로'
  | '선택 고민'
  | '일반 흐름';

const categoryRules: Array<{ category: QuestionCategory; keywords: string[] }> = [
  { category: '재회', keywords: ['재회', '다시 만', '헤어진', '돌아올', '전남친', '전여친'] },
  { category: '연락', keywords: ['연락', '답장', '카톡', '문자', '전화', '읽씹'] },
  { category: '속마음', keywords: ['속마음', '어떻게 생각', '진심', '나를 생각', '마음일', '좋아하', '호감', '관심 있', '나를 어떻게', '날 어떻게'] },
  { category: '새로운 인연', keywords: ['새로운 인연', '새 인연', '솔로', '소개팅', '연애운'] },
  { category: '평판/시선', keywords: ['사람들이 나를', '사람들은 나를', '어떻게 볼', '어떻게 생각할', '불쌍', '한심', '무시', '평판', '시선', '눈치', '오해', '비난', '욕할', '흉볼', '남들이', '주변에서'] },
  { category: '직장/이직', keywords: ['이직', '퇴사', '직장', '회사', '업무', '휴가', '연차', '반차', '조퇴', '결근', '상사', '팀장', '취업', '면접', '승진'] },
  { category: '금전', keywords: ['금전', '돈', '재물', '투자', '수입', '지출', '매출'] },
  { category: '시험/진로', keywords: ['시험', '합격', '진로', '공부', '학교', '전공', '자격증'] },
  { category: '선택 고민', keywords: ['선택', '결정', '해도 괜찮', '할까', '말까', '어느 쪽'] },
  { category: '인간관계', keywords: ['친구', '동료', '가족', '인간관계', '사람들과', '갈등'] },
  { category: '연애', keywords: ['그 사람', '관계', '사랑', '연애', '썸', '남자친구', '여자친구'] },
];

export function classifyQuestion(question: string): QuestionCategory {
  const normalized = question.replace(/\s+/g, ' ').trim().toLowerCase();
  return categoryRules.find(rule => rule.keywords.some(keyword => normalized.includes(keyword)))?.category || '일반 흐름';
}

export function getQuestionSpreadRoles(category: QuestionCategory): string[] {
  switch (category) {
    case '속마음': return ['겉으로 보이는 태도', '실제 마음', '앞으로의 행동'];
    case '연락': return ['상대의 현재 상태', '연락했을 때 반응', '연락 여부와 조언'];
    case '재회': return ['현재 두 사람의 상태', '재회의 가능성과 걸림돌', '앞으로의 흐름과 조언'];
    case '새로운 인연': return ['현재 나의 연애 상태', '다가오는 인연의 특징', '인연을 맞이하는 조언'];
    case '연애': return ['현재 관계의 핵심', '상대와 나 사이의 흐름', '앞으로의 방향과 조언'];
    case '평판/시선': return ['내가 걱정하는 시선', '사람들이 실제로 보는 부분', '나를 지키는 태도'];
    case '인간관계': return ['현재 관계의 핵심', '상대와 상황의 영향', '관계를 위한 조언'];
    case '직장/이직':
    case '시험/진로': return ['현재 상황', '앞으로의 가능성', '결정 전 확인할 점'];
    case '금전': return ['현재 금전 흐름', '들어오고 나가는 영향', '관리 방향과 조언'];
    case '선택 고민': return ['현재 핵심', '선택했을 때 흐름', '결정에 필요한 조언'];
    default: return ['현재 상황', '흐름을 움직이는 핵심', '앞으로의 방향과 조언'];
  }
}

export function isRelationshipCategory(category: QuestionCategory) {
  return ['연애', '속마음', '연락', '재회', '새로운 인연', '인간관계', '평판/시선'].includes(category);
}
