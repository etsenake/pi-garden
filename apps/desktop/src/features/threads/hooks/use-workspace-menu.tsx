import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type {
  DesktopAppState,
  WorkspaceRecord,
  WorktreeRecord,
} from "../../../../contracts/desktop-state";
import type { PiDesktopApi } from "../../../../contracts/ipc";

interface UseWorkspaceMenuParams {
  readonly api: PiDesktopApi | undefined;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly updateSnapshot: (
    setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
    action: () => Promise<DesktopAppState>,
  ) => Promise<DesktopAppState>;
}

export interface WorkspaceMenuState {
  readonly workspaceRenameId: string | null;
  readonly workspaceRenameDraft: string;
  readonly setWorkspaceRenameDraft: Dispatch<SetStateAction<string>>;
  readonly workspaceRenamePanelRef: RefObject<HTMLFormElement | null>;
  readonly workspaceRenameInputRef: RefObject<HTMLInputElement | null>;
  readonly startRename: (workspace: WorkspaceRecord) => void;
  readonly submitRename: (workspace: WorkspaceRecord) => void;
  readonly cancelRename: () => void;
  readonly removeWorkspace: (workspace: WorkspaceRecord) => void;
  readonly createWorktree: (
    workspaceId: string,
    fromSessionWorkspaceId?: string,
    fromSessionId?: string,
  ) => void;
  readonly removeWorktree: (workspaceId: string, worktree: WorktreeRecord) => void;
  readonly selectWorkspace: (workspaceId: string) => void;
}

export function useWorkspaceMenu(params: UseWorkspaceMenuParams): WorkspaceMenuState {
  const { api, setSnapshot, updateSnapshot } = params;

  const [workspaceRenameId, setWorkspaceRenameId] = useState<string | null>(null);
  const [workspaceRenameDraft, setWorkspaceRenameDraft] = useState("");

  const workspaceRenamePanelRef = useRef<HTMLFormElement | null>(null);
  const workspaceRenameInputRef = useRef<HTMLInputElement | null>(null);

  // Focus/select rename input when rename starts
  useEffect(() => {
    if (!workspaceRenameId) {
      return undefined;
    }

    workspaceRenameInputRef.current?.focus();
    workspaceRenameInputRef.current?.select();
    return undefined;
  }, [workspaceRenameId]);

  // Click-outside / Escape closes the rename panel. The "…" menu is a shadcn
  // DropdownMenu that dismisses itself.
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!(workspaceRenamePanelRef.current?.contains(target) ?? false)) {
        setWorkspaceRenameId(null);
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setWorkspaceRenameId(null);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const startRename = (workspace: WorkspaceRecord) => {
    setWorkspaceRenameId(workspace.id);
    setWorkspaceRenameDraft(workspace.name);
  };

  const submitRename = (workspace: WorkspaceRecord) => {
    const nextName = workspaceRenameDraft.trim();
    setWorkspaceRenameId(null);
    if (!nextName || nextName === workspace.name) {
      setWorkspaceRenameDraft("");
      return;
    }
    setWorkspaceRenameDraft("");
    if (!api) {
      return;
    }
    void updateSnapshot(setSnapshot, () => api.renameWorkspace(workspace.id, nextName)).catch(
      (error: unknown) => {
        console.error("[renderer] renameWorkspace failed", error);
      },
    );
  };

  const cancelRename = () => {
    setWorkspaceRenameId(null);
    setWorkspaceRenameDraft("");
  };

  const removeWorkspace = (workspace: WorkspaceRecord) => {
    const confirmed = window.confirm(
      `Remove ${workspace.name} from pi-garden? This will not delete any files.`,
    );
    setWorkspaceRenameId(null);
    if (!confirmed || !api) {
      return;
    }
    void updateSnapshot(setSnapshot, () => api.removeWorkspace(workspace.id)).catch(
      (error: unknown) => {
        console.error("[renderer] removeWorkspace failed", error);
      },
    );
  };

  const createWorktree = (
    workspaceId: string,
    fromSessionWorkspaceId?: string,
    fromSessionId?: string,
  ) => {
    if (!api) {
      return;
    }
    void updateSnapshot(setSnapshot, () =>
      api.createWorktree({ workspaceId, fromSessionWorkspaceId, fromSessionId }),
    ).catch((error: unknown) => {
      console.error("[renderer] updateSnapshot failed", error);
    });
  };

  const removeWorktree = (workspaceId: string, worktree: WorktreeRecord) => {
    const confirmed = window.confirm(
      `Remove worktree ${worktree.name}? This removes the git worktree from disk.`,
    );
    if (!confirmed || !api) {
      return;
    }
    void updateSnapshot(setSnapshot, () =>
      api.removeWorktree({ workspaceId, worktreeId: worktree.id }),
    ).catch((error: unknown) => {
      console.error("[renderer] updateSnapshot failed", error);
    });
  };

  const selectWorkspace = (workspaceId: string) => {
    if (!api) {
      return;
    }
    void updateSnapshot(setSnapshot, () => api.selectWorkspace(workspaceId)).catch(
      (error: unknown) => {
        console.error("[renderer] selectWorkspace failed", error);
      },
    );
  };

  return {
    workspaceRenameId,
    workspaceRenameDraft,
    setWorkspaceRenameDraft,
    workspaceRenamePanelRef,
    workspaceRenameInputRef,
    startRename,
    submitRename,
    cancelRename,
    removeWorkspace,
    createWorktree,
    removeWorktree,
    selectWorkspace,
  };
}
