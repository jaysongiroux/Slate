import { GitlabProvider } from "../providers/gitlab.provider";

function mockGitbeaker(overrides: Record<string, unknown> = {}) {
  return {
    Users: { showCurrentUser: jest.fn() },
    MergeRequests: { all: jest.fn(), show: jest.fn() },
    Issues: { all: jest.fn(), show: jest.fn() },
    Projects: { all: jest.fn() },
    TodoLists: { all: jest.fn() },
    ...overrides,
  };
}

describe("GitlabProvider", () => {
  it("validateToken returns username from current user", async () => {
    const api = mockGitbeaker();
    (api.Users.showCurrentUser as jest.Mock).mockResolvedValue({
      username: "jgiroux",
      avatar_url: "https://g.l/y.png",
    });
    const provider = new GitlabProvider(api as unknown as never, "https://gitlab.com/api/v4");
    const result = await provider.validateToken();
    expect(result).toEqual({ username: "jgiroux", avatarUrl: "https://g.l/y.png" });
  });

  it("getCounts aggregates my MRs, review requests, todos, assigned issues", async () => {
    const api = mockGitbeaker();
    (api.Users.showCurrentUser as jest.Mock).mockResolvedValue({ id: 7, username: "me" });
    (api.MergeRequests.all as jest.Mock)
      .mockResolvedValueOnce(new Array(3).fill({}))
      .mockResolvedValueOnce(new Array(2).fill({}));
    (api.Issues.all as jest.Mock).mockResolvedValue(new Array(4).fill({}));
    (api.TodoLists.all as jest.Mock).mockResolvedValue(new Array(7).fill({}));

    const provider = new GitlabProvider(api as unknown as never, "https://gitlab.com/api/v4");
    const counts = await provider.getCounts();

    expect(counts).toEqual({ myPRs: 3, reviewing: 2, notifications: 7, assignedIssues: 4 });
  });

  it("listMyPullRequests normalizes MRs to ForgePullRequest shape", async () => {
    const api = mockGitbeaker();
    (api.Users.showCurrentUser as jest.Mock).mockResolvedValue({ id: 7, username: "me" });
    (api.MergeRequests.all as jest.Mock).mockResolvedValue([
      {
        id: 99,
        iid: 12,
        title: "Refactor auth",
        references: { full: "acme/auth!12" },
        state: "opened",
        draft: false,
        author: { username: "me", avatar_url: "a" },
        created_at: "2026-04-01",
        updated_at: "2026-04-02",
        web_url: "https://gitlab.com/acme/auth/-/merge_requests/12",
      },
    ]);

    const provider = new GitlabProvider(api as unknown as never, "https://gitlab.com/api/v4");
    const page = await provider.listMyPullRequests();

    expect(page.items[0]).toMatchObject({
      number: 12,
      title: "Refactor auth",
      repo: "acme/auth",
      provider: "gitlab",
      state: "open",
      webUrl: "https://gitlab.com/acme/auth/-/merge_requests/12",
    });
  });
});
