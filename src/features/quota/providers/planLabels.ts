/**
 * Plan and limit labels shared by the provider detail bodies and the ledger rows.
 *
 * React-free so the ledger model can resolve the same wording as the detail
 * panel without importing a component.
 */

import type { TFunction } from 'i18next';
import type { AntigravityQuotaSubscription } from '@/types';
import { normalizePlanType, PREMIUM_CODEX_PLAN_TYPES } from '@/utils/quota';

/** Display name for a Codex plan type, or null when the payload carried none. */
export function codexPlanLabel(t: TFunction, planType?: string | null): string | null {
  const normalized = normalizePlanType(planType);
  if (!normalized) return null;
  if (normalized === 'self_serve_business_prolite') {
    return t('codex_quota.plan_business_premium');
  }
  if (normalized === 'pro') return t('codex_quota.plan_pro');
  if (PREMIUM_CODEX_PLAN_TYPES.has(normalized)) return t('codex_quota.plan_prolite');
  if (normalized === 'plus') return t('codex_quota.plan_plus');
  if (normalized === 'team') return t('codex_quota.plan_team');
  if (normalized === 'free') return t('codex_quota.plan_free');
  return planType || normalized;
}

/** Display name for an Antigravity subscription, or null when it is unknown. */
export function antigravityPlanLabel(
  subscription: AntigravityQuotaSubscription | null | undefined,
  t: TFunction
): string | null {
  if (!subscription) return null;
  if (subscription.plan === 'free') return t('antigravity_subscription.plan_free');
  if (subscription.plan === 'pro') return t('antigravity_subscription.plan_pro');
  if (subscription.plan === 'ultra') return t('antigravity_subscription.plan_ultra');
  if (subscription.plan === 'ultra-lite') return t('antigravity_subscription.plan_ultra_lite');
  return (
    subscription.tierName ||
    subscription.tierId ||
    (subscription.plan === 'unknown' ? t('antigravity_subscription.plan_unknown') : null)
  );
}

const ANTIGRAVITY_GROUP_LABEL_KEYS = new Map<string, string>([
  ['gemini models', 'group_gemini_models'],
  ['claude and gpt models', 'group_claude_gpt_models'],
]);

const ANTIGRAVITY_BUCKET_LABEL_KEYS = new Map<string, string>([
  ['weekly limit', 'weekly_limit'],
  ['daily limit', 'daily_limit'],
  ['5 hour limit', 'five_hour_limit'],
  ['5-hour limit', 'five_hour_limit'],
  ['five hour limit', 'five_hour_limit'],
  ['monthly limit', 'monthly_limit'],
]);

const normalizeAntigravityQuotaText = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

const translateAntigravityLabel = (
  value: string,
  keys: Map<string, string>,
  t: TFunction
): string => {
  const key = keys.get(normalizeAntigravityQuotaText(value));
  return key ? t(`antigravity_quota.${key}`) : value;
};

/** Translate a known Antigravity group name; unknown names pass through. */
export const antigravityGroupLabel = (value: string, t: TFunction): string =>
  translateAntigravityLabel(value, ANTIGRAVITY_GROUP_LABEL_KEYS, t);

/** Translate a known Antigravity bucket name; unknown names pass through. */
export const antigravityBucketLabel = (value: string, t: TFunction): string =>
  translateAntigravityLabel(value, ANTIGRAVITY_BUCKET_LABEL_KEYS, t);

const XAI_SUPERGROK_LIMIT_CENTS = 15_000;
const XAI_SUPERGROK_HEAVY_LIMIT_CENTS = 150_000;

/** Infer the SuperGrok plan from its monthly credit limit when Grok sends no plan name. */
export const resolveXaiPlan = (
  monthlyLimitCents: number | null
): { labelKey: string; premium: boolean } | null => {
  if (monthlyLimitCents === XAI_SUPERGROK_LIMIT_CENTS) {
    return { labelKey: 'plan_supergrok', premium: false };
  }
  if (monthlyLimitCents === XAI_SUPERGROK_HEAVY_LIMIT_CENTS) {
    return { labelKey: 'plan_supergrok_heavy', premium: true };
  }
  return null;
};
