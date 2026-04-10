import { describe, expectTypeOf, it } from "vitest";
import type { Root } from "chat";
import {
  type TelegramPipelineOptions,
  type TelegramSendPart,
  processTelegramContent,
} from "./pipeline";

describe("telegramify public types", () => {
  it("exposes an explicit options boundary for processTelegramContent", () => {
    expectTypeOf(processTelegramContent).parameters.toEqualTypeOf<[
      Root,
      TelegramPipelineOptions?,
    ]>();
  });

  it("defines a photo part contract with an explicit format", () => {
    expectTypeOf<TelegramSendPart>().extract<{ kind: "photo" }>().toEqualTypeOf<{
      kind: "photo";
      data: Uint8Array;
      format: "png" | "jpeg";
      caption?: string;
      captionEntities?: import("./types").TelegramRichEntity[];
    }>();
  });
});
