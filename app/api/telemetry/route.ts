import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { appendTelemetryEvent } from '@/lib/server/telemetry';

interface TelemetryRequest {
  eventType: string;
  payload?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as TelemetryRequest;

    if (!body.eventType) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'eventType is required');
    }

    await appendTelemetryEvent({
      eventType: body.eventType,
      payload: body.payload || {},
    });

    return apiSuccess({ ok: true });
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, 'Failed to record telemetry', String(error));
  }
}

