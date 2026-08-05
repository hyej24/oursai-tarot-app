import React, { useState } from 'react';
import { TarotCard } from '../types';

interface TarotCardImageProps {
  card: TarotCard;
  className?: string; // Optional custom styling
}

export const TarotCardImage: React.FC<TarotCardImageProps> = ({ card, className = "" }) => {
  const [hasError, setHasError] = useState(false);

  // Fallback to simpler card if loading fails or resource missing
  const handleCardImageError = () => {
    setHasError(true);
  };

  const isReversed = card?.isReversed;

  return (
    <div className={`flex flex-col items-center w-full max-w-[112px] min-w-0 ${className}`}>
      {/* Main card box with clean borders and very slight roundings */}
      <div className="relative w-full aspect-[58/100] bg-[#FAF9F5] rounded-md border border-[#BD6B65] overflow-hidden flex items-center justify-center p-0.5">
        {!hasError && card?.imagePath ? (
          <img
            src={card.imagePath}
            alt={`${card.nameKr} 타로 카드`}
            onError={handleCardImageError}
            className={`w-full h-full object-contain rounded-xs ${
              isReversed ? 'rotate-180' : ''
            }`}
          />
        ) : (
          /* Simple Fallback Card Design - NO broken images, beautiful styling */
          <div className="w-full h-full border border-dashed border-[#F2D1CD] rounded-xs flex flex-col items-center justify-around py-2.5">
            <span className={`text-3xl inline-block ${isReversed ? 'rotate-180' : ''}`}>
              {card?.emoji || '🔮'}
            </span>
            <span className="text-[8.5px] font-bold text-white bg-[#BD6B65] px-1.5 py-0.5 rounded-full scale-90">
              {isReversed ? '역방향' : '정방향'}
            </span>
          </div>
        )}
      </div>

      {/* Title displayed underneath so it works perfectly across resolutions */}
      <div className="mt-1 px-0.5 text-center w-full flex flex-col leading-tight min-h-[30px] justify-start">
        <span className="text-[10.5px] font-bold text-[#3C2F2F] tracking-tight truncate w-full">
          {card?.nameKr}
        </span>
        <span className="text-[7.5px] font-mono text-[#A69785] uppercase tracking-tight truncate w-full">
          {card?.nameEn || card?.name}
        </span>
        {isReversed && (
          <span className="text-[8.5px] text-[#BD6B65] font-semibold mt-0.5 block truncate">
            (역방향)
          </span>
        )}
      </div>
    </div>
  );
};
