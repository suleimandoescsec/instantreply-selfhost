export interface Config {
  graphVersion: string;
  appSecret: string;
  verifyToken: string;
  accessToken: string;
  phoneNumberId: string;
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  port: number;
  businessFile: string;
  dbPath: string;
  historyMessages: number;
  maxReplyChars: number;
  rateLimitPerMin: number;
  maxBodyBytes: number;
  retentionDays: number;
  handoffKeywords: string[];
}

const REQUIRED = [
  'GRAPH_API_VERSION', 'APP_SECRET', 'VERIFY_TOKEN', 'ACCESS_TOKEN',
  'PHONE_NUMBER_ID', 'AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL',
];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = REQUIRED.filter((k) => !env[k]?.trim());
  if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')} (see .env.example)`);
  const num = (k: string, d: number) => {
    const n = Number(env[k] || d);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${k} must be a positive number`);
    return n;
  };
  return {
    graphVersion: env.GRAPH_API_VERSION!.trim(),
    appSecret: env.APP_SECRET!.trim(),
    verifyToken: env.VERIFY_TOKEN!.trim(),
    accessToken: env.ACCESS_TOKEN!.trim(),
    phoneNumberId: env.PHONE_NUMBER_ID!.trim(),
    aiBaseUrl: env.AI_BASE_URL!.trim().replace(/\/+$/, ''),
    aiApiKey: env.AI_API_KEY!.trim(),
    aiModel: env.AI_MODEL!.trim(),
    port: num('PORT', 3000),
    businessFile: env.BUSINESS_FILE || './business.md',
    dbPath: env.DB_PATH || './data/bot.db',
    historyMessages: num('HISTORY_MESSAGES', 10),
    maxReplyChars: num('MAX_REPLY_CHARS', 600),
    rateLimitPerMin: num('RATE_LIMIT_PER_MIN', 6),
    maxBodyBytes: num('MAX_BODY_BYTES', 3 * 1024 * 1024),
    retentionDays: num('HISTORY_RETENTION_DAYS', 30),
    handoffKeywords: (env.HANDOFF_KEYWORDS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  };
}
