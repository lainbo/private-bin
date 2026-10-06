import { Check, Copy, Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { HIGHLIGHT_BYTE_LIMIT, LANGUAGE_OPTIONS, type PasteLanguage } from '../shared/constants';
import { utf8ByteLength } from '../lib/encoding';

const DOWNLOAD_EXTENSION_BY_LANGUAGE: Record<PasteLanguage, string> = {
  text: 'txt',
  css: 'css',
  go: 'go',
  html: 'html',
  javascript: 'js',
  json: 'json',
  markdown: 'md',
  python: 'py',
  rust: 'rs',
  shell: 'sh',
  toml: 'toml',
  typescript: 'ts',
  yaml: 'yaml',
};

export function CodeViewer({ id, text, language }: { id: string; text: string; language: PasteLanguage }) {
  const [html, setHtml] = useState('');
  const [highlighting, setHighlighting] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const canHighlight = language !== 'text' && utf8ByteLength(text) <= HIGHLIGHT_BYTE_LIMIT;
  const languageLabel = LANGUAGE_OPTIONS.find((option) => option.id === language)!.label;
  const downloadName = useMemo(() => {
    const extension = DOWNLOAD_EXTENSION_BY_LANGUAGE[language];
    return `private-bin-${id}.${extension}`;
  }, [id, language]);

  useEffect(() => {
    if (!canHighlight) {
      setHtml('');
      return;
    }
    let cancelled = false;
    setHighlighting(true);
    import('../lib/syntax')
      .then((module) => module.codeToHighlightedHtml(text, language))
      .then((result) => {
        if (!cancelled) setHtml(result);
      })
      .catch(() => {
        if (!cancelled) setHtml('');
      })
      .finally(() => {
        if (!cancelled) setHighlighting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canHighlight, language, text]);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  function downloadText() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = downloadName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <section className="card viewer-shell rise-in">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-info">
          <span className="badge badge--accent">{languageLabel}</span>
          {highlighting ? <span>高亮加载中</span> : null}
          {!canHighlight && language !== 'text' ? <span>文本较大，已使用纯文本显示</span> : null}
        </div>
        <div className="viewer-actions">
          <button className="btn btn-ghost btn-sm" type="button" onClick={downloadText}>
            <Download size={15} />
            下载
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={copyText}>
            {copyState === 'copied' ? <Check size={15} /> : <Copy size={15} />}
            {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制内容'}
          </button>
        </div>
      </div>
      {html ? (
        <div
          className="highlighted viewer-code"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="viewer-code-plain">
          {text}
        </pre>
      )}
    </section>
  );
}
