import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = path.join(process.cwd(), ".pipeline-ops");

function ensureRootDir() {
  fs.mkdirSync(ROOT_DIR, { recursive: true });
}

export function readStore<T>(name: string, fallback: T): T {
  try {
    const filePath = path.join(ROOT_DIR, name);
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return fallback;
    }

    console.warn(`Failed to read store ${name}.`, error);
    return fallback;
  }
}

export function writeStore<T>(name: string, value: T) {
  ensureRootDir();
  const filePath = path.join(ROOT_DIR, name);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

export function patchStore<T>(name: string, fallback: T, updater: (value: T) => T) {
  const current = readStore(name, fallback);
  const next = updater(current);
  writeStore(name, next);
  return next;
}

export function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
