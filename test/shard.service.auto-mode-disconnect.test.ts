import { Service } from '../shard.service';

describe('Shard Service auto mode disconnect cleanup', () => {
  test('disconnectClient removes auto mode state for disconnected client id', () => {
    const client: any = {
      id: 'c-1',
      name: 'AutoDragon',
      isRealm: false,
      isDisconnected: false,
      isDead: false,
      joinedAt: 1,
      latency: 55,
    };

    const app: any = {
      clients: [client],
      clientLookup: { 'c-1': client },
      autoModeClients: {
        'c-1': {
          clientId: 'c-1',
          address: '0xabc',
          name: 'AutoDragon',
          enabledAt: 100,
          expiresAt: 200,
        },
      },
      sockets: {},
      queuedClients: [],
      config: { gameMode: 'Classic', maxClients: 100 },
      emitAll: {
        onBroadcast: { mutate: jest.fn() },
        onDisconnected: { mutate: jest.fn() },
      },
      services: {
        gameloop: {
          syncSprites: jest.fn(),
          flushEventQueue: jest.fn(),
        },
      },
      forceJoin: jest.fn(),
      pandas: [],
    };

    const timeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(((fn: any) => {
      fn();
      return 0 as any;
    }) as any);

    Service.prototype.disconnectClient.call(app, client, 'test', true);

    expect(app.autoModeClients['c-1']).toBeUndefined();
    expect(app.clientLookup['c-1']).toBeUndefined();
    expect(app.clients).toEqual([]);

    timeoutSpy.mockRestore();
  });
});
