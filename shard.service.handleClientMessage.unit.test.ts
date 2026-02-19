import { Service } from './shard.service';

describe('Service.handleClientMessage', () => {
  function createBaseContext() {
    return {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    } as unknown as Service;
  }

  test('returns structured error when payload is invalid', async () => {
    const ctx = createBaseContext();
    const socket = { emit: jest.fn(), shardClient: { log: { errors: 0 } } };

    await Service.prototype.handleClientMessage.call(ctx, socket, null);

    expect(socket.emit).toHaveBeenCalledWith('trpcResponse', {
      id: null,
      result: {},
      error: 'Invalid trpc payload',
    });
  });

  test('returns structured error when method is missing', async () => {
    const ctx = createBaseContext();
    const socket = { emit: jest.fn(), shardClient: { log: { errors: 0 } } };

    await Service.prototype.handleClientMessage.call(ctx, socket, { id: 7, params: { a: 1 } });

    expect(socket.emit).toHaveBeenCalledWith('trpcResponse', {
      id: 7,
      result: {},
      error: 'Invalid trpc method',
    });
  });

  test('does not throw when shardClient is missing in error path', async () => {
    const ctx = createBaseContext();
    const socket = { emit: jest.fn() };

    await Service.prototype.handleClientMessage.call(ctx, socket, { id: 2, method: 'missingMethod' });

    expect(socket.emit).toHaveBeenCalledWith(
      'trpcResponse',
      expect.objectContaining({ id: 2, result: {}, error: expect.any(String) })
    );
  });
});
