import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ShadowDOMStage from "./ShadowDOMStage";

const CSS_CODE = ".rocket { transform: translateY(-40px); opacity: 1; }";
const SVG_CODE = '<path d="M12 2L2 22h20Z" fill="currentColor" />';

function host() {
  return screen.getByTestId("shadow-stage");
}

function renderStage(overrides: Partial<React.ComponentProps<typeof ShadowDOMStage>> = {}) {
  const props = {
    initialStageHTML: '<div class="rocket">🚀</div>',
    language: "css" as const,
    code: CSS_CODE,
    cursorIndex: 0,
    ...overrides,
  };
  const utils = render(<ShadowDOMStage {...props} />);
  return { ...utils, props };
}

describe("ShadowDOMStage", () => {
  it("attaches a shadow root and renders the curated stage markup", () => {
    renderStage();
    const shadow = host().shadowRoot!;
    expect(shadow).not.toBeNull();
    expect(shadow.querySelector(".rocket")?.textContent).toBe("🚀");
  });

  it("keeps stage content out of the host document", () => {
    renderStage();
    // The stage markup is reachable through the shadow root and nowhere else.
    expect(document.querySelector(".rocket")).toBeNull();
    expect(host().shadowRoot!.querySelector(".rocket")).not.toBeNull();
  });

  describe("css levels", () => {
    it("injects nothing before the first keystroke", () => {
      renderStage();
      expect(host().shadowRoot!.querySelector("style")!.textContent).toBe("");
    });

    it("injects exactly the prefix up to the cursor", () => {
      const { rerender, props } = renderStage();
      rerender(<ShadowDOMStage {...props} cursorIndex={9} />);
      expect(host().shadowRoot!.querySelector("style")!.textContent).toBe(".rocket {");
    });

    it("tolerates a half-typed declaration without throwing", () => {
      const { rerender, props } = renderStage();
      const partial = CSS_CODE.indexOf("translateY") + 5;

      expect(() => rerender(<ShadowDOMStage {...props} cursorIndex={partial} />)).not.toThrow();
      expect(host().shadowRoot!.querySelector("style")!.textContent).toBe(CSS_CODE.slice(0, partial));
    });

    it("grows the stylesheet keystroke by keystroke", () => {
      const { rerender, props } = renderStage();
      for (const cursor of [1, 2, 3, 20, CSS_CODE.length]) {
        rerender(<ShadowDOMStage {...props} cursorIndex={cursor} />);
        expect(host().shadowRoot!.querySelector("style")!.textContent).toBe(CSS_CODE.slice(0, cursor));
      }
    });

    it("writes into a nominated sink when the snippet provides one", () => {
      const { rerender, props } = renderStage({
        initialStageHTML: '<style data-sink></style><div class="rocket"></div>',
      });
      rerender(<ShadowDOMStage {...props} cursorIndex={9} />);

      const styles = host().shadowRoot!.querySelectorAll("style");
      expect(styles).toHaveLength(1); // no extra sink was created
      expect(styles[0].textContent).toBe(".rocket {");
    });
  });

  describe("svg levels", () => {
    const svgProps = {
      initialStageHTML: '<svg viewBox="0 0 24 24"></svg>',
      language: "svg" as const,
      code: SVG_CODE,
      cursorIndex: 0,
    };

    it("draws into the stage's svg root", () => {
      const { rerender } = render(<ShadowDOMStage {...svgProps} />);
      rerender(<ShadowDOMStage {...svgProps} cursorIndex={SVG_CODE.length} />);

      const svg = host().shadowRoot!.querySelector("svg")!;
      expect(svg.querySelector("path")).not.toBeNull();
      expect(svg.querySelector("path")!.getAttribute("fill")).toBe("currentColor");
    });

    it("does not throw on a half-typed tag", () => {
      const { rerender } = render(<ShadowDOMStage {...svgProps} />);
      for (let cursor = 1; cursor <= SVG_CODE.length; cursor += 1) {
        expect(() => rerender(<ShadowDOMStage {...svgProps} cursorIndex={cursor} />)).not.toThrow();
      }
    });

    it("creates an svg root when the stage markup has none", () => {
      render(<ShadowDOMStage {...svgProps} initialStageHTML="<div></div>" />);
      expect(host().shadowRoot!.querySelector("svg")).not.toBeNull();
    });
  });

  it("rebuilds cleanly when the snippet changes", () => {
    const { rerender } = renderStage();
    rerender(
      <ShadowDOMStage
        initialStageHTML="<p>second</p>"
        language="css"
        code="p { color: red; }"
        cursorIndex={17}
      />,
    );

    const shadow = host().shadowRoot!;
    expect(shadow.querySelector(".rocket")).toBeNull();
    expect(shadow.querySelector("p")?.textContent).toBe("second");
    expect(shadow.querySelector("style")!.textContent).toBe("p { color: red; }");
  });
});
