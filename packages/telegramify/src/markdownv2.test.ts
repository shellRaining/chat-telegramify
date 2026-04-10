import { describe, expect, it } from "vitest";
import { entitiesToMarkdownV2 } from "./markdownv2";

describe("entitiesToMarkdownV2", () => {
  it("escapes plain text and reinserts entity markers", () => {
    expect(
      entitiesToMarkdownV2("price is 1+1", [
        { type: "bold", offset: 9, length: 3 },
      ]),
    ).toBe("price is *1\\+1*");
  });

  it("uses utf16 offsets when slicing entity ranges", () => {
    expect(
      entitiesToMarkdownV2("A😀B", [
        { type: "bold", offset: 1, length: 2 },
      ]),
    ).toBe("A*😀*B");
  });

  it("serializes nested entities without duplicating text", () => {
    expect(
      entitiesToMarkdownV2("bold", [
        { type: "bold", offset: 0, length: 4 },
        { type: "italic", offset: 0, length: 4 },
      ]),
    ).toBe("*_bold_*");
  });

  it("throws when an entity range does not land on utf16 boundaries", () => {
    expect(() =>
      entitiesToMarkdownV2("A😀B", [
        { type: "bold", offset: 2, length: 1 },
      ]),
    ).toThrow(/utf16/i);
  });

  it("escapes code entities with code-safe rules", () => {
    expect(
      entitiesToMarkdownV2("a`b\\c", [
        { type: "code", offset: 0, length: 5 },
      ]),
    ).toBe("`a\\`b\\\\c`");
  });

  it("escapes text link urls with markdownv2 link rules", () => {
    expect(
      entitiesToMarkdownV2("link", [
        { type: "text_link", offset: 0, length: 4, url: "https://example.com/a)b\\c" },
      ]),
    ).toBe("[link](https://example.com/a\\)b\\\\c)");
  });
});
