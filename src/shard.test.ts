const client = require('@arken/evolution-protocol/shard/client');
const { createHTTPServer } = require('@trpc/server/adapters/standalone');

const io = require('socket.io');
const Client = require('socket.io-client');
const { initGameServer } = require('./game-server'); // Adjust the path accordingly
const { createServer } = require('http');
const { appRouter } = require('../modules/game-bridge'); // Adjust the path accordingly

describe('tRPC and Game Server Integration Tests', () => {
  let trpcServer;
  let trpcServerAddr;
  let trpcClient;
  let ioServer;
  let httpServer;
  let httpServerAddr;
  let clientSocket;
  let app = { io: null, state: { spawnPort: 3000 } }; // Mocked app object

  beforeAll(async () => {
    // Setup tRPC server
    trpcServer = createHTTPServer({ router: appRouter });
    trpcServer.listen(2023);
    trpcServerAddr = trpcServer.server.address();

    // Setup tRPC client
    trpcClient = client.create();

    // Setup Socket.io server
    httpServer = createServer().listen();
    httpServerAddr = httpServer.address();
    ioServer = io(httpServer);

    app.io = ioServer; // Attach io server to app
    initGameServer(app); // Initialize your game server with mocked app
    ioServer.attach(httpServer);
  });

  afterAll(async () => {
    // Cleanup
    trpcServer.server.close();
    ioServer.close();
    httpServer.close();
  });

  beforeEach((done) => {
    // Do not hardcode port and address, use the address assigned by the server
    clientSocket = new Client(`http://localhost:${httpServerAddr.port}`);
    clientSocket.on('connect', done);
  });

  afterEach((done) => {
    if (clientSocket.connected) {
      clientSocket.disconnect();
    }
    done();
  });

  test('tRPC init', async () => {
    const response = await trpcClient.query('init');
    expect(response.status).toBe(1);
    expect(response.id).toBeDefined();
  });

  test('tRPC configureRequest', async () => {
    const response = await trpcClient.mutation('configureRequest', { clients: [] });
    expect(response.data.rewardWinnerAmount).toBe(100);
    expect(response.data.rewardItemAmount).toBe(50);
  });

  test('tRPC saveRoundRequest', async () => {
    const response = await trpcClient.mutation('saveRoundRequest', {
      startedAt: Date.now(),
      endedAt: Date.now(),
      players: [],
      winners: [],
    });
    expect(response.status).toBe(1);
  });

  test('tRPC getRandomRewardRequest', async () => {
    const response = await trpcClient.query('getRandomRewardRequest');
    expect(response.status).toBe(1);
    expect(response.reward).toBeDefined();
  });

  test('tRPC verifyAdminSignatureRequest', async () => {
    const response = await trpcClient.mutation('verifyAdminSignatureRequest', {
      signature: 'sample_signature',
    });
    expect(response.status).toBe(1);
    expect(response.verified).toBe(true);
  });

  test('tRPC verifyAdminSignatureRequest with invalid signature', async () => {
    const response = await trpcClient.mutation('verifyAdminSignatureRequest', {
      signature: 'invalid_signature',
    });
    expect(response.status).toBe(0);
    expect(response.verified).toBe(false);
  });

  test('tRPC normalizeAddressRequest', async () => {
    const response = await trpcClient.mutation('normalizeAddressRequest', {
      address: '0x1234567890abcdef1234567890abcdef12345678',
    });
    expect(response.status).toBe(1);
    expect(response.address).toBe('0x1234567890abcdef1234567890abcdef12345678');
  });

  test('tRPC normalizeAddressRequest with invalid address', async () => {
    const response = await trpcClient.mutation('normalizeAddressRequest', {
      address: 'invalid_address',
    });
    expect(response.status).toBe(0);
    expect(response.address).toBeUndefined();
  });

  test('tRPC auth', async () => {
    const response = await trpcClient.mutation('auth', {
      signature: {
        data: 'evolution',
        hash: 'sample_hash',
        address: '0x1234567890abcdef1234567890abcdef12345678',
      },
    });
    expect(response.status).toBe(1);
    expect(response.verified).toBe(true);
  });

  test('tRPC auth with invalid data', async () => {
    const response = await trpcClient.mutation('auth', {
      signature: {
        data: 'invalid_data',
        hash: 'sample_hash',
        address: '0x1234567890abcdef1234567890abcdef12345678',
      },
    });
    expect(response.status).toBe(0);
    expect(response.verified).toBe(false);
  });

  test('Game mode Sprite Juice updates camera size', (done) => {
    // Mock player object and settings
    const player = {
      id: clientSocket.id,
      name: 'TestPlayer',
      avatar: 0,
      cameraSize: 3,
      baseSpeed: 1,
      position: { x: 0, y: 0 },
      clientPosition: { x: 0, y: 0 },
      clientTarget: { x: 0, y: 0 },
    };

    // Simulate joining the game
    clientSocket.emit('JoinRoom');

    clientSocket.on('OnJoinGame', () => {
      // Simulate changing to Sprite Juice mode
      clientSocket.emit('setConfigRequest', { data: { config: { gameMode: 'Sprite Juice' } } });
    });

    clientSocket.on('OnSetRoundInfo', () => {
      // Simulate a power-up collection which increases cameraSize in Sprite Juice mode
      clientSocket.emit('UpdateMyself', 'packaged:payload'); // replace 'packaged:payload' with actual data format
    });

    clientSocket.on('OnUpdatePickup', () => {
      // Check if the camera size has increased
      expect(player.cameraSize).toBeGreaterThan(3);
      done();
    });
  });

  test('Game mode Marco Polo updates camera size', (done) => {
    // Mock player object and settings
    const player = {
      id: clientSocket.id,
      name: 'TestPlayer',
      avatar: 0,
      cameraSize: 3,
      baseSpeed: 1,
      position: { x: 0, y: 0 },
      clientPosition: { x: 0, y: 0 },
      clientTarget: { x: 0, y: 0 },
    };

    // Simulate joining the game
    clientSocket.emit('JoinRoom');

    clientSocket.on('OnJoinGame', () => {
      // Simulate changing to Marco Polo mode
      clientSocket.emit('setConfigRequest', { data: { config: { gameMode: 'Marco Polo' } } });
    });

    clientSocket.on('OnSetRoundInfo', () => {
      // Simulate a power-up collection which increases cameraSize in Marco Polo mode
      clientSocket.emit('UpdateMyself', 'packaged:payload'); // replace 'packaged:payload' with actual data format
    });

    clientSocket.on('OnUpdatePickup', () => {
      // Check if the camera size has increased
      expect(player.cameraSize).toBeGreaterThan(3);
      done();
    });
  });

  test('Player receives maintenance message and disconnects', (done) => {
    clientSocket.emit('RS_MaintenanceRequest', { signature: 'admin_signature' });

    clientSocket.on('onMaintenance', () => {
      expect(clientSocket.connected).toBe(false);
      done();
    });
  });

  test('Player does not receive maintenance message with invalid signature', (done) => {
    clientSocket.emit('RS_MaintenanceRequest', { signature: 'invalid_signature' });

    clientSocket.on('onMaintenance', () => {
      done.fail('Player should not receive maintenance message with invalid signature');
    });

    setTimeout(() => {
      expect(clientSocket.connected).toBe(true);
      done();
    }, 1000);
  });
});

export {};
