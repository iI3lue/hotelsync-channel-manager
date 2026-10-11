import { createHash, timingSafeEqual } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import prisma from "./prisma.js";
import { AppError } from "../middleware/error-handler.js";

export interface ProviderRequest extends Request {
  providerChannel?: { channel_id: string; slug: string; name: string };
}

export async function requireSimulatorProvider(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { channel: slug } = req.params as { channel: string };
    const header = req.headers["x-provider-key"];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!provided) {
      throw new AppError(401, "Missing provider credentials", "Unauthorized");
    }

    const channel = await prisma.channel.findUnique({ where: { slug } });
    if (!channel || !channel.is_active) {
      throw new AppError(404, "Channel not found", "Not Found");
    }

    const candidate = Buffer.from(
      createHash("sha256").update(provided).digest("hex"),
      "hex"
    );
    const expected = Buffer.from(channel.provider_key_hash, "hex");
    if (
      candidate.length !== expected.length ||
      !timingSafeEqual(candidate, expected)
    ) {
      throw new AppError(401, "Invalid provider credentials", "Unauthorized");
    }

    (req as ProviderRequest).providerChannel = {
      channel_id: channel.channel_id,
      slug: channel.slug,
      name: channel.name,
    };
    next();
  } catch (error) {
    next(error);
  }
}
