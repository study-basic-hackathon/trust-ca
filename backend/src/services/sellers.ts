const MAX_DISPLAY_NAME_LENGTH = 100;

export class InvalidDisplayNameError extends Error {
  constructor() {
    super(`表示名は1〜${MAX_DISPLAY_NAME_LENGTH}文字で入力してください。`);
    this.name = "InvalidDisplayNameError";
  }
}

export function normalizeDisplayName(input: unknown): string {
  const displayName = typeof input === "string" ? input.trim() : "";
  if (!displayName || displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new InvalidDisplayNameError();
  }
  return displayName;
}
