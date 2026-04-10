import type { TelegramRichEntity } from "./types";

const ESCAPE_RE = /[_*\[\]()~`>#+\-=|{}.!\\]/g;
const CODE_ESCAPE_RE = /[`\\]/g;
const LINK_URL_ESCAPE_RE = /[)\\]/g;

const escapeMarkdownV2 = (value: string): string => value.replaceAll(ESCAPE_RE, "\\$&");
const escapeCodeMarkdownV2 = (value: string): string => value.replaceAll(CODE_ESCAPE_RE, "\\$&");
const escapeLinkUrlMarkdownV2 = (value: string): string => value.replaceAll(LINK_URL_ESCAPE_RE, "\\$&");

type SupportedEntityType = "bold" | "italic" | "code" | "text_link";

interface NormalizedEntity {
  entity: TelegramRichEntity;
  start: number;
  end: number;
  order: number;
}

const ENTITY_PRIORITY: Record<SupportedEntityType, number> = {
  text_link: 0,
  bold: 1,
  italic: 2,
  code: 3,
};

const toSupportedEntityType = (type: TelegramRichEntity["type"]): SupportedEntityType => {
  switch (type) {
    case "bold":
    case "italic":
    case "code":
    case "text_link": {
      return type;
    }

    default: {
      throw new Error(`Unsupported Telegram entity type: ${type}`);
    }
  }
};

const utf16RangeToIndices = (
  text: string,
  offset: number,
  length: number,
): [number, number] => {
  if (offset < 0 || length <= 0) {
    throw new Error("Entity range must use positive UTF-16 offsets and lengths");
  }

  const boundaries = new Map<number, number>([[0, 0]]);
  let utf16Cursor = 0;

  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index);
    const charLength = codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    utf16Cursor += charLength;
    index += charLength;
    boundaries.set(utf16Cursor, index);
  }

  const startIndex = boundaries.get(offset);
  const endIndex = boundaries.get(offset + length);

  if (startIndex === undefined || endIndex === undefined) {
    throw new Error("Entity range must align to utf16 boundaries");
  }

  if (startIndex >= endIndex) {
    throw new Error("Entity range must not be empty");
  }

  return [startIndex, endIndex];
};

const getEntityMarkers = (entity: TelegramRichEntity): [string, string] => {
  switch (toSupportedEntityType(entity.type)) {
    case "bold": {
      return ["*", "*"];
    }

    case "italic": {
      return ["_", "_"];
    }

    case "code": {
      return ["`", "`"];
    }

    case "text_link": {
      return ["[", `](${escapeLinkUrlMarkdownV2(entity.url ?? "")})`];
    }
  }
};

const normalizeEntities = (text: string, entities: TelegramRichEntity[]): NormalizedEntity[] => {
  const normalized = entities.map((entity, index) => {
    const supportedType = toSupportedEntityType(entity.type);
    const [start, end] = utf16RangeToIndices(text, entity.offset, entity.length);

    return {
      entity: { ...entity, type: supportedType },
      start,
      end,
      order: index,
    };
  });

  normalized.sort((left, right) => {
    if (left.start !== right.start) {
      return left.start - right.start;
    }

    if (left.end !== right.end) {
      return right.end - left.end;
    }

    return ENTITY_PRIORITY[left.entity.type as SupportedEntityType] - ENTITY_PRIORITY[right.entity.type as SupportedEntityType];
  });

  const stack: NormalizedEntity[] = [];
  for (const entity of normalized) {
    while (stack.length > 0 && entity.start >= stack[stack.length - 1]!.end) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (parent && entity.start < parent.end && entity.end > parent.end) {
      throw new Error("Crossing Telegram entity ranges are not supported");
    }

    stack.push(entity);
  }

  normalized.forEach((entity, index) => {
    entity.order = index;
  });

  return normalized;
};

const escapeSegment = (value: string, activeEntities: TelegramRichEntity[]): string => {
  if (activeEntities.some((entity) => entity.type === "code")) {
    return escapeCodeMarkdownV2(value);
  }

  return escapeMarkdownV2(value);
};

export const entitiesToMarkdownV2 = (
  text: string,
  entities: TelegramRichEntity[],
): string => {
  if (entities.length === 0) {
    return escapeMarkdownV2(text);
  }

  const normalizedEntities = normalizeEntities(text, entities);
  const openings = new Map<number, NormalizedEntity[]>();
  const closings = new Map<number, NormalizedEntity[]>();

  for (const entity of normalizedEntities) {
    const openingList = openings.get(entity.start) ?? [];
    openingList.push(entity);
    openings.set(entity.start, openingList);

    const closingList = closings.get(entity.end) ?? [];
    closingList.push(entity);
    closings.set(entity.end, closingList);
  }

  const boundaries = [...new Set([0, text.length, ...openings.keys(), ...closings.keys()])].sort(
    (left, right) => left - right,
  );
  let result = "";
  let cursor = 0;
  const activeEntities: NormalizedEntity[] = [];

  for (const boundary of boundaries) {
    result += escapeSegment(
      text.slice(cursor, boundary),
      activeEntities.map((entity) => entity.entity),
    );

    const boundaryClosings = closings.get(boundary)?.sort((left, right) => right.order - left.order) ?? [];
    for (const entity of boundaryClosings) {
      result += getEntityMarkers(entity.entity)[1];
      let activeIndex = -1;
      for (let index = activeEntities.length - 1; index >= 0; index -= 1) {
        if (activeEntities[index]?.order === entity.order) {
          activeIndex = index;
          break;
        }
      }
      if (activeIndex !== -1) {
        activeEntities.splice(activeIndex, 1);
      }
    }

    const boundaryOpenings = openings.get(boundary)?.sort((left, right) => left.order - right.order) ?? [];
    for (const entity of boundaryOpenings) {
      result += getEntityMarkers(entity.entity)[0];
      activeEntities.push(entity);
    }

    cursor = boundary;
  }

  return result;
};
