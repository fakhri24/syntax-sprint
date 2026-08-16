import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import IframeSandbox from "./IframeSandbox";

/**
 * jsdom does not run scripts inside an iframe srcdoc, so the EXEC/ACK protocol
 * itself is proven in Chromium (e2e/sandbox.spec.ts). What is worth locking down
 * here is the frame's configuration: dropping `allow-same-origin` is the whole
 * isolation guarantee, and a regression would be silent.
 */
describe("IframeSandbox", () => {
  const props = {
    initialStageHTML: '<div class="card"></div>',
    code: 'document.querySelector(".card").textContent = "hi";',
    cursorIndex: 0,
    checkpoints: [50],
  };

  it("sandboxes with allow-scripts only", () => {
    render(<IframeSandbox {...props} />);
    const frame = screen.getByTestId("iframe-sandbox");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  });

  it("never grants allow-same-origin, which would defeat the isolation", () => {
    render(<IframeSandbox {...props} />);
    const sandbox = screen.getByTestId("iframe-sandbox").getAttribute("sandbox") ?? "";
    expect(sandbox).not.toContain("allow-same-origin");
    expect(sandbox).not.toContain("allow-top-navigation");
    expect(sandbox).not.toContain("allow-popups");
  });

  it("ships the bootstrap in srcdoc rather than loading a remote document", () => {
    render(<IframeSandbox {...props} />);
    const frame = screen.getByTestId("iframe-sandbox");
    expect(frame.getAttribute("src")).toBeNull();
    expect(frame.getAttribute("srcdoc")).toContain("EXEC");
  });

  it("carries no snippet code in the initial document", () => {
    render(<IframeSandbox {...props} />);
    // Code arrives only by postMessage, so the frame's document is identical
    // for every level and can be cached by the browser.
    expect(screen.getByTestId("iframe-sandbox").getAttribute("srcdoc")).not.toContain(props.code);
  });

  it("has an accessible title", () => {
    render(<IframeSandbox {...props} />);
    expect(screen.getByTitle("JavaScript stage")).toBeInTheDocument();
  });
});
