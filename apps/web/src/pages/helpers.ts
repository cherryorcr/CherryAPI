export function asJsonText(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

export function parseJson(text: string, label: string): unknown {
  try {
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

export function toNumber(value: string, label: string, fallback: number): number {
  if (value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a number`);
  }
  return parsed;
}

export function toNullableNumber(value: string, label: string): number | null {
  if (value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a number`);
  }
  return parsed;
}

export function toNullableString(value: string): string | null {
  return value.trim() ? value.trim() : null;
}

export function tagsFromText(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

export function shortId(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  if (value.length <= 18) {
    return value;
  }
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}
