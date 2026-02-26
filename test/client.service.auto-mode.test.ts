import { ClientService } from '../services/client.service';

describe('ClientService.toggleAutoMode', () => {
  const makeClient = () => ({
    id: 'c1',
    name: 'AutoDragon',
    address: '0xabc',
    isSpectating: false,
    isDead: false,
  });

  const makeCtx = () => ({
    autoModeClients: {},
    emit: {
      onBroadcast: {
        mutate: jest.fn(),
      },
    },
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
});
