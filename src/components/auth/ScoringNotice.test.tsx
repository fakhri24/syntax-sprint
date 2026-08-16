import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScoringNotice from "./ScoringNotice";
import AuthBadge from "./AuthBadge";
import type { AuthStatus, AuthValue } from "./AuthProvider";

const signIn = vi.fn();
const signOut = vi.fn();
let value: AuthValue;

vi.mock("./AuthProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./AuthProvider")>();
  return { ...actual, useAuth: () => value };
});

function setAuth(status: AuthStatus, user: AuthValue["user"] = null) {
  value = { user, status, error: null, signIn, signOut };
}

beforeEach(() => {
  vi.clearAllMocks();
  setAuth("signed-out");
});

describe("ScoringNotice", () => {
  it("tells a signed-out player the run will not count, before they start", () => {
    render(<ScoringNotice />);
    const notice = screen.getByTestId("scoring-notice");

    expect(notice.dataset.scoring).toBe("no");
    expect(notice).toHaveTextContent(/practice run/i);
    // The requirement has to be stated up front — after the run it is too late (§4.6).
    expect(notice).toHaveTextContent(/before you start/i);
  });

  it("confirms scoring once signed in", () => {
    setAuth("signed-in", { uid: "u1", displayName: "Ada", email: "a@b.c", photoURL: "" });
    render(<ScoringNotice />);

    const notice = screen.getByTestId("scoring-notice");
    expect(notice.dataset.scoring).toBe("yes");
    expect(notice).toHaveTextContent(/this run counts/i);
  });

  it("never claims a run will count while the session is still loading", () => {
    setAuth("loading");
    render(<ScoringNotice />);
    expect(screen.getByTestId("scoring-notice").dataset.scoring).toBe("unknown");
  });

  it("offers sign-in inline, so the player need not leave the level", async () => {
    render(<ScoringNotice />);
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(signIn).toHaveBeenCalled();
  });
});

describe("AuthBadge", () => {
  it("offers sign-in when signed out", async () => {
    render(<AuthBadge />);
    const badge = screen.getByTestId("auth-badge");
    expect(badge.dataset.state).toBe("signed-out");

    await userEvent.click(badge);
    expect(signIn).toHaveBeenCalled();
  });

  it("shows the signed-in identity and a way out", async () => {
    setAuth("signed-in", { uid: "u1", displayName: "Ada", email: "a@b.c", photoURL: "https://x/y.png" });
    render(<AuthBadge />);

    expect(screen.getByTestId("auth-badge").dataset.state).toBe("signed-in");
    expect(screen.getByText("Ada")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(signOut).toHaveBeenCalled();
  });

  it("renders an empty avatar rather than a broken image when the provider gives none", () => {
    setAuth("signed-in", { uid: "u1", displayName: "Ada", email: "a@b.c", photoURL: "" });
    const { container } = render(<AuthBadge />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("stays quiet while loading instead of flashing a sign-in button", () => {
    setAuth("loading");
    render(<AuthBadge />);
    expect(screen.getByTestId("auth-badge").dataset.state).toBe("loading");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
