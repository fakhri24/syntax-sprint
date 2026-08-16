import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const onAuthStateChanged = vi.fn();
const signInWithPopup = vi.fn();
const signInWithRedirect = vi.fn();
const signOut = vi.fn();

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (...args: unknown[]) => onAuthStateChanged(...args),
  signInWithPopup: (...args: unknown[]) => signInWithPopup(...args),
  signInWithRedirect: (...args: unknown[]) => signInWithRedirect(...args),
  signOut: (...args: unknown[]) => signOut(...args),
  GoogleAuthProvider: class {},
  getAuth: () => ({}),
}));

vi.mock("@/lib/firebase", () => ({
  getFirebaseAuth: () => ({}),
  googleProvider: {},
}));

const { AuthProvider, useAuth, canSubmitRuns } = await import("./AuthProvider");

/** Captured so a test can drive the auth state the way Firebase would. */
let emit: (user: unknown) => void = () => {};

function Probe() {
  const { user, status, error, signIn, signOut: doSignOut } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="name">{user?.displayName ?? "—"}</span>
      <span data-testid="error">{error ?? ""}</span>
      <button type="button" onClick={() => void signIn()}>
        sign in
      </button>
      <button type="button" onClick={() => void doSignOut()}>
        sign out
      </button>
    </div>
  );
}

function renderAuth() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  onAuthStateChanged.mockImplementation((_auth: unknown, cb: (user: unknown) => void) => {
    emit = cb;
    return () => {};
  });
  signInWithPopup.mockResolvedValue({});
  signInWithRedirect.mockResolvedValue(undefined);
  signOut.mockResolvedValue(undefined);
});

describe("AuthProvider", () => {
  it("starts in loading until Firebase reports", () => {
    renderAuth();
    expect(screen.getByTestId("status")).toHaveTextContent("loading");
  });

  it("treats a signed-out visitor as a normal state, not an error", () => {
    renderAuth();
    act(() => emit(null));

    expect(screen.getByTestId("status")).toHaveTextContent("signed-out");
    expect(screen.getByTestId("error")).toHaveTextContent("");
  });

  it("maps a Firebase user onto the profile fields", () => {
    renderAuth();
    act(() =>
      emit({ uid: "u1", displayName: "Ada", email: "ada@example.com", photoURL: "https://x/y.png" }),
    );

    expect(screen.getByTestId("status")).toHaveTextContent("signed-in");
    expect(screen.getByTestId("name")).toHaveTextContent("Ada");
  });

  it("fills in defaults for a provider that omits profile fields", () => {
    renderAuth();
    act(() => emit({ uid: "u1", displayName: null, email: null, photoURL: null }));
    expect(screen.getByTestId("name")).toHaveTextContent("Anonymous");
  });

  it("unsubscribes on unmount", () => {
    const unsubscribe = vi.fn();
    onAuthStateChanged.mockReturnValue(unsubscribe);
    renderAuth().unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("signs in with a popup", async () => {
    renderAuth();
    act(() => emit(null));
    await userEvent.click(screen.getByRole("button", { name: "sign in" }));

    expect(signInWithPopup).toHaveBeenCalled();
    expect(signInWithRedirect).not.toHaveBeenCalled();
  });

  it("falls back to redirect when the popup is blocked", async () => {
    signInWithPopup.mockRejectedValue({ code: "auth/popup-blocked" });
    renderAuth();
    act(() => emit(null));

    await userEvent.click(screen.getByRole("button", { name: "sign in" }));

    await waitFor(() => expect(signInWithRedirect).toHaveBeenCalled());
    expect(screen.getByTestId("error")).toHaveTextContent("");
  });

  it("does not report an error when the user closes the popup", async () => {
    signInWithPopup.mockRejectedValue({ code: "auth/popup-closed-by-user" });
    renderAuth();
    act(() => emit(null));

    await userEvent.click(screen.getByRole("button", { name: "sign in" }));

    // Changing your mind must not look like a failure.
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent(""));
    expect(signInWithRedirect).not.toHaveBeenCalled();
  });

  it("surfaces a genuine sign-in failure", async () => {
    signInWithPopup.mockRejectedValue({ code: "auth/network-request-failed", message: "offline" });
    renderAuth();
    act(() => emit(null));

    await userEvent.click(screen.getByRole("button", { name: "sign in" }));

    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("offline"));
  });

  it("clears a previous error when signing in again", async () => {
    signInWithPopup.mockRejectedValueOnce({ code: "auth/internal-error", message: "boom" });
    renderAuth();
    act(() => emit(null));

    await userEvent.click(screen.getByRole("button", { name: "sign in" }));
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("boom"));

    await userEvent.click(screen.getByRole("button", { name: "sign in" }));
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent(""));
  });

  it("signs out", async () => {
    renderAuth();
    act(() => emit({ uid: "u1", displayName: "Ada", email: "a@b.c", photoURL: "" }));

    await userEvent.click(screen.getByRole("button", { name: "sign out" }));
    expect(signOut).toHaveBeenCalled();
  });
});

describe("useAuth", () => {
  it("refuses to be used outside the provider", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/inside <AuthProvider>/);
    quiet.mockRestore();
  });
});

describe("canSubmitRuns", () => {
  it("is true only once signed in", () => {
    expect(canSubmitRuns("signed-in")).toBe(true);
    expect(canSubmitRuns("signed-out")).toBe(false);
    // Loading must not read as permission, or the pre-run UI would promise
    // scoring it cannot deliver.
    expect(canSubmitRuns("loading")).toBe(false);
  });
});
