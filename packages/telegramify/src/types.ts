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
