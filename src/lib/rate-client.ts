import { AppError } from "../middleware/error-handler.js";

const RATE_SERVICE_URL =
  process.env.RATE_SERVICE_URL || "http://localhost:3002/v1";

export interface AvailabilityDay {
  available: number;
  blocked: number;
}

export async function fetchAvailabilityRange(
  roomTypeId: string,
  from: string,
  to: string
): Promise<Record<string, AvailabilityDay>> {
  let response: Response;
  try {
    response = await fetch(
      `${RATE_SERVICE_URL}/availability/range?room_type_id=${encodeURIComponent(roomTypeId)}&from=${from}&to=${to}`,
      { signal: AbortSignal.timeout(5000) }
    );
  } catch {
    throw new AppError(502, "Rate & Availability Service unavailable", "Bad Gateway");
  }
  if (!response.ok) {
    throw new AppError(502, `Rate & Availability returned ${response.status}`, "Bad Gateway");
  }
  return (await response.json()) as Record<string, AvailabilityDay>;
}

export async function fetchAvailabilityDay(
  roomTypeId: string,
  date: string
): Promise<AvailabilityDay> {
  let response: Response;
  try {
    response = await fetch(
      `${RATE_SERVICE_URL}/availability?room_type_id=${encodeURIComponent(roomTypeId)}&date=${date}`,
      { signal: AbortSignal.timeout(5000) }
    );
  } catch {
    throw new AppError(502, "Rate & Availability Service unavailable", "Bad Gateway");
  }
  if (!response.ok) {
    throw new AppError(502, `Rate & Availability returned ${response.status}`, "Bad Gateway");
  }
  return (await response.json()) as AvailabilityDay;
}
