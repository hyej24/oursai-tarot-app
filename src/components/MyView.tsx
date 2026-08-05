import React, { useState } from 'react';
import { Gem, Share2 } from 'lucide-react';
import {
  AD_GYEOL_TOKEN_REWARD,
  QUESTION_PASS_PACKAGES,
  READING_TOKEN_COST,
  SHARE_READING_PASS_REWARD
} from '../lib/appConstants';

interface MyViewProps {
  gyeolTokenBalance: number;
  dailyFreeAvailable: boolean;
  onClaimAdReward: () => boolean;
  onShareAppReward: () => Promise<boolean | null>;
}

export function MyView({
  gyeolTokenBalance,
  dailyFreeAvailable,
  onClaimAdReward,
  onShareAppReward
}: MyViewProps) {
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const showFeedback = (message: string) => {
    setFeedbackMessage(message);
    setTimeout(() => setFeedbackMessage(null), 2500);
  };

  const showPaymentPendingMessage = () => {
    showFeedback('결제 기능은 지금 준비 중이에요.');
  };

  const claimAdReward = () => {
    const granted = onClaimAdReward();
    showFeedback(
      granted
        ? `광고 보상 질문권 ${AD_GYEOL_TOKEN_REWARD}개가 지급됐어요.`
        : '오늘 광고 보상은 이미 받았어요.'
    );
  };

  const claimShareReward = async () => {
    const granted = await onShareAppReward();
    if (granted === null) {
      showFeedback('공유가 취소됐어요.');
      return;
    }

    showFeedback(
      granted
        ? `앱 공유 보상으로 질문권 ${SHARE_READING_PASS_REWARD}개가 지급됐어요.`
        : '오늘 앱 공유 보상은 이미 받았어요.'
    );
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
            <p className="mt-0.5 text-[11px] leading-snug text-[#B09A8E]">공유·광고·구매</p>
          </div>
        </div>

        <p className="mt-2.5 text-[12.5px] text-[#8A7A71] leading-relaxed break-keep">
          기본 질문권은 매일 1개 충전되고 자정이 지나면 사라져요.
          <br />
          추가 질문은 질문권 {READING_TOKEN_COST}개를 사용해요.
        </p>

        <button
          type="button"
          onClick={claimShareReward}
          className="mt-3 flex w-full min-h-[42px] items-center justify-center gap-2 rounded-xl border border-[#E6A19C] bg-white/70 text-[#BD6B65] text-[14px] font-serif font-bold"
        >
          <Share2 className="h-4 w-4" />
          앱 공유하고 질문권 +{SHARE_READING_PASS_REWARD}
        </button>

        <button
          type="button"
          onClick={claimAdReward}
          className="mt-2 w-full min-h-[42px] rounded-xl bg-[#BD6B65] text-white text-[14px] font-serif font-bold"
        >
          광고 보고 질문권 +{AD_GYEOL_TOKEN_REWARD}
        </button>

        <div className="mt-2 grid grid-cols-1 gap-2">
          {QUESTION_PASS_PACKAGES.map((pkg) => (
            <button
              key={pkg.count}
              type="button"
              onClick={showPaymentPendingMessage}
              className="w-full min-h-[39px] rounded-xl bg-[#F3EFE6] border border-[#EAE3D2] text-[#A69785] text-[13.5px] font-serif font-bold"
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
