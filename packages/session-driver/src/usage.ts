import type { Timestamp } from "./types.js";

/** Token counts in one of pi's usage buckets. */
export interface SessionTokenCounts {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

export interface SessionContextUsage {
  /** Tokens the next request will carry; null right after compaction until the model replies. */
  readonly tokens: number | null;
  readonly contextWindow: number;
  /** Token count at which pi compacts automatically; absent when auto-compaction is off. */
  readonly compactAtTokens?: number;
}

/**
 * What is known about the provider's prompt cache for the current model. Both
 * times are absolute so readers can count down without new snapshots; pi can
 * stop warming without an event, so a past `nextRefreshAt` means no refresh is
 * coming and `expiresAt` applies.
 */
export interface SessionPromptCache {
  /** Cache lifetime the model declares; absent when it declares none, so expiry is unknowable. */
  readonly lifetimeSeconds?: number;
  /** When the entry lapses unless touched; absent when the model declares no cache lifetime. */
  readonly expiresAt?: Timestamp;
  /** When pi's cache warmer plans its next refresh; absent when warming is not scheduled. */
  readonly nextRefreshAt?: Timestamp;
}

/** One provider-reported plan limit window, such as a 5-hour or weekly limit. */
export interface SessionPlanLimit {
  readonly windowMinutes: number;
  readonly usedPercent: number;
  readonly resetsAt?: Timestamp;
}

export interface SessionPlanLimits {
  readonly provider: string;
  readonly limits: readonly SessionPlanLimit[];
  readonly reportedAt: Timestamp;
}

/** One physical model's share of session cost when virtual routing (or multi-model use) applies. */
export interface SessionModelCost {
  readonly provider: string;
  readonly model: string;
  readonly cost: number;
  readonly tokens: SessionTokenCounts;
}

/** Context, cache and usage for one session, read from pi at turn boundaries. */
export interface SessionUsageSnapshot {
  readonly context?: SessionContextUsage;
  /** Prompt tokens of the latest reply, for the cache hit rate. */
  readonly lastTurn?: SessionTokenCounts;
  readonly cache: SessionPromptCache;
  /**
   * Totals for the whole session, including compaction, cache-warming, and nested
   * tool usage Pi attributes onto tool results (via `getSessionStats`).
   */
  readonly totals: SessionTokenCounts & { readonly cost: number };
  /**
   * Cost broken down by physical model when the session used more than one.
   * Absent when every charged request used a single model (or Pi exposes none).
   */
  readonly costByModel?: readonly SessionModelCost[];
  /**
   * Under a virtual model selection, the physical model of the latest successful
   * reply (`session.routedModel`). Absent when not virtually routed.
   */
  readonly routedModel?: {
    readonly provider: string;
    readonly model: string;
  };
  /** True when the provider bills through a subscription, so `totals.cost` is not money spent. */
  readonly subscription: boolean;
  readonly planLimits?: SessionPlanLimits;
}
