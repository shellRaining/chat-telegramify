import { describe, expect, it } from "vitest";
import { inferTelegramCodeFilename } from "./code-file";

describe("inferTelegramCodeFilename", () => {
  it("uses a text filename when language is absent", () => {
    expect(inferTelegramCodeFilename()).toBe("snippet.txt");
  });

  it("uses the language as the filename extension", () => {
    expect(inferTelegramCodeFilename("ts")).toBe("snippet.ts");
  });

  it("sanitizes unsafe language strings before using them in filenames", () => {
    expect(inferTelegramCodeFilename("../Type Script$"))
      .toBe("snippet.type-script");
  });

  it("falls back to txt when sanitization removes the whole language string", () => {
    expect(inferTelegramCodeFilename("../$$$///"))
      .toBe("snippet.txt");
  });
});
