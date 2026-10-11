import { createHash } from "node:crypto";
import express from "express";
import request from "supertest";
import simulatorRouter from "../../src/routes/simulator.js";
import { errorHandler } from "../../src/middleware/error-handler.js";

jest.mock("../../src/lib/prisma.js", () => ({
  __esModule: true,
  default: {
    channel: { findUnique: jest.fn() },
    externalReservation: { upsert: jest.fn() },
    channelInventory: { findMany: jest.fn() },
    channelRate: { findMany: jest.fn() },
  },
}));
jest.mock("../../src/lib/booking-client.js", () => ({
  createAndConfirmExternalBooking: jest.fn(),
}));

import prisma from "../../src/lib/prisma.js";
import { createAndConfirmExternalBooking } from "../../src/lib/booking-client.js";

const db = prisma as any;
const createBooking = createAndConfirmExternalBooking as jest.Mock;
const providerKey = "simulator-provider-secret-for-tests";
const channel = {
  channel_id: "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
  slug: "simulado",
  name: "Proveedor simulado",
  is_active: true,
  provider_key_hash: createHash("sha256").update(providerKey).digest("hex"),
};

const app = express();
app.use(express.json());
app.use("/v1/simulator", simulatorRouter);
app.use(errorHandler);

describe("simulator provider API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.channel.findUnique.mockResolvedValue(channel);
    db.externalReservation.upsert.mockResolvedValue({
      external_id: "sim-001",
      booking_id: "b1b2c3d4-e5f6-4890-abcd-ef1234567890",
      status: "confirmed",
    });
    createBooking.mockResolvedValue({
      booking_id: "b1b2c3d4-e5f6-4890-abcd-ef1234567890",
      status: "confirmed",
      manage_token: "stable-manage-token",
      created: true,
    });
  });

  const payload = {
    external_id: "sim-001",
    hotel_id: "c1b2c3d4-e5f6-4890-abcd-ef1234567890",
    room_type_id: "d1b2c3d4-e5f6-4890-abcd-ef1234567890",
    check_in: "2026-12-01",
    check_out: "2026-12-03",
    total_amount: 22000,
    guest: { name: "Ana", email: "ana@example.com", phone: "+5411" },
  };

  it("rejects missing or invalid provider credentials", async () => {
    const missing = await request(app)
      .post("/v1/simulator/simulado/reservations")
      .send(payload);
    const invalid = await request(app)
      .post("/v1/simulator/simulado/reservations")
      .set("x-provider-key", "wrong-key")
      .send(payload);

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it("accepts an authenticated simulated reservation and passes it to Booking", async () => {
    const response = await request(app)
      .post("/v1/simulator/simulado/reservations")
      .set("x-provider-key", providerKey)
      .send(payload);

    expect(response.status).toBe(201);
    expect(createBooking).toHaveBeenCalledWith("simulado", payload);
    expect(response.body).toMatchObject({
      external_id: "sim-001",
      status: "confirmed",
      manage_token: "stable-manage-token",
    });
  });
});
