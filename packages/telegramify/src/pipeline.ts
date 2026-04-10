import type { Root } from "chat";
import { splitTelegramEntities } from "./entities";
import type { TelegramPipelineOptions } from "./config";
import { resolveTelegramPipelineOptions } from "./config";
import { inferTelegramCodeFilename } from "./code-file";
import { renderTelegramRichText } from "./render";
import type { TelegramRichEntity } from "./types";

export type { TelegramPipelineOptions } from "./config";

export type TelegramPhotoFormat = "png" | "jpeg";

export interface TelegramTextPart {
  kind: "text";
  text: string;
  entities: TelegramRichEntity[];
}

export interface TelegramFilePart {
  kind: "file";
  filename: string;
  data: Uint8Array;
  language?: string;
}

export interface TelegramPhotoPart {
  kind: "photo";
  data: Uint8Array;
  format: TelegramPhotoFormat;
  caption?: string;
  captionEntities?: TelegramRichEntity[];
}

export type TelegramSendPart =
  | TelegramTextPart
  | TelegramFilePart
  | TelegramPhotoPart;

const countCodeLines = (code: string): number => code.split("\n").length;

const removeRangeEntities = (
  entities: TelegramRichEntity[],
  start: number,
  end: number,
): TelegramRichEntity[] =>
  entities.flatMap((entity) => {
    const entityStart = entity.offset;
    const entityEnd = entity.offset + entity.length;

    if (entityEnd <= start || entityStart >= end) {
      return [entity];
    }

    const next: TelegramRichEntity[] = [];

    if (entityStart < start) {
      next.push({
        ...entity,
        length: start - entityStart,
      });
    }

    if (entityEnd > end) {
      next.push({
        ...entity,
        offset: start,
        length: entityEnd - end,
      });
    }

    return next;
  });

const shiftEntitiesAfterRemoval = (
  entities: TelegramRichEntity[],
  start: number,
  removedLength: number,
): TelegramRichEntity[] =>
  entities.map((entity) => {
    if (entity.offset < start) {
      return entity;
    }

    return {
      ...entity,
      offset: entity.offset - removedLength,
    };
  });

export const processTelegramContent = async (
  ast: Root,
  options: TelegramPipelineOptions = {},
): Promise<TelegramSendPart[]> => {
  const resolvedOptions = resolveTelegramPipelineOptions(options);
  const rendered = renderTelegramRichText(ast);
  const encoder = new TextEncoder();

  const fileParts: TelegramSendPart[] = [];
  let text = rendered.text;
  let entities = [...rendered.entities];

  for (const segment of [...rendered.segments].reverse()) {
    if (segment.kind === "mermaid") {
      continue;
    }

    if (
      segment.kind === "code_block" &&
      countCodeLines(segment.rawCode ?? "") >= resolvedOptions.minFileLines
    ) {
      fileParts.unshift({
        kind: "file",
        filename: inferTelegramCodeFilename(segment.language),
        data: encoder.encode(segment.rawCode ?? ""),
        language: segment.language,
      });

      const removedLength = segment.textEnd - segment.textStart;
      text = `${text.slice(0, segment.textStart)}${text.slice(segment.textEnd)}`;
      entities = shiftEntitiesAfterRemoval(
        removeRangeEntities(entities, segment.utf16Start, segment.utf16End),
        segment.utf16Start,
        removedLength,
      );
    }
  }

  const textParts = splitTelegramEntities(
    text,
    entities,
    resolvedOptions.maxMessageLength,
  )
    .filter((chunk) => chunk.text.length > 0)
    .map<TelegramSendPart>((chunk) => ({
      kind: "text",
      text: chunk.text,
      entities: chunk.entities,
    }));

  return [...fileParts, ...textParts];
};
