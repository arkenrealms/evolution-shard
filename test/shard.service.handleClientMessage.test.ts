import { Service } from '../shard.service';

describe('arken/evolution/shard handleClientMessage', () => {
  test('returns invalid payload error instead of throwing for undefined payload', async () => {
    const socket = {
      emit: jest.fn(),
      shardClient: { log: { errors: 0 }, emit: {} },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    await Service.prototype.handleClientMessage.call(serviceLike, socket, undefined);

    expect(socket.emit).toHaveBeenCalledWith(
      'trpcResponse',
      expect.objectContaining({ error: expect.stringContaining('Invalid trpc payload') })
    );
    expect(socket.shardClient.log.errors).toBe(1);
  });

  test('preserves explicit false params when dispatching to emit method', async () => {
    const mutate = jest.fn().mockResolvedValue({ status: 1 });
    const socket = {
      emit: jest.fn(),
      shardClient: {
        log: { errors: 0 },
        emit: { onPlayerUpdates: mutate },
      },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    await Service.prototype.handleClientMessage.call(serviceLike, socket, {
      id: 'abc',
      method: 'onPlayerUpdates',
      type: 'mutation',
      params: false,
    });

    expect(mutate).toHaveBeenCalledWith(false);
    expect(socket.emit).toHaveBeenCalledWith('trpcResponse', { id: 'abc', result: { status: 1 } });
  });

  test('onPlayerUpdates returns explicit success envelope', async () => {
    const response = await Service.prototype.onPlayerUpdates.call({}, {}, { client: {} });
    expect(response).toEqual({ status: 1 });
  });

  test('does not throw when socket.emit is unavailable on error path', async () => {
    const socket = {
      shardClient: { log: { errors: 0 }, emit: {} },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    await expect(Service.prototype.handleClientMessage.call(serviceLike, socket, undefined)).resolves.toBeUndefined();
    expect(socket.shardClient.log.errors).toBe(1);
  });
});
