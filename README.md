# 타로 : 우리 사이 온도

Gemini로 질문형 타로 리딩을 생성하는 React + Express 앱입니다.

## 로컬 실행

1. `npm install`
2. `.env.example`을 `.env`로 복사
3. `.env`의 `GEMINI_API_KEY`에 Google AI Studio API 키 입력
4. 필요하면 `GEMINI_MODEL` 변경 (기본값: `gemini-3.5-flash`)
5. `npm run dev`

브라우저에서 `http://localhost:3000`을 여세요.

## 리딩 방식

사용자가 직접 질문을 입력하면 앱이 질문 유형을 분류하고, 선택한 카드 3장과 정방향/역방향을 기반으로 Gemini 상담 리딩을 생성합니다. Gemini 키가 없거나 호출에 실패하면 앱은 로컬 기본 리딩으로 안전하게 전환됩니다.
