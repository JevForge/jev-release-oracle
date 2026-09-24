const SECRET_PATTERNS: RegExp[] = [
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAI_GATEWAY_API_KEY\s*[:=]\s*\S+/gi,
  /\bTYPESAFE_API_KEY\s*[:=]\s*\S+/gi,
  /\bJEV_CUSTOM_API_KEY\s*[:=]\s*\S+/gi,
  /\bBearer\s+[A-Za-z0-9._\-+=/]{12,}/gi,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]');
  }
  return out;
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 15))}…[truncated]`;
}

export function sanitizeText(text: string, maxChars = 500): string {
  return truncate(redactSecrets(text).replace(/\s+/g, ' ').trim(), maxChars);
}

export function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeText(message, 400);
}
