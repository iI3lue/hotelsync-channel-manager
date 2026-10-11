import express from "express";
import { errorHandler } from "./middleware/error-handler.js";
import simulatorRouter from "./routes/simulator.js";
import { startEventsConsumer } from "./lib/events-consumer.js";

const app = express();
const PORT = process.env.PORT || 3008;

app.use(express.json({ limit: "256kb" }));

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "channel-manager-service",
  });
});

app.use("/v1/simulator", simulatorRouter);
app.use(errorHandler);

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Channel Manager Service running on port ${PORT}`);
  });
  if (process.env.RABBITMQ_URL) {
    startEventsConsumer().catch((error) =>
      console.error("[channel-manager] event consumer failed to start", error)
    );
    console.log("Channel Manager simulator consumer started");
  }
}

export default app;
