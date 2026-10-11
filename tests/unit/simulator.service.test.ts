import { simulatorService } from "../../src/services/simulator.service.js";

jest.mock("../../src/lib/prisma.js", () => ({
  __esModule: true,
  default: {
    externalReservation: { upsert: jest.fn() },
  },
}));
jest.mock("../../src/lib/booking-client.js", () => ({
  createAndConfirmExternalBooking: jest.fn(),
}));

import prisma from "../../src/lib/prisma.js";
import { createAndConfirmExternalBooking } from "../../src/lib/booking-client.js";

const db = prisma as any;
const createBooking = createAndConfirmExternalBooking as jest.Mock;

describe("SimulatorService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("forwards a simulated reservation to Booking and stores the returned mapping", async () => {
    const input = {
      external_id: "OTA-001",
      hotel_id: "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
      room_type_id: "b1b2c3d4-e5f6-4890-abcd-ef1234567890",
      check_in: "2026-12-01",
      check_out: "2026-12-03",
      total_amount: 20000,
      guest: { name: "Ana", email: "ana@example.com", phone: "+5411" },
    };
    createBooking.mockResolvedValue({
      booking_id: "c1b2c3d4-e5f6-4890-abcd-ef1234567890",
      status: "confirmed",
      manage_token: "stable-token",
      created: true,
    });
    db.externalReservation.upsert.mockResolvedValue({
      external_id: input.external_id,
      booking_id: "c1b2c3d4-e5f6-4890-abcd-ef1234567890",
      status: "confirmed",
    });

    const result = await simulatorService.ingestReservation(
      { channel_id: "channel-id", slug: "simulado" },
      input
    );

    expect(createBooking).toHaveBeenCalledWith("simulado", input);
    expect(db.externalReservation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          channel_id_external_id: {
            channel_id: "channel-id",
            external_id: "OTA-001",
          },
        },
      })
    );
    expect(result).toEqual({
      external_id: "OTA-001",
      booking_id: "c1b2c3d4-e5f6-4890-abcd-ef1234567890",
      status: "confirmed",
      manage_token: "stable-token",
      created: true,
    });
  });
});
