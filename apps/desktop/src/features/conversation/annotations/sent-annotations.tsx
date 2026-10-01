import { Collapsible, CollapsibleTrigger } from "@/ui/shadcn/collapsible";
import type { SentAnnotation } from "./annotation-prompt";

/** The quotes a sent message carried, each collapsed to one line until clicked open. */
export function SentAnnotations({
  annotations,
}: {
  readonly annotations: readonly SentAnnotation[];
}) {
  return (
    <div className="sent-annotations">
      {annotations.map((annotation, index) => (
        <div className="sent-annotation" data-testid="sent-annotation" key={index}>
          {/* The quote itself unfolds, so there is no separate panel. */}
          <Collapsible className="sent-annotation__quote">
            <CollapsibleTrigger className="sent-annotation__toggle">
              {annotation.quote}
            </CollapsibleTrigger>
          </Collapsible>
          {annotation.note ? <p className="sent-annotation__note">{annotation.note}</p> : null}
        </div>
      ))}
    </div>
  );
}
