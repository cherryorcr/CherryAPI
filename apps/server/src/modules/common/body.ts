import { GatewayError } from "../../core/errors";

export type InputRecord = Record<string, unknown>;

export function bodyObject(input: unknown): InputRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new GatewayError("VALIDATION_ERROR", "Request body must be an object", 400);
  }
  return input as InputRecord;
}

export function listBody(input: unknown, key: string): InputRecord[] {
  const value = Array.isArray(input) ? input : bodyObject(input)[key];
  if (!Array.isArray(value)) {
    throw new GatewayError("VALIDATION_ERROR", `Request body must include ${key} array`, 400);
  }
  return value.map((item) => bodyObject(item));
}

export function stringValue(input: InputRecord, camel: string, snake = camel, fallback?: string): string {
  const value = input[camel] ?? input[snake] ?? fallback;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GatewayError("VALIDATION_ERROR", `${camel} is required`, 400);
  }
  return value.trim();
}

export function optionalString(input: InputRecord, camel: string, snake = camel): string | null | undefined {
  const value = input[camel] ?? input[snake];
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new GatewayError("VALIDATION_ERROR", `${camel} must be a string`, 400);
  }
  return value;
}

export function numberValue(input: InputRecord, camel: string, snake = camel, fallback = 0): number {
  const value = input[camel] ?? input[snake] ?? fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new GatewayError("VALIDATION_ERROR", `${camel} must be a number`, 400);
  }
  return parsed;
}

export function optionalNumber(input: InputRecord, camel: string, snake = camel): number | null | undefined {
  const value = input[camel] ?? input[snake];
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new GatewayError("VALIDATION_ERROR", `${camel} must be a number`, 400);
  }
  return parsed;
}

export function booleanValue(input: InputRecord, camel: string, snake = camel, fallback = true): boolean {
  const value = input[camel] ?? input[snake] ?? fallback;
  return Boolean(value);
}

export function jsonValue<T>(input: InputRecord, camel: string, snake = camel, fallback: T): T {
  const value = input[camel] ?? input[snake] ?? fallback;
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }
  return value as T;
}

export function optionalJsonValue<T>(input: InputRecord, camel: string, snake = camel): T | undefined {
  const value = input[camel] ?? input[snake];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }
  return value as T;
}

export function nowIso(): string {
  return new Date().toISOString();
}
