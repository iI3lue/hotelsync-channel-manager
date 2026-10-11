import { z } from "zod";
import prisma from "./prisma.js";
import { consume } from "./broker.js";
import { fetchAvailabilityDay, fetchAvailabilityRange } from "./rate-client.js";

const QUEUE = "channel-manager.simulator";
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const availabilityUpdatedSchema = z.object({
  room_type_id: z.string().uuid(),
  date: dateSchema,
  available_count: z.number().int().nonnegative(),
  blocked_count: z.number().int().nonnegative(),
  occurred_at: z.string().datetime().optional(),
});

const rateUpdatedSchema = z.object({
  room_type_id: z.string().uuid(),
  kind: z.enum(["base_rate", "rate_rule"]),
  rate_id: z.string().optional(),
  rule_id: z.string().optional(),
  report_date: dateSchema.optional(),
  start_date: dateSchema.optional(),
  end_date: dateSchema.optional(),
  price: z.number().nonnegative().optional(),
  multiplier: z.number().positive().optional(),
  min_stay: z.number().int().positive().optional(),
  occurred_at: z.string().datetime().optional(),
});

const bookingChangedSchema = z.object({
  booking_id: z.string().uuid(),
  hotel_id: z.string().uuid(),
  room_type_id: z.string().uuid(),
  check_in: dateSchema,
  check_out: dateSchema,
  channel: z.string().optional(),
  channel_external_id: z.string().nullable().optional(),
  occurred_at: z.string().datetime().optional(),
});

type Db = typeof prisma;

function asDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function minusOneDay(iso: string): string {
  const date = asDate(iso);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function compareTimestamp(value?: string): Date {
  return value ? new Date(value) : new Date();
}

async function upsertAvailability(
  db: Db,
  channels: Array<{ channel_id: string }>,
  input: {
    room_type_id: string;
    date: string;
    available_count: number;
    blocked_count: number;
    occurred_at?: string;
  }
) {
  const updatedAt = compareTimestamp(input.occurred_at);
  await db.$transaction(async (tx) => {
    for (const channel of channels) {
      const key = {
        channel_id_room_type_id_date: {
          channel_id: channel.channel_id,
          room_type_id: input.room_type_id,
          date: asDate(input.date),
        },
      };
      const current = await tx.channelInventory.findUnique({ where: key });
      // Replayed/out-of-order older events cannot roll back the simulator's
      // mirror of R&A.
      if (current && current.updated_at > updatedAt) continue;
      await tx.channelInventory.upsert({
        where: key,
        create: {
          channel_id: channel.channel_id,
          room_type_id: input.room_type_id,
          date: asDate(input.date),
          available_count: input.available_count,
          blocked_count: input.blocked_count,
          updated_at: updatedAt,
        },
        update: {
          available_count: input.available_count,
          blocked_count: input.blocked_count,
          updated_at: updatedAt,
        },
      });
    }
  });
}

async function syncBookingInventory(
  db: Db,
  channels: Array<{ channel_id: string }>,
  booking: z.infer<typeof bookingChangedSchema>
) {
  const lastNight = minusOneDay(booking.check_out);
  if (lastNight < booking.check_in) return;
  const start = asDate(booking.check_in);
  const end = asDate(lastNight);
  const occurredAt = booking.occurred_at ?? new Date().toISOString();

  // R&A range endpoint caps a request at 62 dates inclusive.
  while (start <= end) {
    const chunkEnd = new Date(start);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 61);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    const from = start.toISOString().slice(0, 10);
    const to = chunkEnd.toISOString().slice(0, 10);
    const snapshot = await fetchAvailabilityRange(booking.room_type_id, from, to);
    for (const [date, counts] of Object.entries(snapshot)) {
      await upsertAvailability(db, channels, {
        room_type_id: booking.room_type_id,
        date,
        available_count: counts.available,
        blocked_count: counts.blocked,
        occurred_at: occurredAt,
      });
    }
    start.setUTCDate(start.getUTCDate() + 62);
  }
}

async function upsertRate(
  db: Db,
  channels: Array<{ channel_id: string }>,
  raw: unknown
) {
  const input = rateUpdatedSchema.parse(raw);
  const startDate = input.kind === "base_rate" ? input.report_date : input.start_date;
  const endDate = input.kind === "base_rate" ? input.report_date : input.end_date;
  if (!startDate || !endDate) throw new Error("Rate event has no effective date range");
  if (input.kind === "base_rate" && input.price === undefined) {
    throw new Error("Base rate event has no price");
  }
  if (input.kind === "rate_rule" && input.multiplier === undefined) {
    throw new Error("Rate rule event has no multiplier");
  }

  const occurredAt = compareTimestamp(input.occurred_at);
  await db.$transaction(async (tx) => {
    for (const channel of channels) {
      const sourceId = input.kind === "base_rate" ? input.rate_id ?? startDate : input.rule_id ?? `${startDate}:${endDate}`;
      const projectionKey = `${channel.channel_id}:${input.kind}:${input.room_type_id}:${sourceId}`;
      const current = await tx.channelRate.findUnique({
        where: { projection_key: projectionKey },
      });
      if (current && current.updated_at > occurredAt) continue;
      await tx.channelRate.upsert({
        where: { projection_key: projectionKey },
        create: {
          projection_key: projectionKey,
          channel_id: channel.channel_id,
          room_type_id: input.room_type_id,
          kind: input.kind,
          start_date: asDate(startDate),
          end_date: asDate(endDate),
          price: input.price,
          multiplier: input.multiplier,
          min_stay: input.min_stay,
          updated_at: occurredAt,
        },
        update: {
          start_date: asDate(startDate),
          end_date: asDate(endDate),
          price: input.price,
          multiplier: input.multiplier,
          min_stay: input.min_stay,
          updated_at: occurredAt,
        },
      });
    }
  });
}

export async function handleChannelEvent(
  db: Db,
  routingKey: string,
  payload: unknown
): Promise<void> {
  if (routingKey === "booking.created") return; // pending: no inventory effect yet.

  const channels = await db.channel.findMany({
    where: { is_active: true },
    select: { channel_id: true },
  });
  if (channels.length === 0) return;

  if (routingKey === "availability.updated") {
    const input = availabilityUpdatedSchema.parse(payload);
    // Treat event as a durable invalidation signal; R&A is the source of truth.
    // Fetching current state also prevents an old redelivery from rolling back
    // a newer booking confirmation or manual adjustment.
    const current = await fetchAvailabilityDay(input.room_type_id, input.date);
    await upsertAvailability(db, channels, {
      ...input,
      available_count: current.available,
      blocked_count: current.blocked,
    });
    return;
  }

  if (routingKey === "rate.updated") {
    await upsertRate(db, channels, payload);
    return;
  }

  if (routingKey === "booking.confirmed" || routingKey === "booking.cancelled") {
    const booking = bookingChangedSchema.parse(payload);
    await syncBookingInventory(db, channels, booking);

    if (booking.channel?.startsWith("ota:") && booking.channel_external_id) {
      const slug = booking.channel.slice("ota:".length);
      const channel = await db.channel.findUnique({ where: { slug } });
      if (channel) {
        await db.externalReservation.upsert({
          where: {
            channel_id_external_id: {
              channel_id: channel.channel_id,
              external_id: booking.channel_external_id,
            },
          },
          create: {
            channel_id: channel.channel_id,
            external_id: booking.channel_external_id,
            booking_id: booking.booking_id,
            status: routingKey === "booking.confirmed" ? "confirmed" : "cancelled",
          },
          update: {
            booking_id: booking.booking_id,
            status: routingKey === "booking.confirmed" ? "confirmed" : "cancelled",
          },
        });
      }
    }
    return;
  }

  console.warn(`[channel-manager] routing key ignored: ${routingKey}`);
}

export async function startEventsConsumer(): Promise<void> {
  await consume(
    "channel-manager.simulator",
    ["booking.created", "booking.confirmed", "booking.cancelled", "availability.updated", "rate.updated"],
    (routingKey, payload) => handleChannelEvent(prisma, routingKey, payload)
  );
}
