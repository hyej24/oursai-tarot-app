import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children?: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  public static getDerivedStateFromError(_: Error): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error', error, errorInfo);
  }

  public render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    return (
      <div className="flex-grow flex flex-col items-center justify-center py-20 px-8 text-center bg-[#FAF9F5] text-gray-800 animate-fadeIn h-full">
        <AlertTriangle className="w-10 h-10 text-[#BD6B65] mb-4" />
        <h3 className="font-serif text-[15px] font-bold text-[#3C2F2F]">
          화면을 다시 정리하고 있어요
        </h3>
        <p className="text-xs text-[#8A7A71] mt-3 max-w-xs mx-auto leading-relaxed break-keep font-sans">
          잠시 오류가 있었어요. 새로고침하거나 홈으로 돌아가 다시 이어서 확인해 주세요.
        </p>

        <div className="mt-8 flex flex-col gap-2.5 w-full max-w-xs">
          <button
            onClick={() => {
              this.setState({ hasError: false });
              window.location.reload();
            }}
            className="w-full py-2.5 bg-[#BD6B65] text-white text-xs font-semibold font-serif rounded-xl flex items-center justify-center gap-1.5 hover:bg-[#AC5B55] transition-colors cursor-pointer shadow-sm"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>다시 불러오기</span>
          </button>

          <button
            onClick={() => {
              this.setState({ hasError: false });
              window.location.hash = '';
              window.location.reload();
            }}
            className="w-full py-2.5 bg-white text-[#8A7A71] border border-[#EAE3D2] text-xs font-semibold font-serif rounded-xl flex items-center justify-center gap-1.5 hover:bg-gray-50 transition-colors cursor-pointer shadow-sm"
          >
            <Home className="w-3.5 h-3.5" />
            <span>홈으로 돌아가기</span>
          </button>
        </div>
      </div>
    );
  }
}
