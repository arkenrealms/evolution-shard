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
});
