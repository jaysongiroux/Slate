import { HousePlug } from "lucide-react";
import { useHomeAssistantStore } from "../../stores/home-assistant-store";
import { HomeAssistantBrowseView } from "./HomeAssistantBrowseView";
import { HomeAssistantDashboardView } from "./HomeAssistantDashboardView";

interface HomeAssistantPanelProps {
  refreshSignal?: number;
}

export function HomeAssistantPanel({ refreshSignal = 0 }: HomeAssistantPanelProps) {
  const selectedInstanceId = useHomeAssistantStore((s) => s.selectedInstanceId);
  const selectedDashboardId = useHomeAssistantStore((s) => s.selectedDashboardId);
  const selectedBrowseMode = useHomeAssistantStore((s) => s.selectedBrowseMode);
  const disableContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  if (!selectedInstanceId) {
    return (
      <div
        className="flex h-full min-h-0 min-w-0 w-full flex-1 overflow-hidden"
        onContextMenu={disableContextMenu}
      >
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center px-8 text-center text-sm text-muted">
          <div className="max-w-sm">
            <HousePlug className="mx-auto mb-3 text-faint" size={28} strokeWidth={1.5} />
            <p className="m-0 text-[0.95rem] font-medium text-foreground">Home Assistant</p>
            <p className="m-0 mt-1 text-[0.84rem] leading-snug text-faint">
              Add or select an instance to browse dashboards and entities.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (selectedBrowseMode !== "dashboards") {
    return (
      <div
        className="flex h-full min-h-0 min-w-0 w-full flex-1 overflow-hidden"
        onContextMenu={disableContextMenu}
      >
        <HomeAssistantBrowseView
          instanceId={selectedInstanceId}
          mode={selectedBrowseMode}
          refreshSignal={refreshSignal}
        />
      </div>
    );
  }

  if (!selectedDashboardId) {
    return (
      <div
        className="flex h-full min-h-0 min-w-0 w-full flex-1 overflow-hidden"
        onContextMenu={disableContextMenu}
      >
        <div className="p-8 text-sm text-faint">Select a dashboard to begin.</div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 min-w-0 w-full flex-1 overflow-hidden"
      onContextMenu={disableContextMenu}
    >
      <HomeAssistantDashboardView
        instanceId={selectedInstanceId}
        dashboardId={selectedDashboardId}
        refreshSignal={refreshSignal}
      />
    </div>
  );
}
