import { NextFunction, Request, Response } from "express";
import { z, ZodType } from "zod";
import { AppError } from "./error-handler.js";

export function validate(schema: ZodType, target: "body" | "query" | "params" = "body") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      const message = result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      next(new AppError(400, message || "Invalid request", "Bad Request"));
      return;
    }
    if (target === "body") req.body = result.data;
    if (target === "params") Object.assign(req.params, result.data);
    if (target === "query") Object.assign(req.query, result.data);
    next();
  };
}
