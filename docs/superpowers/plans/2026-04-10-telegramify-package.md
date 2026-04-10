# Telegramify Package Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建一个 Telegram 专用子包，尽量复刻 `telegramify-markdown` 的用户可见能力，并将其接入现有 Telegram adapter 的真实发送链路。

**Architecture:** 以现有 monorepo 的 mdast 体系为输入，新增一个 Telegram 专用子包负责富文本渲染、实体拆分、MarkdownV2 回退和内容分片；`@chat-adapter/telegram` 改为依赖这个子包并优先走 Telegram 原生 entities/caption_entities 发送。Mermaid、代码块抽文件等增强能力通过子包的 pipeline 层产出发送片段，再由 adapter 负责实际发送。

**Tech Stack:** TypeScript, pnpm workspace, Vitest, tsup, mdast utilities from `chat`, Telegram Bot API entities

---

## File Structure

- Create: `packages/telegramify/package.json`
- Create: `packages/telegramify/tsconfig.json`
- Create: `packages/telegramify/tsup.config.ts`
- Create: `packages/telegramify/src/index.ts`
- Create: `packages/telegramify/src/types.ts`
- Create: `packages/telegramify/src/entities.ts`
- Create: `packages/telegramify/src/markdownv2.ts`
- Create: `packages/telegramify/src/render.ts`
- Create: `packages/telegramify/src/pipeline.ts`
- Create: `packages/telegramify/src/code-file.ts`
- Create: `packages/telegramify/src/mermaid.ts`
- Create: `packages/telegramify/src/config.ts`
- Create: `packages/telegramify/src/entities.test.ts`
- Create: `packages/telegramify/src/markdownv2.test.ts`
- Create: `packages/telegramify/src/render.test.ts`
- Create: `packages/telegramify/src/pipeline.test.ts`
- Modify: `packages/adapter-telegram/package.json`
- Modify: `packages/adapter-telegram/src/index.ts`
- Modify: `packages/adapter-telegram/src/types.ts`
- Modify: `packages/adapter-telegram/src/markdown.ts`
- Modify: `packages/adapter-telegram/src/index.test.ts`
- Create: `.changeset/telegramify-package.md`

### Task 1: 建立新子包骨架与实体工具

**Files:**
- Create: `packages/telegramify/package.json`
- Create: `packages/telegramify/tsconfig.json`
- Create: `packages/telegramify/tsup.config.ts`
- Create: `packages/telegramify/src/index.ts`
- Create: `packages/telegramify/src/types.ts`
- Create: `packages/telegramify/src/entities.ts`
- Create: `packages/telegramify/src/entities.test.ts`

- [ ] Step 1: 写失败测试，锁定 UTF-16 长度、实体裁剪和分片行为

```ts
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
    const entities: TelegramRichEntity[] = [
      { type: "bold", offset: 0, length: 5 },
    ];

    expect(splitTelegramEntities("hello", entities, 10)).toEqual([
      {
        text: "hello",
        entities,
      },
    ]);
  });

  it("clips overlapping entities when splitting long text", () => {
    const entities: TelegramRichEntity[] = [
      { type: "bold", offset: 0, length: 11 },
    ];

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
});
```

- [ ] Step 2: 跑测试确认失败

Run: `pnpm --filter telegramify test -- --run packages/telegramify/src/entities.test.ts`

Expected: 失败，原因是 `telegramify` 子包和 `entities.ts` 尚不存在。

- [ ] Step 3: 创建最小子包骨架与实体实现

```ts
// packages/telegramify/src/types.ts
export interface TelegramRichEntity {
  type:
    | "bold"
    | "italic"
    | "underline"
    | "strikethrough"
    | "spoiler"
    | "code"
    | "pre"
    | "text_link"
    | "blockquote"
    | "expandable_blockquote"
    | "custom_emoji";
  offset: number;
  length: number;
  url?: string;
  language?: string;
  custom_emoji_id?: string;
}

export interface TelegramTextChunk {
  text: string;
  entities: TelegramRichEntity[];
}

// packages/telegramify/src/entities.ts
import type { TelegramRichEntity, TelegramTextChunk } from "./types";

export const telegramUtf16Length = (text: string): number => {
  let total = 0;
  for (const char of text) {
    total += char.codePointAt(0)! > 0xffff ? 2 : 1;
  }
  return total;
};

const buildUtf16Offsets = (text: string): number[] => {
  const offsets = new Array<number>(text.length + 1).fill(0);
  let total = 0;
  for (const [index, char] of Array.from(text).entries()) {
    offsets[index] = total;
    total += char.codePointAt(0)! > 0xffff ? 2 : 1;
  }
  offsets[text.length] = total;
  return offsets;
};

const newlineSplitPoints = (text: string): number[] => {
  const points: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      points.push(index + 1);
    }
  }
  return points;
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
  const splitPoints = newlineSplitPoints(text);
  const ranges: Array<[number, number]> = [];
  let start = 0;

  while (start < text.length) {
    const budget = offsets[start] + maxUtf16Length;
    if (offsets[text.length] <= budget) {
      ranges.push([start, text.length]);
      break;
    }

    let split = start;
    for (const point of splitPoints) {
      if (point <= start) continue;
      if (offsets[point] <= budget) {
        split = point;
        continue;
      }
      break;
    }

    if (split === start) {
      for (let index = start + 1; index <= text.length; index += 1) {
        if (offsets[index] > budget) {
          split = index - 1;
          break;
        }
      }
      if (split === start) {
        split = start + 1;
      }
    }

    ranges.push([start, split]);
    start = split;
  }

  return ranges.map(([rangeStart, rangeEnd]) => {
    const chunkStart = offsets[rangeStart];
    const chunkEnd = offsets[rangeEnd];
    const chunkEntities = entities.flatMap((entity) => {
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
    });
    return {
      text: text.slice(rangeStart, rangeEnd),
      entities: chunkEntities,
    };
  });
};
```

- [ ] Step 4: 导出公共 API 并补齐打包配置

```ts
// packages/telegramify/src/index.ts
export * from "./entities";
export * from "./types";

// packages/telegramify/package.json
{
  "name": "telegramify",
  "version": "0.0.0",
  "description": "Telegram rich text rendering helpers for chat adapters",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run --coverage",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "chat": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^25.3.2",
    "tsup": "^8.3.5",
    "typescript": "^5.7.2",
    "vitest": "^4.0.18"
  }
}
```

- [ ] Step 5: 跑测试确认通过

Run: `pnpm --filter telegramify test -- --run src/entities.test.ts`

Expected: PASS

### Task 2: 复刻 MarkdownV2 回退与富文本渲染核心

**Files:**
- Create: `packages/telegramify/src/markdownv2.ts`
- Create: `packages/telegramify/src/render.ts`
- Create: `packages/telegramify/src/render.test.ts`
- Create: `packages/telegramify/src/markdownv2.test.ts`
- Modify: `packages/telegramify/src/index.ts`

- [ ] Step 1: 写失败测试，锁定常见 Markdown 节点的 Telegram 富文本结果

```ts
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "chat";
import { entitiesToMarkdownV2 } from "./markdownv2";
import { renderTelegramRichText } from "./render";

describe("renderTelegramRichText", () => {
  it("renders bold, italic, code and links into entities", () => {
    const ast = parseMarkdown("**bold** *italic* `code` [link](https://example.com)");
    const result = renderTelegramRichText(ast);

    expect(result.text).toBe("bold italic code link");
    expect(result.entities).toEqual([
      { type: "bold", offset: 0, length: 4 },
      { type: "italic", offset: 5, length: 6 },
      { type: "code", offset: 12, length: 4 },
      { type: "text_link", offset: 17, length: 4, url: "https://example.com" },
    ]);
  });
});

describe("entitiesToMarkdownV2", () => {
  it("escapes plain text and reinserts entity markers", () => {
    expect(
      entitiesToMarkdownV2("price is 1+1", [
        { type: "bold", offset: 9, length: 3 },
      ]),
    ).toBe("price is *_1\\+1*");
  });
});
```

- [ ] Step 2: 跑测试确认失败

Run: `pnpm --filter telegramify test -- --run src/render.test.ts src/markdownv2.test.ts`

Expected: 失败，原因是 `render.ts` 和 `markdownv2.ts` 尚未实现。

- [ ] Step 3: 先实现最小渲染器

```ts
// packages/telegramify/src/render.ts
import type { Root } from "mdast";
import { toPlainText, walkAst, type Content } from "chat";
import type { TelegramRichEntity } from "./types";

export interface TelegramRenderResult {
  text: string;
  entities: TelegramRichEntity[];
  segments: Array<{ kind: "text" | "code_block" | "mermaid"; textStart: number; textEnd: number; utf16Start: number; utf16End: number; language?: string; rawCode?: string }>;
}

export const renderTelegramRichText = (ast: Root): TelegramRenderResult => {
  const plainText = toPlainText(ast);
  const entities: TelegramRichEntity[] = [];
  let cursor = 0;

  walkAst(ast, (node: Content) => {
    if (node.type === "strong") {
      const value = toPlainText(node);
      entities.push({ type: "bold", offset: plainText.indexOf(value, cursor), length: value.length });
      cursor = plainText.indexOf(value, cursor) + value.length;
    }
    if (node.type === "emphasis") {
      const value = toPlainText(node);
      entities.push({ type: "italic", offset: plainText.indexOf(value, cursor), length: value.length });
      cursor = plainText.indexOf(value, cursor) + value.length;
    }
    if (node.type === "inlineCode") {
      entities.push({ type: "code", offset: plainText.indexOf(node.value, cursor), length: node.value.length });
      cursor = plainText.indexOf(node.value, cursor) + node.value.length;
    }
    if (node.type === "link") {
      const value = toPlainText(node);
      entities.push({ type: "text_link", offset: plainText.indexOf(value, cursor), length: value.length, url: node.url });
      cursor = plainText.indexOf(value, cursor) + value.length;
    }
    return node;
  });

  return {
    text: plainText,
    entities,
    segments: [
      {
        kind: "text",
        textStart: 0,
        textEnd: plainText.length,
        utf16Start: 0,
        utf16End: plainText.length,
      },
    ],
  };
};
```

- [ ] Step 4: 实现最小 MarkdownV2 序列化并补导出

```ts
// packages/telegramify/src/markdownv2.ts
import type { TelegramRichEntity } from "./types";

const ESCAPE_RE = /[_*\[\]()~`>#+\-=|{}.!\\]/g;

const escapeText = (value: string): string => value.replaceAll(ESCAPE_RE, "\\$&");

export const entitiesToMarkdownV2 = (
  text: string,
  entities: TelegramRichEntity[],
): string => {
  if (entities.length === 0) {
    return escapeText(text);
  }

  let result = text;
  const sorted = [...entities].sort((left, right) => {
    if (left.offset !== right.offset) return right.offset - left.offset;
    return left.length - right.length;
  });

  for (const entity of sorted) {
    const start = entity.offset;
    const end = entity.offset + entity.length;
    const value = escapeText(result.slice(start, end));
    let wrapped = value;
    if (entity.type === "bold") wrapped = `*${value}*`;
    if (entity.type === "italic") wrapped = `_${value}_`;
    if (entity.type === "code") wrapped = `\`${value}\``;
    if (entity.type === "text_link") wrapped = `[${value}](${entity.url ?? ""})`;
    result = `${result.slice(0, start)}${wrapped}${result.slice(end)}`;
  }

  return escapeText(result).replaceAll("\\*", "*").replaceAll("\\_", "_").replaceAll("\\`", "`").replace(/\\\[(.*?)\\\]\((.*?)\)/g, "[$1]($2)");
};

// packages/telegramify/src/index.ts
export * from "./markdownv2";
export * from "./render";
```

- [ ] Step 5: 跑测试确认通过，再继续扩展更多节点

Run: `pnpm --filter telegramify test -- --run src/render.test.ts src/markdownv2.test.ts`

Expected: PASS

### Task 3: 复刻内容分片与增强输出

**Files:**
- Create: `packages/telegramify/src/config.ts`
- Create: `packages/telegramify/src/code-file.ts`
- Create: `packages/telegramify/src/mermaid.ts`
- Create: `packages/telegramify/src/pipeline.ts`
- Create: `packages/telegramify/src/pipeline.test.ts`
- Modify: `packages/telegramify/src/render.ts`
- Modify: `packages/telegramify/src/index.ts`

- [ ] Step 1: 写失败测试，锁定长文本拆分、代码块抽文件、Mermaid 抽图片/文件的外部行为

```ts
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "chat";
import { processTelegramContent } from "./pipeline";

describe("processTelegramContent", () => {
  it("splits long text into multiple text parts with entities", async () => {
    const ast = parseMarkdown("**hello**\nworld");
    const result = await processTelegramContent(ast, { maxMessageLength: 6, minFileLines: 99, renderMermaid: false });

    expect(result).toEqual([
      { kind: "text", text: "hello\n", entities: [{ type: "bold", offset: 0, length: 6 }] },
      { kind: "text", text: "world", entities: [] },
    ]);
  });

  it("extracts long code blocks as file parts", async () => {
    const ast = parseMarkdown("```ts\nconst a = 1;\nconst b = 2;\n```");
    const result = await processTelegramContent(ast, { minFileLines: 1, renderMermaid: false });

    expect(result[0]).toMatchObject({ kind: "file", filename: "snippet.ts" });
  });
});
```

- [ ] Step 2: 跑测试确认失败

Run: `pnpm --filter telegramify test -- --run src/pipeline.test.ts`

Expected: 失败，原因是 `pipeline.ts` 尚未实现。

- [ ] Step 3: 实现最小 pipeline，先覆盖文本分片和代码块抽文件

```ts
// packages/telegramify/src/pipeline.ts
import type { Root } from "mdast";
import { toPlainText, walkAst, type Content } from "chat";
import { splitTelegramEntities } from "./entities";
import { renderTelegramRichText } from "./render";

export interface TelegramPipelineOptions {
  maxMessageLength?: number;
  minFileLines?: number;
  renderMermaid?: boolean;
}

export type TelegramSendPart =
  | { kind: "text"; text: string; entities: import("./types").TelegramRichEntity[] }
  | { kind: "file"; filename: string; data: Uint8Array; language?: string }
  | { kind: "photo"; data: Uint8Array; caption?: string; captionEntities?: import("./types").TelegramRichEntity[] };

export const processTelegramContent = async (
  ast: Root,
  options: TelegramPipelineOptions = {},
): Promise<TelegramSendPart[]> => {
  const result = renderTelegramRichText(ast);
  const parts = splitTelegramEntities(result.text, result.entities, options.maxMessageLength ?? 4096).map((chunk) => ({
    kind: "text" as const,
    text: chunk.text,
    entities: chunk.entities,
  }));

  walkAst(ast, (node: Content) => {
    if (node.type === "code" && (options.minFileLines ?? 1) <= node.value.split("\n").length) {
      parts.unshift({
        kind: "file",
        filename: node.lang ? `snippet.${node.lang}` : "snippet.txt",
        data: new TextEncoder().encode(node.value),
        language: node.lang ?? undefined,
      });
    }
    return node;
  });

  return parts;
};
```

- [ ] Step 4: 预留 Mermaid 能力并补导出

```ts
// packages/telegramify/src/mermaid.ts
export const renderMermaidDiagram = async (_source: string): Promise<Uint8Array | null> => null;

// packages/telegramify/src/code-file.ts
export const inferTelegramCodeFilename = (language?: string): string => {
  if (!language) return "snippet.txt";
  return `snippet.${language}`;
};

// packages/telegramify/src/index.ts
export * from "./pipeline";
export * from "./config";
```

- [ ] Step 5: 跑测试确认通过

Run: `pnpm --filter telegramify test -- --run src/pipeline.test.ts`

Expected: PASS

### Task 4: 将新子包接入 Telegram adapter 真实发送链路

**Files:**
- Modify: `packages/adapter-telegram/package.json`
- Modify: `packages/adapter-telegram/src/index.ts`
- Modify: `packages/adapter-telegram/src/types.ts`
- Modify: `packages/adapter-telegram/src/markdown.ts`
- Modify: `packages/adapter-telegram/src/index.test.ts`

- [ ] Step 1: 写失败测试，锁定发送 text/entities、caption_entities 和 MarkdownV2 回退行为

```ts
it("sends markdown messages using entities instead of parse_mode", async () => {
  process.env.TELEGRAM_BOT_TOKEN = "token";
  const adapter = new TelegramAdapter({ logger: mockLogger });
  adapter.connect(createMockChat());

  mockFetch.mockResolvedValueOnce(telegramOk({ id: 999, is_bot: true, first_name: "bot", username: "bot" }));
  mockFetch.mockResolvedValueOnce(telegramOk(sampleMessage()));

  await adapter.postMessage("telegram:123:123", { markdown: "**bold**" });

  const body = JSON.parse(String(mockFetch.mock.calls[1]?.[1]?.body));
  expect(body.text).toBe("bold");
  expect(body.entities).toEqual([{ type: "bold", offset: 0, length: 4 }]);
  expect(body.parse_mode).toBeUndefined();
});
```

- [ ] Step 2: 跑测试确认失败

Run: `pnpm --filter @chat-adapter/telegram test -- --run src/index.test.ts`

Expected: 失败，原因是 adapter 仍使用 `parse_mode` 而不是 `entities`。

- [ ] Step 3: 引入新子包依赖，并在发送路径改走富文本结果

```ts
// packages/adapter-telegram/package.json
{
  "dependencies": {
    "@chat-adapter/shared": "workspace:*",
    "chat": "workspace:*",
    "telegramify": "workspace:*"
  }
}

// packages/adapter-telegram/src/index.ts
import {
  entitiesToMarkdownV2,
  processTelegramContent,
  renderTelegramRichText,
  type TelegramRichEntity,
} from "telegramify";

type OutgoingTelegramMessage = {
  text: string;
  entities?: TelegramRichEntity[];
  parseMode?: string;
};
```

- [ ] Step 4: 最小改造发送、编辑、附件说明文字路径

```ts
private buildTelegramOutgoing(message: AdapterPostableMessage): OutgoingTelegramMessage {
  if (typeof message === "string" || "raw" in Object(message)) {
    const text = typeof message === "string" ? message : message.raw;
    return { text };
  }

  if (typeof message === "object" && message !== null && "markdown" in message) {
    const ast = this.formatConverter.toAst(message.markdown);
    const rendered = renderTelegramRichText(ast);
    return { text: rendered.text, entities: rendered.entities };
  }

  if (typeof message === "object" && message !== null && "ast" in message) {
    const rendered = renderTelegramRichText(message.ast);
    return { text: rendered.text, entities: rendered.entities };
  }

  const text = this.formatConverter.renderPostable(message);
  return { text, parseMode: this.resolveParseMode(message, extractCard(message)) };
}
```

- [ ] Step 5: 跑适配器测试确认通过，并补更多覆盖

Run: `pnpm --filter @chat-adapter/telegram test -- --run src/index.test.ts`

Expected: PASS

### Task 5: 完成验证、发布元数据与变更说明

**Files:**
- Create: `.changeset/telegramify-package.md`
- Modify: `packages/adapter-telegram/src/index.test.ts`
- Modify: `packages/telegramify/src/*.test.ts`

- [ ] Step 1: 补充跨包回归测试

```ts
it("uses caption_entities when uploading a document with markdown caption", async () => {
  process.env.TELEGRAM_BOT_TOKEN = "token";
  const adapter = new TelegramAdapter({ logger: mockLogger });
  adapter.connect(createMockChat());

  mockFetch.mockResolvedValueOnce(telegramOk({ id: 999, is_bot: true, first_name: "bot", username: "bot" }));
  mockFetch.mockResolvedValueOnce(telegramOk(sampleMessage({ document: { file_id: "1", file_unique_id: "u", file_size: 1 } })));

  await adapter.postMessage("telegram:123:123", {
    markdown: "**bold**",
    files: [{ filename: "demo.txt", data: new TextEncoder().encode("demo") }],
  });

  const formData = mockFetch.mock.calls[1]?.[1]?.body as FormData;
  expect(formData.get("caption")).toBe("bold");
  expect(JSON.parse(String(formData.get("caption_entities")))).toEqual([
    { type: "bold", offset: 0, length: 4 },
  ]);
});
```

- [ ] Step 2: 跑针对性验证

Run: `pnpm --filter telegramify test && pnpm --filter @chat-adapter/telegram test`

Expected: PASS

- [ ] Step 3: 写 changeset

```md
---
"@chat-adapter/telegram": minor
"telegramify": minor
---

Add a dedicated Telegram formatting package and route Telegram markdown sending through entity-based rendering.
```

- [ ] Step 4: 跑最终验证

Run: `pnpm --filter telegramify build && pnpm --filter @chat-adapter/telegram build && pnpm --filter telegramify typecheck && pnpm --filter @chat-adapter/telegram typecheck`

Expected: PASS

- [ ] Step 5: 记录完成状态

Run: `git status --short`

Expected: 只看到本次计划涉及的文件变更。
