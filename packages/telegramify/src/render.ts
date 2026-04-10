import type { Content, Root } from "chat";
import { telegramUtf16Length } from "./entities";
import type { TelegramRichEntity } from "./types";

export interface TelegramRenderSegment {
  kind: "text" | "code_block" | "mermaid";
  textStart: number;
  textEnd: number;
  utf16Start: number;
  utf16End: number;
  language?: string;
  rawCode?: string;
}

export interface TelegramRenderResult {
  text: string;
  entities: TelegramRichEntity[];
  segments: TelegramRenderSegment[];
}

interface RenderState {
  text: string;
  entities: TelegramRichEntity[];
  listDepth: number;
  listStack: Array<{ nextIndex: number; ordered: boolean }>;
  segments: TelegramRenderSegment[];
}

const hasChildren = (node: Content | Root): node is Root | Extract<Content, { children?: Content[] }> =>
  "children" in node;

const appendText = (
  state: RenderState,
  value: string,
  segment?: Omit<TelegramRenderSegment, "textStart" | "textEnd" | "utf16Start" | "utf16End">,
): void => {
  if (value.length === 0) {
    return;
  }

  const textStart = state.text.length;
  const utf16Start = telegramUtf16Length(state.text);
  state.text += value;
  const textEnd = state.text.length;
  const utf16End = telegramUtf16Length(state.text);

  const nextSegment: TelegramRenderSegment = {
    kind: segment?.kind ?? "text",
    textStart,
    textEnd,
    utf16Start,
    utf16End,
    language: segment?.language,
    rawCode: segment?.rawCode,
  };

  const lastSegment = state.segments.at(-1);
  if (
    lastSegment?.kind === "text" &&
    nextSegment.kind === "text" &&
    lastSegment.textEnd === nextSegment.textStart
  ) {
    lastSegment.textEnd = nextSegment.textEnd;
    lastSegment.utf16End = nextSegment.utf16End;
    return;
  }

  state.segments.push(nextSegment);
};

const ensureSuffix = (state: RenderState, value: string): void => {
  if (!state.text.endsWith(value)) {
    appendText(state, value);
  }
};

const ensureBlankLine = (state: RenderState): void => {
  if (state.text.length === 0) {
    return;
  }

  if (state.text.endsWith("\n\n")) {
    return;
  }

  if (state.text.endsWith("\n")) {
    appendText(state, "\n");
    return;
  }

  appendText(state, "\n\n");
};

const renderChildren = (
  state: RenderState,
  node: { children?: Content[] },
): void => {
  for (const child of node.children ?? []) {
    renderNode(state, child);
  }
};

const trimUncoveredTrailingNewlines = (
  text: string,
  entities: TelegramRichEntity[],
): string => {
  let trimmedText = text;

  while (trimmedText.endsWith("\n")) {
    const nextLength = telegramUtf16Length(trimmedText) - 1;
    const coveredByEntity = entities.some(
      (entity) => entity.offset + entity.length > nextLength,
    );

    if (coveredByEntity) {
      break;
    }

    trimmedText = trimmedText.slice(0, -1);
  }

  return trimmedText;
};

const withEntity = (
  state: RenderState,
  entity: Omit<TelegramRichEntity, "offset" | "length">,
  render: () => void,
): void => {
  const start = telegramUtf16Length(state.text);
  render();
  const length = telegramUtf16Length(state.text) - start;

  if (length > 0) {
    state.entities.push({ ...entity, offset: start, length });
  }
};

const renderNode = (state: RenderState, node: Content): void => {
  switch (node.type) {
    case "paragraph": {
      renderChildren(state, node);
      if (state.listDepth > 0) {
        ensureSuffix(state, "\n");
      } else {
        ensureBlankLine(state);
      }
      return;
    }

    case "heading": {
      renderChildren(state, node);
      ensureBlankLine(state);
      return;
    }

    case "blockquote": {
      ensureBlankLine(state);
      appendText(state, "> ");
      renderChildren(state, node);
      ensureBlankLine(state);
      return;
    }

    case "list": {
      ensureBlankLine(state);
      state.listDepth += 1;
      state.listStack.push({
        ordered: node.ordered === true,
        nextIndex: node.start ?? 1,
      });
      renderChildren(state, node);
      state.listStack.pop();
      state.listDepth -= 1;
      ensureBlankLine(state);
      return;
    }

    case "listItem": {
      const currentList = state.listStack[state.listStack.length - 1];
      if (currentList?.ordered) {
        appendText(state, `${currentList.nextIndex}. `);
        currentList.nextIndex += 1;
      } else {
        appendText(state, "- ");
      }
      renderChildren(state, node);
      ensureSuffix(state, "\n");
      return;
    }

    case "text": {
      appendText(state, node.value);
      return;
    }

    case "strong": {
      withEntity(state, { type: "bold" }, () => renderChildren(state, node));
      return;
    }

    case "emphasis": {
      withEntity(state, { type: "italic" }, () => renderChildren(state, node));
      return;
    }

    case "delete": {
      withEntity(state, { type: "strikethrough" }, () => renderChildren(state, node));
      return;
    }

    case "inlineCode": {
      withEntity(state, { type: "code" }, () => appendText(state, node.value));
      return;
    }

    case "code": {
      ensureBlankLine(state);

      const start = telegramUtf16Length(state.text);
      appendText(state, node.value, {
        kind: node.lang === "mermaid" ? "mermaid" : "code_block",
        language: node.lang ?? undefined,
        rawCode: node.value,
      });

      const length = telegramUtf16Length(state.text) - start;
      if (length > 0) {
        state.entities.push({
          type: "pre",
          offset: start,
          length,
          language: node.lang ?? undefined,
        });
      }

      ensureBlankLine(state);
      return;
    }

    case "link": {
      withEntity(state, { type: "text_link", url: node.url }, () =>
        renderChildren(state, node),
      );
      return;
    }

    default: {
      if (hasChildren(node)) {
        renderChildren(state, node);
      }
    }
  }
};

export const renderTelegramRichText = (ast: Root): TelegramRenderResult => {
  const state: RenderState = {
    text: "",
    entities: [],
    listDepth: 0,
    listStack: [],
    segments: [],
  };

  renderChildren(state, ast);
  const finalText = trimUncoveredTrailingNewlines(state.text, state.entities);
  const finalUtf16Length = telegramUtf16Length(finalText);

  return {
    text: finalText,
    entities: state.entities,
    segments: state.segments
      .filter((segment) => segment.textStart < finalText.length)
      .map((segment) => ({
        ...segment,
        textEnd: Math.min(segment.textEnd, finalText.length),
        utf16End: Math.min(segment.utf16End, finalUtf16Length),
      })),
  };
};
