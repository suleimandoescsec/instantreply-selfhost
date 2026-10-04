import { createHmac } from 'node:crypto';

export type Logger = (event: string, fields?: Record<string, unknown>) => void;

/** JSON-lines logger. Any configured secret is scrubbed from every line. Never pass message text to it. */
export function makeLogger(secrets: string[], write: (line: string) => void = (l) => console.log(l)): Logger {
  const list = secrets.filter((s) => s && s.length >= 4);
  return (event, fields = {}) => {
    let line = JSON.stringify({ t: new Date().toISOString(), event, ...fields });
    for (const s of list) line = line.split(s).join('***');
    write(line);
  };
}

/** Short stable pseudonym for a phone number so logs stay useful without storing PII. */
export const who = (secret: string, id: string) => createHmac('sha256', secret).update(id).digest('hex').slice(0, 8);
