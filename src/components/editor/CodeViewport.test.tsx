import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CodeViewport from "./CodeViewport";
import { buildLayout, normalizeSnippet } from "@/engine/layout";
import type { HighlightToken } from "@/types/schema";

const CSS = normalizeSnippet(`.a {
  color: red;
}`);

const layout = buildLayout(CSS);

const tokens: HighlightToken[] = [{ start: 0, end: 2, light: "#0a7", dark: "#6ee" }];

function renderViewport(overrides: Partial<React.ComponentProps<typeof CodeViewport>> = {}) {
  const props = {
    code: CSS,
    tokens,
    skipMask: layout.skipMask,
    cursorIndex: layout.startIndex,
    hasError: false,
    errorNonce: 0,
    ...overrides,
  };
  const utils = render(<CodeViewport {...props} />);
  const chars = () =>
    Array.from(utils.container.querySelectorAll<HTMLElement>("[data-index]")).map(
      (node) => node.dataset.state,
    );
  return { ...utils, props, chars };
}

describe("CodeViewport", () => {
  it("renders one span per character", () => {
    const { container } = renderViewport();
    expect(container.querySelectorAll("[data-index]")).toHaveLength(CSS.length);
  });

  it("dims auto-skipped indentation", () => {
    const { chars } = renderViewport();
    const indentIndex = CSS.indexOf("\n") + 1;
    expect(chars()[indentIndex]).toBe("skipped");
  });

  it("applies precomputed token colours as custom properties", () => {
    const { container } = renderViewport();
    const first = container.querySelector<HTMLElement>('[data-index="0"]')!;
    expect(first.style.getPropertyValue("--tok-light")).toBe("#0a7");
    expect(first.style.getPropertyValue("--tok-dark")).toBe("#6ee");
  });

  it("marks typed characters without rebuilding the DOM", () => {
    const { rerender, props, container, chars } = renderViewport();
    const before = container.querySelector('[data-index="0"]');

    rerender(<CodeViewport {...props} cursorIndex={2} />);

    expect(chars()[0]).toBe("typed");
    expect(chars()[1]).toBe("typed");
    expect(chars()[2]).toBe("pending");
    // Same node instance: the snippet DOM was built once (§4.11).
    expect(container.querySelector('[data-index="0"]')).toBe(before);
  });

  it("puts the error state on the character under the cursor", () => {
    const { rerender, props, chars } = renderViewport();
    rerender(<CodeViewport {...props} hasError errorNonce={1} />);
    expect(chars()[layout.startIndex]).toBe("error");

    rerender(<CodeViewport {...props} hasError={false} errorNonce={1} />);
    expect(chars()[layout.startIndex]).toBe("pending");
  });

  it("keeps indentation skipped when Enter jumps over it", () => {
    const code = normalizeSnippet("a\n    b");
    const jump = buildLayout(code);
    const props = {
      code,
      tokens: [],
      skipMask: jump.skipMask,
      cursorIndex: 1,
      hasError: false,
      errorNonce: 0,
    };
    const { rerender, container } = render(<CodeViewport {...props} />);

    rerender(<CodeViewport {...props} cursorIndex={6} />);

    const states = Array.from(container.querySelectorAll<HTMLElement>("[data-index]")).map(
      (n) => n.dataset.state,
    );
    expect(states).toEqual(["pending", "typed", "skipped", "skipped", "skipped", "skipped", "pending"]);
  });

  it("flags the caret while locked", () => {
    const { rerender, props } = renderViewport();
    expect(screen.getByTestId("caret").dataset.error).toBe("false");

    rerender(<CodeViewport {...props} hasError errorNonce={1} />);
    expect(screen.getByTestId("caret").dataset.error).toBe("true");
  });

  it("applies the shake class on the first error", () => {
    const { rerender, props } = renderViewport();
    const viewport = screen.getByTestId("code-viewport");
    const before = viewport.classList.length;

    rerender(<CodeViewport {...props} hasError errorNonce={1} />);
    expect(viewport.classList.length).toBe(before + 1);
  });

  it("restarts the animation on a repeat error, not just leaves the class on", () => {
    const { rerender, props } = renderViewport();
    const viewport = screen.getByTestId("code-viewport");
    rerender(<CodeViewport {...props} hasError errorNonce={1} />);

    // The class stays present across a repeat, so className alone proves nothing.
    // What makes the animation replay is the remove/reflow/add cycle.
    const remove = vi.spyOn(viewport.classList, "remove");
    const add = vi.spyOn(viewport.classList, "add");

    rerender(<CodeViewport {...props} hasError errorNonce={2} />);

    expect(remove).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.invocationCallOrder[0]).toBeGreaterThan(remove.mock.invocationCallOrder[0]);
  });

  it("does not shake before the first error", () => {
    const { container } = renderViewport();
    const viewport = container.querySelector<HTMLElement>('[data-testid="code-viewport"]')!;
    expect(viewport.className.includes("shake")).toBe(false);
  });
});
