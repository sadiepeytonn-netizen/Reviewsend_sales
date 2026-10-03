import { randomInt } from "node:crypto";

// Easy-to-read temporary password, e.g. "kpwz-7rnd-qh4m".
// Leaves out look-alike characters (0/o, 1/l/i).
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function temporaryPassword(): string {
  const group = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${group()}-${group()}-${group()}`;
}
