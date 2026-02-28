import { ClientService } from '../services/client.service';

describe('ClientService auto mode', () => {
  const makeClient = () => ({
    id: 'c1',
    name: 'AutoDragon',
    address: '0xabc',
    isSpectating: false,
    isDead: false,
    isJoining: false,
    lastUpdate: 0,
  });

  const makeCtx = () => ({
    autoModeClients: {},
    config: {
      isMaintenance: false,
      forcedLatency: Number.MAX_SAFE_INTEGER,
    },
    emit: {
      onBroadcast: {
        mutate: jest.fn(),
      },
      onMaintenance: {
        mutate: jest.fn(),
      },
    },
    disconnectClient: jest.fn(),
  });

  test('enables auto mode with 24h ttl and records player identity', async () => {
    const client = makeClient();
    const ctx: any = makeCtx();
    const service = new ClientService(ctx);

    const now = 1000;
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);

    const res: any = await service.toggleAutoMode({ enabled: true } as any, { client } as any);

    expect(res).toEqual({ status: 1 });
    expect(ctx.autoModeClients[client.id]).toEqual(
      expect.objectContaining({
        clientId: client.id,
        address: client.address,
        name: client.name,
        enabledAt: now,
        expiresAt: now + 24 * 60 * 60 * 1000,
      })
    );
    expect(ctx.emit.onBroadcast.mutate).toHaveBeenCalledWith(['Auto mode enabled for up to 24h', 0], {
      context: { client },
    });

    spy.mockRestore();
  });

  test('disables auto mode and removes tracked state', async () => {
    const client = makeClient();
    const ctx: any = makeCtx();
    ctx.autoModeClients[client.id] = { clientId: client.id };
    const service = new ClientService(ctx);

    const res: any = await service.toggleAutoMode({ enabled: false } as any, { client } as any);

    expect(res).toEqual({ status: 1 });
    expect(ctx.autoModeClients[client.id]).toBeUndefined();
    expect(ctx.emit.onBroadcast.mutate).toHaveBeenCalledWith(['Auto mode disabled', 0], {
      context: { client },
    });
  });

  test('rejects toggling while spectating or dead', async () => {
    const client = { ...makeClient(), isSpectating: true };
    const ctx: any = makeCtx();
    const service = new ClientService(ctx);

    await expect(service.toggleAutoMode({ enabled: true } as any, { client } as any)).rejects.toThrow(
      'Cannot toggle auto mode while spectating/dead'
    );
  });

  test('rebinds auto mode session to reconnecting client with same address', () => {
    const ctx: any = makeCtx();
    const service = new ClientService(ctx);

    ctx.autoModeClients = {
      oldClientId: {
        clientId: 'oldClientId',
        address: '0xabc',
        name: 'OldName',
        enabledAt: 100,
        expiresAt: 200,
        nextDecisionAt: 120,
        pattern: 'wander',
      },
    };

    service.rebindAutoModeSessionByAddress({ id: 'newClientId', address: '0xabc', name: 'NewName' } as any);

    expect(ctx.autoModeClients.oldClientId).toBeUndefined();
    expect(ctx.autoModeClients.newClientId).toEqual(
      expect.objectContaining({
        clientId: 'newClientId',
        address: '0xabc',
        name: 'NewName',
        enabledAt: 100,
        expiresAt: 200,
      })
    );
  });

  test('keeps longest-lived session when multiple stale entries share same address', () => {
    const ctx: any = makeCtx();
    const service = new ClientService(ctx);

    ctx.autoModeClients = {
      older: {
        clientId: 'older',
        address: '0xabc',
        name: 'A',
        enabledAt: 100,
        expiresAt: 1000,
        nextDecisionAt: 120,
        pattern: 'wander',
      },
      newer: {
        clientId: 'newer',
        address: '0xabc',
        name: 'B',
        enabledAt: 200,
        expiresAt: 2000,
        nextDecisionAt: 220,
        pattern: 'orbit',
      },
    };

    service.rebindAutoModeSessionByAddress({ id: 'reconnected', address: '0xabc', name: 'Player' } as any);

    expect(Object.keys(ctx.autoModeClients)).toEqual(['reconnected']);
    expect(ctx.autoModeClients.reconnected).toEqual(
      expect.objectContaining({
        clientId: 'reconnected',
        address: '0xabc',
        name: 'Player',
        expiresAt: 2000,
        pattern: 'orbit',
      })
    );
  });

  test('dedupes reconnect sessions even when current client id already has auto mode state', () => {
    const ctx: any = makeCtx();
    const service = new ClientService(ctx);

    ctx.autoModeClients = {
      newClientId: {
        clientId: 'newClientId',
        address: '0xabc',
        name: 'Current',
        enabledAt: 300,
        expiresAt: 1500,
        nextDecisionAt: 320,
        pattern: 'wander',
      },
      staleClientId: {
        clientId: 'staleClientId',
        address: '0xabc',
        name: 'Stale',
        enabledAt: 100,
        expiresAt: 2200,
        nextDecisionAt: 120,
        pattern: 'orbit',
      },
    };

    service.rebindAutoModeSessionByAddress({ id: 'newClientId', address: '0xabc', name: 'Player' } as any);

    expect(Object.keys(ctx.autoModeClients)).toEqual(['newClientId']);
    expect(ctx.autoModeClients.newClientId).toEqual(
      expect.objectContaining({
        clientId: 'newClientId',
        address: '0xabc',
        name: 'Player',
        expiresAt: 2200,
        pattern: 'orbit',
      })
    );
  });

  test('manual update disables auto mode session', async () => {
    const client: any = makeClient();
    const ctx: any = makeCtx();
    const service = new ClientService(ctx);

    ctx.autoModeClients[client.id] = {
      clientId: client.id,
      address: client.address,
      name: client.name,
      enabledAt: 100,
      expiresAt: 200,
      nextDecisionAt: 120,
      pattern: 'wander',
    };

    await service.updateMyself({ position: '0:0', target: '0:0', time: '0' } as any, { client } as any);

    expect(ctx.autoModeClients[client.id]).toBeUndefined();
    expect(ctx.emit.onBroadcast.mutate).toHaveBeenCalledWith(['Auto mode disabled due to manual movement', 0], {
      context: { client },
    });
  });

  test('rejects enabling auto mode during maintenance for non-mod clients', async () => {
    const client: any = { ...makeClient(), isMod: false };
    const ctx: any = makeCtx();
    ctx.config.isMaintenance = true;
    const service = new ClientService(ctx);

    await expect(service.toggleAutoMode({ enabled: true } as any, { client } as any)).rejects.toThrow('Unauthorized');
  });

  test('spectate transition disables active auto mode', async () => {
    const client: any = {
      ...makeClient(),
      log: { spectating: 0 },
      isInvincible: false,
      avatar: 'a',
      speed: 5,
      cameraSize: 4,
      overrideSpeed: undefined,
      overrideCameraSize: undefined,
    };
    const ctx: any = {
      ...makeCtx(),
      config: { ...makeCtx().config, startAvatar: 'starter' },
      services: { gameloop: { syncSprites: jest.fn() } },
      emitAll: { onSpectate: { mutate: jest.fn() } },
    };
    const service = new ClientService(ctx);

    ctx.autoModeClients[client.id] = {
      clientId: client.id,
      address: client.address,
      name: client.name,
      enabledAt: 100,
      expiresAt: 200,
      nextDecisionAt: 120,
      pattern: 'wander',
    };

    await service.spectate(null as any, { client } as any);

    expect(ctx.autoModeClients[client.id]).toBeUndefined();
    expect(ctx.emit.onBroadcast.mutate).toHaveBeenCalledWith(['Auto mode disabled due to spectate', 0], {
      context: { client },
    });
    expect(client.isSpectating).toBe(true);
  });
});
