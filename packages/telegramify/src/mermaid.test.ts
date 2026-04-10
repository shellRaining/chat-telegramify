import { describe, expect, it } from "vitest";
import { renderMermaidDiagram } from "./mermaid";

describe("renderMermaidDiagram", () => {
  it("returns null as the task 3 placeholder contract", async () => {
    await expect(renderMermaidDiagram("graph TD\nA-->B")).resolves.toBeNull();
  });
});
