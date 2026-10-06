import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';

export function CenteredNotice({
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
