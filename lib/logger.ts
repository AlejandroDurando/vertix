type LogLevel = "info" | "warn" | "error";

const SENSITIVE_KEYS = new Set([
  "email",
  "telefono",
  "telefono_celular",
  "nombre",
  "apellido",
  "dni",
  "cuit",
  "password",
  "token",
  "authorization",
  "api_key",
  "apikey",
  "GOOGLE_SERVICE_ACCOUNT_KEY",
  "HUBSPOT_API_KEY",
  "archivo",
  "mensaje",
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth-limit]";
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export function log(level: LogLevel, scope: string, message: string, meta?: unknown) {
  const entry = {
    level,
    scope,
    message,
    ...(meta !== undefined ? { meta: redact(meta) } : {}),
    ts: new Date().toISOString(),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (scope: string, message: string, meta?: unknown) =>
    log("info", scope, message, meta),
  warn: (scope: string, message: string, meta?: unknown) =>
    log("warn", scope, message, meta),
  error: (scope: string, message: string, meta?: unknown) =>
    log("error", scope, message, meta),
};
