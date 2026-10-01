import { useEffect, useState, type ReactNode } from "react";
import type {
  SessionPlanLimit,
  SessionPromptCache,
  SessionUsageSnapshot,
} from "@pi-garden/session-driver";
import { Button } from "@/ui/shadcn/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/ui/shadcn/hover-card";
import { Progress } from "@/ui/shadcn/progress";
import { Separator } from "@/ui/shadcn/separator";

interface ContextMeterProps {
  readonly usage: SessionUsageSnapshot | undefined;
}

const RING_RADIUS = 6;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Codex-style context ring beside the model picker. Hovering or focusing it
 * opens a card with pi's context, prompt-cache, plan-limit and thread usage.
 */
export function ContextMeter({ usage }: ContextMeterProps) {
  const [open, setOpen] = useState(false);
  const now = useNow(open && hasCountdown(usage));
  const context = usage?.context;
  if (!usage || !context) return null;

  const percent = context.tokens === null ? null : (context.tokens / context.contextWindow) * 100;
  const tone =
    percent === null ? "unknown" : percent > 90 ? "danger" : percent > 70 ? "warning" : "normal";
  const label =
    percent === null
      ? "Context window: usage unknown until the next reply"
      : `Context window: ${formatPercent(percent)} used`;

  return (
    <HoverCard open={open} onOpenChange={setOpen}>
      <HoverCardTrigger
        closeDelay={100}
        delay={100}
        render={
          <Button
            aria-label={label}
            className="context-meter__ring"
            data-tone={tone}
            size="icon-sm"
            variant="ghost"
          />
        }
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle className="context-meter__track" cx="8" cy="8" r={RING_RADIUS} />
          <circle
            className="context-meter__fill"
            cx="8"
            cy="8"
            r={RING_RADIUS}
            strokeDasharray={`${(Math.min(percent ?? 0, 100) / 100) * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
            transform="rotate(-90 8 8)"
          />
        </svg>
      </HoverCardTrigger>
      <HoverCardContent className="flex w-75 flex-col gap-2" side="top" sideOffset={8}>
        <Section title="Context window">
          <p className="font-medium tabular-nums">
            {context.tokens === null || percent === null
              ? `Unknown until the next reply · ${formatTokens(context.contextWindow)} window`
              : `${formatPercent(percent)} used · ${formatTokens(context.tokens)} / ${formatTokens(context.contextWindow)} tokens`}
          </p>
          {percent === null ? null : (
            <Progress
              aria-label="Context window used"
              className="my-1"
              value={Math.min(percent, 100)}
            />
          )}
          <p className="text-muted-foreground">
            {context.compactAtTokens === undefined
              ? "Automatic compaction is off"
              : `Compacts automatically at ${formatPercent((context.compactAtTokens / context.contextWindow) * 100)}`}
          </p>
        </Section>
        <Separator />
        <Section title="Prompt cache">
          {usage.lastTurn ? (
            <Row
              label="Last turn"
              value={`${formatPercent(cacheHitPercent(usage.lastTurn))} cached`}
            />
          ) : null}
          <CacheRow cache={usage.cache} now={now} />
        </Section>
        {usage.planLimits && usage.planLimits.limits.length > 0 ? (
          <>
            <Separator />
            <Section title="Plan limits">
              {usage.planLimits.limits.map((limit) => (
                <Row
                  key={limit.windowMinutes}
                  label={`${formatPercent(limit.usedPercent)} of ${windowLabel(limit)} limit`}
                  value={
                    limit.resetsAt
                      ? `resets in ${formatDuration(Date.parse(limit.resetsAt) - now)}`
                      : ""
                  }
                />
              ))}
            </Section>
          </>
        ) : null}
        <Separator />
        <Section title="This thread">
          <Row
            label="Input / Output"
            value={`${formatTokens(usage.totals.input)} / ${formatTokens(usage.totals.output)}`}
          />
          <Row
            label="Cache read / write"
            value={`${formatTokens(usage.totals.cacheRead)} / ${formatTokens(usage.totals.cacheWrite)}`}
          />
          <Row
            label="Cost"
            value={usage.subscription ? "Subscription" : `$${usage.totals.cost.toFixed(2)}`}
          />
          {usage.routedModel ? (
            <Row
              label="Routed model"
              value={`${usage.routedModel.provider}/${usage.routedModel.model}`}
            />
          ) : null}
          {usage.costByModel && usage.costByModel.length > 0
            ? usage.costByModel.map((entry) => (
                <Row
                  key={`${entry.provider}/${entry.model}`}
                  label={`${entry.provider}/${entry.model}`}
                  value={usage.subscription ? "Subscription" : `$${entry.cost.toFixed(2)}`}
                />
              ))
            : null}
        </Section>
      </HoverCardContent>
    </HoverCard>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5">
      <h3 className="text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}

function CacheRow({ cache, now }: { readonly cache: SessionPromptCache; readonly now: number }) {
  const nextRefreshIn = cache.nextRefreshAt ? Date.parse(cache.nextRefreshAt) - now : 0;
  if (nextRefreshIn > 0) {
    return <Row label="Kept warm" value={`next refresh in ${formatCountdown(nextRefreshIn)}`} />;
  }
  if (!cache.expiresAt) {
    return cache.lifetimeSeconds === undefined ? (
      <Row label="Expiry" value="not reported by this model" />
    ) : (
      <Row label="Expiry" value="nothing cached for this model yet" />
    );
  }
  const expiresIn = Date.parse(cache.expiresAt) - now;
  return expiresIn > 0 ? (
    <Row label="Expires in" value={formatCountdown(expiresIn)} />
  ) : (
    <Row label="Expiry" value="expired, next turn rewrites it" />
  );
}

function hasCountdown(usage: SessionUsageSnapshot | undefined): boolean {
  return Boolean(usage && (usage.cache.expiresAt || usage.cache.nextRefreshAt || usage.planLimits));
}

/** Current time; re-renders every second only while something on screen counts down. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  const [wasTicking, setWasTicking] = useState(ticking);
  if (ticking !== wasTicking) {
    // Read the clock during the render that opens the card, so it never shows a stale countdown.
    setWasTicking(ticking);
    setNow(Date.now());
  }
  useEffect(() => {
    if (!ticking) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [ticking]);
  return now;
}

function cacheHitPercent(turn: NonNullable<SessionUsageSnapshot["lastTurn"]>): number {
  const prompt = turn.input + turn.cacheRead + turn.cacheWrite;
  return prompt > 0 ? (turn.cacheRead / prompt) * 100 : 0;
}

function windowLabel(limit: SessionPlanLimit): string {
  if (limit.windowMinutes === 7 * 24 * 60) return "weekly";
  if (limit.windowMinutes === 24 * 60) return "daily";
  if (limit.windowMinutes % 60 === 0) return `${limit.windowMinutes / 60}-hour`;
  return `${limit.windowMinutes}-minute`;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    const millions = count / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : Number(millions.toFixed(1))}M`;
  }
  if (count >= 1000) return `${Math.round(count / 1000)}k`;
  return String(count);
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

/** m:ss for the short cache timers. */
function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

/** Coarse "1 d 16 h" / "2 hr 57 min" for plan-limit resets, like Claude's hover. */
function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} hr ${minutes} min`;
  return `${minutes} min`;
}
