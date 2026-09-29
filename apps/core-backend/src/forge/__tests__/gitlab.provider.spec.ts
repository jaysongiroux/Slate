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
  it.each([
    ["all", "all"],
    ["open", "opened"],
    ["merged", "merged"],
    ["closed", "closed"],
  ] as const)("searchPullRequests maps %s state and text", async (state, gitlabState) => {
    const api = mockGitbeaker();
    (api.MergeRequests.all as jest.Mock).mockResolvedValue([
      {
        id: 1,
        iid: 7,
        title: "Fix auth",
        references: { full: "acme/app!7" },
        state: gitlabState,
        draft: false,
        author: { username: "me" },
        created_at: "2026-04-01",
        updated_at: "2026-04-02",
        web_url: "https://gitlab.com/acme/app/-/merge_requests/7",
      },
    ]);
    const provider = new GitlabProvider(api as unknown as never, "https://gitlab.com/api/v4");
    const page = await provider.searchPullRequests("Fix auth", state, "2");
    expect(api.MergeRequests.all).toHaveBeenCalledWith(
      expect.objectContaining({
        search: "Fix auth",
        scope: "all",
        state: gitlabState,
        page: 2,
        perPage: 30,
        orderBy: "updated_at",
        sort: "desc",
      }),
    );
    expect(page.items[0]).toMatchObject({ title: "Fix auth", repo: "acme/app" });
  });

  it("propagates MR search failures", async () => {
    const api = mockGitbeaker();
    (api.MergeRequests.all as jest.Mock).mockRejectedValue(new Error("offline"));
    const provider = new GitlabProvider(api as unknown as never, "https://gitlab.com/api/v4");
    await expect(provider.searchPullRequests("fix", "all")).rejects.toThrow("offline");
  });

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

  it("listRepoPullRequests passes the raw project path to Gitbeaker (no double-encoding)", async () => {
    const api = mockGitbeaker();
    (api.MergeRequests.all as jest.Mock).mockResolvedValue([]);

    const provider = new GitlabProvider(api as unknown as never, "https://gitlab.com/api/v4");
    await provider.listRepoPullRequests("acme/common/eng_portals");

    expect(api.MergeRequests.all).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "acme/common/eng_portals" }),
    );
  });

  it("searches open MRs in the selected nested project", async () => {
    const api = mockGitbeaker();
    (api.MergeRequests.all as jest.Mock).mockResolvedValue([]);
    const provider = new GitlabProvider(api as unknown as never, "https://gitlab.com/api/v4");
    await provider.listRepoPullRequests("acme/common/eng_portals", "2", "fix auth");
    expect(api.MergeRequests.all).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "acme/common/eng_portals",
        search: "fix auth",
        state: "opened",
        page: 2,
      }),
    );
  });

  it("listRepoIssues passes the raw project path to Gitbeaker (no double-encoding)", async () => {
    const api = mockGitbeaker();
    (api.Issues.all as jest.Mock).mockResolvedValue([]);

    const provider = new GitlabProvider(api as unknown as never, "https://gitlab.com/api/v4");
    await provider.listRepoIssues("acme/common/eng_portals");

    expect(api.Issues.all).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "acme/common/eng_portals" }),
    );
  });

  it("fetchItemDetails passes the raw project path to Gitbeaker", async () => {
    const api = mockGitbeaker();
    (api.MergeRequests.show as jest.Mock).mockResolvedValue({
      title: "X",
      web_url: "https://gitlab.com/acme/common/eng_portals/-/merge_requests/5",
    });

    const provider = new GitlabProvider(api as unknown as never, "https://gitlab.com/api/v4");
    await provider.fetchItemDetails("pr", "acme/common/eng_portals", 5);

    expect(api.MergeRequests.show).toHaveBeenCalledWith("acme/common/eng_portals", 5);
  });
});
