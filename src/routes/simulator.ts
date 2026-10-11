import { Router } from "express";
import { simulatorController } from "../controllers/simulator.controller.js";
import { requireSimulatorProvider } from "../lib/provider-auth.js";
import { validate } from "../middleware/validate.js";
import {
  channelParamSchema,
  simulatedReservationSchema,
  simulatorStateQuerySchema,
} from "../validators/simulator.js";

const router = Router();

router.post(
  "/:channel/reservations",
  validate(channelParamSchema, "params"),
  requireSimulatorProvider,
  validate(simulatedReservationSchema),
  simulatorController.ingestReservation.bind(simulatorController)
);

router.get(
  "/:channel/state",
  validate(channelParamSchema, "params"),
  requireSimulatorProvider,
  validate(simulatorStateQuerySchema, "query"),
  simulatorController.getState.bind(simulatorController)
);

export default router;
