import { useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { ChevronDownIcon } from "lucide-react";
import type {
  CreateScheduledTaskInput,
  ScheduledTaskRecord,
  ScheduledTaskSchedule,
  ScheduledTaskTarget,
  WorkspaceRecord,
} from "../../../contracts/desktop-state";
import {
  hostTimeZone,
  MIN_SCHEDULE_INTERVAL_MS,
  MAX_SCHEDULE_INTERVAL_MS,
  WEEKDAY_NAMES,
  type Weekday,
} from "../../../contracts/scheduled-tasks";
import { Button } from "@/ui/shadcn/button";
import { Calendar } from "@/ui/shadcn/calendar";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/ui/shadcn/field";
import { Input } from "@/ui/shadcn/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/shadcn/popover";
import { RadioGroup, RadioGroupItem } from "@/ui/shadcn/radio-group";
import { ScrollArea } from "@/ui/shadcn/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/shadcn/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/ui/shadcn/sheet";
import { Textarea } from "@/ui/shadcn/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/ui/shadcn/toggle-group";

export type ScheduledEditorState =
  | { readonly mode: "create"; readonly prefill?: Partial<CreateScheduledTaskInput> }
  | { readonly mode: "edit"; readonly taskId: string };

type FrequencyKind = ScheduledTaskSchedule["kind"];

const FREQUENCIES: readonly { readonly id: FrequencyKind; readonly label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "interval", label: "Interval" },
  { id: "once", label: "Once" },
];

interface ScheduledTaskEditorProps {
  readonly editor: ScheduledEditorState;
  readonly task?: ScheduledTaskRecord;
  readonly workspaces: readonly WorkspaceRecord[];
  readonly selectedWorkspaceId: string;
  readonly busy: boolean;
  readonly error?: string;
  readonly onClose: () => void;
  readonly onSubmit: (input: CreateScheduledTaskInput) => void;
  readonly onOpenChat?: (target: { workspaceId: string; sessionId: string }) => void;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toDatetimeLocalValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocalValue(value: string): string {
  const date = new Date(value);
  return date.toISOString();
}

/** Calendar date of a `YYYY-MM-DDTHH:mm` local value, as a local-midnight Date. */
function onceDateOf(value: string): Date | undefined {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) {
    return undefined;
  }
  return new Date(year, month - 1, day);
}

function withOnceDate(value: string, date: Date): string {
  const time = value.slice(11, 16) || defaultOnceValue().slice(11, 16);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${time}`;
}

function withOnceTime(value: string, time: string): string {
  const date = value.slice(0, 10) || defaultOnceValue().slice(0, 10);
  return `${date}T${time}`;
}

function defaultOnceValue(): string {
  return toDatetimeLocalValue(new Date(Date.now() + 60 * 60 * 1000).toISOString());
}

function timeFromSchedule(schedule: ScheduledTaskSchedule | undefined): string {
  if (schedule && (schedule.kind === "daily" || schedule.kind === "weekly")) {
    return `${pad(schedule.hour)}:${pad(schedule.minute)}`;
  }
  const now = new Date();
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function parseTime(value: string): { hour: number; minute: number } {
  const [hourText, minuteText] = value.split(":");
  return { hour: Number(hourText), minute: Number(minuteText) };
}

export function ScheduledTaskEditor({
  editor,
  task,
  workspaces,
  selectedWorkspaceId,
  busy,
  error,
  onClose,
  onSubmit,
  onOpenChat,
}: ScheduledTaskEditorProps) {
  const titleRef = useRef<HTMLInputElement | null>(null);
  const source = editor.mode === "edit" ? task : undefined;
  const prefill = editor.mode === "create" ? editor.prefill : undefined;
  const [title, setTitle] = useState(source?.title ?? prefill?.title ?? "");
  const [instruction, setInstruction] = useState(source?.instruction ?? prefill?.instruction ?? "");
  const [frequency, setFrequency] = useState<FrequencyKind>(
    source?.schedule.kind ?? prefill?.schedule?.kind ?? "daily",
  );
  const [onceAt, setOnceAt] = useState(
    source?.schedule.kind === "once"
      ? toDatetimeLocalValue(source.schedule.at)
      : prefill?.schedule?.kind === "once"
        ? toDatetimeLocalValue(prefill.schedule.at)
        : defaultOnceValue(),
  );
  const [onceDateOpen, setOnceDateOpen] = useState(false);
  const onceDate = onceDateOf(onceAt);
  const [clock, setClock] = useState(timeFromSchedule(source?.schedule ?? prefill?.schedule));
  const [days, setDays] = useState<Weekday[]>(
    source?.schedule.kind === "weekly"
      ? [...source.schedule.days]
      : prefill?.schedule?.kind === "weekly"
        ? [...prefill.schedule.days]
        : [1],
  );
  const [timeZone] = useState(
    source?.schedule.kind === "daily" || source?.schedule.kind === "weekly"
      ? source.schedule.timeZone
      : prefill?.schedule &&
          (prefill.schedule.kind === "daily" || prefill.schedule.kind === "weekly")
        ? prefill.schedule.timeZone
        : hostTimeZone(),
  );
  const [intervalMinutes, setIntervalMinutes] = useState(
    source?.schedule.kind === "interval"
      ? Math.round(source.schedule.everyMs / 60_000)
      : prefill?.schedule?.kind === "interval"
        ? Math.round(prefill.schedule.everyMs / 60_000)
        : 10,
  );
  const initialTarget = source?.target ?? prefill?.target;
  const [workspaceId, setWorkspaceId] = useState(
    initialTarget?.workspaceId ?? selectedWorkspaceId ?? workspaces[0]?.id ?? "",
  );
  const [targetKind, setTargetKind] = useState<"new-thread" | "existing-thread">(
    initialTarget?.kind ?? "new-thread",
  );
  const [sessionId, setSessionId] = useState(
    initialTarget?.kind === "existing-thread" ? initialTarget.sessionId : "",
  );

  const workspace = workspaces.find((entry) => entry.id === workspaceId) ?? workspaces[0];
  const sessions = useMemo(
    () => (workspace?.sessions ?? []).filter((session) => !session.archivedAt),
    [workspace],
  );
  const canSubmit =
    title.trim().length > 0 &&
    instruction.trim().length > 0 &&
    Boolean(workspace) &&
    (targetKind !== "existing-thread" || Boolean(sessionId));
  const openChatTarget =
    source?.target.kind === "existing-thread"
      ? { workspaceId: source.target.workspaceId, sessionId: source.target.sessionId }
      : source?.runs.at(-1)
        ? { workspaceId: source.runs.at(-1)!.workspaceId, sessionId: source.runs.at(-1)!.sessionId }
        : undefined;

  const buildSchedule = (): ScheduledTaskSchedule | undefined => {
    if (frequency === "once") {
      if (!onceAt) {
        return undefined;
      }
      return { kind: "once", at: fromDatetimeLocalValue(onceAt) };
    }
    const parsed = parseTime(clock);
    if (frequency === "daily") {
      return {
        kind: "daily",
        hour: parsed.hour,
        minute: parsed.minute,
        timeZone,
      };
    }
    if (frequency === "weekly") {
      return {
        kind: "weekly",
        days: days.length > 0 ? days : [1],
        hour: parsed.hour,
        minute: parsed.minute,
        timeZone,
      };
    }
    const everyMs = Math.round(intervalMinutes) * 60_000;
    if (everyMs < MIN_SCHEDULE_INTERVAL_MS || everyMs > MAX_SCHEDULE_INTERVAL_MS) {
      return undefined;
    }
    return { kind: "interval", everyMs };
  };

  const buildTarget = (): ScheduledTaskTarget | undefined => {
    if (!workspaceId) {
      return undefined;
    }
    if (targetKind === "existing-thread") {
      if (!sessionId) {
        return undefined;
      }
      return { kind: "existing-thread", workspaceId, sessionId };
    }
    return { kind: "new-thread", workspaceId };
  };

  const submit = () => {
    const schedule = buildSchedule();
    const target = buildTarget();
    if (!schedule || !target) {
      return;
    }
    onSubmit({
      title: title.trim(),
      instruction: instruction.trim(),
      schedule,
      target,
    });
  };

  return (
    <Sheet
      open
      onOpenChange={(open, details) => {
        if (open || (busy && details.reason === "escape-key")) {
          return;
        }
        onClose();
      }}
    >
      <SheetContent data-testid="scheduled-task-editor" initialFocus={titleRef}>
        <SheetHeader>
          <SheetTitle>
            {editor.mode === "edit" ? "Edit scheduled task" : "Set up scheduled task"}
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <FieldGroup className="px-4">
            <Field>
              <FieldLabel htmlFor="scheduled-task-title">Title</FieldLabel>
              <Input
                data-testid="scheduled-task-title"
                id="scheduled-task-title"
                ref={titleRef}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Weekly status"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="scheduled-task-instruction">Instructions</FieldLabel>
              <Textarea
                data-testid="scheduled-task-instruction"
                id="scheduled-task-instruction"
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="What should pi do when this runs?"
                rows={5}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="scheduled-task-workspace">Workspace</FieldLabel>
              <Select
                items={workspaces.map((entry) => ({ value: entry.id, label: entry.name }))}
                value={workspaceId}
                onValueChange={(value) => {
                  if (value) {
                    setWorkspaceId(value);
                    setSessionId("");
                  }
                }}
              >
                <SelectTrigger
                  className="w-full"
                  data-testid="scheduled-task-workspace"
                  id="scheduled-task-workspace"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <FieldSet>
              <FieldLegend variant="label">Runs in</FieldLegend>
              <RadioGroup
                value={targetKind}
                onValueChange={(value) => setTargetKind(value as typeof targetKind)}
              >
                <Field orientation="horizontal">
                  <RadioGroupItem id="scheduled-target-new" value="new-thread" />
                  <FieldLabel className="font-normal" htmlFor="scheduled-target-new">
                    New thread for this task
                  </FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <RadioGroupItem id="scheduled-target-existing" value="existing-thread" />
                  <FieldLabel className="font-normal" htmlFor="scheduled-target-existing">
                    Existing thread
                  </FieldLabel>
                </Field>
              </RadioGroup>
              {targetKind === "existing-thread" ? (
                <Select
                  items={sessions.map((session) => ({ value: session.id, label: session.title }))}
                  value={sessionId || null}
                  onValueChange={(value) => setSessionId(value ?? "")}
                >
                  <SelectTrigger
                    aria-label="Thread"
                    className="w-full"
                    data-testid="scheduled-task-session"
                  >
                    <SelectValue placeholder="Select a thread" />
                  </SelectTrigger>
                  <SelectContent>
                    {sessions.map((session) => (
                      <SelectItem key={session.id} value={session.id}>
                        {session.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </FieldSet>

            <FieldSet>
              <FieldLegend variant="label">Frequency</FieldLegend>
              <ToggleGroup
                data-testid="scheduled-task-frequency"
                variant="outline"
                value={[frequency]}
                onValueChange={(value) => {
                  const next = value[0] as FrequencyKind | undefined;
                  if (next) {
                    setFrequency(next);
                  }
                }}
              >
                {FREQUENCIES.map((entry) => (
                  <ToggleGroupItem key={entry.id} value={entry.id}>
                    {entry.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </FieldSet>

            {frequency === "once" ? (
              <FieldGroup className="flex-row">
                <Field>
                  <FieldLabel htmlFor="scheduled-task-once-at">Run at</FieldLabel>
                  <Popover open={onceDateOpen} onOpenChange={setOnceDateOpen}>
                    <PopoverTrigger
                      render={
                        <Button
                          className="justify-between font-normal"
                          data-testid="scheduled-task-once-at"
                          id="scheduled-task-once-at"
                          variant="outline"
                        />
                      }
                    >
                      {onceDate ? format(onceDate, "PPP") : "Select date"}
                      <ChevronDownIcon data-icon="inline-end" />
                    </PopoverTrigger>
                    <PopoverContent className="w-auto overflow-hidden p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={onceDate}
                        captionLayout="dropdown"
                        defaultMonth={onceDate}
                        onSelect={(date) => {
                          if (date) {
                            setOnceAt((current) => withOnceDate(current, date));
                          }
                          setOnceDateOpen(false);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                </Field>
                <Field className="w-32">
                  <FieldLabel htmlFor="scheduled-task-once-time">Time</FieldLabel>
                  <Input
                    className="appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                    data-testid="scheduled-task-once-time"
                    id="scheduled-task-once-time"
                    type="time"
                    value={onceAt.slice(11, 16)}
                    onChange={(event) => {
                      const time = event.target.value;
                      if (time) {
                        setOnceAt((current) => withOnceTime(current, time));
                      }
                    }}
                  />
                </Field>
              </FieldGroup>
            ) : null}
            {frequency === "daily" || frequency === "weekly" ? (
              <Field>
                <FieldLabel htmlFor="scheduled-task-time">Time</FieldLabel>
                <Input
                  data-testid="scheduled-task-time"
                  id="scheduled-task-time"
                  type="time"
                  value={clock}
                  onChange={(event) => setClock(event.target.value)}
                />
              </Field>
            ) : null}
            {frequency === "weekly" ? (
              <FieldSet>
                <FieldLegend variant="label">Days</FieldLegend>
                <ToggleGroup
                  className="flex-wrap"
                  multiple
                  size="sm"
                  variant="outline"
                  value={days.map(String)}
                  onValueChange={(value) =>
                    setDays(
                      value
                        .map((entry) => Number(entry) as Weekday)
                        .sort((left, right) => left - right),
                    )
                  }
                >
                  {WEEKDAY_NAMES.map((name, index) => (
                    <ToggleGroupItem aria-label={name} key={name} value={String(index)}>
                      {name.slice(0, 3)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </FieldSet>
            ) : null}
            {frequency === "interval" ? (
              <Field>
                <FieldLabel htmlFor="scheduled-task-interval">Every (minutes)</FieldLabel>
                <Input
                  data-testid="scheduled-task-interval"
                  id="scheduled-task-interval"
                  type="number"
                  min={1}
                  max={7 * 24 * 60}
                  value={intervalMinutes}
                  onChange={(event) => setIntervalMinutes(Number(event.target.value))}
                />
              </Field>
            ) : null}

            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </ScrollArea>

        <SheetFooter className="flex-row flex-wrap justify-end">
          {openChatTarget && onOpenChat ? (
            <Button variant="outline" type="button" onClick={() => onOpenChat(openChatTarget)}>
              Open chat
            </Button>
          ) : null}
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            data-testid="scheduled-task-save"
            type="button"
            disabled={!canSubmit || busy}
            onClick={submit}
          >
            {editor.mode === "edit" ? "Save" : "Create"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
