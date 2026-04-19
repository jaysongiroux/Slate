import type { HomeAssistantEntitySummary, HomeAssistantState } from "@slate/shared";
import { formatHomeAssistantCardValue, HomeAssistantEntityCard } from "./HomeAssistantEntityCard";
import {
  getHomeAssistantEntityBentoClass,
  homeAssistantEntityMasonryContainerClass,
} from "./home-assistant-bento";

export function HomeAssistantControllableEntitiesSection({
  instanceId,
  entities,
  onEntityChanged,
}: {
  instanceId: string;
  entities: HomeAssistantEntitySummary[];
  onEntityChanged: (state?: HomeAssistantState | null) => void;
}) {
  if (entities.length === 0) {
    return null;
  }

  return (
    <section className="grid gap-2">
      <h3 className="m-0 text-[0.78rem] font-medium uppercase tracking-[0.08em] text-faint">
        Controls
      </h3>
      <div className={homeAssistantEntityMasonryContainerClass}>
        {entities.map((entity) => (
          <div
            key={entity.entityId}
            className={getHomeAssistantEntityBentoClass(entity, "masonry")}
          >
            <HomeAssistantEntityCard
              instanceId={instanceId}
              entity={entity}
              onChanged={onEntityChanged}
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
}: {
  instanceId: string;
  entities: HomeAssistantEntitySummary[];
  onEntityChanged?: (state?: HomeAssistantState | null) => void;
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
        <span className="text-[0.72rem] text-faint">{entities.length}</span>
      </div>
      {cameraEntities.length > 0 ? (
        <div className={homeAssistantEntityMasonryContainerClass}>
          {cameraEntities.map((entity) => (
            <div
              key={entity.entityId}
              className={getHomeAssistantEntityBentoClass(entity, "masonry")}
            >
              <HomeAssistantEntityCard
                instanceId={instanceId}
                entity={entity}
                onChanged={onEntityChanged}
              />
            </div>
          ))}
        </div>
      ) : null}
      {listEntities.length > 0 ? (
        <div className="divide-y divide-white/[0.055] rounded-lg border border-white/[0.055] bg-white/[0.012]">
          {listEntities.map((entity) => (
            <div
              key={entity.entityId}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-[0.84rem] text-foreground">{entity.name}</div>
                <div className="mt-0.5 truncate text-[0.7rem] text-faint">{entity.entityId}</div>
                <div className="mt-1 text-[0.7rem] leading-snug text-faint">
                  Controls unsupported. Slate can display this entity, but controls are not
                  supported yet.
                </div>
              </div>
              <span className="max-w-[9rem] truncate rounded-md border border-white/[0.07] px-1.5 py-0.5 text-[0.7rem] capitalize text-muted">
                {formatHomeAssistantCardValue(entity.state?.state)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
