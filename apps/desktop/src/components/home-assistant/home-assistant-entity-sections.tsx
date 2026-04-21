import type { HomeAssistantEntitySummary, HomeAssistantState } from "@slate/shared";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { formatHomeAssistantCardValue, HomeAssistantEntityCard } from "./HomeAssistantEntityCard";
import {
  getHomeAssistantEntityBentoClass,
  homeAssistantEntityMasonryContainerClass,
  homeAssistantEntityMasonrySingleColumnClass,
} from "./home-assistant-bento";

export function HomeAssistantControllableEntitiesSection({
  instanceId,
  entities,
  onEntityChanged,
  onOpenDetails,
}: {
  instanceId: string;
  entities: HomeAssistantEntitySummary[];
  onEntityChanged: (state?: HomeAssistantState | null) => void;
  onOpenDetails?: (entity: HomeAssistantEntitySummary) => void;
}) {
  if (entities.length === 0) {
    return null;
  }

  return (
    <section className="grid gap-2">
      <h3 className="m-0 text-[0.78rem] font-medium uppercase tracking-[0.08em] text-faint">
        Controls
      </h3>
      <div
        className={
          entities.length <= 1
            ? homeAssistantEntityMasonrySingleColumnClass
            : homeAssistantEntityMasonryContainerClass
        }
      >
        {entities.map((entity) => (
          <div
            key={entity.entityId}
            className={getHomeAssistantEntityBentoClass(entity, "masonry")}
          >
            <HomeAssistantEntityCard
              instanceId={instanceId}
              entity={entity}
              onChanged={onEntityChanged}
              onOpenDetails={onOpenDetails}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export function HomeAssistantReadOnlyEntitiesSection({
  instanceId,
  entities,
  onEntityChanged,
  onOpenDetails,
}: {
  instanceId: string;
  entities: HomeAssistantEntitySummary[];
  onEntityChanged?: (state?: HomeAssistantState | null) => void;
  onOpenDetails?: (entity: HomeAssistantEntitySummary) => void;
}) {
  if (entities.length === 0) {
    return null;
  }

  const cameraEntities = entities.filter((entity) => entity.domain === "camera");
  const listEntities = entities.filter((entity) => entity.domain !== "camera");

  return (
    <section className="grid gap-2" aria-label="Read-only list view">
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 text-[0.78rem] font-medium uppercase tracking-[0.08em] text-faint">
          Read-only
        </h3>
      </div>
      {cameraEntities.length > 0 ? (
        <div
          className={
            cameraEntities.length <= 1
              ? homeAssistantEntityMasonrySingleColumnClass
              : homeAssistantEntityMasonryContainerClass
          }
        >
          {cameraEntities.map((entity) => (
            <div
              key={entity.entityId}
              className={getHomeAssistantEntityBentoClass(entity, "masonry")}
            >
              <HomeAssistantEntityCard
                instanceId={instanceId}
                entity={entity}
                onChanged={onEntityChanged}
                onOpenDetails={onOpenDetails}
              />
            </div>
          ))}
        </div>
      ) : null}
      {listEntities.length > 0 ? (
        <div className="divide-y divide-white/[0.055] rounded-lg border border-white/[0.055] bg-white/[0.012]">
          {listEntities.map((entity) => (
            <button
              key={entity.entityId}
              type="button"
              onClick={() => onOpenDetails?.(entity)}
              className={cn(
                "grid min-w-0 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left transition",
                onOpenDetails ? "cursor-pointer hover:bg-white/[0.04]" : "cursor-default",
              )}
              disabled={!onOpenDetails}
            >
              <div className="min-w-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-block w-fit max-w-full truncate text-[0.84rem] text-foreground">
                      {entity.name}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    align="start"
                    className="max-w-sm break-all font-mono text-[0.72rem]"
                  >
                    {entity.entityId}
                  </TooltipContent>
                </Tooltip>
              </div>
              <span className="max-w-[9rem] truncate rounded-md border border-white/[0.07] px-1.5 py-0.5 text-[0.7rem] capitalize text-muted">
                {formatHomeAssistantCardValue(entity.state?.state)}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
