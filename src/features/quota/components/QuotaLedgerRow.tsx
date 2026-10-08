/**
 * Ledger row: one credential with its leading limits inline and full provider
 * details behind a disclosure.
 *
 * - idle: the limits area is a click-to-load button (no automatic upstream calls);
 * - loading: ghost meters (aria-busy, visually hidden text equivalent);
 * - error: failure strip, Refresh Quota retries;
 * - success: up to three limits inline, the provider Body in the details panel.
 */

import { useId, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown, IconRefreshCw } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import { buildResetDisplay, resolveQuotaErrorMessage } from '@/utils/quota';
import { HOUR_MS } from '@/utils/time/durations';
import { bindQuotaClasses } from '../types';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { quotaLevel, type LedgerWindow } from '../ledgerModel';
import { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';
import { ClaudeResetGrantDetails } from '../providers/claude/ClaudeResetGrantDetails';
import bodyStyles from './QuotaBody.module.scss';
import styles from './QuotaLedgerRow.module.scss';

/** Full-page skin for the provider bodies (a missing class throws at module load). */
const quotaClasses = bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss');

/** Limits shown inline; the rest live in the details panel. */
export const LEDGER_INLINE_LIMITS = 3;

export type QuotaLedgerRowProps = {
  entry: QuotaFileEntry;
  quota?: QuotaCardState;
  /** Name as displayed, already masked when emails are hidden. */
  displayName: string;
  planLabel: string | null;
  windows: LedgerWindow[];
  canRefresh: boolean;
  resetting: boolean;
  /** First-render cascade delay; null skips the entrance (tab switch, paging, refresh). */
  entranceDelayMs?: number | null;
  onRefresh: () => void;
  onReset: () => void;
};

export function QuotaLedgerRow(props: QuotaLedgerRowProps) {
  const {
    entry,
    quota,
    displayName,
    planLabel,
    windows,
    canRefresh,
    resetting,
    entranceDelayMs,
    onRefresh,
    onReset,
  } = props;
  const { t, i18n } = useTranslation();
  const adapter = QUOTA_ADAPTERS[entry.type];
  const now = useNow();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();

  // Captured once at mount so later null props don't replay the entrance.
  const [mountEntranceDelayMs] = useState<number | null>(entranceDelayMs ?? null);
  const entranceStyle =
    mountEntranceDelayMs === null
      ? undefined
      : ({ '--row-delay': `${mountEntranceDelayMs}ms` } as CSSProperties);

  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const claudeReset = useClaudeResetGrants(
    entry.file,
    entry.type === 'claude' && status !== 'idle',
    !canRefresh || loading || resetting,
    quota,
    onRefresh
  );
  const errorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );
  const showReset =
    status === 'success' &&
    Boolean(adapter.resetQuota) &&
    quota !== undefined &&
    Boolean(adapter.canResetQuota?.(quota));
  const hiddenCount = Math.max(0, windows.length - LEDGER_INLINE_LIMITS);
  const canExpand = status === 'success' && quota !== undefined;

  return (
    <li
      className={`${styles.row} ${mountEntranceDelayMs === null ? '' : styles.rowEnter}`}
      style={entranceStyle}
    >
      <div className={styles.main}>
        <div className={styles.identity}>
          <span className={styles.name} title={displayName}>
            {displayName}
          </span>
          {planLabel && <span className={styles.plan}>{planLabel}</span>}
        </div>

        <div className={styles.limits}>
          {status === 'idle' ? (
            <button
              type="button"
              className={styles.loadButton}
              onClick={onRefresh}
              disabled={!canRefresh}
            >
              <IconRefreshCw size={13} aria-hidden="true" />
              {t('quota_management.load_quota')}
            </button>
          ) : loading ? (
            <div className={styles.skeleton} aria-busy="true">
              <span className={styles.srOnly}>{t(`${adapter.i18nPrefix}.loading`)}</span>
              {Array.from({ length: LEDGER_INLINE_LIMITS }, (_, index) => (
                <span key={index} className={styles.skeletonCell} aria-hidden="true" />
              ))}
            </div>
          ) : status === 'error' ? (
            <div className={styles.errorStrip} role="alert">
              {t(`${adapter.i18nPrefix}.load_failed`, { message: errorMessage })}
            </div>
          ) : windows.length === 0 ? (
            <div className={styles.emptyLimits}>{t('quota_management.no_limits')}</div>
          ) : (
            windows
              .slice(0, LEDGER_INLINE_LIMITS)
              .map((window, index) => (
                <LimitCell
                  key={window.id}
                  window={window}
                  index={index}
                  now={now}
                  locale={i18n.resolvedLanguage}
                />
              ))
          )}
        </div>

        <div className={styles.actions}>
          {status !== 'idle' && (
            <button
              type="button"
              className={styles.ghostAction}
              onClick={onRefresh}
              disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting || claudeReset.busy)}
              title={t('auth_files.quota_refresh_hint')}
            >
              <IconRefreshCw size={13} className={loading ? styles.spinning : undefined} />
              {t('auth_files.quota_refresh_single')}
            </button>
          )}
          {canExpand && (
            <button
              type="button"
              className={styles.expandButton}
              aria-expanded={expanded}
              aria-controls={detailsId}
              aria-label={
                expanded
                  ? t('quota_management.details_hide', { name: displayName })
                  : t('quota_management.details_show', { name: displayName })
              }
              onClick={() => setExpanded((value) => !value)}
            >
              {hiddenCount > 0 && <span className={styles.moreCount}>+{hiddenCount}</span>}
              <IconChevronDown
                size={15}
                aria-hidden="true"
                className={expanded ? styles.chevronOpen : styles.chevron}
              />
            </button>
          )}
        </div>
      </div>

      {canExpand && expanded && (
        <div id={detailsId} className={styles.details}>
          {entry.type === 'claude' && (
            <>
              <div className={quotaClasses.codexPlan}>
                <span className={quotaClasses.codexPlanItem}>
                  <span className={quotaClasses.codexPlanLabel}>{t('claude_reset.remaining')}</span>
                  <span className={quotaClasses.codexPlanValue}>{claudeReset.count ?? '--'}</span>
                </span>
              </div>
              <ClaudeResetGrantDetails grants={claudeReset.grants} classes={quotaClasses} />
            </>
          )}
          <adapter.Body quota={quota} classes={quotaClasses} />
          {(entry.type === 'claude' || showReset) && (
            <div className={styles.detailActions}>
              {entry.type === 'claude' && (
                <button
                  type="button"
                  className={styles.ghostAction}
                  disabled={claudeReset.blocked}
                  onClick={claudeReset.confirm}
                  title={t(`claude_reset.${claudeReset.buttonLabel}`)}
                >
                  <IconRefreshCw
                    size={13}
                    className={claudeReset.busy ? styles.spinning : undefined}
                  />
                  {t(`claude_reset.${claudeReset.buttonLabel}`)}
                </button>
              )}
              {showReset && (
                <button
                  type="button"
                  className={styles.ghostAction}
                  onClick={onReset}
                  disabled={!canRefresh || loading || resetting}
                  title={t('codex_quota.reset_button')}
                >
                  <IconRefreshCw size={13} className={resetting ? styles.spinning : undefined} />
                  {t('codex_quota.reset_button')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Reset outcomes stay visible with the details collapsed. */}
      {entry.type === 'claude' && claudeReset.message && (
        <div role="status" className={styles.rowMessage}>
          {t(`claude_reset.${claudeReset.message}`)}
        </div>
      )}
    </li>
  );
}

type LimitCellProps = {
  window: LedgerWindow;
  index: number;
  now: number;
  locale?: string;
};

/** One inline limit: label and percent, a meter, then the reset countdown. */
function LimitCell({ window, index, now, locale }: LimitCellProps) {
  const { t } = useTranslation();
  const level = quotaLevel(window.remaining);
  const reset = buildResetDisplay(window.resetHint, window.resetAtMs, now, locale);
  // Matches the detail bodies: only the final hour before a reset is urgent.
  const soon =
    window.resetAtMs !== null && window.resetAtMs > now && window.resetAtMs - now < HOUR_MS;

  return (
    <div className={styles.limit}>
      <div className={styles.limitHead}>
        <span className={styles.limitLabel} title={window.label}>
          {window.label}
        </span>
        <span className={styles.limitPercent}>
          {window.remaining === null ? '--' : `${Math.round(window.remaining)}%`}
        </span>
      </div>
      <div
        className={styles.meter}
        role={window.remaining === null ? undefined : 'meter'}
        aria-label={window.remaining === null ? undefined : window.label}
        aria-valuemin={window.remaining === null ? undefined : 0}
        aria-valuemax={window.remaining === null ? undefined : 100}
        aria-valuenow={window.remaining === null ? undefined : Math.round(window.remaining)}
      >
        {window.remaining !== null && (
          <span
            className={`${styles.meterFill} ${level ? styles[level] : ''}`}
            style={
              {
                width: `${window.remaining}%`,
                '--meter-index': index,
              } as CSSProperties
            }
          />
        )}
      </div>
      <div className={soon ? `${styles.limitReset} ${styles.limitResetSoon}` : styles.limitReset}>
        {reset ? (
          <>
            {reset.relative && <span>{reset.relative}</span>}
            <span className={styles.limitResetAbsolute}>{reset.absolute}</span>
          </>
        ) : (
          <span>{t('quota_management.no_reset_pending')}</span>
        )}
      </div>
    </div>
  );
}
