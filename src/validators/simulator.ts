import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const channelParamSchema = z.object({
  channel: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
});

export const simulatedReservationSchema = z
  .object({
    external_id: z.string().trim().min(1).max(100),
    hotel_id: z.string().uuid(),
    room_type_id: z.string().uuid(),
    check_in: isoDate,
    check_out: isoDate,
    total_amount: z.number().nonnegative(),
    guest: z.object({
      name: z.string().trim().min(1).max(255),
      email: z.string().trim().email().max(255),
      phone: z.string().trim().min(1).max(50),
    }),
  })
  .refine((value) => value.check_out > value.check_in, {
    message: "check_out must be after check_in",
    path: ["check_out"],
  });

export const simulatorStateQuerySchema = z.object({
  room_type_id: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export type SimulatedReservationInput = z.infer<typeof simulatedReservationSchema>;
export type SimulatorStateQuery = z.infer<typeof simulatorStateQuerySchema>;
