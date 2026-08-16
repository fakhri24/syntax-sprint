import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRunSubmission } from "./useRunSubmission";

const telemetry = { intervals: [0, 100, 120], errorOffsets: [4] };

const okResult = {
  runId: "r1",
  verified: true,
  flags: [],
  grossWpm: 60,
  netWpm: 58,
  accuracy: 0.98,
  elapsedMs: 220,
  personalBest: { snippet: true, global: false },
};

let fetchMock: ReturnType<typeof vi.fn>;

const jsonResponse = (body: unknown, ok = true) => ({ ok, json: async () => body });

function render(getIdToken: () => Promise<string | null>) {
  return renderHook(() => useRunSubmission({ snippetId: "rocket-launch", getIdToken }));
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reserving a token", () => {
  it("requests one before the run starts", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runToken: "tok" }));
    const { result } = render(async () => "id-token");

    await waitFor(() => expect(result.current.reserved).toBe(true));

    // Reserved on mount, not at completion — by completion it is too late (§4.6).
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/start", expect.anything());
    expect(result.current.willScore).toBe(true);
  });

  it("sends the ID token as a bearer credential", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runToken: "tok" }));
    const { result } = render(async () => "id-token");
    await waitFor(() => expect(result.current.reserved).toBe(true));

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.authorization).toBe("Bearer id-token");
  });

  it("skips the request entirely when signed out", async () => {
    const { result } = render(async () => null);
    await waitFor(() => expect(result.current.reserved).toBe(true));

    // Practice mode is a normal state, not an error.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.willScore).toBe(false);
  });

  it("degrades to practice mode when reservation fails", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const { result } = render(async () => "id-token");

    await waitFor(() => expect(result.current.reserved).toBe(true));
    // The player can still type; they just cannot score.
    expect(result.current.willScore).toBe(false);
  });

  it("degrades to practice mode when the server refuses", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "unknown snippet" }, false));
    const { result } = render(async () => "id-token");

    await waitFor(() => expect(result.current.reserved).toBe(true));
    expect(result.current.willScore).toBe(false);
  });
});

describe("submitting", () => {
  async function reserved() {
    fetchMock.mockResolvedValueOnce(jsonResponse({ runToken: "tok" }));
    const rendered = render(async () => "id-token");
    await waitFor(() => expect(rendered.result.current.reserved).toBe(true));
    return rendered;
  }

  it("posts telemetry and reports the server's numbers", async () => {
    const { result } = await reserved();
    fetchMock.mockResolvedValueOnce(jsonResponse(okResult));

    await act(async () => {
      await result.current.submit(telemetry);
    });

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/runs/submit");

    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ runToken: "tok", snippetId: "rocket-launch", intervals: telemetry.intervals });
    // The client never sends its own scores (§4.6).
    expect(body).not.toHaveProperty("netWpm");
    expect(result.current.state).toEqual({ status: "submitted", result: okResult });
  });

  it("reports not-scored for a practice run without asking the server", async () => {
    const { result } = render(async () => null);
    await waitFor(() => expect(result.current.reserved).toBe(true));

    await act(async () => {
      await result.current.submit(telemetry);
    });

    expect(result.current.state).toEqual({ status: "not-scored" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the server's rejection reason", async () => {
    const { result } = await reserved();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "260 WPM exceeds the plausible maximum" }, false));

    await act(async () => {
      await result.current.submit(telemetry);
    });

    expect(result.current.state).toEqual({
      status: "failed",
      error: "260 WPM exceeds the plausible maximum",
    });
  });

  it("reports a network failure without losing the run summary", async () => {
    const { result } = await reserved();
    fetchMock.mockRejectedValueOnce(new Error("offline"));

    await act(async () => {
      await result.current.submit(telemetry);
    });

    expect(result.current.state).toMatchObject({ status: "failed" });
  });

  it("does not offer a second submission with a spent token", async () => {
    const { result } = await reserved();
    fetchMock.mockResolvedValueOnce(jsonResponse(okResult));
    await act(async () => {
      await result.current.submit(telemetry);
    });

    await act(async () => {
      await result.current.submit(telemetry);
    });

    // The server would reject a replay anyway; not retrying keeps a retry button
    // from looking like it might work.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.state).toEqual({ status: "not-scored" });
  });
});
