import * as util from '@arken/node/util';
import { GameloopService } from '../services/gameloop.service';

describe('auto mode smoke (multi client + collision areas)', () => {
  test('ticks multiple auto clients and falls back for obstructed computed targets', () => {
    const now = 1_700_000_000_000;

    const clientA: any = {
      id: 'smoke-a',
      name: 'Alpha',
      address: '0xa',
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

    const clientB: any = {
      id: 'smoke-b',
      name: 'Bravo',
      address: '0xb',
      position: { x: 1, y: 1 },
      clientTarget: { x: 1, y: 1 },
      target: { x: 1, y: 1 },
      isDisconnected: false,
      isDead: false,
      isSpectating: false,
      isJoining: false,
      lastReportedTime: 0,
      lastUpdate: 0,
    };

    const app: any = {
      autoModeClients: {
        [clientA.id]: {
          clientId: clientA.id,
          expiresAt: now + 60_000,
          nextDecisionAt: now,
          pattern: 'wander',
        },
        [clientB.id]: {
          clientId: clientB.id,
          expiresAt: now + 60_000,
          nextDecisionAt: now,
          pattern: 'wander',
        },
      },
      autoModeDiagnostics: undefined,
      clientLookup: {
        [clientA.id]: clientA,
        [clientB.id]: clientB,
      },
      emit: {
        onBroadcast: {
          mutate: jest.fn(),
        },
      },
      mapBoundary: { x: { min: -25, max: 25 }, y: { min: -25, max: 25 } },
      spawnBoundary1: { x: { min: -20, max: 20 }, y: { min: -20, max: 20 } },
      spawnBoundary2: { x: { min: -20, max: 20 }, y: { min: -20, max: 20 } },
      config: {
        level2open: false,
      },
    };

    const gameloop = new GameloopService(app);

    const getUnobstructedSpy = jest
      .spyOn(gameloop as any, 'getUnobstructedPosition')
      .mockReturnValueOnce({ x: 9, y: 9 } as any) // client A initial candidate
      .mockReturnValueOnce({ x: -5, y: 4 } as any) // client A fallback from collision area
      .mockReturnValueOnce({ x: 6, y: -6 } as any); // client B wander target

    const obstructedSpy = jest
      .spyOn(gameloop as any, 'isPositionObstructed')
      .mockImplementation((position: any) => Math.abs(position.x) === 3 && position.y === 0);

    const randomSpy = jest.spyOn(util.number, 'random').mockImplementation(((min: number, max: number) => {
      if (min === 1100 && max === 2600) return 1600;
      if (min === 800 && max === 1700) return 1000;
      if (min === 1200 && max === 2400) return 1800;
      if (min === 1.6 && max === 4.2) return 3;
      if (min === -1.3 && max === 1.3) return 0;
      return min;
    }) as any);

    const mathRandomSpy = jest
      .spyOn(Math, 'random')
      .mockReturnValueOnce(0.7) // client A => zigzag, computed target {3,0} (mocked obstructed)
      .mockReturnValueOnce(0.2); // client B => wander

    (gameloop as any).tickAutoModeClients(now);

    expect(clientA.clientTarget).toEqual({ x: -5, y: 4 });
    expect(clientA.target).toEqual({ x: -5, y: 4 });

    expect(clientB.clientTarget).toEqual({ x: 6, y: -6 });
    expect(clientB.target).toEqual({ x: 6, y: -6 });

    expect(clientA.lastReportedTime).toBe(now);
    expect(clientA.lastUpdate).toBe(now);
    expect(clientB.lastReportedTime).toBe(now);
    expect(clientB.lastUpdate).toBe(now);

    expect(app.autoModeDiagnostics).toEqual(
      expect.objectContaining({
        ticks: 2,
        decisions: 2,
        fallbackTargets: 1,
      })
    );

    mathRandomSpy.mockRestore();
    randomSpy.mockRestore();
    obstructedSpy.mockRestore();
    getUnobstructedSpy.mockRestore();
  });
});
