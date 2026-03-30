import { promises as fs } from 'fs';
import path from 'path';

const TELEMETRY_DIR = path.join(process.cwd(), 'data', 'telemetry');
const TELEMETRY_FILE = path.join(TELEMETRY_DIR, 'events.jsonl');

export interface TelemetryEvent {
  eventType: string;
  timestamp?: string;
  payload: Record<string, unknown>;
}

export async function appendTelemetryEvent(event: TelemetryEvent): Promise<void> {
  try {
    await fs.mkdir(TELEMETRY_DIR, { recursive: true });
    const enriched = {
      ...event,
      timestamp: event.timestamp || new Date().toISOString(),
    };
    await fs.appendFile(TELEMETRY_FILE, `${JSON.stringify(enriched)}\n`, 'utf-8');
  } catch {
    // telemetry must never break primary request flows
  }
}

