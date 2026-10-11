import amqplib, { ChannelModel, ConfirmChannel, ConsumeMessage } from "amqplib";

const EXCHANGE = "hotelsync.events";
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost:5672";
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 15000;

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
  await consumer.assertQueue(queue, { durable: true });
  for (const key of routingKeys) await consumer.bindQueue(queue, EXCHANGE, key);
  await consumer.prefetch(prefetch);
  await consumer.consume(
    queue,
    async (message: ConsumeMessage | null) => {
      if (!message) return;
      try {
        await handler(
          message.fields.routingKey,
          JSON.parse(message.content.toString()) as unknown
        );
        consumer.ack(message);
      } catch (error) {
        console.error(`[channel-manager] failed ${message.fields.routingKey}; requeue`, error);
        consumer.nack(message, false, true);
      }
    },
    { noAck: false }
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
