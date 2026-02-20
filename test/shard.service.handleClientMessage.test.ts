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

  test('handles decodePayload parse errors from malformed string payloads', async () => {
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
