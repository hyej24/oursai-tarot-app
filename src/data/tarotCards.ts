import { TarotCard } from '../types';

const RAW_TAROT_DECK: any[] = [
  // ----------------- MAJOR ARCANA -----------------
  { id: 0, name: "The Fool", nameKr: "바보", type: "major", value: 0, keywordKr: "새로운 시작, 자유로움, 모험심", emoji: "🌸" },
  { id: 1, name: "The Magician", nameKr: "마법사", type: "major", value: 1, keywordKr: "창의력, 자신감, 주도권", emoji: "🪄" },
  { id: 2, name: "The High Priestess", nameKr: "고위 여사제", type: "major", value: 2, keywordKr: "직관력, 신비로움, 속마음 판단", emoji: "📖" },
  { id: 3, name: "The Empress", nameKr: "여황제", type: "major", value: 3, keywordKr: "풍요로움, 모성애, 사랑 가득함", emoji: "👑" },
  { id: 4, name: "The Emperor", nameKr: "황제", type: "major", value: 4, keywordKr: "강한 통제, 보호 본능, 책임감", emoji: "⚔️" },
  { id: 5, name: "The Hierophant", nameKr: "교황", type: "major", value: 5, keywordKr: "신뢰감, 가치관 공유, 조력자", emoji: "⛪" },
  { id: 6, name: "The Lovers", nameKr: "연인", type: "major", value: 6, keywordKr: "매혹적인 정서, 깊은 교감, 조화", emoji: "💖" },
  { id: 7, name: "The Chariot", nameKr: "전차", type: "major", value: 7, keywordKr: "적극적인 추진, 열정, 거침없는 행동", emoji: "🛡️" },
  { id: 8, name: "Strength", nameKr: "힘", type: "major", value: 8, keywordKr: "부드러운 통제, 인내심, 정서적 유대", emoji: "🦁" },
  { id: 9, name: "The Hermit", nameKr: "은둔자", type: "major", value: 9, keywordKr: "조용한 생각, 자성, 신중한 거리두기", emoji: "🕯️" },
  { id: 10, name: "Wheel of Fortune", nameKr: "운명의 수레바퀴", type: "major", value: 10, keywordKr: "우연한 계기, 타이밍, 필연적 변화", emoji: "🌀" },
  { id: 11, name: "Justice", nameKr: "정의", type: "major", value: 11, keywordKr: "이성적인 판단, 균형감, 신중한 저울질", emoji: "⚖️" },
  { id: 12, name: "The Hanged Man", nameKr: "매달린 사람", type: "major", value: 12, keywordKr: "인내와 희생, 정체 상태, 관점 변화", emoji: "⏳" },
  { id: 13, name: "Death", nameKr: "죽음", type: "major", value: 13, keywordKr: "종결과 새로운 전환, 피할 수 없는 국면", emoji: "🎭" },
  { id: 14, name: "Temperance", nameKr: "절제", type: "major", value: 14, keywordKr: "조화로운 소통, 감정 절제, 점진적 교류", emoji: "🏺" },
  { id: 15, name: "The Devil", nameKr: "악마", type: "major", value: 15, keywordKr: "강한 집착, 차단 힘든 매력, 소유욕", emoji: "🥀" },
  { id: 16, name: "The Tower", nameKr: "탑", type: "major", value: 16, keywordKr: "급격한 충격, 관계 변화, 깨달음", emoji: "⚡" },
  { id: 17, name: "The Star", nameKr: "별", type: "major", value: 17, keywordKr: "연정 어린 기대, 동경, 이상적인 희망", emoji: "✨" },
  { id: 18, name: "The Moon", nameKr: "달", type: "major", value: 18, keywordKr: "불안과 의문, 조심스러움, 눈치 봄", emoji: "🌙" },
  { id: 19, name: "The Sun", nameKr: "태양", type: "major", value: 19, keywordKr: "투명한 감정, 긍정, 확고한 진심", emoji: "☀️" },
  { id: 20, name: "Judgement", nameKr: "심판", type: "major", value: 20, keywordKr: "오랜 고민 끝 재회, 분명한 응답, 결정", emoji: "🎺" },
  { id: 21, name: "The World", nameKr: "세계", type: "major", value: 21, keywordKr: "행복한 완성, 돈독한 관계 선언, 종착점", emoji: "🌐" },

  // ----------------- WANDS (지팡이 - 열정, 행동력, 에너지) -----------------
  { id: 22, name: "Ace of Wands", nameKr: "지팡이 에이스", type: "minor", suit: "wands", value: 1, keywordKr: "시작되는 두근거림, 열정의 싹", emoji: "🌱" },
  { id: 23, name: "Two of Wands", nameKr: "지팡이 2", type: "minor", suit: "wands", value: 2, keywordKr: "더 넓은 고민, 관계의 다음 단계 설계", emoji: "🧭" },
  { id: 24, name: "Three of Wands", nameKr: "지팡이 3", type: "minor", suit: "wands", value: 3, keywordKr: "안정적 전개, 더 큰 비전과 믿음", emoji: "🚩" },
  { id: 25, name: "Four of Wands", nameKr: "지팡이 4", type: "minor", suit: "wands", value: 4, keywordKr: "편안한 화합, 가족 같은 안정감, 기쁨", emoji: "🏡" },
  { id: 26, name: "Five of Wands", nameKr: "지팡이 5", type: "minor", suit: "wands", value: 5, keywordKr: "치열한 신경전, 자존심 다툼, 복잡함", emoji: "💥" },
  { id: 27, name: "Six of Wands", nameKr: "지팡이 6", type: "minor", suit: "wands", value: 6, keywordKr: "확실한 자신감, 관계 주도권 확보", emoji: "🏇" },
  { id: 28, name: "Seven of Wands", nameKr: "지팡이 7", type: "minor", suit: "wands", value: 7, keywordKr: "상황 극복 의지, 바쁜 상황, 방어 태세", emoji: "🛡️" },
  { id: 29, name: "Eight of Wands", nameKr: "지팡이 8", type: "minor", suit: "wands", value: 8, keywordKr: "급격히 빠른 진전, 전격적인 심정 변화", emoji: "🏹" },
  { id: 30, name: "Nine of Wands", nameKr: "지팡이 9", type: "minor", suit: "wands", value: 9, keywordKr: "경계 태세, 과거 상처로 인한 망설임", emoji: "🧱" },
  { id: 31, name: "Ten of Wands", nameKr: "지팡이 10", type: "minor", suit: "wands", value: 10, keywordKr: "지나친 책임감, 관계 압박, 무거운 짐", emoji: "🪵" },
  { id: 32, name: "Page of Wands", nameKr: "지팡이 시종", type: "minor", suit: "wands", value: 11, keywordKr: "호기심, 서툴지만 밝은 호감 표현", emoji: "👶" },
  { id: 33, name: "Knight of Wands", nameKr: "지팡이 기사", type: "minor", suit: "wands", value: 12, keywordKr: "과돌한 애정 전격 대시, 저돌적인 용기", emoji: "🐎" },
  { id: 34, name: "Queen of Wands", nameKr: "지팡이 여왕", type: "minor", suit: "wands", value: 13, keywordKr: "매력적이고 당당한 매력, 친화력", emoji: "🌻" },
  { id: 35, name: "King of Wands", nameKr: "지팡이 왕", type: "minor", suit: "wands", value: 14, keywordKr: "확고한 소망, 듬직하고 거침없는 기세", emoji: "🔥" },

  // ----------------- CUPS (컵 - 감정, 사랑, 관계, 교감) -----------------
  { id: 36, name: "Ace of Cups", nameKr: "컵 에이스", type: "minor", suit: "cups", value: 1, keywordKr: "새로운 감정의 샘, 설레는 진심", emoji: "🍷" },
  { id: 37, name: "Two of Cups", nameKr: "컵 2", type: "minor", suit: "cups", value: 2, keywordKr: "마음의 일치, 다정한 마음의 교환", emoji: "🥂" },
  { id: 38, name: "Three of Cups", nameKr: "컵 3", type: "minor", suit: "cups", value: 3, keywordKr: "기분 좋은 친목, 함께할 때의 행복감", emoji: "🥳" },
  { id: 39, name: "Four of Cups", nameKr: "컵 4", type: "minor", suit: "cups", value: 4, keywordKr: "무덤덤함, 감정 정체기, 호의에 대한 의구심", emoji: "😐" },
  { id: 40, name: "Five of Cups", nameKr: "컵 5", type: "minor", suit: "cups", value: 5, keywordKr: "우울감, 관계 실망감, 상실에 잠김", emoji: "🌧️" },
  { id: 41, name: "Six of Cups", nameKr: "컵 6", type: "minor", suit: "cups", value: 6, keywordKr: "그리움, 순수한 추억 회상, 옛정", emoji: "🧸" },
  { id: 42, name: "Seven of Cups", nameKr: "컵 7", type: "minor", suit: "cups", value: 7, keywordKr: "지나친 환상, 혼란스러운 관계 고민", emoji: "💭" },
  { id: 43, name: "Eight of Cups", nameKr: "컵 8", type: "minor", suit: "cups", value: 8, keywordKr: "감정의 마음 정리, 조용한 뒤돌아섬", emoji: "🚶" },
  { id: 44, name: "Nine of Cups", nameKr: "컵 9", type: "minor", suit: "cups", value: 9, keywordKr: "혼자서도 연착륙, 만족스러운 도취", emoji: "🍨" },
  { id: 45, name: "Ten of Cups", nameKr: "컵 10", type: "minor", suit: "cups", value: 10, keywordKr: "완벽한 정서적 유대감, 따뜻한 안식", emoji: "👨‍👩‍👧‍👦" },
  { id: 46, name: "Page of Cups", nameKr: "컵 시종", type: "minor", suit: "cups", value: 11, keywordKr: "감수성 풍부, 수선스럽고 귀여운 고백", emoji: "🐠" },
  { id: 47, name: "Knight of Cups", nameKr: "컵 기사", type: "minor", suit: "cups", value: 12, keywordKr: "다정한 백마 탄 기사, 부드러운 호감 전달", emoji: "🦄" },
  { id: 48, name: "Queen of Cups", nameKr: "컵 여왕", type: "minor", suit: "cups", value: 13, keywordKr: "모든 것을 품는 다정함, 깊은 연민과 사랑", emoji: "🌸" },
  { id: 49, name: "King of Cups", nameKr: "컵 왕", type: "minor", suit: "cups", value: 14, keywordKr: "넓은 포용력, 감정 조율 능력, 속깊은 배려", emoji: "🌊" },

  // ----------------- SWORDS (검 - 이성, 판단, 상처, 생각) -----------------
  { id: 50, name: "Ace of Swords", nameKr: "검 에이스", type: "minor", suit: "swords", value: 1, keywordKr: "냉철한 결정, 흔들림 없는 이성의 시작", emoji: "🗡️" },
  { id: 51, name: "Two of Swords", nameKr: "검 2", type: "minor", suit: "swords", value: 2, keywordKr: "팽팽한 저울질, 눈 가린 갈등 상황", emoji: "🙈" },
  { id: 52, name: "Three of Swords", nameKr: "검 3", type: "minor", suit: "swords", value: 3, keywordKr: "마음의 상처, 어긋난 현실에 대한 슬픔", emoji: "💔" },
  { id: 53, name: "Four of Swords", nameKr: "검 4", type: "minor", suit: "swords", value: 4, keywordKr: "조용한 휴식기, 연락을 멈추고 자아 성찰", emoji: "🛏️" },
  { id: 54, name: "Five of Swords", nameKr: "검 5", type: "minor", suit: "swords", value: 5, keywordKr: "상처뿐인 승리, 갈등 폭발, 날카로운 충돌", emoji: "🗯️" },
  { id: 55, name: "Six of Swords", nameKr: "검 6", type: "minor", suit: "swords", value: 6, keywordKr: "힘든 폭풍우를 견딘 이동, 조심스런 모색", emoji: "🛶" },
  { id: 56, name: "Seven of Swords", nameKr: "검 7", type: "minor", suit: "swords", value: 7, keywordKr: "조심스러운 마음 확인, 잔머리 굴림, 감춤", emoji: "🕵️" },
  { id: 57, name: "Eight of Swords", nameKr: "검 8", type: "minor", suit: "swords", value: 8, keywordKr: "스스로 갇힘, 눈가림 상태, 무기력감", emoji: "🕸️" },
  { id: 58, name: "Nine of Swords", nameKr: "검 9", type: "minor", suit: "swords", value: 9, keywordKr: "끝없는 불면의 고민, 미안함과 밤샘 후회", emoji: "💭" },
  { id: 59, name: "Ten of Swords", nameKr: "검 10", type: "minor", suit: "swords", value: 10, keywordKr: "바닥까지 도달한 고통, 완전한 끝과 희망", emoji: "🌅" },
  { id: 60, name: "Page of Swords", nameKr: "검 시종", type: "minor", suit: "swords", value: 11, keywordKr: "조심성 많은 정탐, SNS 염탐, 미숙한 경계심", emoji: "🔭" },
  { id: 61, name: "Knight of Swords", nameKr: "검 기사", type: "minor", suit: "swords", value: 12, keywordKr: "거침없이 쏘아붙임, 서두르는 해결책 요구", emoji: "💨" },
  { id: 62, name: "Queen of Swords", nameKr: "검 여왕", type: "minor", suit: "swords", value: 13, keywordKr: "냉철하고 선이 분명한 선긋기, 이성적인 배려", emoji: "❄️" },
  { id: 63, name: "King of Swords", nameKr: "검 왕", type: "minor", suit: "swords", value: 14, keywordKr: "확고한 이성주의자, 엄격한 감정 절제력", emoji: "🧠" },

  // ----------------- PENTACLES (펜타클 - 현실, 물질, 가시적인 가치) -----------------
  { id: 64, name: "Ace of Pentacles", nameKr: "펜타클 에이스", type: "minor", suit: "pentacles", value: 1, keywordKr: "현실적인 행운, 든든하고 소중한 관계의 시작", emoji: "🪙" },
  { id: 65, name: "Two of Pentacles", nameKr: "펜타클 2", type: "minor", suit: "pentacles", value: 2, keywordKr: "바쁜 현실적 조율, 밀당, 연락 밸런싱", emoji: "🤹" },
  { id: 66, name: "Three of Pentacles", nameKr: "펜타클 3", type: "minor", suit: "pentacles", value: 3, keywordKr: "공들여 쌓아감, 소속 집단의 인연, 돈독함", emoji: "🧱" },
  { id: 67, name: "Four of Pentacles", nameKr: "펜타클 4", type: "minor", suit: "pentacles", value: 4, keywordKr: "소유욕, 마음을 꽁꽁 닫음, 현재 유지 집착", emoji: "🧎" },
  { id: 68, name: "Five of Pentacles", nameKr: "펜타클 5", type: "minor", suit: "pentacles", value: 5, keywordKr: "춥고 처량한 현실의 고단함, 고난의 동행", emoji: "🌨️" },
  { id: 69, name: "Six of Pentacles", nameKr: "펜타클 6", type: "minor", suit: "pentacles", value: 6, keywordKr: "공평한 감정의 주고받음, 아량과 배려", emoji: "⚖️" },
  { id: 70, name: "Seven of Pentacles", nameKr: "펜타클 7", type: "minor", suit: "pentacles", value: 7, keywordKr: "신중한 수확 고민, 더 노력할지 회의감", emoji: "🌳" },
  { id: 71, name: "Eight of Pentacles", nameKr: "펜타클 8", type: "minor", suit: "pentacles", value: 8, keywordKr: "우직하고 성실한 사랑 가꾸기, 한 사람만 바라봄", emoji: "🔨" },
  { id: 72, name: "Nine of Pentacles", nameKr: "펜타클 9", type: "minor", suit: "pentacles", value: 9, keywordKr: "여유로운 독신 상태, 자존감 높은 매력", emoji: "🍇" },
  { id: 73, name: "Ten of Pentacles", nameKr: "펜타클 10", type: "minor", suit: "pentacles", value: 10, keywordKr: "가정적인 완성, 대가족 같은 돈독함과 약속", emoji: "🏰" },
  { id: 74, name: "Page of Pentacles", nameKr: "펜타클 시종", type: "minor", suit: "pentacles", value: 11, keywordKr: "성실하고 진중하며 조심성 어린 호감 출발", emoji: "🎓" },
  { id: 75, name: "Knight of Pentacles", nameKr: "펜타클 기사", type: "minor", suit: "pentacles", value: 12, keywordKr: "느리지만 한결같은 한 사람, 우직함과 믿음", emoji: "🐂" },
  { id: 76, name: "Queen of Pentacles", nameKr: "펜타클 여왕", type: "minor", suit: "pentacles", value: 13, keywordKr: "풍요롭고 너그러운 마음의 그늘막, 다독임", emoji: "🌿" },
  { id: 77, name: "King of Pentacles", nameKr: "펜타클 왕", type: "minor", suit: "pentacles", value: 14, keywordKr: "현실적 듬직함, 든든한 멘토, 굳건한 태도", emoji: "🪵" }
];

function getReversedMeaningKr(id: number, suit?: string, value?: number): string {
  // Major Arcana
  if (id === 0) return "무책임함, 무모함, 준비 부족, 시작의 지연, 어리석은 선택";
  if (id === 1) return "재능의 낭비, 사기성, 서툰 언행, 의지 약화, 허풍";
  if (id === 2) return "비밀의 탄로, 편협함, 이성을 잃은 감정, 차가운 거절";
  if (id === 3) return "탐욕, 게으름, 애정의 과잉과 집착, 정서적 권태기, 정체";
  if (id === 4) return "독재적 태도, 지배욕, 소극성, 무기력함, 무책임함";
  if (id === 5) return "고집, 독단적 태도, 신뢰의 훼손, 잘못된 조언, 편협함";
  if (id === 6) return "불협화음, 이별 수, 삼각관계, 유혹에 흔들림, 선택의 장애";
  if (id === 7) return "중도 하차, 통제력 상실, 방향을 잃음, 성급한 패배";
  if (id === 8) return "자만심, 통제 불능, 나약함, 감정 폭발, 인내심의 한계";
  if (id === 9) return "고립에서 벗어남, 소통 시작, 고지식한 태도 내려놓음, 조심스런 만남";
  if (id === 10) return "불운, 타이밍 어긋남, 지연, 변화에 대한 저항, 관계 침체";
  if (id === 11) return "불공평함, 편견, 균형 상실, 가혹한 선긋기, 일관성 없음";
  if (id === 12) return "무의미한 희생, 정체의 지속, 헛된 기다림 끝의 현실 자각, 집착 내려놓기";
  if (id === 13) return "지체되는 이별, 정체된 고통, 새로운 출발의 거부, 질질 끄는 인연";
  if (id === 14) return "소통 부조화, 감정의 불안정, 불균형, 서투른 감정조율";
  if (id === 15) return "집착에서 벗어남, 부정적인 고리 끊기, 깨달음, 관계의 새 출발";
  if (id === 16) return "급격한 파국 뒤 수습, 필연적 변화의 뒤늦은 수용, 긴장 상태";
  if (id === 17) return "헛된 희망, 실망감, 현실적인 벽에 부딪힘, 동경의 아쉬운 종말";
  if (id === 18) return "의혹과 불안의 서서히 해소, 오해 풀림, 현실적인 안정을 찾음";
  if (id === 19) return "일시적 슬럼프, 빛바랜 즐거움, 추진력 약화, 표현의 오해";
  if (id === 20) return "기회를 놓침, 후회, 재회 불통, 과거의 집착에서 헤어나지 못함";
  if (id === 21) return "불완전한 완성, 정체 상태, 예상보다 미진한 관계 마무리";

  // Minor Arcana by suit
  if (suit === "cups") {
    if (value === 1) return "결정적 감정이 식음, 서툰 호감 고백, 마음의 문을 닫음";
    if (value === 2) return "마음의 어긋남, 소통 거부, 일시적인 서먹함과 불통";
    if (value === 3) return "삼각관계 갈등, 주변 지인으로 인한 소통 방해, 허무한 관계";
    if (value === 4) return "정체기 극복, 다시 마음을 열고 새롭게 바라보기 시작함";
    if (value === 5) return "후회에서 벗어나려 함, 감정 회복, 과거를 다시 바라봄, 관계를 정리하거나 다시 이해하려는 과정";
    if (value === 6) return "추억에 과도한 얽매임, 현실을 보지 못하는 옛 고집";
    if (value === 7) return "환상에서 깨어나 현실 인지함, 갈등 봉합, 선택 정립";
    if (value === 8) return "다시 돌아오려 하는 미련, 정리한 관계를 재검토함";
    if (value === 9) return "내면의 공허함, 겉치레뿐인 애정, 정서적 불만족";
    if (value === 10) return "정서적 불화, 소속감 불안정, 일시적인 갈등과 서운함";
    if (value === 11) return "철없는 변덕, 질투심, 실없이 미숙한 태도, 감정 낭비";
    if (value === 12) return "가식과 기만적인 매너, 미온적인 호감 지연, 신뢰 부족";
    if (value === 13) return "신경질적 집착, 과도한 정서 불안, 서운함 폭발";
    if (value === 14) return "감정 조절 상실, 이기적인 가스라이팅, 속내 차단";
  }

  if (suit === "swords") {
    if (value === 1) return "이성의 마비, 잘못된 선택, 칼 같은 오해, 생각 폭주";
    if (value === 2) return "정체 한계 도달, 팽팽한 대립의 깨짐, 원치 않는 선택 직면";
    if (value === 3) return "치유의 시작, 상처로부터 극복, 점진적으로 미련 털어내기";
    if (value === 4) return "휴식이나 단절 상태의 끝, 조심스런 대화 재개 및 활동 돌입";
    if (value === 5) return "갈등 완화, 소모적 자존심 다툼 종결, 씁쓸한 합의";
    if (value === 6) return "미궁에 빠진 고민, 제자리걸음하는 소통, 정체의 장기화";
    if (value === 7) return "기만적인 행동의 발각, 정직하고 솔직한 대화, SNS 염탐 중단";
    if (value === 8) return "스스로 속박 풀기, 행동 시작, 갇힌 오명과 두려움에서 자각";
    if (value === 9) return "불면의 걱정 완화, 마음의 안정을 비로소 되찾기 시작함";
    if (value === 10) return "새로운 흐름 점진적 도래, 고통에서 점차 회복하기 시작함";
    if (value === 11) return "과도한 탐색 중단, 연락 및 경계 의구심 타파, 오해 희석";
    if (value === 12) return "급할 때 발생하는 소통 실수, 자멸적인 행동, 갈등 격화";
    if (value === 13) return "냉정하지만 일방적인 선긋기, 무관심, 서운한 비수 표현";
    if (value === 14) return "사나운 단절 고집, 이기주의, 이성적 성화와 잔소리";
  }

  if (suit === "wands") {
    if (value === 1) return "의욕 저하, 무산되는 연락/추진력, 초조하게 생각 식음";
    if (value === 2) return "갈 곳 잃은 행동 반경, 시야 상실, 발전의 여지없음";
    if (value === 3) return "행동의 차질, 어긋나는 연락 타이밍, 소외감";
    if (value === 4) return "일시적 불화, 어울리지 못하는 서먹함, 불안정함";
    if (value === 5) return "갈등 진정, 상호 협조 모색, 소모적 고집 내려놓음";
    if (value === 6) return "주도권 잃음, 자신감 과도 하락, 관계 소홀로 소통 지장";
    if (value === 7) return "지나친 부담으로 인한 도망, 방어벽 손실, 관계 포기";
    if (value === 8) return "움직임 정체, 답장 없음, 예정된 상황의 지연";
    if (value === 9) return "경계심 와해, 마음 낮춤과 소통 시도, 극도 피로";
    if (value === 10) return "관계 탈피, 무거운 책임 완화, 홀가분해진 연착륙";
    if (value === 11) return "무책임한 약속 위배, 행동 정체, 호기심 퇴색";
    if (value === 12) return "전격적인 행동 정지, 돌연 단절, 불성실한 가벼움";
    if (value === 13) return "심한 질투, 감정 오복, 소통 차단, 소외감 표현";
    if (value === 14) return "독단에 찬 고집으로 관계 긴장, 불도저식 행동 실패";
  }

  if (suit === "pentacles") {
    if (value === 1) return "기회의 상실, 기대하던 현실의 약속 지연, 정서 실직";
    if (value === 2) return "현실 타산적 균형 붕괴, 양다리/밀당의 성패 상실, 피곤";
    if (value === 3) return "합의 어긋남, 관계 협조 상실, 노련하지 못한 불화";
    if (value === 4) return "인색한 소통 해방, 마음 오픈, 물질/마음의 서툰 나눔";
    if (value === 5) return "고립 탈피, 새로운 기운 유입, 상호 위로로 기회 찾음";
    if (value === 6) return "불균형한 시혜, 이기적 타산, 계산 불공정";
    if (value === 7) return "회의감 가중, 무의미한 노력 후회, 관계의 허탈함";
    if (value === 8) return "관계 방치, 정성 상실, 매너리즘 가중에 따른 권태";
    if (value === 9) return "행복의 박탈감, 숨겨진 결핍, 타인 의존 증폭";
    if (value === 10) return "소속의 위기, 일시적 가족/단체 불화, 약속 미뤄짐";
    if (value === 11) return "지나치게 보수적인 태도로 연락 보류, 진척 부재";
    if (value === 12) return "정체 지연에 순응해 포기, 매너리즘 고착, 무관심";
    if (value === 13) return "인색함, 관계 불신, 과한 현실 집착, 소홀한 마음";
    if (value === 14) return "지나친 이해 타산과 고집, 완고한 거부, 속물적 가치";
  }

  return "상징 본질의 흐름 지연 혹은 왜곡적 발현, 내면적 성찰로 극복 모색 필요";
}

const majorSlugs = [
  "fool", "magician", "high-priestess", "empress", "emperor",
  "hierophant", "lovers", "chariot", "strength", "hermit",
  "wheel-of-fortune", "justice", "hanged-man", "death", "temperance",
  "devil", "tower", "star", "moon", "sun", "judgement", "world"
];

export const TAROT_DECK: TarotCard[] = RAW_TAROT_DECK.map(card => {
  // Generate nameEn and imagePath
  const nameEn = card.name;
  let imagePath = "";
  if (card.type === 'major') {
    const numStr = String(card.id).padStart(2, '0');
    const slug = majorSlugs[card.id] || "unknown";
    imagePath = `/tarot-cards/${numStr}-${slug}.webp`;
  } else {
    let valStr = "";
    if (card.value === 1) valStr = "ace";
    else if (card.value === 11) valStr = "page";
    else if (card.value === 12) valStr = "knight";
    else if (card.value === 13) valStr = "queen";
    else if (card.value === 14) valStr = "king";
    else valStr = String(card.value).padStart(2, '0');
    imagePath = `/tarot-cards/${card.suit}-${valStr}.webp`;
  }

  // 1. Initialize default scores
  let affectionScore = 50;
  let contactScore = 50;
  let defenseScore = 50;
  let progressScore = 50;
  let stabilityScore = 50;

  let reversedAffectionModifier = 0;
  let reversedContactModifier = 0;
  let reversedDefenseModifier = 0;
  let reversedProgressModifier = 0;
  let reversedStabilityModifier = 0;

  // 2. Map standard values depending on Major/Minor type and suit characteristics
  if (card.type === 'major') {
    // Lovers, Empress, Sun, World
    if ([3, 6, 19, 21].includes(card.id)) {
      affectionScore = 92;
      contactScore = 80;
      defenseScore = 15;
      progressScore = 88;
      stabilityScore = 85;

      reversedAffectionModifier = -10;
      reversedContactModifier = -15;
      reversedDefenseModifier = 15;
      reversedProgressModifier = -20;
      reversedStabilityModifier = -5;
    }
    // Hermit, Hanged man, Chariot, Tower, Death, Moon, Devil, etc.
    else if (card.id === 9) { // The Hermit (Quiet reflection, boundary)
      affectionScore = 50;
      contactScore = 15;
      defenseScore = 80;
      progressScore = 20;
      stabilityScore = 65;

      reversedAffectionModifier = 10; // Reversed Hermit opens up slightly
      reversedContactModifier = 25;   // Willing to step out of boundary
      reversedDefenseModifier = -30;  // Defense drops substantially
      reversedProgressModifier = 20;
    }
    else if (card.id === 12) { // The Hanged Man (Waiting, sacrifice)
      affectionScore = 60;
      contactScore = 15;
      defenseScore = 75;
      progressScore = 18;
      stabilityScore = 70;

      reversedAffectionModifier = 5;
      reversedContactModifier = 20;   // Inversion signifies termination of wait
      reversedDefenseModifier = -25;
      reversedProgressModifier = 25;
    }
    else if (card.id === 7 || card.id === 1) { // Chariot, Magician active
      affectionScore = 72;
      contactScore = 85;
      defenseScore = 25;
      progressScore = 82;
      stabilityScore = 55;

      reversedContactModifier = -20; // Inversion results in speed loss or misbehavior
      reversedProgressModifier = -15;
      reversedDefenseModifier = 15;
    }
    else if (card.id === 13 || card.id === 16) { // Death, Tower
      affectionScore = 25;
      contactScore = 15;
      defenseScore = 90;
      progressScore = 10;
      stabilityScore = 15;

      reversedAffectionModifier = 15; // Bottom hit and bouncing back
      reversedContactModifier = 15;
      reversedDefenseModifier = -20;
      reversedProgressModifier = 15;
    }
    else if (card.id === 18) { // The Moon (Fear, uncertainty)
      affectionScore = 42;
      contactScore = 30;
      defenseScore = 85;
      progressScore = 25;
      stabilityScore = 35;

      reversedAffectionModifier = 10;
      reversedDefenseModifier = -25; // Relief of anxiety
      reversedProgressModifier = 15;
    }
    else if (card.id === 15) { // The Devil (Attachment, obsession)
      affectionScore = 78;
      contactScore = 90;
      defenseScore = 35;
      progressScore = 60;
      stabilityScore = 30;

      reversedAffectionModifier = -15; // Breaking toxic chains
      reversedContactModifier = -25;
      reversedDefenseModifier = -10;
      reversedStabilityModifier = 10;
    }
    else { // Standard moderate major cards
      const seed = (card.id * 11) % 20;
      affectionScore = 65 + seed;
      contactScore = 55 + seed;
      defenseScore = 40 - seed / 2;
      progressScore = 60 + seed;
      stabilityScore = 65 + seed;
    }
  } else {
    // Minor Arcanas
    const val = card.value || 1;
    const isWands = card.suit === 'wands';
    const isCups = card.suit === 'cups';
    const isSwords = card.suit === 'swords';
    const isPentacles = card.suit === 'pentacles';

    if (isWands) {
      affectionScore = 60 + (val % 4) * 4;
      contactScore = 75 + (val % 3) * 6;
      defenseScore = 25 + (val % 3) * 5;
      progressScore = 70 + (val % 4) * 4;
      stabilityScore = 45 + (val % 5) * 5;

      reversedContactModifier = -20; // Inverted wands lose rapid momentum
      reversedProgressModifier = -15;

      // Special Wands cases
      if (card.id === 30) { // Wands 9 (Guard, Exhaustion)
        affectionScore = 45;
        contactScore = 20;
        defenseScore = 85;
        progressScore = 25;
        stabilityScore = 60;

        reversedContactModifier = 15;
        reversedDefenseModifier = -25; // Let guard down
        reversedProgressModifier = 15;
      }
    }
    else if (isCups) {
      affectionScore = 75 + (val % 4) * 4;
      contactScore = 55 + (val % 3) * 8;
      defenseScore = 20 + (val % 3) * 6;
      progressScore = 72 + (val % 4) * 5;
      stabilityScore = 60 + (val % 5) * 5;

      reversedAffectionModifier = -12; // Inverted cups cause overflow or delay of sentiment
      reversedContactModifier = -10;

      // Special Cups cases
      if (card.id === 40) { // Cups 5 (Disappointment, Sorriness)
        affectionScore = 35;
        contactScore = 25;
        defenseScore = 75;
        progressScore = 20;
        stabilityScore = 40;

        reversedAffectionModifier = 15; // Moving on, looking back at positive cups
        reversedDefenseModifier = -15;
        reversedProgressModifier = 15;
      }
    }
    else if (isSwords) {
      affectionScore = 35 + (val % 5) * 4;
      contactScore = 25 + (val % 4) * 6;
      defenseScore = 70 + (val % 3) * 7;
      progressScore = 25 + (val % 4) * 5;
      stabilityScore = 50 + (val % 5) * 5;

      reversedDefenseModifier = -18; // Inverted swords mitigate sharp rational boundaries
      reversedProgressModifier = 10;

      // Special Swords cases
      if (card.id === 53) { // Swords 4 (Rest, Inaction)
        affectionScore = 45;
        contactScore = 15;
        defenseScore = 80;
        progressScore = 20;
        stabilityScore = 65;

        reversedContactModifier = 25; // Waking up from rest
        reversedDefenseModifier = -25;
        reversedProgressModifier = 20;
      }
    }
    else if (isPentacles) {
      affectionScore = 55 + (val % 5) * 4;
      contactScore = 35 + (val % 4) * 6;
      defenseScore = 50 + (val % 3) * 8;
      progressScore = 40 + (val % 4) * 8;
      stabilityScore = 75 + (val % 4) * 5;

      reversedStabilityModifier = -15; // Inverted pentacles introduce financial/practical delays
    }
  }

  // 3. User's explicit hardcoded examples mapping to precise values
  // 컵 2 (Two of Cups): id 37
  if (card.id === 37) {
    affectionScore = 90;
    contactScore = 75;
    defenseScore = 20;
    progressScore = 85;
    stabilityScore = 75;
  }
  // 소드 8 (Eight of Swords): id 57
  else if (card.id === 57) {
    affectionScore = 40;
    contactScore = 20;
    defenseScore = 85;
    progressScore = 25;
    stabilityScore = 40;
  }
  // 완즈 8 (Eight of Wands): id 29
  else if (card.id === 29) {
    affectionScore = 65;
    contactScore = 90;
    defenseScore = 20;
    progressScore = 85;
    stabilityScore = 45;
  }
  // 펜타클 4 (Four of Pentacles): id 67
  else if (card.id === 67) {
    affectionScore = 55;
    contactScore = 30;
    defenseScore = 80;
    progressScore = 25;
    stabilityScore = 75;
  }

  // Ensure all boundary constraints (0 to 100) are met
  const clamp = (val: number) => Math.max(0, Math.min(100, Math.round(val)));

  // 3. Map new core properties requested by the user
  let affection = affectionScore;
  let action = contactScore;
  let defense = defenseScore;
  let communication = Math.round((contactScore + 100 - defenseScore) / 2);
  let stability = stabilityScore;
  let closure = Math.round((defenseScore + (100 - affectionScore)) / 2);
  let newConnection = Math.max(10, Math.min(95, Math.round((100 - defenseScore + progressScore) / 2)));
  let reconciliation = Math.max(10, Math.min(95, Math.round((affectionScore + stabilityScore) / 2)));

  // Customize based on suit characteristics
  const val = card.value || 1;
  const isWands = card.suit === 'wands';
  const isCups = card.suit === 'cups';
  const isSwords = card.suit === 'swords';
  const isPentacles = card.suit === 'pentacles';

  if (isCups) {
    affection = Math.round(affectionScore * 1.15);
    defense = Math.round(defenseScore * 0.6);
    communication = Math.round((contactScore * 0.8 + (100 - defenseScore)) / 2 + 20);
    closure = Math.max(5, Math.round(closure * 0.5));
    reconciliation = Math.round((affectionScore + stabilityScore) / 2 + 15);
    newConnection = Math.round(newConnection * 1.1);
  } else if (isSwords) {
    affection = Math.round(affectionScore * 0.6);
    defense = Math.round(defenseScore * 1.25);
    communication = Math.max(10, Math.round(communication * 0.5));
    closure = Math.round(closure * 1.3);
    reconciliation = Math.max(5, Math.round(reconciliation * 0.5));
    newConnection = Math.max(10, Math.round(newConnection * 0.5));
  } else if (isWands) {
    action = Math.round(contactScore * 1.2);
    communication = Math.round(communication * 1.15);
    stability = Math.round(stabilityScore * 0.75);
    reconciliation = Math.round(reconciliation * 0.85);
  } else if (isPentacles) {
    stability = Math.round(stabilityScore * 1.2);
    action = Math.round(contactScore * 0.75);
    closure = Math.round(closure * 0.75);
    newConnection = Math.round(newConnection * 1.15);
  }

  // Overrides for specific cards requested as examples or needing specific values
  // 컵 2 (Two of Cups): id 37
  if (card.id === 37) {
    affection = 90;
    action = 75; // 중간 이상
    defense = 15; // 낮음
    communication = 90; // 높음
    stability = 80; // 높음
    closure = 10; // 낮음
    newConnection = 85; 
    reconciliation = 90; // 높음
  }
  // 소드 사 (Four of Swords): id 53
  else if (card.id === 53) {
    affection = 35; // 낮음 또는 보류
    action = 10; // 매우 낮음
    defense = 85; // 높음
    communication = 15; // 낮음
    stability = 60; // 보류
    closure = 50; // 중간
    newConnection = 20;
    reconciliation = 30; // 낮음
  }
  // 완즈 팔 (Eight of Wands): id 29
  else if (card.id === 29) {
    affection = 65; // 중간
    action = 95; // 매우 높음
    defense = 15; // 낮음
    communication = 90; // 매우 높음
    stability = 45; // 중간 이하
    closure = 20; // 낮음
    newConnection = 75;
    reconciliation = 65;
  }
  // 소드 십 (Ten of Swords): id 59
  else if (card.id === 59) {
    affection = 15; // 낮음
    action = 10; // 낮음
    defense = 95; // 높음
    communication = 10; // 낮음
    stability = 10; // 낮음
    closure = 95; // 매우 높음
    newConnection = 30;
    reconciliation = 15; // 낮음
  }
  // 소드 8 (Eight of Swords): id 57
  else if (card.id === 57) {
    affection = 30;
    action = 15;
    defense = 85;
    communication = 15;
    stability = 35;
    closure = 75;
    newConnection = 20;
    reconciliation = 20;
  }
  // 펜타클 4 (Four of Pentacles): id 67
  else if (card.id === 67) {
    affection = 45;
    action = 25;
    defense = 80;
    communication = 25;
    stability = 80;
    closure = 35;
    newConnection = 30;
    reconciliation = 40;
  }
  // 은둔자 (Hermit): id 9
  else if (card.id === 9) {
    affection = 40;
    action = 15;
    defense = 85;
    communication = 15;
    stability = 65;
    closure = 45;
    newConnection = 20;
    reconciliation = 30;
  }

  return {
    ...card,
    nameEn,
    imagePath,
    reversedMeaningKr: getReversedMeaningKr(card.id, card.suit, card.value),
    affectionScore: clamp(affectionScore),
    contactScore: clamp(contactScore),
    defenseScore: clamp(defenseScore),
    progressScore: clamp(progressScore),
    stabilityScore: clamp(stabilityScore),
    reversedAffectionModifier: Math.round(reversedAffectionModifier),
    reversedContactModifier: Math.round(reversedContactModifier),
    reversedDefenseModifier: Math.round(reversedDefenseModifier),
    reversedProgressModifier: Math.round(reversedProgressModifier),
    reversedStabilityModifier: Math.round(reversedStabilityModifier),
    
    // Core traits requested in prompt
    affection: clamp(affection),
    action: clamp(action),
    defense: clamp(defense),
    communication: clamp(communication),
    stability: clamp(stability),
    closure: clamp(closure),
    newConnection: clamp(newConnection),
    reconciliation: clamp(reconciliation)
  };
});

/**
 * Deterministically calculates the relationship temperature based on the scores
 * of the 3-card spread, as per requested weights and state modifiers.
 */
export function calculateRelationshipTemperature(
  cards: any[],
  relationship?: string
): number {
  if (!cards || cards.length < 3) return 50;

  const getMetrics = (card: any) => {
    const found = TAROT_DECK.find(c => c.id === card.id);
    if (!found) {
      return { affection: 50, contact: 50, defense: 50, progress: 50, stability: 50 };
    }
    const isReversed = !!card.isReversed;
    let affection = found.affectionScore;
    let contact = found.contactScore;
    let defense = found.defenseScore;
    let progress = found.progressScore;
    let stability = found.stabilityScore;

    if (isReversed) {
      affection = Math.max(0, Math.min(100, affection + found.reversedAffectionModifier));
      contact = Math.max(0, Math.min(100, contact + found.reversedContactModifier));
      defense = Math.max(0, Math.min(100, defense + found.reversedDefenseModifier));
      progress = Math.max(0, Math.min(100, progress + found.reversedProgressModifier));
      stability = Math.max(0, Math.min(100, stability + found.reversedStabilityModifier));
    }
    return { affection, contact, defense, progress, stability };
  };

  const m1 = getMetrics(cards[0]);
  const m2 = getMetrics(cards[1]);
  const m3 = getMetrics(cards[2]);

  const avgContact = (m1.contact + m2.contact + m3.contact) / 3;
  const avgStability = (m1.stability + m2.stability + m3.stability) / 3;

  // Weights:
  // - 1st card affectionScore = 35%
  // - 2nd card defenseScore inverted (100 - defense) = 30%
  // - 3rd card progressScore = 20%
  // - Average contactScore partly reflected = 10%
  // - Average stabilityScore partly reflected = 5%
  let score = 
    (m1.affection * 0.35) + 
    ((100 - m2.defense) * 0.30) + 
    (m3.progress * 0.20) + 
    (avgContact * 0.10) + 
    (avgStability * 0.05);

  // Apply non-random relationship state adjustments
  if (relationship === "연애 중" || relationship === "연락 중" || relationship === "썸") {
    score += 5;
  } else if (relationship === "헤어진 상태" || relationship === "연락 단절") {
    score -= 10;
  }

  // Soft clamps to 12 - 98 range
  return Math.max(12, Math.min(98, Math.round(score)));
}
