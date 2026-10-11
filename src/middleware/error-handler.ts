import { NextFunction, Request, Response } from "express";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public error = "Error"
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorHandler(
  error: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: error.error,
      message: error.message,
      statusCode: error.statusCode,
    });
    return;
  }
  console.error("Unhandled error:", error);
  res.status(500).json({
    error: "Internal Server Error",
    message: "An unexpected error occurred",
    statusCode: 500,
  });
}
