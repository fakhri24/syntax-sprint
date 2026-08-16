import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import KeyboardGate, { OVERRIDE_KEY } from "./KeyboardGate";
import {
  MIN_ARENA_WIDTH,
  gateReason,
  readDeviceSignals,
  requiresDesktopGate,
} from "./deviceCapability";

const desktop = { hasFinePointer: true, viewportWidth: 1440 };
const phone = { hasFinePointer: false, viewportWidth: 390 };
const narrowLaptop = { hasFinePointer: true, viewportWidth: 900 };

describe("gateReason", () => {
  it("lets a desktop through", () => {
    expect(gateReason(desktop)).toBeNull();
    expect(requiresDesktopGate(desktop)).toBe(false);
  });

  it("gates a touch-only device", () => {
    expect(gateReason(phone)).toBe("no-fine-pointer");
  });

  it("gates a window too narrow for the split arena", () => {
    expect(gateReason(narrowLaptop)).toBe("viewport-too-narrow");
  });

  it("accepts exactly the minimum width", () => {
    expect(gateReason({ hasFinePointer: true, viewportWidth: MIN_ARENA_WIDTH })).toBeNull();
  });

  it("reports the pointer first, since it is the more fundamental problem", () => {
    expect(gateReason({ hasFinePointer: false, viewportWidth: 320 })).toBe("no-fine-pointer");
  });
});

describe("readDeviceSignals", () => {
  it("returns null when matchMedia is unavailable, rather than guessing", () => {
    const original = window.matchMedia;
    // @ts-expect-error deliberately removing the API
    delete window.matchMedia;
    expect(readDeviceSignals()).toBeNull();
    window.matchMedia = original;
  });

  it("reads the pointer capability and viewport width", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    expect(readDeviceSignals()).toEqual({ hasFinePointer: true, viewportWidth: window.innerWidth });
    vi.unstubAllGlobals();
  });
});

describe("KeyboardGate", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  const renderGate = (signals: ReturnType<typeof readDeviceSignals>) =>
    render(
      <KeyboardGate readSignals={() => signals}>
        <div data-testid="arena">arena</div>
      </KeyboardGate>,
    );

  it("renders the arena on a desktop", () => {
    renderGate(desktop);
    expect(screen.getByTestId("arena")).toBeInTheDocument();
    expect(screen.queryByTestId("desktop-required")).toBeNull();
  });

  it("shows an explanatory interstitial, not a broken arena", () => {
    renderGate(phone);
    const gate = screen.getByTestId("desktop-required");

    expect(gate.dataset.reason).toBe("no-fine-pointer");
    expect(gate).toHaveTextContent(/typing game/i);
    expect(screen.queryByTestId("arena")).toBeNull();
  });

  it("gives a gated visitor somewhere to go", () => {
    renderGate(phone);
    expect(screen.getByRole("link", { name: /leaderboard/i })).toHaveAttribute("href", "/leaderboard");
  });

  it("explains a narrow window differently from a missing keyboard", () => {
    renderGate(narrowLaptop);
    expect(screen.getByTestId("desktop-required")).toHaveTextContent(/too narrow/i);
  });

  it("lets a tablet with a keyboard case through the escape hatch", async () => {
    renderGate(phone);
    await userEvent.click(screen.getByTestId("enter-anyway"));

    expect(screen.getByTestId("arena")).toBeInTheDocument();
  });

  it("states that an override run still scores normally", () => {
    renderGate(phone);
    // Detection is a proxy, not a verdict — an overridden run is not second class.
    expect(screen.getByTestId("desktop-required")).toHaveTextContent(/scored like any other/i);
  });

  it("remembers the override for the session, so it is not re-offered per level", async () => {
    const first = renderGate(phone);
    await userEvent.click(screen.getByTestId("enter-anyway"));
    first.unmount();

    renderGate(phone);
    expect(screen.getByTestId("arena")).toBeInTheDocument();
  });

  it("survives sessionStorage being unavailable", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("private browsing");
    });

    renderGate(phone);
    // Losing the memory is acceptable; crashing the arena is not.
    await expect(userEvent.click(screen.getByTestId("enter-anyway"))).resolves.toBeUndefined();
    expect(screen.getByTestId("arena")).toBeInTheDocument();

    setItem.mockRestore();
  });

  it("renders nothing before the signals are known, avoiding a flash", () => {
    // Signals only exist in the browser, so a guess during render would flash
    // either the gate or the arena on every load.
    const { container } = render(
      <KeyboardGate readSignals={() => null}>
        <div data-testid="arena">arena</div>
      </KeyboardGate>,
    );
    expect(container.querySelector('[data-testid="desktop-required"]')).toBeNull();
  });

  it("treats unknown signals as ungated once resolved", () => {
    // A browser without matchMedia should not be locked out of the game.
    renderGate(null);
    expect(screen.getByTestId("arena")).toBeInTheDocument();
  });

  it("re-evaluates when the window is resized across the threshold", () => {
    let signals = narrowLaptop;
    render(
      <KeyboardGate readSignals={() => signals}>
        <div data-testid="arena">arena</div>
      </KeyboardGate>,
    );
    expect(screen.getByTestId("desktop-required")).toBeInTheDocument();

    signals = desktop;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    // Someone who widened their browser to comply must not stay stranded.
    expect(screen.getByTestId("arena")).toBeInTheDocument();
  });

  it("clears the override with the session, not permanently", () => {
    window.sessionStorage.setItem(OVERRIDE_KEY, "1");
    renderGate(phone);
    expect(screen.getByTestId("arena")).toBeInTheDocument();

    window.sessionStorage.clear();
    renderGate(phone);
    expect(screen.getAllByTestId("desktop-required").length).toBeGreaterThan(0);
  });
});
