import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

export function ErrorMessage({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`alert ${className}`} role="alert">
      <CircleAlert size={16} />
      <span>{children}</span>
    </p>
  );
}
