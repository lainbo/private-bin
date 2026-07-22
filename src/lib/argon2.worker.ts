/// <reference lib="webworker" />

import { argon2id } from 'hash-wasm';

type Argon2WorkerRequest = {
  password: ArrayBuffer;
  salt: ArrayBuffer;
  iterations: number;
  memoryKiB: number;
  parallelism: number;
};

const worker = globalThis as unknown as DedicatedWorkerGlobalScope;

worker.onmessage = async (event: MessageEvent<Argon2WorkerRequest>) => {
  try {
    const result = await argon2id({
      password: new Uint8Array(event.data.password),
      salt: new Uint8Array(event.data.salt),
      iterations: event.data.iterations,
      memorySize: event.data.memoryKiB,
      parallelism: event.data.parallelism,
      hashLength: 32,
      outputType: 'binary',
    });
    const buffer = result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) as ArrayBuffer;
    worker.postMessage({ result: buffer }, [buffer]);
  } catch {
    worker.postMessage({ error: 'Argon2id 密钥派生失败。' });
  }
};

export {};
