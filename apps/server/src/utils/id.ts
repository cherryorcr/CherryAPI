import { randomBytes, randomUUID } from "node:crypto";

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function createToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
