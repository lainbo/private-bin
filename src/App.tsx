import { toDataURL } from 'qrcode';
import {
  AlertTriangle,
  Check,
  CircleAlert,
  Clock,
  Copy,
  Download,
  Eye,
  EyeOff,
  Flame,
  KeyRound,
  LoaderCircle,
  LogOut,
  Pencil,
  Trash2,
  QrCode,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  UsersRound,
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
import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import type { EditorProps } from '@monaco-editor/react';
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
  consumePaste,
  deleteAdminUser,
  forceLogoutAdminUser,
  getAdminUsers,
  getAuthStatus,
  getPaste,
  setUserDisabled,
  updateAdminUser,
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

type Route = { name: 'home' } | { name: 'admin' } | { name: 'paste'; id: string };

type CreatedPaste = {
  id: string;
  url: string;
  qrDataUrl: string;
  expiresAt: number;
  burnAfterReading: boolean;
  requiresPassword: boolean;
};

const MonacoEditor = lazy(async () => {
  await import('./lib/monaco');
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

function currentRoute(): Route {
  if (window.location.pathname === '/admin') return { name: 'admin' };
  const match = window.location.pathname.match(/^\/p\/([a-z0-9]{16})$/u);
  if (match) return { name: 'paste', id: match[1] };
  return { name: 'home' };
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return '操作失败。';
}

function initialOf(name: string): string {
  return (Array.from(name.trim())[0] ?? '?').toUpperCase();
}

function ErrorMessage({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`alert ${className}`} role="alert">
      <CircleAlert size={16} />
      <span>{children}</span>
    </p>
  );
}

function AuthGate({
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

function TopBar({
  status,
  refresh,
  setRoute,
}: {
  status: AuthStatusResponse | null;
  refresh: () => Promise<void>;
  setRoute: (route: Route) => void;
}) {
  async function submitLogout() {
    await logout();
    await refresh();
  }

  function navigateTo(routePath: string, nextRoute: Route) {
    if (window.location.pathname !== routePath || window.location.search || window.location.hash) {
      history.pushState({}, '', routePath);
    }
    setRoute(nextRoute);
  }

  function goHome() {
    navigateTo('/', { name: 'home' });
  }

  return (
    <header className="topbar">
      <button className="brand" type="button" onClick={goHome}>
        <span className="brand-mark">
          <ShieldCheck size={16} strokeWidth={2.25} />
        </span>
        <span>Private Bin</span>
      </button>
      <nav className="flex items-center gap-1.5" aria-label="主要操作">
        {status?.authenticated && status.user ? (
          <>
            <span className="user-chip" title={status.user.role === 'admin' ? '管理员' : '普通用户'}>
              <span className="avatar">{initialOf(status.user.displayName)}</span>
              <span className="hidden max-w-40 truncate sm:inline">{status.user.displayName}</span>
            </span>
            <button className="icon-btn" type="button" title="退出登录" onClick={submitLogout}>
              <LogOut size={17} />
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
  const [submitting, setSubmitting] = useState(false);
  const shareCardRef = useRef<HTMLElement | null>(null);
  const textSize = useMemo(() => utf8ByteLength(text), [text]);
  const selectedExpiration = EXPIRATION_OPTIONS.find((option) => option.id === expirationId) ?? EXPIRATION_OPTIONS[4];

  async function submitPaste() {
    if (submitting) return;
    setSubmitting(true);
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
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submitPaste();
  }

  async function copyLink() {
    if (!created) return;
    await navigator.clipboard.writeText(created.url);
    setCopied(true);
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
              <button className="btn btn-primary w-full" type="button" onClick={copyLink}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? '已复制' : '复制链接'}
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

function AdminPage({
  status,
  refreshAuth,
}: {
  status: AuthStatusResponse;
  refreshAuth: () => Promise<void>;
}) {
  if (!status.authenticated || !status.user) {
    return (
      <main className="admin-page admin-page--centered">
        <AuthGate
          status={status}
          refresh={refreshAuth}
          title="登录管理后台"
          description="仅管理员可以管理用户"
          closedMessage="注册目前关闭。已注册管理员可以继续登录管理。"
        />
      </main>
    );
  }

  if (status.user.role !== 'admin') {
    return <CenteredNotice title="没有权限" message="只有管理员可以访问用户管理。" />;
  }

  return (
    <main className="admin-page">
      <section className="admin-shell">
        <div className="admin-header">
          <span className="panel-icon">
            <UsersRound size={16} />
          </span>
          <h1>用户管理</h1>
        </div>
        <AdminPanel currentUser={status.user} refreshAuth={refreshAuth} />
      </section>
    </main>
  );
}

function AdminPanel({
  currentUser,
  refreshAuth,
}: {
  currentUser: ApiUser;
  refreshAuth: () => Promise<void>;
}) {
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const activeAdminCount = users.filter((user) => user.role === 'admin' && !user.disabled).length;

  const loadUsers = useCallback(async () => {
    setMessage('');
    setLoading(true);
    try {
      const response = await getAdminUsers();
      setUsers(response.users);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  async function toggleUser(user: ApiUser) {
    setMessage('');
    try {
      await setUserDisabled(user.id, !user.disabled);
      await loadUsers();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function renameUser(user: ApiUser, displayName: string) {
    setMessage('');
    try {
      await updateAdminUser(user.id, { displayName });
      await loadUsers();
      if (user.id === currentUser.id) await refreshAuth();
    } catch (error) {
      setMessage(errorMessage(error));
      throw error;
    }
  }

  async function forceLogoutUser(user: ApiUser) {
    setMessage('');
    try {
      await forceLogoutAdminUser(user.id);
      if (user.id === currentUser.id) {
        await refreshAuth();
        return;
      }
      await loadUsers();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function removeUser(user: ApiUser, confirmDisplayName: string) {
    setMessage('');
    try {
      await deleteAdminUser(user.id, { confirmDisplayName });
      if (user.id === currentUser.id) {
        await refreshAuth();
        return;
      }
      await loadUsers();
    } catch (error) {
      setMessage(errorMessage(error));
      throw error;
    }
  }

  return (
    <section className="card admin-panel">
      {loading ? (
        <p className="admin-panel-state">正在读取用户...</p>
      ) : null}
      <div className="admin-user-list">
        {users.map((user) => (
          <AdminUserRow
            key={user.id}
            user={user}
            isCurrentUser={user.id === currentUser.id}
            isLastActiveAdmin={user.role === 'admin' && !user.disabled && activeAdminCount <= 1}
            onToggleDisabled={toggleUser}
            onRename={renameUser}
            onForceLogout={forceLogoutUser}
            onDelete={removeUser}
          />
        ))}
      </div>
      {!loading && users.length === 0 && !message ? (
        <p className="admin-panel-state">暂无用户。</p>
      ) : null}
      {message ? <ErrorMessage>{message}</ErrorMessage> : null}
    </section>
  );
}

function AdminUserRow({
  user,
  isCurrentUser,
  isLastActiveAdmin,
  onToggleDisabled,
  onRename,
  onForceLogout,
  onDelete,
}: {
  user: ApiUser;
  isCurrentUser: boolean;
  isLastActiveAdmin: boolean;
  onToggleDisabled: (user: ApiUser) => Promise<void>;
  onRename: (user: ApiUser, displayName: string) => Promise<void>;
  onForceLogout: (user: ApiUser) => Promise<void>;
  onDelete: (user: ApiUser, confirmDisplayName: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [nextName, setNextName] = useState(user.displayName);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNextName(user.displayName);
  }, [user.displayName]);

  async function submitRename(event: FormEvent) {
    event.preventDefault();
    const displayName = nextName.trim();
    if (!displayName || displayName === user.displayName) {
      setEditing(false);
      setNextName(user.displayName);
      return;
    }
    setBusy(true);
    try {
      await onRename(user, displayName);
      setEditing(false);
    } catch {
      // 父组件已经展示错误信息，这里只保持编辑态方便修正。
    } finally {
      setBusy(false);
    }
  }

  async function submitDelete(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onDelete(user, deleteConfirmation);
      setConfirmingDelete(false);
      setDeleteConfirmation('');
    } catch {
      // 父组件已经展示错误信息，这里保留输入，避免用户重输。
    } finally {
      setBusy(false);
    }
  }

  async function submitForceLogout() {
    setBusy(true);
    try {
      await onForceLogout(user);
    } finally {
      setBusy(false);
    }
  }

  const canDelete = !isLastActiveAdmin;
  const canDisable = !isCurrentUser && !(user.role === 'admin' && !user.disabled && isLastActiveAdmin);

  return (
    <div className="admin-user-row">
      <div className="admin-user-main">
        {editing ? (
          <form className="admin-inline-form" onSubmit={submitRename}>
            <input
              className="field admin-inline-input"
              value={nextName}
              maxLength={64}
              autoFocus
              onChange={(event) => setNextName(event.target.value)}
            />
            <div className="admin-inline-actions">
              <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>
                保存
              </button>
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setNextName(user.displayName);
                }}
              >
                取消
              </button>
            </div>
          </form>
        ) : (
          <span className="admin-user-identity">
            <span className="avatar avatar--lg">{initialOf(user.displayName)}</span>
            <span className="grid min-w-0">
              <strong>{user.displayName}</strong>
              <span className="admin-user-tags">
                {user.role === 'admin' ? (
                  <span className="badge badge--accent">管理员</span>
                ) : (
                  <span className="badge">用户</span>
                )}
                {user.disabled ? <span className="badge badge--danger">已停用</span> : null}
                {isCurrentUser ? <span className="badge">当前登录</span> : null}
              </span>
            </span>
          </span>
        )}
        {confirmingDelete ? (
          <form className="admin-delete-confirm" onSubmit={submitDelete}>
            <label className="field-group">
              <span className="field-label">输入用户名确认删除</span>
              <input
                className="field admin-inline-input"
                value={deleteConfirmation}
                autoFocus
                onChange={(event) => setDeleteConfirmation(event.target.value)}
              />
            </label>
            <div className="admin-inline-actions">
              <button
                className="btn btn-danger btn-sm"
                type="submit"
                disabled={busy || deleteConfirmation !== user.displayName}
              >
                删除用户
              </button>
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirmingDelete(false);
                  setDeleteConfirmation('');
                }}
              >
                取消
              </button>
            </div>
          </form>
        ) : null}
      </div>
      <div className="admin-row-actions">
        <button
          className="icon-btn icon-btn--bordered"
          type="button"
          title="修改用户名"
          disabled={busy || editing}
          onClick={() => {
            setEditing(true);
            setConfirmingDelete(false);
          }}
        >
          <Pencil size={15} />
        </button>
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          disabled={busy || !canDisable}
          title={canDisable ? undefined : '不能停用当前用户或最后一个管理员'}
          onClick={() => onToggleDisabled(user)}
        >
          {user.disabled ? '启用' : '停用'}
        </button>
        <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={submitForceLogout}>
          强退
        </button>
        <button
          className="icon-btn icon-btn--bordered icon-btn--danger"
          type="button"
          title={canDelete ? '删除用户' : '不能删除最后一个管理员'}
          disabled={busy || !canDelete}
          onClick={() => {
            setConfirmingDelete(true);
            setEditing(false);
          }}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
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

function CodeViewer({ id, text, language }: { id: string; text: string; language: PasteLanguage }) {
  const [html, setHtml] = useState('');
  const [highlighting, setHighlighting] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const canHighlight = language !== 'text' && utf8ByteLength(text) <= HIGHLIGHT_BYTE_LIMIT;
  const languageLabel = LANGUAGE_OPTIONS.find((option) => option.id === language)?.label ?? '纯文本';
  const downloadName = useMemo(() => {
    const extension = DOWNLOAD_EXTENSION_BY_LANGUAGE[language] ?? 'txt';
    return `private-bin-${id}.${extension}`;
  }, [id, language]);

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
    <main className="notice-page">
      <section className="card notice-card rise-in">
        <div className="auth-head">
          <span className="icon-badge icon-badge--warn">
            <AlertTriangle size={20} />
          </span>
          <h1>{title}</h1>
          <p>{message}</p>
        </div>
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
    <div className={route.name === 'paste' ? 'app-shell app-shell--paste' : 'app-shell'}>
      <TopBar status={status} refresh={refreshAuth} setRoute={setRoute} />
      {message ? <ErrorMessage className="mx-4 mt-4 sm:mx-6">{message}</ErrorMessage> : null}
      {route.name === 'paste' ? (
        <ViewPaste id={route.id} />
      ) : route.name === 'admin' && status ? (
        <AdminPage status={status} refreshAuth={refreshAuth} />
      ) : status ? (
        <Home status={status} refreshAuth={refreshAuth} />
      ) : (
        <main className="page-loading">
          <LoaderCircle className="spin" size={24} />
        </main>
      )}
    </div>
  );
}
