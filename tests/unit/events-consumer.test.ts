jest.mock("../../src/lib/prisma.js", () => ({ __esModule: true, default: {} }));
jest.mock("../../src/lib/rate-client.js", () => ({
  fetchAvailabilityDay: jest.fn(),
  fetchAvailabilityRange: jest.fn(),
}));

import { handleChannelEvent } from "../../src/lib/events-consumer.js";
import { fetchAvailabilityDay } from "../../src/lib/rate-client.js";

const fetchDay = fetchAvailabilityDay as jest.Mock;

function mockDb() {
  const tx = {
    channelInventory: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    channelRate: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
  const db = {
    channel: {
      findMany: jest.fn().mockResolvedValue([{ channel_id: "channel-1" }]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    channelInventory: tx.channelInventory,
    channelRate: tx.channelRate,
    externalReservation: { upsert: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { db: db as any, tx };
}

describe("Channel Manager event projections", () => {
  beforeEach(() => jest.clearAllMocks());

  it("refreshes the simulator inventory from authoritative R&A state", async () => {
    const { db, tx } = mockDb();
    fetchDay.mockResolvedValue({ available: 4, blocked: 2 });

    await handleChannelEvent(db, "availability.updated", {
      room_type_id: "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
      date: "2026-11-01",
      available_count: 99,
      blocked_count: 0,
      occurred_at: "2026-10-01T00:00:00.000Z",
    });

    expect(tx.channelInventory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ available_count: 4, blocked_count: 2 }),
        update: expect.objectContaining({ available_count: 4, blocked_count: 2 }),
      })
    );
  });

  it("ignores booking.created because pending bookings do not reserve inventory", async () => {
    const { db, tx } = mockDb();
    await handleChannelEvent(db, "booking.created", { booking_id: "booking-id" });
    expect(db.channel.findMany).not.toHaveBeenCalled();
    expect(tx.channelInventory.upsert).not.toHaveBeenCalled();
  });
});
