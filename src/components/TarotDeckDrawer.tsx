import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Heart, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { TarotCard } from '../types';
import { TAROT_DECK } from '../data/tarotCards';
import { TarotCardImage } from './TarotCardImage';
import { getQuestionSpreadRoles, QuestionCategory } from '../lib/questionTarot';

interface TarotDeckDrawerProps {
  menuId: string;
  menuTitle: string;
  question?: string;
  onCompleteDraw: (selected: TarotCard[]) => void;
  onCancel: () => void;
}

export function TarotDeckDrawer(props: TarotDeckDrawerProps) {
  const targetCardCount = props.menuId === 'daily-temperature' ? 1 : 3;
  const [shuffling, setShuffling] = useState<boolean>(true);
  const [shuffled, setShuffled] = useState<boolean>(false);
  const [selectedCards, setSelectedCards] = useState<TarotCard[]>([]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Mouse dragging to scroll (swipe simulation)
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeftState, setScrollLeftState] = useState(0);
  const [hasMoved, setHasMoved] = useState(false);
  const hasMovedRef = useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrollContainerRef.current) return;
    setIsDragging(true);
    setStartX(e.pageX - scrollContainerRef.current.offsetLeft);
    setScrollLeftState(scrollContainerRef.current.scrollLeft);
    setHasMoved(false);
    hasMovedRef.current = false;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollContainerRef.current) return;
    e.preventDefault();
    const x = e.pageX - scrollContainerRef.current.offsetLeft;
    const walk = (x - startX) * 2; // scroll speed multiplier
    if (Math.abs(walk) > 8) {
      setHasMoved(true);
      hasMovedRef.current = true;
    }
    scrollContainerRef.current.scrollLeft = scrollLeftState - walk;
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  const handleDeckClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (shuffling || !shuffled || hasMovedRef.current || !scrollContainerRef.current) return;

    const container = scrollContainerRef.current;
    const cardButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('.tarot-deck-card-button'));
    const cardRects = cardButtons.map((button, index) => ({
      index,
      rect: button.getBoundingClientRect(),
      isHidden: button.classList.contains('opacity-0'),
    }));

    const activeRects = cardRects.filter(({ isHidden }) => !isHidden);
    if (activeRects.length === 0) return;

    const withinVerticalCardArea = activeRects.some(({ rect }) => (
      event.clientY >= rect.top && event.clientY <= rect.bottom
    ));
    if (!withinVerticalCardArea) return;

    const hit = activeRects.find(({ rect }, activeIndex) => {
      const nextRect = activeRects[activeIndex + 1]?.rect;
      const visibleLeft = rect.left;
      const visibleRight = nextRect ? Math.min(nextRect.left, rect.right) : rect.right;
      return event.clientX >= visibleLeft && event.clientX < visibleRight;
    });

    const card = hit ? sessionDeck[hit.index] : undefined;
    if (!card) return;
    if (selectedCards.some(c => c.id === card.id)) return;

    handleCardClick(card);
  };

  const scroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const scrollAmount = direction === 'left' ? -280 : 280;
      scrollContainerRef.current.scrollBy({
        left: scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  // Generate randomized deck when component loads
  const [sessionDeck, setSessionDeck] = useState<TarotCard[]>([]);

  useEffect(() => {
    // Generate a fresh shuffled deck of 78 cards
    const deck = [...TAROT_DECK];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    setSessionDeck(deck);

    // Auto trigger shuffle animation for 1.8 seconds on enter
    const timer = setTimeout(() => {
      setShuffling(false);
      setShuffled(true);
    }, 1800);

    return () => clearTimeout(timer);
  }, []);

  const handleManualShuffle = () => {
    setShuffling(true);
    setShuffled(false);
    
    // Quick shuffle
    const deck = [...TAROT_DECK];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    setSessionDeck(deck);
    setSelectedCards([]);

    setTimeout(() => {
      setShuffling(false);
      setShuffled(true);
    }, 1500);
  };

  const handleCardClick = (card: TarotCard) => {
    if (shuffling || !shuffled) return;
    if (selectedCards.some(c => c.id === card.id)) {
      return;
    }
    if (selectedCards.length >= targetCardCount) return;

    // 오늘의 온도 리딩은 카드 의미가 흔들리지 않도록 역방향을 쓰지 않는다.
    const isReversed = props.menuId === 'daily-temperature' ? false : Math.random() < 0.5;
    const cardWithReversedState: TarotCard = {
      ...card,
      isReversed
    };
    setSelectedCards([...selectedCards, cardWithReversedState]);
  };

  // Get description of card orders based on menu
  const getSlotLabel = (index: number) => {
    if (targetCardCount === 1) return '오늘의 온도 카드';
    return `${index + 1}번째 카드`;

    if (props.menuId.startsWith('question-')) {
      return getQuestionSpreadRoles(props.menuTitle as QuestionCategory)[index];
    }
    if (props.menuId === 'dating-luck') {
      if (index === 0) return '첫째: 감정 흐름';
      if (index === 1) return '둘째: 만남과 인연';
      if (index === 2) return '셋째: 행동 조언';
    } else if (props.menuId === 'inner-mind') {
      if (index === 0) return '첫째: 말과 태도';
      if (index === 1) return '둘째: 깊은 속마음';
      if (index === 2) return '셋째: 미래 행동';
    } else if (props.menuId === 'can-contact') {
      if (index === 0) return '첫째: 상대의 상태';
      if (index === 1) return '둘째: 연락시 반응';
      if (index === 2) return '셋째: 소통 조언';
    } else if (props.menuId === 'relation-temp') {
      if (index === 0) return '첫째: 현재 감정';
      if (index === 1) return '둘째: 소통 장벽';
      if (index === 2) return '셋째: 관계 흐름';
    } else if (props.menuId === 'relation-flow') {
      if (index === 0) return '첫째: 주 초반 흐름';
      if (index === 1) return '둘째: 주 중반 변화';
      if (index === 2) return '셋째: 주 후반 결과';
    }
    return `카드 ${index + 1}`;
  };

  return (
    <div className="flex-1 flex flex-col justify-between px-6 pb-20 pt-2 selection:bg-rose-100">
      {/* Header Info */}
      <div className="text-center mt-4">
        <span className="text-xs font-medium tracking-widest text-[#BD6B65] bg-rose-50 px-3 py-1 rounded-full uppercase">
          {props.menuId.startsWith('question-') ? `${props.menuTitle} 질문` : props.menuTitle}
        </span>
        
        <h2 className="font-serif text-2xl text-[#3C2F2F] mt-4 font-bold tracking-tight leading-snug break-keep">
          {shuffling ? (
            <motion.div
              initial={{ opacity: 0.7 }}
              animate={{ opacity: [0.7, 1, 0.7] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
            >
              질문을 마음에 담고 카드를 섞고 있어요
            </motion.div>
          ) : (
            <>{targetCardCount === 1 ? '오늘의 온도를 보여줄 카드 한 장을 골라 주세요' : '마음이 가는 카드 세 장을 골라 주세요'}</>
          )}
        </h2>
        
        <p className="text-xs text-[#8A7A71] mt-2 font-sans px-4 break-keep">
          {shuffling 
            ? "질문과 카드의 흐름을 천천히 연결하고 있어요."
            : props.question
              ? `“${props.question}”`
              : "질문을 떠올리며 마음에 들어오는 카드를 선택해 보세요."
          }
        </p>
      </div>

      {/* 78-Card Deck Canvas */}
      <div className="my-auto py-4 relative flex flex-col items-center justify-center min-h-[280px]">
        {shuffling ? (
          /* Shuffling Animations */
          <div className="w-full max-w-[220px] h-[190px] relative flex items-center justify-center">
            {Array.from({ length: 12 }).map((_, idx) => (
              <motion.div
                key={`shuffling-card-${idx}`}
                className="absolute w-[100px] h-[155px] bg-[#FAF9F5] border border-[#E6A19C] rounded-xl flex items-center justify-center shadow-sm"
                animate={{
                  x: [
                    0, 
                    idx % 2 === 0 ? -60 - (idx * 5) : 60 + (idx * 5), 
                    idx % 3 === 0 ? 30 : -30, 
                    0
                  ],
                  rotate: [
                    0, 
                    idx % 2 === 0 ? -12 : 12, 
                    idx % 3 === 0 ? 6 : -6, 
                    0
                  ],
                  scale: [1, 1.05, 0.95, 1],
                  zIndex: [idx, 20 + idx, idx]
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: idx * 0.08
                }}
              >
                <div className="w-[88%] h-[92%] border border-dashed border-[#F2D1CD] rounded-lg flex flex-col items-center justify-center">
                  <Heart className="w-4 h-4 text-[#BD6B65] fill-[#F7D7D3] stroke-[1.2] opacity-80" />
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          /* Real selection fan container */
          <div className="w-full flex flex-col items-center">
            {/* Horizontal Scroll Area with navigation buttons */}
            <div className="relative w-full flex items-center group px-1">
              {/* Left Arrow Button */}
              <button
                type="button"
                onClick={() => scroll('left')}
                className="absolute left-0 z-50 p-2 bg-white/95 border border-[#EAE3D2] rounded-full hover:bg-white shadow-md active:scale-95 transition-all text-[#3C2F2F] cursor-pointer"
                title="이전 카드 보기"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* Dynamic Horizontal Spread of 78 Cards */}
              <div 
                ref={scrollContainerRef}
                className={`w-full min-h-[180px] overflow-x-auto flex items-end gap-0 pt-10 pb-8 px-10 scrollbar-none snap-x snap-mandatory ${
                  isDragging ? 'cursor-grabbing' : 'cursor-grab'
                }`}
                style={{ WebkitOverflowScrolling: 'touch' }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUpOrLeave}
                onMouseLeave={handleMouseUpOrLeave}
                onClick={handleDeckClick}
              >
                {sessionDeck.map((card, idx) => {
                  const isSelected = selectedCards.some(c => c.id === card.id);
                  const orderSelected = selectedCards.findIndex(c => c.id === card.id) + 1;
                  const selectedTransform = `translateY(104px) scale(0.72)`;
                  const idleTransform = `translateY(0) scale(1)`;
                  
                  return (
                    <div
                      key={`deck-card-${card.id}`}
                      className="flex-shrink-0 w-[44px] h-[126px] relative select-none snap-center"
                      style={{
                        zIndex: isSelected ? 90 : 10 + idx,
                        transformOrigin: '50% 100%'
                      }}
                      onDragStart={(e) => e.preventDefault()}
                    >
                      {false && !isSelected && (
                        <button
                          type="button"
                          data-card-hit-target="true"
                          aria-label={`${idx + 1}번 카드 선택`}
                          className="absolute left-[-9px] top-0 z-20 h-[126px] w-[58px] rounded-xl bg-transparent cursor-pointer"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (hasMovedRef.current) return;
                            handleCardClick(card);
                          }}
                        />
                      )}
                      {/* Visual card only. The transparent slice button above owns the click target. */}
                      <button
                        type="button"
                        disabled={isSelected}
                        aria-label={`${idx + 1}번 카드 선택`}
                        className={`tarot-deck-card-button pointer-events-none absolute left-1/2 top-0 h-[118px] w-[76px] min-w-0 -translate-x-1/2 rounded-xl border bg-[#FAF9F5] transition-[transform,border-color,box-shadow,opacity] duration-500 ease-out ${
                          isSelected ? 'pointer-events-none opacity-0' : 'cursor-pointer active:scale-[0.98]'
                        } ${
                          isSelected ? 'border-[#BD6B65] shadow-[0_12px_24px_rgba(189,107,101,0.18)] ring-2 ring-rose-100' : 'border-[#E6A19C] shadow-xs'
                        }`}
                        style={{
                          transform: `translateX(-50%) ${isSelected ? selectedTransform : idleTransform}`
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (hasMovedRef.current || isSelected) return;
                          handleCardClick(card);
                        }}
                      >
                        {/* Tiny subtle hand-drawn frame */}
                        <div className="w-full h-full p-1.5 flex flex-col justify-between">
                          <div className="w-full h-full border border-dashed border-[#F5E6E3] rounded-lg flex flex-col items-center justify-between py-5 px-1">
                            <span className="text-[11px] font-semibold text-[#BD6B65]/70 font-serif leading-none">
                              {idx + 1}
                            </span>

                            <div className="p-1 rounded-full bg-rose-50/50">
                              <Heart className={`w-3.5 h-3.5 stroke-[1.1] ${isSelected ? 'text-[#BD6B65] fill-[#F7D7D3]' : 'text-[#E6A19C] fill-[#FBEAE8]'}`} />
                            </div>

                            {isSelected ? (
                              <div className="w-5 h-5 rounded-full bg-[#BD6B65] text-white flex items-center justify-center text-[11px] font-bold">
                                {orderSelected}
                              </div>
                            ) : (
                              <span className="w-1.5 h-1.5 rounded-full bg-[#EAE3D2]" />
                            )}
                          </div>
                        </div>
                      </button>
                      {false && isSelected && (
                        <button
                          type="button"
                          className="pointer-events-auto absolute left-1/2 top-[-38px] z-[2] h-[56px] w-[76px] -translate-x-1/2 rounded-xl bg-transparent"
                          aria-label={`선택한 ${idx + 1}번 카드 해제`}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (hasMoved) return;
                            handleCardClick(card);
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Right Arrow Button */}
              <button
                type="button"
                onClick={() => scroll('right')}
                className="absolute right-0 z-50 p-2 bg-white/95 border border-[#EAE3D2] rounded-full hover:bg-white shadow-md active:scale-95 transition-all text-[#3C2F2F] cursor-pointer"
                title="다음 카드 보기"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Hint to helper */}
            <p className="text-[10.5px] text-[#9E8F86] mt-2 italic flex items-center gap-1.5 px-4 text-center break-keep">
              <span>스와이프하여 78장의 전체 카드를 확인해 보세요.</span>
            </p>
          </div>
        )}
      </div>

      {/* Selected bottom slots */}
      <div className="w-full overflow-hidden bg-[#F3EFE6] rounded-2xl p-4 border border-[#EAE3D2]">
        <div className={targetCardCount === 1 ? "flex justify-center" : "grid grid-cols-3 gap-2.5"}>
          {Array.from({ length: targetCardCount }).map((_, slotIdx) => {
            const card = selectedCards[slotIdx];
            return (
              <div 
                key={`target-slot-${slotIdx}`} 
                className="flex flex-col items-center"
              >
                <button
                  type="button"
                  disabled={!card}
                  aria-label={card ? `${slotIdx + 1}번째 선택 카드` : `${slotIdx + 1}번째 카드 자리`}
                  onClick={(event) => {
                    event.preventDefault();
                  }}
                    className={`selected-tarot-slot w-[70px] max-w-[70px] min-w-0 overflow-hidden transition-colors ${
                    card 
                      ? 'cursor-default' 
                      : 'aspect-[2/3] bg-transparent border-dashed border-2 border-[#DBCFB8] rounded-xl flex items-center justify-center'
                  }`}
                >
                  {card ? (
                    <motion.div
                      key={`selected-slot-card-${card.id}`}
                      className="w-[70px] max-w-[70px] min-w-0 overflow-hidden"
                      initial={{ y: -54, scale: 0.86, opacity: 0.35 }}
                      animate={{ y: 0, scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 420, damping: 30, mass: 0.8 }}
                    >
                      <TarotCardImage card={card} className="w-[70px] max-w-[70px]" />
                    </motion.div>
                  ) : (
                    <span className="text-[11px] text-[#A69785] font-serif">
                      {slotIdx + 1}
                    </span>
                  )}
                </button>
                <span className="text-[10px] text-[#817267] mt-1.5 whitespace-nowrap text-center font-medium">
                  {getSlotLabel(slotIdx)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Action triggers */}
      <div className="mt-6 flex gap-3">
        <button
          onClick={props.onCancel}
          className="flex-1 py-3 text-xs bg-transparent border border-[#3C2F2F] hover:bg-[#F3EFE6] rounded-xl font-medium text-[#3C2F2F] transition-all tracking-wider"
        >
          돌아가기
        </button>

        {shuffled && (
          <button
            onClick={handleManualShuffle}
            type="button"
            title="다시 섞기"
            className="p-3 bg-cream border border-[#EAE3D2] hover:bg-[#EAE3D2] rounded-xl text-[#3C2F2F] transition-all flex items-center justify-center"
          >
            <RefreshCw className="w-4 h-4 text-[#3C2F2F]" />
          </button>
        )}

        <button
          onClick={() => {
            if (selectedCards.length === targetCardCount) {
              props.onCompleteDraw(selectedCards);
            }
          }}
          disabled={selectedCards.length !== targetCardCount || shuffling}
          className={`flex-[2] py-3 text-xs rounded-xl font-medium tracking-widest text-center shadow-xs transition-all ${
            selectedCards.length === targetCardCount && !shuffling
              ? 'bg-[#BD6B65] hover:bg-[#AC5B55] text-white cursor-pointer'
              : 'bg-[#EAE3D2] text-[#A69785] cursor-not-allowed'
          }`}
        >
          카드 확인하기
        </button>
      </div>
    </div>
  );
}
