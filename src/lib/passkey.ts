import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { apiFetch } from './http';

type OptionsResponse<T> = {
  challengeId: string;
  options: T;
};

export function passkeysSupported(): boolean {
  return browserSupportsWebAuthn();
}

export async function registerWithPasskey(displayName: string): Promise<void> {
  const { challengeId, options } = await apiFetch<OptionsResponse<PublicKeyCredentialCreationOptionsJSON>>(
    '/api/auth/register/options',
    {
      method: 'POST',
      body: JSON.stringify({ displayName }),
    },
  );
  const response = await startRegistration({ optionsJSON: options });
  await apiFetch('/api/auth/register/verify', {
    method: 'POST',
    body: JSON.stringify({ challengeId, response }),
  });
}

export async function loginWithPasskey(): Promise<void> {
  const { challengeId, options } = await apiFetch<OptionsResponse<PublicKeyCredentialRequestOptionsJSON>>(
    '/api/auth/login/options',
    {
      method: 'POST',
      body: '{}',
    },
  );
  const response = await startAuthentication({ optionsJSON: options });
  await apiFetch('/api/auth/login/verify', {
    method: 'POST',
    body: JSON.stringify({ challengeId, response }),
  });
}

export async function logout(): Promise<void> {
  await apiFetch('/api/auth/logout', {
    method: 'POST',
    body: '{}',
  });
}
