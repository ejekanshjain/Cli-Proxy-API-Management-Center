import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import {
  buildLedgerWindows,
  ledgerPlanLabel,
  maskEmails,
  poolLedgerWindows,
  type LedgerWindow,
} from '@/features/quota/ledgerModel';
import { groupEntriesByProvider, type QuotaFileEntry } from '@/features/quota/logic';

const t = ((key: string) => key) as unknown as TFunction;

const win = (
  id: string,
  remaining: number | null,
  resetAtMs: number | null = null
): LedgerWindow => ({
  id,
  label: id,
  remaining,
  resetAtMs,
  resetHint: null,
});

describe('buildLedgerWindows', () => {
  test('returns nothing until quota loads', () => {
    expect(buildLedgerWindows('claude', undefined, t)).toEqual([]);
    expect(buildLedgerWindows('claude', { status: 'loading' }, t)).toEqual([]);
  });

  test('leads Claude with Fable 5 and converts percent used to remaining', () => {
    const quota = {
      status: 'success',
      windows: [
        { id: 'five-hour', label: '5h', usedPercent: 0, resetLabel: '-', resetAtMs: null },
        { id: 'seven-day', label: '7d', usedPercent: 21, resetLabel: '-', resetAtMs: 5 },
        { id: 'seven-day-fable', label: 'Fable', usedPercent: 142, resetLabel: '-', resetAtMs: 9 },
      ],
    };
    const windows = buildLedgerWindows('claude', quota, t);
    expect(windows.map((window) => window.id)).toEqual([
      'seven-day-fable',
      'five-hour',
      'seven-day',
    ]);
    expect(windows.map((window) => window.remaining)).toEqual([0, 100, 79]);
  });

  test('reads Antigravity fractions and scopes repeated buckets to their group', () => {
    const quota = {
      status: 'success',
      groups: [
        {
          id: 'a',
          label: 'Gemini',
          buckets: [{ id: 'weekly', label: 'Weekly', remainingFraction: 0.4 }],
        },
        {
          id: 'b',
          label: 'Claude',
          buckets: [{ id: 'weekly', label: 'Weekly', remainingFraction: 1 }],
        },
      ],
    };
    const windows = buildLedgerWindows('antigravity', quota, t);
    expect(windows.map((window) => [window.id, window.label, window.remaining])).toEqual([
      ['a:weekly', 'Gemini · Weekly', 40],
      ['b:weekly', 'Claude · Weekly', 100],
    ]);
  });

  test('derives Kimi remaining from raw counts', () => {
    const quota = {
      status: 'success',
      rows: [
        { id: 'week', label: 'Week', used: 30, limit: 120, resetAtMs: 10 },
        { id: 'spent', label: 'Spent', used: 4, limit: 0 },
      ],
    };
    expect(buildLedgerWindows('kimi', quota, t).map((window) => window.remaining)).toEqual([75, 0]);
  });

  test('reports no xAI limits for a paid account without billing figures', () => {
    const quota = { status: 'success', billing: { mode: 'paid-health', productUsage: [] } };
    expect(buildLedgerWindows('xai', quota, t)).toEqual([]);
    expect(ledgerPlanLabel('xai', quota, t)).toBe('xai_quota.plan_paid');
  });
});

describe('poolLedgerWindows', () => {
  test('counts unloaded credentials toward capacity as blank segments', () => {
    const [weekly] = poolLedgerWindows([[win('weekly', 17)], [], []], 0);
    expect(weekly).toMatchObject({ total: 17, capacity: 300, segments: [17, null, null] });
  });

  test('reports no total when no credential has a figure', () => {
    expect(poolLedgerWindows([[win('weekly', null)], []], 0)[0].total).toBeNull();
  });

  test('headlines the limit most credentials share', () => {
    const pooled = poolLedgerWindows(
      [[win('extra', 50), win('weekly', 10)], [win('weekly', 20)], [win('weekly', 30)]],
      0
    );
    expect(pooled.map((window) => [window.id, window.total])).toEqual([
      ['weekly', 60],
      ['extra', 50],
    ]);
  });

  test('picks the soonest reset that has not passed yet', () => {
    const pooled = poolLedgerWindows(
      [[win('weekly', 50, 900)], [win('weekly', 50, 400)], [win('weekly', 50, 100)]],
      200
    );
    expect(pooled[0].soonestResetMs).toBe(400);
  });
});

describe('maskEmails', () => {
  test('keeps the provider prefix and first letters', () => {
    expect(maskEmails('claude-tom@lunar.dev.json')).toBe('claude-t•••@l•••.dev.json');
    expect(maskEmails('codex-2a2b-sam@acme.com-plus.json')).toBe(
      'codex-2a2b-s•••@a•••.com-plus.json'
    );
  });

  test('leaves names without an email untouched', () => {
    expect(maskEmails('kimi-device.json')).toBe('kimi-device.json');
  });
});

test('groupEntriesByProvider keeps sorted order inside each provider', () => {
  const entry = (name: string, type: QuotaFileEntry['type']) =>
    ({ file: { name }, type }) as QuotaFileEntry;
  const groups = groupEntriesByProvider([
    entry('c2', 'codex'),
    entry('a1', 'claude'),
    entry('c1', 'codex'),
  ]);
  expect(groups.map((group) => [group.type, group.entries.map((item) => item.file.name)])).toEqual([
    ['codex', ['c2', 'c1']],
    ['claude', ['a1']],
  ]);
});
