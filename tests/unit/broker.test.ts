jest.mock("amqplib", () => ({ __esModule: true, default: { connect: jest.fn() } }));

type Handler = (routingKey: string, payload: unknown) => Promise<void>;

function makeConsumer() {
  return {
    assertExchange: jest.fn().mockResolvedValue(undefined),
    assertQueue: jest.fn().mockResolvedValue(undefined),
    bindQueue: jest.fn().mockResolvedValue(undefined),
    prefetch: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn().mockResolvedValue(undefined),
    ack: jest.fn(),
    nack: jest.fn(),
    sendToQueue: jest.fn((_queue: string, _content: Buffer, _options: unknown, callback?: (error: unknown) => void) => {
      callback?.(null);
      return true;
    }),
  };
}

function makeMessage(retryCount = 0) {
  return {
    fields: { routingKey: "booking.confirmed" },
    properties: {
      contentType: "application/json",
      messageId: "msg-1",
      headers: retryCount > 0 ? { "x-retry-count": retryCount } : {},
    },
    content: Buffer.from(JSON.stringify({ booking_id: "b-1" })),
  } as any;
}

async function setup(handler: Handler) {
  jest.resetModules();
  const amqplib = (await import("amqplib")).default as unknown as { connect: jest.Mock };
  const broker = await import("../../src/lib/broker.js");
  const consumer = makeConsumer();
  amqplib.connect.mockResolvedValue({
    on: jest.fn(),
    createConfirmChannel: jest.fn().mockResolvedValue(consumer),
  });

  await broker.consume("channel.queue", ["booking.confirmed"], handler);
  const callback = (consumer.consume as jest.Mock).mock.calls[0][1] as (message: unknown) => void;
  return { consumer, callback };
}

describe("broker retry policy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("acks the message when the handler succeeds", async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    const { consumer, callback } = await setup(handler);

    callback(makeMessage());
    await jest.advanceTimersByTimeAsync(0);

    expect(handler).toHaveBeenCalledWith("booking.confirmed", { booking_id: "b-1" });
    expect(consumer.ack).toHaveBeenCalledTimes(1);
    expect(consumer.sendToQueue).not.toHaveBeenCalled();
  });

  it("republishes with backoff and an incremented retry counter instead of requeueing immediately", async () => {
    const handler = jest.fn().mockRejectedValue(new Error("upstream down"));
    const { consumer, callback } = await setup(handler);

    callback(makeMessage());
    await jest.advanceTimersByTimeAsync(0);
    expect(consumer.sendToQueue).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1000);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(consumer.sendToQueue).toHaveBeenCalledTimes(1);
    expect(consumer.sendToQueue.mock.calls[0][0]).toBe("channel.queue");
    expect(consumer.sendToQueue.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        persistent: true,
        headers: expect.objectContaining({
          "x-retry-count": 1,
          "x-last-error": "upstream down",
        }),
      })
    );
    expect(consumer.ack).toHaveBeenCalledTimes(1);
    expect(consumer.nack).not.toHaveBeenCalled();
  });

  it("grows the delay between attempts", async () => {
    const handler = jest.fn().mockRejectedValue(new Error("upstream down"));
    const { consumer, callback } = await setup(handler);

    callback(makeMessage(1));
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(4999);
    expect(consumer.sendToQueue).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(consumer.sendToQueue).toHaveBeenCalledTimes(1);
    expect(consumer.sendToQueue.mock.calls[0][2]).toEqual(
      expect.objectContaining({ headers: expect.objectContaining({ "x-retry-count": 2 }) })
    );
  });

  it("dead-letters the message after the retry budget is exhausted", async () => {
    const handler = jest.fn().mockRejectedValue(new Error("upstream down"));
    const { consumer, callback } = await setup(handler);

    callback(makeMessage(3));
    await jest.advanceTimersByTimeAsync(0);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(consumer.sendToQueue).toHaveBeenCalledTimes(1);
    expect(consumer.sendToQueue.mock.calls[0][0]).toBe("channel.queue.dlq");
    expect(consumer.ack).toHaveBeenCalledTimes(1);
    expect(consumer.nack).not.toHaveBeenCalled();
  });

  it("requeues only when the republish itself fails", async () => {
    const handler = jest.fn().mockRejectedValue(new Error("upstream down"));
    const { consumer, callback } = await setup(handler);
    consumer.sendToQueue.mockImplementationOnce((_q: string, _c: Buffer, _o: unknown, callback?: (error: unknown) => void) => {
      callback?.(new Error("channel closed"));
      return false;
    });

    callback(makeMessage(3));
    await jest.advanceTimersByTimeAsync(0);

    expect(consumer.nack).toHaveBeenCalledWith(expect.anything(), false, true);
    expect(consumer.ack).not.toHaveBeenCalled();
  });
});
