import { Service } from './shard.service';

describe('evolution shard Service message handlers', () => {
  test('onPlayerUpdates returns success status envelope', async () => {
    const service = Object.create(Service.prototype) as Service;

    const result = await service.onPlayerUpdates(
      { position: '0:0', target: '1:1', exp: 0 } as any,
      { client: { id: 'c1' } as any }
    );

    expect(result).toEqual({ status: 1 });
  });

  test('handleClientMessage responds gracefully to malformed payloads', async () => {
    const emit = jest.fn();
    const service = Object.create(Service.prototype) as Service;

    await service.handleClientMessage({ emit, shardClient: {} } as any, null);

    expect(emit).toHaveBeenCalledWith('trpcResponse', {
      id: undefined,
      result: {},
      error: 'Invalid trpc payload',
    });
  });

  test('handleClientMessage responds gracefully to missing method names', async () => {
    const emit = jest.fn();
    const service = Object.create(Service.prototype) as Service;

    await service.handleClientMessage({ emit, shardClient: {} } as any, { id: 'abc', params: { x: 1 } });

    expect(emit).toHaveBeenCalledWith('trpcResponse', {
      id: 'abc',
      result: {},
      error: 'Invalid trpc method',
    });
  });

  test('handleClientMessage returns trpc error when shardClient is missing on runtime exception', async () => {
    const emit = jest.fn();
    const service = Object.create(Service.prototype) as Service;
    service.loggableEvents = [];

    await service.handleClientMessage({ emit } as any, { id: 'e1', method: 'join', params: {} });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      'trpcResponse',
      expect.objectContaining({
        id: 'e1',
        result: {},
      })
    );
  });

  test('handleClientMessage initializes missing error counter before incrementing', async () => {
    const emit = jest.fn();
    const service = Object.create(Service.prototype) as Service;
    service.loggableEvents = [];

    const socket = {
      emit,
      shardClient: {
        emit: {
          join: jest.fn().mockRejectedValue(new Error('boom')),
        },
        log: {},
      },
    };

    await service.handleClientMessage(socket as any, { id: 'e2', method: 'join', params: {} });

    expect(socket.shardClient.log.errors).toBe(1);
    expect(emit).toHaveBeenCalledWith(
      'trpcResponse',
      expect.objectContaining({
        id: 'e2',
        result: {},
      })
    );
  });
});
