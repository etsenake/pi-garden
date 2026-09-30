import {
  compareSurfaceContributions,
  normalizeSurfaceContribution,
  surfaceContributionKey,
} from "@pi-garden/extension-ui";
import { sessionKey, type SessionRef } from "@pi-garden/session-driver";
import type { SurfaceContributionPresentation } from "../../contracts/surface-contributions";

export interface SurfaceRegistryRuntimeInput {
  readonly target: SessionRef;
  readonly generation: string;
  readonly contributions: readonly unknown[];
}

interface SessionContributions {
  readonly generation: string;
  readonly target: SessionRef;
  readonly contributions: readonly SurfaceContributionPresentation[];
}

/**
 * Presents host-rendered surface contributions for one Pi extension runtime generation.
 * A generation that has already been replaced or invalidated cannot publish again.
 */
export class SurfaceRegistry {
  private readonly sessions = new Map<string, SessionContributions>();
  private readonly retired = new Map<string, Set<string>>();
  private readonly listeners = new Set<(target: SessionRef) => void>();

  subscribe(listener: (target: SessionRef) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  list(target: SessionRef): readonly SurfaceContributionPresentation[] {
    const current = this.sessions.get(sessionKey(target));
    return current ? current.contributions.map((contribution) => ({ ...contribution })) : [];
  }

  replaceRuntime(input: SurfaceRegistryRuntimeInput): void {
    const key = sessionKey(input.target);
    if (this.isRetired(key, input.generation)) return;
    const current = this.sessions.get(key);
    if (current && current.generation !== input.generation) {
      this.retire(key, current.generation);
    }
    this.sessions.set(key, {
      generation: input.generation,
      target: { workspaceId: input.target.workspaceId, sessionId: input.target.sessionId },
      contributions: presentContributions(input.contributions),
    });
    this.publish(input.target);
  }

  invalidateRuntime(target: SessionRef, generation: string): void {
    const key = sessionKey(target);
    this.retire(key, generation);
    const current = this.sessions.get(key);
    if (current?.generation !== generation) return;
    this.sessions.delete(key);
    this.publish(target);
  }

  private isRetired(key: string, generation: string): boolean {
    return this.retired.get(key)?.has(generation) ?? false;
  }

  private retire(key: string, generation: string): void {
    const generations = this.retired.get(key) ?? new Set<string>();
    generations.add(generation);
    this.retired.set(key, generations);
  }

  private publish(target: SessionRef): void {
    for (const listener of this.listeners) listener(target);
  }
}

function presentContributions(
  contributions: readonly unknown[],
): readonly SurfaceContributionPresentation[] {
  const byKey = new Map<string, SurfaceContributionPresentation>();
  for (const contribution of contributions) {
    const normalized = normalizeSurfaceContribution(contribution);
    if (!normalized) continue;
    byKey.set(surfaceContributionKey(normalized), normalized);
  }
  return [...byKey.values()].sort(compareSurfaceContributions);
}
