import { readFileSync } from 'node:fs';
import { loadConfig } from './config.js';
import { openDb, purgeOld } from './db.js';
import { makeLogger } from './log.js';
import { makeSender } from './whatsapp.js';
import { makeAi } from './ai.js';
import { makeHandler } from './bot.js';
import { makeServer } from './server.js';

const cfg = loadConfig();
const log = makeLogger([cfg.accessToken, cfg.appSecret, cfg.aiApiKey, cfg.verifyToken]);
const business = readFileSync(cfg.businessFile, 'utf8');
const db = openDb(cfg.dbPath);

purgeOld(db, cfg.retentionDays);
setInterval(() => purgeOld(db, cfg.retentionDays), 6 * 3_600_000).unref();

const handle = makeHandler({ cfg, db, log, business, send: makeSender(cfg, log), ai: makeAi(cfg) });
const server = makeServer(cfg, handle, log);
server.listen(cfg.port, () => log('listening', { port: cfg.port, graph: cfg.graphVersion }));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
}
