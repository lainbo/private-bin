import { readFile, writeFile } from 'node:fs/promises';

const { DEPLOY_HOST, D1_DATABASE_ID } = process.env;
if (!DEPLOY_HOST || !D1_DATABASE_ID) {
  throw new Error('构建需要设置 DEPLOY_HOST 和 D1_DATABASE_ID。');
}
if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/u.test(DEPLOY_HOST)) {
  throw new Error('DEPLOY_HOST 必须是域名，不能包含协议、端口或路径。');
}
if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(D1_DATABASE_ID)) {
  throw new Error('D1_DATABASE_ID 必须是 UUID。');
}

const config = JSON.parse(await readFile('wrangler.jsonc.example', 'utf8'));
config.routes[0].pattern = DEPLOY_HOST;
config.d1_databases[0].database_id = D1_DATABASE_ID;
config.vars.PUBLIC_ORIGIN = `https://${DEPLOY_HOST}`;
config.vars.RP_ID = DEPLOY_HOST;
await writeFile('wrangler.jsonc', `${JSON.stringify(config, null, 2)}\n`);
