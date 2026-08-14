import * as argon2 from "argon2";
import { validatePin } from "@fiao/domain/auth/pin-policy";

export async function hashPin(pin: string): Promise<string> {
  if (!validatePin(pin)) throw new Error("INVALID_PIN");
  return argon2.hash(pin, { type: argon2.argon2id });
}

export async function verifyPinHash(hash: string, pin: string): Promise<boolean> {
  if (!validatePin(pin) || !hash.startsWith("$argon2id$")) return false;
  return argon2.verify(hash, pin).catch(() => false);
}
