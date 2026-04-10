const normalizeLanguageExtension = (language: string): string => {
  const normalized = language
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "txt";
};

export const inferTelegramCodeFilename = (language?: string): string => {
  if (!language) {
    return "snippet.txt";
  }

  return `snippet.${normalizeLanguageExtension(language)}`;
};
