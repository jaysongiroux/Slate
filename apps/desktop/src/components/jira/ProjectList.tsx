import { useEffect, useState, type SyntheticEvent } from "react";
import { Loader2, Star } from "lucide-react";
import type { JiraProject } from "@slate/shared";
import { getJiraProjects } from "../../lib/api";
import { formatJiraError } from "./jira-errors";
import { useNavigationStore } from "../../stores/navigation-store";
import { useJiraStore } from "../../stores/jira-store";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "../../lib/utils";

function ProjectAvatar({
  project,
  size,
  textSize,
}: {
  project: JiraProject;
  size: string;
  textSize: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!project.avatarUrl || failed) {
    return (
      <div
        className={`flex ${size} shrink-0 items-center justify-center rounded bg-white/[0.06] ${textSize} font-medium text-faint`}
      >
        {project.key.slice(0, 2)}
      </div>
    );
  }

  return (
    <img
      src={project.avatarUrl}
      alt={project.name}
      className={`${size} shrink-0 rounded`}
      onError={() => setFailed(true)}
    />
  );
}

function ProjectRow({ project, onClick }: { project: JiraProject; onClick: () => void }) {
  return (
    <button
      type="button"
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2.5 py-2 text-left text-[0.82rem] text-muted transition-colors hover:bg-white/[0.05]"
      onClick={onClick}
    >
      <ProjectAvatar project={project} size="size-6" textSize="text-[0.65rem]" />
      <span className="min-w-0 flex-1 truncate text-foreground">{project.name}</span>
      <span className="shrink-0 text-[0.75rem] text-faint">{project.key}</span>
    </button>
  );
}

export function ProjectList() {
  const selectedInstanceId = useJiraStore((s) => s.selectedInstanceId);
  const setSelectedProject = useJiraStore((s) => s.setSelectedProject);
  const navPush = useNavigationStore((s) => s.push);

  function selectProject(projectKey: string, projectName: string) {
    setSelectedProject(projectKey, projectName);
    navPush({ type: "jira", projectKey });
  }

  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");


  useEffect(() => {
    if (!selectedInstanceId) {
      setProjects([]);
      return;
    }
    setLoading(true);
    setError(null);
    void getJiraProjects({ instanceId: selectedInstanceId })
      .then((result) => setProjects(result.projects))
      .catch((err) => {
        setError(formatJiraError(err, "Failed to load projects."));
        setProjects([]);
      })
      .finally(() => setLoading(false));
  }, [selectedInstanceId]);

  const filtered = filter.trim()
    ? projects.filter(
      (p) =>
        p.name.toLowerCase().includes(filter.toLowerCase()) ||
        p.key.toLowerCase().includes(filter.toLowerCase()),
    )
    : projects;

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 size={18} className="animate-spin text-faint" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="m-0 text-[0.82rem] text-foreground/40">{error}</p>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-[0.82rem] text-faint">
        No projects found.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Filter input */}
      <div className="border-b border-white/[0.04] px-4 py-2.5">
        <input
          type="text"
          placeholder="Filter projects..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-[6px] text-[0.82rem] text-foreground/75 outline-none placeholder:text-foreground/25 focus:border-white/[0.12]"
        />
      </div>

      <ScrollArea className="note-scroll-area min-h-0 min-w-0 flex-1 [&_.ui-scroll-area__viewport]:overflow-x-hidden! [&_.ui-scroll-area__scrollbar--horizontal]:hidden [&_.ui-scroll-area__scrollbar--vertical]:hidden">
        <div className="flex flex-col gap-px px-4 py-2 pb-6">
          {(() => {
            const favourites = filtered.filter((p) => p.favourite);
            const others = filtered.filter((p) => !p.favourite);
            return (
              <>
                {favourites.length > 0 && (
                  <>
                    <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-[0.72rem] font-medium uppercase tracking-wider text-faint select-none">
                      <Star size={10} className="fill-current" />
                      Starred
                    </div>
                    {favourites.map((project) => (
                      <ProjectRow key={project.id} project={project} onClick={() => selectProject(project.key, project.name)} />
                    ))}
                    {others.length > 0 && (
                      <div className="my-1.5 border-t border-white/[0.04]" />
                    )}
                  </>
                )}
                {others.length > 0 && favourites.length > 0 && (
                  <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-1 text-[0.72rem] font-medium uppercase tracking-wider text-faint select-none">
                    All Projects
                  </div>
                )}
                {others.map((project) => (
                  <ProjectRow key={project.id} project={project} onClick={() => selectProject(project.key, project.name)} />
                ))}
              </>
            );
          })()}
        </div>
      </ScrollArea>
    </div>
  );
}
