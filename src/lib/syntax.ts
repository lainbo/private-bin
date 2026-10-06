import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import type { PasteLanguage } from '../shared/constants';

const LANGUAGE_IMPORTS = {
  bash: () => import('shiki/dist/langs/bash.mjs'),
  css: () => import('shiki/dist/langs/css.mjs'),
  go: () => import('shiki/dist/langs/go.mjs'),
  html: () => import('shiki/dist/langs/html.mjs'),
  javascript: () => import('shiki/dist/langs/javascript.mjs'),
  json: () => import('shiki/dist/langs/json.mjs'),
  markdown: () => import('shiki/dist/langs/markdown.mjs'),
  python: () => import('shiki/dist/langs/python.mjs'),
  rust: () => import('shiki/dist/langs/rust.mjs'),
  toml: () => import('shiki/dist/langs/toml.mjs'),
  typescript: () => import('shiki/dist/langs/typescript.mjs'),
  yaml: () => import('shiki/dist/langs/yaml.mjs'),
};

type SupportedLanguage = keyof typeof LANGUAGE_IMPORTS;

let highlighterPromise: Promise<HighlighterCore> | null = null;

const LANGUAGE_MAP: Record<PasteLanguage, SupportedLanguage | 'text'> = {
  text: 'text',
  css: 'css',
  go: 'go',
  html: 'html',
  javascript: 'javascript',
  json: 'json',
  markdown: 'markdown',
  python: 'python',
  rust: 'rust',
  shell: 'bash',
  toml: 'toml',
  typescript: 'typescript',
  yaml: 'yaml',
};

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      engine: createJavaScriptRegexEngine(),
      themes: [import('shiki/dist/themes/github-light.mjs')],
    });
  }
  return highlighterPromise;
}

export async function codeToHighlightedHtml(code: string, language: PasteLanguage): Promise<string> {
  const mapped = LANGUAGE_MAP[language];
  if (mapped === 'text') return '';
  const highlighter = await getHighlighter();
  await highlighter.loadLanguage(LANGUAGE_IMPORTS[mapped]);
  return highlighter.codeToHtml(code, {
    lang: mapped,
    theme: 'github-light',
  });
}
