import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import type { ResolvedTheme } from '@/types';
import { buildResetDisplay } from '@/utils/quota';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import {
  poolLedgerWindows,
  quotaLevel,
  type LedgerWindow,
  type PooledWindow,
} from '../ledgerModel';
import type { QuotaProviderType } from '../providers/types';
import styles from './QuotaSummary.module.scss';

/**
 * One tile's input. `credentials` holds each credential's limits in display
 * order; an empty list marks a credential whose quota is not loaded.
 */
export type QuotaSummaryGroup = {
  key: string;
  provider: QuotaProviderType;
  credentials: LedgerWindow[][];
};

export type QuotaSummaryProps = {
  groups: QuotaSummaryGroup[];
  /** Per provider: one tile per provider. Per window: one tile per limit of a single provider. */
  mode: 'provider' | 'window';
  resolvedTheme: ResolvedTheme;
};

type SummaryTileModel = {
  key: string;
  provider: QuotaProviderType;
  count: number;
  /** Null on provider tiles, which use the provider name. */
  title: string | null;
  pooled: PooledWindow[];
};

/**
 * Pooled capacity strip above the ledger: how much of each provider's quota is
 * left across all its credentials, and when the next window resets.
 */
export function QuotaSummary({ groups, mode, resolvedTheme }: QuotaSummaryProps) {
  const { t } = useTranslation();
  const now = useNow();

  const tiles = useMemo(
    () =>
      groups.flatMap((group): SummaryTileModel[] => {
        const pooled = poolLedgerWindows(group.credentials, now);
        const count = group.credentials.length;
        if (mode === 'provider') {
          return [{ key: group.key, provider: group.provider, count, title: null, pooled }];
        }
        return pooled.map((window) => ({
          key: `${group.key}:${window.id}`,
          provider: group.provider,
          count,
          title: window.label,
          pooled: [window],
        }));
      }),
    [groups, mode, now]
  );

  if (tiles.length === 0) return null;

  return (
    <section className={styles.strip} aria-label={t('quota_management.summary_label')}>
      {tiles.map((tile) => (
        <SummaryTile
          key={tile.key}
          provider={tile.provider}
          title={tile.title ?? getTypeLabel(t, tile.provider)}
          count={tile.count}
          pooled={tile.pooled}
          showHeadlineLabel={mode === 'provider'}
          now={now}
          resolvedTheme={resolvedTheme}
        />
      ))}
    </section>
  );
}

type SummaryTileProps = {
  provider: QuotaProviderType;
  title: string;
  count: number;
  /** First entry is the headline; the rest are listed in the footer. */
  pooled: PooledWindow[];
  /** Provider tiles name their headline limit; window tiles already use it as the title. */
  showHeadlineLabel: boolean;
  now: number;
  resolvedTheme: ResolvedTheme;
};

function SummaryTile(props: SummaryTileProps) {
  const { provider, title, count, pooled, showHeadlineLabel, now, resolvedTheme } = props;
  const { t, i18n } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const extraListId = useId();
  const [headline, ...extras] = pooled;
  const iconSrc = getAuthFileIcon(provider, resolvedTheme);
  const typeLabel = getTypeLabel(t, provider);
  const total = headline?.total ?? null;
  const capacity = count * 100;
  const totalLabel = total === null ? '--' : `${Math.round(total)}%`;
  const reset = buildResetDisplay(null, headline?.soonestResetMs, now, i18n.resolvedLanguage);
  // The first extra limit always shows; the toggle reveals the rest.
  const visibleExtras = showAll ? extras : extras.slice(0, 1);

  return (
    <article className={styles.tile}>
      <header className={styles.tileHead}>
        <span
          className={styles.iconWrap}
          style={
            isThemeSurfaceIconProvider(provider)
              ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
              : undefined
          }
        >
          {iconSrc ? (
            <img src={iconSrc} alt="" className={styles.icon} />
          ) : (
            <span className={styles.iconFallback}>{typeLabel.slice(0, 1).toUpperCase()}</span>
          )}
        </span>
        <h2 className={styles.tileTitle} title={title}>
          {title}
        </h2>
        <span className={styles.tileCount}>
          {t('quota_management.summary_credentials', { count })}
        </span>
      </header>

      {showHeadlineLabel && (
        // Unloaded providers keep the line so every tile's figure sits at the same height.
        <div className={styles.headlineLabel}>{headline?.label ?? '\u00a0'}</div>
      )}
      <p className={styles.figure}>
        <span className={styles.total}>{totalLabel}</span>
        <span className={styles.capacity}>
          {t('quota_management.summary_capacity', { capacity })}
        </span>
      </p>

      <div
        className={styles.segments}
        role="img"
        aria-label={t('quota_management.summary_segments', { total: totalLabel, capacity })}
      >
        {(headline?.segments ?? Array.from({ length: count }, () => null)).map((value, index) => {
          const level = quotaLevel(value);
          return (
            <span key={index} className={styles.segment}>
              {value !== null && (
                <span
                  className={`${styles.segmentFill} ${level ? styles[level] : ''}`}
                  style={{ width: `${value}%` }}
                />
              )}
            </span>
          );
        })}
      </div>

      <p className={styles.reset}>
        {reset ? (
          <>
            <span>{reset.relative}</span>
            <span className={styles.resetAbsolute}>{reset.absolute}</span>
          </>
        ) : (
          <span>{t('quota_management.no_reset_pending')}</span>
        )}
      </p>

      {extras.length > 0 && (
        <footer className={styles.extras}>
          <ul className={styles.extraList} id={extraListId}>
            {visibleExtras.map((extra) => (
              <li key={extra.id} className={styles.extraItem}>
                <span className={styles.extraLabel} title={extra.label}>
                  {extra.label}
                </span>
                <span className={styles.extraValue}>
                  {extra.total === null ? '--' : `${Math.round(extra.total)}%`}
                </span>
              </li>
            ))}
          </ul>
          {extras.length > 1 && (
            <button
              type="button"
              className={styles.extraToggle}
              aria-expanded={showAll}
              aria-controls={extraListId}
              aria-label={
                showAll
                  ? t('quota_management.summary_hide')
                  : t('quota_management.summary_show', { count: extras.length - 1 })
              }
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll ? t('quota_management.summary_hide') : `+${extras.length - 1}`}
            </button>
          )}
        </footer>
      )}
    </article>
  );
}
