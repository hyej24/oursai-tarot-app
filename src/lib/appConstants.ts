export const DAILY_FREE_READING_KEY = 'tarot_daily_free_reading_date';
export const BONUS_READING_COUNT_KEY = 'tarot_bonus_reading_count';
export const ATTENDANCE_COUNT_KEY = 'tarot_attendance_count';
export const ATTENDANCE_LAST_DATE_KEY = 'tarot_last_attendance_date';
export const GYEOL_TOKEN_BALANCE_KEY = 'tarot_gyeol_token_balance';
export const GYEOL_TOKEN_DAILY_CLAIM_KEY = 'tarot_gyeol_token_daily_claim_date';
export const GYEOL_TOKEN_MIGRATION_KEY = 'tarot_gyeol_token_migration_v1';
export const FIRST_FREE_READING_USED_KEY = 'tarot_first_free_reading_used';
export const DAILY_AD_REWARD_DATE_KEY = 'tarot_daily_ad_reward_date';
export const DAILY_SHARE_REWARD_DATE_KEY = 'tarot_daily_share_reward_date';
export const DAILY_TEMPERATURE_READING_KEY = 'tarot_daily_temperature_reading';
export const DAILY_TEMPERATURE_READING_VERSION = 'daily-temperature-reading-v5-local-card-specific';
export const SHARE_REWARD_MODULE_ID = '80fa9e5f-afac-4e81-813c-ff30feac76a5';

export const READING_TOKEN_COST = 1;
export const SHARE_READING_PASS_REWARD = 1;
export const PAID_GYEOL_TOKEN_REWARD = 1;

export const ADDITIONAL_QUESTION_PRICE = 990;
export const ADDITIONAL_QUESTION_PRICE_TEXT = '990원';

export const QUESTION_PASS_PACKAGES = [
  { count: 1, price: 990, priceText: '990원', label: '추가 질문 1회' },
  { count: 3, price: 2500, priceText: '2,500원', label: '추가 질문 3회' },
  { count: 10, price: 6900, priceText: '6,900원', label: '추가 질문 10회' }
] as const;
