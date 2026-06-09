import type {
  AdminUserResponse,
  AuthStatusResponse,
  ConfigResponse,
  CreatePasteRequest,
  CreatePasteResponse,
  PasteResponse,
} from '../shared/api-types';
import { apiFetch } from './http';

export function getConfig(): Promise<ConfigResponse> {
  return apiFetch<ConfigResponse>('/api/config');
}

export function getAuthStatus(): Promise<AuthStatusResponse> {
  return apiFetch<AuthStatusResponse>('/api/auth/status');
}

export function createPaste(payload: CreatePasteRequest): Promise<CreatePasteResponse> {
  return apiFetch<CreatePasteResponse>('/api/pastes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getPaste(id: string): Promise<PasteResponse> {
  return apiFetch<PasteResponse>(`/api/pastes/${encodeURIComponent(id)}`);
}

export function deletePaste(id: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/pastes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function getAdminUsers(): Promise<AdminUserResponse> {
  return apiFetch<AdminUserResponse>('/api/admin/users');
}

export function setUserDisabled(userId: string, disabled: boolean): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ disabled }),
  });
}
