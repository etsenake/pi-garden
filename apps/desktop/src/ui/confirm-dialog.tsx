import { useSyncExternalStore } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/shadcn/alert-dialog";

export interface ConfirmOptions {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
}

interface ConfirmRequest extends ConfirmOptions {
  readonly resolve: (confirmed: boolean) => void;
}

interface ConfirmState {
  readonly request: ConfirmRequest | null;
  readonly open: boolean;
}

let state: ConfirmState = { request: null, open: false };
const listeners = new Set<() => void>();

function setState(next: ConfirmState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function settle(confirmed: boolean): void {
  if (!state.open || !state.request) return;
  state.request.resolve(confirmed);
  // Keep the request so the content stays rendered through the close animation.
  setState({ request: state.request, open: false });
}

/**
 * Asks the user to confirm a destructive action in an app-styled alert dialog, the
 * renderer's replacement for `window.confirm`. Resolves `false` on Cancel or Escape,
 * and when a newer confirmation replaces this one.
 */
export function confirmDestructive(options: ConfirmOptions): Promise<boolean> {
  settle(false);
  return new Promise((resolve) => {
    setState({ request: { ...options, resolve }, open: true });
  });
}

/** Renders the pending `confirmDestructive` request; mount once next to the app. */
export function ConfirmDialogHost() {
  const { request, open } = useSyncExternalStore(subscribe, () => state);
  if (!request) return null;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) settle(false);
      }}
      onOpenChangeComplete={(next) => {
        if (!next && !state.open) setState({ request: null, open: false });
      }}
    >
      <AlertDialogContent data-testid="confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{request.title}</AlertDialogTitle>
          <AlertDialogDescription>{request.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => settle(true)}>
            {request.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
