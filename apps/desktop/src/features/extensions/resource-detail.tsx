import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/ui/shadcn/button";
import { Switch } from "@/ui/shadcn/switch";

/** Drill-in page for one skill or extension, in the style of Codex's Hooks detail. */
export function ResourceDetail({
  backLabel,
  icon,
  title,
  subtitle,
  enabled,
  onToggle,
  actions,
  onBack,
  children,
}: {
  readonly backLabel: string;
  readonly icon: ReactNode;
  readonly title: string;
  readonly subtitle: string;
  readonly enabled: boolean;
  /** Undefined when pi cannot change this item. */
  readonly onToggle?: (enabled: boolean) => void;
  readonly actions?: ReactNode;
  readonly onBack: () => void;
  readonly children: ReactNode;
}) {
  const backButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // The row that opened this page is gone, so keyboard focus starts here instead of the body.
    backButtonRef.current?.focus();
  }, []);
  const backRef = useRef(onBack);
  backRef.current = onBack;
  useEffect(() => {
    // Capture phase, so Escape returns to the list before the settings surface closes.
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      // Any open dialog (legacy or shadcn) owns Escape.
      if (document.querySelector("[aria-modal='true'], [role='dialog'], [role='alertdialog']")) {
        return;
      }
      event.preventDefault();
      backRef.current();
    };
    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, []);

  return (
    <div className="skill-detail resource-detail">
      <Button
        className="justify-self-start"
        ref={backButtonRef}
        size="sm"
        variant="ghost"
        onClick={onBack}
      >
        <span aria-hidden="true">←</span>
        <span>{backLabel}</span>
      </Button>
      <div className="resource-detail__header">
        <span className="resource-row__icon resource-row__icon--large" aria-hidden="true">
          {icon}
        </span>
        <div className="resource-detail__heading">
          <h2>{title}</h2>
          <div className="resource-detail__subtitle">{subtitle}</div>
        </div>
        <div className="resource-detail__actions">
          {actions}
          <Switch
            aria-label="Enabled"
            checked={enabled}
            disabled={!onToggle}
            onCheckedChange={(next) => onToggle?.(next)}
          />
        </div>
      </div>
      {children}
    </div>
  );
}

/** Shows a path relative to the workspace when it lives inside it. */
export function displayPath(path: string, workspacePath: string): string {
  const root = workspacePath.replace(/[\\/]+$/, "");
  if (path.startsWith(`${root}/`) || path.startsWith(`${root}\\`)) {
    return `.${path.slice(root.length)}`;
  }
  return path;
}
