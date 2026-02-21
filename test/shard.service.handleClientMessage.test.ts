jest.mock('@arken/node/log', () => ({ log: jest.fn() }), { virtual: true });

import { log } from '@arken/node/log';
import { Service } from '../shard.service';

describe('arken/evolution/shard handleClientMessage', () => {
  test('returns invalid payload error instead of throwing for undefined payload', async () => {
    const socket = {
      emit: jest.fn(),
      shardClient: { log: { errors: 0 }, emit: {} },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    await Service.prototype.handleClientMessage.call(serviceLike, socket, undefined);

    expect(socket.emit).toHaveBeenCalledWith(
      'trpcResponse',
      expect.objectContaining({ error: expect.stringContaining('Invalid trpc payload') })
    );
    expect(socket.shardClient.log.errors).toBe(1);
  });

  test('preserves explicit false params when dispatching to emit method', async () => {
    const mutate = jest.fn().mockResolvedValue({ status: 1 });
    const socket = {
      emit: jest.fn(),
      shardClient: {
        log: { errors: 0 },
        emit: { onPlayerUpdates: mutate },
      },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    await Service.prototype.handleClientMessage.call(serviceLike, socket, {
      id: 'abc',
      method: 'onPlayerUpdates',
      type: 'mutation',
      params: false,
    });

    expect(mutate).toHaveBeenCalledWith(false);
    expect(socket.emit).toHaveBeenCalledWith('trpcResponse', { id: 'abc', result: { status: 1 } });
  });

  test('trims method names before dispatching to emit method', async () => {
    const mutate = jest.fn().mockResolvedValue({ status: 1 });
    const socket = {
      emit: jest.fn(),
      shardClient: {
        log: { errors: 0 },
        emit: { onPlayerUpdates: mutate },
      },
    };

    const serviceLike = {
      loggableEvents: ['onPlayerUpdates'],
      disconnectClient: jest.fn(),
    };

    await Service.prototype.handleClientMessage.call(serviceLike, socket, {
      id: 'trim-1',
      method: '  onPlayerUpdates  ',
      type: 'mutation',
      params: { x: 1 },
    });

    expect(mutate).toHaveBeenCalledWith({ x: 1 });
    expect(socket.emit).toHaveBeenCalledWith('trpcResponse', { id: 'trim-1', result: { status: 1 } });
  });

  test('logs method call result for normalized loggable event names', async () => {
    const mutate = jest.fn().mockResolvedValue({ status: 1 });
    const socket = {
      emit: jest.fn(),
      shardClient: {
        log: { errors: 0 },
        emit: { onPlayerUpdates: mutate },
      },
    };

    const serviceLike = {
      loggableEvents: ['onPlayerUpdates'],
      disconnectClient: jest.fn(),
    };

    await Service.prototype.handleClientMessage.call(serviceLike, socket, {
      id: 'trim-log-1',
      method: '  onPlayerUpdates  ',
      type: 'mutation',
      params: { x: 2 },
    });

    expect(log).toHaveBeenCalledWith('Shard client trpc method call result', { status: 1 });
  });

  test('dispatches successfully when loggableEvents is missing', async () => {
    const mutate = jest.fn().mockResolvedValue({ status: 1 });
    const socket = {
      emit: jest.fn(),
      shardClient: {
        log: { errors: 0 },
        emit: { onPlayerUpdates: mutate },
      },
    };

    const serviceLike = {
      disconnectClient: jest.fn(),
    };

    await expect(
      Service.prototype.handleClientMessage.call(serviceLike, socket, {
        id: 'missing-loggable-events',
        method: 'onPlayerUpdates',
        type: 'mutation',
        params: { hp: 8 },
      })
    ).resolves.toBeUndefined();

    expect(mutate).toHaveBeenCalledWith({ hp: 8 });
    expect(socket.emit).toHaveBeenCalledWith('trpcResponse', {
      id: 'missing-loggable-events',
      result: { status: 1 },
    });
    expect(socket.shardClient.log.errors).toBe(0);
  });

  test('rejects prototype-only methods on emit client', async () => {
    const inherited = { inheritedMethod: jest.fn() };
    const emit = Object.create(inherited);
    const socket = {
      emit: jest.fn(),
      shardClient: { log: { errors: 0 }, emit },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    await Service.prototype.handleClientMessage.call(serviceLike, socket, {
      id: 'proto-1',
      method: 'inheritedMethod',
      type: 'mutation',
      params: { any: 'value' },
    });

    expect(inherited.inheritedMethod).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'trpcResponse',
      expect.objectContaining({ id: 'proto-1', error: expect.stringContaining('Invalid trpc payload') })
    );
  });

  test('onPlayerUpdates returns explicit success envelope', async () => {
    const response = await Service.prototype.onPlayerUpdates.call({}, {}, { client: {} });
    expect(response).toEqual({ status: 1 });
  });

  test('does not throw when socket.emit is unavailable on error path', async () => {
    const socket = {
      shardClient: { log: { errors: 0 }, emit: {} },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    await expect(Service.prototype.handleClientMessage.call(serviceLike, socket, undefined)).resolves.toBeUndefined();
    expect(socket.shardClient.log.errors).toBe(1);
  });

  test('does not throw when shardClient.log is non-object', async () => {
    const socket = {
      emit: jest.fn(),
      shardClient: { log: 'broken-log-shape', emit: {} },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    await expect(Service.prototype.handleClientMessage.call(serviceLike, socket, undefined)).resolves.toBeUndefined();

    expect(socket.emit).toHaveBeenCalledWith(
      'trpcResponse',
      expect.objectContaining({ error: expect.stringContaining('Invalid trpc payload') })
    );
    expect(serviceLike.disconnectClient).not.toHaveBeenCalled();
  });

  test('returns invalid payload error for blank string payloads', async () => {
    const socket = {
      emit: jest.fn(),
      shardClient: { log: { errors: 0 }, emit: {} },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    await expect(Service.prototype.handleClientMessage.call(serviceLike, socket, '   ')).resolves.toBeUndefined();

    expect(socket.shardClient.log.errors).toBe(1);
    expect(socket.emit).toHaveBeenCalledWith(
      'trpcResponse',
      expect.objectContaining({ error: expect.stringContaining('Invalid trpc payload') })
    );
  });

  test('returns invalid payload error for non-json string payloads', async () => {
    const socket = {
      emit: jest.fn(),
      shardClient: { log: { errors: 0 }, emit: {} },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    await expect(Service.prototype.handleClientMessage.call(serviceLike, socket, 'hello world')).resolves.toBeUndefined();

    expect(socket.shardClient.log.errors).toBe(1);
    expect(socket.emit).toHaveBeenCalledWith(
      'trpcResponse',
      expect.objectContaining({ error: expect.stringContaining('Invalid trpc payload') })
    );
  });

  test('returns invalid payload error for json array payloads', async () => {
    const socket = {
      emit: jest.fn(),
      shardClient: { log: { errors: 0 }, emit: {} },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    await expect(Service.prototype.handleClientMessage.call(serviceLike, socket, '[]')).resolves.toBeUndefined();

    expect(socket.shardClient.log.errors).toBe(1);
    expect(socket.emit).toHaveBeenCalledWith(
      'trpcResponse',
      expect.objectContaining({ error: expect.stringContaining('Invalid trpc payload') })
    );
  });

  test('accepts valid json string payloads and dispatches method', async () => {
    const mutate = jest.fn().mockResolvedValue({ status: 1 });
    const socket = {
      emit: jest.fn(),
      shardClient: {
        log: { errors: 0 },
        emit: { onPlayerUpdates: mutate },
      },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    const message = JSON.stringify({
      id: 'json-1',
      method: 'onPlayerUpdates',
      type: 'mutation',
      params: { hp: 2 },
    });

    await expect(Service.prototype.handleClientMessage.call(serviceLike, socket, message)).resolves.toBeUndefined();

    expect(mutate).toHaveBeenCalledWith({ hp: 2 });
    expect(socket.emit).toHaveBeenCalledWith('trpcResponse', { id: 'json-1', result: { status: 1 } });
  });

  test('normalizes non-primitive request ids to null on success responses', async () => {
    const mutate = jest.fn().mockResolvedValue({ status: 1 });
    const socket = {
      emit: jest.fn(),
      shardClient: {
        log: { errors: 0 },
        emit: { onPlayerUpdates: mutate },
      },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    await expect(
      Service.prototype.handleClientMessage.call(serviceLike, socket, {
        id: { bad: 'id-shape' },
        method: 'onPlayerUpdates',
        type: 'mutation',
        params: { hp: 7 },
      })
    ).resolves.toBeUndefined();

    expect(mutate).toHaveBeenCalledWith({ hp: 7 });
    expect(socket.emit).toHaveBeenCalledWith('trpcResponse', { id: null, result: { status: 1 } });
  });

  test('normalizes non-finite numeric ids to null on success responses', async () => {
    const mutate = jest.fn().mockResolvedValue({ status: 1 });
    const socket = {
      emit: jest.fn(),
      shardClient: {
        log: { errors: 0 },
        emit: { onPlayerUpdates: mutate },
      },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    await expect(
      Service.prototype.handleClientMessage.call(serviceLike, socket, {
        id: Number.NaN,
        method: 'onPlayerUpdates',
        type: 'mutation',
        params: { hp: 9 },
      })
    ).resolves.toBeUndefined();

    expect(mutate).toHaveBeenCalledWith({ hp: 9 });
    expect(socket.emit).toHaveBeenCalledWith('trpcResponse', { id: null, result: { status: 1 } });
  });

  test('accepts valid json Buffer payloads and dispatches method', async () => {
    const mutate = jest.fn().mockResolvedValue({ status: 1 });
    const socket = {
      emit: jest.fn(),
      shardClient: {
        log: { errors: 0 },
        emit: { onPlayerUpdates: mutate },
      },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    const message = Buffer.from(
      JSON.stringify({
        id: 'json-buffer-1',
        method: 'onPlayerUpdates',
        type: 'mutation',
        params: { hp: 3 },
      }),
      'utf8'
    );

    await expect(Service.prototype.handleClientMessage.call(serviceLike, socket, message)).resolves.toBeUndefined();

    expect(mutate).toHaveBeenCalledWith({ hp: 3 });
    expect(socket.emit).toHaveBeenCalledWith('trpcResponse', { id: 'json-buffer-1', result: { status: 1 } });
  });

  test('accepts valid json ArrayBuffer payloads and dispatches method', async () => {
    const mutate = jest.fn().mockResolvedValue({ status: 1 });
    const socket = {
      emit: jest.fn(),
      shardClient: {
        log: { errors: 0 },
        emit: { onPlayerUpdates: mutate },
      },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    const source = Buffer.from(
      JSON.stringify({
        id: 'json-arraybuffer-1',
        method: 'onPlayerUpdates',
        type: 'mutation',
        params: { hp: 4 },
      }),
      'utf8'
    );
    const message = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);

    await expect(Service.prototype.handleClientMessage.call(serviceLike, socket, message)).resolves.toBeUndefined();

    expect(mutate).toHaveBeenCalledWith({ hp: 4 });
    expect(socket.emit).toHaveBeenCalledWith('trpcResponse', { id: 'json-arraybuffer-1', result: { status: 1 } });
  });

  test('accepts valid json DataView payloads and dispatches method', async () => {
    const mutate = jest.fn().mockResolvedValue({ status: 1 });
    const socket = {
      emit: jest.fn(),
      shardClient: {
        log: { errors: 0 },
        emit: { onPlayerUpdates: mutate },
      },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    const source = Buffer.from(
      JSON.stringify({
        id: 'json-dataview-1',
        method: 'onPlayerUpdates',
        type: 'mutation',
        params: { hp: 5 },
      }),
      'utf8'
    );
    const view = new DataView(source.buffer, source.byteOffset, source.byteLength);

    await expect(Service.prototype.handleClientMessage.call(serviceLike, socket, view)).resolves.toBeUndefined();

    expect(mutate).toHaveBeenCalledWith({ hp: 5 });
    expect(socket.emit).toHaveBeenCalledWith('trpcResponse', { id: 'json-dataview-1', result: { status: 1 } });
  });

  test('accepts utf-8 bom-prefixed json string payloads and dispatches method', async () => {
    const mutate = jest.fn().mockResolvedValue({ status: 1 });
    const socket = {
      emit: jest.fn(),
      shardClient: {
        log: { errors: 0 },
        emit: { onPlayerUpdates: mutate },
      },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    const message = `\uFEFF${JSON.stringify({
      id: 'json-bom-1',
      method: 'onPlayerUpdates',
      type: 'mutation',
      params: { hp: 6 },
    })}`;

    await expect(Service.prototype.handleClientMessage.call(serviceLike, socket, message)).resolves.toBeUndefined();

    expect(mutate).toHaveBeenCalledWith({ hp: 6 });
    expect(socket.emit).toHaveBeenCalledWith('trpcResponse', { id: 'json-bom-1', result: { status: 1 } });
  });

  test('handles malformed json string payloads', async () => {
    const socket = {
      emit: jest.fn(),
      shardClient: { log: { errors: 0 }, emit: {} },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    await expect(Service.prototype.handleClientMessage.call(serviceLike, socket, '{bad json')).resolves.toBeUndefined();

    expect(socket.shardClient.log.errors).toBe(1);
    expect(socket.emit).toHaveBeenCalledWith(
      'trpcResponse',
      expect.objectContaining({ error: expect.any(String) })
    );
  });

  test('normalizes non-primitive request ids to null on error responses', async () => {
    const socket = {
      emit: jest.fn(),
      shardClient: { log: { errors: 0 }, emit: {} },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    await expect(
      Service.prototype.handleClientMessage.call(serviceLike, socket, {
        id: { broken: true },
        method: 'unknownMethod',
        type: 'mutation',
        params: { hp: 8 },
      })
    ).resolves.toBeUndefined();

    expect(socket.emit).toHaveBeenCalledWith(
      'trpcResponse',
      expect.objectContaining({ id: null, error: expect.stringContaining('Invalid trpc payload') })
    );
  });

  test('normalizes non-finite numeric ids to null on error responses', async () => {
    const socket = {
      emit: jest.fn(),
      shardClient: { log: { errors: 0 }, emit: {} },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    await expect(
      Service.prototype.handleClientMessage.call(serviceLike, socket, {
        id: Number.POSITIVE_INFINITY,
        method: 'unknownMethod',
        type: 'mutation',
        params: { hp: 8 },
      })
    ).resolves.toBeUndefined();

    expect(socket.emit).toHaveBeenCalledWith(
      'trpcResponse',
      expect.objectContaining({ id: null, error: expect.stringContaining('Invalid trpc payload') })
    );
  });

  test('dispatches loggable events even when params are circular', async () => {
    const mutate = jest.fn().mockResolvedValue({ status: 1 });
    const socket = {
      emit: jest.fn(),
      shardClient: {
        log: { errors: 0 },
        emit: { onPlayerUpdates: mutate },
      },
    };

    const serviceLike = {
      loggableEvents: ['onPlayerUpdates'],
      disconnectClient: jest.fn(),
    };

    const params: any = { hp: 10 };
    params.self = params;

    await expect(
      Service.prototype.handleClientMessage.call(serviceLike, socket, {
        id: 'circular-loggable-1',
        method: 'onPlayerUpdates',
        type: 'mutation',
        params,
      })
    ).resolves.toBeUndefined();

    expect(mutate).toHaveBeenCalledWith(params);
    expect(socket.emit).toHaveBeenCalledWith('trpcResponse', {
      id: 'circular-loggable-1',
      result: { status: 1 },
    });
    expect(socket.shardClient.log.errors).toBe(0);
  });

  test('does not throw when socket.emit throws on success response path', async () => {
    const mutate = jest.fn().mockResolvedValue({ status: 1 });
    const socket = {
      emit: jest.fn(() => {
        throw new Error('emit failed');
      }),
      shardClient: {
        log: { errors: 0 },
        emit: { onPlayerUpdates: mutate },
      },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    await expect(
      Service.prototype.handleClientMessage.call(serviceLike, socket, {
        id: 'emit-fail-success',
        method: 'onPlayerUpdates',
        type: 'mutation',
        params: { hp: 1 },
      })
    ).resolves.toBeUndefined();

    expect(mutate).toHaveBeenCalledWith({ hp: 1 });
    expect(socket.shardClient.log.errors).toBe(0);
  });

  test('does not throw when socket.emit throws on error response path', async () => {
    const socket = {
      emit: jest.fn(() => {
        throw new Error('emit failed');
      }),
      shardClient: { log: { errors: 0 }, emit: {} },
    };

    const serviceLike = {
      loggableEvents: [],
      disconnectClient: jest.fn(),
    };

    await expect(Service.prototype.handleClientMessage.call(serviceLike, socket, undefined)).resolves.toBeUndefined();

    expect(socket.shardClient.log.errors).toBe(1);
  });
});
