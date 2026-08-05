import React, { useEffect, useState } from 'react';
import { BookHeart, Calendar, ChevronDown, Share2, Trash2 } from 'lucide-react';
import { readingStorage, SavedReading } from '../lib/readingStorage';
import { TarotCardImage } from './TarotCardImage';
import { buildSharedReadingUrl } from '../lib/sharedReadingLink';

interface RecordsViewProps {
  onBackToHome: () => void;
  onOpenReadingWithPartner?: (...args: any[]) => void;
}

export function RecordsView({ onBackToHome }: RecordsViewProps) {
  const [readings, setReadings] = useState<SavedReading[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadReadings = () => setReadings(readingStorage.getAllReadings());
  useEffect(loadReadings, []);

  const removeReading = (id: string) => {
    if (!confirm('이 리딩 기록을 삭제할까요?')) return;
    readingStorage.deleteReading(id);
    if (expandedId === id) setExpandedId(null);
    loadReadings();
  };

  const shareReading = async (reading: SavedReading) => {
    const shareUrl = buildSharedReadingUrl(reading);
    const shareText = [
      '타로 : 우리 사이 온도',
      '',
      '이 리딩 같이 볼래?',
    ].filter(Boolean).join('\n');

    try {
      if (navigator.share) {
        await navigator.share({
          title: '타로 : 우리 사이 온도',
          text: shareText,
          url: shareUrl,
        });
        return;
      }

      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      alert('리딩 공유 링크를 복사했어요.');
    } catch (error) {
      console.warn('Reading share failed:', error);
    }
  };

  const formatRecordDate = (dateTime: string) => {
    const match = dateTime.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
    if (!match) return dateTime;
    return `${match[2]}.${match[3]} ${match[4]}:${match[5]}`;
  };

  return (
    <div className="flex-grow flex flex-col px-5 pb-3 animate-fadeIn bg-[#FAF9F5]">
      <div className="pt-4 pb-3 text-center">
        <p className="text-[11px] tracking-[0.16em] text-[#BD6B65] font-mono">MY TAROT</p>
        <h2 className="mt-1 font-serif text-[24px] font-bold text-[#3C2F2F]">리딩 기록</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-[#8A7A71]">
          직접 저장한 질문과 카드 해석만 모아 보여드려요.
        </p>
      </div>

      {readings.length === 0 ? (
        <div className="my-auto p-8 rounded-[22px] bg-[#F3EFE6]/35 border border-dashed border-[#DBCFB8] text-center">
          <BookHeart className="w-9 h-9 text-[#BD6B65] mx-auto stroke-[1.2]" />
          <h3 className="mt-3 text-[15px] font-serif font-bold text-[#3C2F2F]">아직 저장한 리딩이 없어요</h3>
          <p className="mt-1.5 text-[12px] text-[#8A7A71] leading-relaxed break-keep">
            질문하고 결과 화면에서 ‘이 리딩 저장하기’를 누르면 여기에 기록돼요.
          </p>
          <button onClick={onBackToHome} className="mt-5 px-4 py-2.5 rounded-xl bg-[#BD6B65] text-white text-[13px] font-serif font-bold">
            질문하러 가기
          </button>
        </div>
      ) : (
        <div className="space-y-2.5 mt-4">
          {readings.map(reading => {
            const expanded = expandedId === reading.id;
            return (
              <article key={reading.id} className="rounded-[20px] bg-white/92 border border-[#EAE3D2] overflow-hidden shadow-[0_8px_20px_rgba(60,47,47,0.035)]">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : reading.id)}
                  className="w-full px-4 py-3.5 text-left flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-[#FBF7EF] px-2.5 py-1 text-[10.5px] text-[#A69785] font-mono">
                      <Calendar className="w-3 h-3" />
                      {formatRecordDate(reading.dateTime)}
                    </div>
                    <h3 className="mt-2 text-[15px] font-serif font-bold text-[#3C2F2F] leading-[1.35] break-keep line-clamp-2">
                      {reading.question}
                    </h3>
                  </div>
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#F8F2EA] text-[#8A7A71]">
                    <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                  </span>
                </button>

                {expanded && (
                  <div className="px-4 pb-4 border-t border-[#EAE3D2]/60">
                    <div className="grid grid-cols-3 gap-2.5 py-4">
                      {reading.cards.map(card => <TarotCardImage key={card.id} card={card} />)}
                    </div>
                    <div className="space-y-4 text-[14px] text-[#5C4F4F] leading-[1.75] break-keep">
                      {reading.readingResult.oneLineConclusion && (
                        <div className="p-3.5 rounded-xl bg-[#F3EFE6]/55 font-serif font-bold text-[14px] leading-[1.65] text-[#BD6B65]">
                          {reading.readingResult.oneLineConclusion}
                        </div>
                      )}
                      {[reading.readingResult.card1Meaning, reading.readingResult.card2Meaning, reading.readingResult.card3Meaning]
                        .filter(Boolean).map((text, index) => (
                          <p key={index}>
                            <strong className="font-serif text-[14.5px] text-[#3C2F2F]">{index + 1}번 카드.</strong>
                            {' '}
                            {text}
                          </p>
                        ))}
                      {reading.readingResult.totalFlow && (
                        <p>
                          <strong className="font-serif text-[14.5px] text-[#3C2F2F]">전체 흐름.</strong>
                          {' '}
                          {reading.readingResult.totalFlow}
                        </p>
                      )}
                      {reading.readingResult.actionAdvice && (
                        <p>
                          <strong className="font-serif text-[14.5px] text-[#3C2F2F]">필요한 조언.</strong>
                          {' '}
                          {reading.readingResult.actionAdvice}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => shareReading(reading)}
                      className="mt-4 w-full py-3 rounded-lg bg-[#BD6B65] text-[13.5px] text-white font-serif font-bold flex items-center justify-center gap-1.5"
                    >
                      <Share2 className="w-4 h-4" /> 리딩 공유하기
                    </button>
                    <button
                      type="button"
                      onClick={() => removeReading(reading.id)}
                      className="mt-2 w-full py-2.5 rounded-lg border border-[#F2D1CD] text-[12px] text-[#BD6B65] flex items-center justify-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> 이 기록 삭제하기
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
