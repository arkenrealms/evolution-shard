import { Service } from '../shard.service';

describe('Service.handleClientMessage', () => {
  it('returns invalid method error for missing method name', async () => {
    const emit = jest.fn();
    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    await Service.prototype.handleClientMessage.call(serviceLike as any, { emit }, { id: 10, params: {} });

    expect(emit).toHaveBeenCalledWith('trpcResponse', {
      id: 10,
      result: {},
      error: 'Invalid trpc method',
    });
  });

  it('returns invalid payload when method target is not callable', async () => {
    const emit = jest.fn();
    const socket = {
      emit,
      shardClient: {
        emit: {},
        log: { errors: 0 },
      },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    await Service.prototype.handleClientMessage.call(serviceLike as any, socket, {
      id: 11,
      method: 'unknownMethod',
      params: { a: 1 },
    });

    expect(emit).toHaveBeenCalledWith(
      'trpcResponse',
      expect.objectContaining({ id: 11, result: {}, error: expect.stringContaining('Invalid trpc payload') })
    );
    expect(socket.shardClient.log.errors).toBe(1);
  });

  it('handles runtime errors without shardClient and still emits response', async () => {
    const emit = jest.fn();
    const socket = { emit };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    await Service.prototype.handleClientMessage.call(serviceLike as any, socket, {
      id: 12,
      method: 'missingTarget',
    });

    expect(emit).toHaveBeenCalledWith(
      'trpcResponse',
      expect.objectContaining({ id: 12, result: {}, error: expect.stringContaining('Invalid trpc payload') })
    );
    expect(serviceLike.disconnectClient).not.toHaveBeenCalled();
  });

  it('forwards explicit falsy params to target methods', async () => {
    const emit = jest.fn();
    const mutate = jest.fn().mockResolvedValue({ ok: true });
    const socket = {
      emit,
      shardClient: {
        emit: {
          setFlag: mutate,
        },
      },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    await Service.prototype.handleClientMessage.call(serviceLike as any, socket, {
      id: 13,
      method: 'setFlag',
      params: false,
    });

    expect(mutate).toHaveBeenCalledWith(false);
    expect(emit).toHaveBeenCalledWith('trpcResponse', { id: 13, result: { ok: true } });
  });
});

describe('Service.onPlayerUpdates', () => {
  it('returns success envelope', async () => {
    const result = await Service.prototype.onPlayerUpdates.call({} as any, {}, { client: {} as any });
    expect(result).toEqual({ status: 1 });
  });
});
