import prisma from "../lib/prisma.js";
import { AppError } from "../middleware/error-handler.js";
import { createAndConfirmExternalBooking } from "../lib/booking-client.js";
import {
  SimulatedReservationInput,
  SimulatorStateQuery,
} from "../validators/simulator.js";

export class SimulatorService {
  async ingestReservation(
    channel: { channel_id: string; slug: string },
    input: SimulatedReservationInput
  ) {
    const booking = await createAndConfirmExternalBooking(channel.slug, input);

    // Booking is the source of truth. This upsert is a local reconciliation
    // index; if the process crashes here, replaying the external request calls
    // Booking's unique (channel, external_id) contract and returns the same ID.
    const reservation = await prisma.externalReservation.upsert({
      where: {
        channel_id_external_id: {
          channel_id: channel.channel_id,
          external_id: input.external_id,
        },
      },
      create: {
        channel_id: channel.channel_id,
        external_id: input.external_id,
        booking_id: booking.booking_id,
        status: booking.status,
      },
      update: {
        booking_id: booking.booking_id,
        status: booking.status,
      },
    });

    return {
      external_id: reservation.external_id,
      booking_id: reservation.booking_id,
      status: reservation.status,
      manage_token: booking.manage_token,
      created: booking.created,
    };
  }

  async getState(
    channelId: string,
    query: SimulatorStateQuery
  ) {
    if (query.from && query.to && query.to < query.from) {
      throw new AppError(400, "to must be on or after from", "Bad Request");
    }
    const [reservations, inventory, rates] = await Promise.all([
      prisma.externalReservation.findMany({
        where: { channel_id: channelId },
        orderBy: { created_at: "desc" },
        take: 100,
      }),
      prisma.channelInventory.findMany({
        where: {
          channel_id: channelId,
          ...(query.room_type_id ? { room_type_id: query.room_type_id } : {}),
          ...(query.from || query.to
            ? {
                date: {
                  ...(query.from ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
                  ...(query.to ? { lte: new Date(`${query.to}T00:00:00Z`) } : {}),
                },
              }
            : {}),
        },
        orderBy: [{ room_type_id: "asc" }, { date: "asc" }],
        take: 2000,
      }),
      prisma.channelRate.findMany({
        where: {
          channel_id: channelId,
          ...(query.room_type_id ? { room_type_id: query.room_type_id } : {}),
        },
        orderBy: [{ room_type_id: "asc" }, { start_date: "asc" }],
        take: 1000,
      }),
    ]);
    return { reservations, inventory, rates };
  }
}

export const simulatorService = new SimulatorService();
