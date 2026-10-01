import { useMemo, useState } from "react";
import type {
  DesktopAppState,
  ScheduledTaskFilter,
  ScheduledTaskRecord,
} from "../../../contracts/desktop-state";
import {
  filterScheduledTasks,
  formatScheduledTaskRowMeta,
} from "../../../contracts/scheduled-tasks";
import type { PiDesktopApi } from "../../../contracts/ipc";
import type { Dispatch, SetStateAction } from "react";
import type { ScheduledEditorState } from "./scheduled-task-editor";
import { Button } from "@/ui/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/shadcn/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/shadcn/empty";
import { Input } from "@/ui/shadcn/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/ui/shadcn/item";
import { Tabs, TabsList, TabsTrigger } from "@/ui/shadcn/tabs";
import { MoreHorizontalIcon } from "lucide-react";

interface ScheduledTasksViewProps {
  readonly tasks: readonly ScheduledTaskRecord[];
  readonly lastError?: string;
  readonly api: PiDesktopApi;
  readonly setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>;
  readonly updateSnapshot: (
    setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
    action: () => Promise<DesktopAppState>,
  ) => Promise<DesktopAppState>;
  readonly onCreateWithPi: () => void;
  readonly onOpenEditor: (editor: ScheduledEditorState) => void;
}

const FILTERS: readonly { readonly id: ScheduledTaskFilter; readonly label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "paused", label: "Paused" },
  { id: "completed", label: "Completed" },
];

export function ScheduledTasksView({
  tasks,
  lastError,
  api,
  setSnapshot,
  updateSnapshot,
  onCreateWithPi,
  onOpenEditor,
}: ScheduledTasksViewProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ScheduledTaskFilter>("all");
  const visible = useMemo(() => filterScheduledTasks(tasks, filter, query), [tasks, filter, query]);
  const setStatus = (task: ScheduledTaskRecord, status: "active" | "paused") => {
    void updateSnapshot(setSnapshot, () => api.updateScheduledTask(task.id, { status })).catch(
      (error: unknown) => {
        console.error("[renderer] updateScheduledTask failed", error);
      },
    );
  };

  return (
    <section className="canvas scheduled-tasks-view" data-testid="scheduled-tasks-view">
      <header className="view-header">
        <div>
          <h1 className="view-header__title">Scheduled tasks</h1>
          <p className="view-header__body">
            Ask pi to schedule tasks, set reminders, or monitor for updates.
          </p>
        </div>
        <div className="view-header__actions">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button data-testid="scheduled-task-create" />}>
              Create
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-44">
              <DropdownMenuItem
                data-testid="scheduled-task-create-with-pi"
                onClick={onCreateWithPi}
              >
                Create with pi
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="scheduled-task-setup-manually"
                onClick={() => onOpenEditor({ mode: "create" })}
              >
                Set up manually
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          aria-label="Search scheduled tasks"
          className="w-auto min-w-0 flex-1 basis-56"
          data-testid="scheduled-task-search"
          placeholder="Search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Tabs value={filter} onValueChange={(value) => setFilter(value as ScheduledTaskFilter)}>
          <TabsList>
            {FILTERS.map((entry) => (
              <TabsTrigger
                data-testid={`scheduled-task-filter-${entry.id}`}
                key={entry.id}
                value={entry.id}
              >
                {entry.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {lastError ? <p className="error-banner">{lastError}</p> : null}

      {visible.length === 0 ? (
        <Empty className="border" data-testid="scheduled-tasks-empty">
          <EmptyHeader>
            <EmptyTitle>
              {filter === "active" ? "No active scheduled tasks" : "No scheduled tasks"}
            </EmptyTitle>
            <EmptyDescription>
              {filter === "active"
                ? "Scheduled tasks run on this device while pi-garden is open. They do not run in the cloud or after you quit."
                : "Create a task manually or ask pi to set one up."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup className="gap-2">
          {visible.map((task) => (
            <Item
              data-testid="scheduled-task-row"
              data-task-id={task.id}
              key={task.id}
              render={<article role="listitem" />}
              variant="outline"
            >
              <ItemContent className="min-w-0">
                <button
                  className="flex w-full flex-col gap-1 text-left"
                  type="button"
                  onClick={() => onOpenEditor({ mode: "edit", taskId: task.id })}
                >
                  <ItemTitle>{task.title}</ItemTitle>
                  <ItemDescription>{formatScheduledTaskRowMeta(task)}</ItemDescription>
                </button>
              </ItemContent>
              <ItemActions>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        aria-label={`Actions for ${task.title}`}
                        size="icon-sm"
                        variant="ghost"
                      />
                    }
                  >
                    <MoreHorizontalIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-auto min-w-36">
                    {task.status === "paused" ? (
                      <DropdownMenuItem onClick={() => setStatus(task, "active")}>
                        Resume
                      </DropdownMenuItem>
                    ) : task.status !== "completed" ? (
                      <DropdownMenuItem onClick={() => setStatus(task, "paused")}>
                        Pause
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      onClick={() => onOpenEditor({ mode: "edit", taskId: task.id })}
                    >
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => {
                        void updateSnapshot(setSnapshot, () =>
                          api.deleteScheduledTask(task.id),
                        ).catch((error: unknown) => {
                          console.error("[renderer] deleteScheduledTask failed", error);
                        });
                      }}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
    </section>
  );
}
