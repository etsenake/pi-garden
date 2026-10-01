import type { VariantProps } from "class-variance-authority";
import type { badgeVariants } from "@/ui/shadcn/badge";

/** The semantic tones host contributions and extension status labels use. */
export type HostTone = "default" | "accent" | "success" | "warning" | "error" | "muted";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

/**
 * Tones map onto Badge variants. shadcn ships no accent, success or warning variant, so
 * those three keep the outline badge and take their ink from the existing theme tokens.
 */
const TONE_BADGE: Readonly<
  Record<HostTone, { readonly variant: BadgeVariant; readonly className?: string }>
> = {
  default: { variant: "secondary" },
  muted: { variant: "ghost", className: "text-muted-foreground" },
  error: { variant: "destructive" },
  accent: { variant: "outline", className: "text-(--accent)" },
  success: { variant: "outline", className: "text-(--success)" },
  warning: { variant: "outline", className: "text-(--warning)" },
};

export function toneBadge(tone: HostTone | undefined): {
  readonly variant: BadgeVariant;
  readonly className?: string;
} {
  return TONE_BADGE[tone ?? "default"] ?? TONE_BADGE.default;
}
