import { Service } from './shard.service';

describe('evolution shard Service.onPlayerUpdates', () => {
  test('returns success status envelope', async () => {
    const service = Object.create(Service.prototype) as Service;

    const result = await service.onPlayerUpdates(
      { position: '0:0', target: '1:1', exp: 0 } as any,
      { client: { id: 'c1' } as any }
    );

    expect(result).toEqual({ status: 1 });
  });
});
