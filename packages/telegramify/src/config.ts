export interface TelegramPipelineOptions {
  maxMessageLength?: number;
  minFileLines?: number;
  renderMermaid?: boolean;
}

export const DEFAULT_TELEGRAM_PIPELINE_OPTIONS: Required<TelegramPipelineOptions> = {
  maxMessageLength: 4096,
  minFileLines: Number.POSITIVE_INFINITY,
  renderMermaid: false,
};

export const resolveTelegramPipelineOptions = (
  options: TelegramPipelineOptions = {},
): Required<TelegramPipelineOptions> => ({
  ...DEFAULT_TELEGRAM_PIPELINE_OPTIONS,
  ...options,
});
