export const APP_NAME = 'Private Bin';

export const MAX_TEXT_BYTES = 1_000_000;
export const HIGHLIGHT_BYTE_LIMIT = 250_000;

export const EXPIRATION_OPTIONS = [
  { id: '10min', label: '10 分钟', seconds: 10 * 60 },
  { id: '30min', label: '30 分钟', seconds: 30 * 60 },
  { id: '1hour', label: '1 小时', seconds: 60 * 60 },
  { id: '3hours', label: '3 小时', seconds: 3 * 60 * 60 },
  { id: '6hours', label: '6 小时', seconds: 6 * 60 * 60 },
  { id: '12hours', label: '12 小时', seconds: 12 * 60 * 60 },
  { id: '1day', label: '1 天', seconds: 24 * 60 * 60 },
  { id: '3days', label: '3 天', seconds: 3 * 24 * 60 * 60 },
  { id: '1week', label: '1 周', seconds: 7 * 24 * 60 * 60 },
] as const;

export const DEFAULT_EXPIRATION_ID = '6hours';

export const LANGUAGE_OPTIONS = [
  { id: 'text', label: '纯文本' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'json', label: 'JSON' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'yaml', label: 'YAML' },
  { id: 'css', label: 'CSS' },
  { id: 'html', label: 'HTML' },
  { id: 'shell', label: 'Shell' },
  { id: 'python', label: 'Python' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
] as const;

export type ExpirationId = (typeof EXPIRATION_OPTIONS)[number]['id'];
export type PasteLanguage = (typeof LANGUAGE_OPTIONS)[number]['id'];

export const EXPIRATION_SECONDS = new Set<number>(
  EXPIRATION_OPTIONS.map((option) => option.seconds),
);

export function getDefaultExpirationSeconds(): number {
  const option = EXPIRATION_OPTIONS.find((item) => item.id === DEFAULT_EXPIRATION_ID);
  return option?.seconds ?? 6 * 60 * 60;
}

export function getExpirationLabel(seconds: number): string {
  return EXPIRATION_OPTIONS.find((option) => option.seconds === seconds)?.label ?? '6 小时';
}

export function isPasteLanguage(value: string): value is PasteLanguage {
  return LANGUAGE_OPTIONS.some((option) => option.id === value);
}
