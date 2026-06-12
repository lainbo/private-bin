import { toDataURL } from 'qrcode';
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  Download,
  Eye,
  EyeOff,
  Flame,
  KeyRound,
  LogOut,
  Pencil,
  Trash2,
  QrCode,
  RefreshCcw,
  Send,
  ShieldCheck,
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
  useTransition,
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
  minimap: { enabled: false },
  padding: { top: 24, bottom: 24 },
  renderLineHighlight: 'line',
  scrollBeyondLastLine: false,
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

function AuthGate({
  status,
  refresh,
  title = '创建需要 passkey',
  closedMessage = '注册目前关闭。已注册用户可以继续登录创建。',
}: {
  status: AuthStatusResponse;
  refresh: () => Promise<void>;
  title?: string;
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
    <section className="card p-6 sm:p-7 grid gap-4">
      <div className="flex items-center gap-2.5">
        <KeyRound size={18} className="text-primary" />
        <h2 className="text-[21px] font-semibold tracking-[-0.2px]">{title}</h2>
      </div>
      {!supported ? (
        <p className="rounded-md bg-[color-mix(in_srgb,#b84a3b_8%,white)] px-3 py-2.5 text-[14px] text-[#b84a3b]">
          当前浏览器不支持 WebAuthn/passkey。请换用支持 passkey 的浏览器或启用 Bitwarden 扩展。
        </p>
      ) : null}
      <button className="btn-pill w-full" type="button" disabled={!supported || busy} onClick={submitLogin}>
        <KeyRound size={18} />
        使用 passkey 登录
      </button>
      {status.registrationOpen ? (
        <form className="grid gap-3 border-t border-divider-soft pt-4" onSubmit={submitRegister}>
          <label className="grid gap-1.5 text-[13px] font-semibold text-ink-48">
            注册名称
            <input
              className="field"
              value={displayName}
              maxLength={64}
              placeholder="例如 Owen"
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <button
            className="btn-ghost w-full"
            type="submit"
            disabled={!supported || busy || !displayName.trim()}
          >
            <UserRound size={18} />
            注册新的 passkey
          </button>
        </form>
      ) : (
        <p className="text-[14px] text-ink-48">{closedMessage}</p>
      )}
      {message ? (
        <p className="rounded-md bg-[color-mix(in_srgb,#b84a3b_8%,white)] px-3 py-2.5 text-[14px] text-[#b84a3b]">
          {message}
        </p>
      ) : null}
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
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-hairline bg-[color-mix(in_srgb,var(--color-parchment)_82%,transparent)] px-4 py-3 backdrop-blur-xl backdrop-saturate-150 sm:px-8">
      <button
        className="inline-flex items-center gap-2 bg-transparent text-[17px] font-semibold tracking-[-0.3px] cursor-pointer"
        type="button"
        onClick={goHome}
      >
        <ShieldCheck size={20} className="text-primary" />
        <span>Private Bin</span>
      </button>
      <nav className="flex items-center gap-2.5" aria-label="主要操作">
        {status?.authenticated && status.user ? (
          <>
            <span
              className="hidden items-center gap-1.5 rounded-pill border border-hairline bg-canvas px-3 py-1.5 text-[14px] text-ink-80 sm:inline-flex"
              title={status.user.role === 'admin' ? '管理员' : '普通用户'}
            >
              <UserRound size={15} className="text-ink-48" />
              {status.user.displayName}
            </span>
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-pill border border-hairline bg-canvas text-ink-80 transition-transform active:scale-95"
              type="button"
              title="退出登录"
              onClick={submitLogout}
            >
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
  const [isPending, startTransition] = useTransition();
  const shareCardRef = useRef<HTMLElement | null>(null);
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
                    theme="vs"
                    value={text}
                    options={editorOptions}
                    loading={<div className="editor-loading">正在加载编辑器...</div>}
                    onChange={updateText}
                  />
                </Suspense>
              )}
            </div>
            <div className="editor-statusbar">
              <span
                className={
                  textSize > MAX_TEXT_BYTES
                    ? 'text-[14px] font-semibold text-[#b84a3b]'
                    : 'text-[14px] text-ink-48'
                }
              >
                {formatBytes(textSize)} / {formatBytes(MAX_TEXT_BYTES)}
              </span>
              <button className="btn-pill" type="submit" disabled={isPending || textSize === 0}>
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
        <aside className="create-sidebar">
          <section className="card sidebar-panel">
            <div className="sidebar-title">
              <Clock size={18} className="text-primary" />
              <h2>选项</h2>
            </div>
            <label className="grid gap-1.5 text-[13px] font-semibold text-ink-48">
              过期时间
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
            <label className="grid gap-1.5 text-[13px] font-semibold text-ink-48">
              代码高亮
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
            <label className="grid gap-1.5 text-[13px] font-semibold text-ink-48">
              查看密码
              <span className="relative block">
                <input
                  className="field pr-11"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  placeholder="可留空"
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-ink-48 transition-colors hover:text-ink"
                  type="button"
                  title={showPassword ? '隐藏密码' : '显示密码'}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </label>
            <label className="flex items-center gap-3 text-[15px] text-ink">
              <input
                className="h-[18px] w-[18px] accent-primary"
                type="checkbox"
                checked={burnAfterReading}
                onChange={(event) => setBurnAfterReading(event.target.checked)}
              />
              <span className="inline-flex items-center gap-2">
                <Flame size={17} className="text-primary" />
                阅后即焚
              </span>
            </label>
          </section>

          {message ? (
            <p className="rounded-md bg-[color-mix(in_srgb,#b84a3b_8%,white)] px-3 py-2.5 text-[14px] text-[#b84a3b]">
              {message}
            </p>
          ) : null}

          {created ? (
            <section className="card sidebar-panel" ref={shareCardRef}>
              <div className="sidebar-title">
                <QrCode size={18} className="text-primary" />
                <h2>分享</h2>
              </div>
              <img
                className="mx-auto block w-[min(224px,100%)] rounded-md border border-hairline"
                src={created.qrDataUrl}
                alt="分享二维码"
              />
              <div className="share-url" title={created.url}>
                {created.url}
              </div>
              <button className="btn-ghost w-full" type="button" onClick={copyLink}>
                {copied ? <Check size={18} /> : <Copy size={18} />}
                {copied ? '已复制' : '复制链接'}
              </button>
              <dl className="grid gap-0">
                <div className="flex items-center justify-between gap-4 border-t border-divider-soft py-2.5">
                  <dt className="text-[13px] text-ink-48">过期</dt>
                  <dd className="m-0 text-[14px] font-semibold">{formatDateTime(created.expiresAt)}</dd>
                </div>
                <div className="flex items-center justify-between gap-4 border-t border-divider-soft py-2.5">
                  <dt className="text-[13px] text-ink-48">密码</dt>
                  <dd className="m-0 text-[14px] font-semibold">
                    {created.requiresPassword ? '已启用' : '未设置'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 border-t border-divider-soft py-2.5">
                  <dt className="text-[13px] text-ink-48">阅后即焚</dt>
                  <dd className="m-0 text-[14px] font-semibold">
                    {created.burnAfterReading ? '已启用' : '关闭'}
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
          title="管理需要 passkey"
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
          <div className="flex min-w-0 items-center gap-2.5">
            <UsersRound size={20} className="shrink-0 text-primary" />
            <h1>用户管理</h1>
          </div>
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
      {message ? (
        <p className="rounded-md bg-[color-mix(in_srgb,#b84a3b_8%,white)] px-3 py-2.5 text-[14px] text-[#b84a3b]">
          {message}
        </p>
      ) : null}
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
              <button className="admin-user-action admin-user-action--primary" type="submit" disabled={busy}>
                保存
              </button>
              <button
                className="admin-user-action"
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
          <span className="grid min-w-0">
            <strong>{user.displayName}</strong>
            <small>
              {user.role === 'admin' ? '管理员' : '用户'}
              {user.disabled ? ' · 已停用' : ''}
              {isCurrentUser ? ' · 当前登录' : ''}
            </small>
          </span>
        )}
        {confirmingDelete ? (
          <form className="admin-delete-confirm" onSubmit={submitDelete}>
            <label>
              输入用户名确认删除
              <input
                className="field admin-inline-input"
                value={deleteConfirmation}
                autoFocus
                onChange={(event) => setDeleteConfirmation(event.target.value)}
              />
            </label>
            <div className="admin-inline-actions">
              <button
                className="admin-user-action admin-user-action--danger"
                type="submit"
                disabled={busy || deleteConfirmation !== user.displayName}
              >
                删除用户
              </button>
              <button
                className="admin-user-action"
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
          className="admin-icon-action"
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
          className="admin-user-action"
          type="button"
          disabled={busy || !canDisable}
          title={canDisable ? undefined : '不能停用当前用户或最后一个管理员'}
          onClick={() => onToggleDisabled(user)}
        >
          {user.disabled ? '启用' : '停用'}
        </button>
        <button className="admin-user-action" type="button" disabled={busy} onClick={submitForceLogout}>
          强退
        </button>
        <button
          className="admin-icon-action admin-icon-action--danger"
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
        <button className="btn-pill" type="button" onClick={() => setConfirmed(true)}>
          <Flame size={18} />
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
      {loading ? <p className="paste-inline-state">正在读取密文...</p> : null}
      {needsPassword ? (
        <form className="card paste-password-panel" onSubmit={submitPassword}>
          <div className="flex items-center gap-2.5">
            <KeyRound size={18} className="text-primary" />
            <h2 className="text-[21px] font-semibold tracking-[-0.2px]">需要查看密码</h2>
          </div>
          <input
            className="field"
            autoFocus
            type="password"
            value={password}
            placeholder="输入创建者另行告知的密码"
            onChange={(event) => setPassword(event.target.value)}
          />
          <button className="btn-pill w-full" type="submit" disabled={!password}>
            解密
          </button>
        </form>
      ) : null}
      {message ? (
        <p className="paste-error">
          <AlertTriangle size={18} />
          {message}
        </p>
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
    <section className="viewer-shell">
      <div className="viewer-toolbar">
        <div className="viewer-toolbar-info">
          <span className="font-semibold text-ink-80">{languageLabel}</span>
          {highlighting ? <span>高亮加载中</span> : null}
          {!canHighlight && language !== 'text' ? <span>文本较大，已使用纯文本显示</span> : null}
        </div>
        <div className="viewer-actions">
          <button className="viewer-action-btn" type="button" onClick={copyText}>
            {copyState === 'copied' ? <Check size={16} /> : <Copy size={16} />}
            {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制内容'}
          </button>
          <button className="viewer-action-btn" type="button" onClick={downloadText}>
            <Download size={16} />
            下载
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
    <main className="grid min-h-[calc(100dvh-70px)] place-items-center p-6">
      <section className="card grid w-[min(480px,100%)] gap-3 p-6 sm:p-7">
        <div className="flex items-center gap-2.5">
          <AlertTriangle size={18} className="text-primary" />
          <h1 className="text-[21px] font-semibold tracking-[-0.2px]">{title}</h1>
        </div>
        <p className="m-0 text-[15px] leading-[1.5] text-ink-48">{message}</p>
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
      {message ? (
        <p className="mx-4 mt-3.5 rounded-md bg-[color-mix(in_srgb,#b84a3b_8%,white)] px-3 py-2.5 text-[14px] text-[#b84a3b] sm:mx-8">
          {message}
        </p>
      ) : null}
      {route.name === 'paste' ? (
        <ViewPaste id={route.id} />
      ) : route.name === 'admin' && status ? (
        <AdminPage status={status} refreshAuth={refreshAuth} />
      ) : status ? (
        <Home status={status} refreshAuth={refreshAuth} />
      ) : (
        <main className="grid min-h-[calc(100dvh-70px)] place-items-center p-6">
          <RefreshCcw className="spin text-ink-48" size={24} />
        </main>
      )}
    </div>
  );
}
