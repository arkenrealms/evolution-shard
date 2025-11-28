import dotEnv from 'dotenv';
dotEnv.config();

import fs from 'fs';
import os from 'os';
import helmet from 'helmet';
import cors from 'cors';
import http from 'http';
import https from 'https';
import express, { Express } from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { log, logError, isDebug } from '@arken/node/util';
import { catchExceptions } from '@arken/node/util/process';
import { Service as ShardService } from './shard.service';
import { getTime, decodePayload, ipHashFromSocket } from '@arken/node/util';
import { serialize, deserialize } from '@arken/node/util/rpc';
import { testMode, baseConfig, sharedConfig } from '@arken/evolution-protocol/config';
import { EvolutionMechanic as Mechanic } from '@arken/node/legacy/types';
import type * as Shard from '@arken/evolution-protocol/shard/shard.types';
import { createCallerFactory } from '@arken/evolution-protocol/shard/shard.router';

if (isDebug) {
  log('Running SHARD in DEBUG mode');
}

export class Application {
  public server: Express;
  public state: {
    port: number;
    sslPort: number;
    spawnPort?: number;
  };
  public isHttps: boolean;
  public http?: http.Server;
  public https?: https.Server;
  public io?: SocketIOServer;

  constructor() {
    this.server = express();
    this.state = {
      port: process.env.SHARD_PORT ? parseInt(process.env.SHARD_PORT, 10) : 8080,
      sslPort: process.env.SHARD_SSL_PORT ? parseInt(process.env.SHARD_SSL_PORT, 10) : 8443,
    };
    this.isHttps = process.env.ARKEN_ENV !== 'local';
    this.setupMiddleware();
    this.setupServer();
  }

  private setupMiddleware() {
    // @ts-ignore
    this.server.set('trust proxy', 1);
    // @ts-ignore
    this.server.use(helmet());
    // @ts-ignore
    this.server.use(
      cors({
        allowedHeaders: [
          'Accept',
          'Authorization',
          'Cache-Control',
          'X-Requested-With',
          'Content-Type',
          'applicationId',
        ],
      })
    );
  }

  private setupServer() {
    log('Setting up server', process.env);

    if (this.isHttps) {
      this.https = https.createServer(
        {
          key: fs.readFileSync('/etc/letsencrypt/live/hoff.arken.gg/privkey.pem'),
          cert: fs.readFileSync('/etc/letsencrypt/live/hoff.arken.gg/fullchain.pem'),
        },
        // @ts-ignore
        this.server
      );
    } else {
      this.http = http.createServer(this.server);
    }

    this.io = new SocketIOServer(this.isHttps ? this.https : this.http, {
      pingInterval: 30 * 1000,
      pingTimeout: 90 * 1000,
      upgradeTimeout: 20 * 1000,
      allowUpgrades: true,
      cookie: false,
      serveClient: false,
      allowEIO3: true,
      cors: {
        origin: '*',
      },
    });
  }

  async setupShard() {
    try {
      const service = new ShardService(this);

      log('Starting event handler');

      this.io.on('connection', async function (socket) {
        // try {
        log('Connection', socket.id);

        const hash = ipHashFromSocket(socket);
        const spawnPoint = service.clientSpawnPoints[Math.floor(Math.random() * service.clientSpawnPoints.length)];
        const client: Shard.Client = {
          name: 'Unknown' + Math.floor(Math.random() * 999),
          roles: [],
          emit: undefined,
          ioCallbacks: {},
          startedRoundAt: null,
          lastTouchClientId: null,
          lastTouchTime: null,
          id: socket.id,
          avatar: null,
          network: null,
          address: null,
          device: null,
          position: spawnPoint,
          upgrades: [],
          ui: [],
          target: spawnPoint,
          clientPosition: spawnPoint,
          clientTarget: spawnPoint,
          phasedPosition: undefined,
          socket, // TODO: might be a problem
          rotation: null,
          xp: 75,
          maxHp: 100,
          latency: 0,
          kills: 0,
          killStreak: 0,
          deaths: 0,
          points: 0,
          evolves: 0,
          powerups: 0,
          rewards: 0,
          orbs: 0,
          upgradesPending: 2,
          upgradeRerolls: 3,
          pickups: [],
          isSeer: false,
          isAdmin: false,
          isMod: false,
          isBanned: false,
          isDisconnected: false,
          isDead: true,
          isJoining: false,
          isSpectating: false,
          isStuck: false,
          isGod: false,
          isRealm: false,
          isMaster: false,
          isGuest: false,
          isInvincible: service.config.isGodParty ? true : false,
          isPhased: false,
          overrideSpeed: null as any,
          overrideCameraSize: null as any,
          cameraSize: service.config.cameraSize,
          speed: service.config.baseSpeed * service.config.avatarSpeedMultiplier0,
          joinedAt: 0,
          invincibleUntil: 0,
          decayPower: 1,
          hash: ipHashFromSocket(socket),
          lastReportedTime: getTime(),
          lastUpdate: 0,
          gameMode: service.config.gameMode,
          phasedUntil: getTime(),
          overrideSpeedUntil: 0,
          joinedRoundAt: getTime(),
          baseSpeed: 0.8,
          character: {
            meta: {
              [Mechanic.MovementSpeedIncrease]: 0,
              [Mechanic.DeathPenaltyAvoid]: 0,
              [Mechanic.EnergyDecayIncrease]: 0,
              [Mechanic.WinRewardsIncrease]: 0,
              [Mechanic.WinRewardsDecrease]: 0,
              [Mechanic.IncreaseMovementSpeedOnKill]: 0,
              [Mechanic.EvolveMovementBurst]: 0,
              [Mechanic.DoublePickupChance]: 0,
              [Mechanic.IncreaseHealthOnKill]: 0,
              [Mechanic.SpriteFuelIncrease]: 0,
            },
          },
          log: {
            kills: [],
            deaths: [],
            revenge: 0,
            resetPosition: 0,
            phases: 0,
            stuck: 0,
            collided: 0,
            timeoutDisconnect: 0,
            speedProblem: 0,
            clientDistanceProblem: 0,
            outOfBounds: 0,
            ranOutOfHealth: 0,
            notReallyTrying: 0,
            tooManyKills: 0,
            killingThemselves: 0,
            sameNetworkDisconnect: 0,
            connectedTooSoon: 0,
            clientDisconnected: 0,
            positionJump: 0,
            pauses: 0,
            connects: 0,
            path: '',
            positions: 0,
            spectating: 0,
            replay: [],
            addressProblem: 0,
            recentJoinProblem: 0,
            usernameProblem: 0,
            maintenanceJoin: 0,
            signatureProblem: 0,
            signinProblem: 0,
            versionProblem: 0,
            failedRealmCheck: 0,
          },
        };
        log('User connected from hash ' + hash);

        if (!testMode && service.config.killSameNetworkClients) {
          const sameNetworkClient = service.clients.find((r) => r.hash === client.hash && r.id !== client.id);
          if (sameNetworkClient) {
            client.log.sameNetworkDisconnect += 1;
            service.disconnectClient(client, 'same network');
            return;
          }
        }
        service.sockets[client.id] = socket;
        service.clientLookup[client.id] = client;
        // if (Object.keys(service.clientLookup).length == 1) {
        //   await this.initMaster(null, { client });
        // }
        // service.clients = service.clients.filter((c) => c.hash !== client.hash);
        service.clients.push(client);

        // socket.shardClient = client;

        console.log('client.id', client.id);

        // client.emit = createShardRouter(service);
        // log(client.emit);

        const ctx = { client };

        const createCaller = createCallerFactory(service.router);

        client.emit = createCaller(ctx);

        socket.on('trpc', async (message) => {
          await service.handleClientMessage(socket, message);
        });

        socket.on('trpcResponse', async (message) => {
          log('Shard client trpcResponse message', message);
          const pack = typeof message === 'string' ? decodePayload(message) : message;
          log('Shard client trpcResponse pack', pack);
          const { oid } = pack;

          if (pack.error) {
            log(
              'Shard client callback - error occurred',
              pack,
              client.ioCallbacks[oid] ? client.ioCallbacks[oid].request : ''
            );
            return;
          }

          try {
            log(`Shard client callback ${client.ioCallbacks[oid] ? 'Exists' : 'Doesnt Exist'}`);

            if (client.ioCallbacks[oid]) {
              clearTimeout(client.ioCallbacks[oid].timeout);

              client.ioCallbacks[oid].resolve({ result: { data: deserialize(pack.result) } });

              delete client.ioCallbacks[oid];
            }
          } catch (e) {
            log('Shard client trpcResponse error', oid, e);
          }
        });

        socket.on('emit', (args) => {
          // this.app.io.emit('trpc', args);
        });

        socket.on('emitAll', (args) => {
          this.app.io.emit('trpc', args);
        });

        // socket.onAny(async (eventName, args) => {
        //   if (eventName.includes('proxy_emitAll')) {
        //     this.app.io.emit('trpc', args);
        //   }
        // });

        socket.on('disconnect', function () {
          log('Shard client disconnected');
          client.log.clientDisconnected += 1;
          service.disconnectClient(client, 'client disconnected');
          if (client.isRealm) {
            service.emitAll.onBroadcast.mutate([`Shard client: bridge disconnected`, 0]);
          }
        });
      });
    } catch (e) {
      log('init game world failed', e);
    }
  }

  public start() {
    log('Starting server...', this.isHttps ? 'HTTPS' : 'HTTP');
    catchExceptions();
    try {
      if (this.isHttps && this.https) {
        this.https.listen(this.state.sslPort, () => {
          log(`Server ready and listening on *:${this.state.sslPort} (https)`);
          this.state.spawnPort = this.state.sslPort;
        });
      } else if (this.http) {
        this.http.listen(this.state.port, () => {
          log(`Server ready and listening on *:${this.state.port} (http)`);
          this.state.spawnPort = this.state.port;
        });
      }

      this.setupMonitor();
      this.setupShard();
    } catch (error) {
      logError('Error starting server:', error);
    }
  }

  async setupMonitor() {
    let logs = [];

    // Check if the platform is Linux
    const isLinux = os.platform() === 'linux';

    setInterval(function () {
      let available;
      if (isLinux) {
        available = Number(/MemAvailable:[ ]+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'))[1]) / 1024;

        if (available < 500) {
          if (logs.length >= 5) {
            const free = os.freemem() / 1024 / 1024;
            const total = os.totalmem() / 1024 / 1024;

            logError('SHARD: Free mem', free);
            logError('SHARD: Available mem', available);
            logError('SHARD: Total mem', total);

            process.exit();
          }
        } else {
          logs = [];
        }
      }
    }, 60 * 1000);

    setInterval(function () {
      let available;
      if (isLinux) {
        available = Number(/MemAvailable:[ ]+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'))[1]) / 1024;
        if (available < 500) {
          log('SHARD Memory flagged', available);
          logs.push(true);
        }
      }
    }, 10 * 1000);
  }
}

const app = new Application();
app.start();
