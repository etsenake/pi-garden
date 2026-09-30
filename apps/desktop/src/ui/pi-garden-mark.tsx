import piGardenMarkUrl from "../../resources/icon.png";

/**
 * The garden mark as an image. Kept out of `icons.tsx` so modules that only
 * need SVG icons stay importable under the Node-based unit runner, which has
 * no asset loader for PNG imports.
 */
export function PiGardenMark() {
  return <img alt="" aria-hidden="true" draggable={false} src={piGardenMarkUrl} />;
}
