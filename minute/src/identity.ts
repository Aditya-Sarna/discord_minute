export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function normalizeEmail(raw: string): string {
  const inner = raw.match(/<([^>]+)>/)?.[1] ?? raw;
  return inner.trim().toLowerCase();
}

export function phonesEqual(a: string, b: string): boolean {
  const x = normalizePhone(a);
  const y = normalizePhone(b);
  if (!x || !y) return false;
  return x === y || x.endsWith(y) || y.endsWith(x);
}

export function emailsEqual(a: string, b: string): boolean {
  return normalizeEmail(a) === normalizeEmail(b);
}
