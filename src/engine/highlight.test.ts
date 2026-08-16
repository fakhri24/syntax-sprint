import { describe, expect, it } from "vitest";
import { flattenTokens, shikiLang, type ShikiTokenLike } from "./highlight";

const style = (color: string, dark: string) => ({ color, "--shiki-dark": dark });

describe("flattenTokens", () => {
  const code = ".a { color: red; }";
  const lines: ShikiTokenLike[][] = [
    [
      { content: ".a", offset: 0, htmlStyle: style("#6F42C1", "#B392F0") },
      { content: " { ", offset: 2, htmlStyle: style("#24292E", "#E1E4E8") },
      { content: "color", offset: 5, htmlStyle: style("#005CC5", "#79B8FF") },
    ],
  ];

  it("converts offsets and content lengths into ranges", () => {
    expect(flattenTokens(lines, code)).toEqual([
      { start: 0, end: 2, light: "#6F42C1", dark: "#B392F0" },
      { start: 2, end: 5, light: "#24292E", dark: "#E1E4E8" },
      { start: 5, end: 10, light: "#005CC5", dark: "#79B8FF" },
    ]);
  });

  it("throws when a token does not match the source at its offset", () => {
    const wrong: ShikiTokenLike[][] = [[{ content: ".a", offset: 4, htmlStyle: style("#000", "#fff") }]];
    expect(() => flattenTokens(wrong, code)).toThrow(/does not match the source/);
  });

  it("keeps absolute offsets across lines", () => {
    const multiline = "a\nbb";
    const tokens = flattenTokens(
      [
        [{ content: "a", offset: 0, htmlStyle: style("#111", "#eee") }],
        [{ content: "bb", offset: 2, htmlStyle: style("#222", "#ddd") }],
      ],
      multiline,
    );
    expect(tokens.map((t) => [t.start, t.end])).toEqual([
      [0, 1],
      [2, 4],
    ]);
  });

  it("drops empty tokens", () => {
    expect(flattenTokens([[{ content: "", offset: 0 }]], code)).toEqual([]);
  });

  it("falls back to readable defaults when a token carries no style", () => {
    const [token] = flattenTokens([[{ content: ".a", offset: 0 }]], code);
    expect(token.light).toBeTruthy();
    expect(token.dark).toBeTruthy();
    expect(token.light).not.toBe(token.dark);
  });

  it("reuses the light colour for dark when only one is provided", () => {
    const [token] = flattenTokens([[{ content: ".a", offset: 0, htmlStyle: { color: "#abc" } }]], code);
    expect(token).toMatchObject({ light: "#abc", dark: "#abc" });
  });

  it("returns tokens sorted by position", () => {
    const shuffled: ShikiTokenLike[][] = [
      [{ content: "color", offset: 5, htmlStyle: style("#005CC5", "#79B8FF") }],
      [{ content: ".a", offset: 0, htmlStyle: style("#6F42C1", "#B392F0") }],
    ];
    expect(flattenTokens(shuffled, code).map((t) => t.start)).toEqual([0, 5]);
  });
});

describe("shikiLang", () => {
  it("maps svg onto the xml grammar", () => {
    expect(shikiLang("svg")).toBe("xml");
  });

  it("passes css and javascript through", () => {
    expect(shikiLang("css")).toBe("css");
    expect(shikiLang("javascript")).toBe("javascript");
  });
});
