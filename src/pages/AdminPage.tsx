import { Pencil, Trash2, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { ApiUser, AuthStatusResponse } from '../shared/api-types';
import {
  deleteAdminUser,
  forceLogoutAdminUser,
  getAdminUsers,
  setUserDisabled,
  updateAdminUser,
} from '../lib/api';
import { errorMessage, initialOf } from '../lib/ui';
import { AuthGate } from '../components/AuthGate';
import { CenteredNotice } from '../components/CenteredNotice';
import { ErrorMessage } from '../components/ErrorMessage';

export function AdminPage({
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
  const canDisable = !isCurrentUser;

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
          title={canDisable ? undefined : '不能停用当前登录的管理员'}
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
