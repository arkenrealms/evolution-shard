jest.mock('@arken/node/log', () => ({ log: jest.fn() }), { virtual: true });

import * as util from '@arken/node/util';
import { log } from '@arken/node/log';
import { ClientService } from '../services/client.service';
import { GameloopService } from '../services/gameloop.service';

describe('auto mode', () => {
  describe('ClientService.toggleAutoMode', () => {
    test('enables auto mode with 24h expiry and broadcasts confirmation', async () => {
      const mutate = jest.fn();
      const ctx: any = {
        autoModeClients: {},
        config: { isMaintenance: false },
        emit: { onBroadcast: { mutate } },
      };

      const service = new ClientService(ctx);
      const client: any = {
        id: 'c-1',
        address: '0xabc',
        name: 'Test Dragon',
        isSpectating: false,
        isDead: false,
      };

      const now = 1_700_000_000_000;
      const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);

      const result = await service.toggleAutoMode({ enabled: true } as any, { client } as any);

      expect(result).toEqual({ status: 1 });
      expect(ctx.autoModeClients['c-1']).toEqual(
        expect.objectContaining({
          clientId: 'c-1',
          address: '0xabc',
          name: 'Test Dragon',
          enabledAt: now,
          expiresAt: now + 24 * 60 * 60 * 1000,
          pattern: 'wander',
          nextDecisionAt: now,
        })
      );
      expect(mutate).toHaveBeenCalledWith(['Auto mode enabled for up to 24h', 0], { context: { client } });

      dateNowSpy.mockRestore();
    });

    test('disables auto mode and broadcasts confirmation', async () => {
      const mutate = jest.fn();
      const ctx: any = {
        autoModeClients: {
          'c-1': { clientId: 'c-1' },
        },
        emit: { onBroadcast: { mutate } },
      };

      const service = new ClientService(ctx);
      const client: any = {
        id: 'c-1',
        name: 'Test Dragon',
        isSpectating: false,
        isDead: false,
      };

      const result = await service.toggleAutoMode({ enabled: false } as any, { client } as any);

      expect(result).toEqual({ status: 1 });
      expect(ctx.autoModeClients['c-1']).toBeUndefined();
      expect(mutate).toHaveBeenCalledWith(['Auto mode disabled', 0], { context: { client } });
    });
  });

  describe('GameloopService.tickAutoModeClients', () => {
    test('expires auto mode sessions and broadcasts expiry', () => {
      const client: any = {
        id: 'c-1',
        name: 'Test Dragon',
        isDisconnected: false,
        isDead: false,
        isSpectating: false,
        isJoining: false,
      };

      const mutate = jest.fn();
      const app: any = {
        autoModeClients: {
          'c-1': {
            clientId: 'c-1',
            expiresAt: 1000,
            nextDecisionAt: 1000,
            pattern: 'wander',
          },
        },
        clientLookup: { 'c-1': client },
        emit: { onBroadcast: { mutate } },
      };

      const gameloop = new GameloopService(app);
      (gameloop as any).tickAutoModeClients(1001);

      expect(app.autoModeClients['c-1']).toBeUndefined();
      expect(mutate).toHaveBeenCalledWith(['Auto mode expired after 24h', 0], { context: { client } });
    });

    test('expires exactly at ttl boundary and is jitter-safe (no early expiry before boundary)', () => {
      const client: any = {
        id: 'c-1',
        name: 'Jitter Dragon',
        position: { x: 0, y: 0 },
        clientPosition: { x: 0, y: 0 },
        clientTarget: { x: 0, y: 0 },
        target: { x: 0, y: 0 },
        isDisconnected: false,
        isDead: false,
        isSpectating: false,
        isJoining: false,
      };

      const mutate = jest.fn();
      const app: any = {
        autoModeClients: {
          'c-1': {
            clientId: 'c-1',
            expiresAt: 86_400_000,
            nextDecisionAt: Number.MAX_SAFE_INTEGER,
            pattern: 'wander',
          },
        },
        clientLookup: { 'c-1': client },
        emit: { onBroadcast: { mutate } },
      };

      const gameloop = new GameloopService(app);

      // Simulated loop jitter around 24h boundary: should not expire before boundary.
      (gameloop as any).tickAutoModeClients(86_399_998);
      expect(app.autoModeClients['c-1']).toBeDefined();
      expect(mutate).not.toHaveBeenCalled();

      (gameloop as any).tickAutoModeClients(86_399_999);
      expect(app.autoModeClients['c-1']).toBeDefined();
      expect(mutate).not.toHaveBeenCalled();

      // Exact boundary is treated as expired.
      (gameloop as any).tickAutoModeClients(86_400_000);
      expect(app.autoModeClients['c-1']).toBeUndefined();
      expect(mutate).toHaveBeenCalledTimes(1);
      expect(mutate).toHaveBeenCalledWith(['Auto mode expired after 24h', 0], { context: { client } });
    });

    test('updates diagnostics counters and emits periodic diagnostics log', () => {
      const client: any = {
        id: 'c-1',
        name: 'Test Dragon',
        position: { x: 0, y: 0 },
        clientPosition: { x: -9, y: -9 },
        clientTarget: { x: 0, y: 0 },
        target: { x: 0, y: 0 },
        isDisconnected: false,
        isDead: false,
        isSpectating: false,
        isJoining: false,
      };

      const app: any = {
        autoModeClients: {
          'c-1': {
            clientId: 'c-1',
            expiresAt: 120000,
            nextDecisionAt: 0,
            pattern: 'wander',
          },
        },
        clientLookup: { 'c-1': client },
        emit: { onBroadcast: { mutate: jest.fn() } },
        mapBoundary: { x: { min: -10, max: 10 }, y: { min: -10, max: 10 } },
      };

      const gameloop = new GameloopService(app);
      const getUnobstructedSpy = jest
        .spyOn(gameloop as any, 'getUnobstructedPosition')
        .mockReturnValue({ x: 1, y: 1 } as any);
      const obstructedSpy = jest.spyOn(gameloop as any, 'isPositionObstructed').mockReturnValue(false);
      const randomSpy = jest.spyOn(util.number, 'random').mockImplementation(((min: number, max: number) => {
        if (min === 1100 && max === 2600) return 1600;
        if (min === 800 && max === 1700) return 1200;
        if (min === 1200 && max === 2400) return 1800;
        return min;
      }) as any);
      const mathRandomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.2);

      (gameloop as any).tickAutoModeClients(60_000);

      expect(app.autoModeDiagnostics).toEqual(
        expect.objectContaining({
          ticks: 1,
          decisions: 1,
          expired: 0,
          removedInactive: 0,
          fallbackTargets: 0,
          lastLogAt: 60_000,
        })
      );
      expect(client.clientPosition).toEqual({ x: 0, y: 0 });
      expect(log).toHaveBeenCalledWith(
        '[AUTO_MODE_DIAGNOSTICS]',
        expect.objectContaining({ activeSessions: 1, ticks: 1, decisions: 1 })
      );

      mathRandomSpy.mockRestore();
      randomSpy.mockRestore();
      obstructedSpy.mockRestore();
      getUnobstructedSpy.mockRestore();
    });

    test('falls back to unobstructed target when computed target is out of map bounds', () => {
      const client: any = {
        id: 'c-1',
        position: { x: 0, y: 0 },
        clientTarget: { x: 0, y: 0 },
        target: { x: 0, y: 0 },
        isDisconnected: false,
        isDead: false,
        isSpectating: false,
        isJoining: false,
      };

      const app: any = {
        autoModeClients: {
          'c-1': {
            clientId: 'c-1',
            expiresAt: 999999,
            nextDecisionAt: 0,
            pattern: 'wander',
            anchor: { x: 10, y: 10 },
            orbitAngle: 0,
          },
        },
        clientLookup: { 'c-1': client },
        emit: { onBroadcast: { mutate: jest.fn() } },
        mapBoundary: { x: { min: -10, max: 10 }, y: { min: -10, max: 10 } },
      };

      const gameloop = new GameloopService(app);
      const fallbackTarget = { x: 1.234, y: -4.321 };
      const getUnobstructedSpy = jest
        .spyOn(gameloop as any, 'getUnobstructedPosition')
        .mockReturnValue(fallbackTarget as any);
      const obstructedSpy = jest.spyOn(gameloop as any, 'isPositionObstructed').mockReturnValue(false);
      const randomSpy = jest.spyOn(util.number, 'random').mockImplementation(((min: number, max: number) => {
        if (min === 1100 && max === 2600) return 1600;
        if (min === 800 && max === 1700) return 1200;
        if (min === 1200 && max === 2400) return 1800; // next decision delay (orbit)
        if (min === 0.45 && max === 0.9) return 0.9; // orbit angle step
        if (min === 1.1 && max === 2.6) return 2.6; // orbit radius
        return min;
      }) as any);
      const mathRandomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.9); // orbit

      (gameloop as any).tickAutoModeClients(100);

      expect(client.clientTarget).toEqual(fallbackTarget);
      expect(client.target).toEqual(fallbackTarget);
      expect(getUnobstructedSpy).toHaveBeenCalled();

      mathRandomSpy.mockRestore();
      randomSpy.mockRestore();
      obstructedSpy.mockRestore();
      getUnobstructedSpy.mockRestore();
    });

    test('falls back to unobstructed target when computed target is obstructed', () => {
      const client: any = {
        id: 'c-1',
        position: { x: 0, y: 0 },
        clientTarget: { x: 0, y: 0 },
        target: { x: 0, y: 0 },
        isDisconnected: false,
        isDead: false,
        isSpectating: false,
        isJoining: false,
      };

      const app: any = {
        autoModeClients: {
          'c-1': {
            clientId: 'c-1',
            expiresAt: 999999,
            nextDecisionAt: 0,
            pattern: 'wander',
            zigzagSide: -1,
          },
        },
        clientLookup: { 'c-1': client },
        emit: { onBroadcast: { mutate: jest.fn() } },
        mapBoundary: { x: { min: -10, max: 10 }, y: { min: -10, max: 10 } },
      };

      const gameloop = new GameloopService(app);
      const fallbackTarget = { x: -2.5, y: 2.5 };
      const getUnobstructedSpy = jest
        .spyOn(gameloop as any, 'getUnobstructedPosition')
        .mockReturnValue(fallbackTarget as any);
      const obstructedSpy = jest.spyOn(gameloop as any, 'isPositionObstructed').mockReturnValue(true);
      const randomSpy = jest.spyOn(util.number, 'random').mockImplementation(((min: number, max: number) => {
        if (min === 1100 && max === 2600) return 1600;
        if (min === 800 && max === 1700) return 1100; // next decision delay (zigzag)
        if (min === 1200 && max === 2400) return 1800;
        if (min === 1.6 && max === 4.2) return 3;
        if (min === -1.3 && max === 1.3) return 0;
        return min;
      }) as any);
      const mathRandomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.7); // zigzag

      (gameloop as any).tickAutoModeClients(100);

      expect(client.clientTarget).toEqual(fallbackTarget);
      expect(client.target).toEqual(fallbackTarget);
      expect(getUnobstructedSpy).toHaveBeenCalled();
      expect(obstructedSpy).toHaveBeenCalled();

      mathRandomSpy.mockRestore();
      randomSpy.mockRestore();
      obstructedSpy.mockRestore();
      getUnobstructedSpy.mockRestore();
    });

    test('handles missing map boundary defensively during auto tick decisions', () => {
      const client: any = {
        id: 'c-1',
        position: { x: 0, y: 0 },
        clientPosition: { x: 0, y: 0 },
        clientTarget: { x: 0, y: 0 },
        target: { x: 0, y: 0 },
        isDisconnected: false,
        isDead: false,
        isSpectating: false,
        isJoining: false,
      };

      const app: any = {
        autoModeClients: {
          'c-1': {
            clientId: 'c-1',
            expiresAt: 999999,
            nextDecisionAt: 0,
            pattern: 'wander',
          },
        },
        clientLookup: { 'c-1': client },
        emit: { onBroadcast: { mutate: jest.fn() } },
        mapBoundary: undefined,
      };

      const gameloop = new GameloopService(app);
      const fallbackTarget = { x: 2, y: 3 };
      const getUnobstructedSpy = jest
        .spyOn(gameloop as any, 'getUnobstructedPosition')
        .mockReturnValue(fallbackTarget as any);
      const obstructedSpy = jest.spyOn(gameloop as any, 'isPositionObstructed').mockReturnValue(false);
      const randomSpy = jest.spyOn(util.number, 'random').mockImplementation(((min: number) => min) as any);
      const mathRandomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.2);

      expect(() => (gameloop as any).tickAutoModeClients(100)).not.toThrow();
      expect(client.clientTarget).toEqual(fallbackTarget);

      mathRandomSpy.mockRestore();
      randomSpy.mockRestore();
      obstructedSpy.mockRestore();
      getUnobstructedSpy.mockRestore();
    });

    test('reuses previous valid target during fallback cooldown to reduce collision fallback frequency', () => {
      const client: any = {
        id: 'c-1',
        position: { x: 0, y: 0 },
        clientTarget: { x: 0, y: 0 },
        target: { x: 0, y: 0 },
        isDisconnected: false,
        isDead: false,
        isSpectating: false,
        isJoining: false,
      };

      const app: any = {
        autoModeClients: {
          'c-1': {
            clientId: 'c-1',
            expiresAt: 999999,
            nextDecisionAt: 0,
            pattern: 'wander',
            zigzagSide: -1,
          },
        },
        clientLookup: { 'c-1': client },
        emit: { onBroadcast: { mutate: jest.fn() } },
        mapBoundary: { x: { min: -10, max: 10 }, y: { min: -10, max: 10 } },
      };

      const gameloop = new GameloopService(app);
      const initialFallbackTarget = { x: -2.5, y: 2.5 };
      const getUnobstructedSpy = jest
        .spyOn(gameloop as any, 'getUnobstructedPosition')
        .mockReturnValue(initialFallbackTarget as any);
      const obstructedSpy = jest.spyOn(gameloop as any, 'isPositionObstructed').mockReturnValue(true);
      const randomSpy = jest.spyOn(util.number, 'random').mockImplementation(((min: number, max: number) => {
        if (min === 1100 && max === 2600) return 1200;
        if (min === 800 && max === 1700) return 800; // quick next decision
        if (min === 1200 && max === 2400) return 1400;
        if (min === 1.6 && max === 4.2) return 3;
        if (min === -1.3 && max === 1.3) return 0;
        return min;
      }) as any);
      const mathRandomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.7); // zigzag -> obstructed

      (gameloop as any).tickAutoModeClients(100);
      (gameloop as any).tickAutoModeClients(900); // still inside 2200ms fallback cooldown

      expect(client.clientTarget).toEqual(initialFallbackTarget);
      expect(app.autoModeDiagnostics.fallbackTargets).toBe(1);
      expect(app.autoModeClients['c-1'].lastFallbackAt).toBe(100);
      expect(app.autoModeClients['c-1'].consecutiveFallbacks).toBe(1);
      expect(obstructedSpy).toHaveBeenCalled();

      mathRandomSpy.mockRestore();
      randomSpy.mockRestore();
      obstructedSpy.mockRestore();
      getUnobstructedSpy.mockRestore();
    });

    test('keeps auto-mode session state bounded over long-running ticks and cleans up inactive clients', () => {
      const client: any = {
        id: 'c-1',
        name: 'LongRunner',
        position: { x: 1, y: 1 },
        clientPosition: { x: 1, y: 1 },
        clientTarget: { x: 1, y: 1 },
        target: { x: 1, y: 1 },
        isDisconnected: false,
        isDead: false,
        isSpectating: false,
        isJoining: false,
      };

      const app: any = {
        autoModeClients: {
          'c-1': {
            clientId: 'c-1',
            address: '0xabc',
            name: 'LongRunner',
            enabledAt: 0,
            expiresAt: 24 * 60 * 60 * 1000,
            nextDecisionAt: 0,
            pattern: 'wander',
          },
        },
        clientLookup: { 'c-1': client },
        emit: { onBroadcast: { mutate: jest.fn() } },
        mapBoundary: { x: { min: -10, max: 10 }, y: { min: -10, max: 10 } },
      };

      const gameloop = new GameloopService(app);
      const getUnobstructedSpy = jest
        .spyOn(gameloop as any, 'getUnobstructedPosition')
        .mockReturnValue({ x: 2, y: 2 } as any);
      const obstructedSpy = jest.spyOn(gameloop as any, 'isPositionObstructed').mockReturnValue(false);
      const randomSpy = jest.spyOn(util.number, 'random').mockImplementation(((min: number, max: number) => {
        if (min === 1100 && max === 2600) return 1300;
        if (min === 800 && max === 1700) return 900;
        if (min === 1200 && max === 2400) return 1500;
        if (min === 0.45 && max === 0.9) return 0.5;
        if (min === 1.1 && max === 2.6) return 1.4;
        if (min === 1.6 && max === 4.2) return 2;
        if (min === -1.3 && max === 1.3) return 0.1;
        return min;
      }) as any);
      const mathRandomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.2);

      for (let now = 1_000; now <= 300_000; now += 1_000) {
        (gameloop as any).tickAutoModeClients(now);
      }

      const state = app.autoModeClients['c-1'];
      expect(Object.keys(state).sort()).toEqual([
        'address',
        'clientId',
        'consecutiveFallbacks',
        'enabledAt',
        'expiresAt',
        'lastValidTarget',
        'name',
        'nextDecisionAt',
        'pattern',
      ]);
      expect(Object.keys(app.autoModeClients)).toEqual(['c-1']);

      client.isDisconnected = true;
      (gameloop as any).tickAutoModeClients(301_000);
      expect(app.autoModeClients['c-1']).toBeUndefined();
      expect(app.autoModeDiagnostics.removedInactive).toBeGreaterThanOrEqual(1);

      mathRandomSpy.mockRestore();
      randomSpy.mockRestore();
      obstructedSpy.mockRestore();
      getUnobstructedSpy.mockRestore();
    });
  });

  describe('GameloopService.shouldEmitPlayerUpdate', () => {
    test('throttles auto-mode player update emissions to prevent queue flooding', () => {
      const app: any = {
        autoModeClients: {
          'c-1': {
            clientId: 'c-1',
            expiresAt: 999999,
            nextDecisionAt: 0,
            pattern: 'wander',
          },
        },
        autoModeDiagnostics: {
          ticks: 0,
          decisions: 0,
          expired: 0,
          removedInactive: 0,
          fallbackTargets: 0,
          emittedPlayerUpdates: 0,
          skippedPlayerUpdates: 0,
          lastLogAt: 0,
        },
      };

      const gameloop = new GameloopService(app);
      const client: any = { id: 'c-1' };

      expect((gameloop as any).shouldEmitPlayerUpdate(client, 1000)).toBe(true);
      expect((gameloop as any).shouldEmitPlayerUpdate(client, 1050)).toBe(false);
      expect((gameloop as any).shouldEmitPlayerUpdate(client, 1130)).toBe(true);

      expect(app.autoModeDiagnostics.emittedPlayerUpdates).toBe(2);
      expect(app.autoModeDiagnostics.skippedPlayerUpdates).toBe(1);
    });
  });
});
