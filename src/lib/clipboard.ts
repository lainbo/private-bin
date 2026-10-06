import { useState } from 'react';

export function useClipboardCopy() {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return { copyState, copy, resetCopyState: () => setCopyState('idle') };
}
