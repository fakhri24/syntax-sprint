import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { useLiveMetrics } from "./useLiveMetrics";
import type { MetricsInput } from "@/engine/metrics";
import type { Metrics } from "@/types/game";

/** Manual rAF pump: jsdom's is timer-backed and awkward to step precisely. */
function installFrameClock() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  let time = 0;
  let cancels = 0;

  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextId++;
    callbacks.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    cancels += 1;
    callbacks.delete(id);
  });

  return {
    /** Runs exactly one frame's worth of pending callbacks. */
    advance(frames = 1) {
      for (let i = 0; i < frames; i += 1) {
        const pending = [...callbacks.entries()];
        callbacks.clear();
        time += 16;
        act(() => {
          for (const [, cb] of pending) cb(time);
        });
      }
    },
    get pending() {
      return callbacks.size;
    },
    /** Non-zero means the effect tore down and re-armed the loop. */
    get cancels() {
      return cancels;
    },
  };
}

describe("useLiveMetrics", () => {
  let clock: ReturnType<typeof installFrameClock>;

  beforeEach(() => {
    clock = installFrameClock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const input = (overrides: Partial<MetricsInput> = {}): MetricsInput => ({
    correctKeystrokes: 100,
    totalErrors: 0,
    elapsedMs: 60_000,
    ...overrides,
  });

  it("emits a frame per animation frame while active", () => {
    const frames: Metrics[] = [];
    renderHook(() => useLiveMetrics(true, () => input(), (m) => frames.push(m)));

    const before = frames.length;
    clock.advance(3);
    expect(frames.length).toBe(before + 3);
  });

  it("computes real metrics, not raw input", () => {
    const frames: Metrics[] = [];
    renderHook(() => useLiveMetrics(true, () => input({ totalErrors: 4 }), (m) => frames.push(m)));
    clock.advance(1);

    const latest = frames.at(-1)!;
    expect(latest.grossWpm).toBe(20);
    expect(latest.netWpm).toBe(16);
    expect(latest.accuracy).toBeCloseTo(100 / 104, 6);
  });

  it("reads fresh values each frame without restarting the loop", () => {
    let keystrokes = 0;
    const frames: Metrics[] = [];
    const { rerender } = renderHook(() =>
      useLiveMetrics(true, () => input({ correctKeystrokes: (keystrokes += 50) }), (m) => frames.push(m)),
    );

    clock.advance(1);
    rerender(); // new inline closures — must not cancel and re-arm the loop
    clock.advance(2);

    // No frame is emitted at mount, so the first value appears on the first tick.
    expect(frames.map((f) => f.grossWpm)).toEqual([10, 20, 30]);
    expect(clock.cancels).toBe(0);
  });

  it("stops scheduling frames once inactive", () => {
    const frames: Metrics[] = [];
    const { rerender } = renderHook(
      ({ active }) => useLiveMetrics(active, () => input(), (m) => frames.push(m)),
      { initialProps: { active: true } },
    );

    clock.advance(2);
    const atStop = frames.length;

    rerender({ active: false });
    clock.advance(5);

    // Exactly one settle frame after stopping, then nothing.
    expect(frames.length).toBe(atStop + 1);
    expect(clock.pending).toBe(0);
  });

  it("emits a final settle frame with the true finishing numbers", () => {
    const frames: Metrics[] = [];
    let elapsed = 30_000;
    const { rerender } = renderHook(
      ({ active }) => useLiveMetrics(active, () => input({ elapsedMs: elapsed }), (m) => frames.push(m)),
      { initialProps: { active: true } },
    );

    clock.advance(1);
    elapsed = 60_000; // the run ends; final elapsed differs from the last frame
    rerender({ active: false });

    expect(frames.at(-1)!.elapsedMs).toBe(60_000);
    expect(frames.at(-1)!.grossWpm).toBe(20);
  });

  it("cancels its frame on unmount", () => {
    const { unmount } = renderHook(() => useLiveMetrics(true, () => input(), () => {}));
    expect(clock.pending).toBe(1);
    unmount();
    expect(clock.pending).toBe(0);
  });
});
