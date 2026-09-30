import { isHeaderBadgeDeclaration } from "@pi-garden/extension-ui";
import { sessionKey, type SessionRef } from "@pi-garden/session-driver";
import type { HeaderBadgePresentation } from "../../contracts/header-badges";

export interface HeaderBadgeRuntimeInput {
  readonly target: SessionRef;
  readonly generation: string;
  readonly badges: readonly unknown[];
}

interface SessionBadges {
  readonly generation: string;
  readonly target: SessionRef;
  readonly badges: readonly HeaderBadgePresentation[];
}

/**
 * Presents header badges for one Pi extension runtime generation.
 * A generation that has already been replaced or invalidated cannot publish again.
 */
export class HeaderBadgeOwner {
  private readonly sessions = new Map<string, SessionBadges>();
  private readonly retired = new Map<string, Set<string>>();
  private readonly listeners = new Set<(target: SessionRef) => void>();

  subscribe(listener: (target: SessionRef) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  list(target: SessionRef): readonly HeaderBadgePresentation[] {
    const current = this.sessions.get(sessionKey(target));
    return current ? current.badges.map((badge) => ({ ...badge })) : [];
  }

  replaceRuntime(input: HeaderBadgeRuntimeInput): void {
    const key = sessionKey(input.target);
    if (this.isRetired(key, input.generation)) return;
    const current = this.sessions.get(key);
    if (current && current.generation !== input.generation) {
      this.retire(key, current.generation);
    }
    this.sessions.set(key, {
      generation: input.generation,
      target: { workspaceId: input.target.workspaceId, sessionId: input.target.sessionId },
      badges: presentHeaderBadges(input.badges),
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

function presentHeaderBadges(badges: readonly unknown[]): readonly HeaderBadgePresentation[] {
  const byId = new Map<string, HeaderBadgePresentation>();
  for (const badge of badges) {
    if (!isHeaderBadgeDeclaration(badge)) continue;
    byId.set(badge.id, { id: badge.id, text: badge.text });
  }
  return [...byId.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}
