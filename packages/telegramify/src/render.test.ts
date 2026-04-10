import { describe, expect, it } from "vitest";
import type { Root } from "chat";
import { parseMarkdown } from "chat";
import { renderTelegramRichText } from "./render";

describe("renderTelegramRichText", () => {
  it("renders bold, italic, code and links into entities", () => {
    const ast = parseMarkdown("**bold** *italic* `code` [link](https://example.com)");
    const result = renderTelegramRichText(ast);

    expect(result.text).toBe("bold italic code link");
    expect(result.entities).toEqual([
      { type: "bold", offset: 0, length: 4 },
      { type: "italic", offset: 5, length: 6 },
      { type: "code", offset: 12, length: 4 },
      { type: "text_link", offset: 17, length: 4, url: "https://example.com" },
    ]);
  });

  it("renders delete nodes as strikethrough entities", () => {
    const ast = parseMarkdown("~~gone~~ kept");
    const result = renderTelegramRichText(ast);

    expect(result.text).toBe("gone kept");
    expect(result.entities).toEqual([
      { type: "strikethrough", offset: 0, length: 4 },
    ]);
  });

  it("keeps minimal block structure for headings lists blockquotes and paragraphs", () => {
    const ast = parseMarkdown("# Title\n\n- first\n- second\n\n> quote\n\nTail");
    const result = renderTelegramRichText(ast);

    expect(result.text).toBe("Title\n\n- first\n- second\n\n> quote\n\nTail");
  });

  it("preserves ordered list numbering instead of downgrading to bullets", () => {
    const ast = parseMarkdown("1. first\n2. second");
    const result = renderTelegramRichText(ast);

    expect(result.text).toBe("1. first\n2. second");
  });

  it("keeps entity offsets aligned with text when block content already contains extra newlines", () => {
    const ast: Root = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "before\n\n\n" }],
        },
        {
          type: "paragraph",
          children: [{ type: "strong", children: [{ type: "text", value: "bold" }] }],
        },
      ],
    };

    const result = renderTelegramRichText(ast);

    expect(result.text).toBe("before\n\n\nbold");
    expect(result.entities).toEqual([{ type: "bold", offset: 9, length: 4 }]);
  });

  it("preserves trailing newlines when they are covered by an entity", () => {
    const ast: Root = {
      type: "root",
      children: [
        {
          type: "strong",
          children: [{ type: "text", value: "tail\n" }],
        },
      ],
    };

    const result = renderTelegramRichText(ast);

    expect(result.text).toBe("tail\n");
    expect(result.entities).toEqual([{ type: "bold", offset: 0, length: 5 }]);
  });
});
