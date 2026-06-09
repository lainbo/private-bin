import { toDataURL } from 'qrcode';
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Flame,
  KeyRound,
  LogOut,
  QrCode,
  RefreshCcw,
  Send,
  ShieldCheck,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import type { ApiUser, AuthStatusResponse, PasteResponse } from './shared/api-types';
import {
  DEFAULT_EXPIRATION_ID,
  EXPIRATION_OPTIONS,
  HIGHLIGHT_BYTE_LIMIT,
  LANGUAGE_OPTIONS,
  MAX_TEXT_BYTES,
  type ExpirationId,
  type PasteLanguage,
} from './shared/constants';
import {
  createPaste,
  getAdminUsers,
  getAuthStatus,
  getPaste,
  setUserDisabled,
} from './lib/api';
import { ApiError } from './lib/http';
import {
  decryptPasteText,
  encryptPasteText,
  parsePasteHash,
  validateTextSize,
} from './lib/paste-crypto';
import { loginWithPasskey, logout, passkeysSupported, registerWithPasskey } from './lib/passkey';
import { formatBytes, formatDateTime, formatRelativeSeconds } from './lib/time';
import { utf8ByteLength } from './lib/encoding';

type Route = { name: 'home' } | { name: 'paste'; id: string };

type CreatedPaste = {
  id: string;
  url: string;
  qrDataUrl: string;
  expiresAt: number;
  burnAfterReading: boolean;
  requiresPassword: boolean;
};

function currentRoute(): Route {
  const match = window.location.pathname.match(/^\/p\/([a-z0-9]{16})$/u);
  if (match) return { name: 'paste', id: match[1] };
  return { name: 'home' };
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return '操作失败。';
}

function AuthGate({
  status,
  refresh,
}: {
  status: AuthStatusResponse;
  refresh: () => Promise<void>;
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
    <section className="auth-panel panel">
      <div className="panel-heading">
        <KeyRound size={18} />
        <h2>创建需要 passkey</h2>
      </div>
      {!supported ? (
        <p className="notice danger">
          当前浏览器不支持 WebAuthn/passkey。请换用支持 passkey 的浏览器或启用 Bitwarden
          扩展。
        </p>
      ) : null}
      <button className="button primary" type="button" disabled={!supported || busy} onClick={submitLogin}>
        <KeyRound size={18} />
        使用 passkey 登录
      </button>
      {status.registrationOpen ? (
        <form className="register-form" onSubmit={submitRegister}>
          <label>
            注册名称
            <input
              value={displayName}
              maxLength={64}
              placeholder="例如 Owen"
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <button className="button secondary" type="submit" disabled={!supported || busy || !displayName.trim()}>
            <UserRound size={18} />
            注册新的 passkey
          </button>
        </form>
      ) : (
        <p className="notice">注册目前关闭。已注册用户可以继续登录创建。</p>
      )}
      {message ? <p className="notice danger">{message}</p> : null}
    </section>
  );
}

function TopBar({
  status,
  refresh,
  route,
  setRoute,
}: {
  status: AuthStatusResponse | null;
  refresh: () => Promise<void>;
  route: Route;
  setRoute: (route: Route) => void;
}) {
  async function submitLogout() {
    await logout();
    await refresh();
  }

  function goHome() {
    history.pushState({}, '', '/');
    setRoute({ name: 'home' });
  }

  return (
    <header className="topbar">
      <button className="brand" type="button" onClick={goHome}>
        <ShieldCheck size={22} />
        <span>Private Bin</span>
      </button>
      <nav className="top-actions" aria-label="主要操作">
        {route.name === 'paste' ? (
          <button className="button ghost" type="button" onClick={goHome}>
            新建
          </button>
        ) : null}
        {status?.authenticated && status.user ? (
          <>
            <span className="user-pill" title={status.user.role === 'admin' ? '管理员' : '普通用户'}>
              <UserRound size={15} />
              {status.user.displayName}
            </span>
            <button className="icon-button" type="button" title="退出登录" onClick={submitLogout}>
              <LogOut size={18} />
            </button>
          </>
        ) : null}
      </nav>
    </header>
  );
}

function Home({
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
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const textSize = useMemo(() => utf8ByteLength(text), [text]);
  const selectedExpiration = EXPIRATION_OPTIONS.find((option) => option.id === expirationId) ?? EXPIRATION_OPTIONS[4];

  async function submitPaste() {
    setMessage('');
    setCopied(false);
    try {
      validateTextSize(text);
      const encrypted = await encryptPasteText({
        text,
        password,
        language,
        burnAfterReading,
      });
      const response = await createPaste({
        ciphertext: encrypted.ciphertext,
        crypto: encrypted.crypto,
        expiresInSeconds: selectedExpiration.seconds,
        burnAfterReading,
        requiresPassword: password.length > 0,
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
        requiresPassword: password.length > 0,
      });
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    startTransition(() => {
      void submitPaste();
    });
  }

  async function copyLink() {
    if (!created) return;
    await navigator.clipboard.writeText(created.url);
    setCopied(true);
  }

  return (
    <main className="workspace">
      <section className="editor-area">
        <div className="headline">
          <p>零知识纯文字传输</p>
          <h1>写下内容，加密后分享。</h1>
        </div>
        {status.authenticated ? (
          <form className="composer" onSubmit={onSubmit}>
            <textarea
              value={text}
              spellCheck={false}
              placeholder="粘贴文字、日志、代码片段..."
              onChange={(event) => setText(event.target.value)}
            />
            <div className="composer-footer">
              <span className={textSize > MAX_TEXT_BYTES ? 'size over' : 'size'}>
                {formatBytes(textSize)} / {formatBytes(MAX_TEXT_BYTES)}
              </span>
              <button className="button primary" type="submit" disabled={isPending || textSize === 0}>
                <Send size={18} />
                {isPending ? '加密中' : '生成链接'}
              </button>
            </div>
          </form>
        ) : (
          <AuthGate status={status} refresh={refreshAuth} />
        )}
      </section>

      {status.authenticated ? (
        <aside className="control-area">
          <section className="panel controls-panel">
            <div className="panel-heading">
              <Clock size={18} />
              <h2>选项</h2>
            </div>
            <label>
              过期时间
              <select value={expirationId} onChange={(event) => setExpirationId(event.target.value as ExpirationId)}>
                {EXPIRATION_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              代码高亮
              <select value={language} onChange={(event) => setLanguage(event.target.value as PasteLanguage)}>
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="password-field">
              查看密码
              <span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  placeholder="可留空"
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  className="icon-button"
                  type="button"
                  title={showPassword ? '隐藏密码' : '显示密码'}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={burnAfterReading}
                onChange={(event) => setBurnAfterReading(event.target.checked)}
              />
              <span>
                <Flame size={17} />
                阅后即焚
              </span>
            </label>
          </section>

          {message ? <p className="notice danger">{message}</p> : null}

          {created ? (
            <section className="panel result-panel">
              <div className="panel-heading">
                <QrCode size={18} />
                <h2>分享</h2>
              </div>
              <img className="qr" src={created.qrDataUrl} alt="分享二维码" />
              <div className="link-box">{created.url}</div>
              <button className="button secondary" type="button" onClick={copyLink}>
                {copied ? <Check size={18} /> : <Copy size={18} />}
                {copied ? '已复制' : '复制链接'}
              </button>
              <dl className="facts">
                <div>
                  <dt>过期</dt>
                  <dd>{formatDateTime(created.expiresAt)}</dd>
                </div>
                <div>
                  <dt>密码</dt>
                  <dd>{created.requiresPassword ? '已启用' : '未设置'}</dd>
                </div>
                <div>
                  <dt>阅后即焚</dt>
                  <dd>{created.burnAfterReading ? '已启用' : '关闭'}</dd>
                </div>
              </dl>
            </section>
          ) : null}

          {status.user?.role === 'admin' ? <AdminPanel currentUser={status.user} /> : null}
        </aside>
      ) : null}
    </main>
  );
}

function AdminPanel({ currentUser }: { currentUser: ApiUser }) {
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');

  const loadUsers = useCallback(async () => {
    setMessage('');
    try {
      const response = await getAdminUsers();
      setUsers(response.users);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    if (open) void loadUsers();
  }, [loadUsers, open]);

  async function toggleUser(user: ApiUser) {
    setMessage('');
    try {
      await setUserDisabled(user.id, !user.disabled);
      await loadUsers();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  return (
    <section className="panel admin-panel">
      <button className="section-toggle" type="button" onClick={() => setOpen((value) => !value)}>
        <UsersRound size={18} />
        用户管理
      </button>
      {open ? (
        <div className="user-list">
          {users.map((user) => (
            <div className="user-row" key={user.id}>
              <span>
                <strong>{user.displayName}</strong>
                <small>{user.role === 'admin' ? '管理员' : '用户'}</small>
              </span>
              <button
                className="button compact"
                type="button"
                disabled={user.id === currentUser.id}
                onClick={() => toggleUser(user)}
              >
                {user.disabled ? '启用' : '停用'}
              </button>
            </div>
          ))}
          {message ? <p className="notice danger">{message}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function ViewPaste({ id }: { id: string }) {
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

  const needsPassword = paste?.requiresPassword && !plainText;

  useEffect(() => {
    const key = 'key' in hashInfo ? hashInfo.key : null;
    if (!confirmed || !key) return;
    const pasteKey = key;
    let cancelled = false;
    async function loadPaste() {
      setLoading(true);
      setMessage('');
      try {
        const response = await getPaste(id);
        if (cancelled) return;
        setPaste(response);
        if (!response.requiresPassword) {
          const text = await decryptPasteText({
            ciphertext: response.ciphertext,
            crypto: response.crypto,
            key: pasteKey,
            password: '',
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
    if (!paste || !('key' in hashInfo)) return;
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
    }
  }

  if ('error' in hashInfo) {
    return <CenteredNotice title="链接不完整" message={hashInfo.error} />;
  }

  if (!confirmed) {
    return (
      <CenteredNotice
        title="这是阅后即焚 Paste"
        message="打开后服务端会立即删除它。确认周围环境安全后再继续。"
      >
        <button className="button primary" type="button" onClick={() => setConfirmed(true)}>
          <Flame size={18} />
          现在打开
        </button>
      </CenteredNotice>
    );
  }

  return (
    <main className="reader">
      <section className="reader-head">
        <div>
          <p>Paste</p>
          <h1>{id}</h1>
        </div>
        {paste ? (
          <dl className="reader-meta">
            <div>
              <dt>剩余</dt>
              <dd>{formatRelativeSeconds(paste.timeToLiveSeconds)}</dd>
            </div>
            <div>
              <dt>密码</dt>
              <dd>{paste.requiresPassword ? '需要' : '无'}</dd>
            </div>
            <div>
              <dt>阅后即焚</dt>
              <dd>{paste.burnAfterReading ? '是' : '否'}</dd>
            </div>
          </dl>
        ) : null}
      </section>
      {loading ? <p className="notice">正在读取密文...</p> : null}
      {needsPassword ? (
        <form className="panel password-prompt" onSubmit={submitPassword}>
          <div className="panel-heading">
            <KeyRound size={18} />
            <h2>需要查看密码</h2>
          </div>
          <input
            autoFocus
            type="password"
            value={password}
            placeholder="输入创建者另行告知的密码"
            onChange={(event) => setPassword(event.target.value)}
          />
          <button className="button primary" type="submit" disabled={!password}>
            解密
          </button>
        </form>
      ) : null}
      {message ? (
        <p className="notice danger">
          <AlertTriangle size={18} />
          {message}
        </p>
      ) : null}
      {plainText && paste ? <CodeViewer text={plainText} language={paste.language} /> : null}
    </main>
  );
}

function CodeViewer({ text, language }: { text: string; language: PasteLanguage }) {
  const [html, setHtml] = useState('');
  const [highlighting, setHighlighting] = useState(false);
  const canHighlight = language !== 'text' && utf8ByteLength(text) <= HIGHLIGHT_BYTE_LIMIT;

  useEffect(() => {
    if (!canHighlight) {
      setHtml('');
      return;
    }
    let cancelled = false;
    setHighlighting(true);
    import('./lib/syntax')
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

  return (
    <section className="viewer">
      <div className="viewer-toolbar">
        <span>{LANGUAGE_OPTIONS.find((option) => option.id === language)?.label ?? '纯文本'}</span>
        {highlighting ? <span>高亮加载中</span> : null}
        {!canHighlight && language !== 'text' ? <span>文本较大，已使用纯文本显示</span> : null}
      </div>
      {html ? (
        <div className="highlighted" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="plain-text">{text}</pre>
      )}
    </section>
  );
}

function CenteredNotice({
  title,
  message,
  children,
}: {
  title: string;
  message: string;
  children?: ReactNode;
}) {
  return (
    <main className="centered">
      <section className="panel centered-panel">
        <div className="panel-heading">
          <AlertTriangle size={18} />
          <h1>{title}</h1>
        </div>
        <p>{message}</p>
        {children}
      </section>
    </main>
  );
}

export default function App() {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [status, setStatus] = useState<AuthStatusResponse | null>(null);
  const [message, setMessage] = useState('');

  const refreshAuth = useCallback(async () => {
    try {
      const next = await getAuthStatus();
      setStatus(next);
      setMessage('');
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    void refreshAuth();
    const onPopState = () => setRoute(currentRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [refreshAuth]);

  return (
    <>
      <TopBar status={status} refresh={refreshAuth} route={route} setRoute={setRoute} />
      {message ? <p className="global-error">{message}</p> : null}
      {route.name === 'paste' ? (
        <ViewPaste id={route.id} />
      ) : status ? (
        <Home status={status} refreshAuth={refreshAuth} />
      ) : (
        <main className="centered">
          <RefreshCcw className="spin" size={24} />
        </main>
      )}
    </>
  );
}
