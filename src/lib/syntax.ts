import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import type { PasteLanguage } from '../shared/constants';

type SupportedLanguage =
  | 'bash'
  | 'css'
  | 'go'
  | 'html'
  | 'javascript'
  | 'json'
  | 'markdown'
  | 'python'
  | 'rust'
  | 'toml'
  | 'typescript'
  | 'yaml';

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
      langs: [
        import('shiki/dist/langs/css.mjs'),
        import('shiki/dist/langs/go.mjs'),
        import('shiki/dist/langs/html.mjs'),
        import('shiki/dist/langs/javascript.mjs'),
        import('shiki/dist/langs/json.mjs'),
        import('shiki/dist/langs/markdown.mjs'),
        import('shiki/dist/langs/python.mjs'),
        import('shiki/dist/langs/rust.mjs'),
        import('shiki/dist/langs/bash.mjs'),
        import('shiki/dist/langs/toml.mjs'),
        import('shiki/dist/langs/typescript.mjs'),
        import('shiki/dist/langs/yaml.mjs'),
      ],
    });
  }
  return highlighterPromise;
}

export async function codeToHighlightedHtml(code: string, language: PasteLanguage): Promise<string> {
  const mapped = LANGUAGE_MAP[language];
  if (mapped === 'text') return '';
  const highlighter = await getHighlighter();
  return highlighter.codeToHtml(code, {
    lang: mapped,
    theme: 'github-light',
  });
}
