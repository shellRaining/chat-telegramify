import { describe, expect, it, vi } from "vitest";
import { parseMarkdown } from "chat";
import { processTelegramContent } from "./pipeline";

const { renderMermaidDiagramSpy } = vi.hoisted(() => ({
  renderMermaidDiagramSpy: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

vi.mock("./mermaid", () => ({
  renderMermaidDiagram: renderMermaidDiagramSpy,
}));

describe("processTelegramContent", () => {
  it("splits long text into multiple text parts with entities", async () => {
    const ast = parseMarkdown("**hello**\nworld");
    const result = await processTelegramContent(ast, {
      maxMessageLength: 6,
      minFileLines: 99,
      renderMermaid: false,
    });

    expect(result).toEqual([
      {
        kind: "text",
        text: "hello\n",
        entities: [{ type: "bold", offset: 0, length: 5 }],
      },
      {
        kind: "text",
        text: "world",
        entities: [],
      },
    ]);
  });

  it("extracts long code blocks as file parts", async () => {
    const ast = parseMarkdown("```ts\nconst a = 1;\nconst b = 2;\n```");
    const result = await processTelegramContent(ast, {
      minFileLines: 1,
      renderMermaid: false,
    });

    expect(result[0]).toMatchObject({ kind: "file", filename: "snippet.ts" });
  });

  it("keeps a mermaid extension seam disabled by default", async () => {
    const ast = parseMarkdown("```mermaid\ngraph TD\nA-->B\n```");
    const result = await processTelegramContent(ast, {
      minFileLines: 99,
      renderMermaid: false,
    });

    expect(result).toEqual([
      {
        kind: "text",
        text: "graph TD\nA-->B",
        entities: [{ type: "pre", offset: 0, length: 14, language: "mermaid" }],
      },
    ]);
  });

  it("does not emit photo parts when renderMermaid is enabled before task 4", async () => {
    renderMermaidDiagramSpy.mockClear();

    const ast = parseMarkdown("```mermaid\ngraph TD\nA-->B\n```");
    const result = await processTelegramContent(ast, {
      minFileLines: 99,
      renderMermaid: true,
    });

    expect(result).toEqual([
      {
        kind: "text",
        text: "graph TD\nA-->B",
        entities: [{ type: "pre", offset: 0, length: 14, language: "mermaid" }],
      },
    ]);
    expect(renderMermaidDiagramSpy).not.toHaveBeenCalled();
  });
});
