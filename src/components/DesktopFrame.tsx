import React from 'react';

interface DesktopFrameProps {
  children: React.ReactNode;
}

export function DesktopFrame(props: DesktopFrameProps) {
  return (
    <div className="min-h-screen bg-[#F5F2EA] flex items-center justify-center font-sans text-[#3C2F2F]">
      {/* Container simulating a premium mobile screen on desktop */}
      <div className="w-full max-w-md h-screen md:h-[840px] md:rounded-[32px] md:shadow-2xl md:border-8 md:border-[#3C2F2F] bg-[#FAF9F5] flex flex-col overflow-hidden relative">
        {/* Invisible speaker cutout for styling realism on desktop */}
        <div className="hidden md:block absolute top-3 left-1/2 -translate-x-1/2 w-28 h-5 bg-[#3C2F2F] rounded-full z-50">
          <div className="w-8 h-1 bg-[#4A3D3D] mx-auto mt-2 rounded" />
        </div>
        
        {/* App Content */}
        <div className="flex-1 flex flex-col h-full overflow-y-auto scrollbar-thin scrollbar-thumb-amber-100 z-10 pt-4 md:pt-10">
          {props.children}
        </div>
      </div>
    </div>
  );
}
