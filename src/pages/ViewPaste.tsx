import { Clock, Flame, KeyRound, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { PasteResponse } from '../shared/api-types';
import { consumePaste, getPaste } from '../lib/api';
import { decryptPasteText, parsePasteHash } from '../lib/paste-crypto';
import { formatRelativeSeconds } from '../lib/time';
import { errorMessage } from '../lib/ui';
import { CenteredNotice } from '../components/CenteredNotice';
import { CodeViewer } from '../components/CodeViewer';
import { ErrorMessage } from '../components/ErrorMessage';

export function ViewPaste({ id }: { id: string }) {
  const hashInfo = useMemo(() => {
    try {
      return parsePasteHash(window.location.hash);
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }, []);
  const [confirmed, setConfirmed] = useState(!('requiresLoadConfirmation' in hashInfo) || !hashInfo.requiresLoadConfirmation);
  const [paste, setPaste] = useState<PasteResponse | null>(null);
  const [plainText, setPlainText] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [decrypting, setDecrypting] = useState(false);

  const needsPassword = paste?.requiresPassword && !plainText;

  useEffect(() => {
    if (!confirmed || !('key' in hashInfo)) return;
    const pasteKey = hashInfo.key;
    const shouldConsume = hashInfo.requiresLoadConfirmation;
    let cancelled = false;
    async function loadPaste() {
      setLoading(true);
      setMessage('');
      try {
        const response = shouldConsume ? await consumePaste(id) : await getPaste(id);
        if (cancelled) return;
        setPaste(response);
        if (!response.requiresPassword) {
          const text = await decryptPasteText({
            ciphertext: response.ciphertext,
            crypto: response.crypto,
            key: pasteKey,
            password: '',
          }).catch(() => {
            throw new Error('无法解密。请确认链接是否完整。');
          });
          if (!cancelled) setPlainText(text);
        }
      } catch (error) {
        if (!cancelled) setMessage(errorMessage(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadPaste();
    return () => {
      cancelled = true;
    };
  }, [confirmed, hashInfo, id]);

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (decrypting || !paste || !('key' in hashInfo)) return;
    setDecrypting(true);
    setMessage('');
    try {
      const text = await decryptPasteText({
        ciphertext: paste.ciphertext,
        crypto: paste.crypto,
        key: hashInfo.key,
        password,
      });
      setPlainText(text);
    } catch {
      setMessage('无法解密。请确认密码是否正确。');
    } finally {
      setDecrypting(false);
    }
  }

  if ('error' in hashInfo) {
    return <CenteredNotice title="链接不完整" message={hashInfo.error} />;
  }

  if (!confirmed) {
    return (
      <CenteredNotice
        title="这是阅后即焚 Paste"
        message="打开后服务端会立即删除它，即使尚未解密。刷新、关闭页面或网络中断可能导致内容永久丢失。确认周围环境安全后再继续。"
      >
        <button className="btn btn-primary btn-lg w-full" type="button" onClick={() => setConfirmed(true)}>
          <Flame size={17} />
          现在打开
        </button>
      </CenteredNotice>
    );
  }

  return (
    <main className="paste-view-shell">
      {paste ? (
        <dl className="paste-meta-strip" aria-label="Paste 信息">
          <div>
            <dt>
              <Clock size={14} />
              剩余
            </dt>
            <dd>{formatRelativeSeconds(paste.timeToLiveSeconds)}</dd>
          </div>
          <div>
            <dt>
              <KeyRound size={14} />
              密码
            </dt>
            <dd>{paste.requiresPassword ? '需要' : '无'}</dd>
          </div>
          <div className={paste.burnAfterReading ? 'is-warn' : undefined}>
            <dt>
              <Flame size={14} />
              阅后即焚
            </dt>
            <dd>{paste.burnAfterReading ? '是' : '否'}</dd>
          </div>
        </dl>
      ) : null}
      {message && !needsPassword ? <ErrorMessage>{message}</ErrorMessage> : null}
      {loading ? (
        <p className="paste-inline-state">
          <LoaderCircle size={16} className="spin" />
          正在读取密文...
        </p>
      ) : null}
      {needsPassword ? (
        <form className="card auth-card paste-password-panel rise-in" onSubmit={submitPassword}>
          <div className="auth-head">
            <span className="icon-badge">
              <KeyRound size={20} />
            </span>
            <h2>需要查看密码</h2>
          </div>
          <input
            className="field"
            autoFocus
            type="password"
            value={password}
            placeholder="输入创建者另行告知的密码"
            onChange={(event) => setPassword(event.target.value)}
          />
          {message ? <ErrorMessage>{message}</ErrorMessage> : null}
          <button className="btn btn-primary btn-lg w-full" type="submit" disabled={!password || decrypting}>
            {decrypting ? <LoaderCircle size={16} className="spin" /> : null}
            {decrypting ? '解密中' : '解密'}
          </button>
        </form>
      ) : null}
      {plainText && paste ? <CodeViewer id={id} text={plainText} language={paste.language} /> : null}
    </main>
  );
}
