import { useJiraStore } from "../../stores/jira-store";
import { ProjectList } from "./ProjectList";
import { IssueList } from "./IssueList";
import { IssueDetail } from "./IssueDetail";
import { BoardView } from "./BoardView";

export function JiraPanel() {
  const selectedInstanceId = useJiraStore((s) => s.selectedInstanceId);
  const view = useJiraStore((s) => s.view);

  if (!selectedInstanceId) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-[0.85rem] text-faint">
        Select a Jira instance to get started.
      </div>
    );
  }

  if (view === "projects") {
    return <ProjectList />;
  }

  if (view === "issues") {
    return <IssueList />;
  }

  if (view === "issue-detail") {
    return <IssueDetail />;
  }

  if (view === "board") {
    return <BoardView />;
  }

  return null;
}
