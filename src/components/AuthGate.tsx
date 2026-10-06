import { KeyRound, UserRound } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { AuthStatusResponse } from '../shared/api-types';
import { loginWithPasskey, passkeysSupported, registerWithPasskey } from '../lib/passkey';
import { errorMessage } from '../lib/ui';
import { ErrorMessage } from './ErrorMessage';

export function AuthGate({
  status,
  refresh,
  title = '登录 Private Bin',
  description = '使用 passkey 登录后即可创建加密分享',
  closedMessage = '注册目前关闭。已注册用户可以继续登录创建。',
}: {
  status: AuthStatusResponse;
  refresh: () => Promise<void>;
  title?: string;
  description?: string;
  closedMessage?: string;
}) {
  const [displayName, setDisplayName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const supported = passkeysSupported();

  async function submitLogin() {
    setBusy(true);
    setMessage('');
    try {
      await loginWithPasskey();
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitRegister(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await registerWithPasskey(displayName);
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card auth-card rise-in">
      <div className="auth-head">
        <span className="icon-badge">
          <KeyRound size={20} />
        </span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {!supported ? (
        <ErrorMessage>当前浏览器不支持 WebAuthn/passkey。请换用支持 passkey 的浏览器或启用 Bitwarden 扩展。</ErrorMessage>
      ) : null}
      <button className="btn btn-primary btn-lg w-full" type="button" disabled={!supported || busy} onClick={submitLogin}>
        <KeyRound size={17} />
        使用 passkey 登录
      </button>
      {status.registrationOpen ? (
        <form className="grid gap-4" onSubmit={submitRegister}>
          <div className="auth-divider">或</div>
          <label className="field-group">
            <span className="field-label">注册名称</span>
            <input
              className="field"
              value={displayName}
              maxLength={64}
              placeholder="例如 Owen"
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <button
            className="btn btn-secondary btn-lg w-full"
            type="submit"
            disabled={!supported || busy || !displayName.trim()}
          >
            <UserRound size={17} />
            注册新的 passkey
          </button>
        </form>
      ) : (
        <p className="auth-note">{closedMessage}</p>
      )}
      {message ? <ErrorMessage>{message}</ErrorMessage> : null}
    </section>
  );
}
