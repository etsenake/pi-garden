import { XIcon } from "lucide-react";
import { Button } from "@/ui/shadcn/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/ui/shadcn/dialog";

interface ImageAttachmentThumbProps {
  readonly src: string;
  readonly name: string;
  readonly className: string;
}

/** Image attachment thumbnail that opens the full image in a focused viewer when clicked. */
export function ImageAttachmentThumb({ src, name, className }: ImageAttachmentThumbProps) {
  return (
    <Dialog>
      <DialogTrigger
        aria-label={`View ${name}`}
        className={`image-attachment-thumb ${className}`}
        title={name}
      >
        <img alt={name} src={src} />
      </DialogTrigger>
      <DialogContent
        aria-label={name}
        className="w-auto max-w-[calc(100vw-6rem)] sm:max-w-[calc(100vw-6rem)]"
        data-testid="image-viewer"
        showCloseButton={false}
      >
        <img alt={name} className="max-h-[calc(100vh-8rem)] max-w-full object-contain" src={src} />
        <DialogClose
          render={
            <Button
              aria-label="Close image"
              className="absolute top-2 right-2"
              size="icon-sm"
              variant="secondary"
            />
          }
        >
          <XIcon />
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
