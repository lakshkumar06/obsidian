import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type ActivityEvent = {
  ts: string;
  source: 'relayer' | 'ui' | 'cli';
  type: string;
  [key: string]: unknown;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultLogPath = path.resolve(__dirname, '..', '..', '.obsidian', 'activity.jsonl');

let logPath = process.env['OBSIDIAN_ACTIVITY_LOG']?.trim() || defaultLogPath;

export function setActivityLogPath(file: string): void {
  logPath = file;
}

export function getActivityLogPath(): string {
  return logPath;
}

export function appendActivity(event: Omit<ActivityEvent, 'ts'> & { ts?: string }): void {
  const line: ActivityEvent = {
    ts: event.ts ?? new Date().toISOString(),
    source: event.source,
    type: event.type,
    ...Object.fromEntries(
      Object.entries(event).filter(([k]) => k !== 'ts' && k !== 'source' && k !== 'type'),
    ),
  };
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(line)}\n`, 'utf8');
}

export function readRecentActivity(limit = 200): ActivityEvent[] {
  if (!fs.existsSync(logPath)) {
    return [];
  }
  const raw = fs.readFileSync(logPath, 'utf8');
  const lines = raw.trim().split('\n').filter(Boolean);
  const tail = lines.slice(-limit);
  const out: ActivityEvent[] = [];
  for (const line of tail) {
    try {
      out.push(JSON.parse(line) as ActivityEvent);
    } catch {
      /* skip corrupt line */
    }
  }
  return out;
}
