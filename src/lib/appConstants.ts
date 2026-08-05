export const DAILY_FREE_READING_KEY = 'tarot_daily_free_reading_date_launch_v1';
export const BONUS_READING_COUNT_KEY = 'tarot_bonus_reading_count';
export const ATTENDANCE_COUNT_KEY = 'tarot_attendance_count';
export const ATTENDANCE_LAST_DATE_KEY = 'tarot_last_attendance_date';
export const GYEOL_TOKEN_BALANCE_KEY = 'tarot_gyeol_token_balance_launch_v1';
export const GYEOL_TOKEN_DAILY_CLAIM_KEY = 'tarot_gyeol_token_daily_claim_date';
export const GYEOL_TOKEN_MIGRATION_KEY = 'tarot_gyeol_token_migration_launch_v1';
export const FIRST_FREE_READING_USED_KEY = 'tarot_first_free_reading_used';
export const DAILY_AD_REWARD_DATE_KEY = 'tarot_daily_ad_reward_date';
export const DAILY_SHARE_REWARD_DATE_KEY = 'tarot_daily_share_reward_date_launch_v1';
export const DAILY_TEMPERATURE_READING_KEY = 'tarot_daily_temperature_reading';
export const DAILY_TEMPERATURE_READING_VERSION = 'daily-temperature-reading-v20-rewarded-ad-preload';
export const SHARE_REWARD_MODULE_ID = '80fa9e5f-afac-4e81-813c-ff30feac76a5';
export const REWARDED_AD_GROUP_ID = 'ait.v2.live.437f612be4b64bef';

export const READING_TOKEN_COST = 1;
export const SHARE_READING_PASS_REWARD = 1;
export const PAID_GYEOL_TOKEN_REWARD = 1;

export const ADDITIONAL_QUESTION_PRICE = 990;
export const ADDITIONAL_QUESTION_PRICE_TEXT = '990원';

export const QUESTION_PASS_PACKAGES = [
  {
    count: 1,
    price: 990,
    priceText: '990원',
    label: '추가 질문 1회',
    sku: 'ait.0000045729.3b8f62cd.0b5e78d19f.5912017556'
  },
  {
    count: 3,
    price: 2530,
    priceText: '2,530원',
    label: '추가 질문 3회',
    sku: 'ait.0000045729.076476c6.8f2beb4284.5912105801'
  },
  {
    count: 10,
    price: 6930,
    priceText: '6,930원',
    label: '추가 질문 10회',
    sku: 'ait.0000045729.3b98398a.fa0a908acc.5912145104'
  }
] as const;
