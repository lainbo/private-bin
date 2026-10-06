import { LogOut } from 'lucide-react';
import type { AuthStatusResponse } from '../shared/api-types';
import { logout } from '../lib/passkey';
import { errorMessage, initialOf } from '../lib/ui';
import type { Route } from '../routes';

export function TopBar({
  status,
  refresh,
  setRoute,
  showError,
}: {
  status: AuthStatusResponse | null;
  refresh: () => Promise<void>;
  setRoute: (route: Route) => void;
  showError: (message: string) => void;
}) {
  async function submitLogout() {
    try {
      await logout();
      await refresh();
    } catch (error) {
      showError(errorMessage(error));
    }
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
        <img className="brand-mark" src="/favicon.svg" alt="" />
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
