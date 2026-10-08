/**
 * Ledger view model: one flat list of limits per credential, pooled per provider.
 *
 * Every provider stores its quota differently (percent used, fraction remaining,
 * raw counts, billing cents). The ledger row and the summary tiles only need
 * "label, percent remaining, when it resets", so this reads each shape once and
 * hands the UI a uniform list. The provider detail bodies keep the full shapes.
 *
 * React-free: `t` and `nowMs` are passed in, so every rule here is testable.
 */

import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
  XaiQuotaState,
} from '@/types';
import { formatKimiResetHint, parseIsoToMs } from '@/utils/quota';
import {
  antigravityBucketLabel,
  antigravityGroupLabel,
  antigravityPlanLabel,
  codexPlanLabel,
  resolveXaiPlan,
} from './providers/planLabels';
import type { QuotaProviderType } from './providers/types';

/** One limit on one credential, normalized to percent remaining. */
export interface LedgerWindow {
  id: string;
  label: string;
  /** Remaining percent, 0..100; null when the provider sent no usage figure. */
  remaining: number | null;
  resetAtMs: number | null;
  /** Provider-formatted reset text, used when no parseable instant exists. */
  resetHint: string | null;
}

/** One limit pooled across every credential of a provider. */
export interface PooledWindow {
  id: string;
  label: string;
  /** Sum of remaining percent across credentials; null when none report a figure. */
  total: number | null;
  /** 100 per credential in the pool, so the tile reads "409% of 500%". */
  capacity: number;
  /** One entry per credential in pool order; null where it has no figure. */
  segments: (number | null)[];
  /** Earliest reset still in the future, across the pool. */
  soonestResetMs: number | null;
}

const QUOTA_HIGH_THRESHOLD = 70;
const QUOTA_MEDIUM_THRESHOLD = 30;

export type QuotaLevel = 'high' | 'medium' | 'low';

/** Color band for a remaining percent: green at 70+, amber at 30+, red below. Null stays uncolored. */
export function quotaLevel(percent: number | null): QuotaLevel | null {
  if (percent === null) return null;
  if (percent >= QUOTA_HIGH_THRESHOLD) return 'high';
  if (percent >= QUOTA_MEDIUM_THRESHOLD) return 'medium';
  return 'low';
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const remainingFromUsed = (used: number | null | undefined): number | null =>
  typeof used === 'number' && Number.isFinite(used) ? clampPercent(100 - used) : null;

const usableMs = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Windows listed here lead the row, in this order; the rest keep provider order.
 * The first one is what the summary tile headlines, so it is the limit that
 * binds longest: Fable 5 on Claude Max, the weekly window on Codex.
 */
const LEADING_WINDOW_IDS: Partial<Record<QuotaProviderType, readonly string[]>> = {
  claude: ['seven-day-fable', 'five-hour', 'seven-day'],
  codex: ['weekly', 'five-hour'],
};

function orderWindows(provider: QuotaProviderType, windows: LedgerWindow[]): LedgerWindow[] {
  const leading = LEADING_WINDOW_IDS[provider];
  if (!leading) return windows;
  const rank = (window: LedgerWindow) => {
    const index = leading.indexOf(window.id);
    return index === -1 ? leading.length : index;
  };
  return windows
    .map((window, index) => ({ window, index }))
    .sort((a, b) => rank(a.window) - rank(b.window) || a.index - b.index)
    .map(({ window }) => window);
}

/** Every limit on one credential, or an empty list when its quota is not loaded. */
export function buildLedgerWindows(
  provider: QuotaProviderType,
  quota: { status?: string } | undefined,
  t: TFunction
): LedgerWindow[] {
  if (!quota || quota.status !== 'success') return [];
  return orderWindows(provider, readWindows(provider, quota, t));
}

function readWindows(provider: QuotaProviderType, quota: unknown, t: TFunction): LedgerWindow[] {
  switch (provider) {
    case 'claude':
    case 'codex': {
      const state = quota as ClaudeQuotaState | CodexQuotaState;
      return (state.windows ?? []).map((window) => ({
        id: window.id,
        label: window.labelKey
          ? t(window.labelKey, ('labelParams' in window ? window.labelParams : undefined) ?? {})
          : window.label,
        remaining: remainingFromUsed(window.usedPercent),
        resetAtMs: usableMs(window.resetAtMs),
        resetHint: window.resetLabel || null,
      }));
    }
    case 'devin':
      return ((quota as DevinQuotaState).windows ?? []).map((window) => ({
        id: window.id,
        label: t(`devin_quota.${window.id}`),
        remaining: window.remainingPercent === null ? null : clampPercent(window.remainingPercent),
        resetAtMs: usableMs(window.resetAtMs),
        resetHint: null,
      }));
    case 'kimi':
      return ((quota as KimiQuotaState).rows ?? []).map((row) => ({
        id: row.id,
        label: row.labelKey ? t(row.labelKey, row.labelParams ?? {}) : (row.label ?? ''),
        // Kimi reports raw counts; a zero limit with usage means exhausted.
        remaining:
          row.limit > 0
            ? clampPercent(Math.round(((row.limit - row.used) / row.limit) * 100))
            : row.used > 0
              ? 0
              : null,
        resetAtMs: usableMs(row.resetAtMs),
        resetHint: row.resetAtMs == null ? formatKimiResetHint(t, row.resetHint) : null,
      }));
    case 'meta':
      return ((quota as MetaQuotaState).data?.windows ?? []).map((window) => ({
        id: window.id,
        label:
          window.id === 'window' && window.durationMinutes
            ? t('meta_quota.window_duration', { minutes: window.durationMinutes })
            : t(`meta_quota.${window.id}`),
        remaining: remainingFromUsed(window.usedPercent),
        resetAtMs: window.resetAt === undefined ? null : usableMs(window.resetAt * 1000),
        resetHint: null,
      }));
    case 'antigravity': {
      const groups = (quota as AntigravityQuotaState).groups ?? [];
      // Bucket ids and names repeat across groups ("Weekly limit"), so scope both to the group.
      return groups.flatMap((group) =>
        group.buckets.map((bucket) => {
          const bucketLabel = antigravityBucketLabel(bucket.label, t);
          return {
            id: `${group.id}:${bucket.id}`,
            label:
              groups.length > 1
                ? `${antigravityGroupLabel(group.label, t)} · ${bucketLabel}`
                : bucketLabel,
            remaining: clampPercent(bucket.remainingFraction * 100),
            resetAtMs: usableMs(bucket.resetAtMs) ?? parseIsoToMs(bucket.resetTime),
            resetHint: null,
          };
        })
      );
    }
    case 'xai': {
      const billing = (quota as XaiQuotaState).billing;
      if (!billing || billing.mode !== 'billing') return [];
      const windows: LedgerWindow[] = [];
      if (billing.periodType === 'weekly') {
        windows.push({
          id: 'weekly',
          label: t('xai_quota.weekly_limit'),
          remaining: remainingFromUsed(billing.usagePercent),
          resetAtMs: usableMs(billing.resetAtMs),
          resetHint: null,
        });
      }
      if ((billing.monthlyLimitCents ?? 0) > 0) {
        windows.push({
          id: 'monthly',
          label: t('xai_quota.monthly_credits'),
          remaining: remainingFromUsed(billing.usedPercent),
          resetAtMs: parseIsoToMs(billing.billingPeriodEnd),
          resetHint: null,
        });
      }
      if ((billing.onDemandCapCents ?? 0) > 0) {
        windows.push({
          id: 'on-demand',
          label: t('xai_quota.pay_as_you_go_label'),
          remaining: remainingFromUsed(billing.onDemandUsedPercent),
          resetAtMs: null,
          resetHint: null,
        });
      }
      return windows;
    }
  }
}

/** Plan name shown under the credential, or null when the provider sent none. */
export function ledgerPlanLabel(
  provider: QuotaProviderType,
  quota: { status?: string } | undefined,
  t: TFunction
): string | null {
  if (!quota || quota.status !== 'success') return null;
  switch (provider) {
    case 'claude': {
      const planType = (quota as ClaudeQuotaState).planType;
      return planType ? t(`claude_quota.${planType}`) : null;
    }
    case 'codex':
      return codexPlanLabel(t, (quota as CodexQuotaState).planType);
    case 'antigravity':
      return antigravityPlanLabel((quota as AntigravityQuotaState).subscription, t);
    case 'devin':
      return (quota as DevinQuotaState).plan || null;
    case 'meta':
      return (quota as MetaQuotaState).data?.planName || null;
    case 'xai': {
      const billing = (quota as XaiQuotaState).billing;
      if (!billing) return null;
      if (billing.planLabel) return billing.planLabel;
      if (billing.mode === 'paid-health') return t('xai_quota.plan_paid');
      const plan = resolveXaiPlan(billing.monthlyLimitCents);
      return plan ? t(`xai_quota.${plan.labelKey}`) : null;
    }
    case 'kimi':
      return null;
  }
}

/**
 * Pool each limit across a provider's credentials.
 *
 * `credentials` holds one window list per credential, in display order. An
 * empty list (not loaded, failed) still counts toward capacity and shows as a
 * blank segment: "17% of 300%" with one dark segment says an account is
 * unread, where "17% of 200%" would silently drop it.
 *
 * Limits are ordered by how many credentials report them, then by first
 * appearance, so the headline is the limit the pool shares.
 */
export function poolLedgerWindows(
  credentials: readonly (readonly LedgerWindow[])[],
  nowMs: number
): PooledWindow[] {
  const pools = new Map<string, PooledWindow & { coverage: number; order: number }>();

  credentials.forEach((windows, credentialIndex) => {
    // A credential reporting the same id twice keeps its first figure.
    const seen = new Set<string>();
    for (const window of windows) {
      if (seen.has(window.id)) continue;
      seen.add(window.id);
      let pool = pools.get(window.id);
      if (!pool) {
        pool = {
          id: window.id,
          label: window.label,
          total: null,
          capacity: credentials.length * 100,
          segments: credentials.map(() => null),
          soonestResetMs: null,
          coverage: 0,
          order: pools.size,
        };
        pools.set(window.id, pool);
      }
      pool.coverage += 1;
      if (window.remaining !== null) {
        pool.segments[credentialIndex] = window.remaining;
        pool.total = (pool.total ?? 0) + window.remaining;
      }
      if (
        window.resetAtMs !== null &&
        window.resetAtMs > nowMs &&
        (pool.soonestResetMs === null || window.resetAtMs < pool.soonestResetMs)
      ) {
        pool.soonestResetMs = window.resetAtMs;
      }
    }
  });

  return [...pools.values()]
    .sort((a, b) => b.coverage - a.coverage || a.order - b.order)
    .map(({ coverage: _coverage, order: _order, ...pooled }) => pooled);
}

const EMAIL_PATTERN = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+)/g;

/**
 * Mask emails inside a credential name for screen sharing.
 *
 * Keeps any `provider-` style prefix and the first letter of the mailbox and
 * domain: `claude-tom@lunar.dev.json` becomes `claude-t•••@l•••.dev.json`.
 * Display only; search still matches the real name.
 */
export function maskEmails(value: string): string {
  return value.replace(EMAIL_PATTERN, (_match, local: string, domainHead: string) => {
    const keep = local.slice(0, local.lastIndexOf('-') + 2);
    return `${keep}•••@${domainHead.slice(0, 1)}•••`;
  });
}
