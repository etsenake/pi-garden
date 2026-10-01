import { useRef, useState } from "react";
import type { TurnChangeSummary, TurnChangedFile } from "../../../contracts/review";
import { FileDiffIcon } from "../../ui/icons";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { Item, ItemContent, ItemGroup, ItemMedia } from "@/ui/shadcn/item";

const COLLAPSED_FILE_COUNT = 5;

export type OpenTurnChange = (turn: TurnChangeSummary, path: string) => void;

/** The files one agent turn changed; each row opens that file's diff in the Changes panel. */
export function TurnChangesCard({
  turn,
  onOpen,
}: {
  readonly turn: TurnChangeSummary;
  readonly onOpen?: OpenTurnChange;
}) {
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const { files } = turn;
  const hidden = expanded ? 0 : Math.max(0, files.length - COLLAPSED_FILE_COUNT);
  const shown = hidden ? files.slice(0, COLLAPSED_FILE_COUNT) : files;
  const totals = files.reduce(
    (sum, file) => ({
      added: sum.added + (file.lines?.added ?? 0),
      removed: sum.removed + (file.lines?.removed ?? 0),
    }),
    { added: 0, removed: 0 },
  );
  const firstFile = files[0];

  return (
    <Card
      aria-label="Files changed in this turn"
      className="gap-1 pb-1"
      data-testid="turn-changes"
      role="region"
      size="sm"
    >
      <CardHeader className="turn-changes__header">
        <Item className="p-0" size="xs">
          <ItemMedia variant="icon">
            <FileDiffIcon />
          </ItemMedia>
          <ItemContent>
            <CardTitle>{`Edited ${files.length} ${files.length === 1 ? "file" : "files"}`}</CardTitle>
            <LineStats lines={totals} />
          </ItemContent>
        </Item>
        {firstFile && onOpen ? (
          <CardAction className="self-center">
            <Button size="sm" variant="outline" onClick={() => onOpen(turn, firstFile.path)}>
              Review
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="px-1">
        <ItemGroup className="gap-0" ref={listRef}>
          {shown.map((file) => (
            <div key={file.path} role="listitem">
              <Button
                className="turn-changes__file w-full justify-between gap-4"
                data-file-path={file.path}
                disabled={!onOpen}
                title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
                variant="ghost"
                onClick={() => onOpen?.(turn, file.path)}
              >
                <FilePath path={file.path} />
                <FileStats file={file} />
              </Button>
            </div>
          ))}
        </ItemGroup>
        {hidden ? (
          <Button
            className="w-full justify-start"
            size="sm"
            variant="ghost"
            onClick={() => {
              setExpanded(true);
              // The button unmounts; keep keyboard focus on the first newly shown file.
              requestAnimationFrame(() =>
                listRef.current
                  ?.querySelectorAll<HTMLButtonElement>(".turn-changes__file")
                  [COLLAPSED_FILE_COUNT]?.focus(),
              );
            }}
          >
            {`Show ${hidden} more`}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FilePath({ path }: { readonly path: string }) {
  const slash = path.lastIndexOf("/");
  return (
    <span className="min-w-0 truncate">
      {slash >= 0 ? <span className="turn-changes__dir">{path.slice(0, slash + 1)}</span> : null}
      {path.slice(slash + 1)}
    </span>
  );
}

function FileStats({ file }: { readonly file: TurnChangedFile }) {
  return file.lines ? <LineStats lines={file.lines} /> : <Badge variant="outline">Binary</Badge>;
}

function LineStats({
  lines,
}: {
  readonly lines: { readonly added: number; readonly removed: number };
}) {
  return (
    <span className="turn-changes__stats">
      <span className="turn-changes__added">+{lines.added}</span>
      <span className="turn-changes__removed">-{lines.removed}</span>
    </span>
  );
}
