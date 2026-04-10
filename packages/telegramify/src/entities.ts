import type { TelegramRichEntity, TelegramTextChunk } from "./types";

export type { TelegramRichEntity, TelegramTextChunk } from "./types";

const getUtf16Width = (char: string): number => {
  const codePoint = char.codePointAt(0);
  return codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
};

export const telegramUtf16Length = (text: string): number => {
  let total = 0;
  for (const char of text) {
    total += getUtf16Width(char);
  }
  return total;
};

const buildUtf16Offsets = (text: string): number[] => {
  const offsets = new Array<number>(text.length + 1).fill(0);
  let utf16Offset = 0;

  for (let index = 0; index < text.length; ) {
    offsets[index] = utf16Offset;

    const codePoint = text.codePointAt(index);
    const charLength = codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    const char = text.slice(index, index + charLength);

    utf16Offset += getUtf16Width(char);
    index += charLength;
  }

  offsets[text.length] = utf16Offset;
  return offsets;
};

const findSplitPoint = (
  text: string,
  offsets: number[],
  start: number,
  maxUtf16Length: number,
): number => {
  const budget = offsets[start] + maxUtf16Length;

  let split = start;
  for (let index = start; index < text.length; index += 1) {
    if (offsets[index + 1] > budget) {
      break;
    }
    split = index + 1;
    if (text[index] === "\n") {
      return split;
    }
  }

  return split === start ? start + 1 : split;
};

const buildCodePointBoundaries = (text: string): Set<number> => {
  const boundaries = new Set<number>([0]);

  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index);
    index += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    boundaries.add(index);
  }

  return boundaries;
};

export const splitTelegramEntities = (
  text: string,
  entities: TelegramRichEntity[],
  maxUtf16Length: number,
): TelegramTextChunk[] => {
  if (telegramUtf16Length(text) <= maxUtf16Length) {
    return [{ text, entities: [...entities] }];
  }

  const offsets = buildUtf16Offsets(text);
  const boundaries = buildCodePointBoundaries(text);
  const chunks: TelegramTextChunk[] = [];

  for (let start = 0; start < text.length; ) {
    let end = findSplitPoint(text, offsets, start, maxUtf16Length);
    while (end > start && !boundaries.has(end)) {
      end -= 1;
    }

    if (end === start) {
      end += 1;
      while (end < text.length && !boundaries.has(end)) {
        end += 1;
      }
    }

    const chunkStart = offsets[start];
    const chunkEnd = offsets[end];

    chunks.push({
      text: text.slice(start, end),
      entities: entities.flatMap((entity) => {
        const entityStart = entity.offset;
        const entityEnd = entity.offset + entity.length;

        if (entityEnd <= chunkStart || entityStart >= chunkEnd) {
          return [];
        }

        const startOffset = Math.max(entityStart, chunkStart);
        const endOffset = Math.min(entityEnd, chunkEnd);

        return [
          {
            ...entity,
            offset: startOffset - chunkStart,
            length: endOffset - startOffset,
          },
        ];
      }),
    });

    start = end;
  }

  return chunks;
};
