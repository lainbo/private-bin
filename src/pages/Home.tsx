import { toDataURL } from 'qrcode';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Flame,
  LoaderCircle,
  QrCode,
  Send,
  SlidersHorizontal,
} from 'lucide-react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import type { EditorProps } from '@monaco-editor/react';
import type { AuthStatusResponse } from '../shared/api-types';
import {
  DEFAULT_EXPIRATION_ID,
  EXPIRATION_OPTIONS,
  LANGUAGE_OPTIONS,
  MAX_TEXT_BYTES,
  type ExpirationId,
  type PasteLanguage,
} from '../shared/constants';
import { createPaste } from '../lib/api';
import { encryptPasteText } from '../lib/paste-crypto';
import { formatBytes, formatDateTime } from '../lib/time';
import { utf8ByteLength } from '../lib/encoding';
import { useClipboardCopy } from '../lib/clipboard';
import { errorMessage } from '../lib/ui';
import { AuthGate } from '../components/AuthGate';
import { ErrorMessage } from '../components/ErrorMessage';

type CreatedPaste = {
  id: string;
  url: string;
  qrDataUrl: string;
  expiresAt: number;
  burnAfterReading: boolean;
  requiresPassword: boolean;
};

const MonacoEditor = lazy(async () => {
  await import('../lib/monaco');
  const module = await import('@monaco-editor/react');
  return { default: module.default };
});

const MONACO_EDITOR_OPTIONS = {
  automaticLayout: true,
  detectIndentation: true,
  fixedOverflowWidgets: true,
  fontFamily: '"JetBrains Mono","HarmonyOS Sans SC","Cascadia Code","Consolas","Menlo","Twemoji Mozilla","monospace"',
  fontSize: 20,
  hideCursorInOverviewRuler: true,
  minimap: { enabled: false },
  overviewRulerBorder: false,
  padding: { top: 24, bottom: 24 },
  renderLineHighlight: 'line',
  scrollBeyondLastLine: false,
  scrollbar: { useShadows: false },
  tabSize: 2,
  wordWrap: 'on',
} satisfies EditorProps['options'];

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const updateMatches = () => setMatches(media.matches);
    updateMatches();
    media.addEventListener('change', updateMatches);
    return () => media.removeEventListener('change', updateMatches);
  }, [query]);

  return matches;
}

export function Home({
  status,
  refreshAuth,
}: {
  status: AuthStatusResponse;
  refreshAuth: () => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [language, setLanguage] = useState<PasteLanguage>('text');
  const [expirationId, setExpirationId] = useState<ExpirationId>(DEFAULT_EXPIRATION_ID);
  const [burnAfterReading, setBurnAfterReading] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [created, setCreated] = useState<CreatedPaste | null>(null);
  const [message, setMessage] = useState('');
  const { copyState, copy, resetCopyState } = useClipboardCopy();
  const [submitting, setSubmitting] = useState(false);
  const shareCardRef = useRef<HTMLElement | null>(null);
  const textSize = useMemo(() => utf8ByteLength(text), [text]);
  const selectedExpiration = EXPIRATION_OPTIONS.find((option) => option.id === expirationId)!;

  async function submitPaste() {
    if (submitting) return;
    setSubmitting(true);
    setMessage('');
    resetCopyState();
    try {
      const encrypted = await encryptPasteText({
        text,
        password,
        language,
        burnAfterReading,
      });
      const { requiresPassword } = encrypted.crypto.aad;
      const response = await createPaste({
        ciphertext: encrypted.ciphertext,
        crypto: encrypted.crypto,
        expiresInSeconds: selectedExpiration.seconds,
        burnAfterReading,
        requiresPassword,
        textSize: encrypted.textSize,
        language,
      });
      const url = `${window.location.origin}/p/${response.id}#${burnAfterReading ? '-' : ''}${encrypted.key}`;
      const qrDataUrl = await toDataURL(url, {
        margin: 1,
        width: 224,
        errorCorrectionLevel: 'M',
      });
      setCreated({
        id: response.id,
        url,
        qrDataUrl,
        expiresAt: response.expiresAt,
        burnAfterReading,
        requiresPassword,
      });
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submitPaste();
  }

  const updateText = useCallback((value: string | undefined) => {
    setText(value ?? '');
  }, []);
  const updateTextareaText = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    updateText(event.currentTarget.value);
  }, [updateText]);
  const isCompactEditor = useMediaQuery('(max-width: 640px)');
  const editorOptions = useMemo(
    () => ({
      ...MONACO_EDITOR_OPTIONS,
      fontSize: isCompactEditor ? 16 : 20,
    }),
    [isCompactEditor],
  );

  useEffect(() => {
    if (!created) return;
    const frame = window.requestAnimationFrame(() => {
      shareCardRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [created?.id]);

  return (
    <main className={status.authenticated ? 'create-workspace' : 'create-workspace create-workspace--auth'}>
      <section className="create-editor-area">
        {status.authenticated ? (
          <form className="editor-form card" onSubmit={onSubmit}>
            <div className="editor-shell">
              {isCompactEditor ? (
                <textarea
                  className="mobile-editor-textarea"
                  aria-label="粘贴内容"
                  value={text}
                  spellCheck={false}
                  onChange={updateTextareaText}
                />
              ) : (
                <Suspense fallback={<div className="editor-loading">正在加载编辑器...</div>}>
                  <MonacoEditor
                    height="100%"
                    width="100%"
                    language="plaintext"
                    theme="private-bin"
                    value={text}
                    options={editorOptions}
                    loading={<div className="editor-loading">正在加载编辑器...</div>}
                    onChange={updateText}
                  />
                </Suspense>
              )}
            </div>
            <div className="editor-statusbar">
              <span className={textSize > MAX_TEXT_BYTES ? 'byte-count byte-count--over' : 'byte-count'}>
                {formatBytes(textSize)} / {formatBytes(MAX_TEXT_BYTES)}
              </span>
              <button className="btn btn-primary" type="submit" disabled={submitting || textSize === 0}>
                {submitting ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}
                {submitting ? '加密中' : '生成链接'}
              </button>
            </div>
          </form>
        ) : (
          <AuthGate status={status} refresh={refreshAuth} />
        )}
      </section>

      {status.authenticated ? (
        <aside className="create-sidebar">
          <section className="card panel">
            <div className="panel-head">
              <span className="panel-icon">
                <SlidersHorizontal size={15} />
              </span>
              <h2>选项</h2>
            </div>
            <label className="field-group">
              <span className="field-label">过期时间</span>
              <select
                className="field"
                value={expirationId}
                onChange={(event) => setExpirationId(event.target.value as ExpirationId)}
              >
                {EXPIRATION_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-group">
              <span className="field-label">代码高亮</span>
              <select
                className="field"
                value={language}
                onChange={(event) => setLanguage(event.target.value as PasteLanguage)}
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-group">
              <span className="field-label">查看密码</span>
              <span className="relative block">
                <input
                  className="field pr-11"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  placeholder="可留空"
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  className="icon-btn absolute right-[3px] top-1/2 -translate-y-1/2"
                  type="button"
                  title={showPassword ? '隐藏密码' : '显示密码'}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>
            <label className="toggle-row">
              <span className="toggle-row-icon">
                <Flame size={16} />
              </span>
              <span className="toggle-row-text">
                <span className="toggle-row-title">阅后即焚</span>
                <span className="toggle-row-desc">首次打开后立即删除</span>
              </span>
              <input
                className="switch"
                type="checkbox"
                role="switch"
                checked={burnAfterReading}
                onChange={(event) => setBurnAfterReading(event.target.checked)}
              />
            </label>
          </section>

          {message ? <ErrorMessage>{message}</ErrorMessage> : null}

          {created ? (
            <section className="card panel rise-in" key={created.id} ref={shareCardRef}>
              <div className="panel-head">
                <span className="panel-icon">
                  <QrCode size={15} />
                </span>
                <h2>分享</h2>
              </div>
              <div className="qr-frame">
                <img src={created.qrDataUrl} alt="分享二维码" />
              </div>
              <div className="share-url" title={created.url}>
                {created.url}
              </div>
              <button className="btn btn-primary w-full" type="button" onClick={() => copy(created.url)}>
                {copyState === 'copied' ? <Check size={16} /> : <Copy size={16} />}
                {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制链接'}
              </button>
              <dl className="meta-list">
                <div>
                  <dt>过期</dt>
                  <dd>{formatDateTime(created.expiresAt)}</dd>
                </div>
                <div>
                  <dt>密码</dt>
                  <dd>
                    {created.requiresPassword ? (
                      <span className="badge badge--accent">已启用</span>
                    ) : (
                      <span className="badge">未设置</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>阅后即焚</dt>
                  <dd>
                    {created.burnAfterReading ? (
                      <span className="badge badge--warn">已启用</span>
                    ) : (
                      <span className="badge">关闭</span>
                    )}
                  </dd>
                </div>
              </dl>
            </section>
          ) : null}
        </aside>
      ) : null}
    </main>
  );
}
