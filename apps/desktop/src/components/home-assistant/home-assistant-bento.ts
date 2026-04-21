import type { HomeAssistantEntitySummary } from "@slate/shared";

/** Multi-column “masonry” container: packs cards without row-height gaps (see CSS columns). */
export const homeAssistantEntityMasonryContainerClass =
  "min-w-0 [column-gap:0.75rem] columns-2 md:columns-3 xl:columns-4";

/** One column so a single card spans the full row (avoids a lone tile stuck in a narrow column slot). */
export const homeAssistantEntityMasonrySingleColumnClass = "min-w-0 [column-gap:0.75rem] columns-1";

export type HomeAssistantEntityLayout = "grid" | "masonry";

export function getHomeAssistantEntityBentoClass(
  entity: HomeAssistantEntitySummary,
  layout: HomeAssistantEntityLayout = "grid",
) {
  if (layout === "masonry") {
    return "mb-3 break-inside-avoid";
  }

  if (entity.domain === "camera") {
    return "sm:[grid-column:span_2] xl:[grid-row:span_2]";
  }

  if (
    entity.domain === "climate" ||
    entity.supportedControls.includes("light_brightness") ||
    entity.supportedControls.includes("light_color")
  ) {
    return "lg:[grid-column:span_2]";
  }

  return "";
}
