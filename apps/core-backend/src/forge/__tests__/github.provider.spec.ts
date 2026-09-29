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
  const searchItem = (id: number, updatedAt: string) => ({
    id,
    number: id,
    title: `PR ${id}`,
    repository_url: "https://api.github.com/repos/acme/repo",
    state: "open",
    draft: false,
    user: { login: "me" },
    created_at: updatedAt,
    updated_at: updatedAt,
    html_url: `https://github.com/acme/repo/pull/${id}`,
  });

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

  it("searches open PRs within one repository using provider pagination", async () => {
    const octokit = mockOctokit();
    (octokit.rest.search.issuesAndPullRequests as jest.Mock).mockResolvedValue({
      data: { items: [searchItem(42, "2026-04-02T00:00:00Z")], total_count: 31 },
    });
    const provider = new GithubProvider(octokit as unknown as never, "https://api.github.com");
    const page = await provider.listRepoPullRequests("acme/repo", "2", "fix auth");
    expect(octokit.rest.search.issuesAndPullRequests).toHaveBeenCalledWith(
      expect.objectContaining({
        q: '"fix auth" in:title,body is:pr is:open repo:acme/repo',
        page: 2,
      }),
    );
    expect(octokit.rest.pulls.list).not.toHaveBeenCalled();
    expect(page.items[0].number).toBe(42);
    expect(page.nextCursor).toBeNull();
  });

  it.each([
    ["all", ""],
    ["open", "is:open"],
    ["merged", "is:merged"],
    ["closed", "is:closed is:unmerged"],
  ] as const)("searchPullRequests maps %s state", async (state, qualifier) => {
    const octokit = mockOctokit();
    (octokit.rest.repos.listForAuthenticatedUser as jest.Mock).mockResolvedValue({
      data: [{ full_name: "acme/repo" }],
    });
    (octokit.rest.search.issuesAndPullRequests as jest.Mock).mockResolvedValue({
      data: { items: [searchItem(1, "2026-04-02T00:00:00Z")], total_count: 1 },
    });
    const provider = new GithubProvider(octokit as unknown as never, "https://api.github.com");
    const page = await provider.searchPullRequests("fix auth", state);
    const q = (octokit.rest.search.issuesAndPullRequests as jest.Mock).mock.calls[0][0].q;
    expect(q).toContain('"fix auth" in:title,body is:pr');
    expect(q).toContain("repo:acme/repo");
    if (qualifier) expect(q).toContain(qualifier);
    else expect(q).not.toMatch(/is:(?:open|merged|closed)/);
    if (state === "merged") expect(page.items[0].state).toBe("merged");
  });

  it("enumerates repository pages and searches repositories beyond the first page", async () => {
    const octokit = mockOctokit();
    const repos = Array.from({ length: 101 }, (_, i) => ({ full_name: `acme/repo-${i}` }));
    (octokit.rest.repos.listForAuthenticatedUser as jest.Mock)
      .mockResolvedValueOnce({ data: repos.slice(0, 100) })
      .mockResolvedValueOnce({ data: repos.slice(100) });
    (octokit.rest.search.issuesAndPullRequests as jest.Mock).mockImplementation(async ({ q }) => ({
      data: q.includes("repo:acme/repo-100")
        ? { items: [searchItem(100, "2026-04-02T00:00:00Z")], total_count: 1 }
        : { items: [], total_count: 0 },
    }));
    const provider = new GithubProvider(octokit as unknown as never, "https://api.github.com");
    const page = await provider.searchPullRequests("fix", "all");
    expect(page.items.map((item) => item.id)).toContain("100");
    expect(octokit.rest.repos.listForAuthenticatedUser).toHaveBeenCalledTimes(2);
    expect(octokit.rest.search.issuesAndPullRequests).toHaveBeenCalledTimes(6);
  });

  it("merges grouped search results in updated order and paginates without duplicates", async () => {
    const octokit = mockOctokit();
    (octokit.rest.repos.listForAuthenticatedUser as jest.Mock).mockResolvedValue({
      data: Array.from({ length: 21 }, (_, i) => ({ full_name: `acme/repo-${i}` })),
    });
    (octokit.rest.search.issuesAndPullRequests as jest.Mock).mockImplementation(async ({ q }) => {
      const firstGroup = q.includes("repo:acme/repo-0");
      const ids = firstGroup
        ? Array.from({ length: 20 }, (_, i) => i * 2 + 1)
        : Array.from({ length: 20 }, (_, i) => i * 2 + 2);
      return {
        data: {
          items: ids.map((id) =>
            searchItem(id, `2026-04-${String(30 - Math.floor(id / 2)).padStart(2, "0")}T00:00:00Z`),
          ),
          total_count: 20,
        },
      };
    });
    const provider = new GithubProvider(octokit as unknown as never, "https://api.github.com");
    const first = await provider.searchPullRequests("fix", "all");
    const second = await provider.searchPullRequests("fix", "all", first.nextCursor!);
    expect(first.items).toHaveLength(30);
    expect(second.items).toHaveLength(10);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(40);
    expect(second.nextCursor).toBeNull();
  });

  it("propagates provider failures during search", async () => {
    const octokit = mockOctokit();
    (octokit.rest.repos.listForAuthenticatedUser as jest.Mock).mockRejectedValue(
      new Error("offline"),
    );
    const provider = new GithubProvider(octokit as unknown as never, "https://api.github.com");
    await expect(provider.searchPullRequests("fix", "all")).rejects.toThrow("offline");
  });
});
