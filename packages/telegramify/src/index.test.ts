import { describe, expect, it } from "vitest";
import {
  inferTelegramCodeFilename,
  renderMermaidDiagram,
  resolveTelegramPipelineOptions,
} from "./index";

describe("telegramify public exports", () => {
  it("re-exports the task 3 extension seams", async () => {
    expect(inferTelegramCodeFilename("js")).toBe("snippet.js");
    expect(resolveTelegramPipelineOptions().renderMermaid).toBe(false);
    await expect(renderMermaidDiagram("graph TD\nA-->B")).resolves.toBeNull();
  });
});
