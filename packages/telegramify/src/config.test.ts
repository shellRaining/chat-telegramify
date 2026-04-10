import { describe, expect, it } from "vitest";
import {
  DEFAULT_TELEGRAM_PIPELINE_OPTIONS,
  resolveTelegramPipelineOptions,
} from "./config";

describe("resolveTelegramPipelineOptions", () => {
  it("returns task defaults when no overrides are provided", () => {
    expect(resolveTelegramPipelineOptions()).toEqual(
      DEFAULT_TELEGRAM_PIPELINE_OPTIONS,
    );
  });

  it("overrides only the provided option values", () => {
    expect(
      resolveTelegramPipelineOptions({
        maxMessageLength: 128,
        renderMermaid: true,
      }),
    ).toEqual({
      maxMessageLength: 128,
      minFileLines: Number.POSITIVE_INFINITY,
      renderMermaid: true,
    });
  });
});
