import { describe, expect, it } from "vitest";
import {
  splitTelegramEntities,
  telegramUtf16Length,
  type TelegramRichEntity,
} from "./entities";

describe("telegramUtf16Length", () => {
  it("counts astral emoji as two utf16 units", () => {
    expect(telegramUtf16Length("A😀B")).toBe(4);
  });
});

describe("splitTelegramEntities", () => {
  it("keeps text intact when already under limit", () => {
    const entities: TelegramRichEntity[] = [{ type: "bold", offset: 0, length: 5 }];

    expect(splitTelegramEntities("hello", entities, 10)).toEqual([
      {
        text: "hello",
        entities,
      },
    ]);
  });

  it("clips overlapping entities when splitting long text", () => {
    const entities: TelegramRichEntity[] = [{ type: "bold", offset: 0, length: 11 }];

    expect(splitTelegramEntities("hello\nworld", entities, 6)).toEqual([
      {
        text: "hello\n",
        entities: [{ type: "bold", offset: 0, length: 6 }],
      },
      {
        text: "world",
        entities: [{ type: "bold", offset: 0, length: 5 }],
      },
    ]);
  });

  it("does not split surrogate pairs when chunking by utf16 length", () => {
    const entities: TelegramRichEntity[] = [{ type: "bold", offset: 1, length: 2 }];

    expect(splitTelegramEntities("A😀B", entities, 2)).toEqual([
      {
        text: "A",
        entities: [],
      },
      {
        text: "😀",
        entities: [{ type: "bold", offset: 0, length: 2 }],
      },
      {
        text: "B",
        entities: [],
      },
    ]);
  });
});
