import { AppError } from "../middleware/error-handler.js";
import { SimulatedReservationInput } from "../validators/simulator.js";

const BOOKING_SERVICE_URL =
  process.env.BOOKING_SERVICE_URL || "http://localhost:3004/v1";
const CHANNEL_MANAGER_SERVICE_KEY =
  process.env.CHANNEL_MANAGER_SERVICE_KEY || "";

export interface BookingResult {
  booking_id: string;
  status: "pending" | "confirmed" | "cancelled";
  manage_token: string;
  created?: boolean;
}

interface BookingRecord extends Omit<BookingResult, "manage_token"> {
  [key: string]: unknown;
}

async function requestBooking(
  path: string,
  method: "GET" | "POST",
  body?: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!CHANNEL_MANAGER_SERVICE_KEY) {
    throw new AppError(503, "Channel Manager service credentials are not configured", "Service Unavailable");
  }

  let response: Response;
  try {
    response = await fetch(`${BOOKING_SERVICE_URL}${path}`, {
      method,
      headers: {
        "x-channel-manager-key": CHANNEL_MANAGER_SERVICE_KEY,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new AppError(502, "Booking Service unavailable", "Bad Gateway");
  }

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const status = response.status === 409 ? 409 : 502;
    throw new AppError(
      status,
      typeof payload.message === "string" ? payload.message : `Booking Service returned ${response.status}`,
      status === 409 ? "Conflict" : "Bad Gateway"
    );
  }
  return { status: response.status, body: payload };
}

export async function createAndConfirmExternalBooking(
  channelSlug: string,
  input: SimulatedReservationInput
): Promise<BookingResult> {
  const created = await requestBooking("/bookings", "POST", {
    hotel_id: input.hotel_id,
    room_type_id: input.room_type_id,
    check_in: input.check_in,
    check_out: input.check_out,
    channel: `ota:${channelSlug}`,
    channel_external_id: input.external_id,
    total_amount: input.total_amount,
    guest: input.guest,
  });
  const booking = created.body as unknown as BookingRecord & { manage_token?: string };

  if (booking.status === "cancelled") {
    throw new AppError(409, "This external reservation was already rejected/cancelled", "Conflict");
  }

  let confirmed = booking;
  if (booking.status === "pending") {
    try {
      const result = await requestBooking(
        `/bookings/${encodeURIComponent(booking.booking_id)}/confirm`,
        "POST",
        {}
      );
      confirmed = result.body as unknown as BookingRecord;
    } catch (error) {
      // A timeout can mean the confirm committed but the response was lost.
      // Read canonical state before deciding whether to reject/cancel.
      const latest = await requestBooking(
        `/bookings/${encodeURIComponent(booking.booking_id)}`,
        "GET"
      ).catch(() => null);
      const latestBooking = latest?.body as unknown as BookingRecord | undefined;
      if (latestBooking?.status === "confirmed") {
        confirmed = latestBooking;
      } else if (error instanceof AppError && error.statusCode === 409) {
        // No inventory: avoid leaving an OTA-origin pending row orphaned.
        await requestBooking(
          `/bookings/${encodeURIComponent(booking.booking_id)}/cancel`,
          "POST",
          {}
        ).catch(() => undefined);
        throw error;
      } else {
        // Booking's durable reconciliation attempt owns transient failures.
        throw error;
      }
    }
  }

  if (confirmed.status !== "confirmed") {
    throw new AppError(409, `Booking remained ${confirmed.status}`, "Conflict");
  }
  if (!booking.manage_token) {
    throw new AppError(502, "Booking Service did not return a manage token", "Bad Gateway");
  }
  return {
    booking_id: booking.booking_id,
    status: "confirmed",
    manage_token: booking.manage_token,
    created: booking.created,
  };
}
