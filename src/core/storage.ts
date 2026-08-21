/** localStorage with a guaranteed-safe fallback (private mode, blocked cookies). */
const memory = new Map<string, string>();

let available: boolean | null = null;
function ok(): boolean {
  if (available !== null) return available;
  try {
    const k = '__snackery_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

export function readRaw(key: string): string | null {
  try {
    return ok() ? window.localStorage.getItem(key) : memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

export function writeRaw(key: string, value: string): void {
  memory.set(key, value);
  try {
    if (ok()) window.localStorage.setItem(key, value);
  } catch {
    /* quota / private mode — memory copy still serves this session */
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = readRaw(key);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    writeRaw(key, JSON.stringify(value));
  } catch {
    /* non-serialisable — ignore */
  }
}

export function removeKey(key: string): void {
  memory.delete(key);
  try {
    if (ok()) window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
