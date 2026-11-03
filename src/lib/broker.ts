import amqplib, { ChannelModel, ConfirmChannel, ConsumeMessage } from "amqplib";

const EXCHANGE = "hotelsync.events";
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost:5672";
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 15000;
const MAX_DELIVERY_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1000, 5000, 30000];
const RETRY_COUNT_HEADER = "x-retry-count";
const LAST_ERROR_HEADER = "x-last-error";

let channel: ConfirmChannel | null = null;
let connecting: Promise<ConfirmChannel> | null = null;

export async function connect(): Promise<ConfirmChannel> {
  if (channel) return channel;
  connecting ??= (async () => {
    let attempt = 0;
    for (;;) {
      try {
        const connection: ChannelModel = await amqplib.connect(RABBITMQ_URL);
        connection.on("error", () => {});
        connection.on("close", async () => {
          channel = null;
          connecting = null;
          await sleep(RETRY_BASE_MS);
          void connect();
        });
        const next = await connection.createConfirmChannel();
        await next.assertExchange(EXCHANGE, "topic", { durable: true });
        channel = next;
        return next;
      } catch (error) {
        attempt += 1;
        const delay = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS);
        console.warn(`[channel-manager] broker connect failed; retry in ${delay}ms`, error);
        await sleep(delay);
      }
    }
  })();
  return connecting;
}

export async function consume(
  queue: string,
  routingKeys: string[],
  handler: (routingKey: string, payload: unknown) => Promise<void>,
  prefetch = 10
): Promise<void> {
  const consumer = await connect();
  const deadLetterQueue = `${queue}.dlq`;
  await consumer.assertQueue(queue, { durable: true });
  await consumer.assertQueue(deadLetterQueue, { durable: true });
  for (const key of routingKeys) await consumer.bindQueue(queue, EXCHANGE, key);
  await consumer.prefetch(prefetch);
  await consumer.consume(
    queue,
    (message: ConsumeMessage | null) => {
      if (!message) return;
      void handleDelivery(consumer, queue, deadLetterQueue, handler, message);
    },
    { noAck: false }
  );
}

async function handleDelivery(
  consumer: ConfirmChannel,
  queue: string,
  deadLetterQueue: string,
  handler: (routingKey: string, payload: unknown) => Promise<void>,
  message: ConsumeMessage
): Promise<void> {
  const routingKey = message.fields.routingKey;
  const attempts = retryCount(message);
  try {
    await handler(routingKey, JSON.parse(message.content.toString()) as unknown);
    consumer.ack(message);
  } catch (error) {
    const reason = describeError(error);
    if (attempts >= MAX_DELIVERY_ATTEMPTS) {
      console.error(
        `[channel-manager] failed ${routingKey}; dead-lettering after ${attempts} retries`,
        error
      );
      republish(consumer, deadLetterQueue, message, attempts, reason, () => consumer.ack(message));
      return;
    }
    const delay = RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length - 1)];
    console.error(
      `[channel-manager] failed ${routingKey}; retry ${attempts + 1}/${MAX_DELIVERY_ATTEMPTS} in ${delay}ms`,
      error
    );
    republish(
      consumer,
      queue,
      message,
      attempts + 1,
      reason,
      () => consumer.ack(message),
      delay
    );
  }
}

function republish(
  consumer: ConfirmChannel,
  targetQueue: string,
  message: ConsumeMessage,
  attempts: number,
  reason: string,
  done: () => void,
  delay = 0
): void {
  const publish = (): void => {
    try {
      consumer.sendToQueue(
        targetQueue,
        message.content,
        {
          persistent: true,
          contentType: message.properties.contentType ?? "application/json",
          messageId: message.properties.messageId,
          headers: {
            ...(message.properties.headers ?? {}),
            [RETRY_COUNT_HEADER]: attempts,
            [LAST_ERROR_HEADER]: reason,
          },
        },
        (error) => {
          if (error) {
            console.error(
              `[channel-manager] failed to republish to ${targetQueue}; requeueing`,
              error
            );
            consumer.nack(message, false, true);
            return;
          }
          done();
        }
      );
    } catch (error) {
      console.error(`[channel-manager] failed to republish to ${targetQueue}; requeueing`, error);
      consumer.nack(message, false, true);
    }
  };

  if (delay > 0) setTimeout(publish, delay);
  else publish();
}

function retryCount(message: ConsumeMessage): number {
  const raw = message.properties.headers?.[RETRY_COUNT_HEADER];
  const parsed = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? 0), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
