import { describe, expect, it, vi } from "vitest";
import { SWITCH_PROFILES, createAudioEngine, soundForEffect } from "./audio";

/**
 * jsdom has no Web Audio API, so the engine takes an injectable context
 * factory. The fake records node creation, which is enough to assert the shape
 * of each sound and — more importantly — that nothing is scheduled when it
 * should not be.
 */
function fakeContext(state: AudioContextState = "running") {
  const created: string[] = [];
  const started: number[] = [];

  const gain = () => ({
    gain: {
      value: 0,
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn((node: unknown) => node),
  });

  const ctx = {
    state,
    currentTime: 0,
    sampleRate: 48_000,
    destination: {},
    resume: vi.fn(async () => {
      ctx.state = "running";
    }),
    close: vi.fn(async () => {}),
    createGain: vi.fn(() => {
      created.push("gain");
      return gain();
    }),
    createBuffer: vi.fn((channels: number, length: number) => {
      created.push("buffer");
      return { getChannelData: () => new Float32Array(length) };
    }),
    createBufferSource: vi.fn(() => {
      created.push("bufferSource");
      return {
        buffer: null,
        connect: vi.fn((node: unknown) => node),
        start: vi.fn((at: number) => started.push(at)),
        stop: vi.fn(),
      };
    }),
    createBiquadFilter: vi.fn(() => {
      created.push("filter");
      return {
        type: "",
        frequency: { value: 0 },
        Q: { value: 0 },
        connect: vi.fn((node: unknown) => node),
      };
    }),
    createOscillator: vi.fn(() => {
      created.push("oscillator");
      return {
        type: "",
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn((node: unknown) => node),
        start: vi.fn((at: number) => started.push(at)),
        stop: vi.fn(),
      };
    }),
  };

  return { ctx, created, started };
}

function engineWith(state: AudioContextState = "running") {
  const fake = fakeContext(state);
  const engine = createAudioEngine({ contextFactory: () => fake.ctx as unknown as AudioContext });
  return { engine, ...fake };
}

describe("createAudioEngine", () => {
  it("creates no context until resume is called", () => {
    const fake = fakeContext();
    const factory = vi.fn(() => fake.ctx as unknown as AudioContext);
    createAudioEngine({ contextFactory: factory });

    // Browsers reject audio started outside a gesture, so construction must be inert.
    expect(factory).not.toHaveBeenCalled();
  });

  it("builds the graph once on resume", async () => {
    const { engine, ctx } = engineWith();
    await engine.resume();
    await engine.resume();

    expect(ctx.createGain).toHaveBeenCalledTimes(1);
    expect(ctx.createBuffer).toHaveBeenCalledTimes(1);
  });

  it("resumes a suspended context", async () => {
    const { engine, ctx } = engineWith("suspended");
    await engine.resume();
    expect(ctx.resume).toHaveBeenCalled();
    expect(engine.ready).toBe(true);
  });

  it("falls back to silence when Web Audio is unavailable", () => {
    const original = globalThis.AudioContext;
    // @ts-expect-error deliberately removing the API
    delete globalThis.AudioContext;

    const engine = createAudioEngine();
    expect(engine.ready).toBe(false);
    expect(() => engine.play("keypress")).not.toThrow();

    globalThis.AudioContext = original;
  });

  it("survives a context factory that throws", async () => {
    const engine = createAudioEngine({
      contextFactory: () => {
        throw new Error("blocked by policy");
      },
    });

    await expect(engine.resume()).resolves.toBeUndefined();
    expect(() => engine.play("keypress")).not.toThrow();
    expect(engine.ready).toBe(false);
  });
});

describe("play", () => {
  it("schedules nothing before resume", () => {
    const { engine, started } = engineWith();
    engine.play("keypress");
    expect(started).toHaveLength(0);
  });

  it("schedules nothing while the context is suspended", () => {
    const { engine, started } = engineWith("suspended");
    engine.play("keypress");
    expect(started).toHaveLength(0);
  });

  it("renders a keypress from a noise burst and a tone", async () => {
    const { engine, created } = engineWith();
    await engine.resume();
    created.length = 0;

    engine.play("keypress");

    expect(created).toContain("bufferSource");
    expect(created).toContain("filter");
    expect(created).toContain("oscillator");
  });

  it("varies the click pitch so a fast run does not sound mechanical", async () => {
    const { engine, ctx } = engineWith();
    await engine.resume();

    // Capture the node itself, so its frequency can be read after assignment.
    const filters: Array<{ frequency: { value: number } }> = [];
    ctx.createBiquadFilter.mockImplementation(() => {
      const filter = { type: "", frequency: { value: 0 }, Q: { value: 0 }, connect: vi.fn((n: unknown) => n) };
      filters.push(filter);
      return filter;
    });

    for (let i = 0; i < 12; i += 1) engine.play("keypress");

    expect(new Set(filters.map((f) => f.frequency.value)).size).toBeGreaterThan(1);
  });

  it("uses a distinctly lower voice for errors", async () => {
    const { engine, ctx } = engineWith();
    await engine.resume();

    const pitches: number[] = [];
    ctx.createOscillator.mockImplementation(() => ({
      type: "",
      frequency: { setValueAtTime: vi.fn((hz: number) => pitches.push(hz)) },
      connect: vi.fn((n: unknown) => n),
      start: vi.fn(),
      stop: vi.fn(),
    }));

    engine.play("error");
    expect(Math.min(...pitches)).toBeLessThan(120);
  });

  it("plays a three-note arpeggio on completion", async () => {
    const { engine, ctx, started } = engineWith();
    await engine.resume();
    ctx.createOscillator.mockClear();
    started.length = 0;

    engine.play("complete");

    expect(ctx.createOscillator).toHaveBeenCalledTimes(3);
    // Staggered in time rather than stacked into a chord.
    expect(started).toEqual([...started].sort((a, b) => a - b));
    expect(new Set(started).size).toBe(3);
  });

  it("goes quiet when disabled and comes back when re-enabled", async () => {
    const { engine, started } = engineWith();
    await engine.resume();

    engine.setEnabled(false);
    engine.play("keypress");
    expect(started).toHaveLength(0);

    engine.setEnabled(true);
    engine.play("keypress");
    expect(started.length).toBeGreaterThan(0);
  });

  it("never throws when the graph fails mid-keystroke", async () => {
    const { engine, ctx } = engineWith();
    await engine.resume();
    ctx.createOscillator.mockImplementation(() => {
      throw new Error("node budget exceeded");
    });

    // Audio is decoration; it must not cost the player a keystroke.
    expect(() => engine.play("keypress")).not.toThrow();
  });
});

describe("dispose", () => {
  it("closes the context and stops scheduling", async () => {
    const { engine, ctx, started } = engineWith();
    await engine.resume();
    engine.dispose();

    expect(ctx.close).toHaveBeenCalled();
    started.length = 0;
    engine.play("keypress");
    expect(started).toHaveLength(0);
  });
});

describe("switch profiles", () => {
  it("gets brighter and noisier from linear to clicky", () => {
    const { linear, tactile, clicky } = SWITCH_PROFILES;
    expect(linear.clickHz).toBeLessThan(tactile.clickHz);
    expect(tactile.clickHz).toBeLessThan(clicky.clickHz);
    expect(linear.noise).toBeLessThan(clicky.noise);
    expect(linear.resonance).toBeLessThan(clicky.resonance);
  });

  it("honours the profile it is given", async () => {
    const fake = fakeContext();
    const engine = createAudioEngine({
      contextFactory: () => fake.ctx as unknown as AudioContext,
      profile: SWITCH_PROFILES.clicky,
    });
    await engine.resume();

    const filters: Array<{ frequency: { value: number } }> = [];
    fake.ctx.createBiquadFilter.mockImplementation(() => {
      const filter = { type: "", frequency: { value: 0 }, Q: { value: 0 }, connect: vi.fn((n: unknown) => n) };
      filters.push(filter);
      return filter;
    });

    engine.play("keypress");

    // Within the detune range of the clicky profile's 2600 Hz centre.
    expect(filters[0].frequency.value).toBeGreaterThan(2_000);
  });
});

describe("soundForEffect", () => {
  it("maps reducer effects onto sounds", () => {
    expect(soundForEffect("accepted")).toBe("keypress");
    expect(soundForEffect("completed")).toBe("complete");
    expect(soundForEffect("error")).toBe("error");
    // A blocked keypress re-triggers the thud, matching the shake (§4.3).
    expect(soundForEffect("blocked")).toBe("error");
  });

  it("stays silent for effects that are not feedback", () => {
    expect(soundForEffect("noop")).toBeNull();
    expect(soundForEffect("unlocked")).toBeNull();
  });
});
