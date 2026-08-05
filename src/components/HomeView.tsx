import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  CalendarHeart,
  Heart,
  MessageCircle,
  NotebookPen,
  RefreshCcw,
  Sparkles,
  Thermometer,
  UsersRound,
  X
} from 'lucide-react';
import { DAILY_TEMPERATURE_READING_KEY, DAILY_TEMPERATURE_READING_VERSION } from '../lib/appConstants';
import { getKstDateKey } from '../lib/kstDate';

interface HomeViewProps {
  onSubmitQuestion: (question: string) => void;
  gyeolTokenBalance?: number;
  dailyFreeAvailable?: boolean;
  dailyGyeolTokenClaimed?: boolean;
  onClaimDailyTokens?: () => void;
  onPaidQuestion?: () => void;
}

type LoveMenu = {
  title: string;
  subtitle: string;
  question: string;
  situationGuide: string;
  situationPlaceholder: string;
  icon: React.ElementType;
};

const TEMPERATURE_QUESTION = '오늘, 그 사람과 나의 온도는 몇 도일까요?';

const LOVE_MENUS: LoveMenu[] = [
  {
    title: '속마음 타로',
    subtitle: '그 사람의 속마음은?',
    question: '그 사람의 속마음은?',
    situationGuide: '그 사람과 최근 있었던 분위기나 신경 쓰였던 장면을 적어주세요.',
    situationPlaceholder: '예: 요즘 연락은 오는데 예전보다 답장이 짧아졌어요. 속마음이 뭘까요?',
    icon: Heart
  },
  {
    title: '호감 확인',
    subtitle: '걔가 날 좋아할까?',
    question: '걔가 날 좋아할까?',
    situationGuide: '상대가 보였던 관심 표현이나 설렜던 행동을 적어주세요.',
    situationPlaceholder: '예: 요즘 자꾸 먼저 연락이 와요. 그 사람이 절 좋아하는지 궁금해요.',
    icon: MessageCircle
  },
  {
    title: '관계 흐름',
    subtitle: '우리 관계의 흐름은?',
    question: '우리 관계의 흐름은?',
    situationGuide: '지금 두 사람 사이에서 가장 궁금한 관계 흐름을 적어주세요.',
    situationPlaceholder: '예: 연락은 꾸준히 이어지고 있지만 관계가 애매해요. 앞으로 더 가까워질지 궁금해요.',
    icon: UsersRound
  },
  {
    title: '연락 가능성',
    subtitle: '연락이 올 가능성은?',
    question: '연락이 올 가능성은?',
    situationGuide: '최근 연락 분위기와 기다리고 있는 포인트를 적어주세요.',
    situationPlaceholder: '예: 일주일째 연락이 끊긴 상태예요. 상대가 먼저 연락해올지 궁금해요.',
    icon: CalendarHeart
  },
  {
    title: '재회 가능성',
    subtitle: '다시 만날 가능성은?',
    question: '다시 만날 가능성은?',
    situationGuide: '헤어진 시점과 다시 이어지고 싶은 이유를 적어주세요.',
    situationPlaceholder: '예: 한 달 전 다투고 헤어진 뒤 연락이 끊겼어요. 다시 이어질 가능성이 궁금해요.',
    icon: RefreshCcw
  },
  {
    title: '새로운 인연',
    subtitle: '새 인연이 올까요?',
    question: '새 인연이 올까요?',
    situationGuide: '요즘 만남 흐름이나 기대하는 인연의 느낌을 적어주세요.',
    situationPlaceholder: '예: 새로운 인연은 언제쯤 들어올까요?',
    icon: Sparkles
  }
];

function getSavedTemperature(): string {
  if (typeof window === 'undefined') return '';

  const raw = localStorage.getItem(DAILY_TEMPERATURE_READING_KEY);
  if (!raw) return '';

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.date !== getKstDateKey()) return '';
    if (parsed?.version !== DAILY_TEMPERATURE_READING_VERSION) return '';

    const value = Number(parsed?.temperature);
    if (Number.isFinite(value)) return `${value.toFixed(1)}\u00B0`;
  } catch {
    return '';
  }

  return '';
}

function hasSavedTemperature(): boolean {
  if (typeof window === 'undefined') return false;

  const raw = localStorage.getItem(DAILY_TEMPERATURE_READING_KEY);
  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw);
    const value = Number(parsed?.temperature);
    return (
      parsed?.date === getKstDateKey() &&
      parsed?.version === DAILY_TEMPERATURE_READING_VERSION &&
      Number.isFinite(value)
    );
  } catch {
    return false;
  }
}

export function HomeView({ onSubmitQuestion, gyeolTokenBalance = 0, dailyFreeAvailable = true }: HomeViewProps) {
  const [selectedMenu, setSelectedMenu] = useState<LoveMenu | null>(null);
  const [situationText, setSituationText] = useState('');
  const [isCustomQuestionOpen, setIsCustomQuestionOpen] = useState(false);
  const [customQuestionText, setCustomQuestionText] = useState('');
  const [temperature, setTemperature] = useState('37.3°');

  const [hasTemperatureReading, setHasTemperatureReading] = useState(false);

  useEffect(() => {
    setTemperature(getSavedTemperature());
    setHasTemperatureReading(hasSavedTemperature());
  }, []);

  const closeSituationModal = () => {
    setSelectedMenu(null);
    setSituationText('');
  };

  const submitMenuQuestion = () => {
    if (!selectedMenu) return;

    const situation = situationText.trim();
    const question = situation
      ? `${selectedMenu.question}\n현재 상황: ${situation}`
      : selectedMenu.question;

    closeSituationModal();
    onSubmitQuestion(question);
  };

  const closeCustomQuestionModal = () => {
    setIsCustomQuestionOpen(false);
    setCustomQuestionText('');
  };

  const submitCustomQuestion = () => {
    const question = customQuestionText.trim();
    if (!question) return;

    closeCustomQuestionModal();
    onSubmitQuestion(question);
  };

  return (
    <div
      data-testid="question-home"
      className="relative flex flex-grow flex-col overflow-hidden bg-[radial-gradient(circle_at_84%_9%,rgba(218,188,166,0.16),transparent_28%),linear-gradient(180deg,#FFFDF8_0%,#FBF5EC_55%,#FFFDF8_100%)] px-[20px] pb-[7px] pt-[12px] text-[#3C2F2F]"
    >
      <div className="pointer-events-none absolute right-[-44px] top-14 h-72 w-40 rounded-full bg-[#D9B69E]/10 blur-3xl" />
      <div className="pointer-events-none absolute right-[-20px] top-34 h-72 w-24 rotate-12 rounded-full border border-[#DAB9A8]/10 blur-[1px]" />

      <div className="relative z-10 flex items-center justify-between">
        <div className="flex h-[32px] min-w-[112px] items-center justify-center rounded-full border border-[#E2B9AE] bg-white/58 px-4 font-serif text-[13.5px] font-bold text-[#7A5C52] shadow-[0_6px_18px_rgba(92,62,46,0.04)]">
          오늘 무료 {dailyFreeAvailable ? 1 : 0}개
        </div>
        <div className="flex h-[32px] min-w-[112px] items-center justify-center rounded-full border border-[#E2B9AE] bg-white/58 px-4 font-serif text-[13.5px] font-bold text-[#C87470] shadow-[0_6px_18px_rgba(92,62,46,0.04)]">
          추가 질문권 {gyeolTokenBalance}개
        </div>
      </div>

      <section className="relative z-10 mt-[3px] text-center">
        <h1 className="font-serif text-[33px] font-bold leading-[1.08] tracking-[-0.075em] text-[#2F211F]">
          <span className="mb-0.5 block text-[20px] tracking-[-0.03em]">타로 :</span>
          우리 사이 <span className="text-[#D87975]">온도</span>
        </h1>
        <div className="mx-auto mt-2 flex w-[116px] items-center justify-center gap-3">
          <span className="h-px flex-1 bg-[#E5D3C4]" />
          <Heart className="h-[11px] w-[11px] fill-[#F8D7D3] text-[#D4847D]" strokeWidth={1.8} />
          <span className="h-px flex-1 bg-[#E5D3C4]" />
        </div>
        <p className="mt-2 font-serif text-[15px] font-semibold tracking-[-0.045em] text-[#6D5650]">
          그 사람도 나를 <span className="text-[#D87975]">생각할까?</span>
        </p>
      </section>

      <section className="relative z-10 mt-[12px] flex min-h-[214px] flex-col rounded-[26px] border border-[#E8D4C7] bg-white/66 px-[19px] pb-[15px] pt-[15px] shadow-[0_14px_30px_rgba(95,64,48,0.065)] backdrop-blur-sm">
        <div className="flex items-center gap-2 font-serif text-[14px] font-bold text-[#7A5C52]">
          <Thermometer className="h-[17px] w-[17px] text-[#D37F79]" strokeWidth={1.8} />
          <span>오늘의 온도 리딩</span>
          {hasTemperatureReading && (
            <span className="ml-1 text-[15px] font-extrabold text-[#D87975]">{temperature}</span>
          )}
          <span className="rounded-full bg-[#F6DEDA] px-2.5 py-0.5 text-[11px] font-bold text-[#C87470]">
            {hasTemperatureReading ? '오늘 기록' : '광고'}
          </span>
        </div>

        <h2 className="mt-3 break-keep font-serif text-[23px] font-bold leading-[1.3] tracking-[-0.055em] text-[#2F211F]">
          오늘, 그 사람과 나의<br />
          <span className="text-[#D87975]">온도</span>는 몇 도일까요?
        </h2>

        <p className="mt-3.5 whitespace-nowrap font-sans text-[13.8px] leading-[1.55] tracking-[-0.04em] text-[#6D5650]">
          카드 한 장으로 오늘 우리 사이의 온도를 확인해보세요.
        </p>

        <button
          type="button"
          onClick={() => onSubmitQuestion(TEMPERATURE_QUESTION)}
          className="mt-[16px] flex h-[48px] w-full items-center justify-center gap-2 rounded-[17px] bg-[#CA7C73] font-serif text-[15.5px] font-bold text-white shadow-[0_10px_20px_rgba(202,124,115,0.17)] transition-transform active:scale-[0.99]"
        >
          <span>{hasTemperatureReading ? '오늘 온도 다시 확인하기' : '오늘의 온도 확인하기 · 광고 시청'}</span>
          <ArrowRight className="h-[16px] w-[16px]" />
        </button>
      </section>

      <section className="relative z-10 mt-[9px] grid grid-cols-3 gap-[9px] pb-0">
        {LOVE_MENUS.map((menu) => {
          const Icon = menu.icon;

          return (
            <button
              key={menu.title}
              type="button"
              onClick={() => setSelectedMenu(menu)}
              className="flex h-[103px] min-w-0 flex-col items-center justify-between rounded-[16px] border border-[#EEE0D2] bg-white/68 px-2 py-2.5 text-center shadow-[0_8px_20px_rgba(95,64,48,0.05)] transition-transform active:scale-[0.98]"
            >
              <span className="flex h-[33px] w-[33px] items-center justify-center rounded-full bg-[#F7E8E4] text-[#B98177]">
                <Icon className="h-[17px] w-[17px]" strokeWidth={1.7} />
              </span>
              <span className="block w-full break-keep font-serif text-[13px] font-bold leading-[1.12] tracking-[-0.04em] text-[#2F211F]">
                {menu.title}
              </span>
              <span className="block w-full break-keep text-[9.5px] leading-[1.15] tracking-[-0.045em] text-[#7F675D]">
                {menu.subtitle}
              </span>
              <ArrowRight className="-mt-0.5 h-[12px] w-[12px] text-[#A6766B]" />
            </button>
          );
        })}
      </section>

      <button
        type="button"
        onClick={() => setIsCustomQuestionOpen(true)}
        className="relative z-10 mt-[9px] flex h-[72px] w-full items-center justify-center gap-4 rounded-[22px] border border-[#E4C6BA] bg-white/76 px-5 text-left shadow-[0_14px_32px_rgba(95,64,48,0.085)] transition-transform active:scale-[0.99] [&>span:first-child]:hidden"
      >
        <span>원하는 질문이 없나요? 직접 질문하기</span>
        <span className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[14px] bg-[#F7E8E4] text-[#C37A73]">
          <NotebookPen className="h-[23px] w-[23px]" strokeWidth={1.6} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-[13px] font-bold leading-none text-[#3C2F2F]">
            원하는 질문이 없나요?
          </span>
          <span className="mt-1.5 block font-serif text-[16px] font-bold leading-none tracking-[-0.045em] text-[#BD6B65]">
            직접 질문하기
          </span>
        </span>
        <ArrowRight className="h-[18px] w-[18px] shrink-0 text-[#BD6B65]" />
      </button>

      {selectedMenu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2C201E]/30 px-4 py-6 backdrop-blur-[2px]">
          <div className="w-full max-w-[360px] rounded-[26px] border border-[#E9D8C8] bg-[#FFFDF8] p-5 shadow-[0_18px_48px_rgba(57,38,31,0.18)] animate-fadeIn">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-serif text-[13px] font-bold text-[#C9867B]">
                  {selectedMenu.title}
                </p>
                <h2 className="mt-1 font-serif text-[21px] font-bold leading-snug text-[#30211E]">
                  현재 상황을 알려주세요.
                </h2>
              </div>
              <button
                type="button"
                onClick={closeSituationModal}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F3EFE6] text-[#8A6F65]"
                aria-label="닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <textarea
              value={situationText}
              maxLength={140}
              onChange={(event) => setSituationText(event.target.value)}
              placeholder={selectedMenu.situationPlaceholder}
              className="mt-5 h-[112px] w-full resize-none rounded-[20px] border border-[#E8CFC7] bg-[#FFF4F1] px-4 py-3 text-[14px] leading-relaxed text-[#3C2F2F] placeholder:text-[#9C7E74]/68 focus:border-[#D9A49A] focus:bg-[#FFF8F5] focus:outline-none focus:ring-2 focus:ring-[#EFD2CB]/50"
            />

            <div className="mt-4 grid grid-cols-[0.9fr_1.1fr] gap-2">
              <button
                type="button"
                onClick={submitMenuQuestion}
                className="min-h-[46px] rounded-2xl border border-[#E7C9C2] bg-white text-[14px] font-serif font-bold text-[#BD6B65]"
              >
                건너뛰기
              </button>
              <button
                type="button"
                onClick={submitMenuQuestion}
                className="min-h-[46px] rounded-2xl bg-[#BD6B65] text-[14px] font-serif font-bold text-white shadow-[0_10px_22px_rgba(189,107,101,0.22)]"
              >
                카드 뽑으러 가기
              </button>
            </div>
          </div>
        </div>
      )}

      {isCustomQuestionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2C201E]/30 px-4 py-6 backdrop-blur-[2px]">
          <div className="w-full max-w-[360px] rounded-[26px] border border-[#E9D8C8] bg-[#FFFDF8] p-5 shadow-[0_18px_48px_rgba(57,38,31,0.18)] animate-fadeIn">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-serif text-[13px] font-bold text-[#C9867B]">
                  직접 질문하기
                </p>
                <h2 className="mt-1 font-serif text-[21px] font-bold leading-snug text-[#30211E]">
                  원하는 질문을 자유롭게 적어보세요.
                </h2>
              </div>
              <button
                type="button"
                onClick={closeCustomQuestionModal}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F3EFE6] text-[#8A6F65]"
                aria-label="닫기"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <textarea
              value={customQuestionText}
              maxLength={140}
              onChange={(event) => setCustomQuestionText(event.target.value)}
              className="mt-4 h-[112px] w-full resize-none rounded-[20px] border border-[#E8CFC7] bg-[#FFF4F1] px-4 py-3 text-[14px] leading-relaxed text-[#3C2F2F] focus:border-[#D9A49A] focus:bg-[#FFF8F5] focus:outline-none focus:ring-2 focus:ring-[#EFD2CB]/50"
            />

            <div className="mt-4 grid grid-cols-[0.9fr_1.1fr] gap-2">
              <button
                type="button"
                onClick={closeCustomQuestionModal}
                className="min-h-[46px] rounded-2xl border border-[#E7C9C2] bg-white text-[14px] font-serif font-bold text-[#BD6B65]"
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitCustomQuestion}
                disabled={!customQuestionText.trim()}
                className={`min-h-[46px] rounded-2xl text-[14px] font-serif font-bold shadow-[0_10px_22px_rgba(189,107,101,0.22)] ${
                  customQuestionText.trim()
                    ? 'bg-[#BD6B65] text-white'
                    : 'bg-[#E8DCD2] text-[#A49389]'
                }`}
              >
                카드 뽑으러 가기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
