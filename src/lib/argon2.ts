import { toArrayBuffer } from './encoding';

type Argon2Options = {
  password: Uint8Array;
  salt: Uint8Array;
  iterations: number;
  memoryKiB: number;
  parallelism: number;
};

type Argon2WorkerResponse = { result: ArrayBuffer } | { error: string };

async function deriveDirect(options: Argon2Options): Promise<Uint8Array> {
  const { argon2id } = await import('hash-wasm');
  return argon2id({
    password: options.password,
    salt: options.salt,
    iterations: options.iterations,
    memorySize: options.memoryKiB,
    parallelism: options.parallelism,
    hashLength: 32,
    outputType: 'binary',
  });
}

function deriveInWorker(options: Argon2Options): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./argon2.worker.ts', import.meta.url), { type: 'module' });
    const password = toArrayBuffer(options.password);
    const salt = toArrayBuffer(options.salt);

    worker.onmessage = (event: MessageEvent<Argon2WorkerResponse>) => {
      worker.terminate();
      if ('error' in event.data) {
        reject(new Error(event.data.error));
        return;
      }
      resolve(new Uint8Array(event.data.result));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error('Argon2id 密钥派生失败。'));
    };
    worker.postMessage(
      {
        password,
        salt,
        iterations: options.iterations,
        memoryKiB: options.memoryKiB,
        parallelism: options.parallelism,
      },
      [password, salt],
    );
  });
}

export function deriveArgon2id(options: Argon2Options): Promise<Uint8Array> {
  return typeof Worker === 'undefined' ? deriveDirect(options) : deriveInWorker(options);
}
