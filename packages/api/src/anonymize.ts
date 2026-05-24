import { createHash } from 'crypto';

export function anonymizeAuthor(raw: string): string {
  const hex = createHash('sha256').update(raw).digest('hex');
  return `usuário_${hex.slice(0, 4)}`;
}
