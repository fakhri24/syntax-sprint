import { describe, expect, it } from "vitest";
import { elapsedMs, finishClock, idleClock, isActive, startClock } from "./fsm";

describe("run clock", () => {
  it("moves IDLE -> RUNNING -> FINISHED", () => {
    const idle = idleClock();
    expect(idle.phase).toBe("IDLE");

    const running = startClock(idle, 100);
    expect(running.phase).toBe("RUNNING");
    expect(running.startedAt).toBe(100);

    const finished = finishClock(running, 400);
    expect(finished.phase).toBe("FINISHED");
    expect(finished.finishedAt).toBe(400);
  });

  it("refuses illegal transitions", () => {
    const running = startClock(idleClock(), 0);
    expect(() => startClock(running, 1)).toThrow(/cannot start/);

    const finished = finishClock(running, 1);
    expect(() => finishClock(finished, 2)).toThrow(/cannot finish/);
    expect(() => startClock(finished, 2)).toThrow(/cannot start/);
    expect(() => finishClock(idleClock(), 1)).toThrow(/cannot finish/);
  });

  it("is active only while running", () => {
    expect(isActive(idleClock())).toBe(false);
    const running = startClock(idleClock(), 0);
    expect(isActive(running)).toBe(true);
    expect(isActive(finishClock(running, 1))).toBe(false);
  });

  it("reports zero elapsed before the first keystroke", () => {
    expect(elapsedMs(idleClock(), 9_999)).toBe(0);
  });

  it("tracks elapsed time while running", () => {
    const running = startClock(idleClock(), 1_000);
    expect(elapsedMs(running, 1_750)).toBe(750);
  });

  it("freezes elapsed time once finished, so a slow modal cannot inflate it", () => {
    const finished = finishClock(startClock(idleClock(), 1_000), 3_000);
    expect(elapsedMs(finished, 60_000)).toBe(2_000);
  });

  it("does not mutate the clock it is given", () => {
    const idle = idleClock();
    startClock(idle, 5);
    expect(idle).toEqual({ phase: "IDLE", startedAt: null, finishedAt: null });
  });
});
