import React, { useState } from 'react';
import { Gem, Share2 } from 'lucide-react';
import {
  QUESTION_PASS_PACKAGES,
  READING_TOKEN_COST
} from '../lib/appConstants';

interface MyViewProps {
  gyeolTokenBalance: number;
  dailyFreeAvailable: boolean;
  onPurchaseQuestionPass: (count: number) => Promise<boolean>;
  onClaimShareRewardPass: () => Promise<boolean>;
}

export function MyView({
  gyeolTokenBalance,
  dailyFreeAvailable,
  onPurchaseQuestionPass,
  onClaimShareRewardPass
}: MyViewProps) {
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [shareRewardLoading, setShareRewardLoading] = useState(false);

  const showFeedback = (message: string) => {
    setFeedbackMessage(message);
    setTimeout(() => setFeedbackMessage(null), 2500);
  };

  const purchaseQuestionPass = async (count: number, label: string) => {
    const purchased = await onPurchaseQuestionPass(count);
    if (purchased) {
      showFeedback(`${label}이 충전됐어요.`);
    }
  };

  const claimShareReward = async () => {
    if (shareRewardLoading) return;
    setShareRewardLoading(true);
    const rewarded = await onClaimShareRewardPass();
    setShareRewardLoading(false);

    if (rewarded) {
      showFeedback('앱 공유 질문권 1개가 지급됐어요.');
    }
  };

  return (
    <div className="flex-grow flex flex-col justify-start px-5 pb-3 select-none animate-fadeIn bg-[#FAF9F5]">
      <section className="pt-4 pb-3 text-center">
        <p className="text-[11px] tracking-[0.16em] text-[#BD6B65] font-mono">MY TAROT</p>
        <h2 className="mt-1 font-serif text-[24px] font-bold text-[#3C2F2F]">마이페이지</h2>
      </section>

      <section className="rounded-[22px] border border-[#EAE3D2] bg-white/58 p-4 text-center shadow-[0_10px_26px_rgba(95,64,48,0.06)]">
        <h3 className="font-serif text-[16.5px] font-bold text-[#3C2F2F] flex items-center justify-center gap-1.5">
          <Gem className="w-4.5 h-4.5 text-[#BD6B65]" />
          <span>내 질문권</span>
        </h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-[#8A7A71]">
          오늘 바로 볼 수 있는 질문 {gyeolTokenBalance + (dailyFreeAvailable ? 1 : 0)}개
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <div className="rounded-[16px] border border-[#EAE3D2] bg-[#FFFDF8] px-3 py-2.5">
            <p className="font-serif text-[12.5px] font-bold text-[#8A7A71]">오늘 기본</p>
            <div className="mt-1 flex items-end justify-center gap-1">
              <strong className="font-serif text-[26px] leading-none text-[#BD6B65]">
                {dailyFreeAvailable ? 1 : 0}
              </strong>
              <span className="pb-0.5 text-[13px] text-[#8A7A71]">개</span>
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-[#B09A8E]">오늘 밤 자정 소멸</p>
          </div>

          <div className="rounded-[16px] border border-[#EAE3D2] bg-[#FFFDF8] px-3 py-2.5">
            <p className="font-serif text-[12.5px] font-bold text-[#8A7A71]">보유 질문권</p>
            <div className="mt-1 flex items-end justify-center gap-1">
              <strong className="font-serif text-[26px] leading-none text-[#BD6B65]">{gyeolTokenBalance}</strong>
              <span className="pb-0.5 text-[13px] text-[#8A7A71]">개</span>
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-[#B09A8E]">공유·구매</p>
          </div>
        </div>

        <p className="mt-2.5 text-[12.5px] text-[#8A7A71] leading-relaxed break-keep">
          기본 질문권은 매일 1개 충전되고 자정이 지나면 사라져요.
          <br />
          광고를 보면 하루 1번 질문권 1개를 받을 수 있어요.
          <br />
          이후 추가 질문은 질문권 {READING_TOKEN_COST}개를 사용해요.
        </p>

        <div className="mt-2 grid grid-cols-1 gap-2">
          <button
            type="button"
            disabled={shareRewardLoading}
            onClick={() => {
              void claimShareReward();
            }}
            className="w-full min-h-[42px] rounded-xl bg-white border border-[#E6A19C] text-[#BD6B65] text-[13.5px] font-serif font-bold flex items-center justify-center gap-1.5 disabled:opacity-70"
          >
            <Share2 className="w-4 h-4" />
            {shareRewardLoading ? '공유 여는 중...' : '앱 공유하고 질문권 1개 받기'}
          </button>
          {QUESTION_PASS_PACKAGES.map((pkg) => (
            <button
              key={pkg.count}
              type="button"
              onClick={() => {
                void purchaseQuestionPass(pkg.count, pkg.label);
              }}
              className="w-full min-h-[39px] rounded-xl bg-[#F3EFE6] border border-[#EAE3D2] text-[#7A5C52] text-[13.5px] font-serif font-bold"
            >
              {pkg.label} · {pkg.priceText}
            </button>
          ))}
        </div>

        {feedbackMessage && (
          <div className="mt-3 text-[13px] text-[#BD6B65] font-semibold py-1.5 bg-rose-50/50 rounded-lg text-center animate-fadeIn">
            {feedbackMessage}
          </div>
        )}
      </section>

      <div className="flex-1 flex items-center justify-center py-2">
        <p className="text-center text-[12px] leading-relaxed tracking-[-0.02em] text-[#B09A8E] break-keep">
          이용해 주셔서 감사합니다.<br />
          여러분들의 마음이 조금 더 행복해지길 바라요.
        </p>
      </div>
    </div>
  );
}
