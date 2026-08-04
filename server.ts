import express from "express";
import path from "path";
import { createServer as createHttpServer } from "http";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { calculateRelationshipTemperature, TAROT_DECK } from "./src/data/tarotCards";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const isDev = process.env.NODE_ENV !== "production";
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);
const apiRateLimitWindowMs = Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60_000);
const apiRateLimitMax = Number(process.env.API_RATE_LIMIT_MAX || 30);
const apiRateLimitHits = new Map<string, { count: number; resetAt: number }>();

app.use((req, res, next) => {
  const requestOrigin = req.headers.origin;
  const allowAnyOrigin = allowedOrigins.includes("*");

  if (allowAnyOrigin) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    res.setHeader("Access-Control-Allow-Origin", requestOrigin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use("/api", (req, res, next) => {
  const now = Date.now();
  const key = `${req.ip}:${req.path}`;
  const current = apiRateLimitHits.get(key);

  if (!current || current.resetAt <= now) {
    apiRateLimitHits.set(key, { count: 1, resetAt: now + apiRateLimitWindowMs });
    return next();
  }

  if (current.count >= apiRateLimitMax) {
    return res.status(429).json({
      success: false,
      code: "API_RATE_LIMIT",
      message: "요청이 잠시 몰렸어요. 잠시 후 다시 시도해 주세요.",
      retryable: true,
    });
  }

  current.count += 1;
  return next();
});

// Startup Gemini key check
const rawKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const isKeyInvalid = !rawKey || rawKey === "MY_GEMINI_API_KEY" || rawKey.trim() === "" || rawKey === "undefined" || rawKey === "null";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_INTENT_MODEL = process.env.GEMINI_INTENT_MODEL || "gemini-2.5-flash";
const GEMINI_FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-2.5-flash-lite,gemini-2.0-flash-lite,gemini-flash-latest")
  .split(",")
  .map(model => model.trim())
  .filter(Boolean);
const GEMINI_ENABLE_REPAIR = process.env.GEMINI_ENABLE_REPAIR === "true";
const GEMINI_ENABLE_INTENT_CLASSIFIER = process.env.GEMINI_ENABLE_INTENT_CLASSIFIER === "true";
const GEMINI_USE_RESPONSE_SCHEMA = process.env.GEMINI_USE_RESPONSE_SCHEMA === "true";
const GEMINI_USE_JSON_MIME = process.env.GEMINI_USE_JSON_MIME === "true";
const GEMINI_THINKING_BUDGET = Number(process.env.GEMINI_THINKING_BUDGET || 0);
const GEMINI_MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 3800);
const GEMINI_DEEP_MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_DEEP_MAX_OUTPUT_TOKENS || 2600);

if (isKeyInvalid) {
  console.error("=========================================================");
  console.error("⚠️  [DIAGNOSTICS] GEMINI_API_KEY is not configured or is a placeholder!");
  console.error(`Current Key Value: ${rawKey}`);
  console.error("AI readings will be blocked until Gemini is configured.");
  console.error("Configure GEMINI_API_KEY to enable Gemini-generated readings.");
  console.error("=========================================================");
} else {
  console.log("=========================================================");
  console.log("📡 [DIAGNOSTICS] GEMINI_API_KEY is present and registered.");
  console.log("=========================================================");
}

// Google-style schema tokens are kept so the existing response schemas remain readable.
const Type = {
  OBJECT: "object",
  STRING: "string",
  INTEGER: "integer",
  ARRAY: "array",
  BOOLEAN: "boolean",
} as const;

const GEMINI_TAROT_TRAINING = `
[Gemini 상담 리딩 훈련 규칙]
너는 "타로 : 우리 사이 온도"의 전담 연애 타로 상담사다. 질문자님의 연애 질문과 선택한 카드 3장을 근거로, 실제 사람이 옆에서 상담해 주는 것처럼 자연스럽고 따뜻하게 답한다.
호칭은 무조건 "질문자님"만 쓴다. "당신", "사용자", "내담자", "질문자" 단독 표현은 절대 쓰지 않는다.

1. 첫 문장은 반드시 질문에 직접 답한다.
   - 예: "지금 먼저 연락하는 건 가능해요. 대신 감정을 확인하려는 말보다 가볍게 안부를 여는 편이 좋아요."
   - 예: "끌림은 분명히 있어요. 다만 이 사람은 먼저 티 내는 걸 자존심 상하는 일처럼 느끼는 흐름이 보여요."
   - 예: "재회 가능성은 남아 있어요. 다만 그리움보다 현실적인 걸림돌을 먼저 풀어야 해요."

2. 질문 분야를 고정한다.
   - 질문 원문에 없는 주제로 답을 돌리지 않는다. 질문자님이 묻지 않은 연락 여부, 재회 가능성, 고백 여부로 결론을 바꾸지 않는다.
   - 이 앱의 기본 분야는 연애다. 상대의 속마음, 연락 흐름, 썸, 재회, 관계의 온도, 새로운 인연을 중심으로 답한다.
   - 연락을 묻지 않은 질문은 "먼저 연락해도 된다/말아라"로만 끝내지 말고, 관계의 온도와 상대의 태도까지 함께 짚는다.

3. 카드 근거를 반드시 보여 준다.
   - 각 카드 해석은 카드 이름, 정방향/역방향, 배열 역할을 반영한다.
   - 같은 말을 반복하지 말고, 세 카드가 각각 다른 역할을 하도록 해석한다.
   - 질문자님이 "헐, 이거 내 얘기인데"라고 느낄 만한 구체적인 직관 문장을 카드 해석이나 전체 흐름 안에 자연스럽게 섞는다.
   - 예: "이 사람 자존심이 좀 세네요.", "이미 답은 알고 있는데 확인받고 싶은 마음이 더 커 보여요.", "상대는 끌리면서도 먼저 지는 느낌을 싫어해요."
   - 단, 없는 사실을 지어내지 말고 카드와 질문에서 추론 가능한 행동 패턴, 반복되는 감정, 망설임의 이유만 짚는다.

4. 말투는 실제 상담사처럼 쓴다.
   - 기계적인 보고서 말투, 과장된 시적 문장, 뻔한 위로를 피한다.
   - "~일 수 있어요", "~로 보여요", "~가 좋아요"처럼 부드럽지만 분명하게 말한다.
   - 질문자님 앞에서 바로 말하듯 쓴다. "카드가 말합니다"를 반복하지 말고, "지금 느낌은요", "여기서 걸리는 건요", "솔직히 이 흐름은요"처럼 자연스럽게 말문을 연다.
   - 속마음/호감 질문은 연락 여부나 관계 전망으로 돌리지 말고, 첫 문장부터 "마음이 어느 정도인지"를 답한다.

5. 금지 패턴
   - "상대방도 질문자님을 생각하고 있어요" 같은 근거 없는 단정 금지
   - "무조건", "반드시", "운명적으로" 같은 확정 표현 금지
   - "정방향이라", "정방향이니"처럼 딱딱한 접속 표현 금지. 대신 "이 카드가 보여 주는 흐름상", "준비한 범위 안에서는"처럼 자연스럽게 풀어 쓴다.
    - "무슨무슨 자리의"처럼 분석표를 읽는 말투 금지. "현재 상황에서는", "앞으로는", "결정 전에는"처럼 바로 말한다.
    - "~에 가까워요", "~쪽에 가깝습니다" 같은 애매한 표현 금지. "그래서 지금은 ~입니다", "~로 보입니다", "~가 먼저입니다"처럼 직관적으로 말한다.
    - "마음이 없다고 보기는 어려워요" 같은 우회 표현 금지. 호감이 보이면 카드 흐름에 맞춰 "끌림이 꽤 선명해요", "관심은 있는데 자존심이 더 앞서요", "아직은 호기심 단계예요"처럼 다르게 말한다.
    - "시사합니다", "암시합니다", "나타냅니다", "의미합니다", "분석됩니다" 같은 논문/보고서 말투 금지.
    - "잡아내요", "잡아냅니다", "짚어내요"를 카드마다 반복하지 않는다. 한 리딩 안에서 같은 서술 동사를 연속으로 쓰지 말고 "드러나요", "읽혀요", "느껴져요", "흐름이 강해요", "먼저 올라와요", "걸려 있어요"처럼 자연스럽게 바꾼다.
    - "보여요"도 매 문장 반복하지 않는다. 상담사가 바로 말하듯 문장 구조를 섞는다.
    - "관망", "식었다기보다", "차갑다/차가운", "손익/손득/득실 계산", "~에 가까워요/가깝습니다" 금지.
    - "A는 B보다" 식의 딱딱한 비교문을 반복하지 않는다.
    - JSON 밖에 설명문, 마크다운, 코드블록 출력 금지
`;

type GenerateContentRequest = {
  model: string;
  contents: string;
  config?: {
    systemInstruction?: string;
    maxOutputTokens?: number;
    responseSchema?: Record<string, unknown>;
    responseMimeType?: string;
    temperature?: number;
    thinkingBudget?: number;
  };
};

function extractGeminiText(payload: any): string {
  return payload?.candidates?.[0]?.content?.parts
    ?.map((part: any) => part?.text || "")
    .join("")
    .trim() || "";
}

function compactObject<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => compactObject(item)).filter(item => item !== undefined) as T;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const compacted: Record<string, any> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null) {
      continue;
    }
    const nextValue = compactObject(item);
    if (
      nextValue &&
      typeof nextValue === "object" &&
      !Array.isArray(nextValue) &&
      Object.keys(nextValue).length === 0
    ) {
      continue;
    }
    compacted[key] = nextValue;
  }

  return compacted as T;
}

function isGeminiKeyError(status: number, errorText: string): boolean {
  const lower = errorText.toLowerCase();
  return (
    status === 401 ||
    status === 403 ||
    lower.includes("api key not valid") ||
    lower.includes("api_key_invalid") ||
    lower.includes("invalid api key") ||
    lower.includes("permission denied")
  );
}

function getGeminiClient() {
  if (isKeyInvalid) {
    return null;
  }

  return {
    models: {
      generateContent: async ({ model, contents, config }: GenerateContentRequest) => {
        const generationConfig: Record<string, any> = {
          temperature: config?.temperature,
          maxOutputTokens: config?.maxOutputTokens,
        };

        if (GEMINI_USE_JSON_MIME && config?.responseMimeType) {
          generationConfig.responseMimeType = config.responseMimeType;
        }

        if (GEMINI_USE_RESPONSE_SCHEMA && config?.responseSchema) {
          generationConfig.responseSchema = config.responseSchema;
        }

        if (config?.thinkingBudget !== undefined && config.thinkingBudget !== 0) {
          generationConfig.thinkingConfig = {
            thinkingBudget: config.thinkingBudget,
          };
        } else if (GEMINI_THINKING_BUDGET !== 0) {
          generationConfig.thinkingConfig = {
            thinkingBudget: GEMINI_THINKING_BUDGET,
          };
        }

        const payload = compactObject({
          systemInstruction: config?.systemInstruction
            ? { parts: [{ text: config.systemInstruction }] }
            : undefined,
          contents: [{ parts: [{ text: contents }] }],
          generationConfig,
        });

        const modelsToTry = [model, ...GEMINI_FALLBACK_MODELS.filter(fallbackModel => fallbackModel !== model)];
        let lastBusyError = "";
        let lastUnavailableError = "";
        let sawBusyError = false;

        for (const modelName of modelsToTry) {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": rawKey!,
            },
            body: JSON.stringify(payload),
          });

          if (response.ok) {
            return { text: extractGeminiText(await response.json()) };
          }

          const errorText = await response.text().catch(() => "");
          if ((response.status === 404 || response.status === 503) && modelsToTry.indexOf(modelName) < modelsToTry.length - 1) {
            if (response.status === 503) {
              sawBusyError = true;
              lastBusyError = errorText;
            } else {
              lastUnavailableError = errorText;
            }
            if (isDev) {
              console.warn(`[DIAGNOSTICS] Gemini model ${modelName} is unavailable or busy. Retrying with next Gemini model...`);
            }
            continue;
          }

          if (isGeminiKeyError(response.status, errorText)) {
            throw new Error(`API_KEY_INVALID: ${errorText}`);
          }
          if (response.status === 400) {
            throw new Error(`GEMINI_BAD_REQUEST: ${errorText}`);
          }
          if (response.status === 429) {
            throw new Error(`API_LIMIT_EXCEEDED: ${errorText}`);
          }
          if (response.status === 503) {
            throw new Error(`GEMINI_BUSY: ${errorText || lastBusyError}`);
          }
          if (response.status === 404) {
            throw new Error(`GEMINI_MODEL_UNAVAILABLE: ${errorText || lastBusyError}`);
          }
          throw new Error(`GEMINI_API_ERROR_${response.status}: ${errorText}`);
        }

        if (sawBusyError) {
          throw new Error(`GEMINI_BUSY: ${lastBusyError}`);
        }
        throw new Error(`GEMINI_MODEL_UNAVAILABLE: ${lastUnavailableError}`);
      },
    },
  };
}

// Standard helper to resolve API timeouts on the server
const withTimeout = <T>(promise: Promise<T>, ms: number, errorType: string = "AI_TIMEOUT"): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(errorType)), ms)
    )
  ]);
};

// Response helper for standardized error output
function sendError(res: express.Response, status: number, code: string, message: string, retryable: boolean = true, extra: any = {}) {
  return res.status(status).json({
    success: false,
    code,
    message,
    retryable,
    ...extra
  });
}

// Clean up Korean text particles and endings for similarity checks
function cleanKoreanTextForComparison(text: string): string[] {
  if (!text) return [];
  const clean = text.replace(/[^가-힣0-9a-zA-Z]/g, " ");
  const words = clean.split(/\s+/).filter(w => w.length > 1);
  return words.map(w => {
    // Strip common structural Korean ending particles / connective endings to isolate semantic stem
    return w.replace(/(은|는|이|가|을|를|에|의|로|으로|고|며|하며|한다|합니다|습니다|해요|다|요)$/, "");
  }).filter(w => w.length > 1);
}

// Check if two sections or sentences are repeated or highly similar
function detectDuplicateReadingSections(parsed: any): { hasDuplicates: boolean; duplicateFields: string[] } {
  if (!parsed || typeof parsed !== "object") {
    return { hasDuplicates: false, duplicateFields: [] };
  }

  // Focus on keys with full substantial paragraphs or sentences
  const keys = Object.keys(parsed).filter(k => 
    typeof parsed[k] === "string" && 
    k !== "contactRecommendation" && 
    k !== "oneLineConclusion" && 
    k !== "conclusion" &&
    k !== "totalFlow" &&
    !/^card[123]Meaning$/.test(k) &&
    parsed[k].trim().length > 10
  );

  const duplicateFields = new Set<string>();

  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const fieldA = keys[i];
      const fieldB = keys[j];
      const textA = parsed[fieldA].trim();
      const textB = parsed[fieldB].trim();

      // 1. Exact match
      if (textA === textB) {
        duplicateFields.add(fieldA);
        duplicateFields.add(fieldB);
        continue;
      }

      // 2. High word-overlap similarity check (Jaccard similarity style)
      const wordsA = cleanKoreanTextForComparison(textA);
      const wordsB = cleanKoreanTextForComparison(textB);
      if (wordsA.length === 0 || wordsB.length === 0) continue;

      const setA = new Set(wordsA);
      const setB = new Set(wordsB);
      let intersection = 0;
      for (const w of setA) {
        if (setB.has(w)) intersection++;
      }

      const similarityA = intersection / setA.size;
      const similarityB = intersection / setB.size;

      // If more than 40% of normalized stems overlap and intersection has substantial content items
      if ((similarityA > 0.40 || similarityB > 0.40) && intersection >= 3) {
        duplicateFields.add(fieldA);
        duplicateFields.add(fieldB);
        continue;
      }

      // 3. Sentence level near-exact duplicates
      const sentencesA = textA.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 12);
      const sentencesB = textB.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 12);

      for (const sa of sentencesA) {
        const normSa = sa.replace(/[^가-힣0-9a-zA-Z]/g, "");
        for (const sb of sentencesB) {
          const normSb = sb.replace(/[^가-힣0-9a-zA-Z]/g, "");
          if (normSa === normSb || (normSa.length > 15 && (normSa.includes(normSb) || normSb.includes(normSa)))) {
            duplicateFields.add(fieldA);
            duplicateFields.add(fieldB);
            break;
          }
        }
      }
    }
  }

  return {
    hasDuplicates: duplicateFields.size > 0,
    duplicateFields: Array.from(duplicateFields)
  };
}

// Helper to sanitize, normalize and correct minor format differences in Gemini structured responses
function replaceHanjaInKoreanText(text: string): string {
  const hanjaMap: Record<string, string> = {
    慎: "신",
    愼: "신",
    感: "감",
    情: "정",
    心: "심",
    內: "내",
    内: "내",
    外: "외",
    中: "중",
    無: "무",
    有: "유",
    相: "상",
    對: "대",
    人: "인",
    自: "자",
    尊: "존",
    強: "강",
    弱: "약",
    現: "현",
    在: "재",
    未: "미",
    來: "래",
    過: "과",
    去: "거",
    關: "관",
    係: "계",
    距: "거",
    離: "리",
    安: "안",
    全: "전",
  };

  return text.replace(/[一-龥]/g, (char) => hanjaMap[char] ?? "");
}

function softenReportTone(text: string): string {
  let softened = text
    .replace(/시사합니다/g, "보여요")
    .replace(/시사해요/g, "보여요")
    .replace(/시사하고 있어요/g, "보여 주고 있어요")
    .replace(/시사하는/g, "보여 주는")
    .replace(/시사하며/g, "보여 주며")
    .replace(/암시합니다/g, "살짝 보여요")
    .replace(/암시해요/g, "살짝 보여요")
    .replace(/암시하는/g, "살짝 보여 주는")
    .replace(/나타냅니다/g, "보여요")
    .replace(/나타내요/g, "보여요")
    .replace(/의미합니다/g, "말해 줘요")
    .replace(/의미해요/g, "말해 줘요")
    .replace(/분석됩니다/g, "읽혀요")
    .replace(/분석돼요/g, "읽혀요");

  const replacements = [
    "드러나요",
    "읽혀요",
    "느껴져요",
    "먼저 올라와요",
    "흐름이 강해요",
    "걸려 있어요",
    "눈에 들어와요"
  ];
  softened = softened
    .replace(/손득 계산/g, "이득을 따지는 마음")
    .replace(/손익 계산/g, "이득을 따지는 마음")
    .replace(/득실 계산/g, "이득을 따지는 마음")
    .replace(/상황 계산/g, "상황을 먼저 재는 태도")
    .replace(/계산적인/g, "조심스럽게 따져 보는")
    .replace(/계산적/g, "조심스러운")
    .replace(/손득/g, "이득")
    .replace(/손익/g, "이득")
    .replace(/득실/g, "이득")
    .replace(/식었다기보다/g, "온도가 꺼진 건 아니고")
    .replace(/식은 건 아니고/g, "온도가 꺼진 건 아니고")
    .replace(/식은 게 아니라/g, "온도가 꺼진 게 아니라")
    .replace(/차가운 상태가 아니라/g, "굳어 있는 상태라기보다")
    .replace(/차갑다기보다/g, "굳어 있다기보다")
    .replace(/차갑다는 말보다/g, "조심스럽다는 말이 더 맞고")
    .replace(/차가운/g, "조심스러운")
    .replace(/차갑게/g, "조심스럽게")
    .replace(/에 가까워요/g, "처럼 보여요")
    .replace(/에 가깝습니다/g, "처럼 보여요")
    .replace(/쪽에 가까워요/g, "쪽으로 보여요")
    .replace(/쪽에 가깝습니다/g, "쪽으로 보여요")
    .replace(/쪽에 가까운/g, "쪽으로 기운")
    .replace(/에 가까운/g, "처럼 읽히는")
    .replace(/가까워서/g, "편이라")
    .replace(/부담을 먼저 계산하는/g, "부담을 먼저 따져 보는")
    .replace(/상황 계산이 앞서는/g, "상황을 먼저 재는")
    .replace(/계산이 앞서는/g, "조심스러움이 앞서는")
    .replace(/관망하는 중/g, "먼저 움직이기보다 반응을 보는 중")
    .replace(/관망하고 있는/g, "먼저 움직이기보다 상황을 살피는")
    .replace(/관망하고 있어요/g, "먼저 움직이기보다 반응을 보고 있어요")
    .replace(/관망하고 있습니다/g, "먼저 움직이기보다 반응을 보고 있어요")
    .replace(/관망하려는/g, "상황을 조금 더 살피려는")
    .replace(/관망/g, "상황을 살피는 태도");
  let repeatedVerbIndex = 0;
  softened = softened.replace(/잡아내요|잡아냅니다|짚어내요|짚어냅니다/g, () => {
    const replacement = replacements[repeatedVerbIndex % replacements.length];
    repeatedVerbIndex += 1;
    return replacement;
  });

  softened = softened
    .replace(/당신의/g, "질문자님의")
    .replace(/당신이/g, "질문자님이")
    .replace(/당신은/g, "질문자님은")
    .replace(/당신을/g, "질문자님을")
    .replace(/당신에게/g, "질문자님에게")
    .replace(/당신께/g, "질문자님께")
    .replace(/당신과/g, "질문자님과")
    .replace(/당신도/g, "질문자님도")
    .replace(/당신/g, "질문자님")
    .replace(/내담자님의/g, "질문자님의")
    .replace(/내담자님이/g, "질문자님이")
    .replace(/내담자님은/g, "질문자님은")
    .replace(/내담자님을/g, "질문자님을")
    .replace(/내담자님에게/g, "질문자님에게")
    .replace(/내담자님과/g, "질문자님과")
    .replace(/내담자님/g, "질문자님")
    .replace(/내담자의/g, "질문자님의")
    .replace(/내담자가/g, "질문자님이")
    .replace(/내담자는/g, "질문자님은")
    .replace(/내담자를/g, "질문자님을")
    .replace(/내담자에게/g, "질문자님에게")
    .replace(/내담자와/g, "질문자님과")
    .replace(/내담자/g, "질문자님")
    .replace(/사용자님의/g, "질문자님의")
    .replace(/사용자님이/g, "질문자님이")
    .replace(/사용자님은/g, "질문자님은")
    .replace(/사용자님을/g, "질문자님을")
    .replace(/사용자님에게/g, "질문자님에게")
    .replace(/사용자님과/g, "질문자님과")
    .replace(/사용자님/g, "질문자님")
    .replace(/사용자의/g, "질문자님의")
    .replace(/사용자가/g, "질문자님이")
    .replace(/사용자는/g, "질문자님은")
    .replace(/사용자를/g, "질문자님을")
    .replace(/사용자에게/g, "질문자님에게")
    .replace(/사용자와/g, "질문자님과")
    .replace(/사용자도/g, "질문자님도")
    .replace(/사용자/g, "질문자님")
    .replace(/질문자의/g, "질문자님의")
    .replace(/질문자가/g, "질문자님이")
    .replace(/질문자는/g, "질문자님은")
    .replace(/질문자를/g, "질문자님을")
    .replace(/질문자에게/g, "질문자님에게")
    .replace(/질문자께/g, "질문자님께")
    .replace(/질문자와/g, "질문자님과")
    .replace(/질문자도/g, "질문자님도");

  softened = softened
    .replace(/\b사용자\b/g, "질문자님")
    .replace(/\b내담자\b/g, "질문자님")
    .replace(/\b질문자\b/g, "질문자님");

  return replaceHanjaInKoreanText(softened);
}

function recursivelySoftenReportTone(value: any): any {
  if (typeof value === "string") {
    return softenReportTone(value);
  }
  if (Array.isArray(value)) {
    return value.map(item => recursivelySoftenReportTone(item));
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      value[key] = recursivelySoftenReportTone(value[key]);
    }
  }
  return value;
}

function normalizeTarotResult(menuId: string, parsed: any, isDeep: boolean): any {
  if (!parsed || typeof parsed !== "object") {
    return parsed;
  }

  parsed = recursivelySoftenReportTone(parsed);

  // 1. Trim leading and trailing whitespace from all string fields
  for (const key of Object.keys(parsed)) {
    if (typeof parsed[key] === "string") {
      parsed[key] = parsed[key]
        .replace(/[;；]+/g, ". ")
        .replace(/\.\s*\./g, ".")
        .trim();
    }
  }

  if (isDeep) {
    // In deep reading, no adjacent-field copying!
    return parsed;
  }

  // Standard (free) reading formatting fixes:
  // Temperature type sanitization and clamping (Do not fallback to 45!)
  if (parsed.temperature !== undefined && parsed.temperature !== null) {
    let tVal = parsed.temperature;
    if (typeof tVal === "string") {
      const parsedNum = parseInt(tVal, 10);
      tVal = isNaN(parsedNum) ? NaN : parsedNum;
    }
    if (typeof tVal === "number" && !isNaN(tVal)) {
      tVal = Math.floor(tVal);
      if (tVal < 0) tVal = 0;
      if (tVal > 100) tVal = 100;
      parsed.temperature = tVal;
    } else {
      parsed.temperature = undefined;
    }
  } else if (menuId === 'relation-temp') {
    parsed.temperature = undefined;
  }

  // followUpQuestions size limits and empty checks
  if (parsed.followUpQuestions !== undefined && parsed.followUpQuestions !== null) {
    if (Array.isArray(parsed.followUpQuestions)) {
      let filtered = parsed.followUpQuestions
        .filter((item: any) => typeof item === "string" && item.trim().length > 0)
        .map((item: string) => item.trim());
      
      if (filtered.length > 3) {
        filtered = filtered.slice(0, 3);
      }
      parsed.followUpQuestions = filtered;
    } else if (typeof parsed.followUpQuestions === "string") {
      const singleItem = parsed.followUpQuestions.trim();
      parsed.followUpQuestions = singleItem ? [singleItem] : [];
    } else {
      parsed.followUpQuestions = [];
    }
  } else {
    parsed.followUpQuestions = [];
  }

  // Gemini may return a valid reading with slightly different field names or shorter
  // sections. Do not discard a paid API response just because aliases/lengths differ.
  parsed.oneLineConclusion = parsed.oneLineConclusion || parsed.conclusion || parsed.answer || parsed.summary || "";
  parsed.conclusion = parsed.conclusion || parsed.oneLineConclusion;
  parsed.combinedFlow = parsed.combinedFlow || parsed.totalFlow || parsed.flow || parsed.conclusion || parsed.oneLineConclusion;
  parsed.totalFlow = parsed.totalFlow || parsed.combinedFlow;
  parsed.caution = parsed.caution || parsed.warning || parsed.notice || "지금은 감정만 보고 바로 움직이기보다, 상대의 반응과 상황을 함께 보면서 천천히 확인하는 게 좋아요.";
  parsed.actionAdvice = parsed.actionAdvice || parsed.advice || parsed.recommendedApproach || "질문자님이 먼저 움직인다면 무겁게 확인하려 하기보다, 부담 없는 말로 분위기를 여는 쪽이 좋아요.";

  if (Array.isArray(parsed.cards)) {
    parsed.cards = parsed.cards.slice(0, 3).map((card: any, index: number) => {
      const fallbackMeaning =
        card?.contextualMeaning ||
        card?.meaning ||
        card?.interpretation ||
        card?.coreMeaning ||
        [parsed.card1Meaning, parsed.card2Meaning, parsed.card3Meaning][index] ||
        parsed.oneLineConclusion ||
        "지금 흐름에서는 마음의 속도와 실제 행동의 속도가 완전히 같지 않아요. 겉으로 보이는 반응만 보고 단정하기보다, 반복되는 태도와 말의 온도를 함께 보는 게 좋아요.";

      return {
        ...card,
        role: card?.role || `${index + 1}번째 흐름`,
        cardName: card?.cardName || card?.name || card?.nameKr || `${index + 1}번째 카드`,
        orientation: card?.orientation || card?.direction || "정방향",
        coreMeaning: card?.coreMeaning || fallbackMeaning,
        contextualMeaning: fallbackMeaning,
      };
    });
  }

  if (Array.isArray(parsed.cards) && parsed.cards.length === 3) {
    parsed.card1Meaning = parsed.card1Meaning || parsed.cards[0].contextualMeaning;
    parsed.card2Meaning = parsed.card2Meaning || parsed.cards[1].contextualMeaning;
    parsed.card3Meaning = parsed.card3Meaning || parsed.cards[2].contextualMeaning;
  }

  if (!Array.isArray(parsed.followUpQuestions) || parsed.followUpQuestions.length === 0) {
    parsed.followUpQuestions = [
      "그 사람의 진짜 속마음을 더 보면 어떨까요?",
      "앞으로 이 관계가 어떻게 흘러갈까요?",
      "지금 질문자님이 먼저 움직여도 괜찮을까요?",
    ];
  }

  // Set default contactRecommendation only if it is empty/invalid
  if (menuId === 'can-contact') {
    if (!parsed.contactRecommendation || typeof parsed.contactRecommendation !== "string" || parsed.contactRecommendation.trim() === "") {
      parsed.contactRecommendation = "짧고 가볍게 연락하는 정도가 좋아요";
    }
  }

  return parsed;
}

// Menu-specific field validations
function validateTarotResult(menuId: string, parsed: any, isDeep: boolean): { isValid: boolean; missingField?: string; reason?: string } {
  if (!parsed || typeof parsed !== "object") {
    return { isValid: false, missingField: "root", reason: "응답이 올바른 JSON 객체가 아닙니다." };
  }

  // If this is a deep premium reading, validate specific premium fields only
  if (isDeep) {
    const premiumFields = ["premiumConclusion", "partnerEmotionSituation", "actionPossibility", "relationshipBarrier", "expectedResponse", "detailedAdvice"];
    for (const field of premiumFields) {
      if (!parsed[field] || typeof parsed[field] !== "string" || parsed[field].trim().length === 0) {
        return { isValid: false, missingField: field, reason: `프리미엄 필드 ${field}가 없거나 비어 있습니다.` };
      }
    }
    return { isValid: true };
  }

  // Check overall fields for standard reading
  const coreFields = ["oneLineConclusion", "combinedFlow", "caution", "actionAdvice", "cards"];
  for (const field of coreFields) {
    if (parsed[field] === undefined || parsed[field] === null) {
      return { isValid: false, missingField: field, reason: `${field} 필드가 누락되었습니다.` };
    }
  }

  // Check cards list
  if (!Array.isArray(parsed.cards) || parsed.cards.length !== 3) {
    return { isValid: false, missingField: "cards", reason: "배열 카드 세 장에 대한 정보가 누락되었습니다." };
  }

  const minCoreLen = 2; // Keep validation useful, but don't reject valid API output for style length.
  const minContextLen = 8;
  const minFlowLen = 8;
  const minCautionLen = 8;
  const minAdviceLen = 8;

  // Validate overall field lengths
  if (parsed.combinedFlow.trim().length < minFlowLen) {
    return { isValid: false, missingField: "combinedFlow", reason: `세 장의 연결 흐름 분량이 부족합니다 (현재: ${parsed.combinedFlow.trim().length}자 < 기준: ${minFlowLen}자).` };
  }
  if (parsed.caution.trim().length < minCautionLen) {
    return { isValid: false, missingField: "caution", reason: `주의할 점 분량이 부족합니다 (현재: ${parsed.caution.trim().length}자 < 기준: ${minCautionLen}자).` };
  }
  if (parsed.actionAdvice.trim().length < minAdviceLen) {
    return { isValid: false, missingField: "actionAdvice", reason: `조언 분량이 부족합니다 (현재: ${parsed.actionAdvice.trim().length}자 < 기준: ${minAdviceLen}자).` };
  }

  // Validate each card's parsed structure
  for (let i = 0; i < 3; i++) {
    const card = parsed.cards[i];
    if (!card || typeof card !== "object") {
      return { isValid: false, missingField: `cards[${i}]`, reason: `${i+1}번째 카드 정보가 비어 있습니다.` };
    }
    if (!card.role || !card.cardName || !card.orientation || !card.coreMeaning || !card.contextualMeaning) {
      return { isValid: false, missingField: `cards[${i}].fields`, reason: `${i+1}번째 카드의 필수 설명 필드가 비어 있습니다.` };
    }
    if (card.coreMeaning.trim().length < minCoreLen) {
      return { isValid: false, missingField: `cards[${i}].coreMeaning`, reason: `${i+1}번째 카드의 핵심 의미 분량이 부족합니다 (현재: ${card.coreMeaning.trim().length}자 < 기준: ${minCoreLen}자).` };
    }
    if (card.contextualMeaning.trim().length < minContextLen) {
      return { isValid: false, missingField: `cards[${i}].contextualMeaning`, reason: `${i+1}번째 카드의 상황별 해석 분량이 부족합니다 (현재: ${card.contextualMeaning.trim().length}자 < 기준: ${minContextLen}자).` };
    }
  }

  // If relation-temp, temperature is required
  if (menuId === 'relation-temp') {
    const tempVal = Number(parsed.temperature);
    if (isNaN(tempVal) || tempVal < 0 || tempVal > 100) {
      return { isValid: false, missingField: "temperature", reason: "온도 수치(temperature)가 누락되거나 유효하지 않습니다." };
    }
  }

  // Check follow up questions array is accurate if present
  if (parsed.followUpQuestions !== undefined && parsed.followUpQuestions !== null) {
    if (!Array.isArray(parsed.followUpQuestions)) {
      return { isValid: false, missingField: "followUpQuestions", reason: "followUpQuestions 필드는 배열 구조여야 합니다." };
    }
    for (const item of parsed.followUpQuestions) {
      if (typeof item !== "string" || item.trim().length === 0) {
        return { isValid: false, missingField: "followUpQuestions.item", reason: "후속 질문 항목은 비어 있지 않은 문자열이어야 합니다." };
      }
    }
  }

  return { isValid: true };
}

const localReadingLens: Record<string, { focus: string; question: string; advice: string }> = {
  "dating-luck": {
    focus: "오늘 들어오는 인연의 기운과 내가 사람을 받아들이는 방식",
    question: "오늘의 설렘을 억지로 만들지 않아도 누군가와 편안히 연결될 여지가 있는지",
    advice: "약속이나 대화가 생기면 잘 보이려 애쓰기보다 평소의 리듬을 유지해 보세요",
  },
  "inner-mind": {
    focus: "겉으로 보이는 태도와 실제 감정 사이의 간격",
    question: "그 사람이 질문자님을 어떤 마음으로 보고 있는지",
    advice: "상대의 한마디보다 반복해서 나타나는 행동을 기준으로 마음을 판단해 보세요",
  },
  "can-contact": {
    focus: "지금 연락했을 때 열릴 대화의 온도",
    question: "오늘 먼저 다가가면 대화가 어떻게 이어질지",
    advice: "연락한다면 관계를 확인하려는 질문보다 답하기 쉬운 일상 이야기로 문을 열어 보세요",
  },
  "relation-temp": {
    focus: "두 사람이 느끼는 친밀감과 현실적인 거리",
    question: "지금 이 관계가 어느 지점에 있고 무엇이 온도를 올리거나 낮추는지",
    advice: "좋았던 순간만 붙잡기보다 현재 서로가 실제로 들이는 시간과 노력을 살펴보세요",
  },
  "relation-flow": {
    focus: "이번 주 초반부터 후반까지 달라지는 관계의 리듬",
    question: "관계가 움직이는 시점과 그때 내가 놓치지 말아야 할 신호가 무엇인지",
    advice: "주 초반의 분위기로 한 주 전체를 단정하지 말고 중반 이후의 변화를 지켜보세요",
  },
};

function localCardTheme(card: any) {
  const name = card.nameKr || card.name || "이 카드";
  const keyword = card.isReversed
    ? card.reversedMeaningKr || card.keywordKr || "마음은 있지만 표현이 막혀 있는 상태"
    : card.keywordKr || "감정과 행동이 같은 방향으로 움직이는 상태";
  const suitCopy: Record<string, string> = {
    cups: "감정은 있지만 마음을 주고받는 방식이 중요해요",
    swords: "마음보다 생각과 걱정이 앞서는 모습이에요",
    wands: "끌림은 있지만 속도 조절이 필요해요",
    pentacles: "말보다 시간과 행동을 봐야 해요",
  };
  const base = card.type === "major"
    ? "관계를 바라보는 태도가 바뀌는 장면이에요"
    : suitCopy[card.suit] || "반복되는 행동에서 진짜 마음이 드러나요";
  const direction = card.isReversed
    ? "표현보다 망설임이 먼저 올라올 수 있어요"
    : "지금 보이는 흐름 안에서는 작은 신호를 믿어 봐도 괜찮아요";
  return { name, keyword, base, direction };
}

function withKoreanParticle(text: string, batchimParticle: string, noBatchimParticle: string) {
  const last = text.trim().slice(-1);
  const code = last.charCodeAt(0);
  const digitBatchim: Record<string, boolean> = { "0": true, "1": true, "2": false, "3": true, "4": false, "5": false, "6": true, "7": true, "8": true, "9": false };
  const hasBatchim = last in digitBatchim
    ? digitBatchim[last]
    : code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
  return `${text}${hasBatchim ? batchimParticle : noBatchimParticle}`;
}

function inferQuestionCategoryFromText(question: string, fallback = "일반 흐름") {
  const q = (question || "").replace(/\s+/g, " ").toLowerCase();
  if (/(남들|다른\s*사람|사람들|주변|회사\s*사람|동료).*(생각|볼까|볼까요|불쌍|무시|평가|시선|눈치|쪽팔|창피|한심)|((불쌍|무시|평가|시선|눈치|쪽팔|창피|한심).*(생각|볼까|볼까요|남들|사람들|주변))/.test(q)) return "평판/시선";
  if (/(그만둔다|그만\s*둘|그만\s*둔다|퇴사|그만둘|관둔다|관둘|사직|그만두겠다고|그만둔다고|뭐라고\s*말|어떻게\s*말|말해야|말할까)/.test(q)) return "퇴사 전달";
  if (/(재회|다시\s*만|헤어진|돌아올|전남친|전여친)/.test(q)) return "재회";
  if (/(연락|답장|카톡|문자|전화|읽씹)/.test(q)) return "연락";
  if (/(속마음|어떻게\s*생각|진심|나를\s*생각|마음일|좋아하|호감|관심\s*있|날\s*어떻게|나를\s*어떻게)/.test(q)) return "속마음";
  if (/(새로운\s*인연|새\s*인연|솔로|소개팅|연애운)/.test(q)) return "새로운 인연";
  if (/(이직|퇴사|직장|회사|취업|면접|승진)/.test(q)) return "직장/이직";
  if (/(금전|돈|재물|투자|수입|지출|매출)/.test(q)) return "금전";
  if (/(시험|합격|진로|공부|학교|전공|자격증)/.test(q)) return "시험/진로";
  if (/(선택|결정|해도\s*괜찮|할까|말까|어느\s*쪽)/.test(q)) return "선택 고민";
  if (/(친구|동료|가족|인간관계|사람들과|갈등)/.test(q)) return "인간관계";
  if (/(그\s*사람|관계|사랑|연애|썸|남자친구|여자친구)/.test(q)) return "연애";
  return fallback || "일반 흐름";
}

const QUESTION_INTENT_CATEGORIES = [
  "연애",
  "속마음",
  "연락",
  "재회",
  "새로운 인연",
  "인간관계",
  "평판/시선",
  "직장/이직",
  "퇴사 전달",
  "금전",
  "시험/진로",
  "선택 고민",
  "일반 흐름",
] as const;

function extractJsonObject(text: string) {
  const normalizeJsonCandidate = (value: string) => value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/,\s*([}\]])/g, "$1");

  const trimmed = normalizeJsonCandidate(text || "");
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(normalizeJsonCandidate(match[0]));
    } catch {
      return null;
    }
  }
}

function extractTemperatureReadingText(text: string) {
  const raw = String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (!raw) return null;

  const temperatureMatch = raw.match(/(\d{2}(?:\.\d)?)\s*(?:도|°|℃|C|c)/);
  const temperature = temperatureMatch?.[1] || "37.0";
  const normalized = raw
    .replace(/\r/g, "")
    .replace(/[{}\[\]"]/g, "")
    .replace(/oneLineConclusion\s*:/gi, "")
    .replace(/card1Meaning\s*:/gi, "")
    .replace(/temperature\s*:\s*\d{2}(?:\.\d)?/gi, "")
    .replace(/\\n/g, "\n")
    .replace(/(예요\.|이에요\.|어요\.|아요\.|죠\.|네요\.|니다\.|다\.)\s*/g, "$1\n")
    .split(/\n+/)
    .map(line => line.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);

  const conclusion =
    normalized.find(line => /온도/.test(line) && /\d{2}(?:\.\d)?/.test(line)) ||
    `오늘 우리 사이 온도는 ${temperature}도예요. 오늘은 서로의 반응을 천천히 살피는 흐름이에요.`;

  const meaningLines = normalized
    .filter(line => line !== conclusion)
    .filter(line => !/^짧은 결론$|^7줄 해석$/.test(line))
    .slice(0, 7);

  if (meaningLines.length === 0) {
    meaningLines.push(conclusion);
  }

  return {
    oneLineConclusion: conclusion,
    temperature,
    card1Meaning: meaningLines.join("\n")
  };
}

function isInstructionEchoLine(line: string) {
  return /식었다기보다|차갑|관망|손익|손득|득실|A는 B보다|~에 가까워|used\?|yes|no|correct|format|oneLineConclusion|card1Meaning|temperature|금지|출력 규칙|필드|JSON|`|\?/i.test(line);
}

function isIncompleteReadingLine(line: string) {
  const trimmed = line.trim();
  return trimmed.length < 14 || !/(예요\.|이에요\.|어요\.|아요\.|죠\.|네요\.|니다\.|습니다\.|다\.)$/.test(trimmed);
}

function buildSafeDailyTemperatureLines(temperature: number, cardName: string, cardKeyword: string) {
  const tempText = Number.isFinite(temperature) ? temperature.toFixed(1) : "37.0";
  const high = temperature >= 38.2;
  const warm = temperature >= 37.0;
  const safeCardName = cardName && !cardName.includes("?") ? cardName : "오늘 흐름";
  const keywordMood = cardKeyword ? `${cardKeyword} 같은 분위기` : "작은 신호";

  if (high) {
    return [
      `오늘 우리 사이 온도는 ${tempText}도예요.`,
      "서로를 의식하는 힘이 꽤 선명하게 올라와 있어요.",
      "그 사람도 질문자님 쪽 분위기를 그냥 흘려보내지는 않는 흐름이에요.",
      "다만 감정이 바로 말로 나오기보다, 타이밍을 보며 살피는 모습이 있어요.",
      `${safeCardName}의 흐름처럼 ${keywordMood}가 관계의 온도를 더 올리는 열쇠가 돼요.`,
      "오늘은 무겁게 확인하기보다 자연스럽게 말을 열 때 반응이 더 부드러워져요.",
      "질문자님이 편안하게 다가가면 분위기가 생각보다 빠르게 살아날 수 있어요."
    ];
  }

  if (warm) {
    return [
      `오늘 우리 사이 온도는 ${tempText}도예요.`,
      "호감의 온기는 남아 있고, 서로를 신경 쓰는 흐름도 보여요.",
      "다만 지금은 마음을 크게 드러내기보다 반응을 살피는 쪽에 힘이 들어가 있어요.",
      "그 사람은 질문자님을 가볍게 넘기기보다, 자기 페이스 안에서 천천히 보고 있어요.",
      `${safeCardName}의 흐름처럼 ${keywordMood}가 오늘 분위기의 중심에 있어요.`,
      "말을 건다면 길게 설명하기보다 짧고 편한 한마디가 더 잘 닿아요.",
      "오늘은 확답을 끌어내기보다 온도를 부드럽게 유지하는 쪽이 좋아요."
    ];
  }

  return [
    `오늘 우리 사이 온도는 ${tempText}도예요.`,
    "오늘은 감정이 크게 튀어나오기보다 서로의 눈치를 살피는 분위기예요.",
    "그 사람 마음이 아예 닫힌 흐름은 아니지만, 지금은 자기 생각이 앞에 와 있어요.",
    "그래서 반응이 느리거나 담백하게 느껴질 수 있어요.",
    `${safeCardName}의 흐름처럼 ${keywordMood}가 오늘 관계의 리듬을 만들고 있어요.`,
    "질문자님이 먼저 분위기를 편하게 열어 주면 경계가 조금 풀릴 수 있어요.",
    "오늘은 큰 확인보다 가볍고 자연스러운 접점 하나가 더 좋습니다."
  ];
}

function buildSafeDailyTemperatureExtras(temperature: number, cardName: string) {
  const high = temperature >= 38.2;
  const warm = temperature >= 37.0;
  const safeCardName = cardName && !cardName.includes("?") ? cardName : "오늘의 카드";

  if (high) {
    return {
      behavior: [
        "그 사람은 오늘 질문자님을 은근히 의식하는 모습이 보여요.",
        "말을 먼저 크게 꺼내지 않아도, 반응 안에는 호기심이 섞여 있을 수 있어요.",
        "편한 분위기가 만들어지면 평소보다 조금 더 다정하게 풀릴 가능성이 있어요.",
        "질문자님이 자연스럽게 웃어 주거나 말을 받아 주면 상대도 한 걸음 더 열릴 수 있어요."
      ],
      caution: [
        "좋은 흐름일수록 바로 확답을 확인하려고 하면 상대가 부담을 느낄 수 있어요.",
        "괜히 떠보는 말보다 편하게 웃을 수 있는 말이 훨씬 잘 들어가요.",
        "질문자님이 여유를 보여 주면 오늘의 온기가 더 오래 유지돼요."
      ],
      advice: [
        "오늘은 가벼운 안부나 자연스러운 리액션으로 시작해 보세요.",
        "상대가 반응할 틈을 남겨 두면 대화가 더 부드럽게 이어질 수 있어요.",
        `${safeCardName}의 흐름처럼 먼저 분위기를 편하게 열어 주는 쪽이 좋아요.`
      ]
    };
  }

  if (warm) {
    return {
      behavior: [
        "그 사람은 오늘 마음을 완전히 숨기기보다 상황을 보면서 반응하려는 쪽이에요.",
        "답이 조금 늦거나 담백해도 관심이 없는 모습으로 바로 보기는 어려워요.",
        "편한 말투로 다가오면 질문자님 쪽으로 조금씩 온도가 살아날 수 있어요.",
        "다만 먼저 확 티를 내기보다는 질문자님 반응을 보며 속도를 맞추려는 느낌이 있어요."
      ],
      caution: [
        "오늘은 상대 반응 하나만 보고 결론을 크게 내리지 않는 게 좋아요.",
        "확인받고 싶은 마음이 앞서면 대화가 살짝 무거워질 수 있어요.",
        "질문자님 페이스를 지키면서 자연스럽게 이어가는 쪽이 안전해요."
      ],
      advice: [
        "짧고 편한 말로 접점을 만들어 보세요.",
        "깊은 얘기보다 오늘은 분위기를 부드럽게 만드는 게 먼저예요.",
        "반응이 오면 바로 의미를 따지기보다 한두 번 더 편하게 주고받아 보세요."
      ]
    };
  }

  return {
    behavior: [
      "그 사람은 오늘 마음보다 자기 상황이나 생각에 더 묶여 있는 모습이에요.",
      "그래서 질문자님이 보기엔 반응이 무심하거나 느리게 느껴질 수 있어요.",
      "그래도 완전히 끊는 흐름이라기보다는 거리를 두고 살피는 쪽이에요.",
      "질문자님이 급하게 확인하려 하기보다 편한 분위기를 먼저 만들면 반응이 조금 부드러워질 수 있어요."
    ],
    caution: [
      "오늘은 답을 빨리 확인하려고 하면 질문자님 마음이 먼저 지칠 수 있어요.",
      "서운함을 바로 꺼내면 상대가 더 조심스럽게 물러날 수 있어요.",
      "작은 반응에도 의미를 너무 크게 붙이지 않는 게 좋아요."
    ],
    advice: [
      "오늘은 한 박자 천천히 가는 게 더 좋아요.",
      "말을 건다면 짧고 담백하게, 상대가 부담 없이 답할 수 있게 열어 주세요.",
      `${safeCardName}의 흐름처럼 질문자님이 먼저 중심을 잡으면 분위기가 덜 흔들려요.`
    ]
  };
}

function buildDailyTemperatureSectionText(value: unknown, fallbackLines: string[], maxLines = 3) {
  const source = String(value || "")
    .replace(/\r/g, "")
    .replace(/\\n/g, "\n")
    .replace(/(요\.|예요\.|어요\.|죠\.|니다\.|습니다\.|다\.)\s+/g, "$1\n")
    .split(/\n+/)
    .map((line: string) => line.replace(/^Line\s*\d+\s*:\s*/i, "").trim())
    .filter(Boolean)
    .filter((line: string) => !isInstructionEchoLine(line))
    .map((line: string) => softenReportTone(line));

  return Array.from(new Set([...source, ...fallbackLines])).slice(0, maxLines).join("\n");
}

async function classifyQuestionIntentWithGemini(question: string, fallback: string) {
  const localCategory = inferQuestionCategoryFromText(question, fallback);
  if (!GEMINI_ENABLE_INTENT_CLASSIFIER || isKeyInvalid || !question?.trim()) {
    if (isDev && !GEMINI_ENABLE_INTENT_CLASSIFIER) {
      console.log(`[DIAGNOSTICS] Local intent category: ${localCategory}`);
    }
    return localCategory;
  }

  const ai = getGeminiClient();
  if (!ai) {
    return localCategory;
  }

  try {
    const prompt = `
질문자님의 타로 질문을 보고, 단어 하나가 아니라 질문의 "진짜 의도"를 분류해 주세요.
출력은 설명 없이 아래 분류명 중 하나만 한 줄로 쓰세요.

가능한 분류:
${QUESTION_INTENT_CATEGORIES.map(category => `- ${category}`).join("\n")}

판단 규칙:
- 질문 안에 "돈", "수입" 같은 단어가 있어도 핵심이 "남들이 나를 어떻게 볼까", "불쌍하게 생각할까", "무시할까"라면 반드시 "평판/시선"으로 분류합니다.
- 예: "제가 그만두면 다른 사람들은 저를 불쌍하다고 생각할까요? 할것도 없고 어디가서 돈도 못번다고 생각할까요" => 평판/시선
- "그만둔다고 뭐라고 말할까", "퇴사 말을 어떻게 꺼낼까"처럼 말하는 방법을 묻는 질문은 "퇴사 전달"입니다.
- "퇴사해도 될까", "이직해도 될까"처럼 결정 자체를 묻는 질문은 "직장/이직" 또는 "선택 고민"입니다.
- "그 사람은 나를 어떻게 생각할까"처럼 특정 상대의 마음을 묻는 질문은 "속마음"입니다.
- 연애 질문이 아니면 연애/상대방/연락 카테고리로 억지 분류하지 마세요.

질문:
"${question}"`;

    const response = await withTimeout(
      ai.models.generateContent({
        model: GEMINI_INTENT_MODEL,
        contents: prompt,
        config: {
          temperature: 0.05,
          maxOutputTokens: 64,
        },
      }),
      8000,
      "AI_INTENT_TIMEOUT"
    );

    const rawCategoryText = (response.text || "").trim();
    if (rawCategoryText === "평" || rawCategoryText.startsWith("평판")) {
      if (isDev) {
        console.log(`[DIAGNOSTICS] Gemini intent category: 평판/시선 | fallback: ${localCategory} | raw: ${rawCategoryText}`);
      }
      return "평판/시선";
    }

    const category = QUESTION_INTENT_CATEGORIES.find(categoryName => rawCategoryText.includes(categoryName)) || rawCategoryText;
    if ((QUESTION_INTENT_CATEGORIES as readonly string[]).includes(category)) {
      if (isDev) {
        console.log(`[DIAGNOSTICS] Gemini intent category: ${category} | fallback: ${localCategory} | raw: ${rawCategoryText}`);
      }
      return category;
    }

    if (isDev) {
      console.warn(`[DIAGNOSTICS] Gemini intent classification returned invalid category. Raw: ${rawCategoryText}`);
    }
  } catch (error: any) {
    if (isDev) {
      console.warn(`[DIAGNOSTICS] Gemini intent classification failed. Falling back to keyword category. Reason: ${error?.message || error}`);
    }
  }

  return localCategory;
}

function buildQuestionAnswerGuard(question: string, category: string) {
  const q = (question || "").trim();
  const normalized = q.replace(/\s+/g, " ").toLowerCase();
  const asksTiming = /(언제|시기|쯤|몇\s*월|몇\s*주|며칠|가까운\s*시기|들어올지)/.test(normalized);
  const answerExamples: Record<string, string> = {
    "속마음": "질문이 호감/속마음이라면 첫 문장은 카드 조합에 따라 '호감이 꽤 선명해요', '관심은 있는데 표현 방식이 서툴러요', '호기심이 호감으로 커지는 중이에요', '아직은 마음이 커지는 초입이에요'처럼 마음의 정도를 바로 답한다.",
    "연락": "질문이 연락 여부라면 첫 문장은 '먼저 연락해도 괜찮아요', '짧게 말을 열면 반응은 볼 수 있어요', '오늘은 조금 가볍게 시작하는 쪽이 좋아요'처럼 바로 답한다.",
    "재회": "질문이 재회라면 첫 문장은 '재회 가능성은 남아 있어요' 또는 '지금 당장 재회를 밀어붙이긴 어려워요'처럼 바로 답한다.",
    "퇴사 전달": "질문이 퇴사/그만둔다고 말하는 방법이라면 첫 문장은 '돌려 말하기보다 짧고 분명하게 말하는 게 좋아요' 또는 '감정 설명은 줄이고 일정과 마무리 계획을 먼저 말하세요'처럼 바로 답한다.",
    "직장/이직": "질문이 이직/직장이라면 첫 문장은 '준비해도 괜찮아요' 또는 '지금은 보류하고 조건을 더 확인해야 해요'처럼 바로 답한다.",
    "금전": "질문이 금전이라면 첫 문장은 '이번 달은 지키는 흐름이 좋아요' 또는 '새 지출은 줄이는 편이 좋아요'처럼 바로 답한다.",
    "시험/진로": "질문이 시험/진로라면 첫 문장은 '가능성은 있어요' 또는 '방향을 조금 수정해야 해요'처럼 바로 답한다.",
    "선택 고민": "질문이 선택이라면 첫 문장은 '선택해도 괜찮아요' 또는 '지금은 보류가 좋아요'처럼 바로 답한다.",
    "인간관계": "질문이 인간관계라면 첫 문장은 '거리를 조금 두는 편이 좋아요' 또는 '대화를 열어도 괜찮아요'처럼 바로 답한다.",
    "새로운 인연": asksTiming
      ? "질문이 새 인연의 시기라면 첫 문장은 '가까운 흐름은 2~4주 안에 열려요', '다음 달 초중순부터 만남 운이 살아나요', '한 달 내외로 새 만남의 계기가 들어올 수 있어요'처럼 구체적인 시기감을 반드시 포함해 바로 답한다."
      : "질문이 새 인연이라면 첫 문장은 '새 인연 흐름은 열려 있어요' 또는 '아직은 준비가 먼저예요'처럼 바로 답한다.",
    "연애": "질문이 연애라면 첫 문장은 '이어갈 가능성은 있어요' 또는 '지금은 속도 조절이 필요해요'처럼 바로 답한다.",
    "일반 흐름": "질문이 일반 흐름이라면 첫 문장은 '지금은 확인하고 움직이는 편이 좋아요'처럼 바로 답한다."
  };
  const direct = answerExamples[category] || answerExamples["일반 흐름"];
  const loveForbidden = ["퇴사 전달", "직장/이직", "금전", "시험/진로", "선택 고민", "일반 흐름"].includes(category)
    ? "- 이 질문은 연애 질문이 아니므로 상대방, 연락, 두 사람, 호감, 관계 온도 같은 표현을 쓰지 않는다.\n"
    : "";
  const contactForbidden = category !== "연락" && !/(연락|답장|카톡|문자|전화)/.test(normalized)
    ? "- 질문자님이 연락을 묻지 않았다면 연락 여부로 답을 돌리지 않는다.\n"
    : "";
  return `[질문 직접 답변 계약]
- 실제 질문 원문: "${q || "지정되지 않음"}"
- 확정 질문 유형: ${category}
- 첫 문장은 반드시 질문 원문에 대한 직접 답이어야 한다.
- 카드 설명은 첫 답을 뒷받침하는 근거일 뿐, 질문의 주제를 바꾸면 안 된다.
- ${direct}
${loveForbidden}${contactForbidden}- 질문자님이 직접 말하지 않은 배경을 만들지 않는다. 특히 '교류가 멈췄다', '연락이 끊겼다', '오랫동안 못 봤다', '멀어진 상태다', '다툼이 있었다' 같은 상황은 질문이나 현재 상황에 실제로 적혀 있을 때만 쓴다.
- 질문에 '언제', '시기', '쯤', '가까운 시기'가 들어가면 첫 문장과 전체 흐름에 반드시 시기감을 넣는다. 예: '2~4주 안', '다음 달 초중순', '한 달 내외', '조금 늦어도 6주 안팎'. 단정적인 날짜처럼 꾸미지 말고 타로식 가능 시기로 말한다.
- 질문형 리딩에서는 1번/2번/3번 카드의 역할을 미리 정해진 배열명으로 고정하지 않는다. 각 카드의 role은 질문 원문, 현재 상황, 카드 조합을 보고 그때그때 새로 붙인다.
- 현재 상황이 비어 있거나 질문만 반복되어 있으면, 상황을 추측하지 말고 선택한 카드와 질문의 의도만 근거로 답한다.
- 호감/속마음 질문에서는 첫 문장부터 상대의 마음을 직접 답한다. 연락 여부, 답장 가능성, 대화 재개 여부로 결론을 바꾸지 않는다.
- '좋아하나요?', '호감이 있나요?'라는 질문에는 '호감이 들어와 있어요', '관심은 있지만 표현이 서툴러요', '호기심이 호감으로 커지는 중이에요', '아직은 마음이 커지는 초입이에요'처럼 마음의 정도를 바로 말한다.
- 모호하게 피하지 말고 '가능해요/보류가 좋아요/호감이 있어요/아직은 약해요/준비해도 돼요'처럼 결론을 먼저 말한다.`;
}

function responseLooksOffTopic(question: string, category: string, parsed: any): { offTopic: boolean; reason?: string } {
  const q = (question || "").replace(/\s+/g, " ").trim();
  const compactQuestion = q.toLowerCase();
  const text = JSON.stringify(parsed || "");
  const firstAnswer = String(parsed?.oneLineConclusion || "");
  const nonLoveCategories = ["퇴사 전달", "직장/이직", "금전", "시험/진로", "선택 고민", "평판/시선"];
  const questionAsksContact = /(연락|답장|카톡|문자|전화|읽씹)/.test(compactQuestion);
  const questionAsksFeeling = /(속마음|어떻게\s*생각|진심|나를\s*생각|마음일|좋아하|호감|관심\s*있|날\s*어떻게|나를\s*어떻게)/.test(compactQuestion);

  if (nonLoveCategories.includes(category) && /(상대방|상대는|두 사람|호감|재회|썸|연락해|답장|카톡|관계 온도)/.test(text)) {
    return { offTopic: true, reason: `비연애 질문(${category})인데 연애/연락 표현이 섞였습니다.` };
  }

  if (!questionAsksContact && category !== "연락" && /(먼저\s*연락|연락하는\s*건|답장을|카톡|문자)/.test(firstAnswer)) {
    return { offTopic: true, reason: "연락을 묻지 않았는데 첫 결론이 연락 여부로 바뀌었습니다." };
  }

  if (questionAsksFeeling && !/(호감|마음|관심|끌림|생각|태도|자존심|경계|표현)/.test(text)) {
    return { offTopic: true, reason: "속마음/호감 질문인데 마음에 대한 직접 답이 부족합니다." };
  }

  if (category === "평판/시선" && !/(사람|시선|평판|오해|불쌍|무시|평가|걱정|보는|생각|주변|남들|판단)/.test(text)) {
    return { offTopic: true, reason: "평판/시선 질문인데 타인의 시선에 대한 답이 부족합니다." };
  }

  if (category === "평판/시선" && /(금전적\s*완성|금전\s*흐름|수입|지출|투자|재물)/.test(firstAnswer)) {
    return { offTopic: true, reason: "평판/시선 질문인데 첫 답이 금전 결과로 흘렀습니다." };
  }

  if (category === "금전" && !/(돈|금전|수입|지출|재물|투자|흐름|관리|리스크|안정)/.test(text)) {
    return { offTopic: true, reason: "금전 질문인데 금전 흐름에 대한 답이 부족합니다." };
  }

  if (category === "직장/이직" && !/(이직|직장|회사|업무|조건|준비|면접|결정|가능성|커리어)/.test(text)) {
    return { offTopic: true, reason: "직장/이직 질문인데 직업적 판단 근거가 부족합니다." };
  }

  if (category === "퇴사 전달" && !/(퇴사|그만|회사|말|전달|상사|일정|마무리|인수인계)/.test(text)) {
    return { offTopic: true, reason: "퇴사 전달 질문인데 어떻게 말할지에 대한 답이 부족합니다." };
  }

  return { offTopic: false };
}

function isGeminiRateLimitError(errorMsg: string) {
  const lower = (errorMsg || "").toLowerCase();
  return errorMsg.includes("429") || lower.includes("quota") || lower.includes("rate limit") || lower.includes("exhausted");
}

function createLocalStandardReading(menuId: string, cards: any[], spreadRoles: string[] = [], relationship?: string) {
  const temperature = calculateRelationshipTemperature(cards, relationship);
  const lens = localReadingLens[menuId] || localReadingLens["relation-flow"];
  const themes = cards.map(localCardTheme);
  const roles = spreadRoles.length === 3 ? spreadRoles : ["지금의 마음", "관계를 움직이는 요인", "앞으로의 태도"];
  const openerPools = [
    [
      "처음 흐름은 질문자님이 이 관계를 그냥 흘려보내지 못하고 있다는 점부터 올라와요.",
      "겉으로는 담담해도 속으로는 상대의 작은 반응을 꽤 오래 되짚어 보는 느낌이에요.",
      "확실한 말보다 분위기와 행동을 읽으려는 마음이 먼저 잡혀요.",
    ],
    [
      "가운데 흐름은 질문자님이 바라는 모습과 상대가 실제로 보여 준 태도를 나눠 보게 해요.",
      "두 번째 흐름에서는 감정보다 그 마음을 표현하지 못하게 만드는 조심스러움이 더 크게 읽혀요.",
      "상대에게도 마음만으로 넘기 어려운 현실적인 선이 하나 걸려 있어요.",
    ],
    [
      "마지막 카드는 행동의 크기보다 타이밍과 말의 무게가 중요하다고 답해요.",
      "세 번째 흐름은 상대를 움직이는 방법보다 질문자님이 후회하지 않을 선택을 묻고 있어요.",
      "마지막 카드는 지금의 작은 태도 하나가 이후 흐름을 바꿀 수 있다고 말해요.",
    ],
  ];
  const interpretedCards = cards.map((card, index) => {
    const theme = themes[index];
    const orientation = card.isReversed ? "역방향" : "정방향";
    const opener = openerPools[index][(Number(card.id) + menuId.length + index) % openerPools[index].length];
    return {
      role: roles[index],
      cardName: card.name || card.nameEn || theme.name,
      orientation,
      coreMeaning: `${theme.name}의 핵심은 ‘${theme.keyword}’입니다. ${theme.base}`,
      contextualMeaning: `${opener} ${withKoreanParticle(theme.name, "이", "가")} ${theme.base}. ${theme.direction}. 그래서 지금은 결론을 서두르기보다, 실제 행동에서 같은 신호가 반복되는지 확인해 보세요.`,
    };
  });

  const names = themes.map((theme) => theme.name);
  const reversedCount = cards.filter((card) => card.isReversed).length;
  const highTemp = temperature >= 68;
  const lowTemp = temperature < 45;
  const conclusionByMenu: Record<string, string> = {
    "dating-luck": highTemp
      ? "오늘은 누군가를 만나는 것보다, 질문자님의 편안한 매력이 자연스럽게 드러나는 순간에 인연이 따라오는 날이에요."
      : "오늘의 연애운은 강한 사건보다 내 마음의 문을 어디까지 열어 둘지 정하는 데서 시작돼요.",
    "inner-mind": highTemp
      ? "상대에게 감정은 꽤 선명하게 보여요. 다만 그 마음을 관계의 책임으로 옮길 준비가 되었는지는 조금 더 지켜봐야 해요."
      : "관심은 있지만 자존심과 자기보호가 더 앞서 있어요. 그래서 마음보다 태도가 한 박자 늦게 나올 수 있어요.",
    "can-contact": temperature >= 55
      ? "연락은 해도 괜찮아요. 다만 답을 확인하려는 연락이 아니라 서로 숨을 편하게 만드는 연락이어야 해요."
      : "오늘 연락하지 않는다고 관계가 끝나는 건 아니에요. 지금은 한 박자 쉬는 쪽이 오히려 질문자님의 마음을 지켜 줘요.",
    "relation-temp": highTemp
      ? "두 사람 사이에는 분명한 온기가 있어요. 이제 필요한 건 감정 확인보다 그 온기를 꾸준한 행동으로 바꾸는 일이에요."
      : lowTemp
        ? "지금의 낮은 온도는 마음이 없어서가 아니라, 서로 지친 채 자기 쪽으로 움츠러든 결과로 보여요."
        : "두 사람은 멀지도 가깝지도 않은 경계에 있어요. 애매함을 끝낼 작은 행동 하나가 필요한 시점이에요.",
    "relation-flow": reversedCount >= 2
      ? "이번 주는 관계가 곧장 앞으로 나가기보다 멈춤과 재조정을 거쳐 방향을 잡는 흐름이에요."
      : "이번 주는 초반의 어색함보다 후반의 작은 행동이 관계 분위기를 바꿀 가능성이 커요.",
  };
  const oneLineConclusion = conclusionByMenu[menuId] || "지금 필요한 건 상대의 마음을 맞히는 일이 아니라, 내 마음이 안전한 선택을 하는 일이에요.";
  const combinedFlow = `이번 리딩은 ${withKoreanParticle(lens.focus, "을", "를")} 봐요. ${withKoreanParticle(names[0], "은", "는")} ${withKoreanParticle(themes[0].keyword, "을", "를")} 드러내지만, ${withKoreanParticle(names[1], "은", "는")} ${withKoreanParticle(themes[1].keyword, "이라는", "라는")} 현실을 보여 줍니다. ${withKoreanParticle(names[2], "은", "는")} ${reversedCount >= 2 ? "침묵을 무관심으로 단정하지 말고 천천히 움직이라고 조언해요." : `${withKoreanParticle(themes[2].keyword, "을", "를")} 기준으로 차분히 행동하라고 조언해요.`} 세 장을 함께 보면 감정 자체보다 그 감정을 어떻게 다룰지가 더 중요한 리딩이에요.`;

  const caution = cards[1]?.isReversed
    ? `${names[1]}의 막힌 흐름에서는 애매한 반응을 원하는 쪽으로 해석하지 않는 게 좋아요. 같은 질문을 반복하면 질문자님 마음만 더 지칠 수 있어요.`
    : `${withKoreanParticle(names[1], "이", "가")} 중심에 있으니 한 번의 말보다 반복되는 태도를 보세요. 신호 하나로 앞서가거나 포기하지는 마세요.`;
  const actionAdvice = `${lens.advice}. ${cards[2]?.isReversed ? `${withKoreanParticle(names[2], "이", "가")} 막힌 흐름으로 나와 하고 싶은 말을 절반 정도 덜어 내는 게 좋아요.` : `${withKoreanParticle(names[2], "이", "가")} 보여 주는 흐름상 작은 행동은 옮겨도 괜찮아요.`} 다만 상대의 반응을 바로 결론으로 묶기보다, 오늘은 분위기를 확인하는 정도로만 가볍게 두세요. 이 사람은 마음이 움직여도 먼저 지는 느낌을 꽤 싫어하는 편이에요.`;
  const cardMeanings = interpretedCards.map((card) => card.contextualMeaning);
  const contactRecommendation = temperature >= 62 && !cards[2]?.isReversed
    ? "오늘은 먼저 연락해도 좋아요. 안부나 함께 아는 가벼운 주제로 짧게 시작해 보세요."
    : temperature >= 48
      ? "연락은 가능하지만 감정 확인은 미뤄 두세요. 대화가 자연스럽게 이어지는지만 보는 편이 좋아요."
      : "오늘은 연락보다 질문자님의 불안을 먼저 가라앉히는 게 좋아요. 하루 이틀의 침묵이 관계의 결론은 아닙니다.";

  return {
    oneLineConclusion, combinedFlow, totalFlow: combinedFlow, conclusion: oneLineConclusion,
    caution, actionAdvice, temperature, cards: interpretedCards,
    card1Meaning: cardMeanings[0], card2Meaning: cardMeanings[1], card3Meaning: cardMeanings[2],
    todayEmotion: cardMeanings[0], incomingPersonOrEvent: cardMeanings[1],
    outwardAttitude: cardMeanings[0], realFeeling: cardMeanings[1], hiddenEmotion: `${cardMeanings[1]} 지금 보이는 거리감 안에는 감정이 없어서가 아니라 감정을 다룰 자신이 부족한 면도 섞여 있어 보여요.`, futureAction: cardMeanings[2],
    contactRecommendation, partnerCondition: cardMeanings[0], expectedResponse: cardMeanings[1], conversationPossibility: combinedFlow,
    avoidMessage: "왜 답이 없냐는 추궁, 관계를 지금 당장 정의해 달라는 요구, 상대의 마음을 대신 결론 내리는 표현은 피하세요.",
    recommendedApproach: contactRecommendation,
    partnerFeeling: cardMeanings[0], relationshipBarrier: cardMeanings[1], nearFuture: cardMeanings[2],
    earlyWeek: cardMeanings[0], midWeek: cardMeanings[1], lateWeek: cardMeanings[2], turningPoint: `${names[2]}의 조언을 실제 행동으로 옮기는 순간이 이번 흐름의 전환점이에요.`,
    followUpQuestions: menuId === "inner-mind"
      ? ["상대가 감정을 표현하지 못하는 진짜 이유는 무엇일까요?", "상대의 다음 행동은 언제쯤 보일까요?", "이 관계에서 질문자님이 지켜야 할 선은 어디일까요?"]
      : ["지금 관계를 막고 있는 가장 현실적인 문제는 무엇일까요?", "질문자님이 먼저 움직이면 상대는 어떻게 받아들일까요?", "앞으로 한 달 안에 관계가 달라질 가능성은 있을까요?"],
  };
}

function getAverageCardScore(cards: any[], key: string, fallback = 50) {
  const values = cards
    .map((card) => Number(card?.[key]))
    .filter((value) => !Number.isNaN(value));
  if (values.length === 0) {
    const seedOffset: Record<string, number> = {
      affection: 11,
      action: 23,
      defense: 37,
      communication: 41,
    };
    const syntheticValues = cards.map((card, index) => {
      const rawId = Number(card?.id ?? card?.value ?? index + 1);
      const id = Number.isNaN(rawId) ? index + 1 : rawId;
      const base = 42 + ((id * 13 + (seedOffset[key] || 17)) % 36);
      const reversedPenalty = card?.isReversed
        ? (key === "defense" ? 12 : -10)
        : 0;
      return Math.max(20, Math.min(88, base + reversedPenalty));
    });
    if (syntheticValues.length === 0) return fallback;
    return Math.round(syntheticValues.reduce((sum, value) => sum + value, 0) / syntheticValues.length);
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function buildFeelingReadingTone(question: string, cards: any[], themes: { name: string; keyword: string; orientation: string }[]) {
  const affection = getAverageCardScore(cards, "affection", 56);
  const action = getAverageCardScore(cards, "action", 50);
  const defense = getAverageCardScore(cards, "defense", 50);
  const communication = getAverageCardScore(cards, "communication", 50);
  const reversedCount = cards.filter((card) => card?.isReversed).length;
  const anchorCard = themes[1]?.name || themes[0]?.name || "가운데 카드";
  const hasLikeQuestion = /(좋아하|호감|관심\s*있|나를\s*어떻게|날\s*어떻게|어떻게\s*생각)/.test(question || "");
  const cardText = themes
    .map((theme) => `${theme.name} ${theme.keyword}`)
    .join(" ");
  const hasStrongLoveCard = /(연인|태양|컵\s*2|컵 2|컵 에이스|여황제|별|세계|매혹|깊은 교감|투명한 감정|확고한 진심|정서적 유대|사랑 가득함)/.test(cardText);
  const hasGuardedCard = /(달|은둔자|매달린 사람|정의|소드\s*4|소드\s*7|지팡이\s*9|경계|거리두기|정체|저울질|불안|망설임|방어)/.test(cardText);
  const hasCuriosityCard = /(시종|절제|마법사|지팡이 에이스|호기심|서툴지만 밝은|조화로운 소통|시작되는 두근거림|창의력)/.test(cardText);

  if (hasCuriosityCard && hasStrongLoveCard && reversedCount === 0) {
    return {
      conclusion: "처음부터 깊게 빠진 느낌보다는, 호기심이 호감으로 커지는 중이에요. 편하게 이어지는 대화가 마음을 더 키우는 흐름입니다.",
      advice: "지금은 관계를 정의하려 하기보다 ‘또 얘기하고 싶다’는 감각을 만드는 게 중요해요. 상대가 사소한 이야기를 이어 가면, 그건 꽤 좋은 신호로 봐도 돼요.",
    };
  }

  if (hasStrongLoveCard && reversedCount === 0 && !hasGuardedCard) {
    return {
      conclusion: hasLikeQuestion
        ? "끌림은 꽤 선명해요. 특히 감정 자체가 완전히 숨겨지진 않고 자연스럽게 새어 나와요."
        : "마음의 온도는 높은 편이에요. 분위기가 맞으면 생각보다 빠르게 다정한 반응이 나올 수 있어요.",
      advice: "지금은 의심을 던지기보다 편안한 접점을 늘리는 게 좋아요. 상대가 이미 보인 다정한 순간을 부정하지 말고, 그 흐름이 반복되는지만 차분히 확인하세요.",
    };
  }

  if (hasGuardedCard && reversedCount >= 2) {
    return {
      conclusion: `${anchorCard} 때문에 지금은 좋아한다/싫어한다보다 부담을 먼저 살피는 흐름이에요. 관심이 있어도 행동으로 바로 나오기 어려운 상태입니다.`,
      advice: "이럴 때는 확인 질문을 던질수록 상대가 더 멈출 수 있어요. 한 번 물러서서 상대가 먼저 시선을 돌리는지, 다시 대화를 여는지 보는 편이 정확해요.",
    };
  }

  if (hasGuardedCard && (reversedCount >= 1 || defense >= 58)) {
    return {
      conclusion: `${anchorCard} 흐름상 관심은 있어도 경계심이 먼저 올라와요. 이 사람은 마음보다 자존심과 조심스러움이 앞서는 타입으로 보여요.`,
      advice: "바로 확인하려 들면 상대가 더 방어적으로 굳을 수 있어요. 지금은 내가 얼마나 좋아하는지 보여 주기보다, 상대가 스스로 반응할 여백을 남기는 게 좋아요.",
    };
  }

  if (hasCuriosityCard && communication >= 50) {
    return {
      conclusion: "아직 깊은 확신보다는 호기심이 먼저예요. 그래도 대화가 편해지면 호감으로 커질 수 있는 씨앗은 보여요.",
      advice: "무거운 감정 확인보다 자주 편하게 닿는 흐름을 만드는 게 먼저예요. 상대가 농담이나 일상 얘기에 얼마나 오래 머무는지 보면 마음의 크기가 더 잘 보여요.",
    };
  }

  if (affection >= 70 && defense < 62 && reversedCount <= 1) {
    return {
      conclusion: hasLikeQuestion
        ? "끌림은 꽤 선명해요. 다만 이 사람은 감정이 생겨도 바로 티 내기보다 분위기를 먼저 확인하는 쪽이에요."
        : "마음의 온도는 높은 편이에요. 특히 감정보다 분위기와 타이밍을 보며 조심스럽게 움직이는 흐름입니다.",
      advice: "너무 확인하려 들기보다 편안한 접점을 늘리는 게 좋아요. 지금은 크게 밀어붙이는 말보다 자연스러운 반복이 상대의 마음을 더 빨리 드러내요.",
    };
  }

  if (affection >= 58 && defense >= 62) {
    return {
      conclusion: "관심은 있는데 자존심이 더 앞서요. 좋아하는 티를 내면 지는 느낌을 싫어해서 태도가 일부러 담담해질 수 있어요.",
      advice: "이 사람은 반응을 먼저 떠보는 편이라, 감정을 바로 확인하려 하면 더 굳을 수 있어요. 가볍게 열어 두되 끌려다니지는 않는 태도가 제일 잘 먹혀요.",
    };
  }

  if (affection >= 52 && communication >= 58 && reversedCount <= 1) {
    return {
      conclusion: "아직 깊은 확신보다는 호기심과 관심이 섞인 단계예요. 대화가 이어질수록 마음이 커질 수 있는 흐름입니다.",
      advice: "지금은 고백처럼 무거운 확인보다 대화의 리듬을 만드는 게 먼저예요. 상대가 어떤 주제에서 길게 반응하는지 보면 마음의 방향이 더 정확히 보여요.",
    };
  }

  if (reversedCount >= 2 || defense >= 70) {
    return {
      conclusion: `${anchorCard} 흐름상 지금은 끌림이 바로 표현되기보다 경계심에 눌려 있어요. 마음이 완전히 닫힌 건 아니지만, 다가오는 속도가 빠르면 부담을 먼저 느끼는 상태예요.`,
      advice: "오늘은 밀어붙이는 것보다 한 발 물러서서 상대의 자발적인 반응을 보는 게 좋아요. 이 흐름에서는 내가 애쓸수록 상대가 편해지는 게 아니라 책임감을 느껴 더 굳을 수 있어요.",
    };
  }

  if (action < 45) {
    return {
      conclusion: "생각은 하지만 행동으로 옮기는 힘은 약해요. 마음의 방향보다 귀찮음, 상황 부담, 타이밍 문제가 더 크게 잡고 있습니다.",
      advice: "상대의 마음을 말로 캐기보다 실제 행동이 반복되는지 보는 게 정확해요. 한 번의 다정함에 의미를 크게 붙이면 내가 더 불안해질 수 있어요.",
    };
  }

  return {
    conclusion: "관심 신호는 있지만 아직 선명하게 굳어진 마음은 아니에요. 지금은 좋아함과 망설임이 같이 움직이는 애매한 구간입니다.",
    advice: "상대의 작은 반응 하나에 결론을 붙이지 말고, 며칠 간격으로 태도가 반복되는지 보세요. 진짜 마음은 말보다 일정하게 돌아오는 행동에서 먼저 보여요.",
  };
}

function buildResignationMessageTone(cards: any[], themes: { name: string; keyword: string; orientation: string }[]) {
  const reversedCount = cards.filter((card) => card?.isReversed).length;
  const middle = themes[1]?.name || "가운데 카드";
  const last = themes[2]?.name || "마지막 카드";
  const cardText = themes.map((theme) => `${theme.name} ${theme.keyword}`).join(" ");
  const hasConflict = /(검|소드|펜타클\s*5|펜타클 5|탑|악마|지팡이\s*5|지팡이 5|갈등|고단함|단절|충격|압박|무거운)/.test(cardText);
  const hasCalm = /(절제|정의|교황|펜타클|세계|조화|균형|신뢰|책임|안정|완성)/.test(cardText);

  if (reversedCount >= 2 || hasConflict) {
    return {
      conclusion: "그만둔다고 말할 때는 이유를 길게 설명하지 않는 게 좋아요. 지금은 감정이 섞이면 말이 꼬이기 쉬워서, 짧게 결론부터 꺼내야 합니다.",
      flow: `${middle} 흐름을 보면 상대가 바로 이해해 주기보다 먼저 당황하거나 현실적인 부담을 떠올릴 수 있어요. 그래서 설득하려는 말보다 퇴사 의사, 가능한 마지막 근무일, 마무리하겠다는 태도를 차례로 말하는 게 안전합니다. 특히 지금 카드는 “내가 왜 힘들었는지 다 알아줬으면” 하는 마음이 올라와도, 그걸 전부 설명하는 순간 대화 주도권이 흐려질 수 있다고 보여 줘요.`,
      caution: "힘들었던 이유를 한꺼번에 털어놓으면 대화가 방어적으로 흐를 수 있어요. 사과하거나 변명하듯 시작하지 말고, 결정은 분명히 말하세요. 상대가 이유를 캐물어도 그 자리에서 감정의 전말을 다 풀기보다, 개인 사정과 방향 정리 정도로 짧게 닫는 편이 좋습니다.",
      advice: "첫 문장은 “말씀드릴 게 있습니다. 고민 끝에 그만두기로 결정했습니다.” 정도로 짧게 잡는 게 좋아요. 그다음 “마지막 근무일과 인수인계는 최대한 맞춰 정리하겠습니다”처럼 마무리 계획을 붙이면 덜 흔들려요. 붙잡히거나 이유를 더 묻는다면 바로 설득에 들어가지 말고, “결정은 오래 고민했고, 정리는 책임지고 하겠습니다”처럼 같은 입장을 반복하는 게 가장 안전합니다.",
    };
  }

  if (hasCalm) {
    return {
      conclusion: "차분하고 정중하게 말하면 괜찮아요. 핵심은 허락을 구하는 말투가 아니라, 이미 결정한 일을 예의 있게 전달하는 태도입니다.",
      flow: `${middle} 흐름은 말의 순서를 정리하면 대화가 크게 틀어지지 않는다고 보여 줘요. 감정 설명보다 결정, 일정, 인수인계 순서로 말하면 상대도 현실적으로 받아들이기 쉬워집니다. 이 조합은 “좋게 끝내고 싶은 마음”은 살아 있지만, 그 마음 때문에 너무 낮은 자세로 들어가면 오히려 붙잡히거나 흔들릴 수 있다고 말해요.`,
      caution: "너무 미안해하는 말로 시작하면 상대가 붙잡거나 조건을 바꾸려 할 수 있어요. 고마웠던 점은 짧게 말하되, 결정이 흔들리는 느낌은 주지 않는 게 좋아요. 특히 “혹시 괜찮을까요?”처럼 허락을 구하는 말투는 피하는 편이 낫습니다.",
      advice: "처음에는 “고민 끝에 퇴사를 결정했습니다”라고 분명히 말하세요. 이어서 “남은 기간 동안 맡은 일은 정리하고 인수인계하겠습니다”라고 덧붙이면 예의와 선이 같이 살아납니다. 마지막에는 감사 인사를 길게 늘어놓기보다, 정리 일정과 협의 가능한 부분을 차분히 말하는 게 더 성숙하게 들려요.",
    };
  }

  return {
    conclusion: "돌려 말하기보다 짧고 분명하게 말하는 게 좋아요. 이유를 자세히 설명하기보다 ‘결정했다’는 사실과 마무리 계획을 먼저 전하세요.",
    flow: `${last} 흐름상 말을 오래 끌수록 오히려 부담이 커질 수 있어요. 지금 필요한 건 완벽한 설명이 아니라, 상대가 바로 이해할 수 있는 간단한 구조입니다. 카드들은 “어떻게 말해야 상처를 덜 줄까”보다 “어디까지 말해야 내가 흔들리지 않을까”가 더 중요하다고 보여 줍니다.`,
    caution: "상대 반응을 예상해서 미리 겁먹으면 말이 더 길어질 수 있어요. 붙잡히더라도 그 자리에서 새 조건을 바로 판단하지 말고, 결정한 입장을 유지하세요. 대화가 길어질수록 미안함과 책임감이 섞여 내가 원래 하려던 말을 잃을 수 있습니다.",
    advice: "말은 “고민 끝에 그만두기로 결정했습니다”로 시작하면 충분해요. 그 뒤에는 마지막 근무 가능일과 정리할 업무를 차분히 말하면 됩니다. 이유를 묻는다면 “개인적인 방향을 정리한 결정입니다” 정도로 답하고, 더 자세한 사정 설명은 최소화하는 편이 좋습니다.",
  };
}

function hashText(text: string) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function pickRotated(items: string[], seed: number, count = 3) {
  if (items.length <= count) return items;
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    result.push(items[(seed + i * 2) % items.length]);
  }
  return Array.from(new Set(result)).slice(0, count);
}

function buildLocalFollowUpQuestions(category: string, question: string, themes: { name: string; keyword: string; orientation: string }[], roles: string[]) {
  const seed = hashText(`${category}|${question}|${themes.map(t => t.name).join(",")}`);
  const first = themes[0]?.name || "첫 카드";
  const second = themes[1]?.name || "두 번째 카드";
  const third = themes[2]?.name || "마지막 카드";
  const pools: Record<string, string[]> = {
    "평판/시선": [
      "다른 사람들이 실제로 나를 어떻게 보고 있을까요?",
      "내가 두려워하는 시선은 실제보다 커져 있는 걸까요?",
      "사람들이 오해한다면 어떤 부분을 가장 오해할까요?",
      "이 선택 후 내 평판은 시간이 지나며 어떻게 바뀔까요?",
      "내가 남의 시선보다 먼저 지켜야 할 기준은 무엇일까요?",
      `${second} 카드가 말하는 주변 시선의 핵심은 무엇일까요?`,
      "지금 내가 당당하게 보여 줘야 할 태도는 무엇일까요?"
    ],
    "퇴사 전달": [
      "퇴사 말을 꺼내면 상사는 실제로 어떻게 반응할까요?",
      "퇴사 이유를 어디까지 말하는 게 가장 안전할까요?",
      "마지막 근무일은 언제쯤으로 말하는 게 좋을까요?",
      "붙잡히면 어떤 태도로 대답해야 흔들리지 않을까요?",
      "퇴사 전에 내가 정리해야 할 가장 중요한 일은 무엇일까요?",
      `${second} 카드가 말하는 퇴사 대화의 가장 조심할 포인트는 무엇일까요?`,
      "지금 그만두는 선택이 앞으로 내 흐름에 어떤 변화를 만들까요?"
    ],
    "속마음": [
      "그 사람이 지금 가장 숨기고 있는 감정은 무엇일까요?",
      "그 사람은 나를 이성적으로 얼마나 의식하고 있을까요?",
      "그 사람이 마음을 천천히 표현하는 이유는 무엇일까요?",
      `${second} 카드가 보여 주는 진짜 속마음은 무엇일까요?`,
      "질문자님이 자연스럽게 다가가면 그 사람은 어떻게 반응할까요?",
      "이 사람이 마음을 표현하지 않는 가장 큰 이유는 무엇일까요?",
      "앞으로 그 사람이 먼저 움직일 가능성은 어느 정도일까요?"
    ],
    "연락": [
      "오늘 먼저 연락하면 어떤 반응이 돌아올까요?",
      "지금은 기다리는 게 나을까요, 짧게 움직이는 게 나을까요?",
      "상대가 답장을 늦게 하는 진짜 이유는 무엇일까요?",
      "연락을 한다면 어떤 무게로 시작해야 할까요?",
      `${third} 카드가 말하는 연락 타이밍은 언제일까요?`,
      "연락 후 관계 분위기는 어떻게 바뀔까요?"
    ],
    "직장/이직": [
      "지금 이직을 시작하면 가장 먼저 부딪힐 문제는 무엇일까요?",
      "현재 회사에 남는 선택은 내게 어떤 흐름을 만들까요?",
      "옮긴다면 어떤 조건을 가장 중요하게 봐야 할까요?",
      `${first} 카드가 보여 주는 현재 직장운의 핵심은 무엇일까요?`,
      "이직운이 좋아지는 시점은 언제쯤일까요?",
      "지금 준비하면 합격 가능성이 열릴까요?"
    ],
    "금전": [
      "이번 달 가장 조심해야 할 지출은 무엇일까요?",
      "돈 흐름을 좋아지게 할 현실적인 방법은 무엇일까요?",
      "지금 투자나 큰 지출을 해도 괜찮을까요?",
      `${second} 카드가 말하는 돈이 새는 지점은 어디일까요?`,
      "다음 달 수입 흐름은 지금보다 좋아질까요?",
      "내가 놓치고 있는 금전 리스크는 무엇일까요?"
    ],
    "일반 흐름": [
      "지금 이 흐름에서 가장 조심해야 할 점은 무엇일까요?",
      "내가 놓치고 있는 핵심 신호는 무엇일까요?",
      "앞으로 한 달 안에 흐름이 어떻게 바뀔까요?",
      `${roles[1] || "핵심"}에서 가장 크게 작용하는 변수는 무엇일까요?`,
      `${third} 카드가 말하는 다음 행동은 무엇일까요?`,
      "이 선택을 하면 내가 가장 후회할 수 있는 부분은 무엇일까요?"
    ]
  };
  return pickRotated(pools[category] || pools["일반 흐름"], seed, 3);
}

function createLocalQuestionReading(question: string, category: string, cards: any[], spreadRoles: string[] = []) {
  const roles = spreadRoles.length === 3 ? spreadRoles : ["현재 상황", "흐름을 움직이는 핵심", "앞으로의 방향과 조언"];
  const themes = cards.map((card) => ({
    name: card.nameKr || card.name || "이 카드",
    keyword: card.isReversed
      ? card.reversedMeaningKr || card.keywordKr || "막힘과 재검토"
      : card.keywordKr || "가능성과 움직임",
    orientation: card.isReversed ? "역방향" : "정방향",
  }));
  const feelingTone = buildFeelingReadingTone(question, cards, themes);
  const resignationTone = buildResignationMessageTone(cards, themes);
  const subjectByCategory: Record<string, string> = {
    "평판/시선": "사람들이 질문자님을 한쪽으로만 판단하진 않아요. 지금 크게 올라온 건 실제 평판보다, 질문자님이 스스로 작아 보일까 걱정하는 마음이에요.",
    "직장/이직": "준비해도 괜찮아요. 다만 바로 옮기기보다 조건과 가능성을 구체적으로 비교한 뒤 결정하는 편이 좋아요.",
    "퇴사 전달": resignationTone.conclusion,
    "금전": "지금은 공격적으로 늘리기보다 지키는 쪽이 좋아요. 새는 지출을 먼저 정리하면 흐름이 안정될 수 있어요.",
    "시험/진로": "가능성은 있어요. 결과를 걱정하는 시간보다 지금 반복할 수 있는 준비가 실제 결과를 바꿔요.",
    "선택 고민": "선택 자체는 가능하지만, 오늘 바로 확정하기보다는 내 마음이 버틸 수 있는 선택인지 먼저 봐야 해요.",
    "연락": "연락해도 괜찮아요. 다만 답을 재촉하기보다 상대가 편하게 반응할 수 있는 무게로 시작하는 편이 좋아요.",
    "속마음": feelingTone.conclusion,
    "재회": "가능성은 남아 있지만 지금 당장 재회를 밀어붙이는 건 보류가 좋아요. 이전 문제가 실제로 달라졌는지부터 확인하세요.",
    "새로운 인연": "새로운 만남의 가능성은 열려 있어요. 익숙한 기준을 조금 내려놓을수록 인연을 알아보기 쉬워져요.",
    "인간관계": "억지로 맞추기보다 잠시 선을 정하는 편이 좋아요. 반복되는 태도를 확인한 뒤 관계의 거리를 결정하세요.",
    "연애": "이어갈 가능성은 있어요. 다만 감정의 크기보다 두 사람이 실제로 보여 주는 행동의 일관성을 봐야 해요.",
    "일반 흐름": "지금 바로 단정하기보다는 한 번 더 확인하는 편이 좋아요. 작은 행동으로 흐름을 먼저 시험해 보세요.",
  };
  const oneLineConclusion = subjectByCategory[category] || subjectByCategory["일반 흐름"];
  const cardMeanings = themes.map((theme, index) => {
    if (category === "퇴사 전달") {
      const resignationDirections = [
        "처음부터 사정을 길게 설명하기보다, 이미 고민해서 내린 결정이라는 점을 차분히 꺼내야 해요. 이 카드는 마음속으로는 이미 결론이 났는데, 막상 말하려니 상대 반응을 먼저 걱정하는 상태를 보여 줍니다.",
        "상대가 붙잡거나 이유를 물을 수 있으니, 감정 싸움으로 가지 않게 말의 순서를 짧게 잡는 게 좋아요. 특히 현실적인 손실이나 인력 공백 이야기가 나올 수 있어서, 미안함보다 정리 계획을 먼저 준비해야 합니다.",
        "마지막에는 미안함보다 마무리 계획을 말해야 대화가 덜 흔들려요. 방향을 잃은 카드가 함께 나오면, 말을 꺼낸 뒤 상대 반응에 휩쓸려 원래 결정을 흐릴 수 있으니 문장을 짧게 잡아야 합니다."
      ];
      return `${index + 1}번째 흐름은 ${withKoreanParticle(theme.name, "이", "가")} 가진 ‘${theme.keyword}’에서 시작돼요. ${resignationDirections[index]}`;
    }
    const direction = cards[index]?.isReversed
      ? "성급하게 밀어붙이기보다 막히는 이유를 먼저 살펴야 해요. 겉으로는 멈춘 것처럼 보여도, 실제로는 아직 정리되지 않은 마음이나 현실 변수가 남아 있습니다."
      : "지금 할 수 있는 작은 행동으로 흐름을 움직여도 괜찮아요. 다만 이 카드는 한 번에 크게 바꾸기보다, 상대나 상황이 어떻게 반응하는지 보면서 다음 단계를 잡으라고 말합니다.";
    return `${index + 1}번째 흐름은 ${withKoreanParticle(theme.name, "이", "가")} 가진 ‘${theme.keyword}’가 핵심이에요. ${direction} 지금 질문에서는 단순한 결과보다, 질문자님이 어디서 망설이고 어디서 힘을 써야 하는지가 더 분명해집니다.`;
  });
  const totalFlow = category === "퇴사 전달"
    ? resignationTone.flow
    : `${withKoreanParticle(themes[0].name, "은", "는")} 현재 질문의 출발점을 잡아 주고, ${withKoreanParticle(themes[1].name, "은", "는")} 흐름을 움직이는 핵심을 짚어요. 마지막 ${withKoreanParticle(themes[2].name, "은", "는")} 오늘 취할 수 있는 현실적인 태도를 알려 줍니다. 세 장의 흐름은 급하게 결론을 내리기보다, 지금 가장 덜 후회할 선택을 차분히 고르라는 뜻입니다.`;
  const caution = category === "퇴사 전달"
    ? resignationTone.caution
    : `${withKoreanParticle(themes[1].name, "이", "가")} 핵심에 놓여 있어서, 바라는 결과만 근거로 판단하면 흐름이 흐려질 수 있어요. 아직 드러나지 않은 부분을 사실처럼 단정하면 선택이 흔들릴 수 있습니다.`;
  let actionAdvice = "지금 필요한 조언은 결론을 미루라는 뜻이 아니라, 말과 행동의 무게를 조절하라는 쪽이에요. 오늘 바로 할 수 있는 일부터 작게 움직이고, 반응이 돌아오면 그때 다음 단계를 정하세요. 특히 지금은 ‘내가 원하는 답’에 맞춰 상황을 해석하기보다, 실제로 돌아오는 반응의 온도를 보고 판단하는 게 더 안전합니다.";
  if (category === "퇴사 전달") {
    actionAdvice = resignationTone.advice;
  }
  if (category === "속마음" || category === "연애" || category === "재회") {
    actionAdvice = category === "속마음"
      ? feelingTone.advice
      : `앞으로는 상대를 몰아붙이기보다 반응의 결을 보는 게 좋아요. 이 사람 자존심이 좀 세네요. 마음이 있어도 먼저 티 내면 지는 느낌을 싫어해서, 태도가 한 박자 늦게 나올 수 있어요.`;
  }
  const followUpQuestions = buildLocalFollowUpQuestions(category, question, themes, roles);

  return {
    oneLineConclusion,
    conclusion: oneLineConclusion,
    combinedFlow: totalFlow,
    totalFlow,
    caution,
    actionAdvice,
    temperature: 50,
    cards: themes.map((theme, index) => ({
      role: roles[index] || `${index + 1}번째 카드`,
      cardName: theme.name,
      orientation: theme.orientation,
      coreMeaning: `${theme.name}의 핵심 의미는 ‘${theme.keyword}’입니다.`,
      contextualMeaning: cardMeanings[index],
    })),
    card1Meaning: cardMeanings[0],
    card2Meaning: cardMeanings[1],
    card3Meaning: cardMeanings[2],
    followUpQuestions,
    question,
    questionCategory: category,
  };
}

function createLocalDeepReading(cards: any[], question = "", isOpenQuestion = false) {
  const themes = cards.map(localCardTheme);
  const reversedCount = cards.filter((card) => card.isReversed).length;
  if (isOpenQuestion) {
    return {
      premiumConclusion: `질문하신 “${question}”에 대해서는 가능성을 열어 두되, 바로 결론 내리기보다 조건을 한 번 더 확인하는 편이 좋아요. ${themes[0].name}이 현재 출발점을, ${themes[1].name}이 놓치기 쉬운 변수를 보여 줍니다. ${themes[2].name}의 조언처럼 가장 작은 행동으로 먼저 확인해 보세요.`,
      partnerEmotionSituation: `${withKoreanParticle(themes[0].name, "은", "는")} 지금 상황에서 이미 알고 있는 사실과 감정적으로 바라는 결과를 구분하라고 말해요. ${withKoreanParticle(themes[0].keyword, "이", "가")} 현재 판단의 출발점입니다.`,
      actionPossibility: `${withKoreanParticle(themes[2].name, "을", "를")} 보면 앞으로의 가능성은 ${cards[2]?.isReversed ? "준비가 덜 된 부분을 보완한 뒤 열릴 가능성이 커요." : "작게 실행해 보면서 점차 선명해질 가능성이 커요."}`,
      relationshipBarrier: `${withKoreanParticle(themes[1].name, "이", "가")} 보여 주는 ‘${themes[1].keyword}’이 현재 흐름을 막는 핵심 조건이에요. 이 부분을 확인하지 않으면 같은 고민이 반복될 수 있어요.`,
      expectedResponse: `지금 선택을 작게 시험해 보면 생각보다 빠르게 현실적인 반응을 확인할 수 있어요. 다만 첫 결과 하나를 최종 결론으로 받아들이지는 마세요.`,
      detailedAdvice: `오늘 할 수 있는 확인 행동을 하나만 정하고, 그 결과를 기록해 보세요. 기대했던 결과와 실제 결과가 다르면 계획을 줄이거나 순서를 바꾸는 방식으로 조정하는 게 좋아요.`,
    };
  }
  return {
    premiumConclusion: `세 장을 함께 놓고 보면 ${themes[0].name}의 감정이 ${themes[1].name}에서 한 번 막힌 뒤, ${withKoreanParticle(themes[2].name, "을", "를")} 통해 행동의 방향을 찾는 구조예요. 그러니 이 관계를 단순히 희망적이다, 아니다로 자르기는 어렵습니다. 감정의 가능성은 있지만 ${withKoreanParticle(themes[1].keyword, "을", "를")} 외면하면 같은 자리에서 반복될 수 있어요. 관계를 살리고 싶다면 상대를 설득하는 것보다 두 사람이 실제로 감당할 수 있는 속도를 확인하는 일이 먼저입니다.`,
    partnerEmotionSituation: `${withKoreanParticle(themes[0].name, "은", "는")} 상대가 ${withKoreanParticle(themes[0].keyword, "을", "를")} 느끼고 있음을 보여 줘요. ${cards[0]?.isReversed ? "그런데 이 감정을 인정하는 순간 책임져야 할 것이 생길까 봐 스스로 눌러 두고 있어요." : "적어도 현재는 감정을 완전히 외면하기보다 질문자님과의 관계가 자신에게 어떤 의미인지 살피고 있어요."}`,
    actionPossibility: `${withKoreanParticle(themes[2].name, "을", "를")} 보면 행동은 ${cards[2]?.isReversed ? "마음보다 늦게 나올 가능성이 큽니다. 연락하고 싶어도 타이밍을 놓치거나 짧게 반응한 뒤 다시 물러날 수 있어요." : "작지만 알아볼 수 있는 형태로 나타날 가능성이 있습니다. 먼저 안부를 묻거나 대화를 이어 가려는 태도가 그 신호예요."}`,
    relationshipBarrier: `${withKoreanParticle(themes[1].name, "이", "가")} 가운데 있다는 점이 핵심이에요. ${withKoreanParticle(themes[1].keyword, "이", "가")} 두 사람 사이의 실제 장벽이고, ${reversedCount >= 2 ? "서로 솔직하지 못해서라기보다 솔직해진 뒤 감당할 결과를 먼저 걱정하는 상태예요." : "말하지 않은 기대치를 상대가 알아주길 바라는 순간 오해가 커질 수 있어요."}`,
    expectedResponse: `질문자님이 압박 없이 다가가면 상대도 대화를 완전히 닫지는 않을 가능성이 있어요. 다만 첫 반응의 온도만 보고 관계 전체를 평가하지 마세요. 이 조합은 한 번의 강한 표현보다 여러 번의 일관된 태도에 더 솔직하게 반응해요.`,
    detailedAdvice: `상담자로서 권하고 싶은 건 ‘상대의 마음을 알아내기 위한 연락’과 ‘내 마음을 건강하게 표현하는 연락’을 구분하는 일이에요. 전자는 답이 늦을수록 불안을 키우지만, 후자는 내가 할 말을 차분히 전한 뒤 상대의 선택을 기다릴 수 있게 해 줍니다. 연락한다면 한 번에 하나의 주제만 꺼내고, 답장이 없을 때 추가 설명을 보내지 마세요. 그리고 상대의 말보다 앞으로 일주일 동안 실제로 시간을 내는지, 질문을 돌려주는지, 약속을 지키는지를 보세요.`,
  };
}

// 3. GET /api/health
app.get("/api/health", (req, res) => {
  const currentKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const isConfigured = !!(currentKey && currentKey !== "MY_GEMINI_API_KEY" && currentKey.trim() !== "" && currentKey !== "undefined" && currentKey !== "null");
  
  if (isDev) {
    console.log(`[DIAGNOSTICS] Health checking... App state is server: running, aiConfigured: ${isConfigured}`);
  }

  return res.json({
    success: true,
    server: "running",
    aiConfigured: isConfigured,
    model: GEMINI_MODEL,
    intentModel: GEMINI_INTENT_MODEL,
    useResponseSchema: GEMINI_USE_RESPONSE_SCHEMA,
    useJsonMime: GEMINI_USE_JSON_MIME,
    thinkingBudget: GEMINI_THINKING_BUDGET,
    version: "release-candidate-no-test-token-20260805-1"
  });
});

// REST route for Tarot Cards Reading interpretation
app.post("/api/tarot/read", async (req, res) => {
  const startTime = Date.now();
  let recoverableReading: any = null;
  try {
    const {
      menuId,
      menuTitle,
      cards,
      partnerNickname,
      relationship,
      lastContact,
      contactStatus,
      situation,
      question,
      questionCategory,
      spreadRoles,
      mockErrorType
    } = req.body;
    const isOpenQuestion = menuId?.startsWith("question-");
    const isDailyTemperature = menuId === "daily-temperature";
    const rawQuestion = question || situation || "";
    const inferredCategory = isOpenQuestion
      ? await classifyQuestionIntentWithGemini(rawQuestion, questionCategory || menuTitle || "일반 흐름")
      : (questionCategory || menuTitle || "일반 흐름");
    const effectiveSpreadRoles = isOpenQuestion ? [] : spreadRoles;
    const answerGuard = isOpenQuestion ? buildQuestionAnswerGuard(rawQuestion, inferredCategory) : "";

    // Error Simulation Trigger (Required in Requirement 6)
    if (isDev && process.env.ENABLE_MOCK_ERRORS === "true" && mockErrorType) {
      console.log(`[DIAGNOSTICS] Simulating mock error: ${mockErrorType}`);
      if (mockErrorType === "MISSING_API_KEY") {
        return sendError(res, 530, "AI_NOT_CONFIGURED", "API_NOT_CONFIGURED: Gemini API 키가 누락되었습니다. AI Studio Secrets 패널에서 올바른 키를 설정하여 주십시오.", false);
      } else if (mockErrorType === "INVALID_API_KEY") {
        return sendError(res, 400, "API_KEY_INVALID", "API_KEY_INVALID: 입력하신 Gemini API 키가 유효하지 않습니다. 올바른 키 값인지 확인해 주세요.", true);
      } else if (mockErrorType === "EMPTY_RESPONSE") {
        throw new Error("AI_RESPONSE_EMPTY");
      } else if (mockErrorType === "MISSING_FIELD") {
        throw new Error("VALIDATION_FAILED:expectedResponse");
      } else if (mockErrorType === "JSON_PARSE_ERROR") {
        throw new Error("AI_RESPONSE_INVALID");
      } else if (mockErrorType === "TIMEOUT") {
        await new Promise(resolve => setTimeout(resolve, 31000));
        throw new Error("AI_TIMEOUT");
      } else if (mockErrorType === "RATE_LIMIT") {
        throw new Error("API_LIMIT_EXCEEDED: Quota exceeded for model on 429 rate limits.");
      }
    }

    // In production, never show local fallback readings for AI failures.
    if (isKeyInvalid) {
      return sendError(res, 530, "AI_NOT_CONFIGURED", "Gemini API 키가 설정되지 않았습니다. AI 리딩을 불러올 수 없어요.", false);
    }

    // Input Validation
    if (!Array.isArray(cards) || (isDailyTemperature ? cards.length < 1 : cards.length !== 3)) {
      return sendError(
        res,
        400,
        "INVALID_REQUEST",
        isDailyTemperature
          ? "카드가 올바르게 선택되지 않았습니다. 온도를 볼 카드 한 장을 다시 골라주세요."
          : "카드가 올바르게 선택되지 않았습니다. 3장을 다시 골라주세요.",
        false
      );
    }

    const ai = getGeminiClient();
    if (!ai) {
      return sendError(res, 503, "AI_NOT_CONFIGURED", "AI 리딩 서비스 설정이 완료되지 않았습니다.", false);
    }

    if (isDailyTemperature) {
      const deckCard = TAROT_DECK.find((card: any) => Number(card.id) === Number(cards[0]?.id)) || {};
      const selectedCard = {
        ...(cards[0] || {}),
        ...deckCard,
        isReversed: Boolean(cards[0]?.isReversed)
      };
      const direction = selectedCard.isReversed ? "역방향" : "정방향";
      const cardName = selectedCard.nameKr || selectedCard.name || selectedCard.cardName || "선택한 카드";
      const cardKeyword = selectedCard.keywordKr || selectedCard.coreMeaning || "";
      const reversedMeaning = selectedCard.reversedMeaningKr || "";
      const temperaturePrompt = `
너는 "타로 : 우리 사이 온도"의 연애 타로 상담사다.
오늘 그 사람과 질문자님의 사이 온도를 카드 한 장으로 짧게 읽어라.

[중요 말투]
- 무조건 "질문자님"이라고 부른다. "당신"은 절대 쓰지 않는다.
- 부정적인 단어로 먼저 꺾지 말고, 오늘 살아 있는 온기와 조심스러운 지점을 자연스럽게 말한다.
- 딱딱한 분석어, 보고서 말투, 비교문, 금지어 목록, 규칙 설명은 절대 출력하지 않는다.
- 카드 이름을 과하게 설명하지 말고, 실제 상담사가 말하듯 자연스러운 구어체로 쓴다.
- 단정은 피하되 애매하게 흐리지 말고, 오늘의 분위기를 분명히 말한다.

[입력]
- 질문: "${rawQuestion || "오늘, 그 사람과 나의 온도는 몇 도일까요?"}"
- 카드: ${cardName}
- 방향: ${direction}
- 카드 키워드: ${cardKeyword}
- 역방향 의미: ${reversedMeaning}

[출력 규칙]
JSON 객체 하나만 반환한다.
temperature는 35.0~39.8 사이의 소수점 한 자리 숫자로 준다.
oneLineConclusion은 "오늘 우리 사이 온도는 37.3도예요. ..." 형식의 짧은 결론 한 문장으로 쓴다.
card1Meaning은 정확히 7줄로 쓴다. 각 줄은 줄바꿈으로 구분한다.
card1Meaning에는 오늘의 온도 해석만 담는다.
card2Meaning은 "그 사람이 오늘 보일 수 있는 모습"을 4줄로 쓴다.
caution은 "오늘 조심할 점"을 3줄로 쓴다.
actionAdvice는 "오늘 해보면 좋은 행동"을 3줄로 쓴다.
followUpQuestions는 온도 리딩 뒤에 이어서 보고 싶은 자연스러운 질문 3개를 쓴다.

필드:
{
  "oneLineConclusion": "짧은 결론",
  "temperature": "37.3",
  "card1Meaning": "7줄 온도 해석",
  "card2Meaning": "4줄 상대 모습",
  "caution": "3줄 주의점",
  "actionAdvice": "3줄 행동 조언",
  "followUpQuestions": ["질문1", "질문2", "질문3"]
}`;

      const temperatureSchema = {
        type: Type.OBJECT,
        properties: {
          oneLineConclusion: { type: Type.STRING },
          temperature: { type: Type.STRING },
          card1Meaning: { type: Type.STRING },
          card2Meaning: { type: Type.STRING },
          caution: { type: Type.STRING },
          actionAdvice: { type: Type.STRING },
          followUpQuestions: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["oneLineConclusion", "temperature", "card1Meaning", "card2Meaning", "caution", "actionAdvice", "followUpQuestions"]
      };

      const temperatureResponse = await withTimeout(
        ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: temperaturePrompt,
          config: {
            systemInstruction: "타로 온도 리딩을 짧고 자연스러운 한국어 구어체 JSON으로만 답한다.",
            responseMimeType: "application/json",
            responseSchema: temperatureSchema,
            temperature: 0.55,
            maxOutputTokens: 1600
          }
        }),
        30000,
        "AI_TIMEOUT"
      );

      const temperatureRawText = temperatureResponse.text;
      if (!temperatureRawText || temperatureRawText.trim() === "") {
        throw new Error("AI_RESPONSE_EMPTY");
      }

      const temperatureResult = extractJsonObject(temperatureRawText) || extractTemperatureReadingText(temperatureRawText);
      if (!temperatureResult) {
        if (isDev) {
          console.warn("Gemini daily temperature raw text parse failed. Raw text was:", temperatureRawText);
        }
        throw new Error("AI_RESPONSE_INVALID");
      }

      const temperatureValue = Number(String(temperatureResult.temperature).replace(/[^\d.]/g, ""));
      if (!Number.isFinite(temperatureValue)) {
        throw new Error("AI_RESPONSE_INCOMPLETE");
      }

      const meaningText = String(temperatureResult.card1Meaning || "")
        .replace(/\r/g, "")
        .replace(/([요죠다]\.)\s+/g, "$1\n")
        .trim();
      let meaningLines = meaningText
        .split(/\n+/)
        .map((line: string) => line.replace(/^Line\s*\d+\s*:\s*/i, "").trim())
        .filter(Boolean)
        .filter((line: string) => !isInstructionEchoLine(line))
        .map((line: string) => softenReportTone(line))
        .filter((line: string) => !isIncompleteReadingLine(line))
        .slice(0, 7);

      if (meaningLines.length === 0) {
        meaningLines = buildSafeDailyTemperatureLines(temperatureValue, cardName, cardKeyword);
      } else if (meaningLines.length < 7) {
        const safeLines = buildSafeDailyTemperatureLines(temperatureValue, cardName, cardKeyword);
        meaningLines = Array.from(new Set([...meaningLines, ...safeLines])).slice(0, 7);
      }

      let oneLineConclusion = String(temperatureResult.oneLineConclusion || "").trim();
      oneLineConclusion = isInstructionEchoLine(oneLineConclusion) ? "" : softenReportTone(oneLineConclusion);
      if (!oneLineConclusion) {
        oneLineConclusion = buildSafeDailyTemperatureLines(temperatureValue, cardName, cardKeyword)[0] + " " + buildSafeDailyTemperatureLines(temperatureValue, cardName, cardKeyword)[1];
      }

      const temperatureExtras = buildSafeDailyTemperatureExtras(temperatureValue, cardName);
      const dailyBehavior = buildDailyTemperatureSectionText((temperatureResult as any).card2Meaning, temperatureExtras.behavior, 4);
      const dailyCaution = buildDailyTemperatureSectionText((temperatureResult as any).caution, temperatureExtras.caution, 3);
      const dailyAdvice = buildDailyTemperatureSectionText((temperatureResult as any).actionAdvice, temperatureExtras.advice, 3);
      const dailyFollowUpQuestions = Array.isArray((temperatureResult as any).followUpQuestions)
        ? (temperatureResult as any).followUpQuestions
            .map((item: unknown) => String(item || "").trim())
            .filter(Boolean)
            .slice(0, 3)
        : [];

      const parsedResult = {
        oneLineConclusion,
        questionCategory: "오늘의 온도 리딩",
        card1Meaning: meaningLines.join("\n"),
        card2Meaning: dailyBehavior,
        card3Meaning: "",
        totalFlow: "",
        caution: dailyCaution,
        actionAdvice: dailyAdvice,
        followUpQuestions: dailyFollowUpQuestions.length > 0
          ? dailyFollowUpQuestions
          : [
              "그 사람의 진짜 속마음도 확인해볼까요?",
              "오늘 먼저 연락해도 괜찮을까요?",
              "우리 관계는 앞으로 어떻게 흘러갈까요?"
            ],
        temperature: Number(temperatureValue.toFixed(1)),
        cards: [
          {
            role: "오늘의 온도를 보여주는 카드",
            cardName,
            orientation: direction,
            coreMeaning: cardKeyword || cardName,
            contextualMeaning: meaningLines.join("\n")
          }
        ]
      };

      recoverableReading = parsedResult;
      return res.json({ success: true, method: "gemini", data: parsedResult });
    }

    const systemInstruction =
      (isOpenQuestion
        ? `"타로 : 우리 사이 온도"의 연애 전문 타로 상담사처럼 답해 주세요.
질문 유형은 '${inferredCategory}'예요. 질문자님의 질문 "${rawQuestion}"에 첫 문장부터 바로 답해 주세요.
상대의 속마음, 호감, 연락 흐름, 재회 가능성, 썸의 온도, 관계의 방향을 질문 의도에 맞춰 상담하듯 말해 주세요.
질문 원문에 없는 주제로 답을 돌리지 마세요. 연락을 묻지 않았다면 연락 여부로 결론을 바꾸지 말고, 질문자님이 궁금해한 마음/호감/관계 온도에 먼저 답하세요.
카드가 미래를 확정한다고 말하지 말고, 카드의 의미와 정방향/역방향을 근거로 가능성과 확인할 점을 설명해 주세요.\n`
        : `"타로 : 우리 사이 온도"의 전문 연애 타로 상담사처럼, 일대일로 대화하듯 편하게 답해 주세요.\n`) +
      "호칭은 무조건 '질문자님'만 사용하세요. '당신', '사용자', '내담자', '질문자' 단독 표현은 절대 쓰지 마세요.\n" +
      "절대 딱딱한 보고서 양식이나 과장되고 예스러운 미사여구를 피하고, 친근하고 따뜻한 구어체 존댓말('~해요', '~느껴져요', '~좋아요' 등)로 작성하세요. '~입니다', '~합니다', '~하십시오', '~습니다'를 반복하지 말고 실제 상담사가 말하듯 자연스럽게 말맛을 섞으세요.\n\n" +
      
      "## 금지 키워드 및 개념 차단\n" +
      "다음 단어나 표현은 천편일률적인 기계적 생성의 징후이므로 사용을 절대 금지합니다:\n" +
      "- '에세이', '조율', '처방', '감정 솔루션', '마음 정리 보고서'\n" +
      "- '기류', '해독', '심적 진동', '상징적 내막', '전방위', '매만지다', '뼈아픈 조언', '조율수필', '소통 기류', '인연의 끈', '무드'\n" +
      "- 단답형 분석 표현: '방어 기제', '관계 진전', '종합 분석', '결과적으로', '감정이 존재합니다'\n" +
      "- 보고서 말투: '시사합니다', '암시합니다', '나타냅니다', '의미합니다', '분석됩니다'\n" +
      "- 딱딱한 이해관계 표현: '손득 계산', '손익 계산', '득실 계산', '상황 계산', '계산적' 같은 말은 쓰지 마십시오. 대신 '부담을 먼저 살피는 모습', '조심스럽게 재는 태도'처럼 구어체로 풀어 쓰십시오.\n" +
      "- 금지 표현: '관망', '식었다기보다', '차갑다/차가운', '~에 가까워요/가깝습니다', 'A는 B보다'식 반복 비교문을 쓰지 마십시오.\n" +
      "- 반복 어미/동사: '잡아내요', '짚어내요', '보여요'를 카드마다 같은 위치에서 반복하지 마십시오. 카드별로 '드러나요', '읽혀요', '느껴져요', '먼저 올라와요', '걸려 있어요', '흐름이 강해요'처럼 말맛을 바꾸십시오.\n" +
      "- 다음 상투적인 문구나 권유 문장:\n" +
      "  * '마음은 있지만 조심스럽다'\n" +
      "  * '완전히 끝난 것은 아니다'\n" +
      "  * '가볍게 연락해 보라'\n" +
      "  * '조금 더 기다려야 한다'\n" +
      "  * '천천히 관계를 이어가라'\n" +
      "  * '상대도 질문자님을 생각하고 있어요'\n\n" +

      "## 리딩 가이드라인 및 분량 규칙 (극히 중요 - 반드시 준수)\n" +
      "1. **oneLineConclusion (한 줄 결론)**: 질문에 대한 전체 요점을 관통하는 선명한 한 문장 결론입니다. (공백 제외 최소 20자 이상)\n" +
      "2. **cards (배열 카드 세 장에 대한 분석 리스트)**: 반드시 다음 필드들을 포함해 완벽한 해석을 채워주세요.\n" +
      "   - role: 이번 배치에서 카드가 의미하는 세부 역할. 질문형 리딩에서는 고정 배열명을 쓰지 말고 질문 원문에 맞춰 직접 붙이세요.\n" +
      "   - cardName: 카드 명칭 (예: 'The Fool', 'Three of Swords' 등)\n" +
      "   - orientation: '정방향' 또는 '역방향'\n" +
      "   - coreMeaning: 해당 카드 고유의 보편적 학술 핵심 키워드와 성질 (생색내거나 수려하지 않게 담백하게 1~2문장으로 설명, 공백 제외 최소 20자 이상)\n" +
      "   - contextualMeaning: 질문자의 현실(닉네임: " + (partnerNickname || "그 사람") + ", 관계: " + (relationship || "애매한 사이") + "), 접점/연락(" + (lastContact || "없음") + "), 대화 상태(" + (contactStatus || "상태 없음") + "), 구체적인 사연(" + (situation || "특별히 기재하지 않음") + ")을 카드의 본질과 배열에 대조하여 해석한 상황별 집중 해설입니다.\n" +
      "     * 분량: 반드시 5문장으로 작성하십시오. 각 문장은 줄바꿈(\\n)으로 분리해 화면에서 5줄처럼 보이게 하세요.\n" +
      "     * 1문장째는 현재 상황의 핵심을 바로 말하고, 2문장째는 질문자님의 질문에 대한 직접 판단, 3문장째는 카드가 건드리는 숨은 변수, 4문장째는 바로 찔리는 현실적 포인트, 5문장째는 다음 흐름을 말해 주세요.\n" +
      "     * 세 카드 모두 같은 문장 구조로 시작하지 마십시오. 예: '이 카드는 ~', '~가 보여요', '~를 잡아내요' 반복 금지. 실제 상담사가 즉석에서 말하듯 문장 길이와 시작 방식을 섞으십시오.\n" +
      "3. **combinedFlow (전체 연결 흐름)**: 세 장의 카드가 유기적인 유기체처럼 서로 호응하며 흘러가는 유려한 입체 스토리텔링 전체 연결 흐름을 말합니다.\n" +
      "   - 분량: 카드 사이의 원인과 결과를 3~4문장, 150~230자 안에서 서술하십시오.\n" +
      "4. **caution (주의할 점)**: 관계를 그르칠 수 있는 경고 및 성급한 판단에 대한 지적 등을 다룹니다.\n" +
      "   - 분량: 같은 뜻을 반복하지 말고 반드시 3문장으로 작성하십시오. 각 문장은 줄바꿈(\\n)으로 분리하세요.\n" +
      "5. **actionAdvice (행동 조언)**: 무작정 미루거나 기다리라거나 하는 공허한 빈말이 아니라, 질문자님이 현실에서 관계를 대하고 실행 가능한 행동 방향을 서술합니다. 질문자님이 상대에게 보낼 완성형 메시지나 직접적인 대사를 절대 작성하지 마세요. 연락의 방향, 말투의 무게, 감정 표현 정도만 조언하세요. 카카오톡/문자 예시(예: '오늘 뭐 했어?', '잘 지내?', '우리 관계에 대해 이야기해보자' 등 일절 금지)를 절대 작성하지 않아야 하며, 먼저 연락하는 것이 좋은지, 연락한다면 가볍게 할지 진지하게 할지, 감정 표현을 어느 정도로 할지, 상대의 답장이 짧거나 늦을 때 어떻게 반응할지, 관계를 확인하는 질문을 해도 되는지, 지금 기다리는 것이 좋은지, 거리와 속도를 어떻게 조절할지 등 행동 방향과 강도를 서술해 주세요.\n" +
      "   - 분량: 행동 방향만 반드시 3문장으로 작성하십시오. 각 문장은 줄바꿈(\\n)으로 분리하세요.\n\n" +

      "## 역방향(Reversed) 해석 상세화 규칙\n" +
      "역방향은 '단순 지연'이나 '역류'로 축소하거나 생략하지 마시고, 상대방이 느끼는 현실적인 감정 과부하, 자존심 때문에 반대로 표출하는 수동 공격성, 관계에 가로막힌 외적 번뇌 등을 상황에 맞추어 생생히 풀어서 기술하십시오.";

    // Enrich input cards with full metadata from TAROT_DECK
    const enrichedCards = cards.map((card: any) => {
      const fullCard = TAROT_DECK.find(c => c.id === card.id) || {};
      return { ...fullCard, ...card };
    });

    const formattedCardsText = enrichedCards.map((card: any, idx: number) => {
      const role = effectiveSpreadRoles && effectiveSpreadRoles[idx] ? effectiveSpreadRoles[idx] : `역할 ${idx + 1}`;
      const roleLine = isOpenQuestion
        ? "   - 배치 역할: 질문 원문과 현재 상황, 세 카드 조합을 보고 직접 정하세요. '현재 나의 연애 상태', '다가오는 인연의 특징', '인연을 맞이하는 조언' 같은 고정 배열명을 그대로 쓰지 마세요."
        : `   - 배치 역할: "${role}"`;
      const direction = card.isReversed ? "역방향 (Reversed)" : "정방향 (Upright)";
      const generalMeaning = card.keywordKr || "데이터 없음";
      const reversedMeaning = card.reversedMeaningKr || "데이터 없음";
      return `${idx + 1}번째 카드: [${card.nameKr}] (${direction})
${roleLine}
   - 정방향 고유 핵심 의미: "${generalMeaning}"
   - 역방향 고유 핵심 의미: "${reversedMeaning}"`;
    }).join("\n\n");

    const promptPayLoad = `
${GEMINI_TAROT_TRAINING}
${answerGuard}

[질문자님 질문 기반 타로 리딩 의뢰 요약]
- 메뉴 명칭 및 주제: ${menuTitle} (${menuId})
- 질문자님이 직접 입력한 질문: "${rawQuestion || '지정되지 않음'}"
- 자동 분류된 질문 유형: ${inferredCategory}
- 상대방 대상 닉네임: ${partnerNickname || '그 사람'}
- 과거 인연 상태: ${relationship || '애매한 사이'}
- 최근 연락/접점 빈도: ${lastContact || '없음'}
- 현재 대화 교류 상태: ${contactStatus || '상태 없음'}

[고정 투입 타로 배열 3장]
${formattedCardsText}

[출력 제약 가이드]
1. JSON 양식을 철저히 지키며 모든 키 값은 정확해야 합니다.
2. 각 카드의 contextualMeaning(상황별 해석)은 반드시 5문장으로 작성해야 합니다. 각 문장은 줄바꿈으로 분리하고, 짧은 3줄 답변은 실패입니다.
2-1. role은 질문 원문에 맞춰 그때그때 새로 정합니다. 질문형 리딩에서 '현재 나의 연애 상태', '다가오는 인연의 특징', '인연을 맞이하는 조언' 같은 고정 배열명을 기계적으로 쓰지 마세요.
3. combinedFlow(세 카드의 연결 흐름)는 반복 없이 핵심 인과를 3~4문장(150~230자)으로 작성해야 합니다.
4. 카드별 해석이나 combinedFlow 안에 "이 사람 자존심이 좀 세네요"처럼 바로 찔리는 직관 문장을 자연스럽게 1개 이상 섞어 주세요.
5. "이 사람 자존심이 좀 세네요", "상대가 끌리면서도 먼저 다가오면 지는 느낌을 싫어해요"처럼 연애 상황에서 찔리는 직관 문장을 카드 흐름에 맞게 자연스럽게 섞어 주세요.
6. caution은 반드시 3문장, actionAdvice도 직접적인 대사 없이 행동 방향만 반드시 3문장으로 작성해 주세요. 두 항목 모두 문장마다 줄바꿈해 주세요.
7. followUpQuestions는 질문자님이 바로 다음으로 보고 싶어질 만한 질문 3개를 구체적으로 작성해 주세요.`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        oneLineConclusion: { type: Type.STRING, description: "전설적 타로 마스터가 전하는 깊이 있고 선명한 한 줄 결론" },
        combinedFlow: { type: Type.STRING, description: "세 장 카드의 인과 관계를 반복 없이 3~4문장으로 연결한 흐름" },
        caution: { type: Type.STRING, description: "질문자가 피해야 할 행동을 짚는 3문장의 주의점" },
        actionAdvice: { type: Type.STRING, description: "완성형 메시지나 직접 대사 없이 행동 방향만 제안하는 3문장의 조언" },
        temperature: { type: Type.INTEGER, description: "0에서 100 사이의 정수 값으로 산출되는 두 사람 간의 교감 온도 수치" },
        cards: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              role: { type: Type.STRING, description: "이번 타로 배열에서 이 카드가 가진 해석적 역할 (예: '겉으로 보이는 태도', '실제 속마음' 등)" },
              cardName: { type: Type.STRING, description: "영문 본래 타로 카드 이름" },
              orientation: { type: Type.STRING, description: "'정방향' 또는 '역방향'" },
              coreMeaning: { type: Type.STRING, description: "타로 카드의 기본 연애학적 학술 핵심 의미 (1~2문장)" },
              contextualMeaning: { type: Type.STRING, description: "질문자의 맥락에 맞춘 카드별 해석 5문장" }
            },
            required: ["role", "cardName", "orientation", "coreMeaning", "contextualMeaning"]
          },
          description: "세 장의 뽑은 카드에 일치하게 총 3개의 성실히 분석된 요소를 배열에 담아야 함"
        },
        followUpQuestions: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "독해가 완료된 후 추가로 물어볼 만한 심층적인 후속 연관 타로 질문 (최대 3개)"
        }
      },
      required: ["oneLineConclusion", "combinedFlow", "caution", "actionAdvice", "temperature", "cards", "followUpQuestions"]
    };

    // Call Gemini with custom timeout wrapper. Standard readings are longer now.
    const response = await withTimeout(
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: promptPayLoad,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          temperature: 0.60, // 무료 리딩 0.5~0.65 권장
          maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS
        }
      }),
      60000,
      "AI_TIMEOUT"
    );

    // 9. Gemini 응답 안전 처리
    const rawText = response.text;
    if (!rawText || rawText.trim() === "") {
      throw new Error("AI_RESPONSE_EMPTY");
    }

    let parsedResult: any;
    parsedResult = extractJsonObject(rawText);
    if (!parsedResult) {
      console.warn("Gemini raw text parse failed. Retrying once with stricter JSON instructions. Raw text was:", rawText);

      const retryPromptPayload = `
${GEMINI_TAROT_TRAINING}
${answerGuard}

[JSON 재생성 요청]
이전 응답이 중간에서 끊겼습니다. 아래 정보만 보고 JSON 객체 하나만 다시 생성하세요.
마크다운, 코드블록, 설명문은 절대 쓰지 마세요.

- 질문자님이 물어본 질문: "${rawQuestion || '지정되지 않음'}"
- 질문 유형: ${inferredCategory}
- 메뉴: ${menuTitle} (${menuId})
- 카드 3장:
${formattedCardsText}

[출력 규칙]
1. oneLineConclusion은 질문에 바로 답하는 한 문장입니다.
2. cards는 정확히 3개입니다.
3. 각 contextualMeaning은 5문장으로 쓰되, 각 문장을 짧고 선명하게 작성하고 줄바꿈으로 나누세요.
4. combinedFlow는 3문장으로만 작성하세요.
5. caution은 3문장, actionAdvice는 3문장으로 작성하세요.
6. followUpQuestions는 정확히 3개입니다.
7. 모든 문자열을 닫고 JSON 마지막 중괄호까지 반드시 완성하세요.`;

      const retryResponse = await withTimeout(
        ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: retryPromptPayload,
          config: {
            systemInstruction: systemInstruction,
            responseMimeType: "application/json",
            responseSchema: responseSchema,
            temperature: 0.35,
            maxOutputTokens: Math.max(GEMINI_MAX_OUTPUT_TOKENS, 4200)
          }
        }),
        60000,
        "AI_TIMEOUT"
      );

      const retryRawText = retryResponse.text;
      if (!retryRawText || retryRawText.trim() === "") {
        throw new Error("AI_RESPONSE_EMPTY");
      }

      parsedResult = extractJsonObject(retryRawText);
      if (!parsedResult) {
        console.error("Gemini retry raw text parse failed. Raw text was:", retryRawText);
        throw new Error("AI_RESPONSE_INVALID");
      }
    }

    // Map properties from card array to legacy fallback properties inside parsedResult for safe backward compatibility!
    if (parsedResult && Array.isArray(parsedResult.cards) && parsedResult.cards.length === 3) {
      parsedResult.card1Meaning = parsedResult.cards[0].contextualMeaning;
      parsedResult.card2Meaning = parsedResult.cards[1].contextualMeaning;
      parsedResult.card3Meaning = parsedResult.cards[2].contextualMeaning;
      parsedResult.totalFlow = parsedResult.combinedFlow;
      parsedResult.conclusion = parsedResult.oneLineConclusion;
      
      // Menu specific backwards-compatible mapping
      if (menuId === 'dating-luck') {
        parsedResult.todayEmotion = parsedResult.cards[0].contextualMeaning;
        parsedResult.incomingPersonOrEvent = parsedResult.cards[1].contextualMeaning;
      } else if (menuId === 'inner-mind') {
        parsedResult.outwardAttitude = parsedResult.cards[0].contextualMeaning;
        parsedResult.realFeeling = parsedResult.cards[1].contextualMeaning;
        parsedResult.futureAction = parsedResult.cards[2].contextualMeaning;
        parsedResult.hiddenEmotion = parsedResult.combinedFlow;
      } else if (menuId === 'can-contact') {
        parsedResult.contactRecommendation = parsedResult.temperature > 50 ? "짧고 가볍게 연락하는 정도가 좋아요" : "오늘은 먼저 연락하지 않는 편이 좋아요";
        parsedResult.partnerCondition = parsedResult.cards[0].contextualMeaning;
        parsedResult.expectedResponse = parsedResult.cards[1].contextualMeaning;
        parsedResult.conversationPossibility = parsedResult.combinedFlow;
        parsedResult.avoidMessage = parsedResult.caution;
        parsedResult.recommendedApproach = parsedResult.actionAdvice;
      } else if (menuId === 'relation-temp') {
        parsedResult.partnerFeeling = parsedResult.cards[0].contextualMeaning;
        parsedResult.relationshipBarrier = parsedResult.cards[1].contextualMeaning;
        parsedResult.nearFuture = parsedResult.cards[2].contextualMeaning;
      } else if (menuId === 'relation-flow') {
        parsedResult.earlyWeek = parsedResult.cards[0].contextualMeaning;
        parsedResult.midWeek = parsedResult.cards[1].contextualMeaning;
        parsedResult.lateWeek = parsedResult.cards[2].contextualMeaning;
        parsedResult.turningPoint = parsedResult.combinedFlow;
      }
    }

    // Apply auto-correction / normalization step
    parsedResult = normalizeTarotResult(menuId, parsedResult, false);

    const completionResult = isOpenQuestion
      ? createLocalQuestionReading(rawQuestion, inferredCategory, enrichedCards, effectiveSpreadRoles || [])
      : createLocalStandardReading(menuId, enrichedCards, effectiveSpreadRoles || [], relationship);

    parsedResult.oneLineConclusion = parsedResult.oneLineConclusion || completionResult.oneLineConclusion;
    parsedResult.conclusion = parsedResult.conclusion || parsedResult.oneLineConclusion || completionResult.conclusion;
    parsedResult.combinedFlow = parsedResult.combinedFlow || parsedResult.totalFlow || completionResult.combinedFlow || completionResult.totalFlow;
    parsedResult.totalFlow = parsedResult.totalFlow || parsedResult.combinedFlow;
    parsedResult.caution = parsedResult.caution || completionResult.caution;
    parsedResult.actionAdvice = parsedResult.actionAdvice || completionResult.actionAdvice;
    parsedResult.temperature = parsedResult.temperature ?? completionResult.temperature ?? 50;
    parsedResult.followUpQuestions = Array.isArray(parsedResult.followUpQuestions) && parsedResult.followUpQuestions.length > 0
      ? parsedResult.followUpQuestions.slice(0, 3)
      : completionResult.followUpQuestions;

    if (!Array.isArray(parsedResult.cards) || parsedResult.cards.length !== 3) {
      parsedResult.cards = completionResult.cards;
    } else {
      parsedResult.cards = parsedResult.cards.map((card: any, index: number) => {
        const fallbackCard: any = completionResult.cards[index] || {};
        return {
          ...fallbackCard,
          ...card,
          role: card?.role || fallbackCard.role,
          cardName: card?.cardName || fallbackCard.cardName,
          orientation: card?.orientation || fallbackCard.orientation,
          coreMeaning: card?.coreMeaning || fallbackCard.coreMeaning,
          contextualMeaning: card?.contextualMeaning || fallbackCard.contextualMeaning,
        };
      });
    }

    parsedResult.card1Meaning = parsedResult.card1Meaning || parsedResult.cards?.[0]?.contextualMeaning || completionResult.card1Meaning;
    parsedResult.card2Meaning = parsedResult.card2Meaning || parsedResult.cards?.[1]?.contextualMeaning || completionResult.card2Meaning;
    parsedResult.card3Meaning = parsedResult.card3Meaning || parsedResult.cards?.[2]?.contextualMeaning || completionResult.card3Meaning;
    parsedResult = normalizeTarotResult(menuId, parsedResult, false);
    recoverableReading = parsedResult;

    // 10. 메뉴별 응답 검증 & 중복 검출
    let validation = validateTarotResult(menuId, parsedResult, false);
    let duplicates = detectDuplicateReadingSections(parsedResult);
    let topicCheck: { offTopic: boolean; reason?: string } = { offTopic: false };

    if (GEMINI_ENABLE_REPAIR && (!validation.isValid || duplicates.hasDuplicates || topicCheck.offTopic)) {
      console.log(`[DIAGNOSTICS] Initial result flawed. Validation valid: ${validation.isValid}, Reason: ${validation.reason}, Duplicate: ${duplicates.hasDuplicates}, OffTopic: ${topicCheck.offTopic ? topicCheck.reason : "no"}. Attempting supplementary repair request...`);
      
      const repairPrompt = `
[심층 타로 리딩 보완 - 중요 기회]
이전 생성 결과에 아래와 같은 분량 부족 또는 정보 누락 문제가 발견되었습니다.
- 불만족 원인: ${validation.reason || "필드 정보 누락"}
- 중복 여부: ${duplicates.hasDuplicates ? "일부 영역 중복 발견됨" : "중복 없음"}
- 동문서답 여부: ${topicCheck.offTopic ? topicCheck.reason : "문제 없음"}

${answerGuard}

[엄격 수리 지침]
1. 각 카드의 contextualMeaning은 반복 없이 반드시 5문장으로 작성하고, 문장마다 줄바꿈해 주세요.
2. combinedFlow는 세 카드의 연결을 3~4문장(150~230자)으로 요약해 주세요.
3. 카드별 해석이나 combinedFlow 안에 바로 찔리는 직관 문장을 자연스럽게 1개 이상 섞어 주세요.
4. caution은 반드시 3문장, actionAdvice도 반드시 3문장으로 구체적으로 작성하고, 문장마다 줄바꿈해 주세요.
5. followUpQuestions는 다음 질문으로 이어지기 좋은 질문 3개를 작성해 주세요.
6. 중복되거나 다른 영역의 문장을 똑같이 복사해서 넣는 일은 절대 없어야 합니다.
7. 질문 원문 "${rawQuestion}"에 직접 답해야 하며, 질문에 없는 주제로 결론을 바꾸면 안 됩니다.

의뢰 사연:
- 메뉴: ${menuTitle}
- 질문: ${rawQuestion} 
- 질문 유형: ${inferredCategory}
- 대상: ${partnerNickname} (${relationship})
- 뽑은 카드: ${enrichedCards.map((c: any) => c.nameKr).join(", ")}

JSON 양식을 정확히 출력해 주세요.`;

      try {
        const repairResponse = await withTimeout(
          ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: repairPrompt,
            config: {
              systemInstruction: systemInstruction,
              responseMimeType: "application/json",
              responseSchema: responseSchema,
              temperature: 0.85,
              maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS
            }
          }),
          20000,
          "AI_TIMEOUT"
        );

        const repairRaw = repairResponse.text;
        if (repairRaw && repairRaw.trim() !== "") {
          const parsedRepair = JSON.parse(repairRaw);
          if (parsedRepair && typeof parsedRepair === "object") {
            Object.keys(parsedRepair).forEach(key => {
              if (parsedRepair[key]) {
                parsedResult[key] = parsedRepair[key];
              }
            });
            console.log("[DIAGNOSTICS] Successfully applied auto-repair / correction block.");

            // Backwards-compatible mappings update
            if (parsedResult.cards && Array.isArray(parsedResult.cards) && parsedResult.cards.length === 3) {
              parsedResult.card1Meaning = parsedResult.cards[0].contextualMeaning;
              parsedResult.card2Meaning = parsedResult.cards[1].contextualMeaning;
              parsedResult.card3Meaning = parsedResult.cards[2].contextualMeaning;
              parsedResult.totalFlow = parsedResult.combinedFlow;
              parsedResult.conclusion = parsedResult.oneLineConclusion;
            }

            // Re-validate and re-check duplicates
            validation = validateTarotResult(menuId, parsedResult, false);
            duplicates = detectDuplicateReadingSections(parsedResult);
            topicCheck = isOpenQuestion
              ? responseLooksOffTopic(rawQuestion, inferredCategory, parsedResult)
              : { offTopic: false };
          }
        }
      } catch (repairErr) {
        console.error("[DIAGNOSTICS] Supplementary repair request failed:", repairErr);
      }
    }

    if (!validation.isValid) {
      console.error(`Gemini validation failed after repair attempts for menuId: ${menuId}. Missing/invalid field: ${validation.missingField}. Output:`, parsedResult);
      parsedResult.oneLineConclusion = parsedResult.oneLineConclusion || completionResult.oneLineConclusion;
      parsedResult.conclusion = parsedResult.conclusion || completionResult.conclusion;
      parsedResult.combinedFlow = parsedResult.combinedFlow || completionResult.combinedFlow || completionResult.totalFlow;
      parsedResult.totalFlow = parsedResult.totalFlow || parsedResult.combinedFlow;
      parsedResult.caution = parsedResult.caution || completionResult.caution;
      parsedResult.actionAdvice = parsedResult.actionAdvice || completionResult.actionAdvice;
      parsedResult.cards = Array.isArray(parsedResult.cards) && parsedResult.cards.length === 3
        ? parsedResult.cards.map((card: any, index: number) => {
            const fallbackCard: any = completionResult.cards[index] || {};
            const coreMeaning = String(card?.coreMeaning || "").trim();
            const contextualMeaning = String(card?.contextualMeaning || card?.meaning || card?.interpretation || "").trim();
            return {
              ...fallbackCard,
              ...card,
              role: card?.role || fallbackCard.role,
              cardName: card?.cardName || fallbackCard.cardName,
              orientation: card?.orientation || fallbackCard.orientation,
              coreMeaning: coreMeaning.length >= 2 ? coreMeaning : fallbackCard.coreMeaning,
              contextualMeaning: contextualMeaning.length >= 8 ? contextualMeaning : fallbackCard.contextualMeaning,
            };
          })
        : completionResult.cards;
      parsedResult.card1Meaning = parsedResult.cards?.[0]?.contextualMeaning || completionResult.card1Meaning;
      parsedResult.card2Meaning = parsedResult.cards?.[1]?.contextualMeaning || completionResult.card2Meaning;
      parsedResult.card3Meaning = parsedResult.cards?.[2]?.contextualMeaning || completionResult.card3Meaning;
      parsedResult = normalizeTarotResult(menuId, parsedResult, false);
      validation = validateTarotResult(menuId, parsedResult, false);
      if (!validation.isValid) {
        console.warn(`Gemini validation still incomplete after completion merge for menuId: ${menuId}. Returning completed reading instead of failing.`);
        parsedResult = completionResult;
      }
    }

    if (duplicates.hasDuplicates) {
      console.warn(`Gemini duplicate check warning for menuId: ${menuId}. Duplicated fields: ${duplicates.duplicateFields.join(", ")}`);
    }

    if (topicCheck.offTopic) {
      console.warn(`Gemini topic check warning for menuId: ${menuId}. Reason: ${topicCheck.reason}. Output:`, parsedResult);
    }

    // temperature 계산 & 보완 로직 (Required in Requirement 4)
    if (menuId === 'relation-temp') {
      let tempVal = parsedResult.temperature !== undefined ? Number(parsedResult.temperature) : NaN;
      if (isNaN(tempVal) || tempVal < 0 || tempVal > 100) {
        console.log("[DIAGNOSTICS] Temperature missing or invalid in Gemini response. Trying calculation...");
        // 1단계: 선택한 카드의 관계 점수 데이터를 이용해 계산
        tempVal = calculateRelationshipTemperature(enrichedCards, relationship);

        // 2단계: 계산 데이터가 없다면 Gemini에게 temperature만 다시 요청
        if (isNaN(tempVal) || tempVal < 0 || tempVal > 100) {
          try {
            console.log("[DIAGNOSTICS] Temperature calc failed. Requesting temperature only from Gemini...");
            const tempPrompt = `
우리가 뽑은 타로 카드는 ${enrichedCards.map((c: any) => c.nameKr).join(", ")} 이고, 상황은 '${relationship || '없음'}' 입니다.
이 조합에 기반한 두 사람 사이의 관계 정서적 온도 정수 값(0에서 100 사이)을 생성하여 정확히 JSON 양식 {"temperature": <정수>} 형태로만 반환해 주세요.`;

            const tempResponse = await withTimeout(
              ai.models.generateContent({
                  model: GEMINI_MODEL,
                contents: tempPrompt,
                config: {
                  responseMimeType: "application/json",
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      temperature: { type: Type.INTEGER }
                    },
                    required: ["temperature"]
                  }
                }
              }),
              10000,
              "AI_TIMEOUT"
            );

            const tempJson = JSON.parse(tempResponse.text || "{}");
            tempVal = Number(tempJson.temperature);
          } catch (tempErr) {
            console.error("[DIAGNOSTICS] Temperature correction query failed:", tempErr);
          }
        }

        // 3단계: 두 방법 모두 실패하면 결과 화면을 성공으로 표시하지 않고 오류 처리
        if (isNaN(tempVal) || tempVal < 0 || tempVal > 100) {
          throw new Error("VALIDATION_FAILED:temperature_calculation_or_query_failed");
        } else {
          parsedResult.temperature = Math.floor(tempVal);
        }
      } else {
        parsedResult.temperature = Math.floor(tempVal);
      }
    } else {
      // For menuIds other than relation-temp, calculate for local persistence reference
      parsedResult.temperature = calculateRelationshipTemperature(enrichedCards, relationship);
    }

    // 13. 개발용 Diagnostics
    const elapsed = Date.now() - startTime;
    if (isDev) {
      console.log(`[DIAGNOSTICS] URL: ${req.path} | Menu: ${menuId} | HTTP: 200 | Gemini OK: true | JSON Parse OK: true | Validation OK: true | Time: ${elapsed}ms`);
    }

    if (isOpenQuestion) {
      parsedResult.questionCategory = inferredCategory;
    }
    recoverableReading = parsedResult;
    return res.json({ success: true, method: "gemini", data: parsedResult });

  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    let status = 500;
    let code = "SERVER_ERROR";
    let message = "리딩 결과를 분석하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
    let retryable = true;
    let extra: any = {};

    const errorMsg = error.message || "";
    if (errorMsg === "AI_TIMEOUT") {
      status = 504;
      code = "AI_TIMEOUT";
      message = "AI 요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.";
    } else if (errorMsg === "AI_RESPONSE_EMPTY") {
      status = 500;
      code = "AI_RESPONSE_EMPTY";
      message = "AI 응답을 받아오지 못했습니다. 다시 시도해 주세요.";
    } else if (errorMsg === "AI_RESPONSE_INVALID") {
      status = 500;
      code = "AI_RESPONSE_INVALID";
      message = "정선된 타로 리딩 값을 받지 못했습니다. 카드는 그대로 보존되오니 안심하고 다시 시도해 주세요.";
    } else if (errorMsg === "AI_RESPONSE_INCOMPLETE" || errorMsg.startsWith("VALIDATION_FAILED:")) {
      status = 500;
      code = "AI_RESPONSE_INCOMPLETE";
      message = "정선된 타로 리딩 값을 받지 못했습니다. 카드는 그대로 보존되오니 안심하고 다시 시도해 주세요.";
      extra.missingFields = errorMsg.replace("VALIDATION_FAILED:", "");
    } else {
      // Handle Google API rate limits or server connection issues
      if (isGeminiRateLimitError(errorMsg)) {
        status = 429;
        code = "AI_RATE_LIMIT";
        message = "Gemini 크레딧 또는 요청 한도 문제가 있습니다. Google AI Studio에서 결제/쿼터 상태를 확인해 주세요.";
      } else if (errorMsg.includes("GEMINI_MODEL_UNAVAILABLE") || errorMsg.includes("404") || errorMsg.toLowerCase().includes("not_found") || errorMsg.toLowerCase().includes("no longer available")) {
        status = 503;
        code = "AI_MODEL_UNAVAILABLE";
        message = "현재 설정된 Gemini 모델을 사용할 수 없습니다. 모델 설정을 최신 값으로 바꾼 뒤 다시 시도해 주세요.";
      } else if (errorMsg.includes("GEMINI_BUSY") || errorMsg.includes("503") || errorMsg.toLowerCase().includes("service unavailable") || errorMsg.toLowerCase().includes("high demand")) {
        status = 503;
        code = "AI_BUSY";
        message = "Gemini 요청이 순간적으로 몰려 리딩을 받아오지 못했습니다. 카드는 그대로 유지되니 잠시 후 다시 시도해 주세요.";
      } else if (errorMsg.includes("502") || errorMsg.toLowerCase().includes("bad gateway")) {
        status = 502;
        code = "SERVER_ERROR";
        message = "일시적인 네트워크 지연 오류입니다. 잠시 후 다시 시도해 주세요.";
      } else if (errorMsg.includes("504") || errorMsg.toLowerCase().includes("gateway timeout")) {
        status = 504;
        code = "AI_TIMEOUT";
        message = "서버 게이트웨이 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.";
      }
    }

    console.error("Tarot Reading Error:", error);

    if (
      recoverableReading &&
      typeof recoverableReading === "object" &&
      (recoverableReading.oneLineConclusion || recoverableReading.conclusion || recoverableReading.card1Meaning || recoverableReading.cards)
    ) {
      console.warn("[DIAGNOSTICS] Returning recoverable Gemini reading despite post-processing error:", errorMsg);
      return res.json({
        success: true,
        method: "gemini",
        recovered: true,
        warning: code,
        data: recoverableReading
      });
    }

    if (isDev) {
      console.log(`[DIAGNOSTICS] URL: ${req.path} | Menu: ${req.body?.menuId} | HTTP: ${status} | Code: ${code} | Time: ${elapsed}ms | Success: false`);
    }

    return sendError(res, status, code, message, retryable, extra);
  }
});

// REST route for PREMIUM DEEP Tarot Cards Reading interpretation
app.post("/api/tarot/deep-read", async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      menuId,
      menuTitle,
      cards,
      partnerNickname,
      relationship,
      lastContact,
      contactStatus,
      situation,
      additionalQuestion,
      question,
      questionCategory,
      promoType,
      spreadRoles,
      mockErrorType
    } = req.body;
    const isOpenQuestion = menuId?.startsWith("question-");
    const rawQuestion = additionalQuestion || question || situation || "";
    const inferredCategory = isOpenQuestion
      ? await classifyQuestionIntentWithGemini(rawQuestion, questionCategory || menuTitle || "일반 흐름")
      : (questionCategory || menuTitle || "일반 흐름");
    const effectiveSpreadRoles = isOpenQuestion ? [] : spreadRoles;
    const answerGuard = isOpenQuestion ? buildQuestionAnswerGuard(rawQuestion, inferredCategory) : "";

    // Error Simulation Trigger (Required in Requirement 6)
    if (isDev && process.env.ENABLE_MOCK_ERRORS === "true" && mockErrorType) {
      console.log(`[DIAGNOSTICS] Simulating deep mock error: ${mockErrorType}`);
      if (mockErrorType === "MISSING_API_KEY") {
        return sendError(res, 530, "AI_NOT_CONFIGURED", "API_NOT_CONFIGURED: Gemini API 키가 누락되었습니다. AI Studio Secrets 패널에서 올바른 키를 설정하여 주십시오.", false);
      } else if (mockErrorType === "INVALID_API_KEY") {
        return sendError(res, 400, "API_KEY_INVALID", "API_KEY_INVALID: 입력하신 Gemini API 키가 유효하지 않습니다. 올바른 키 값인지 확인해 주세요.", true);
      } else if (mockErrorType === "EMPTY_RESPONSE") {
        throw new Error("AI_RESPONSE_EMPTY");
      } else if (mockErrorType === "MISSING_FIELD") {
        throw new Error("VALIDATION_FAILED:expectedResponse");
      } else if (mockErrorType === "JSON_PARSE_ERROR") {
        throw new Error("AI_RESPONSE_INVALID");
      } else if (mockErrorType === "TIMEOUT") {
        await new Promise(resolve => setTimeout(resolve, 31000));
        throw new Error("AI_TIMEOUT");
      } else if (mockErrorType === "RATE_LIMIT") {
        throw new Error("API_LIMIT_EXCEEDED: Quota exceeded for model on 429 rate limits.");
      }
    }

    // In production, never show local fallback readings for AI failures.
    if (isKeyInvalid) {
      return sendError(res, 530, "AI_NOT_CONFIGURED", "Gemini API 키가 설정되지 않았습니다. AI 리딩을 불러올 수 없어요.", false);
    }

    if (!cards || cards.length !== 3) {
      return sendError(res, 400, "INVALID_REQUEST", "카드가 상호 연결되지 못했습니다. 카드를 다시 배치해 주십시오.", false);
    }

    const ai = getGeminiClient();
    if (!ai) {
      return sendError(res, 503, "AI_NOT_CONFIGURED", "AI 리딩 서비스 설정이 완료되지 않았습니다.", false);
    }

    const systemInstruction =
      (isOpenQuestion
        ? `"타로 : 우리 사이 온도"의 연애 전문 타로 상담가처럼 답해 주세요. 질문은 "${rawQuestion}"이며 분류는 "${inferredCategory}"예요. 첫 문장에서 질문에 직접 답하세요. 상대의 속마음, 호감, 연락 흐름, 재회 가능성, 썸의 온도, 관계의 방향을 중심으로 답하되 질문 원문에 없는 결론으로 돌리지 마세요.\n`
        : `"타로 : 우리 사이 온도"의 다정한 연애 타로 상담가처럼, 질문자님 앞에서 직접 말하듯 답해 주세요.\n`) +
      "호칭은 무조건 '질문자님'만 사용하세요. '당신', '사용자', '내담자', '질문자' 단독 표현은 절대 쓰지 마세요.\n" +
      "절대 딱딱한 분석 보고서, 심리학 논문, 혹은 기계적인 진단서 형식을 적지 말아 주세요. 사람과 얼굴을 맞대고 얘기하듯 따뜻한 구어체 존댓말을 써 주세요. '~해요', '~느껴져요', '~좋아요', '~봐야 해요' 등을 다채롭게 섞고, '~입니다', '~합니다', '~하십시오', '~습니다' 반복은 피하세요.\n\n" +
      "## 금지 규칙 (중요)\n" +
      "1. 아래의 고정적인 상투 문장이나 회피성 권유는 절대 출력물에 포함될 수 없습니다:\n" +
      "   - '상대에게 마음은 남아 있어요.'\n" +
      "   - '완전히 끝난 관계는 아니에요.'\n" +
      "   - '아직 조심스러운 모습이에요.'\n" +
      "   - '가볍게 안부를 물어보세요.'\n" +
      "   - '조금 더 기다리는 편이 좋아요.'\n" +
      "   - '천천히 관계를 이어가 보세요.'\n" +
      "   - '상대도 질문자님을 생각하고 있어요.'\n" +
      "2. '에세이', '조율', '처방', '감정 솔루션', '마음 정리 보고서'와 같은 가식적이거나 과장된 표제어나 명사는 사용하지 마세요.\n" +
      "3. '기류', '해독', '심적 진동', '상징적 내막', '전방위', '매만지다', '뼈아픈 조언', '조율수필', '소통 기류', '인연의 끈', '무드' 같은 인위적이거나 과장된 문예적 어휘 사용을 절대 금지합니다.\n" +
      "4. 딱딱하고 경직된 진문투 및 무의미한 분석가 행색의 전용 한자어는 삼가세요:\n" +
      "   - 예: '감정이 존재합니다', '방어 기제', '관계 진전', '종합 분석', '결과적으로', '데이터에 따르면', '시사합니다', '암시합니다', '나타냅니다', '의미합니다', '분석됩니다'\n\n" +
      "5. '손득 계산', '손익 계산', '득실 계산', '상황 계산', '계산적'처럼 거래처럼 들리는 표현은 절대 쓰지 마세요. 말해야 할 때는 '부담을 먼저 살피는 모습', '조심스럽게 재는 태도'처럼 사람이 말하는 구어체로 바꿔 주세요.\n" +
      "6. '관망', '식었다기보다', '차갑다/차가운', '~에 가까워요/가깝습니다', 'A는 B보다' 식의 딱딱한 비교문도 쓰지 마세요. 같은 뜻은 자연스러운 구어체로 풀어 주세요.\n\n" +
      "## 호칭 규격\n" +
      "- 별도의 이름이 명기되지 않으면 무조건 '질문자님'이라고 신뢰감 있게 부르세요. '당신', '사용자', '내담자', '질문자'라고 부르지 마세요.\n" +
      "- 상대방을 논할 때는 '상대방', '그 사람', '상대' 등을 맥락에 따라 적절히 혼용하며, 지루하게 한 단락에서 한 단어만 고집하여 중언부언하지 않도록 하세요.\n\n" +
      "## 리딩 가이드\n" +
      "1. **질문 및 관계 맥락에 완벽 대응**: 추가 질문(${additionalQuestion})과 상황 세부 사연에 대해 심층적으로 성실하게 전조나 과장 없이 정성을 다해 리딩해 주세요. 질문자님이 입력한 상황과 맥락이 있다면 이를 절대로 가공하거나 가볍게 보지 말고 밀접하게 다뤄 주세요.\n" +
      "2. **역방향 카드의 상세한 심리 해독**: 역방향은 카드마다 다르게 해석해 주세요. 감정의 약화, 행동 지연, 과잉, 고착, 회복 중 어떤 의미인지 질문과 카드에 맞춰 구체적으로 설명해 주세요. 그 카드 상징의 깊은 본뜻과 수치 데이터를 상황에 맞춤 적용하여 상세하게 리딩해야 합니다.\n" +
      "3. **냉정한 현실 묘사**: 조합이 우울하고 부정적이면 억지로 무해하게 덧칠하지 않고, 다정하지만 현실을 가감 없이 직시하는 솔직한 조언을 해 주셔야 합니다.\n" +
      (isOpenQuestion
        ? "4. **실전 조언**: 상대에게 다가갈지, 기다릴지, 연락의 무게를 어떻게 조절할지, 감정 표현을 어디까지 열지 등 연애 상황에서 실제로 움직일 수 있는 행동 기준을 제시하세요. 연락 질문이 아니면 연락 여부로만 답을 끝내지 말고 관계의 온도와 상대의 태도까지 함께 짚으십시오."
        : "4. **실전 조언**: 연락의 여부와 타이밍, 상대방의 답장에 대한 대처법 등 실전적인 행동 방향을 행동 위주로 서술하세요. 어떠한 경우에도 질문자님이 상대에게 그대로 보낼 수 있는 완성형 카카오톡 문장이나 문자 메시지 등 직접적인 대사나 대화 예문은 절대 생성하지 마십시오. 연락한다면 가볍게 할지 진지하게 할지, 감정의 깊이는 어느 정도로 조절할지, 속도는 어떻게 조절할지 등 태도와 무게를 위주로 조언하십시오.");

    // Enrich input cards with full metadata from TAROT_DECK
    const enrichedCards = cards.map((card: any) => {
      const fullCard = TAROT_DECK.find(c => c.id === card.id) || {};
      return { ...fullCard, ...card };
    });

    // Compute detailed card analysis description
    const formattedCardsText = enrichedCards.map((card: any, idx: number) => {
      const role = effectiveSpreadRoles && effectiveSpreadRoles[idx] ? effectiveSpreadRoles[idx] : `역할 ${idx + 1}`;
      const roleLine = isOpenQuestion
        ? "   - 배치 역할: 질문 원문과 현재 상황, 세 카드 조합을 보고 직접 정하세요. 고정 배열명을 그대로 쓰지 마세요."
        : `   - 배치 역할: "${role}"`;
      const direction = card.isReversed ? "역방향 (Reversed)" : "정방향 (Upright)";
      const generalMeaning = card.keywordKr || "데이터 없음";
      const reversedMeaning = card.reversedMeaningKr || "데이터 없음";
      const scoreSummary = `감합/호감: ${card.affection || 50}, 행동/연락: ${card.action || 50}, 방호/경계: ${card.defense || 50}, 소통/대화: ${card.communication || 50}, 장기안정: ${card.stability || 50}, 단절/정리: ${card.closure || 50}, 새연인: ${card.newConnection || 50}, 재접촉/재회: ${card.reconciliation || 50}`;

      return `${idx + 1}번째 카드: [${card.nameKr}] (${direction})
${roleLine}
   - 정방향 의미: "${generalMeaning}"
   - 역방향 의미: "${reversedMeaning}"
   - 카드 수치 데이터: ${scoreSummary}
   - 안내 규칙: 이 카드 '${card.nameKr}'의 역할은 질문 맥락에 맞춰 새로 정하고, 이를 기준으로 사리에 부합하게 구체적인 상황을 타로 학술 이론에 근거하여 풀어 설명해 주세요.`;
    }).join("\n\n");

    const promptPayLoad = `
${GEMINI_TAROT_TRAINING}
${answerGuard}

[특별 프리미엄 잠금해제 의뢰]
- 프리미엄 상품 유형: ${promoType || 'one-question'}
- 선택한 타로 메뉴: ${menuTitle}
- 질문자가 해제하고 싶어 한 구체적인 후속 질문 또는 상황 테마: "${rawQuestion || '지정되지 않음'}"
- 자동 분류된 질문 유형: ${inferredCategory}
${partnerNickname ? `- 상대방 닉네임: ${partnerNickname}` : ''}
${relationship ? `- 현재의 관계 상황: ${relationship}` : ''}
${lastContact ? `- 마지막 연락 시기: ${lastContact}` : ''}
${contactStatus ? `- 최근의 연락 상태: ${contactStatus}` : ''}
${situation ? `- 질문자의 추가 사연: ${situation}` : ''}

[뽑은 타로 카드 학술 데이터 및 배치 역할]
${formattedCardsText}

[출력 요구 사항]
JSON 오브젝트 형식으로 정확히 반환해 주세요. 키값은 아래와 같습니다:
${isOpenQuestion
  ? `- premiumConclusion: 질문 원문에 대한 가장 핵심이 되는 구체적인 결론 (첫 문장부터 직접 답하고, 3-4문장)
- partnerEmotionSituation: 질문 분야의 현재 핵심 상태와 겉으로 드러난 흐름
- actionPossibility: 앞으로 실제로 움직일 가능성과 예상되는 변화
- relationshipBarrier: 지금 결정을 어렵게 만드는 현실적 장애물 또는 놓치기 쉬운 변수
- expectedResponse: 그 선택이나 행동을 했을 때 돌아올 가능성이 큰 반응/결과
- detailedAdvice: 질문 분야에 맞는 구체적인 실전 조언. 연락 질문이 아니면 연락 조언 금지`
  : `- premiumConclusion: 질문에 대한 가장 핵심이 되는 구체적인 결론 (설득력 있고 마음을 보듬는 3-4문장)
- partnerEmotionSituation: 상대의 숨겨진 현재 감정 또는 사적인 곤란한 상황
- actionPossibility: 상대방이 다가오는 미래에 보일 행동 가능성이나 예상 행보
- relationshipBarrier: 현재 두 사람을 어색하고 답답하게 가로막고 있는 감정의 벽이나 현실적 장애물
- expectedResponse: 질문자가 용기 내어 가볍게 움직였을 때 상대가 보일 예상 표정이나 솔직한 반응
- detailedAdvice: 질문자님이 상대에게 보낼 완성형 메시지나 직접적인 대사를 절대 포함하지 않고, 말투의 무게나 상황 조율 속도 및 감정 조절 방법만 서술한 구체적인 실전 조언`}

완벽한 JSON 형식으로 출력해야 하며 다른 텍스트나 포맷 코드는 반환하지 마세요.`;

    // Call Gemini deep-read with custom timeout wrapper (25 seconds limit)
    const response = await withTimeout(
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: promptPayLoad,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              premiumConclusion: { type: Type.STRING, description: isOpenQuestion ? "질문 원문에 첫 문장부터 직접 답하는 깊은 결론" : "의뢰한 고민에 대한 사려 깊고 결단력 있는 다정한 결론" },
              partnerEmotionSituation: { type: Type.STRING, description: isOpenQuestion ? "질문 분야의 현재 핵심 상태와 겉으로 드러난 흐름" : "상대의 현재 감정이나 사연 정조" },
              actionPossibility: { type: Type.STRING, description: isOpenQuestion ? "앞으로 실제로 움직일 가능성과 예상 변화" : "그 사람이 보일 연락 및 행동 가능성" },
              relationshipBarrier: { type: Type.STRING, description: isOpenQuestion ? "결정을 어렵게 만드는 현실적 장애물이나 변수" : "서로에게 먼저 연락하지 못하게 방어하고 가두는 현실적 장애벽" },
              expectedResponse: { type: Type.STRING, description: isOpenQuestion ? "선택하거나 행동했을 때 예상되는 반응 또는 결과" : "질문자의 연락 접근에 대해 상대가 가질 심중 반응" },
              detailedAdvice: { type: Type.STRING, description: isOpenQuestion ? "질문 분야에 맞춘 구체적인 실전 조언. 연락 질문이 아니면 연락 조언 금지" : "절대 직접적인 대사나 완성형 메시지를 작성하지 않으며 연락의 타이밍과 조율 속도, 감정 조절 위주의 실천 조언" }
            },
            required: ["premiumConclusion", "partnerEmotionSituation", "actionPossibility", "relationshipBarrier", "expectedResponse", "detailedAdvice"]
          },
          temperature: 0.65, // 유료 리딩 0.55~0.7 권장
          maxOutputTokens: GEMINI_DEEP_MAX_OUTPUT_TOKENS
        }
      }),
      25000,
      "AI_TIMEOUT"
    );

    const rawText = response.text;
    if (!rawText || rawText.trim() === "") {
      throw new Error("AI_RESPONSE_EMPTY");
    }

    let parsedResult: any;
    parsedResult = extractJsonObject(rawText);
    if (!parsedResult) {
      throw new Error("AI_RESPONSE_INVALID");
    }

    // Apply auto-correction / normalization step
    parsedResult = normalizeTarotResult(menuId, parsedResult, true);
    const deepCompletionResult: any = createLocalDeepReading(enrichedCards, rawQuestion, isOpenQuestion);

    // 10. 메뉴별 응답 검증 & 중복 검출
    let validation = validateTarotResult(menuId, parsedResult, true);
    let duplicates = detectDuplicateReadingSections(parsedResult);
    let topicCheck = isOpenQuestion
      ? responseLooksOffTopic(rawQuestion, inferredCategory, parsedResult)
      : { offTopic: false };

    if (GEMINI_ENABLE_REPAIR && (!validation.isValid || duplicates.hasDuplicates || topicCheck.offTopic)) {
      console.log(`[DIAGNOSTICS] Initial deep result flawed. Validation valid: ${validation.isValid}, Duplicate found: ${duplicates.hasDuplicates}, OffTopic: ${topicCheck.offTopic ? topicCheck.reason : "no"}. Attempting supplementary repair request...`);
      
      const flawedFields = new Set<string>();
      if (!validation.isValid && validation.missingField) {
        const fieldName = validation.missingField.split(" ")[0];
        flawedFields.add(fieldName);
      }
      if (duplicates.hasDuplicates) {
        duplicates.duplicateFields.forEach(f => flawedFields.add(f));
      }
      if (topicCheck.offTopic) {
        ["premiumConclusion", "partnerEmotionSituation", "actionPossibility", "relationshipBarrier", "expectedResponse", "detailedAdvice"].forEach(f => flawedFields.add(f));
      }

      if (flawedFields.size > 0) {
        const fieldsList = Array.from(flawedFields);
        console.log(`[DIAGNOSTICS] Fields requiring deep repair: ${fieldsList.join(", ")}`);
        
        const subProperties: any = {};
        const subRequired: string[] = [];
        
        // Deep fields schema properties
        const deepProperties: any = {
          premiumConclusion: { type: Type.STRING, description: "의뢰한 고민에 대한 사려 깊고 결단력 있는 다정한 결론" },
          partnerEmotionSituation: { type: Type.STRING, description: "상대의 현재 감정이나 사연 정조" },
          actionPossibility: { type: Type.STRING, description: "그 사람이 보일 연락 및 행동 가능성" },
          relationshipBarrier: { type: Type.STRING, description: "서로에게 먼저 연락하지 못하게 방어하고 가두는 현실적 장애벽" },
          expectedResponse: { type: Type.STRING, description: "질문자의 연락 접근에 대해 상대가 가질 심중 반응" },
          detailedAdvice: { type: Type.STRING, description: "절대 직접적인 대사나 완성형 메시지를 작성하지 않으며 연락의 타이밍과 조율 속도, 감정 조절 위주의 실천 조언" }
        };

        fieldsList.forEach(field => {
          if (deepProperties[field]) {
            subProperties[field] = deepProperties[field];
            subRequired.push(field);
          }
        });

        if (subRequired.length > 0) {
          const repairSchema = {
            type: Type.OBJECT,
            properties: subProperties,
            required: subRequired
          };

          const repairPrompt = `
[보완 요청 - 중요]
사용자 질문 및 타로 카드 조합 정보에 기초하여, 이전에 생성된 프리미엄 리딩 중 다음 필드에 문제가 있어 수정 및 재생성을 요청합니다.
수정 대상 필드: ${fieldsList.join(", ")}
동문서답 여부: ${topicCheck.offTopic ? topicCheck.reason : "문제 없음"}

${answerGuard}

[요청 규칙]
1. 원본의 다른 정상적인 해석 단락이나 다른 필드의 문구와 동일한 내용을 '절대' 중복 또는 복사해서 채우지 마십시오.
2. 각 대상 필드가 묘사해야 하는 고유한 역할(예: 감벽 vs 행동 가량, 반응성 vs 결말 팁)에 철저히 맞춤 설계된 고유하고 새로운 한국어 문장으로 작성해 주세요.
3. 중복되지 않는 풍성하고 구어체적인 고유한 한국어 문장(2~4문장)으로 작성해 주셔야 합니다.
4. 질문 원문 "${rawQuestion}"에 직접 답해야 하며, 질문에 없는 주제로 결론을 바꾸면 안 됩니다.

그 외 관계 상황 및 카드 정보는 원본과 동일합니다:
선택 메뉴: ${menuTitle}
상황/질문: ${rawQuestion || '별도의 상황 없음'}
질문 유형: ${inferredCategory}
카드: ${enrichedCards.map((c: any) => c.nameKr).join(", ")}

JSON 양식을 정확히 출력해 주세요.`;

          try {
            const repairResponse = await withTimeout(
              ai.models.generateContent({
                model: GEMINI_MODEL,
                contents: repairPrompt,
                config: {
                  systemInstruction: systemInstruction,
                  responseMimeType: "application/json",
                  responseSchema: repairSchema,
                  temperature: 0.85,
                  maxOutputTokens: Math.min(2048, GEMINI_DEEP_MAX_OUTPUT_TOKENS)
                }
              }),
              15000,
              "AI_TIMEOUT"
            );

            const repairRaw = repairResponse.text;
            if (repairRaw && repairRaw.trim() !== "") {
              const parsedRepair = JSON.parse(repairRaw);
              fieldsList.forEach(field => {
                if (parsedRepair && parsedRepair[field] && typeof parsedRepair[field] === "string" && parsedRepair[field].trim().length > 0) {
                  parsedResult[field] = parsedRepair[field].trim();
                  console.log(`[DIAGNOSTICS] Deep Field [${field}] successfully repaired/regenerated.`);
                }
              });

              // Re-validate and re-check duplicates
              validation = validateTarotResult(menuId, parsedResult, true);
              duplicates = detectDuplicateReadingSections(parsedResult);
              topicCheck = isOpenQuestion
                ? responseLooksOffTopic(rawQuestion, inferredCategory, parsedResult)
                : { offTopic: false };
            }
          } catch (repairErr) {
            console.error("[DIAGNOSTICS] Supplementary deep repair request failed:", repairErr);
          }
        }
      }
    }

    if (!validation.isValid) {
      console.warn(`Gemini deep validation incomplete after repair attempts. Missing field: ${validation.missingField}. Completing missing fields instead of failing. Output:`, parsedResult);
      const premiumFields = ["premiumConclusion", "partnerEmotionSituation", "actionPossibility", "relationshipBarrier", "expectedResponse", "detailedAdvice"];
      for (const field of premiumFields) {
        if (!parsedResult[field] || typeof parsedResult[field] !== "string" || parsedResult[field].trim().length === 0) {
          parsedResult[field] = deepCompletionResult[field];
        }
      }
      parsedResult = normalizeTarotResult(menuId, parsedResult, true);
      validation = validateTarotResult(menuId, parsedResult, true);
      if (!validation.isValid) {
        console.warn(`Gemini deep validation still incomplete after completion merge. Returning completed deep reading instead of failing.`);
        parsedResult = normalizeTarotResult(menuId, deepCompletionResult, true);
        validation = validateTarotResult(menuId, parsedResult, true);
      }
    }

    if (duplicates.hasDuplicates) {
      console.warn(`Gemini duplicate check warning for deep-read. Duplicated fields: ${duplicates.duplicateFields.join(", ")}`);
    }

    if (topicCheck.offTopic) {
      console.warn(`Gemini topic check warning for deep-read. Reason: ${topicCheck.reason}. Output:`, parsedResult);
    }

    // 13. 개발용 Diagnostics
    const elapsed = Date.now() - startTime;
    if (isDev) {
      console.log(`[DIAGNOSTICS] URL: ${req.path} | Menu: ${menuId} (Deep) | HTTP: 200 | Gemini OK: true | JSON Parse OK: true | Validation OK: true | Time: ${elapsed}ms`);
    }

    if (isOpenQuestion) {
      parsedResult.questionCategory = inferredCategory;
    }
    return res.json({ success: true, method: "gemini", data: parsedResult });

  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    let status = 500;
    let code = "SERVER_ERROR";
    let message = "유료 분석 결과를 생성하는 중 내부적인 에러가 생겼습니다. 청구는 진행되지 않사오니 안심하고 다시 시도해 주십시오.";
    let retryable = true;
    let extra: any = {};

    const errorMsg = error.message || "";
    if (errorMsg === "AI_TIMEOUT") {
      status = 504;
      code = "AI_TIMEOUT";
      message = "AI 요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.";
    } else if (errorMsg === "AI_RESPONSE_EMPTY") {
      status = 500;
      code = "AI_RESPONSE_EMPTY";
      message = "AI의 분석 결과를 받아오지 못했습니다. 다시 시도해 주세요.";
    } else if (errorMsg === "AI_RESPONSE_INVALID") {
      status = 500;
      code = "AI_RESPONSE_INVALID";
      message = "정선된 깊은 리딩 분석 값을 받지 못했습니다. 추가 결제 없이 재시도가 무상 제공되오니 안심하고 다시 시도하여 주십시오.";
    } else if (errorMsg.startsWith("VALIDATION_FAILED:")) {
      status = 500;
      code = "AI_RESPONSE_INVALID";
      message = "정선된 깊은 리딩 분석 값을 받지 못했습니다. 추가 결제 없이 재시도가 무상 제공되오니 안심하고 다시 시도하여 주십시오.";
      extra.missingFields = errorMsg.replace("VALIDATION_FAILED:", "");
    } else {
      // Handle Google API rate limits or server connection issues
      if (isGeminiRateLimitError(errorMsg)) {
        status = 429;
        code = "AI_RATE_LIMIT";
        message = "Gemini 크레딧 또는 요청 한도 문제가 있습니다. Google AI Studio에서 결제/쿼터 상태를 확인해 주세요.";
      } else if (errorMsg.includes("GEMINI_MODEL_UNAVAILABLE") || errorMsg.includes("404") || errorMsg.toLowerCase().includes("not_found") || errorMsg.toLowerCase().includes("no longer available")) {
        status = 503;
        code = "AI_MODEL_UNAVAILABLE";
        message = "현재 설정된 Gemini 모델을 사용할 수 없습니다. 모델 설정을 최신 값으로 바꾼 뒤 다시 시도해 주세요.";
      } else if (errorMsg.includes("GEMINI_BUSY") || errorMsg.includes("503") || errorMsg.toLowerCase().includes("service unavailable") || errorMsg.toLowerCase().includes("high demand")) {
        status = 503;
        code = "AI_BUSY";
        message = "Gemini 요청이 순간적으로 몰려 리딩을 받아오지 못했습니다. 선택한 정보는 유지되니 잠시 후 다시 시도해 주세요.";
      } else if (errorMsg.includes("502") || errorMsg.toLowerCase().includes("bad gateway")) {
        status = 502;
        code = "SERVER_ERROR";
        message = "일시적인 게이트웨이 정체가 발생했습니다. 잠시 후 다시 시도해 주십시오.";
      } else if (errorMsg.includes("504") || errorMsg.toLowerCase().includes("gateway timeout")) {
        status = 504;
        code = "AI_TIMEOUT";
        message = "서버 게이트웨이 시간 지연이 발생했습니다. 안전하게 다시 시도해 주십시오.";
      }
    }

    console.error("Premium Reading Error:", error);

    if (isDev) {
      console.log(`[DIAGNOSTICS] URL: ${req.path} | Menu: ${req.body?.menuId} (Deep) | HTTP: ${status} | Code: ${code} | Time: ${elapsed}ms | Success: false`);
    }

    return sendError(res, status, code, message, retryable, extra);
  }
});

// Serve frontend assets based on environment
async function startServer() {
  const httpServer = createHttpServer(app);

  if (process.env.NODE_ENV !== "production") {
    // Development mode combining Express and Vite Middleware
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server: httpServer },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite development server loaded as middleware.");
  } else {
    // Production mode serving bundled static client build
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server runs successfully on http://0.0.0.0:${PORT}`);
  });
}

startServer();
