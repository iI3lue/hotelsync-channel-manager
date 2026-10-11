import { NextFunction, Request, Response } from "express";
import { AppError } from "../middleware/error-handler.js";
import { ProviderRequest } from "../lib/provider-auth.js";
import { simulatorService } from "../services/simulator.service.js";

export class SimulatorController {
  async ingestReservation(req: Request, res: Response, next: NextFunction) {
    try {
      const channel = (req as ProviderRequest).providerChannel;
      if (!channel) throw new AppError(401, "Provider authentication required", "Unauthorized");
      const result = await simulatorService.ingestReservation(channel, req.body);
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async getState(req: Request, res: Response, next: NextFunction) {
    try {
      const channel = (req as ProviderRequest).providerChannel;
      if (!channel) throw new AppError(401, "Provider authentication required", "Unauthorized");
      res.json(await simulatorService.getState(channel.channel_id, req.query as never));
    } catch (error) {
      next(error);
    }
  }
}

export const simulatorController = new SimulatorController();
