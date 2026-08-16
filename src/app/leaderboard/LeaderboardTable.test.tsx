import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import LeaderboardTable from "./LeaderboardTable";
import { NET_WPM_LABEL } from "@/engine/metrics";
import type { LeaderboardEntry } from "@/types/schema";

const entry = (overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry => ({
  uid: "u1",
  snippetId: "rocket-launch",
  displayName: "Ada",
  photoURL: "",
  netWpm: 60,
  grossWpm: 62,
  accuracy: 0.97,
  runId: "run1",
  achievedAt: 1,
  ...overrides,
});

describe("LeaderboardTable", () => {
  it("ranks rows in the order given", () => {
    render(
      <LeaderboardTable
        entries={[
          entry({ uid: "a", displayName: "Grace", netWpm: 90 }),
          entry({ uid: "b", displayName: "Ada", netWpm: 70 }),
        ]}
      />,
    );

    const rows = screen.getAllByTestId("leaderboard-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("1");
    expect(rows[0]).toHaveTextContent("Grace");
    expect(rows[1]).toHaveTextContent("2");
  });

  it("never labels the score as plain Net WPM", () => {
    render(<LeaderboardTable entries={[entry()]} />);
    // It is not the textbook definition, and players compare across sites (§4.5).
    expect(screen.getByText(NET_WPM_LABEL)).toBeInTheDocument();
    expect(NET_WPM_LABEL).toMatch(/error-penalized/);
  });

  it("shows accuracy as a percentage", () => {
    render(<LeaderboardTable entries={[entry({ accuracy: 0.9345 })]} />);
    expect(screen.getByText("93%")).toBeInTheDocument();
  });

  it("names the level only on the global board", () => {
    const { rerender } = render(<LeaderboardTable entries={[entry()]} />);
    expect(screen.queryByText("rocket-launch")).toBeNull();

    rerender(<LeaderboardTable entries={[entry()]} showSnippet />);
    expect(screen.getByText("rocket-launch")).toBeInTheDocument();
  });

  it("invites the first run instead of showing an empty table", () => {
    render(<LeaderboardTable entries={[]} />);
    expect(screen.getByTestId("leaderboard-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("leaderboard-table")).toBeNull();
  });

  it("omits the avatar rather than rendering a broken image", () => {
    const { container } = render(<LeaderboardTable entries={[entry({ photoURL: "" })]} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("keys rows so one user can appear on both boards without collision", () => {
    // Same uid, different snippet — a global board shows one row per user, but
    // the component must not assume that.
    render(
      <LeaderboardTable
        entries={[entry({ snippetId: "rocket-launch" }), entry({ snippetId: "digital-badge" })]}
        showSnippet
      />,
    );
    expect(screen.getAllByTestId("leaderboard-row")).toHaveLength(2);
  });
});
