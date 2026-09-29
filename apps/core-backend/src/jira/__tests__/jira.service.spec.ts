import { JiraService } from "../jira.service";

function rawIssue(n: number, status: { id: string; name: string; category: string }) {
  return {
    id: String(n),
    key: `GM3K-${n}`,
    fields: {
      summary: `Issue ${n}`,
      status: { id: status.id, name: status.name, statusCategory: { key: status.category } },
    },
  };
}

const DONE = { id: "10001", name: "Done", category: "done" };
const IN_PROGRESS = { id: "10794", name: "Dev: In Progress", category: "indeterminate" };
const BACKLOG = { id: "10016", name: "Backlog", category: "new" };

/** Serves `all` in rank order, honoring startAt and capping pages like Jira does. */
function paged(all: any[], serverCap: number) {
  return jest.fn(async ({ startAt = 0, maxResults = 50 }: any) => {
    const size = Math.min(maxResults, serverCap);
    return {
      startAt,
      maxResults: size,
      total: all.length,
      issues: all.slice(startAt, startAt + size),
    };
  });
}

function serviceWith(client: any): JiraService {
  const svc = new JiraService({} as any, "unit-test-secret");
  (svc as any).getAgileClient = async () => ({ client, instance: {} });
  return svc;
}

describe("JiraService board issue pagination", () => {
  it("returns active issues ranked after the first page of Done issues", async () => {
    // Mirrors a real kanban board: 235 old Done issues rank ahead of current work.
    const boardIssues = [
      ...Array.from({ length: 235 }, (_, i) => rawIssue(i + 1, DONE)),
      ...Array.from({ length: 19 }, (_, i) => rawIssue(300 + i, IN_PROGRESS)),
    ];
    const backlogIssues = Array.from({ length: 25 }, (_, i) => rawIssue(500 + i, BACKLOG));
    const client = {
      board: {
        getIssuesForBoard: paged(boardIssues, 100),
        getIssuesForBacklog: paged(backlogIssues, 100),
      },
    };

    const res = await serviceWith(client).getBoardIssues("user-1", "inst-1", 1163);

    const inProgress = res.issues.filter((i) => i.status.id === IN_PROGRESS.id);
    expect(inProgress).toHaveLength(19);
    expect(res.issues).toHaveLength(235 + 19 + 25);
    expect(res.total).toBe(235 + 19 + 25);
  });

  it("returns every sprint issue when the sprint spans multiple pages", async () => {
    const sprintIssues = Array.from({ length: 130 }, (_, i) =>
      rawIssue(i + 1, i < 120 ? DONE : IN_PROGRESS),
    );
    const client = { sprint: { getIssuesForSprint: paged(sprintIssues, 50) } };

    const res = await serviceWith(client).getSprintIssues("user-1", "inst-1", 42);

    expect(res.issues).toHaveLength(130);
    expect(res.issues.filter((i) => i.status.id === IN_PROGRESS.id)).toHaveLength(10);
  });
});
