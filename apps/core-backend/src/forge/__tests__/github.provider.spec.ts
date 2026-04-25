import { GithubProvider } from "../providers/github.provider";

function mockOctokit(overrides: Record<string, unknown> = {}) {
  return {
    request: jest.fn(),
    rest: {
      users: { getAuthenticated: jest.fn() },
      pulls: { list: jest.fn(), get: jest.fn() },
      issues: { list: jest.fn(), get: jest.fn() },
      search: { issuesAndPullRequests: jest.fn() },
      activity: { listNotificationsForAuthenticatedUser: jest.fn() },
      repos: { listForAuthenticatedUser: jest.fn() },
    },
    ...overrides,
  };
}

describe("GithubProvider", () => {
  it("validateToken returns username from /user", async () => {
    const octokit = mockOctokit();
    (octokit.rest.users.getAuthenticated as jest.Mock).mockResolvedValue({
      data: { login: "jgiroux", avatar_url: "https://x/y.png" },
    });
    const provider = new GithubProvider(octokit as unknown as never, "https://api.github.com");
    const result = await provider.validateToken();
    expect(result).toEqual({ username: "jgiroux", avatarUrl: "https://x/y.png" });
  });

  it("getCounts runs 4 search queries and returns totals", async () => {
    const octokit = mockOctokit();
    (octokit.rest.users.getAuthenticated as jest.Mock).mockResolvedValue({ data: { login: "me" } });
    (octokit.rest.search.issuesAndPullRequests as jest.Mock)
      .mockResolvedValueOnce({ data: { total_count: 3 } })
      .mockResolvedValueOnce({ data: { total_count: 2 } })
      .mockResolvedValueOnce({ data: { total_count: 4 } });
    (octokit.rest.activity.listNotificationsForAuthenticatedUser as jest.Mock).mockResolvedValue({
      data: new Array(7).fill({}),
    });

    const provider = new GithubProvider(octokit as unknown as never, "https://api.github.com");
    const counts = await provider.getCounts();

    expect(counts).toEqual({ myPRs: 3, reviewing: 2, notifications: 7, assignedIssues: 4 });
  });

  it("listMyPullRequests normalizes search results to ForgePullRequest shape", async () => {
    const octokit = mockOctokit();
    (octokit.rest.users.getAuthenticated as jest.Mock).mockResolvedValue({ data: { login: "me" } });
    (octokit.rest.search.issuesAndPullRequests as jest.Mock).mockResolvedValue({
      data: {
        items: [
          {
            id: 42,
            number: 101,
            title: "Add forge",
            repository_url: "https://api.github.com/repos/acme/frontend",
            state: "open",
            draft: false,
            user: { login: "me", avatar_url: "a.png" },
            created_at: "2026-04-01T00:00:00Z",
            updated_at: "2026-04-02T00:00:00Z",
            html_url: "https://github.com/acme/frontend/pull/101",
          },
        ],
        total_count: 1,
      },
    });

    const provider = new GithubProvider(octokit as unknown as never, "https://api.github.com");
    const page = await provider.listMyPullRequests();

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      number: 101,
      title: "Add forge",
      repo: "acme/frontend",
      provider: "github",
      state: "open",
      webUrl: "https://github.com/acme/frontend/pull/101",
      draft: false,
    });
  });

  it("cursor advances page number and null nextCursor when no more", async () => {
    const octokit = mockOctokit();
    (octokit.rest.users.getAuthenticated as jest.Mock).mockResolvedValue({ data: { login: "me" } });
    (octokit.rest.search.issuesAndPullRequests as jest.Mock).mockResolvedValue({
      data: { items: [], total_count: 0 },
    });

    const provider = new GithubProvider(octokit as unknown as never, "https://api.github.com");
    const page = await provider.listMyPullRequests("3");

    expect(page.nextCursor).toBeNull();
    const call = (octokit.rest.search.issuesAndPullRequests as jest.Mock).mock.calls[0][0];
    expect(call.page).toBe(3);
  });
});
