import {
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type {
  ComposerAttachment,
  SessionExtensionUiStateRecord,
} from "../../../contracts/desktop-state";
import type { MentionOption } from "./hooks/use-mention-menu";
import type {
  ComposerSlashCommand,
  ComposerSlashCommandSection,
  ComposerSlashOption,
  ComposerSlashOptionEmptyState,
} from "./composer-commands";
import { hasFilesInDataTransfer } from "./composer-attachments";
import {
  ExtensionStatusLine,
  ExtensionWidgets,
  statusesForDisplay,
  widgetsForPlacement,
} from "../extensions/extension-session-ui";
import {
  ExtensionIcon,
  FileIcon,
  ModelIcon,
  ReasoningIcon,
  SettingsIcon,
  SkillIcon,
  SparkIcon,
  StatusIcon,
} from "../../ui/icons";
import { XIcon } from "lucide-react";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { CommandEmpty, CommandGroup, CommandItem, CommandShortcut } from "@/ui/shadcn/command";
import { ComposerMenuPopover } from "./composer-menu-popover";
import type { ComposerEditorHandle } from "./composer-editor";
import { bindTextareaEditor } from "./composer-editor";
import { ImageAttachmentThumb } from "./image-attachment-thumb";
import { QueuedComposerMessages } from "./queued-composer-messages";

type ExtensionMentionOption = Extract<MentionOption, { kind: "extension" }>;
type FileMentionOption = Extract<MentionOption, { kind: "file" }>;

interface ComposerSurfaceProps {
  readonly lastError?: string;
  readonly activeSlashCommand?: ComposerSlashCommand;
  readonly activeSlashCommandMeta?: string;
  readonly topNotice?: ReactNode;
  readonly composerDraft: string;
  readonly setComposerDraft: (draft: string) => void;
  readonly composerRef: RefObject<ComposerEditorHandle | null>;
  readonly editorSlot?: ReactNode;
  readonly suggestionMenu?: ReactNode;
  readonly editorNotice?: ReactNode;
  readonly attachments: readonly ComposerAttachment[];
  readonly queuedMessages: readonly import("../../../contracts/desktop-state").QueuedComposerMessage[];
  readonly editingQueuedMessageId?: string;
  readonly slashSections: readonly ComposerSlashCommandSection[];
  readonly slashOptions: readonly ComposerSlashOption[];
  readonly selectedSlashCommand?: ComposerSlashCommand;
  readonly selectedSlashOption?: ComposerSlashOption;
  readonly showSlashMenu: boolean;
  readonly showSlashOptionMenu: boolean;
  readonly slashOptionEmptyState?: ComposerSlashOptionEmptyState;
  readonly onClearSlashCommand: () => void;
  readonly onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly onComposerPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  readonly onComposerDrop: (event: DragEvent<HTMLDivElement>) => void;
  readonly onRemoveAttachment: (attachmentId: string) => void;
  readonly onEditQueuedMessage: (messageId: string) => void;
  readonly onCancelQueuedEdit: () => void;
  readonly onRemoveQueuedMessage: (messageId: string) => void;
  readonly onSteerQueuedMessage: (messageId: string) => void;
  readonly onSelectSlashCommand: (command: ComposerSlashCommand) => void;
  readonly onSelectSlashOption: (option: ComposerSlashOption) => void;
  readonly showMentionMenu: boolean;
  readonly mentionOptions: readonly MentionOption[];
  readonly selectedMentionIndex: number;
  readonly onSelectMention: (option: MentionOption) => void;
  readonly onEnableMentionExtension: (option: ExtensionMentionOption) => void;
  readonly textareaLabel: string;
  readonly textareaTestId: string;
  readonly textareaPlaceholder: string;
  readonly textareaClassName?: string;
  readonly extensionUi?: SessionExtensionUiStateRecord;
  readonly footer: ReactNode;
  /** Transcript annotations waiting to go with the next message. */
  readonly annotationChip?: ReactNode;
}

export function ComposerSurface({
  lastError,
  activeSlashCommand,
  activeSlashCommandMeta,
  topNotice,
  composerDraft,
  setComposerDraft,
  composerRef,
  editorSlot,
  suggestionMenu,
  editorNotice,
  attachments,
  queuedMessages,
  editingQueuedMessageId,
  slashSections,
  slashOptions,
  selectedSlashCommand,
  selectedSlashOption,
  showSlashMenu,
  showSlashOptionMenu,
  slashOptionEmptyState,
  onClearSlashCommand,
  onComposerKeyDown,
  onComposerPaste,
  onComposerDrop,
  onRemoveAttachment,
  onEditQueuedMessage,
  onCancelQueuedEdit,
  onRemoveQueuedMessage,
  onSteerQueuedMessage,
  onSelectSlashCommand,
  onSelectSlashOption,
  showMentionMenu,
  mentionOptions,
  selectedMentionIndex,
  onSelectMention,
  onEnableMentionExtension,
  textareaLabel,
  textareaTestId,
  textareaPlaceholder,
  textareaClassName,
  extensionUi,
  footer,
  annotationChip,
}: ComposerSurfaceProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const dragDepthRef = useRef(0);

  const clearDragState = () => {
    dragDepthRef.current = 0;
    setIsDragActive(false);
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDataTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!isDragActive) {
      return;
    }
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragActive(false);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDataTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!isDragActive) {
      setIsDragActive(true);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    clearDragState();
    onComposerDrop(event);
  };

  return (
    <div
      className={`composer__surface ${isDragActive ? "composer__surface--drag-active" : ""}`}
      data-testid={`${textareaTestId}-surface`}
      onPaste={onComposerPaste}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {isDragActive ? (
        <div className="composer__drop-indicator" data-testid="composer-drop-indicator">
          Drop images or files to attach
        </div>
      ) : null}
      {activeSlashCommand ? (
        <div className="composer__slash-intent">
          <span className="composer__slash-intent-icon" aria-hidden="true">
            <SlashCommandIcon command={activeSlashCommand} />
          </span>
          <span className="composer__slash-intent-body">
            <span className="composer__slash-intent-title">{activeSlashCommand.title}</span>
            {activeSlashCommandMeta ? (
              <span className="composer__slash-intent-meta">{activeSlashCommandMeta}</span>
            ) : null}
          </span>
          <Button
            aria-label={`Clear ${activeSlashCommand.title}`}
            className="ml-auto"
            size="icon-xs"
            variant="ghost"
            onClick={onClearSlashCommand}
          >
            <XIcon />
          </Button>
        </div>
      ) : null}
      <QueuedComposerMessages
        messages={queuedMessages}
        editingQueuedMessageId={editingQueuedMessageId}
        onEditMessage={onEditQueuedMessage}
        onCancelEdit={onCancelQueuedEdit}
        onRemoveMessage={onRemoveQueuedMessage}
        onSteerMessage={onSteerQueuedMessage}
      />
      {annotationChip}
      {attachments.length > 0 ? (
        <div className="composer__attachments">
          {attachments.map((attachment) =>
            attachment.kind === "image" ? (
              <div
                className="composer-attachment composer-attachment--image group relative"
                key={attachment.id}
              >
                <ImageAttachmentThumb
                  className="composer-attachment__preview"
                  name={attachment.name}
                  src={`data:${attachment.mimeType};base64,${attachment.data}`}
                />
                <Button
                  aria-label={`Remove ${attachment.name}`}
                  className="absolute -top-2 -right-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                  size="icon-xs"
                  variant="outline"
                  onClick={() => onRemoveAttachment(attachment.id)}
                >
                  <XIcon />
                </Button>
              </div>
            ) : (
              <Badge
                className={`composer-attachment composer-attachment--${attachment.kind} h-7 max-w-72 pr-0.5`}
                key={attachment.id}
                variant="outline"
              >
                <FileIcon />
                <span className="composer-attachment__name truncate">{attachment.name}</span>
                <Button
                  aria-label={`Remove ${attachment.name}`}
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => onRemoveAttachment(attachment.id)}
                >
                  <XIcon />
                </Button>
              </Badge>
            ),
          )}
        </div>
      ) : null}
      {lastError ? (
        <div className="composer__error error-banner" data-testid="composer-error-banner">
          {lastError}
        </div>
      ) : null}
      <div className="composer__editor">
        {topNotice}
        {showMentionMenu ? (
          <ComposerMenuPopover
            label="Mentions"
            selectedValue={mentionOptions[selectedMentionIndex]?.id}
            testId="mention-menu"
          >
            <MentionMenuSections
              options={mentionOptions}
              onSelect={onSelectMention}
              onEnableExtension={onEnableMentionExtension}
            />
          </ComposerMenuPopover>
        ) : showSlashMenu ? (
          <ComposerMenuPopover
            label="Slash commands"
            selectedValue={selectedSlashCommand?.id}
            testId="slash-menu"
          >
            {slashSections.map((section) => (
              <CommandGroup
                heading={
                  section.title ? (
                    <span className="flex items-center gap-2">
                      {section.id === "runtime" ? <SparkIcon /> : <SettingsIcon />}
                      {section.title}
                    </span>
                  ) : undefined
                }
                key={section.id}
              >
                {section.items.map((command) => (
                  <CommandItem
                    className="slash-menu__item"
                    key={command.id}
                    value={command.id}
                    onSelect={() => onSelectSlashCommand(command)}
                  >
                    <SlashCommandIcon command={command} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{command.title}</span>
                        {command.section === "runtime" && command.sourceLabel ? (
                          <Badge variant="secondary">{command.sourceLabel}</Badge>
                        ) : null}
                        {command.section === "runtime" &&
                        command.compatibility?.status === "terminal-only" ? (
                          <Badge variant="outline">Terminal-only</Badge>
                        ) : null}
                      </span>
                      {command.description ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {command.description}
                        </span>
                      ) : null}
                    </span>
                    <CommandShortcut>{command.command}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </ComposerMenuPopover>
        ) : showSlashOptionMenu && selectedSlashCommand ? (
          <ComposerMenuPopover
            label={selectedSlashCommand.title}
            selectedValue={selectedSlashOption?.value}
            testId="slash-options-menu"
          >
            <CommandGroup heading={selectedSlashCommand.title}>
              {slashOptions.map((option) => (
                <CommandItem
                  className={`slash-menu__option ${selectedSlashOption?.value === option.value ? "slash-menu__option--active" : ""}`}
                  key={option.value}
                  value={option.value}
                  onSelect={() => onSelectSlashOption(option)}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="slash-menu__option-title truncate">{option.label}</span>
                    {option.description ? (
                      <span className="slash-menu__option-description truncate text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            {slashOptions.length === 0 && slashOptionEmptyState ? (
              <CommandEmpty className="px-2 py-3 text-left">
                <div className="font-medium">{slashOptionEmptyState.title}</div>
                <div className="text-muted-foreground">{slashOptionEmptyState.description}</div>
              </CommandEmpty>
            ) : null}
          </ComposerMenuPopover>
        ) : null}
        <ExtensionWidgets
          placement="above"
          widgets={widgetsForPlacement(extensionUi, "aboveComposer")}
        />
        {suggestionMenu}
        {editorNotice}
        {editorSlot ?? (
          <textarea
            aria-label={textareaLabel}
            className={textareaClassName}
            data-testid={textareaTestId}
            ref={(node) => {
              composerRef.current = node ? bindTextareaEditor(node) : null;
            }}
            value={composerDraft}
            onChange={(event) => {
              setComposerDraft(event.target.value);
            }}
            onCompositionStart={(event) => {
              event.currentTarget.dataset.composing = "true";
            }}
            onCompositionEnd={(event) => {
              delete event.currentTarget.dataset.composing;
            }}
            onKeyDown={onComposerKeyDown}
            placeholder={textareaPlaceholder}
          />
        )}
        <ExtensionWidgets
          placement="below"
          widgets={widgetsForPlacement(extensionUi, "belowComposer")}
        />
        <div className="composer__bar">{footer}</div>
        <ExtensionStatusLine statuses={statusesForDisplay(extensionUi)} />
      </div>
    </div>
  );
}

function MentionMenuSections({
  options,
  onSelect,
  onEnableExtension,
}: {
  readonly options: readonly MentionOption[];
  readonly onSelect: (option: MentionOption) => void;
  readonly onEnableExtension: (option: ExtensionMentionOption) => void;
}) {
  const extensionOptions = options.filter(
    (option): option is ExtensionMentionOption => option.kind === "extension",
  );
  const fileOptions = options.filter(
    (option): option is FileMentionOption => option.kind === "file",
  );

  return (
    <>
      {extensionOptions.length > 0 ? (
        <CommandGroup
          className="mention-menu__section"
          heading={<span className="mention-menu__section-title">Extensions</span>}
        >
          {extensionOptions.map((option) => (
            <ExtensionMentionItem
              key={option.id}
              option={option}
              onSelect={onSelect}
              onEnableExtension={onEnableExtension}
            />
          ))}
        </CommandGroup>
      ) : null}
      {fileOptions.length > 0 ? (
        <CommandGroup
          className="mention-menu__section"
          heading={<span className="mention-menu__section-title">Files</span>}
        >
          {fileOptions.map((option) => (
            <FileMentionItem key={option.id} option={option} onSelect={onSelect} />
          ))}
        </CommandGroup>
      ) : null}
    </>
  );
}

function ExtensionMentionItem({
  option,
  onSelect,
  onEnableExtension,
}: {
  readonly option: ExtensionMentionOption;
  readonly onSelect: (option: MentionOption) => void;
  readonly onEnableExtension: (option: ExtensionMentionOption) => void;
}) {
  return (
    <CommandItem
      className="mention-menu__item"
      disabled={option.enabling}
      value={option.id}
      onSelect={() => {
        if (option.enabled) {
          onSelect(option);
          return;
        }
        onEnableExtension(option);
      }}
    >
      <ExtensionIcon />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="mention-menu__filename truncate font-medium">{option.displayName}</span>
          {option.enabled ? null : (
            <Badge variant="secondary">{option.enabling ? "Enabling" : "Disabled"}</Badge>
          )}
        </span>
        <span className="truncate text-xs text-muted-foreground">{option.description}</span>
      </span>
      {option.enabled ? null : (
        <Button
          aria-label={`Enable ${option.displayName}`}
          disabled={option.enabling}
          size="xs"
          variant="outline"
          onClick={(event) => {
            event.stopPropagation();
            onEnableExtension(option);
          }}
        >
          {option.enabling ? "Enabling" : "Enable"}
        </Button>
      )}
    </CommandItem>
  );
}

function FileMentionItem({
  option,
  onSelect,
}: {
  readonly option: FileMentionOption;
  readonly onSelect: (option: MentionOption) => void;
}) {
  const lastSlash = option.filePath.lastIndexOf("/");
  const dirPart = lastSlash >= 0 ? option.filePath.slice(0, lastSlash + 1) : "";
  const namePart = lastSlash >= 0 ? option.filePath.slice(lastSlash + 1) : option.filePath;
  return (
    <CommandItem className="mention-menu__item" value={option.id} onSelect={() => onSelect(option)}>
      <FileIcon />
      <span className="flex min-w-0">
        {dirPart ? <span className="truncate text-muted-foreground">{dirPart}</span> : null}
        <span className="mention-menu__filename shrink-0 font-medium">{namePart}</span>
      </span>
    </CommandItem>
  );
}

function SlashCommandIcon({ command }: { readonly command: ComposerSlashCommand }) {
  switch (command.kind) {
    case "runtime":
      return command.runtimeCommand?.source === "skill" ? <SkillIcon /> : <SparkIcon />;
    case "model":
      return <ModelIcon />;
    case "thinking":
      return <ReasoningIcon />;
    case "status":
      return <StatusIcon />;
    default:
      return <SparkIcon />;
  }
}
