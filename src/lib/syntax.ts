import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import type { PasteLanguage } from '../shared/constants';

type SupportedLanguage =
  | 'javascript'
  | 'typescript'
  | 'json'
  | 'markdown'
  | 'yaml'
  | 'css'
  | 'html'
  | 'bash'
  | 'python'
  | 'go'
  | 'rust';

let highlighterPromise: Promise<HighlighterCore> | null = null;

const LANGUAGE_MAP: Record<PasteLanguage, SupportedLanguage | 'text'> = {
  text: 'text',
  javascript: 'javascript',
  typescript: 'typescript',
  json: 'json',
  markdown: 'markdown',
  yaml: 'yaml',
  css: 'css',
  html: 'html',
  shell: 'bash',
  python: 'python',
  go: 'go',
  rust: 'rust',
};

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      engine: createJavaScriptRegexEngine(),
      themes: [import('shiki/dist/themes/github-light.mjs')],
      langs: [
        import('shiki/dist/langs/javascript.mjs'),
        import('shiki/dist/langs/typescript.mjs'),
        import('shiki/dist/langs/json.mjs'),
        import('shiki/dist/langs/markdown.mjs'),
        import('shiki/dist/langs/yaml.mjs'),
        import('shiki/dist/langs/css.mjs'),
        import('shiki/dist/langs/html.mjs'),
        import('shiki/dist/langs/bash.mjs'),
        import('shiki/dist/langs/python.mjs'),
        import('shiki/dist/langs/go.mjs'),
        import('shiki/dist/langs/rust.mjs'),
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
