import { ClientService } from '../services/client.service';
import { GameloopService } from '../services/gameloop.service';

describe('auto mode smoke (single client)', () => {
  test('enables one client and drives server-side target updates in fast-loop tick', async () => {
    const now = 1_700_000_000_000;
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);

    const client: any = {
      id: 'smoke-c1',
      address: '0xsmoke',
      name: 'SmokeDragon',
      position: { x: 0, y: 0 },
      clientTarget: { x: 0, y: 0 },
      target: { x: 0, y: 0 },
      isDisconnected: false,
      isDead: false,
      isSpectating: false,
      isJoining: false,
      lastReportedTime: 0,
      lastUpdate: 0,
    };

    const app: any = {
      autoModeClients: {},
      autoModeDiagnostics: undefined,
      clientLookup: { [client.id]: client },
      mapBoundary: { x: { min: -25, max: 25 }, y: { min: -25, max: 25 } },
      spawnBoundary1: { x: { min: -20, max: 20 }, y: { min: -20, max: 20 } },
      spawnBoundary2: { x: { min: -20, max: 20 }, y: { min: -20, max: 20 } },
      config: {
        isMaintenance: false,
        level2open: false,
      },
      emit: {
        onBroadcast: {
          mutate: jest.fn(),
        },
      },
    };

    const clientService = new ClientService(app);
    const gameloop = new GameloopService(app);

    const enableRes = await clientService.toggleAutoMode({ enabled: true } as any, { client } as any);
    expect(enableRes).toEqual({ status: 1 });
    expect(app.autoModeClients[client.id]).toBeTruthy();

    (gameloop as any).tickAutoModeClients(now + 1000);

    expect(client.lastReportedTime).toBe(now + 1000);
    expect(client.lastUpdate).toBe(now + 1000);
    expect(Number.isFinite(client.clientTarget.x)).toBe(true);
    expect(Number.isFinite(client.clientTarget.y)).toBe(true);
    expect(client.clientTarget.x).toBeGreaterThanOrEqual(app.mapBoundary.x.min);
    expect(client.clientTarget.x).toBeLessThanOrEqual(app.mapBoundary.x.max);
    expect(client.clientTarget.y).toBeGreaterThanOrEqual(app.mapBoundary.y.min);
    expect(client.clientTarget.y).toBeLessThanOrEqual(app.mapBoundary.y.max);

    const disableRes = await clientService.toggleAutoMode({ enabled: false } as any, { client } as any);
    expect(disableRes).toEqual({ status: 1 });
    expect(app.autoModeClients[client.id]).toBeUndefined();

    dateNowSpy.mockRestore();
  });
});
