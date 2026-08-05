import React, { useState, useEffect } from 'react';
import { Home, ClipboardList, User, ArrowLeft, Heart, Sparkles, ChevronRight } from 'lucide-react';
import { DesktopFrame } from './components/DesktopFrame';
import { HomeView } from './components/HomeView';
import { RecordsView } from './components/RecordsView';
import { MyView } from './components/MyView';
import { TarotDeckDrawer } from './components/TarotDeckDrawer';
import { ReadingResultView, StandardReadingResult } from './components/ReadingResultView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TarotCard, PartnerProfile, RelationshipType } from './types';
import { auth } from './lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { dataSync } from './lib/dataSync';
import { classifyQuestion } from './lib/questionTarot';
import { TAROT_DECK } from './data/tarotCards';
import {
  ADDITIONAL_QUESTION_PRICE_TEXT,
  DAILY_AD_REWARD_DATE_KEY,
  DAILY_FREE_READING_KEY,
  DAILY_SHARE_REWARD_DATE_KEY,
  DAILY_TEMPERATURE_READING_KEY,
  DAILY_TEMPERATURE_READING_VERSION,
  GYEOL_TOKEN_BALANCE_KEY,
  GYEOL_TOKEN_MIGRATION_KEY,
  QUESTION_PASS_PACKAGES,
  READING_TOKEN_COST,
  SHARE_REWARD_MODULE_ID,
  SHARE_READING_PASS_REWARD
} from './lib/appConstants';
import { getKstDateKey } from './lib/kstDate';
import { decodeSharedReading, SHARED_READING_QUERY_KEY } from './lib/sharedReadingLink';
import { openShareReward } from './lib/appShare';

type ActiveTab = 'home' | 'records' | 'my';
type FlowStep = 
  | 'tab' // Viewing bottom tab pages
  | 'partner-choice' // User choosing between registered profiles versus new one
  | 'opinion-partner' // Custom inputs for "그 사람의 속마음"
  | 'contact-situation' // Situation select for "오늘 연락해도 될까"
  | 'temp-partner-select' // Partner profile choice for legacy relationship flow
  | 'flow-partner-select' // Partner profile choice for "이번 주 관계 흐름"
  | 'deck-drawer' // Shuffling and drawing of 3 cards
  | 'reading-result'; // Visualizing flips, interpretation and upsell suggestions

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [currentStep, setCurrentStep] = useState<FlowStep>('tab');
  
  // Selection states
  const [selectedMenuId, setSelectedMenuId] = useState<string>('');
  const [selectedMenuTitle, setSelectedMenuTitle] = useState<string>('');
  
  // Ephemeral profile/contact states for active flows
  const [partnerNickname, setPartnerNickname] = useState<string>('');
  const [relationshipType, setRelationshipType] = useState<RelationshipType>('썸');
  const [lastContactPoint, setLastContactPoint] = useState<string>('');
  const [contactStatusDesc, setContactStatusDesc] = useState<string>('');
  const [selectedSituation, setSelectedSituation] = useState<string>('');
  const [tarotQuestion, setTarotQuestion] = useState<string>('');
  
  // Resolved profile for records-linked flow
  const [activePartnerProfile, setActivePartnerProfile] = useState<PartnerProfile | undefined>(undefined);
  
  // Array of exactly three selected cards
  const [selectedCards, setSelectedCards] = useState<TarotCard[]>([]);
  const [sharedReadingResult, setSharedReadingResult] = useState<StandardReadingResult | null>(null);

  // Local list of active partners to verify selection lists
  const [partnerProfilesList, setPartnerProfilesList] = useState<PartnerProfile[]>([]);

  // Auth User state
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [gyeolTokenBalance, setGyeolTokenBalance] = useState(0);
  const [firstFreeReadingUsed, setFirstFreeReadingUsed] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState('');
  const [showReadingGate, setShowReadingGate] = useState(false);

  const refreshReadingAccess = () => {
    if (localStorage.getItem(GYEOL_TOKEN_MIGRATION_KEY) !== 'done') {
      localStorage.setItem(GYEOL_TOKEN_BALANCE_KEY, localStorage.getItem(GYEOL_TOKEN_BALANCE_KEY) || '0');
      localStorage.setItem(GYEOL_TOKEN_MIGRATION_KEY, 'done');
    }

    const today = getKstDateKey();
    setGyeolTokenBalance(Number(localStorage.getItem(GYEOL_TOKEN_BALANCE_KEY) || '0'));
    setFirstFreeReadingUsed(localStorage.getItem(DAILY_FREE_READING_KEY) === today);
  };

  const addGyeolTokens = (amount: number) => {
    const nextBalance = Number(localStorage.getItem(GYEOL_TOKEN_BALANCE_KEY) || '0') + amount;
    localStorage.setItem(GYEOL_TOKEN_BALANCE_KEY, String(nextBalance));
    setGyeolTokenBalance(nextBalance);
    return nextBalance;
  };

  const getTodaySavedTemperatureCard = () => {
    try {
      const rawSavedTemperature = localStorage.getItem(DAILY_TEMPERATURE_READING_KEY);
      const savedTemperature = rawSavedTemperature ? JSON.parse(rawSavedTemperature) : null;
      if (
        savedTemperature?.date !== getKstDateKey() ||
        savedTemperature?.version !== DAILY_TEMPERATURE_READING_VERSION
      ) {
        return null;
      }

      const savedCard = TAROT_DECK.find(card => Number(card.id) === Number(savedTemperature.cardId));
      if (!savedCard) {
        return null;
      }

      return {
        ...savedCard,
        isReversed: Boolean(savedTemperature.isReversed)
      };
    } catch {
      return null;
    }
  };

  const getSafeProfiles = (storedVal: string | null): PartnerProfile[] => {
    if (!storedVal) return [];
    try {
      const parsed = JSON.parse(storedVal);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("Failed to parse partner profiles from local storage:", e);
      return [];
    }
  };

  const loadPartnerProfiles = async () => {
    const user = auth.currentUser;
    if (user) {
      try {
        const list = await dataSync.getPartnersCloud(user.uid);
        setPartnerProfilesList(list);
      } catch (err) {
        console.error("Cloud partner load fail, reading locally instead:", err);
        const stored = localStorage.getItem('tarot_partner_profiles');
        setPartnerProfilesList(getSafeProfiles(stored));
      }
    } else {
      const stored = localStorage.getItem('tarot_partner_profiles');
      setPartnerProfilesList(getSafeProfiles(stored));
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        try {
          const list = await dataSync.getPartnersCloud(user.uid);
          setPartnerProfilesList(list);
        } catch (err) {
          console.error("Failed to fetch profiles from cloud on auth trigger:", err);
        }
      } else {
        const stored = localStorage.getItem('tarot_partner_profiles');
        setPartnerProfilesList(getSafeProfiles(stored));
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const sharedReadingParam = params.get(SHARED_READING_QUERY_KEY);
      if (sharedReadingParam) {
        const sharedReading = decodeSharedReading(sharedReadingParam);
        if (sharedReading) {
          setSelectedMenuId('shared-reading');
          setSelectedMenuTitle('공유받은 리딩');
          setTarotQuestion(sharedReading.question);
          setSelectedSituation(sharedReading.question);
          setSelectedCards(sharedReading.cards);
          setActivePartnerProfile(undefined);
          setSharedReadingResult(sharedReading.readingResult as StandardReadingResult);
          setCurrentStep('reading-result');
        }
      }
    } catch (err) {
      console.warn('Failed to apply local token preview value:', err);
    }

    refreshReadingAccess();
  }, []);

  useEffect(() => {
    loadPartnerProfiles();
  }, [currentStep, activeTab]);

  // Navigate to corresponding sub-question screens based on menu choices
  const handleSelectHomeMenu = (menuId: string, menuTitle: string) => {
    setSharedReadingResult(null);
    setSelectedMenuId(menuId);
    setSelectedMenuTitle(menuTitle);
    setSelectedCards([]);
    
    // Reset inputs
    setPartnerNickname('');
    setRelationshipType('썸');
    setLastContactPoint('');
    setContactStatusDesc('');
    setSelectedSituation('');
    setActivePartnerProfile(undefined);

    // Read stored profiles to see if we can offer partner choice
    const stored = localStorage.getItem('tarot_partner_profiles');
    const localProfiles = getSafeProfiles(stored);
    
    // Determine active profile list based on logged-in status
    const activeList = auth.currentUser ? partnerProfilesList : localProfiles;

    if (activeList.length > 0 && ['inner-mind', 'can-contact', 'relation-temp', 'relation-flow'].includes(menuId)) {
      setPartnerProfilesList(activeList);
      setCurrentStep('partner-choice');
      return;
    }

    if (menuId === 'dating-luck') {
      // 1. 오늘의 연애운: Go directly to 78-card deck drawer
      setCurrentStep('deck-drawer');
    } else if (menuId === 'inner-mind') {
      // 2. 그 사람의 속마음: Enter partner info questionnaire
      setCurrentStep('opinion-partner');
    } else if (menuId === 'can-contact') {
      // 3. 오늘 연락해도 될까: Select contact situation questionnaire
      setCurrentStep('contact-situation');
    } else if (menuId === 'relation-temp') {
      // 4. Legacy relationship flow: Select profile (or register first if empty)
      loadPartnerProfiles();
      setCurrentStep('temp-partner-select');
    } else if (menuId === 'relation-flow') {
      // 5. 이번 주 관계 흐름: Select profile
      loadPartnerProfiles();
      setCurrentStep('flow-partner-select');
    }
  };

  const startQuestionFlow = (question: string) => {
    setSharedReadingResult(null);
    const category = classifyQuestion(question);
    setTarotQuestion(question);
    setSelectedSituation(question);
    setSelectedMenuId(`question-${category}`);
    setSelectedMenuTitle(category);
    setSelectedCards([]);
    setActivePartnerProfile(undefined);
    setCurrentStep('deck-drawer');
  };

  const startDailyTemperatureFlow = () => {
    setSharedReadingResult(null);
    const question = '오늘, 그 사람과 나의 온도는 몇 도일까요?';

    setTarotQuestion(question);
    setSelectedSituation(question);
    setSelectedMenuId('daily-temperature');
    setSelectedMenuTitle('오늘의 온도 리딩');
    setActivePartnerProfile(undefined);

    const savedCard = getTodaySavedTemperatureCard();
    if (savedCard) {
      setSelectedCards([savedCard]);
      setCurrentStep('reading-result');
      return;
    }

    setSelectedCards([]);
    setCurrentStep('deck-drawer');
  };

  const hasReadingPass = () => {
    const today = getKstDateKey();
    return localStorage.getItem(DAILY_FREE_READING_KEY) !== today
      || Number(localStorage.getItem(GYEOL_TOKEN_BALANCE_KEY) || '0') >= READING_TOKEN_COST;
  };

  const consumeReadingPassAfterSuccess = () => {
    const today = getKstDateKey();
    if (localStorage.getItem(DAILY_FREE_READING_KEY) !== today) {
      localStorage.setItem(DAILY_FREE_READING_KEY, today);
      setFirstFreeReadingUsed(true);
      return true;
    }

    const currentTokens = Number(localStorage.getItem(GYEOL_TOKEN_BALANCE_KEY) || '0');
    if (currentTokens < READING_TOKEN_COST) return false;
    const nextTokens = currentTokens - READING_TOKEN_COST;
    localStorage.setItem(GYEOL_TOKEN_BALANCE_KEY, String(nextTokens));
    setGyeolTokenBalance(nextTokens);
    return true;
  };

  const handleSubmitQuestion = (question: string) => {
    if (question.trim() === '오늘, 그 사람과 나의 온도는 몇 도일까요?') {
      const savedCard = getTodaySavedTemperatureCard();
      if (!savedCard) {
        localStorage.setItem(DAILY_AD_REWARD_DATE_KEY, getKstDateKey());
      }
      startDailyTemperatureFlow();
      return;
    }

    if (!hasReadingPass()) {
      setPendingQuestion(question);
      setShowReadingGate(true);
      return;
    }
    startQuestionFlow(question);
  };

  const continuePendingQuestion = (questionOverride?: string) => {
    const nextQuestion = (questionOverride || pendingQuestion).trim();
    if (nextQuestion) {
      setShowReadingGate(false);
      setPendingQuestion('');
      startQuestionFlow(nextQuestion);
      return;
    }

    setCurrentStep('tab');
    setActiveTab('home');
  };

  const grantPaidReadingPass = async (count = 1) => {
    const questionPackage = QUESTION_PASS_PACKAGES.find((pkg) => pkg.count === count) ?? QUESTION_PASS_PACKAGES[0];

    try {
      const framework = await import('@apps-in-toss/web-framework');
      const iap = (framework as any).IAP;

      if (!iap?.createOneTimePurchaseOrder) {
        throw new Error('IAP_NOT_AVAILABLE');
      }

      let cleanup: (() => void) | undefined;
      let settled = false;
      let granted = false;

      const grantOnce = () => {
        if (granted) {
          return;
        }
        granted = true;
        addGyeolTokens(questionPackage.count);
      };

      const finish = (success: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup?.();
        if (!success) {
          alert('결제가 완료되지 않았어요. 다시 시도해 주세요.');
        }
      };

      const success = await new Promise<boolean>((resolve) => {
        const complete = (isSuccess: boolean) => {
          finish(isSuccess);
          resolve(isSuccess);
        };

        cleanup = iap.createOneTimePurchaseOrder({
          options: {
            sku: questionPackage.sku,
            processProductGrant: async ({ orderId }: { orderId: string }) => {
              console.log('IAP product grant completed', {
                orderId,
                sku: questionPackage.sku,
                count: questionPackage.count
              });
              grantOnce();
              window.setTimeout(() => complete(true), 0);
              return true;
            }
          },
          onEvent: (event: any) => {
            const eventType = String(event?.type ?? '').toLowerCase();
            console.log('IAP event', event);

            if (eventType === 'success' || eventType.includes('complete')) {
              grantOnce();
              complete(true);
              return;
            }

            if (eventType.includes('cancel') || eventType.includes('fail')) {
              complete(false);
            }
          },
          onError: (error: unknown) => {
            console.error('IAP purchase error', error);
            complete(false);
          }
        });
      });

      return success;
    } catch (error) {
      console.error('IAP unavailable', error);
      alert('토스 앱 안에서만 결제를 진행할 수 있어요. 앱인토스 테스트 환경에서 다시 시도해 주세요.');
      return false;
    }
  };

  const grantShareReadingPass = () => {
    const today = getKstDateKey();
    if (localStorage.getItem(DAILY_SHARE_REWARD_DATE_KEY) === today) {
      return false;
    }
    localStorage.setItem(DAILY_SHARE_REWARD_DATE_KEY, today);
    addGyeolTokens(SHARE_READING_PASS_REWARD);
    return true;
  };

  const shareAppAndGrantReadingPass = async () => {
    const result = await openShareReward(SHARE_REWARD_MODULE_ID);
    if (result === 'closed') {
      return null;
    }

    if (result === 'unsupported' || result === 'failed') {
      alert('앱인토스 안에서만 친구 공유 보상을 받을 수 있어요. 토스 앱에서 다시 시도해 주세요.');
      return null;
    }

    return grantShareReadingPass();
  };

  const handlePaidFollowUpQuestion = (question: string) => {
    if (!hasReadingPass()) {
      setPendingQuestion(question);
      setShowReadingGate(true);
      return;
    }
    startQuestionFlow(question);
  };

  // Helper to trigger drawer when direct partner is verified
  const handleStartDrawWithPartner = (profile: PartnerProfile) => {
    setActivePartnerProfile(profile);
    setSelectedCards([]);
    setCurrentStep('deck-drawer');
  };

  // 1. Submit partner profile questionnaire inside "그 사람의 속마음" menu
  const handleSubmitOpinionPartner = (e: React.FormEvent) => {
    e.preventDefault();
    if (!partnerNickname.trim()) return;

    // Build temporary inline mock profile wrapper
    const tempProfile: PartnerProfile = {
      id: `opinion-${Date.now()}`,
      nickname: partnerNickname.trim(),
      relationship: relationshipType,
      lastContact: lastContactPoint.trim() || '최근 연락 없음',
      contactStatus: '현재 상황을 확인하는 중',
      temperatureHistory: []
    };
    setActivePartnerProfile(tempProfile);
    setCurrentStep('deck-drawer');
  };

  // 2. Click option inside "오늘 연락해도 될까" menu
  const handleSelectContactSituation = (sit: string) => {
    setSelectedSituation(sit);
    setCurrentStep('deck-drawer');
  };

  // 3. Registering direct profile inside legacy relationship flow
  const handleRegisterTempPartner = (e: React.FormEvent) => {
    e.preventDefault();
    if (!partnerNickname.trim()) return;

    const newProfile: PartnerProfile = {
      id: `partner-${Date.now()}`,
      nickname: partnerNickname.trim(),
      relationship: relationshipType,
      lastContact: lastContactPoint.trim() || '최근 연락 시도 없음',
      contactStatus: contactStatusDesc.trim() || '지켜보는 중',
      temperatureHistory: []
    };

    // Store globally so it instantly registers inside records page database
    const stored = localStorage.getItem('tarot_partner_profiles');
    let list: PartnerProfile[] = [];
    if (stored) {
      try {
        list = JSON.parse(stored);
      } catch (err) {
        console.error(err);
      }
    }
    const updated = [newProfile, ...list];
    localStorage.setItem('tarot_partner_profiles', JSON.stringify(updated));

    const user = auth.currentUser;
    if (user) {
      dataSync.savePartnerCloud(user.uid, newProfile).then(() => {
        loadPartnerProfiles();
      }).catch(err => {
        console.error("Failed to save registered partner to cloud:", err);
      });
    }

    setActivePartnerProfile(newProfile);
    setCurrentStep('deck-drawer');
  };

  // Complete drawing callback
  const handleCompleteTarotDraw = (cards: TarotCard[]) => {
    if (selectedMenuId === 'daily-temperature') {
      const savedCard = getTodaySavedTemperatureCard();
      if (savedCard) {
        setSelectedCards([savedCard]);
        setCurrentStep('reading-result');
        return;
      }
    }

    if (selectedMenuId === 'daily-temperature' && cards[0]) {
      localStorage.setItem(DAILY_TEMPERATURE_READING_KEY, JSON.stringify({
        date: getKstDateKey(),
        version: DAILY_TEMPERATURE_READING_VERSION,
        cardId: cards[0].id,
        isReversed: Boolean(cards[0].isReversed)
      }));
    }

    setSelectedCards(cards);
    setCurrentStep('reading-result');
  };

  const handleBackToHome = () => {
    setSharedReadingResult(null);
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has(SHARED_READING_QUERY_KEY)) {
        url.searchParams.delete(SHARED_READING_QUERY_KEY);
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      }
    } catch {
      // Ignore URL cleanup errors.
    }
    setCurrentStep('tab');
    setActiveTab('home');
  };

  const handleGoToRecordsTab = () => {
    setCurrentStep('tab');
    setActiveTab('records');
  };

  // Local helper to render partner choice temperature trend
  const renderPartnershipMiniChart = (history: { date: string; temperature: number }[]) => {
    if (history.length < 2) return null;
    const width = 280;
    const height = 45;
    const padding = 10;
    
    const xStep = (width - padding * 2) / (history.length - 1);
    const points = history.map((item, idx) => {
      const x = padding + idx * xStep;
      const y = height - padding - ((item.temperature - 10) / 90) * (height - padding * 2);
      return { x, y, temp: item.temperature, label: item.date };
    });

    const pathData = points.reduce((acc, p, idx) => {
      return idx === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
    }, '');

    return (
      <div className="w-full bg-[#FAF9F5] p-2 rounded-lg border border-[#EAE3D2] mt-2 select-none">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible">
          <line x1="0" y1={height - padding} x2={width} y2={height - padding} stroke="#F3EFE6" strokeWidth={1} strokeDasharray="3 3" />
          <path d={pathData} fill="none" stroke="#BD6B65" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
          {points.map((p, idx) => (
            <g key={`chart-point-${idx}`}>
              <circle cx={p.x} cy={p.y} r={2} fill="#BD6B65" stroke="#FAF9F5" strokeWidth={0.5} />
              <text x={p.x} y={p.y - 4} textAnchor="middle" fontSize="6.5px" fill="#BD6B65" className="font-mono font-bold">
                {p.temp}°C
              </text>
              <text x={p.x} y={height - 2} textAnchor="middle" fontSize="6px" fill="#8A7A71" className="font-sans">
                {p.label}
              </text>
            </g>
          ))}
        </svg>
      </div>
    );
  };

  return (
    <DesktopFrame>
      <div className="relative flex-1 flex flex-col justify-between h-full bg-[#FAF9F5]">
        
        {/* Main interactive window area based on router step */}
        <div className="flex-grow flex flex-col justify-start">
          {currentStep === 'tab' && (
            <div className="flex-1 flex flex-col">
              {activeTab === 'home' && (
                <HomeView
                  onSubmitQuestion={handleSubmitQuestion}
                  gyeolTokenBalance={gyeolTokenBalance}
                  dailyFreeAvailable={!firstFreeReadingUsed}
                  onPaidQuestion={() => {
                    void grantPaidReadingPass();
                  }}
                />
              )}
              
              {activeTab === 'records' && (
                <RecordsView 
                  onBackToHome={handleBackToHome}
                  onOpenReadingWithPartner={handleStartDrawWithPartner}
                />
              )}
              
              {activeTab === 'my' && (
                <MyView
                  gyeolTokenBalance={gyeolTokenBalance}
                  dailyFreeAvailable={!firstFreeReadingUsed}
                  onShareAppReward={shareAppAndGrantReadingPass}
                  onPurchaseQuestionPass={grantPaidReadingPass}
                />
              )}
            </div>
          )}

          {/* Flow Choose Saved vs New Partner Choice Screen */}
          {currentStep === 'partner-choice' && (
            <div className="px-6 py-4 animate-fadeIn">
              <button 
                onClick={handleBackToHome}
                className="flex items-center space-x-1.5 text-xs text-[#8A7A71] hover:text-[#BD6B65] py-2 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>홈으로 돌아가기</span>
              </button>

              <div className="text-center mt-3 mb-6">
                <span className="text-xs font-bold text-[#BD6B65] bg-rose-50 px-3 py-1 rounded-full uppercase">
                  {selectedMenuTitle}
                </span>
                <h3 className="font-serif text-xl font-bold text-[#3C2F2F] mt-3">
                  누구를 생각 중인가요?
                </h3>
                <p className="text-xs text-[#8A7A71] mt-1.5 font-sans px-4">
                  기록에 남겨둔 상대를 선택해 리딩을 계속하거나 신규 파트너를 등록하세요.
                </p>
              </div>

              <div className="space-y-5">
                <div className="space-y-2">
                  <p className="text-[10.5px] font-bold text-[#8A7A71] uppercase tracking-wider">기존에 기록된 상대방 중에서 선택하기</p>
                  <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
                    {partnerProfilesList.map(item => {
                      const latestHistory = item.temperatureHistory.length > 0 
                        ? item.temperatureHistory[item.temperatureHistory.length - 1] 
                        : null;
                      return (
                        <div
                          key={`partner-choice-select-${item.id}`}
                          className="p-4 rounded-2xl bg-[#F3EFE6]/50 hover:bg-[#F3EFE6]/80 border border-[#EAE3D2] space-y-2 transition-all duration-300"
                        >
                          <button
                            onClick={() => {
                              setPartnerNickname(item.nickname);
                              setRelationshipType(item.relationship as RelationshipType);
                              setLastContactPoint(item.lastContact);
                              handleStartDrawWithPartner(item);
                              if (selectedMenuId === 'can-contact') {
                                setCurrentStep('contact-situation');
                              }
                            }}
                            className="w-full text-left flex justify-between items-center group cursor-pointer"
                          >
                            <div className="flex flex-col">
                              <div className="flex items-center space-x-2.5">
                                <span className="text-xs font-serif font-bold text-[#3C2F2F] group-hover:text-[#BD6B65]">
                                  {item.nickname}
                                </span>
                                <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-rose-50 text-[#BD6B65] font-semibold border border-[#F2D1CD]">
                                  {item.relationship}
                                </span>
                              </div>
                              {item.lastContact && (
                                <span className="text-[10px] text-[#817267] mt-1 font-sans">
                                  최근 연락: {item.lastContact} {latestHistory ? `· 현재 온도: ${latestHistory.temperature}°C` : ''}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center space-x-1 text-[10px] text-[#BD6B65] font-semibold group-hover:underline">
                              <span>선택</span>
                              <ChevronRight className="w-3.5 h-3.5 text-[#BD6B65]" />
                            </div>
                          </button>
                          
                          {/* Mini Sparkline Chart of Temperature History */}
                          {item.temperatureHistory && item.temperatureHistory.length >= 2 && (
                            <div className="pt-2 border-t border-[#EAE3D2]/40">
                              <p className="text-[9px] text-[#8A7A71] font-serif mb-1">📈 관계 온도 흐름곡선</p>
                              {renderPartnershipMiniChart(item.temperatureHistory)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="w-full h-[1px] bg-[#EAE3D2] my-4" />

                <div className="space-y-2">
                  <p className="text-[10.5px] font-bold text-[#8A7A71] uppercase tracking-wider">새로운 상대방 등록하기</p>
                  <button
                    onClick={() => {
                      if (selectedMenuId === 'inner-mind') {
                        setCurrentStep('opinion-partner');
                      } else if (selectedMenuId === 'can-contact') {
                        setCurrentStep('contact-situation');
                      } else if (selectedMenuId === 'relation-temp') {
                        setCurrentStep('temp-partner-select');
                      } else if (selectedMenuId === 'relation-flow') {
                        setCurrentStep('flow-partner-select');
                      } else {
                        setCurrentStep('deck-drawer');
                      }
                    }}
                    className="w-full py-3 border-2 border-dashed border-[#DBCFB8] hover:border-[#BD6B65] rounded-xl flex items-center justify-center space-x-2 text-xs font-medium text-[#8D7B70] hover:text-[#BD6B65] transition-all cursor-pointer"
                  >
                    <span>➕ 새로운 상대방 직접 등록하기</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Flow 2: "그 사람의 속마음" Partner Profile Form */}
          {currentStep === 'opinion-partner' && (
            <div className="px-6 py-4 animate-fadeIn">
              <button 
                onClick={handleBackToHome}
                className="flex items-center space-x-1.5 text-xs text-[#8A7A71] hover:text-[#BD6B65] py-2 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>홈으로 돌아가기</span>
              </button>

              <div className="text-center mt-3 mb-6">
                <span className="text-xs font-bold text-[#BD6B65] bg-rose-50 px-3 py-1 rounded-full uppercase">
                  {selectedMenuTitle}
                </span>
                <h3 className="font-serif text-xl font-bold text-[#3C2F2F] mt-3">
                  그 사람과의 현재 상황을 알려주세요
                </h3>
                <p className="text-xs text-[#8A7A71] mt-1.5 font-sans px-4">
                  현재 관계와 마지막 연락 시점을 알려주시면 리딩에 함께 반영할게요.
                </p>
              </div>

              <form onSubmit={handleSubmitOpinionPartner} className="space-y-4">
                <div className="space-y-3">
                  {/* Nickname */}
                  <div className="flex flex-col space-y-1">
                    <label className="text-xs font-semibold text-[#3C2F2F]">그 사람의 별명 *</label>
                    <input
                      type="text"
                      required
                      placeholder="예: 그 사람, J 등"
                      value={partnerNickname}
                      onChange={(e) => setPartnerNickname(e.target.value)}
                      className="w-full px-3 py-2 bg-[#FAF9F5] border border-[#EAE3D2] rounded-xl text-xs text-[#3C2F2F] focus:outline-none focus:border-[#BD6B65]"
                    />
                  </div>

                  {/* Relationship */}
                  <div className="flex flex-col space-y-1">
                    <label className="text-xs font-semibold text-[#3C2F2F]">상대와의 현재 단계</label>
                    <select
                      value={relationshipType}
                      onChange={(e) => setRelationshipType(e.target.value as RelationshipType)}
                      className="w-full px-3 py-2 bg-[#FAF9F5] border border-[#EAE3D2] rounded-xl text-xs text-[#3C2F2F] focus:outline-none focus:border-[#BD6B65]"
                    >
                      <option value="짝사랑">짝사랑</option>
                      <option value="썸">썸</option>
                      <option value="연락 중">연락 중</option>
                      <option value="연애 중">연애 중</option>
                      <option value="헤어진 상태">헤어진 상태</option>
                      <option value="연락 단절">연락 단절</option>
                      <option value="애매한 사이">애매한 사이</option>
                    </select>
                  </div>

                  {/* Last Contact */}
                  <div className="flex flex-col space-y-1">
                    <label className="text-xs font-semibold text-[#3C2F2F]">마지막으로 연락한 시점</label>
                    <input
                      type="text"
                      placeholder="예: 어제 저녁, 일주일 전, 대답 없는 단절 상태"
                      value={lastContactPoint}
                      onChange={(e) => setLastContactPoint(e.target.value)}
                      className="w-full px-3 py-2 bg-[#FAF9F5] border border-[#EAE3D2] rounded-xl text-xs text-[#3C2F2F] focus:outline-none focus:border-[#BD6B65]"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-3.5 mt-4 bg-[#BD6B65] hover:bg-[#AC5B55] text-white text-xs font-serif rounded-xl text-center shadow-xs transition-colors cursor-pointer"
                >
                  그 사람의 마음 확인하기
                </button>
              </form>
            </div>
          )}

          {/* Flow 3: "오늘 연락해도 될까" Situation Choice Questionnaire */}
          {currentStep === 'contact-situation' && (
            <div className="px-6 py-4 animate-fadeIn">
              <button 
                onClick={handleBackToHome}
                className="flex items-center space-x-1.5 text-xs text-[#8A7A71] hover:text-[#BD6B65] py-2 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>홈으로 돌아가기</span>
              </button>

              <div className="text-center mt-3 mb-6">
                <span className="text-xs font-bold text-[#BD6B65] bg-rose-50 px-3 py-1 rounded-full uppercase">
                  {selectedMenuTitle}
                </span>
                <h3 className="font-serif text-xl font-bold text-[#3C2F2F] mt-3">
                  지금 어떤 상황인가요?
                </h3>
                <p className="text-xs text-[#8A7A71] mt-1.5 font-sans">
                  현재 상황을 선택하면 그에 맞춰 카드의 흐름을 살펴볼게요.
                </p>
              </div>

              <div className="space-y-2.5">
                {[
                  "먼저 연락한 적이 없음",
                  "최근 대화가 끊김",
                  "싸운 뒤 연락이 없음",
                  "이별 후 연락 고민 중",
                  "답장을 기다리는 중",
                  "애매한 관계에서 연락을 고민 중"
                ].map((sit, sitIdx) => (
                  <button
                    key={`sit-${sitIdx}`}
                    onClick={() => handleSelectContactSituation(sit)}
                    className="w-full text-left p-4 rounded-xl bg-[#F3EFE6]/50 hover:bg-[#F3EFE6] border border-[#EAE3D2]/60 hover:border-[#BD6B65] transition-all flex items-center justify-between group cursor-pointer"
                  >
                    <span className="text-xs font-medium text-[#3C2F2F] font-sans group-hover:text-[#BD6B65] transition-colors">
                      {sit}
                    </span>
                    <ChevronRight className="w-4 h-4 text-[#8A7A71] group-hover:text-[#BD6B65] transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Flow 4: Legacy relationship partner selection & registration form */}
          {currentStep === 'temp-partner-select' && (
            <div className="px-6 py-4 animate-fadeIn">
              <button 
                onClick={handleBackToHome}
                className="flex items-center space-x-1.5 text-xs text-[#8A7A71] hover:text-[#BD6B65] py-2 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>홈으로 돌아가기</span>
              </button>

              <div className="text-center mt-3 mb-6">
                <span className="text-xs font-bold text-[#BD6B65] bg-rose-50 px-3 py-1 rounded-full uppercase">
                  {selectedMenuTitle}
                </span>
                <h3 className="font-serif text-xl font-bold text-[#3C2F2F] mt-3">
                  기록할 상대방을 지정해 주세요
                </h3>
              </div>

              {/* Selection list if profiles exist */}
              {partnerProfilesList.length > 0 ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold text-[#8A7A71]">저장된 파트너 중 선택</p>
                    {partnerProfilesList.map(item => (
                      <button
                        key={`temp-select-partner-${item.id}`}
                        onClick={() => handleStartDrawWithPartner(item)}
                        className="w-full text-left p-3.5 rounded-xl bg-[#F3EFE6]/50 hover:bg-[#F3EFE6] border border-[#EAE3D2] flex justify-between items-center group cursor-pointer"
                      >
                        <div className="flex items-center space-x-2.5">
                          <span className="text-xs font-serif font-bold text-[#3C2F2F] group-hover:text-[#BD6B65]">
                            {item.nickname}
                          </span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-rose-50 text-[#BD6B65] font-semibold border border-[#F2D1CD]">
                            {item.relationship}
                          </span>
                        </div>
                        <ChevronRight className="w-4 h-4 text-[#8A7A71] group-hover:text-[#BD6B65]" />
                      </button>
                    ))}
                  </div>

                  <div className="w-full h-[1px] bg-[#EAE3D2] my-4" />
                  <p className="text-[11px] font-semibold text-[#8A7A71]">새로운 사람으로 신규 등록</p>
                </div>
              ) : null}

              {/* Quick dynamic partner registration within the flow */}
              <form onSubmit={handleRegisterTempPartner} className="space-y-3.5 mt-2">
                <div className="space-y-3 p-4 rounded-2xl bg-[#F3EFE6]/30 border border-[#EAE3D2] border-dashed">
                  <div className="flex flex-col space-y-1">
                    <label className="text-[11px] font-semibold text-[#322323]">상대방의 별명 *</label>
                    <input
                      type="text"
                      required
                      placeholder="예: 그 사람, 은은한 봄볕"
                      value={partnerNickname}
                      onChange={(e) => setPartnerNickname(e.target.value)}
                      className="w-full px-3 py-2 bg-[#FAF9F5] border border-[#EAE3D2] rounded-xl text-xs text-[#3C2F2F] focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-col space-y-1">
                    <label className="text-[11px] font-semibold text-[#322323]">현재 관계 수준</label>
                    <select
                      value={relationshipType}
                      onChange={(e) => setRelationshipType(e.target.value as RelationshipType)}
                      className="w-full px-3 py-2 bg-[#FAF9F5] border border-[#EAE3D2] rounded-xl text-xs text-[#3C2F2F] focus:outline-none"
                    >
                      <option value="짝사랑">짝사랑</option>
                      <option value="썸">썸</option>
                      <option value="연락 중">연락 중</option>
                      <option value="연애 중">연애 중</option>
                      <option value="헤어진 상태">헤어진 상태</option>
                      <option value="연락 단절">연락 단절</option>
                      <option value="애매한 사이">애매한 사이</option>
                    </select>
                  </div>

                  <div className="flex flex-col space-y-1">
                    <label className="text-[11px] font-semibold text-[#322323]">마지막으로 연락한 시점</label>
                    <input
                      type="text"
                      placeholder="예: 어제 밤, 2일 전 대화 끊김"
                      value={lastContactPoint}
                      onChange={(e) => setLastContactPoint(e.target.value)}
                      className="w-full px-3 py-2 bg-[#FAF9F5] border border-[#EAE3D2] rounded-xl text-xs text-[#3C2F2F] focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-col space-y-1">
                    <label className="text-[11px] font-semibold text-[#322323]">현재 연락 상태 / 상세 설명</label>
                    <input
                      type="text"
                      placeholder="예: 다소 서먹하지만 가끔 다정하게 안부가 오고 감"
                      value={contactStatusDesc}
                      onChange={(e) => setContactStatusDesc(e.target.value)}
                      className="w-full px-3 py-2 bg-[#FAF9F5] border border-[#EAE3D2] rounded-xl text-xs text-[#3C2F2F] focus:outline-none"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-3.5 bg-[#BD6B65] hover:bg-[#AC5B55] text-white text-xs font-serif rounded-xl text-center transition-colors cursor-pointer"
                >
                  관계 온도 확인하기
                </button>
              </form>
            </div>
          )}

          {/* Flow 5: "이번 주 관계 흐름" Partner Selection Form */}
          {currentStep === 'flow-partner-select' && (
            <div className="px-6 py-4 animate-fadeIn">
              <button 
                onClick={handleBackToHome}
                className="flex items-center space-x-1.5 text-xs text-[#8A7A71] hover:text-[#BD6B65] py-2 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>홈으로 돌아가기</span>
              </button>

              <div className="text-center mt-3 mb-6">
                <span className="text-xs font-bold text-[#BD6B65] bg-rose-50 px-3 py-1 rounded-full uppercase">
                  {selectedMenuTitle}
                </span>
                <h3 className="font-serif text-xl font-bold text-[#3C2F2F] mt-3">
                  이번 주 관계 흐름을 리딩할 파트너 선택
                </h3>
              </div>

              {partnerProfilesList.length > 0 ? (
                <div className="space-y-2.5">
                  <p className="text-[11px] font-semibold text-[#8A7A71] mb-2">어플에 등록된 연인 기록장</p>
                  {partnerProfilesList.map(item => (
                    <button
                      key={`flow-select-partner-${item.id}`}
                      onClick={() => handleStartDrawWithPartner(item)}
                      className="w-full text-left p-3.5 rounded-xl bg-[#F3EFE6]/50 hover:bg-[#F3EFE6] border border-[#EAE3D2] flex justify-between items-center group cursor-pointer"
                    >
                      <div className="flex items-center space-x-2.5">
                        <span className="text-xs font-serif font-bold text-[#3C2F2F] group-hover:text-[#BD6B65]">
                          {item.nickname}
                        </span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-rose-50 text-[#BD6B65] font-semibold border border-[#F2D1CD]">
                          {item.relationship}
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#8A7A71]" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-8 rounded-2xl bg-[#F3EFE6]/40 border-2 border-dashed border-[#DBCFB8] text-center space-y-4">
                  <p className="text-xs text-[#8A7A71] leading-relaxed">
                    아직 생성된 관계기록 파트너가 없습니다. 아래 [신규 임시 등록] 버튼을 거쳐 바로 흐름을 점쳐보거나, 하단 [관계기록] 탭에서 인연을 새로 추가해 보세요.
                  </p>
                  
                  <button
                    onClick={() => {
                      // Redirect to relation-temp selection page which has the registration form inside
                      setSelectedMenuId('relation-temp');
                      setSelectedMenuTitle('타로 : 우리 사이 온도');
                      setCurrentStep('temp-partner-select');
                    }}
                    className="px-4 py-2 bg-[#BD6B65] text-white text-xs rounded-xl font-medium cursor-pointer"
                  >
                    기록장 신규 등록하러 가기
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Interactive Shuffling and Selecting Canvas */}
          {currentStep === 'deck-drawer' && (
            <TarotDeckDrawer
              menuId={selectedMenuId}
              menuTitle={selectedMenuTitle}
              question={tarotQuestion || selectedSituation}
              onCompleteDraw={handleCompleteTarotDraw}
              onCancel={handleBackToHome}
            />
          )}

          {/* Detailed Interpretation Board */}
          {currentStep === 'reading-result' && (
            <ErrorBoundary>
              <ReadingResultView
                menuId={selectedMenuId}
                menuTitle={selectedMenuTitle}
                cards={selectedCards}
                partnerProfile={activePartnerProfile}
                situation={selectedSituation}
                question={tarotQuestion || selectedSituation}
                onBackToHome={handleBackToHome}
                onGoToRecords={handleGoToRecordsTab}
                onAskFollowUp={handlePaidFollowUpQuestion}
                onReadingSuccess={consumeReadingPassAfterSuccess}
                onChargeQuestionPass={() => {
                  void grantPaidReadingPass(1);
                }}
                onShareReward={grantShareReadingPass}
                questionPassBalance={gyeolTokenBalance}
                initialReadingResult={sharedReadingResult}
              />
            </ErrorBoundary>
          )}
        </div>

        {showReadingGate && (
          <div className="absolute inset-0 z-50 bg-[#3C2F2F]/25 backdrop-blur-[2px] flex items-center justify-center px-6">
            <div className="w-full max-w-[340px] rounded-[24px] bg-[#FAF9F5] border border-[#E6A19C] shadow-xl p-5 text-center">
              <div className="w-10 h-10 mx-auto rounded-full bg-[#F3EFE6] border border-[#EAE3D2] flex items-center justify-center mb-3">
                <Sparkles className="w-4 h-4 text-[#BD6B65]" />
              </div>
              <h3 className="font-serif text-base font-bold text-[#3C2F2F]">
                질문권이 필요해요
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[#8A7A71] break-keep">
                오늘 기본 질문권은 이미 사용했어요. 이어서 보려면 앱을 공유하거나 질문권을 충전해 주세요.
              </p>
              <div className="mt-4 space-y-2">
                <button
                  type="button"
                  onClick={async () => {
                    const granted = await shareAppAndGrantReadingPass();
                    if (granted === null) {
                      alert('공유가 취소됐어요.');
                      return;
                    }
                    if (!granted) {
                      alert('오늘 앱 공유 보상은 이미 받았어요.');
                      return;
                    }
                    continuePendingQuestion();
                  }}
                  className="w-full py-3 rounded-xl bg-white border border-[#E6A19C] text-[#BD6B65] text-[14px] font-serif font-bold"
                >
                  앱 공유하고 질문권 +{SHARE_READING_PASS_REWARD}
                  <span className="ml-1 text-[11px] font-normal text-[#A98E84]">1일 1회</span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const purchased = await grantPaidReadingPass(1);
                    if (purchased) {
                      continuePendingQuestion();
                    }
                  }}
                  className="w-full py-3 rounded-xl bg-[#F3EFE6] border border-[#E6A19C] text-[#BD6B65] text-[14px] font-serif font-bold"
                >
                  {ADDITIONAL_QUESTION_PRICE_TEXT} 결제하기
                </button>
                <div className="grid grid-cols-2 gap-2">
                  {QUESTION_PASS_PACKAGES.slice(1).map((pkg) => (
                    <button
                      key={pkg.count}
                      type="button"
                      onClick={async () => {
                        const purchased = await grantPaidReadingPass(pkg.count);
                        if (purchased) {
                          continuePendingQuestion();
                        }
                      }}
                      className="min-h-[44px] rounded-xl bg-white border border-[#EAE3D2] text-[#7A5C52] text-[12.5px] font-serif font-bold leading-snug"
                    >
                      {pkg.label}<br />
                      <span className="text-[#BD6B65]">{pkg.priceText}</span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowReadingGate(false);
                    setPendingQuestion('');
                  }}
                  className="w-full py-2 text-[11px] text-[#8A7A71]"
                >
                  나중에 볼게요
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 3. FIXED BOTTOM TAB BAR (ONLY SHOWN IN NORMAL TAB MENUS) */}
        {currentStep === 'tab' && (
          <div className="border-t border-[#EAE3D2] bg-[#FAF9F5] py-3 px-4 flex justify-between items-center z-40">
            {[
              { id: 'home', label: '홈', icon: <Home className="w-5 h-5 stroke-[1.5]" /> },
              { id: 'records', label: '리딩 기록', icon: <ClipboardList className="w-5 h-5 stroke-[1.5]" /> },
              { id: 'my', label: '마이', icon: <User className="w-5 h-5 stroke-[1.5]" /> }
            ].map((tab) => {
              const isSelected = activeTab === tab.id;
              
              return (
                <button
                  key={`navigation-tab-${tab.id}`}
                  onClick={() => setActiveTab(tab.id as ActiveTab)}
                  className={`flex-1 flex flex-col items-center justify-center space-y-1 py-1 cursor-pointer transition-all ${
                    isSelected ? 'text-[#BD6B65] scale-102 font-bold' : 'text-[#8A7A71] hover:text-[#BD6B65]/70'
                  }`}
                >
                  <div className="flex items-center justify-center">
                    {tab.icon}
                  </div>
                  <span className="text-[13px] tracking-tight">
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}

      </div>
    </DesktopFrame>
  );
}
