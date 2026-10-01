import { Component, Fragment, type ReactNode } from "react";
import type { DesktopAppView, StateHydrationFailure } from "./desktop-app-state";
import { Button } from "@/ui/shadcn/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/ui/shadcn/card";
import { Spinner } from "@/ui/shadcn/spinner";

export type DesktopStartupSurfaceState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "failed";
      readonly failure: StateHydrationFailure;
      readonly retrying: boolean;
    }
  | { readonly kind: "crashed" };

export interface DesktopStartupCopy {
  readonly title: string;
  readonly body: string;
  readonly status: "loading" | "failed" | "crashed";
}

const LOADING_COPY: DesktopStartupCopy = {
  title: "Loading sessions",
  body: "The desktop shell is restoring folder and thread state from the main process.",
  status: "loading",
};

const STATE_FAILED_COPY: DesktopStartupCopy = {
  title: "Couldn't restore sessions",
  body: "The desktop shell couldn't read folder and thread state. Retry, or relaunch the app.",
  status: "failed",
};

const BRIDGE_FAILED_COPY: DesktopStartupCopy = {
  title: "Couldn't restore sessions",
  body: "The desktop shell isn't connected. Quit pi-garden and reopen it.",
  status: "failed",
};

const CRASHED_COPY: DesktopStartupCopy = {
  title: "Something went wrong",
  body: "The desktop window hit an unexpected error. Retry to remount, or relaunch the app.",
  status: "crashed",
};

export function startupSurfaceCopy(state: DesktopStartupSurfaceState): DesktopStartupCopy {
  if (state.kind === "loading") {
    return LOADING_COPY;
  }
  if (state.kind === "crashed") {
    return CRASHED_COPY;
  }
  if (state.failure.code === "bridge-unavailable") {
    return BRIDGE_FAILED_COPY;
  }
  return STATE_FAILED_COPY;
}

export function rendererBoundaryCopy(): DesktopStartupCopy {
  return CRASHED_COPY;
}

interface DesktopStartupSurfaceProps {
  readonly state: DesktopStartupSurfaceState;
  readonly onRetry: () => void;
  readonly onRelaunch?: () => void;
}

export function DesktopStartupSurface({ state, onRetry, onRelaunch }: DesktopStartupSurfaceProps) {
  const copy = startupSurfaceCopy(state);
  const retrying = state.kind === "failed" ? state.retrying : false;
  const showActions = copy.status !== "loading";
  const showRelaunch =
    Boolean(onRelaunch) &&
    (state.kind === "crashed" ||
      (state.kind === "failed" && state.failure.code !== "bridge-unavailable"));

  return (
    <div className="shell shell--loading">
      <main className="w-full max-w-md px-6">
        <Card
          data-testid="shell-status-card"
          data-status={copy.status}
          data-retrying={retrying ? "true" : "false"}
          data-failure={state.kind === "failed" ? state.failure.code : undefined}
        >
          <CardHeader>
            <CardTitle aria-level={1} role="heading">
              {copy.title}
            </CardTitle>
            <CardDescription>{copy.body}</CardDescription>
            {copy.status === "loading" ? (
              <CardAction>
                <Spinner />
              </CardAction>
            ) : null}
          </CardHeader>
          {showActions ? (
            <CardFooter className="gap-2">
              <Button data-testid="hydrate-retry" disabled={retrying} onClick={onRetry}>
                {retrying ? <Spinner data-icon="inline-start" /> : null}
                {retrying ? "Retrying…" : "Retry"}
              </Button>
              {showRelaunch ? (
                <Button data-testid="hydrate-relaunch" variant="ghost" onClick={onRelaunch}>
                  Relaunch pi-garden
                </Button>
              ) : null}
            </CardFooter>
          ) : null}
        </Card>
      </main>
    </div>
  );
}

interface RendererErrorBoundaryProps {
  readonly children: ReactNode;
  readonly onRelaunch?: () => void;
}

interface RendererErrorBoundaryState {
  readonly hasError: boolean;
  readonly remountKey: number;
}

export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = { hasError: false, remountKey: 0 };

  static getDerivedStateFromError(): Pick<RendererErrorBoundaryState, "hasError"> {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    console.error("[renderer] render tree failed", error);
  }

  private readonly handleRetry = (): void => {
    this.setState((current) => ({
      hasError: false,
      remountKey: current.remountKey + 1,
    }));
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <DesktopStartupSurface
          state={{ kind: "crashed" }}
          onRetry={this.handleRetry}
          onRelaunch={this.props.onRelaunch}
        />
      );
    }
    return <Fragment key={this.state.remountKey}>{this.props.children}</Fragment>;
  }
}

export function toStartupSurfaceState(view: DesktopAppView): DesktopStartupSurfaceState {
  if (view.kind === "failed") {
    return view;
  }
  return { kind: "loading" };
}
