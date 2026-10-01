import { useRef, useState } from "react";
import type { NewThreadEnvironment } from "../../../contracts/desktop-state";
import { CloseIcon } from "../../ui/icons";
import { Button } from "@/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog";
import { Spinner } from "@/ui/shadcn/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/ui/shadcn/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/shadcn/tooltip";

interface ForkModalProps {
  readonly submitting: boolean;
  readonly error?: string;
  /** Preview of the assistant response the fork will branch after. */
  readonly messagePreview?: string;
  /** Whether forking into a new worktree is available for the source workspace. */
  readonly canUseWorktree: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (environment: NewThreadEnvironment) => void;
}

export function ForkModal({
  submitting,
  error,
  messagePreview,
  canUseWorktree,
  onClose,
  onSubmit,
}: ForkModalProps) {
  const [environment, setEnvironment] = useState<NewThreadEnvironment>("local");
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  const worktreeItem = (
    <ToggleGroupItem
      data-testid="fork-environment-worktree"
      disabled={!canUseWorktree}
      value="worktree"
    >
      New worktree
    </ToggleGroupItem>
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      {/* The app returns focus to the composer or the topmost remaining dialog. */}
      <DialogContent
        className="sm:max-w-lg"
        data-testid="fork-modal"
        finalFocus={false}
        initialFocus={confirmRef}
        showCloseButton={false}
      >
        <DialogHeader className="flex-row items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <DialogTitle>Fork conversation</DialogTitle>
            <DialogDescription>
              Forks the conversation up to and including this response into a new sidebar thread
              with an empty composer, so you can continue it in a different direction. The original
              thread stays untouched.
            </DialogDescription>
          </div>
          <Button
            aria-label="Close fork modal"
            disabled={submitting}
            size="icon-sm"
            variant="ghost"
            onClick={onClose}
          >
            <CloseIcon />
          </Button>
        </DialogHeader>

        {error ? (
          <div className="error-banner" data-testid="fork-modal-error">
            {error}
          </div>
        ) : null}

        {messagePreview ? (
          <div className="fork-modal__preview" data-testid="fork-modal-preview">
            {messagePreview}
          </div>
        ) : null}

        <ToggleGroup
          aria-label="Fork environment"
          value={[environment]}
          variant="outline"
          onValueChange={(value) => {
            const next = value[0];
            if (next === "local" || next === "worktree") setEnvironment(next);
          }}
        >
          <ToggleGroupItem data-testid="fork-environment-local" value="local">
            Same worktree
          </ToggleGroupItem>
          {canUseWorktree ? (
            worktreeItem
          ) : (
            <Tooltip>
              {/* A disabled button takes no pointer events; the wrapper carries the hint. */}
              <TooltipTrigger render={<span className="inline-flex" />}>
                {worktreeItem}
              </TooltipTrigger>
              <TooltipContent>This workspace can&apos;t create worktrees.</TooltipContent>
            </Tooltip>
          )}
        </ToggleGroup>

        <DialogFooter className="items-center sm:justify-between">
          <p className="text-muted-foreground">
            {environment === "worktree"
              ? "A fresh worktree is created and the forked thread opens there."
              : "The forked thread opens in the same folder as the original."}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button disabled={submitting} variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              data-testid="fork-modal-confirm"
              disabled={submitting}
              ref={confirmRef}
              onClick={() => onSubmit(environment)}
            >
              {submitting ? <Spinner data-icon="inline-start" /> : null}
              {submitting ? "Forking…" : "Fork thread"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
