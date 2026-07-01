// Structured JSON logging with a request-scoped trace id. The id lives in an
// AsyncLocalStorage store (nodejs_compat) so any log() call during a request
// picks it up automatically — no need to thread it through every function.
// Output is one JSON object per line, which Workers Logs indexes by field.
import { AsyncLocalStorage } from "node:async_hooks";

type Store = { requestId: string };
const storage = new AsyncLocalStorage<Store>();

// Runs `fn` with `requestId` attached to every log() call inside it.
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

export function currentRequestId(): string {
  return storage.getStore()?.requestId ?? "-";
}

type Fields = Record<string, unknown>;
type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, msg: string, fields?: Fields): void {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    requestId: currentRequestId(),
    msg,
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields?: Fields) => emit("debug", msg, fields),
  info: (msg: string, fields?: Fields) => emit("info", msg, fields),
  warn: (msg: string, fields?: Fields) => emit("warn", msg, fields),
  error: (msg: string, fields?: Fields) => emit("error", msg, fields),
};
