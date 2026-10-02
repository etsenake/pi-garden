import type { ComposerAttachment, QueuedComposerMessage } from "../../../contracts/desktop-state";
import { FileIcon } from "../../ui/icons";
import {
  Attachment,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/ui/shadcn/attachment";
import { Button } from "@/ui/shadcn/button";
import { ImageAttachmentThumb } from "./image-attachment-thumb";
import { parseAnnotatedPrompt } from "./annotations/annotation-prompt";

function queuedPreview(text: string): string {
  const annotated = parseAnnotatedPrompt(text);
  if (!annotated) return text;
  const count = annotated.annotations.length;
  const label = `${count} annotation${count === 1 ? "" : "s"}`;
  return annotated.body.trim() ? `${annotated.body.trim()} · ${label}` : label;
}

interface QueuedComposerMessagesProps {
  readonly messages: readonly QueuedComposerMessage[];
  readonly editingQueuedMessageId?: string;
  readonly onEditMessage: (messageId: string) => void;
  readonly onRemoveMessage: (messageId: string) => void;
  readonly onSteerMessage: (messageId: string) => void;
  readonly onCancelEdit: () => void;
}

export function QueuedComposerMessages({
  messages,
  editingQueuedMessageId,
  onEditMessage,
  onRemoveMessage,
  onSteerMessage,
  onCancelEdit,
}: QueuedComposerMessagesProps) {
  if (messages.length === 0 && !editingQueuedMessageId) {
    return null;
  }

  return (
    <div className="queued-composer-messages" data-testid="queued-composer-messages">
      {editingQueuedMessageId ? (
        <div className="queued-composer-messages__editing" data-testid="queued-composer-editing">
          <span>Editing queued message</span>
          <Button size="xs" variant="ghost" onClick={onCancelEdit}>
            Cancel
          </Button>
        </div>
      ) : null}
      {messages.map((message) => (
        <div
          className={`queued-composer-message ${message.id === editingQueuedMessageId ? "queued-composer-message--editing" : ""}`}
          data-testid="queued-composer-message"
          key={message.id}
        >
          <div className="queued-composer-message__header">
            {message.text ? (
              <div className="queued-composer-message__text">{queuedPreview(message.text)}</div>
            ) : null}
            <div className="queued-composer-message__actions">
              {message.mode !== "steer" ? (
                <Button size="xs" variant="ghost" onClick={() => onSteerMessage(message.id)}>
                  Steer
                </Button>
              ) : null}
              {/* Its annotations cannot be reattached to the transcript, so it is not editable. */}
              {parseAnnotatedPrompt(message.text) ? null : (
                <Button size="xs" variant="ghost" onClick={() => onEditMessage(message.id)}>
                  Edit
                </Button>
              )}
              <Button
                aria-label={`Delete queued message ${message.text || message.id}`}
                size="xs"
                variant="ghost"
                onClick={() => onRemoveMessage(message.id)}
              >
                Delete
              </Button>
            </div>
          </div>
          {message.attachments.length > 0 ? (
            <AttachmentGroup>
              {message.attachments.map((attachment, index) => (
                <QueuedAttachmentPreview
                  attachment={attachment}
                  key={`${message.id}:${attachment.name}:${index}`}
                />
              ))}
            </AttachmentGroup>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function QueuedAttachmentPreview({ attachment }: { readonly attachment: ComposerAttachment }) {
  return (
    <Attachment
      className={`queued-composer-attachment queued-composer-attachment--${attachment.kind} max-w-56`}
      size="xs"
    >
      {attachment.kind === "image" ? (
        <AttachmentMedia variant="image">
          <ImageAttachmentThumb
            className="queued-composer-attachment__preview size-full"
            name={attachment.name}
            src={`data:${attachment.mimeType};base64,${attachment.data}`}
          />
        </AttachmentMedia>
      ) : (
        <AttachmentMedia>
          <FileIcon />
        </AttachmentMedia>
      )}
      <AttachmentContent>
        <AttachmentTitle className="queued-composer-attachment__name">
          {attachment.name}
        </AttachmentTitle>
      </AttachmentContent>
    </Attachment>
  );
}
