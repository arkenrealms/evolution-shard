import { httpBatchLink, createTRPCProxyClient, loggerLink, TRPCClientError } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import axios from 'axios';
import { generateShortId } from '@arken/node/util/db';
import { serialize, deserialize } from '@arken/node/util/rpc';
import { weightedRandom } from '@arken/node/util/array';
import { chance } from '@arken/node/util/number';
import {
  log,
  getTime,
  shuffleArray,
  randomPosition,
  sha256,
  decodePayload,
  isNumeric,
  ipHashFromSocket,
} from '@arken/node/util';
import * as Arken from '@arken/node';
import { sleep } from '@arken/node/util/time';
import { awaitEnter } from '@arken/node/util/process';
import { customErrorFormatter, hasRole, transformer } from '@arken/node/util/rpc';
import { testMode, baseConfig, sharedConfig } from '@arken/evolution-protocol/config';
import { presets } from '@arken/evolution-protocol/presets';
import { createCallerFactory, createRouter as createShardRouter } from '@arken/evolution-protocol/shard/shard.router';
import type { ShardClientRouter, Realm } from '@arken/evolution-protocol/types';
import type { Orb, Boundary, Reward, PowerUp, Round, Preset, Event } from '@arken/evolution-protocol/shard/shard.types';
import { Position } from '@arken/node/types';
import { EvolutionMechanic as Mechanic } from '@arken/node/legacy/types';
import mapData from './data/map.json'; // TODO: get this from the embedded game client
import type * as Shard from '@arken/evolution-protocol/shard/shard.types';
import type * as Bridge from '@arken/evolution-protocol/bridge/bridge.types';
// import { createRouter as createBridgeRouter } from '@arken/evolution-protocol/bridge/router';
// import { dummyTransformer } from '@arken/node/util/rpc';

const FF = {
  MASTER_MODE: false,
};

class Service implements Shard.Service {
  io: any;
  state: any;
  zones: any;
  realm: any; //ReturnType<typeof createClient>;
  master: any;
  guestNames: string[];
  serverVersion: string;
  roundLoopTimeout?: NodeJS.Timeout;
  addressToProfile: Record<string, Arken.Profile.Types.Profile>;
  announceReboot: boolean;
  rebootAfterRound: boolean;
  debugQueue: boolean;
  killSameNetworkClients: boolean;
  sockets: Record<string, any>;
  clientLookup: Record<string, Shard.Client>;
  powerups: PowerUp[];
  powerupLookup: Record<string, PowerUp>;
  currentReward?: Reward;
  orbs: Orb[];
  orbLookup: Record<string, Orb>;
  eventQueue: Event[];
  clients: Shard.Client[];
  queuedClients: Shard.Client[];
  lastReward?: Reward;
  lastLeaderName?: string;
  config: Partial<Shard.Config>;
  sharedConfig: Partial<Shard.Config>;
  baseConfig: Shard.Config;
  round: Round;
  ranks: Record<string, any>;
  pandas: string[];
  rateLimitWindow: number;
  maxRequestsPerWindow: number;
  requestTimestamps: Record<string, number[]>;
  loggableEvents: string[];
  currentPreset: Preset;
  roundConfig: Shard.Config;
  spawnBoundary1: Boundary;
  spawnBoundary2: Boundary;
  mapBoundary: Boundary;
  eventFlushedAt: number;
  clientSpawnPoints: Position[];
  lastFastGameloopTime: number;
  lastFastestGameloopTime: number;
  router: Shard.Router;
  emit: ReturnType<typeof createTRPCProxyClient<ShardClientRouter>>;
  emitDirect: ReturnType<typeof createTRPCProxyClient<ShardClientRouter>>;
  emitAll: ReturnType<typeof createTRPCProxyClient<ShardClientRouter>>;
  emitAllDirect: ReturnType<typeof createTRPCProxyClient<ShardClientRouter>>;
  app: any;
  currentZone: any;
  games: any;
  currentGame: any;

  constructor(app: any) {
    log('Process running on PID: ' + process.pid);

    this.app = app;

    // temporary, we need to move this into unity
    // when player touches an NPC, it fires the proper event
    this.games = {
      MemeIsles: {
        key: 'meme-isles',
        name: 'Meme Isles',
        zones: [
          {
            name: 'Meme Isles',
            modifiers: {},
            objects: {
              Harold: {
                x: -23,
                y: -3,
              },
              ElonTusk: {
                x: -37.5,
                y: -13.5,
              },
              MageIslesPortal: {
                x: 18.3,
                y: -4.3,
              },
            },
          },
          {
            name: 'X',
            modifiers: {},
          },
        ],
      },
      MageIsles: {
        key: 'mage-isles',
        name: 'Mage Isles',
        zones: [
          {
            name: 'Mage Isles',
            modifiers: {},
            objects: {
              Devil: {
                x: -37.5,
                y: -13.5,
              },
              MemeIslesPortal: {
                x: 18.3,
                y: -4.3,
              },
            },
          },
          {
            name: 'Hell',
            modifiers: {},
          },
        ],
      },
    };

    this.currentGame = this.games.MemeIsles;
    this.currentZone = this.currentGame.zones[0];

    const bossEvents = [
      {
        name: 'Freak Off Survival', // Freak Offer, should you choose to accept it
        characterId: '111', // Pimp Daddy
        interval: '1d',
        lastEventDate: null,
      },
      {
        name: 'Elon Tusk',
        characterId: '111', // Elon Tusk
        interval: '1d',
        lastEventDate: null,
      },
    ];

    this.guestNames = [
      'Robin Banks',
      'Rick Axely',
      'Shorty McAngrystout',
      'Whiffletree',
      'Thistlebutt',
      'The Potato',
      'Gumbuns Moonbrain',
      'Drakus',
      'Nyx',
      'Aedigarr',
      'Vaergahl',
      'Anbraxas',
      'Rezoth',
      'Felscathor',
      'Kathax',
      "I'Rokk",
      'Terra',
      'Valaebal',
      'Nox',
      'Ulfryz',
      "X'ek",
      'Bastis',
      'Draugh',
      'Raek',
      'Zyphon',
      'Smaug',
    ];
    this.serverVersion = '1.9.0';
    this.queuedClients = [];
    this.roundLoopTimeout;
    this.addressToProfile = {};
    this.announceReboot = false;
    this.rebootAfterRound = false;
    this.debugQueue = false;
    this.killSameNetworkClients = false;
    this.sockets = {};
    this.clientLookup = {};
    this.powerups = [];
    this.powerupLookup = {};
    this.currentReward = undefined;
    this.orbs = [];
    this.orbLookup = {};
    this.eventQueue = [];
    this.clients = [];
    this.lastReward = undefined;
    this.lastLeaderName = undefined;
    this.eventFlushedAt = getTime();
    this.round = {
      id: generateShortId(),
      gameMode: 'Standard',
      startedDate: Math.round(getTime() / 1000),
      endedAt: null,
      events: [],
      states: [],
      clients: [],
    };
    this.ranks = {};
    this.pandas = [
      '0x150F24A67d5541ee1F8aBce2b69046e25d64619c',
      '0x3551691499D740790C4511CDBD1D64b2f146f6Bd',
      '0x1a367CA7bD311F279F1dfAfF1e60c4d797Faa6eb',
      '0x82b644E1B2164F5B81B3e7F7518DdE8E515A419d',
      '0xeb3fCb993dDe8a2Cd081FbE36238E4d64C286AC0',
    ];
    this.rateLimitWindow = 60 * 1000;
    this.maxRequestsPerWindow = 5;
    this.requestTimestamps = {};
    this.realm = undefined;
    this.loggableEvents = [
      // 'onEvents',
      'onBroadcast',
      'onGameOver',
      'onJoinGame',
      'onRoundWinner',
      'onClearLeaderboard',
      'onSpawnReward',
      'onUpdateReward',
      'onUpdateBestClient',
      'onSpectate',
      'onDisconnected',
      'onBanned',
      'onLogin',
      'onMaintenance',
      'onUpdateEvolution',
      'onHideMinimap',
      'onShowMinimap',
      'onSetRoundInfo',
      'onLoaded',
      'onOpenLevel2',
      'onCloseLevel2',
      // 'onSpawnPowerUp',
      // 'onUpdatePickup',
      'onRoundPaused',
      'onUnmaintenance',
      'onSetPositionMonitor',
      // 'onUpdatePlayer',
      'onSpawnClient',
      'onUpdateRegression',
    ];
    this.currentPreset = presets[Math.floor(Math.random() * presets.length)];
    this.baseConfig = baseConfig;
    this.sharedConfig = sharedConfig;
    this.config = { ...baseConfig, ...sharedConfig };
    this.roundConfig = { ...baseConfig, ...sharedConfig, ...this.currentPreset };
    this.spawnBoundary1 = { x: { min: -17, max: 0 }, y: { min: -13, max: -4 } };
    this.spawnBoundary2 = { x: { min: -37, max: 0 }, y: { min: -13, max: -2 } };
    this.mapBoundary = { x: { min: -38, max: 40 }, y: { min: -20, max: 2 } };
    this.clientSpawnPoints = [
      { x: -4.14, y: -11.66 },
      { x: -11.14, y: -8.55 },
      { x: -12.27, y: -14.24 },
      { x: -7.08, y: -12.75 },
      { x: -7.32, y: -15.29 },
    ];
    this.lastFastGameloopTime = getTime();
    this.lastFastestGameloopTime = getTime();

    this.router = createShardRouter(this as Shard.Service);

    this.emit = createTRPCProxyClient<ShardClientRouter>({
      links: [
        () =>
          ({ op, next }) => {
            return observable((observer) => {
              const { input, context } = op;
              // const { name, args } = input as Event;
              const client = context.client as Shard.Client;

              // if (!client) {
              //   log('Emit Direct failed, no client', input);
              //   observer.complete();
              //   return;
              // }

              // if (!client.socket || !client.socket.emit) {
              //   log('Emit Direct failed, bad socket', input);
              //   observer.complete();
              //   return;
              // }

              if (client?.socket?.emit) {
                if (this.loggableEvents.includes(op.path)) log('Emit Direct', op.path, input, client.id);

                const compiled: any[] = [];
                const eventQueue = [{ name: op.path, args: Array.isArray(input) ? input : [input] }];
                // TODO: optimize
                for (const e of eventQueue) {
                  compiled.push(`["${e.name}","${Object.values(e.args).join(':')}"]`);
                  this.round.events.push({ type: 'emitDirect', client: client.id, name: e.name, args: e.args });
                }

                const id = generateShortId();
                const data = `{"id":"${id}","method":"onEvents","type":"mutation","params":[${compiled.join(',')}]}`;

                // console.log(data);

                client.socket.emit(
                  'trpc',
                  Buffer.from(data) // JSON.stringify({ id, method: 'onEvents', type: 'mutation', params: [compiled] }))
                );
              } else {
                if (this.loggableEvents.includes(op.path)) log('Fake Emit Direct', op.path, input);

                this.eventQueue.push({ name: op.path, args: Array.isArray(input) ? input : [input] });
              }

              observer.next({
                result: { data: { status: 1 } },
              });

              observer.complete();
            });
          },
      ],
      // transformer,
    });

    this.emitDirect = createTRPCProxyClient<ShardClientRouter>({
      links: [
        () =>
          ({ op, next }) => {
            return observable((observer) => {
              const { input, context } = op;
              // const { name, args } = input as Event;
              if (this.loggableEvents.includes(op.path)) log(`emitDirect: ${op.path}`, op, input);

              (context.client as Shard.Client).socket.emit(
                'trpc',
                Buffer.from(
                  `{"id":"${generateShortId()}","method":"onEvents","type":"mutation","params":[["${
                    op.path
                  }",${Object.values(input)}]]}`
                )
              );

              observer.next({
                result: { data: { status: 1 } },
              });

              observer.complete();
            });
          },
      ],
      // transformer,
    });

    this.emitAll = createTRPCProxyClient<ShardClientRouter>({
      links: [
        () =>
          ({ op, next }) => {
            return observable((observer) => {
              const { input, context } = op;

              // if (this.loggableEvents.includes(op.path)) log('emitAll', op);

              // const { name, args } = input as Event;
              this.eventQueue.push({ name: op.path, args: Array.isArray(input) ? input : [input] }); // input as Array<any>

              observer.next({
                result: { data: { status: 1 } },
              });

              observer.complete();
            });
          },
      ],
      // transformer,
    });

    this.emitAllDirect = createTRPCProxyClient<ShardClientRouter>({
      links: [
        () =>
          ({ op, next }) => {
            return observable((observer) => {
              const { input, context } = op;

              if (op.path === 'onEvents') {
                const events = input as Event[];

                if (events.length) {
                  const now = this.getTime();

                  const events = op.input as Array<{ name: string; args: Array<any> }>;

                  if (this.debugQueue) log('Sending queue', events);

                  let recordDetailed = now - this.eventFlushedAt > 500;
                  if (recordDetailed) {
                    this.eventFlushedAt = now;
                  }

                  const compiled: string[] = [];
                  for (const e of events) {
                    try {
                      compiled.push(e.args ? `["${e.name}","${e.args.join(':')}"]` : `["${e.name}"]`);

                      if (e.name === 'onUpdateClient' || e.name === 'onSpawnPowerup') {
                        if (recordDetailed) {
                          this.round.events.push({ type: 'emitAll', name: e.name, args: e.args });
                        }
                      } else {
                        this.round.events.push({ type: 'emitAll', name: e.name, args: e.args });
                      }

                      if (this.loggableEvents.includes('onEvents')) log(`emitAllDirect: ${e.name}`, e.args);
                      // log('Emitting onEvents directly to all subscribers', op.path, compiled);
                    } catch (err) {
                      console.log('Problem with event', err, e);
                    }
                  }

                  this.app.io.emit(
                    'trpc',
                    Buffer.from(
                      `{"id":"${generateShortId()}","method":"onEvents","type":"mutation","params":[${compiled.join(
                        ','
                      )}]}`
                    )
                  );
                }
              } else {
                if (this.loggableEvents.includes(op.path)) log(`emitAllDirect: ${op.path}`, input);

                this.app.io.emit(
                  'trpc',
                  Buffer.from(
                    `{"id":"${generateShortId()}","method":"onEvents","type":"mutation","params":[["${
                      op.path
                    }",${Object.values(input)}]]}`
                  )
                );
              }

              observer.next({
                result: { data: { status: 1 } },
              });

              observer.complete();
            });
          },
      ],
      // transformer,
    });
  }

  clearSprites() {
    this.powerups.splice(0, this.powerups.length); // clear the powerup list
  }

  init() {
    // if (Object.keys(this.clientLookup).length == 0) {
    this.randomRoundPreset();
    this.clearSprites();
    this.spawnSprites(this.config.spritesStartCount);
    // }
    // console.log('ccccc', this.config);
    setTimeout(() => this.monitorRealm(), 30 * 1000);
    setTimeout(() => this.fastGameloop(), this.config.fastLoopSeconds * 1000);
    setTimeout(() => this.slowGameloop(), this.config.slowLoopSeconds * 1000);
    setTimeout(() => this.sendUpdates(), this.config.sendUpdateLoopSeconds * 1000);
    setTimeout(() => this.spawnRewards(), this.config.rewardSpawnLoopSeconds * 1000);
    setTimeout(() => this.checkConnectionLoop(), this.config.checkConnectionLoopSeconds * 1000);

    clearTimeout(this.roundLoopTimeout);
    this.roundLoopTimeout = setTimeout(() => {
      this.resetLeaderboard();
    }, this.config.roundLoopSeconds * 1000);
  }

  public async calcRoundRewards(input: any, ctx: any) {
    const configureRes = await this.realm.emit.configure.mutate({
      clients: this.clients.map((c: any) => ({
        id: c.id,
        name: c.name,
        address: c.address,
        joinedRoundAt: c.joinedRoundAt,
        points: c.points,
        kills: c.kills,
        killStreak: c.killStreak,
        deaths: c.deaths,
        evolves: c.evolves,
        rewards: c.rewards,
        orbs: c.orbs,
        powerups: c.powerups,
        baseSpeed: c.baseSpeed,
        decayPower: c.decayPower,
        pickups: c.pickups,
        xp: c.xp,
        maxHp: c.maxHp,
        avatar: c.avatar,
        speed: c.speed,
        cameraSize: c.cameraSize,
        log: c.log,
      })),
    });

    if (configureRes) {
      console.log('configureRes', configureRes);
      for (const key of Object.keys(configureRes)) {
        // console.log(key, res[key]);
        this.baseConfig[key] = configureRes[key];
        this.config[key] = configureRes[key];
        this.sharedConfig[key] = configureRes[key];
      }

      if (this.config.rewardWinnerAmount === 0 && configureRes.rewardWinnerAmount !== 0) {
        const roundTimer = this.round.startedDate + this.config.roundLoopSeconds - Math.round(this.getTime() / 1000);
        this.emit.onSetRoundInfo.mutate(
          [roundTimer, this.getRoundInfo().join(':'), this.getGameModeGuide().join(':')],
          { context: ctx }
        );
      }
    }
  }

  randomizeSpriteXp() {
    const shuffledValues = shuffleArray([2, 4, 8, 16]);
    this.config.powerupXp0 = shuffledValues[0];
    this.config.powerupXp1 = shuffledValues[1];
    this.config.powerupXp2 = shuffledValues[2];
    this.config.powerupXp3 = shuffledValues[3];
  }

  public async resetLeaderboard(preset: any = null, context: any = null) {
    log('resetLeaderboard', preset);

    try {
      clearTimeout(this.roundLoopTimeout);

      if (this.config.gameMode === 'Pandamonium') {
        clearTimeout(this.roundLoopTimeout);
        this.roundLoopTimeout = setTimeout(
          () => this.resetLeaderboard(preset, context),
          this.config.roundLoopSeconds * 1000
        );
        return;
      }

      if (!this.realm.client?.socket?.connected) {
        this.emit.onBroadcast.mutate([`Realm not connected. Contact support.`, 0], { context: context });
        clearTimeout(this.roundLoopTimeout);
        this.roundLoopTimeout = setTimeout(
          () => this.resetLeaderboard(preset, context),
          this.config.roundLoopSeconds * 1000
        );
        return;
      }

      this.round.endedAt = Math.round(this.getTime() / 1000);

      const fiveSecondsAgo = this.getTime() - 7000;
      const thirtySecondsAgo = this.getTime() - 30 * 1000;

      const winners = this.round.clients
        .filter((p) => p.lastUpdate >= fiveSecondsAgo)
        .sort((a, b) => b.points - a.points)
        .slice(0, 10);

      if (winners.length) {
        this.lastLeaderName = winners[0].name;
        log('Leader: ', winners[0]);

        if (winners[0]?.address) {
          this.emitAll.onRoundWinner.mutate([winners[0].name]);
        }

        if (this.config.isBattleRoyale) {
          this.emitAll.onBroadcast.mutate([
            `Top 5 - ${winners
              .slice(0, 5)
              .map((l) => l.name)
              .join(', ')}`,
            0,
          ]);
        }
      }

      const res = await this.realm.emit.saveRound.mutate({
        id: this.round.id + '',
        startedAt: this.round.startedDate,
        endedAt: this.round.endedAt,
        events: [],
        clients: this.round.clients.map((c: any) => ({
          id: c.id,
          name: c.name,
          address: c.address,
          joinedRoundAt: c.joinedRoundAt,
          points: c.points,
          kills: c.kills,
          killStreak: c.killStreak,
          deaths: c.deaths,
          evolves: c.evolves,
          rewards: c.rewards,
          orbs: c.orbs,
          powerups: c.powerups,
          baseSpeed: c.baseSpeed,
          decayPower: c.decayPower,
          pickups: c.pickups,
          xp: c.xp,
          maxHp: c.maxHp,
          avatar: c.avatar,
          speed: c.speed,
          cameraSize: c.cameraSize,
          log: c.log,
        })),
        states: [],
      });

      if (this.config.calcRoundRewards) {
        await this.calcRoundRewards(null, context);
      }

      if (preset) {
        this.roundConfig = {
          ...this.baseConfig,
          ...this.sharedConfig,
          ...preset,
        };
        this.config = JSON.parse(JSON.stringify(this.roundConfig));
      } else {
        this.randomRoundPreset();
      }

      // TODO: get ID from realm
      // this.baseConfig.roundId = this.baseConfig.roundId + 1;
      // this.round.id = this.baseConfig.roundId;

      this.round = {
        id: res.roundId,
        gameMode: this.config.gameMode,
        startedDate: Math.round(this.getTime() / 1000),
        endedAt: null,
        clients: [],
        events: [],
        states: [],
      };

      if (
        !this.config.level2open &&
        (this.config.level2forced ||
          (this.config.level2allowed && this.clients.length >= this.config.clientsRequiredForLevel2))
      ) {
        this.config.level2open = true;
        this.emitAll.onBroadcast.mutate([`Wall going down...`, 0]);

        this.config.spritesStartCount = 200;

        // setTimeout(() => {
        //   this.config.spritesStartCount = 200;
        //   this.clearSprites();
        //   this.spawnSprites(this.config.spritesStartCount);
        // }, 2000);

        this.emitAll.onOpenLevel2.mutate();
      } else if (this.config.level2open && !this.config.level2forced) {
        this.config.level2open = false;

        this.emitAll.onBroadcast.mutate([`Wall going up...`, 0]);

        this.config.spritesStartCount = 50;

        // this.config.spritesStartCount = 50;
        // this.clearSprites();
        // this.spawnSprites(this.config.spritesStartCount);

        // setTimeout(() => {
        //   for (const client of this.clients) {
        //     this.resetClient(client);
        //   }
        // }, 2000);

        this.emitAll.onCloseLevel2.mutate();
      }

      for (const client of this.clients) {
        if (!this.ranks[client.address]) this.ranks[client.address] = {};
        if (!this.ranks[client.address].kills) this.ranks[client.address].kills = 0;

        this.ranks[client.address].kills += client.kills;

        client.joinedRoundAt = this.getTime();
        client.points = 0;
        client.kills = 0;
        client.killStreak = 0;
        client.deaths = 0;
        client.evolves = 0;
        client.rewards = 0;
        client.orbs = 0;
        client.powerups = 0;
        client.baseSpeed = 0.8;
        client.decayPower = 1;
        client.pickups = [];
        client.xp = 75;
        client.maxHp = 100;
        client.avatar = this.config.startAvatar;
        client.speed = this.getClientSpeed(client);
        client.cameraSize = client.overrideCameraSize || this.config.cameraSize;
        client.log = {
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
          recentJoinProblem: 0,
          usernameProblem: 0,
          maintenanceJoin: 0,
          signatureProblem: 0,
          signinProblem: 0,
          versionProblem: 0,
          failedRealmCheck: 0,
          addressProblem: 0,
          replay: [],
        };
        client.gameMode = this.config.gameMode;

        if (this.config.gameMode === 'Pandamonium' && this.pandas.includes(client.address)) {
          client.avatar = 2;
          this.emitAll.onUpdateEvolution.mutate([client.id, client.avatar, client.speed]);
        } else {
          this.emitAll.onUpdateRegression.mutate([client.id, client.avatar, client.speed]);
        }

        if (client.isDead || client.isSpectating) continue;

        client.startedRoundAt = Math.round(this.getTime() / 1000);

        this.round.clients.push(client);
      }

      for (let i = 0; i < this.orbs.length; i++) {
        this.emitAll.onUpdatePickup.mutate(['null', this.orbs[i].id, 0]);
      }

      this.orbs.splice(0, this.orbs.length);

      this.randomizeSpriteXp();

      this.syncSprites();

      const roundTimer = this.round.startedDate + this.config.roundLoopSeconds - Math.round(this.getTime() / 1000);
      this.emitAll.onSetRoundInfo.mutate([
        roundTimer,
        this.getRoundInfo().join(':'),
        this.getGameModeGuide().join(':'),
      ]);

      log(
        'roundInfo',
        roundTimer,
        this.getRoundInfo().join(':'),
        this.getGameModeGuide().join(':'),
        (
          this.config.roundLoopSeconds +
          ':' +
          this.getRoundInfo().join(':') +
          ':' +
          this.getGameModeGuide().join(':')
        ).split(':').length
      );

      this.emitAll.onClearLeaderboard.mutate();

      this.emitAll.onBroadcast.mutate([`Game Mode - ${this.config.gameMode} (Round ${this.round.id})`, 0]);

      if (this.config.hideMap) {
        this.emitAll.onHideMinimap.mutate();
        this.emitAll.onBroadcast.mutate([`Minimap hidden in this mode!`, 2]);
      } else {
        this.emitAll.onShowMinimap.mutate();
      }

      if (this.config.periodicReboots && this.rebootAfterRound) {
        this.emitAll.onMaintenance.mutate([true]);

        setTimeout(() => {
          process.exit();
        }, 3 * 1000);
      }

      if (this.config.periodicReboots && this.announceReboot) {
        const value = 'Restarting server at end of this round.';

        this.emitAll.onBroadcast.mutate([value, 1]);

        this.rebootAfterRound = true;
      }

      this.roundLoopTimeout = setTimeout(
        () => this.resetLeaderboard(preset, context),
        this.config.roundLoopSeconds * 1000
      );
    } catch (e) {
      console.log('Exception during resetLeaderboard', e);

      setTimeout(() => {
        this.emit.onBroadcast.mutate([`Error Occurred. Please report.`, 3]);
      }, 30 * 1000);

      this.sharedConfig.rewardWinnerAmount = 0;
      this.config.rewardWinnerAmount = 0;
      this.sharedConfig.rewardItemAmount = 0;
      this.config.rewardItemAmount = 0;

      log('Shard -> Realm: recalling init');
      // Initialize the realm server with status 1
      const res = await this.realm.emit.init.mutate();
      log('init', res);

      // Check if initialization was successful
      if (!res) {
        throw new Error('Could not init self with realm');
      }

      // this.config.maxClients = res.maxClients;
      this.round.id = res.roundId;

      for (const key of Object.keys(res)) {
        // console.log(key, res[key]);
        this.baseConfig[key] = res[key];
        this.config[key] = res[key];
        this.sharedConfig[key] = res[key];
      }

      console.log('Setting config', this.config);

      if (this.config.calcRoundRewards) {
        await this.calcRoundRewards(null, context);
      }

      this.roundLoopTimeout = setTimeout(() => this.resetLeaderboard(preset, context), 5 * 1000);
    }
  }

  checkConnectionLoop(): void {
    if (!this.config.noBoot && !this.config.isRoundPaused) {
      const oneMinuteAgo = this.getTime() - this.config.disconnectClientSeconds * 1000;

      for (const client of this.clients) {
        if (client.isSpectating || client.isGod || client.isMod || client.isRealm) {
          continue;
        }

        if (client.lastReportedTime <= oneMinuteAgo) {
          client.log.timeoutDisconnect += 1;
          this.disconnectClient(client, 'timed out');
        }
      }
    }

    setTimeout(() => this.checkConnectionLoop(), this.config.checkConnectionLoopSeconds * 1000);
  }

  sendUpdates(): void {
    this.emitAll.onClearLeaderboard.mutate();

    const leaderboard = this.round.clients.sort(this.compareClients).slice(0, 10);
    for (let j = 0; j < leaderboard.length; j++) {
      this.emitAll.onUpdateBestClient.mutate([
        leaderboard[j].name,
        j,
        leaderboard[j].points,
        leaderboard[j].kills,
        leaderboard[j].deaths,
        leaderboard[j].powerups,
        leaderboard[j].evolves,
        leaderboard[j].rewards,
        leaderboard[j].isDead ? '-' : Math.round(leaderboard[j].latency),
        this.ranks[leaderboard[j].address]?.kills / 5 || 1,
      ]);
    }

    this.flushEventQueue();

    setTimeout(() => this.sendUpdates(), this.config.sendUpdateLoopSeconds * 1000);
  }

  spawnRewards(): void {
    this.spawnRandomReward();

    setTimeout(() => this.spawnRewards(), this.config.rewardSpawnLoopSeconds * 1000);
  }

  public async spawnRandomReward(): Promise<void> {
    if (this.currentReward) {
      return;
    }

    this.removeReward();

    const tempReward = await this.realm.emit.getRandomReward.mutate();

    if (!tempReward) {
      return;
    }

    if (tempReward.type !== 'token') {
      this.emitAll.onBroadcast.mutate([`${tempReward.rewardItemName}`, 3]); // Powerful Energy Detected -
    }

    await sleep(3 * 1000);

    if (tempReward.rewardItemName) {
      this.currentReward = { ...tempReward };

      // rewardItemType = 0 = token | 1 = item | 2 = guardian | 3 = cube | 4 = trinket | 5 = old | 6 = santahat
      this.emitAll.onSpawnReward.mutate([
        this.currentReward.id,
        this.currentReward.rewardItemType,
        this.currentReward.rewardItemName,
        this.currentReward.quantity,
        this.currentReward.position.x,
        this.currentReward.position.y,
      ]);
    }

    await sleep(30 * 1000);
    if (!this.currentReward) return;
    if (this.currentReward.id !== tempReward.id) return;

    this.removeReward();
  }

  slowGameloop() {
    if (this.config.dynamicDecayPower) {
      const clients = this.clients.filter((p) => !p.isDead && !p.isSpectating);
      const maxEvolvedClients = clients.filter((p) => p.avatar === this.config.maxEvolves - 1);

      this.config.avatarDecayPower0 =
        this.roundConfig.avatarDecayPower0 +
        maxEvolvedClients.length * this.config.decayPowerPerMaxEvolvedClients * 0.33;
      this.config.avatarDecayPower1 =
        this.roundConfig.avatarDecayPower1 +
        maxEvolvedClients.length * this.config.decayPowerPerMaxEvolvedClients * 0.66;
      this.config.avatarDecayPower2 =
        this.roundConfig.avatarDecayPower1 + maxEvolvedClients.length * this.config.decayPowerPerMaxEvolvedClients * 1;
    }

    // if (this.config.calcRoundRewards && this.config.rewardWinnerAmount === 0) {
    //   await this.calcRoundRewards()
    // }

    setTimeout(() => this.slowGameloop(), this.config.slowLoopSeconds * 1000);
  }

  monitorRealm(): void {
    if (!this.realm.client?.socket?.connected) {
      this.emitAll.onBroadcast.mutate([`Realm not connected. Contact support.`, 0]);
      this.disconnectAllClients();
    }

    setTimeout(() => this.monitorRealm(), 5 * 1000);
  }

  async fastGameloop() {
    // console.log('fastGameloop');
    try {
      const now = this.getTime();

      this.detectCollisions();

      if (FF.MASTER_MODE) {
        if (!this.master) {
          log('Master not set');
          setTimeout(() => this.fastGameloop(), 10 * 1000);
          return;
        }
        // get player positions
        const playerUpdates = await this.master.emit.onGetPlayerUpdates.mutate();
      }

      for (let i = 0; i < this.clients.length; i++) {
        const client = this.clients[i];
        // console.log(client);
        if (client.isDisconnected || client.isDead || client.isSpectating || client.isJoining) continue;

        const currentTime = Math.round(now / 1000);
        const isInvincible =
          this.config.isGodParty ||
          client.isSpectating ||
          client.isGod ||
          client.isInvincible ||
          client.invincibleUntil > currentTime;
        const isPhased = client.isPhased ? true : now <= client.phasedUntil;

        if (client.isPhased && now > client.phasedUntil) {
          client.isPhased = false;
          client.phasedUntil = 0;
        }

        if (client.overrideSpeed && client.overrideSpeedUntil && now > client.overrideSpeedUntil) {
          client.overrideSpeed = null;
          client.overrideSpeedUntil = 0;
        }

        client.speed = this.getClientSpeed(client);

        if (!this.config.isRoundPaused && this.config.gameMode !== 'Pandamonium') {
          let decay = this.config.noDecay
            ? 0
            : ((client.avatar + 1) / (1 / this.config.fastLoopSeconds)) *
              ((this.config['avatarDecayPower' + client.avatar] || 1) * this.config.decayPower);

          if (
            this.isMechanicEnabled({ id: Mechanic.EnergyDecayIncrease }, { client }) &&
            this.isMechanicEnabled({ id: Mechanic.EnergyDecayDecrease }, { client })
          ) {
            decay =
              decay *
              (1 +
                (client.character.meta[Mechanic.EnergyDecayIncrease] -
                  client.character.meta[Mechanic.EnergyDecayDecrease]) /
                  100);
          }

          this.handleClientDecay(client, decay, now, isInvincible, currentTime);
        }

        client.latency = (now - client.lastReportedTime) / 2;

        if (Number.isNaN(client.latency)) {
          client.latency = 0;
        }

        if (this.config.gameMode === 'Pandamonium' && this.pandas.includes(client.address)) {
          client.avatar = 2;
        }

        this.emitAll.onUpdatePlayer.mutate([
          client.id,
          client.overrideSpeed || client.speed,
          client.overrideCameraSize || client.cameraSize,
          client.position.x,
          client.position.y,
          client.position.x, // target
          client.position.y, // target
          Math.floor(client.xp),
          now,
          Math.round(client.latency),
          isInvincible ? '1' : '0',
          client.isStuck ? '1' : '0',
          isPhased && !isInvincible ? '1' : '0',
        ]);
      }

      this.flushEventQueue();

      if (this.config.gameMode === 'Hayai') {
        this.adjustGameSpeed();
      }

      this.checkBattleRoyaleEnd();

      this.lastFastGameloopTime = now;
    } catch (e) {
      log('Error:', e);
      this.disconnectAllClients();
      setTimeout(() => process.exit(1), 2 * 1000);
    }
    // console.log('this.config.fastLoopSeconds');
    setTimeout(() => this.fastGameloop(), this.config.fastLoopSeconds * 1000);
  }

  disconnectAllClients(): void {
    if (this.clients.length === 0) return;

    log('Disconnecting all clients');

    for (const client of this.clients) {
      this.disconnectClient(client, 'disconnect all clients');
    }
  }

  handleClientDecay(
    client: Shard.Client,
    decay: number,
    now: number,
    isInvincible: boolean,
    currentTime: number
  ): void {
    if (client.xp > client.maxHp) {
      if (decay > 0) {
        if (client.avatar < this.config.maxEvolves - 1) {
          client.xp = client.xp - client.maxHp;
          client.avatar = Math.max(
            Math.min(client.avatar + 1 * this.config.avatarDirection, this.config.maxEvolves - 1),
            0
          );
          client.evolves += 1;
          client.points += this.config.pointsPerEvolve;

          if (this.config.leadercap && client.name === this.lastLeaderName) {
            client.speed = client.speed * 0.8;
          }

          if (
            this.isMechanicEnabled({ id: Mechanic.EvolveMovementBurst }, { client }) &&
            client.character.meta[Mechanic.EvolveMovementBurst] > 0
          ) {
            client.overrideSpeedUntil = this.getTime() + 1000;
            client.overrideSpeed = client.speed * (1 + client.character.meta[Mechanic.EvolveMovementBurst] / 100);

            if (
              this.isMechanicEnabled({ id: Mechanic.MovementSpeedIncrease }, { client }) &&
              client.character.meta[Mechanic.MovementSpeedIncrease] > 0
            ) {
              client.overrideSpeed =
                client.overrideSpeed * (1 + client.character.meta[Mechanic.MovementSpeedIncrease] / 100);
            }
          }

          this.emitAll.onUpdateEvolution.mutate([client.id, client.avatar, client.overrideSpeed || client.speed]);
        } else {
          client.xp = client.maxHp;
        }
      } else {
        if (client.avatar >= this.config.maxEvolves - 1) {
          client.xp = client.maxHp;
        } else {
          client.xp = client.xp - client.maxHp;
          client.avatar = Math.max(
            Math.min(client.avatar + 1 * this.config.avatarDirection, this.config.maxEvolves - 1),
            0
          );
          client.evolves += 1;
          client.points += this.config.pointsPerEvolve;

          if (this.config.leadercap && client.name === this.lastLeaderName) {
            client.speed = client.speed * 0.8;
          }

          if (
            this.isMechanicEnabled({ id: Mechanic.EvolveMovementBurst }, { client }) &&
            client.character.meta[Mechanic.EvolveMovementBurst] > 0
          ) {
            client.overrideSpeedUntil = this.getTime() + 1000;
            client.overrideSpeed = client.speed * (1 + client.character.meta[Mechanic.EvolveMovementBurst] / 100);

            if (
              this.isMechanicEnabled({ id: Mechanic.MovementSpeedIncrease }, { client }) &&
              client.character.meta[Mechanic.MovementSpeedIncrease] > 0
            ) {
              client.overrideSpeed =
                client.overrideSpeed * (1 + client.character.meta[Mechanic.MovementSpeedIncrease] / 100);
            }
          }

          this.emitAll.onUpdateEvolution.mutate([client.id, client.avatar, client.overrideSpeed || client.speed]);
        }
      }
    } else {
      if (!isInvincible) {
        client.xp -= decay * client.decayPower;
      }

      if (client.xp <= 0) {
        client.xp = 0;

        if (decay > 0) {
          if (client.avatar === 0) {
            const isNew = client.joinedAt >= currentTime - this.config.immunitySeconds;

            if (!this.config.noBoot && !isInvincible && !isNew && !this.config.isGodParty) {
              client.log.ranOutOfHealth += 1;

              if (client.lastTouchTime > now - 2000) {
                this.registerKill(this.clientLookup[client.lastTouchClientId], client);
              } else {
                // this.disconnectClient(client, 'starved');
                this.handleUpgrades(client);
                this.spectate(null, { client });
              }
            }
          } else {
            client.xp = client.maxHp;
            client.avatar = Math.max(
              Math.min(client.avatar - 1 * this.config.avatarDirection, this.config.maxEvolves - 1),
              0
            );

            if (this.config.leadercap && client.name === this.lastLeaderName) {
              client.speed = client.speed * 0.8;
            }

            this.emitAll.onUpdateRegression.mutate([client.id, client.avatar, client.overrideSpeed || client.speed]);
          }
        } else {
          if (client.avatar === 0) {
            client.xp = 0;
          } else {
            client.xp = client.maxHp;
            client.avatar = Math.max(
              Math.min(client.avatar - 1 * this.config.avatarDirection, this.config.maxEvolves - 1),
              0
            );

            if (this.config.leadercap && client.name === this.lastLeaderName) {
              client.speed = client.speed * 0.8;
            }

            this.emitAll.onUpdateRegression.mutate([client.id, client.avatar, client.overrideSpeed || client.speed]);
          }
        }
      }
    }
  }

  handleUpgrades(client: Shard.Client): void {
    if (client.upgradesPending === 0) return;

    this.emit.onUpgrade.mutate([client.upgradesPending, client.upgradeRerolls, ['200', '201', '202']], {
      context: { client },
    });
  }

  async chooseUpgrade(
    input: Shard.RouterInput['chooseUpgrade'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['chooseUpgrade']> {
    log('chooseUpgrade', input, client.address, client.upgradesPending);

    if (client.upgradesPending === 0) return;

    client.upgradesPending -= 1;

    if (input == '200') {
      client.speed += 2;

      // this.emit.onBroadcast.mutate([`Error Occurred. Please report.`, 3]);
      this.emitAll.onBroadcast.mutate([`${client.name} joined BLM`, 0]);
    }
    if (input == '201') {
      client.speed += 2;

      this.emitAll.onBroadcast.mutate([`${client.name} got speedy`, 0]);
    }
    if (input == '202') {
      client.speed += 2;

      this.emitAll.onBroadcast.mutate([`${client.name} got a bump`, 0]);
    }

    this.handleUpgrades(client);
  }

  registerKill(winner: Shard.Client, loser: Shard.Client): void {
    const now = this.getTime();

    if (this.config.isGodParty) return;
    if (winner.isInvincible || loser.isInvincible) return;
    if (winner.isGod || loser.isGod) return;
    if (winner.isDead) return;

    if (this.config.gameMode !== 'Pandamonium' || !this.pandas.includes(winner.address)) {
      if (this.config.preventBadKills && (winner.isPhased || now < winner.phasedUntil)) return;

      const totalKills = winner.log.kills.filter((h) => h === loser.hash).length;
      const notReallyTrying = this.config.antifeed1
        ? (totalKills >= 2 && loser.kills < 2 && loser.rewards <= 1) ||
          (totalKills >= 2 && loser.kills < 2 && loser.powerups <= 100)
        : false;
      const tooManyKills = this.config.antifeed2
        ? this.clients.length > 2 &&
          totalKills >= 5 &&
          totalKills > winner.log.kills.length / this.clients.filter((c) => !c.isDead).length
        : false;
      const killingThemselves = this.config.antifeed3 ? winner.hash === loser.hash : false;
      const allowKill = !notReallyTrying && !tooManyKills;

      if (notReallyTrying) {
        loser.log.notReallyTrying += 1;
      }
      if (tooManyKills) {
        loser.log.tooManyKills += 1;
        return;
      }
      if (killingThemselves) {
        loser.log.killingThemselves += 1;
      }

      if (this.config.preventBadKills && !allowKill) {
        loser.phasedUntil = this.getTime() + 2000;
        return;
      }
    }

    if (this.config.gameMode === 'Pandamonium' && !this.pandas.includes(winner.address)) {
      return;
    }

    loser.xp -= this.config.damagePerTouch;
    winner.xp -= this.config.damagePerTouch;

    const time = this.getTime();

    loser.overrideSpeed = 2.5;
    loser.overrideSpeedUntil = time + 2000;

    winner.overrideSpeed = 2.5;
    winner.overrideSpeedUntil = time + 2000;

    if (loser.avatar !== 0 || loser.xp > 0) {
      loser.lastTouchClientId = winner.id;
      winner.lastTouchClientId = loser.id;
      loser.lastTouchTime = time;
      winner.lastTouchTime = time;
      return;
    }

    winner.kills += 1;
    winner.killStreak += 1;
    winner.points += this.config.pointsPerKill * (loser.avatar + 1);
    winner.log.kills.push(loser.hash);

    let deathPenaltyAvoid = false;

    if (
      this.isMechanicEnabled({ id: Mechanic.DeathPenaltyAvoid }, { client: loser }) &&
      loser.character.meta[Mechanic.DeathPenaltyAvoid] > 0
    ) {
      const r = this.random(1, 100);

      if (r <= loser.character.meta[Mechanic.DeathPenaltyAvoid]) {
        deathPenaltyAvoid = true;
        this.emitAll.onBroadcast.mutate([`${loser.name} avoided penalty!`, 0]);
      }
    }

    let orbOnDeathPercent =
      this.config.orbOnDeathPercent > 0
        ? this.config.leadercap && loser.name === this.lastLeaderName
          ? 50
          : this.config.orbOnDeathPercent
        : 0;
    let orbPoints = Math.floor(loser.points * (orbOnDeathPercent / 100));

    if (deathPenaltyAvoid) {
      orbOnDeathPercent = 0;
      orbPoints = 0;
    } else {
      loser.points = Math.floor(loser.points * ((100 - orbOnDeathPercent) / 100));
    }

    loser.deaths += 1;
    loser.killStreak = 0;
    loser.isDead = true;
    loser.log.deaths.push(winner.hash);

    // Chance for upgrade for dying
    loser.upgradesPending += chance(10) ? 1 : 0;

    // Chance for upgrade for 500 points, but less chance if they have equal amount of upgrades already
    // 500 points + 0 upgrades = (500 / 500) - 0 = 100%
    // 1000 points + 0 upgrades = (1000 / 500) - 0 = 200%
    // 1000 points + 2 upgrades = (1000 / 500) - 2 = 0%
    // So basically 500 points guarantees an upgrade on death instead of 10% random, if you have no upgrades
    // And you need to acquire 1000 points to get the next upgrade, or you don't get more on death
    // Meanwhile, somebody with less than 500 points always has a 10% chance on death
    // So the RNG gods could theoretically grant them more upgrades than the players with more points
    loser.upgradesPending += chance((Math.floor(loser.points / 500) - loser.upgrades.length) * 100) ? 1 : 0;

    if (winner.points < 0) winner.points = 0;
    if (loser.points < 0) loser.points = 0;

    winner.upgradeRerolls += 1;

    if (winner.log.deaths.length && winner.log.deaths[winner.log.deaths.length - 1] === loser.hash) {
      winner.log.revenge += 1;
    }

    if (
      this.isMechanicEnabled({ id: Mechanic.IncreaseMovementSpeedOnKill }, { client: winner }) &&
      winner.character.meta[Mechanic.IncreaseMovementSpeedOnKill] > 0
    ) {
      winner.overrideSpeed =
        winner.speed *
        (1 + winner.character.meta[Mechanic.IncreaseMovementSpeedOnKill] / 100) *
        (1 + winner.character.meta[Mechanic.MovementSpeedIncrease] / 100);
      winner.overrideSpeedUntil = this.getTime() + 5000;
    }

    if (
      this.isMechanicEnabled({ id: Mechanic.IncreaseHealthOnKill }, { client: winner }) &&
      winner.character.meta[Mechanic.IncreaseHealthOnKill] > 0
    ) {
      winner.maxHp = winner.maxHp * (1 + winner.character.meta[Mechanic.IncreaseHealthOnKill] / 100);
    }

    winner.xp += 25;

    if (winner.xp > winner.maxHp) winner.xp = winner.maxHp;

    this.emitAll.onGameOver.mutate([loser.id, winner.id]);
    this.handleUpgrades(loser);

    // this.disconnectClient(loser, 'got killed');
    this.spectate(null, { client: loser });

    const orb: Orb = {
      id: generateShortId(),
      type: 4,
      points: orbPoints,
      scale: orbPoints,
      enabledDate: now + this.config.orbTimeoutSeconds * 1000,
      position: {
        x: loser.position.x,
        y: loser.position.y,
      },
    };

    const currentRound = this.round.id;

    if (this.config.orbOnDeathPercent > 0 && !this.roundEndingSoon(this.config.orbCutoffSeconds)) {
      setTimeout(() => {
        if (this.round.id !== currentRound) return;

        this.orbs.push(orb);
        this.orbLookup[orb.id] = orb;

        this.emitAll.onSpawnPowerUp.mutate([orb.id, orb.type, orb.position.x, orb.position.y, orb.scale]);
      }, this.config.orbTimeoutSeconds * 1000);
    }
  }

  adjustGameSpeed(): void {
    const timeStep = 5 * 60 * (this.config.fastLoopSeconds * 1000);
    const speedMultiplier = 0.25;

    this.config.baseSpeed += this.normalizeFloat((5 * speedMultiplier) / timeStep);
    this.config.checkPositionDistance += this.normalizeFloat((6 * speedMultiplier) / timeStep);
    this.config.checkInterval += this.normalizeFloat((3 * speedMultiplier) / timeStep);
  }

  checkBattleRoyaleEnd(): void {
    const totalAliveClients = this.clients.filter((client) => !client.isGod && !client.isSpectating && !client.isDead);

    if (this.config.isBattleRoyale && totalAliveClients.length === 1) {
      this.emitAll.onBroadcast.mutate([`${totalAliveClients[0].name} is the last dragon standing`, 3]);

      this.baseConfig.isBattleRoyale = false;
      this.config.isBattleRoyale = false;
      this.baseConfig.isGodParty = true;
      this.config.isGodParty = true;
    }
  }

  getTime(): number {
    return Date.now();
  }

  async initMaster(
    input: Shard.RouterInput['initMaster'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['initMaster']> {
    log('initMaster', input);

    if (client.address !== '0x954246b18fee13712C48E5a7Da5b78D88e8891d5') {
      throw new Error('Not authorized');
    }

    if (this.master?.client) {
      this.master.client.isMaster = false;

      this.disconnectClient(this.master.client, 'Master already connected');

      // throw new Error('Master already connected');
    }

    client.isMaster = true;
    client.roles.push('master');

    client.ioCallbacks = {};

    this.master = {
      client,
      emit: createTRPCProxyClient<Bridge.Router>({
        links: [
          () =>
            ({ op, next }) => {
              const id = generateShortId();
              return observable((observer) => {
                const { input } = op;

                op.context.client = client;
                // @ts-ignore
                op.context.client.roles = ['user', 'guest'];

                if (!client) {
                  log('Shard -> Bridge: mit Direct failed, no client', op);
                  observer.complete();
                  return;
                }

                if (!client.socket || !client.socket.emit) {
                  log('Shard -> Master: Emit Direct failed, bad socket', op);
                  observer.complete();
                  return;
                }
                log('Shard -> Master: Emit Direct', op);

                const request = { id, method: op.path, type: op.type, params: serialize(input) };
                client.socket.emit('trpc', request);

                // save the ID and callback when finished
                const timeout = setTimeout(() => {
                  log('Shard -> Master: Request timed out', op);
                  delete client.ioCallbacks[id];
                  observer.error(new TRPCClientError('Shard -> Master: Request timeout'));
                }, 15000); // 15 seconds timeout

                client.ioCallbacks[id] = {
                  request,
                  timeout,
                  resolve: (response) => {
                    log('Shard -> Master: ioCallbacks.resolve', id, response);
                    clearTimeout(timeout);
                    if (response.error) {
                      observer.error(response.error);
                    } else {
                      observer.next(response);
                      observer.complete();
                    }
                    delete client.ioCallbacks[id]; // Cleanup after completion
                  },
                  reject: (error) => {
                    log('Shard -> Master: ioCallbacks.reject', error);
                    clearTimeout(timeout);
                    observer.error(error);
                    delete client.ioCallbacks[id]; // Cleanup on error
                  },
                };
              });
            },
        ],
      }),
    };

    log('Shard -> Master: calling init');
    // Initialize the master server with status 1
    const res = await this.master.emit.init.mutate();
    log('init', res);

    // Check if initialization was successful
    if (!res) {
      throw new Error('Could not init self with master');
    }
  }

  async initRealm(
    input: Shard.RouterInput['initRealm'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['initRealm']> {
    log('initRealm', input);
    // async connected(input: Shard.ConnectedInput, { client }: Shard.ServiceContext): Shard.ConnectedOutput {
    if (this.realm?.client?.socket?.connected) {
      this.disconnectClient(this.realm.client, 'Realm already connected');

      throw new Error('Realm already connected');
    }

    client.isRealm = true;
    client.roles.push('realm');

    client.ioCallbacks = {};

    this.realm = {
      client,
      emit: createTRPCProxyClient<Bridge.Router>({
        links: [
          () =>
            ({ op, next }) => {
              const id = generateShortId();
              return observable((observer) => {
                const { input } = op;

                op.context.client = client;
                // @ts-ignore
                op.context.client.roles = ['admin', 'user', 'guest'];

                if (!client) {
                  log('Shard -> Bridge: mit Direct failed, no client', op);
                  observer.complete();
                  return;
                }

                if (!client.socket || !client.socket.emit) {
                  log('Shard -> Realm: Emit Direct failed, bad socket', op);
                  observer.complete();
                  return;
                }
                log('Shard -> Realm: Emit Direct', op);

                const request = { id, method: op.path, type: op.type, params: serialize(input) };
                client.socket.emit('trpc', request);

                // save the ID and callback when finished
                const timeout = setTimeout(() => {
                  log('Shard -> Realm: Request timed out', op);
                  delete client.ioCallbacks[id];
                  observer.error(new TRPCClientError('Shard -> Realm: Request timeout'));
                }, 15000); // 15 seconds timeout

                client.ioCallbacks[id] = {
                  request,
                  timeout,
                  resolve: (response) => {
                    log('Shard -> Realm: ioCallbacks.resolve', id, response);
                    clearTimeout(timeout);
                    if (response.error) {
                      observer.error(response.error);
                    } else {
                      observer.next(response);
                      observer.complete();
                    }
                    delete client.ioCallbacks[id]; // Cleanup after completion
                  },
                  reject: (error) => {
                    log('Shard -> Realm: ioCallbacks.reject', error);
                    clearTimeout(timeout);
                    observer.error(error);
                    delete client.ioCallbacks[id]; // Cleanup on error
                  },
                };
              });
              // return observable((observer) => {
              //   const { input, context } = op;

              //   if (!client) {
              //     log('Emit Shard -> Bridge failed, no client', op);
              //     observer.complete();
              //     return;
              //   }

              //   if (!client.socket || !client.socket.emit) {
              //     log('Emit Shard -> Bridge failed, bad socket', op);
              //     observer.complete();
              //     return;
              //   }
              //   log('Emit Shard -> Bridge', op);

              //   client.socket.emit('trpc', { id: op.id, method: op.path, type: op.type, params: input });

              //   observer.complete();
              // });
            },
        ],
        // transformer: dummyTransformer,
      }),
    };

    log('Shard -> Realm: calling init');
    // Initialize the realm server with status 1
    const res = await this.realm.emit.init.mutate();
    log('init', res);

    // Check if initialization was successful
    if (!res) {
      throw new Error('Could not init self with realm');
    }

    // this.config.maxClients = res.maxClients;
    this.round.id = res.roundId;

    for (const key of Object.keys(res)) {
      // console.log(key, res[key]);
      this.baseConfig[key] = res[key];
      this.config[key] = res[key];
      this.sharedConfig[key] = res[key];
    }

    console.log('Setting config', this.config);

    this.init();
  }

  randomRoundPreset(): void {
    const gameMode = this.config.gameMode;
    while (this.config.gameMode === gameMode) {
      const filteredPresets = presets.filter((p) => !!p.isEnabled);
      this.currentPreset = weightedRandom(filteredPresets);
      this.roundConfig = { ...this.baseConfig, ...this.sharedConfig, ...this.currentPreset };
      log('randomRoundPreset', this.config.gameMode, gameMode, this.currentPreset);
      this.config = JSON.parse(JSON.stringify(this.roundConfig));
    }
  }

  removeSprite(id: string): void {
    if (this.powerupLookup[id]) {
      delete this.powerupLookup[id];
    }
    for (let i = 0; i < this.powerups.length; i++) {
      if (this.powerups[i].id === id) {
        this.powerups.splice(i, 1);
        break;
      }
    }
  }

  removeOrb(id: string): void {
    if (this.orbLookup[id]) {
      delete this.orbLookup[id];
    }
    for (let i = 0; i < this.orbs.length; i++) {
      if (this.orbs[i].id === id) {
        this.orbs.splice(i, 1);
        break;
      }
    }
  }

  removeReward(): void {
    if (!this.currentReward) return;
    this.emitAll.onUpdateReward.mutate(['null', this.currentReward.id]);
    this.currentReward = undefined;
  }

  getUnobstructedPosition(): Position {
    const spawnBoundary = this.config.level2open ? this.spawnBoundary2 : this.spawnBoundary1;
    let res: Position | null = null;
    while (!res) {
      let collided = false;
      const position = {
        x: randomPosition(spawnBoundary.x.min, spawnBoundary.x.max),
        y: randomPosition(spawnBoundary.y.min, spawnBoundary.y.max),
      };
      for (const gameObject of mapData) {
        if (!gameObject.Colliders || !gameObject.Colliders.length) continue;
        for (const gameCollider of gameObject.Colliders) {
          const collider = {
            minX: gameCollider.Min[0],
            maxX: gameCollider.Max[0],
            minY: gameCollider.Min[1],
            maxY: gameCollider.Max[1],
          };
          if (this.config.level2open && gameObject.Name === 'Level2Divider') {
            continue;
            // const diff = 25;
            // collider.minY -= diff;
            // collider.maxY -= diff;
          }
          if (
            position.x >= collider.minX &&
            position.x <= collider.maxX &&
            position.y >= collider.minY &&
            position.y <= collider.maxY
          ) {
            collided = true;
            break;
          }
        }
        if (collided) break;
      }
      if (!collided) {
        res = position;
      }
    }
    return res;
  }

  spawnSprites(amount: number): void {
    for (let i = 0; i < amount; i++) {
      const position = this.getUnobstructedPosition();
      const powerupSpawnPoint = { id: generateShortId(), type: Math.floor(Math.random() * 4), scale: 1, position };
      this.powerups.push(powerupSpawnPoint);
      this.powerupLookup[powerupSpawnPoint.id] = powerupSpawnPoint;
      this.emitAll.onSpawnPowerUp.mutate([
        powerupSpawnPoint.id,
        powerupSpawnPoint.type,
        powerupSpawnPoint.position.x,
        powerupSpawnPoint.position.y,
        powerupSpawnPoint.scale,
      ]);
    }
    this.config.spritesTotal = this.powerups.length;
  }

  addToRecentClients(client: Shard.Client): void {
    if (!client.address || !client.name) return;
    this.round.clients = this.round.clients.filter((r) => r.address !== client.address);
    this.round.clients.push(client);
  }

  roundEndingSoon(sec: number): boolean {
    const roundTimer = this.round.startedDate + this.config.roundLoopSeconds - Math.round(this.getTime() / 1000);
    return roundTimer < sec;
  }

  generateGuestName(): string {
    const randomIndex = Math.floor(Math.random() * this.guestNames.length);
    return this.guestNames[randomIndex];
  }

  async seerConnected(
    input: Shard.RouterInput['seerConnected'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['seerConnected']> {
    this.emitAll.onBroadcast.mutate(['Seer connected', 0]);
  }

  async seerDisconnected(
    input: Shard.RouterInput['seerDisconnected'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['seerDisconnected']> {
    this.emitAll.onBroadcast.mutate(['Seer disconnected', 0]);
  }

  async broadcastMechanics(
    input: Shard.RouterInput['broadcastMechanics'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['broadcastMechanics']> {
    if (this.isMechanicEnabled({ id: Mechanic.WinRewardsIncrease }, { client })) {
      this.emit.onBroadcast.mutate([
        `${this.formatNumber(
          client.character.meta[Mechanic.WinRewardsIncrease] - client.character.meta[Mechanic.WinRewardsDecrease]
        )}% Rewards`,
        0,
        { context: { client } },
      ]);
    }
    if (this.isMechanicEnabled({ id: Mechanic.IncreaseMovementSpeedOnKill }, { client })) {
      this.emit.onBroadcast.mutate(
        [
          `${this.formatNumber(client.character.meta[Mechanic.IncreaseMovementSpeedOnKill])}% Movement Burst On Kill`,
          0,
        ],
        { context: { client } }
      );
    }
    if (this.isMechanicEnabled({ id: Mechanic.EvolveMovementBurst }, { client })) {
      this.emit.onBroadcast.mutate(
        [`${this.formatNumber(client.character.meta[Mechanic.EvolveMovementBurst])}% Movement Burst On Evolve`, 0],
        { context: { client } }
      );
    }
    if (this.isMechanicEnabled({ id: Mechanic.MovementSpeedIncrease }, { client })) {
      this.emit.onBroadcast.mutate(
        [`${this.formatNumber(client.character.meta[Mechanic.MovementSpeedIncrease])}% Movement Burst Strength`, 0],
        { context: { client } }
      );
    }
    if (this.isMechanicEnabled({ id: Mechanic.DeathPenaltyAvoid }, { client })) {
      this.emit.onBroadcast.mutate(
        [`${this.formatNumber(client.character.meta[Mechanic.DeathPenaltyAvoid])}% Avoid Death Penalty`, 0],
        { context: { client } }
      );
    }
    if (this.isMechanicEnabled({ id: Mechanic.DoublePickupChance }, { client })) {
      this.emit.onBroadcast.mutate(
        [`${this.formatNumber(client.character.meta[Mechanic.DoublePickupChance])}% Double Pickup Chance`, 0],
        { context: { client } }
      );
    }
    if (this.isMechanicEnabled({ id: Mechanic.IncreaseHealthOnKill }, { client })) {
      this.emit.onBroadcast.mutate(
        [`${this.formatNumber(client.character.meta[Mechanic.IncreaseHealthOnKill])}% Increased Health On Kill`, 0],
        { context: { client } }
      );
    }
    if (this.isMechanicEnabled({ id: Mechanic.EnergyDecayIncrease }, { client })) {
      this.emit.onBroadcast.mutate(
        [
          `${this.formatNumber(
            client.character.meta[Mechanic.EnergyDecayIncrease] -
              client.character.meta[Mechanic.EnergyDecayIncrease - 1]
          )}% Energy Decay`,
          0,
        ],
        { context: { client } }
      );
    }
    if (this.isMechanicEnabled({ id: Mechanic.SpriteFuelIncrease }, { client })) {
      this.emit.onBroadcast.mutate(
        [
          `${this.formatNumber(
            client.character.meta[Mechanic.SpriteFuelIncrease] - client.character.meta[Mechanic.SpriteFuelIncrease - 1]
          )}% Sprite Fuel`,
          0,
        ],
        { context: { client } }
      );
    }
  }

  isMechanicEnabled(
    input: Shard.RouterInput['isMechanicEnabled'],
    { client }: Shard.ServiceContext
  ): Shard.RouterOutput['isMechanicEnabled'] {
    if (!input) throw new Error('Input should not be void');

    return this.config.mechanicsAllowed && !!client.character.meta[input.id];
  }

  async setCharacter(
    input: Shard.RouterInput['setCharacter'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['setCharacter']> {
    if (!input) throw new Error('Input should not be void');

    // Check if the client is a realm client
    if (!client.isRealm) {
      throw new Error('Unauthorized. Realm only.');
    }

    // Find the client with the specified address
    const newClient = this.clients.find((c) => c.address === input.address);
    if (!newClient) {
      throw new Error('Client not found');
    }

    // Update the character information
    newClient.character = {
      ...input.character,
      meta: { ...newClient.character.meta, ...input.character.meta },
    };
  }

  async setConfig(
    input: Shard.RouterInput['setConfig'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['setConfig']> {}

  async getConfig(
    input: Shard.RouterInput['getConfig'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['getConfig']> {
    return this.config;
  }

  async load(input: Shard.RouterInput['load'], { client }: Shard.ServiceContext): Promise<Shard.RouterOutput['load']> {
    log('Load', client.id, client.hash);
    this.emit.onLoaded.mutate([1], { context: { client } });
  }

  async spectate(
    input: Shard.RouterInput['spectate'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['spectate']> {
    // Spectating is not allowed during maintenance unless the client is a moderator
    if (this.config.isMaintenance && !client.isMod) throw new Error('Unauthorized');

    if (client.isSpectating) {
      // Handle case where client is already spectating (commented-out logic for unspectating)
      // You may want to define this logic if needed.
    } else {
      // Enable spectating for the client
      client.isSpectating = true;
      client.isInvincible = true;
      // client.points = 0;
      // client.xp = 0;
      // client.maxHp = 100;
      client.avatar = this.config.startAvatar;
      client.speed = 7;
      client.overrideSpeed = 7;
      client.cameraSize = 8;
      client.overrideCameraSize = 8;
      client.log.spectating += 1;

      this.syncSprites();
      this.emitAll.onSpectate.mutate([client.id, client.speed, client.cameraSize]);
    }
  }

  syncSprites() {
    log('Syncing sprites');
    const clientCount = this.clients.filter((c) => !c.isDead && !c.isSpectating && !c.isGod).length;
    const length = this.config.spritesStartCount + clientCount * this.config.spritesPerClientCount;

    if (this.powerups.length > length) {
      const deletedPoints = this.powerups.splice(length);
      for (let i = 0; i < deletedPoints.length; i++) {
        this.emitAll.onUpdatePickup.mutate(['null', deletedPoints[i].id, 0]);
      }
      this.config.spritesTotal = length;
    } else if (length > this.powerups.length) {
      this.spawnSprites(length - this.powerups.length);
    }
  }

  public getPayload(messages: string[]): Buffer {
    // Super-cheap JSON Array construction
    const jsonArray = `[${messages.join(',')}]`;
    return Buffer.from(jsonArray);
  }

  flushEventQueue() {
    if (!this.eventQueue.length) return;

    // log('Flushing event queue', this.eventQueue.length);

    this.emitAllDirect.onEvents.mutate(this.eventQueue);

    this.eventQueue = [];
  }

  disconnectClient(client: Shard.Client, reason = 'Unknown', immediate = false) {
    if (client.isRealm) return;

    this.clients = this.clients.filter((c) => c.id !== client.id);

    delete this.clientLookup[client.id];

    if (this.config.gameMode === 'Pandamonium') {
      this.emitAll.onBroadcast.mutate([
        `${
          this.clients.filter(
            (c) => !c.isDead && !c.isDisconnected && !c.isSpectating && !this.pandas.includes(c.address)
          ).length
        } alive`,
        0,
      ]);
    }

    if (client.isDisconnected) return;

    try {
      log(`Disconnecting (${reason})`, client.id, client.name);

      client.isDisconnected = true;
      client.isDead = true;
      client.joinedAt = 0;
      client.latency = 0;

      const oldSocket = this.sockets[client.id];
      setTimeout(
        () => {
          this.emitAll.onDisconnected.mutate([client.id]);
          this.syncSprites();
          this.flushEventQueue();
          if (oldSocket && oldSocket.emit && oldSocket.connected) oldSocket.disconnect();
          delete this.sockets[client.id];
        },
        immediate ? 0 : 1000
      );

      if (
        this.queuedClients.length > 0 &&
        this.clients.filter((c) => !c.isSpectating).length < this.config.maxClients
      ) {
        const newClient = this.queuedClients.shift();

        this.forceJoin(null, { client: newClient });
      }
    } catch (e) {
      log('Error:', e);
    }
  }

  async login(
    input: Shard.RouterInput['login'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['login']> {
    if (!input) throw new Error('Input should not be void');

    log('Login', input);

    if (!input.signature || !input.network || !input.device || !input.address) {
      client.log.signinProblem += 1;
      this.disconnectClient(client, 'signin problem');

      throw new Error('Invalid request');
    }

    // if (!this.realm && input.address === '') {
    //   this.realm = { client, emit: null };
    // }

    const address = await this.normalizeAddress(input.address);
    log('Login normalizeAddress', input.address, address);
    if (!address) {
      client.log.addressProblem += 1;
      this.disconnectClient(client, 'address problem');
      throw new Error('Address problem');
    }

    try {
      await this.auth(
        {
          data: 'evolution',
          signature: { hash: input.signature.trim(), address },
        },
        { client }
      );
    } catch (e) {
      client.log.signatureProblem += 1;
      this.disconnectClient(client, 'signature problem');

      throw new Error('Signature problem');
    }

    if (client.isBanned) {
      this.emit.onBanned.mutate([true], { context: { client } });
      this.disconnectClient(client, 'banned');
      throw new Error('Banned');
    }

    if (this.config.isMaintenance && !client.isMod) {
      client.log.maintenanceJoin += 1;
      this.emit.onMaintenance.mutate([true], { context: { client } });
      this.disconnectClient(client, 'maintenance');
      throw new Error('Maintenance');
    }

    const profile = this.addressToProfile[address] || (await this.realm.emit.confirmProfile.mutate({ address }));

    this.addressToProfile[address] = profile;

    if (this.config.isMaintenance && !client.isMod) {
      this.emit.onMaintenance.mutate([true], { context: { client } });
      this.disconnectClient(client, 'maintenance');
      throw new Error('Maintenance');
    }

    if (profile.isBanned) {
      this.disconnectClient(client, 'banned');
      throw new Error('Banned');
    }

    if (profile.isMod) {
      client.isMod = true;
    }

    let name = this.addressToProfile[address].name || this.generateGuestName();

    if (['Testman', 'join'].includes(name)) {
      client.overrideCameraSize = 12;
    }

    log('Profile ' + name + ' with address ' + address + ' with hash ' + client.hash);

    const now = getTime();
    if (client.name !== name || client.address !== address) {
      client.name = name;
      client.address = address;
      client.network = input.network;
      client.device = input.device;
      const recentClient = this.round.clients.find((r) => r.address === address);
      if (recentClient && now - recentClient.lastUpdate < 3000) {
        client.log.recentJoinProblem += 1;
        this.disconnectClient(client, 'joined too soon', true);
        throw new Error('Joined too soon');
      }
      // Object.assign(client, recentClient);
      client.log.connects += 1;
    }

    this.emit.onLogin.mutate([client.id, client.name, client.network, client.address, client.device], {
      context: { client },
    });

    if (this.config.log.connections) {
      log('Connected', { hash: client.hash, address: client.address, name: client.name });
    }
  }

  // Method to compare clients by their points
  compareClients(a: Shard.Client, b: Shard.Client): number {
    if (a.points > b.points) return -1;
    if (a.points < b.points) return 1;
    return 0;
  }

  // Method to generate a random number between min and max (inclusive)
  random(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // Method to normalize an address through an external service
  async normalizeAddress(address: string): Promise<string | false> {
    if (!address) return false;
    try {
      // TODO: type check
      const res = await this.realm?.emit.normalizeAddress.mutate(address);
      log('normalizeAddressResponse', res);
      return res;
    } catch (e) {
      log('Error:', e);
      return false;
    }
  }

  // Method to verify if a signature request is valid
  async auth(input: Shard.RouterInput['auth'], { client }: Shard.ServiceContext): Promise<Shard.RouterOutput['auth']> {
    if (!input) throw new Error('Input should not be void');

    log('Verifying', input.data);

    if (!input.signature.address) throw new Error('Signature problem');

    const res = await this.realm.emit.auth.mutate({ data: input.data, signature: input.signature });

    if (!res) throw new Error('Auth problem');

    client.isSeer = res.roles.includes('seer');
    client.isAdmin = res.roles.includes('admin');
    client.isMod = res.roles.includes('mod');
  }

  // Method to format a number as a string with a sign
  formatNumber(num: number): string {
    return num >= 0 ? '+' + num : '-' + num;
  }

  // Method to calculate the speed of a client based on their config and base speed
  getClientSpeed(client: Shard.Client): number {
    return this.normalizeFloat(
      this.config.baseSpeed * this.config['avatarSpeedMultiplier' + client.avatar!] * client.baseSpeed
    );
  }

  // Assume normalizeFloat is defined elsewhere in the class
  normalizeFloat(value: number, precision: number = 2): number {
    return parseFloat(value.toFixed(precision));
  }

  async forceJoin(
    input: Shard.RouterInput['forceJoin'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['forceJoin']> {
    try {
      client.isSpectating = false;
      client.isInvincible = false;
      client.avatar = this.config.startAvatar;
      client.speed = this.getClientSpeed(client);
      client.overrideSpeed = null;
      client.cameraSize = this.config.cameraSize;
      client.overrideCameraSize = null;
      client.xp = 75;
      client.maxHp = 100;

      client.isDisconnected = false;
      client.isJoining = true;

      if (this.config.gameMode === 'Pandamonium' && this.pandas.includes(client.address)) {
        client.avatar = 2;
        this.emit.onUpdateEvolution.mutate([client.id, client.avatar, client.speed], { context: { client } });
      }

      log('[INFO] client ' + client.id + ': logged!');
      log('[INFO] Total clients: ' + Object.keys(this.clientLookup).length);

      const roundTimer = this.round.startedDate + this.config.roundLoopSeconds - Math.round(getTime() / 1000);
      this.emit.onSetPositionMonitor.mutate(
        [
          Math.round(this.config.checkPositionDistance),
          Math.round(this.config.checkInterval),
          Math.round(this.config.resetInterval),
        ],
        { context: { client } }
      );

      this.emit.onJoinGame.mutate(
        [
          client.id,
          client.name,
          client.avatar,
          client.isMaster ? 'true' : 'false',
          roundTimer,
          client.position.x,
          client.position.y,
        ],
        { context: { client } }
      );

      if (!this.realm) {
        this.emit.onBroadcast.mutate([`Realm not connected. Contact support.`, 0], { context: { client } });
        this.disconnectClient(client, 'realm not connected');
        throw new Error('Realm not connected');
      }

      if (!this.config.isRoundPaused) {
        this.emit.onSetRoundInfo.mutate(
          [roundTimer, this.getRoundInfo().join(':'), this.getGameModeGuide().join(':')],
          { context: { client } }
        );
        this.emit.onBroadcast.mutate([`Game Mode - ${this.config.gameMode}`, 0], {
          //  (Round ${this.round.id})
          context: { client },
        });
      }

      this.syncSprites();

      if (this.config.hideMap) {
        this.emit.onHideMinimap.mutate([], { context: { client } });
        this.emit.onBroadcast.mutate([`Minimap hidden in this mode!`, 2], { context: { client } });
      }

      if (this.config.level2open) {
        this.emit.onOpenLevel2.mutate([], { context: { client } });
        this.emit.onBroadcast.mutate([`Wall going down!`, 0], { context: { client } });
      } else {
        this.emit.onCloseLevel2.mutate([], { context: { client } });
      }

      for (const otherClient of this.clients) {
        if (
          otherClient.id === client.id ||
          otherClient.isDisconnected ||
          otherClient.isDead ||
          otherClient.isSpectating ||
          otherClient.isJoining
        )
          continue;

        this.emit.onSpawnClient.mutate(
          [
            otherClient.id,
            otherClient.name,
            otherClient.speed,
            otherClient.avatar,
            otherClient.position.x,
            otherClient.position.y,
            otherClient.position.x,
            otherClient.position.y,
          ],
          { context: { client } }
        );
      }

      for (const powerup of this.powerups) {
        this.emit.onSpawnPowerUp.mutate(
          [powerup.id, parseInt(powerup.type + ''), powerup.position.x, powerup.position.y, powerup.scale],
          { context: { client } }
        );
      }

      for (const orb of this.orbs) {
        this.emit.onSpawnPowerUp.mutate([orb.id, orb.type, orb.position.x, orb.position.y, orb.scale], {
          context: { client },
        });
      }

      if (this.currentReward) {
        this.emit.onSpawnReward.mutate(
          [
            this.currentReward.id,
            this.currentReward.rewardItemType,
            this.currentReward.rewardItemName,
            this.currentReward.quantity,
            this.currentReward.position.x,
            this.currentReward.position.y,
          ],
          { context: { client } }
        );
      }

      client.lastUpdate = getTime();
    } catch (e) {
      log('Error:', e);
      this.disconnectClient(client, 'not sure: ' + e);
      throw new Error('Not sure');
    }
  }

  async join(input: Shard.RouterInput['join'], { client }: Shard.ServiceContext): Promise<Shard.RouterOutput['join']> {
    log('join', client.id, client.hash);

    try {
      const now = getTime();
      const recentClient = this.round.clients.find((r) => r.address === client.address);

      if (recentClient && now - recentClient.lastUpdate < 3000) {
        client.log.connectedTooSoon += 1;
        this.disconnectClient(client, 'connected too soon');
        throw new Error('Connected too soon');
      }

      if (this.clients.filter((c) => !c.isSpectating).length > this.config.maxClients) {
        if (!this.queuedClients.find((c) => c.id === client.id)) {
          this.queuedClients.push(client);
        }

        this.spectate(null, { client });
      } else {
        this.forceJoin(null, { client });
      }
    } catch (e) {
      log('Error:', e);
      this.disconnectClient(client, 'not sure: ' + e);
      throw new Error('Not sure');
    }
  }

  public getGameModeGuide(): string[] {
    return (
      this.config.guide || [
        'Game Mode - ' + this.config.gameMode,
        '1. Eat sprites to stay alive',
        '2. Avoid bigger dragons',
        '3. Eat smaller dragons',
      ]
    );
  }

  public getRoundInfo(): any[] {
    return Object.keys(this.sharedConfig)
      .sort()
      .reduce((obj, key) => {
        obj.push(this.config[key]);
        return obj;
      }, [] as any[]);
  }

  public moveVectorTowards(
    current: { x: number; y: number },
    target: { x: number; y: number },
    maxDistanceDelta: number
  ): { x: number; y: number } {
    const a = {
      x: target.x - current.x,
      y: target.y - current.y,
    };

    const magnitude = Math.sqrt(a.x * a.x + a.y * a.y);

    if (magnitude <= maxDistanceDelta || magnitude === 0) return target;

    return {
      x: current.x + (a.x / magnitude) * maxDistanceDelta,
      y: current.y + (a.y / magnitude) * maxDistanceDelta,
    };
  }

  public detectCollisions(): void {
    try {
      const now = this.getTime();
      const currentTime = Math.round(now / 1000);
      const deltaTime = (now - this.lastFastestGameloopTime) / 1000;

      const distanceMap = {
        0: this.config.avatarTouchDistance0,
        1: this.config.avatarTouchDistance0,
        2: this.config.avatarTouchDistance0,
      };

      for (const client of this.clients) {
        if (client.isDead || client.isSpectating || client.isJoining) continue;

        if (!Number.isFinite(client.position.x) || !Number.isFinite(client.speed)) {
          client.log.speedProblem += 1;
          this.disconnectClient(client, 'speed problem');
          continue;
        }

        if (this.distanceBetweenPoints(client.position, client.clientPosition) > 2) {
          client.phasedUntil = this.getTime() + 2000;
          client.log.phases += 1;
          client.log.clientDistanceProblem += 1;
        }

        let position = this.moveVectorTowards(
          client.position,
          client.clientTarget,
          (client.overrideSpeed || client.speed) * deltaTime
        );

        let outOfBounds = false;
        if (position.x > this.mapBoundary.x.max) {
          position.x = this.mapBoundary.x.max;
          outOfBounds = true;
        }
        if (position.x < this.mapBoundary.x.min) {
          position.x = this.mapBoundary.x.min;
          outOfBounds = true;
        }
        if (position.y > this.mapBoundary.y.max) {
          position.y = this.mapBoundary.y.max;
          outOfBounds = true;
        }
        if (position.y < this.mapBoundary.y.min) {
          position.y = this.mapBoundary.y.min;
          outOfBounds = true;
        }

        if (outOfBounds) {
          client.log.outOfBounds += 1;
        }

        let collided = false;
        let stuck = false;

        for (const gameObject of mapData) {
          if (!gameObject.Colliders || !gameObject.Colliders.length) continue;

          for (const gameCollider of gameObject.Colliders) {
            const collider = {
              minX: gameCollider.Min[0],
              maxX: gameCollider.Max[0],
              minY: gameCollider.Min[1],
              maxY: gameCollider.Max[1],
            };

            if (
              position.x >= collider.minX &&
              position.x <= collider.maxX &&
              position.y >= collider.minY &&
              position.y <= collider.maxY
            ) {
              if (gameObject.Name.startsWith('Land')) {
                stuck = true;
              } else if (gameObject.Name.startsWith('Island')) {
                if (this.config.stickyIslands) {
                  stuck = true;
                } else {
                  collided = true;
                }
              } else if (gameObject.Name.indexOf('Collider') === 0) {
                stuck = true;
              } else if (gameObject.Name.indexOf('Level2Divider') === 0) {
                if (!this.config.level2open) stuck = true;
              }

              if (stuck) console.log('collide', gameObject.Name);
            }
          }

          if (stuck || collided) break;
        }

        if (client.isGod) {
          stuck = false;
          collided = false;
        }

        client.isStuck = false;
        const isClientInvincible = client.isInvincible || client.invincibleUntil > currentTime;

        if (collided && !isClientInvincible) {
          client.position = position;
          client.target = client.clientTarget;
          client.phasedUntil = this.getTime() + 3000;
          client.phasedPosition = client.phasedPosition || position;
          client.log.phases += 1;
          client.log.collided += 1;
          client.overrideSpeed = 0.5;
          client.overrideSpeedUntil = this.getTime() + 1000;
        } else if (stuck && !isClientInvincible) {
          client.position = position;
          client.target = client.clientTarget;
          client.phasedUntil = this.getTime() + 3000;
          client.log.phases += 1;
          client.log.stuck += 1;
          client.overrideSpeed = 0.5;
          client.overrideSpeedUntil = this.getTime() + 1000;
          if (this.config.stickyIslands) {
            client.isStuck = true;
          }
        } else {
          client.position = position;
          client.target = client.clientTarget;
        }

        const pos = `${Math.round(client.position.x)}:${Math.round(client.position.y)}`;
        if (!client.log.path.includes(pos)) {
          client.log.positions += 1;
        }
      }

      if (!this.config.isRoundPaused) {
        for (const client1 of this.clients) {
          if (client1.isSpectating || client1.isDead || client1.invincibleUntil > currentTime) continue;

          for (const client2 of this.clients) {
            if (
              client1.id === client2.id ||
              client2.isDead ||
              client2.isSpectating ||
              client2.invincibleUntil > currentTime
            )
              continue;

            const distance = distanceMap[client1.avatar] + distanceMap[client2.avatar];
            const position1 = client1.isPhased ? client1.phasedPosition : client1.position;
            const position2 = client2.isPhased ? client2.phasedPosition : client2.position;

            if (this.distanceBetweenPoints(position1, position2) <= distance) {
              this.registerKill(client1, client2);
            }
          }
        }

        for (const client of this.clients) {
          if (client.isDead || client.isSpectating || client.isPhased || now < client.phasedUntil) continue;

          const touchDistance = this.config.pickupDistance + this.config[`avatarTouchDistance${client.avatar}`];

          for (const powerup of this.powerups) {
            if (this.distanceBetweenPoints(client.position, powerup.position) <= touchDistance) {
              if (this.config.gameMode === 'Hayai') {
                client.baseSpeed -= 0.001;
                if (client.baseSpeed <= 0.5) client.baseSpeed = 0.5;
              }

              let value = 0;
              switch (powerup.type) {
                case 0:
                  value = this.config.powerupXp0;
                  if (this.config.gameMode === 'Sprite Juice') client.invincibleUntil = currentTime + 2;
                  if (this.config.gameMode === 'Marco Polo') client.cameraSize += 0.05;
                  break;
                case 1:
                  value = this.config.powerupXp1;
                  if (this.config.gameMode === 'Sprite Juice') {
                    client.baseSpeed += 0.1;
                    client.decayPower -= 0.2;
                  }
                  if (this.config.gameMode === 'Marco Polo') client.cameraSize += 0.01;
                  break;
                case 2:
                  value = this.config.powerupXp2;
                  if (this.config.gameMode === 'Sprite Juice') client.baseSpeed -= 0.1;
                  if (this.config.gameMode === 'Marco Polo') client.cameraSize -= 0.01;
                  break;
                case 3:
                  value = this.config.powerupXp3;
                  if (this.config.gameMode === 'Sprite Juice') client.decayPower += 0.2;
                  if (this.config.gameMode === 'Marco Polo') client.cameraSize -= 0.05;
                  break;
              }

              client.powerups += 1;
              client.points += this.config.pointsPerPowerup;
              client.xp += value * this.config.spriteXpMultiplier;

              if (client.character.meta[Mechanic.SpriteFuelIncrease] > 0) {
                client.xp +=
                  (value * this.config.spriteXpMultiplier * client.character.meta[Mechanic.SpriteFuelIncrease]) / 100;
              }

              this.emitAll.onUpdatePickup.mutate([client.id, powerup.id, value]);

              this.removeSprite(powerup.id);
              this.spawnSprites(1);
            }
          }

          if (!client.isInvincible) {
            for (const orb of this.orbs) {
              if (now < orb.enabledDate) continue;
              if (this.distanceBetweenPoints(client.position, orb.position) > touchDistance) continue;

              client.orbs += 1;
              client.points += orb.points;
              client.points += this.config.pointsPerOrb;

              this.emitAll.onUpdatePickup.mutate([client.id, orb.id, 0]);
              this.removeOrb(orb.id);

              this.emitAll.onBroadcast.mutate([`${client.name} stole an orb (${orb.points})`, 0]);
            }

            if (this.currentReward && now >= this.currentReward.enabledDate) {
              if (this.distanceBetweenPoints(client.position, this.currentReward.position) <= touchDistance) {
                this.claimReward(client, this.currentReward);
                this.removeReward();
              }
            }
          }
        }
      }

      this.lastFastestGameloopTime = now;
    } catch (e) {
      console.error('Error in detectCollisions:', e);
    }
  }

  distanceBetweenPoints(pos1, pos2) {
    return Math.hypot(pos1.x - pos2.x, pos1.y - pos2.y);
  }

  resetClient(client) {
    const spawnPoint = this.clientSpawnPoints[Math.floor(Math.random() * this.clientSpawnPoints.length)];
    client.position = spawnPoint;
    client.target = spawnPoint;
    client.clientPosition = spawnPoint;
    client.clientTarget = spawnPoint;
    client.avatar = 0;
    client.xp = 75;
    client.maxHp = 100;
  }

  async action(
    input: Shard.RouterInput['action'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['action']> {
    if (!input) throw new Error('Input should not be void');

    if (client.isDead && !client.isJoining) throw new Error('Invalid at this time');
    if (client.isSpectating) throw new Error('Invalid at this time');

    this.emitAll.onAction.mutate([client.id, input]);
  }

  public async claimReward(client: Shard.Client, reward: Reward): Promise<void> {
    if (!reward) return;

    if (this.config.anticheat.sameClientCantClaimRewardTwiceInRow && this.lastReward?.winner === client.name) return;

    // const claimRewardRes = await rsCall('GS_ClaimRewardRequest', { reward, client }) as any

    // if (claimRewardRes.status !== 1) {
    //   this.emit.onBroadcast.mutate({message:`Problem claiming reward. Contact support.`, priority: 3});
    //   return;
    // }

    reward.winner = client.name;

    this.emitAll.onUpdateReward.mutate([client.id, reward.id]);

    client.rewards += 1;
    client.points += this.config.pointsPerReward;
    client.pickups.push(reward);
    if (
      this.isMechanicEnabled({ id: Mechanic.DoublePickupChance }, { client }) &&
      client.character.meta[Mechanic.DoublePickupChance] > 0
    ) {
      const r = this.random(1, 100);
      if (r <= client.character.meta[Mechanic.DoublePickupChance]) {
        client.pickups.push(reward);
        this.emitAll.onBroadcast.mutate([`${client.name} got a double pickup!`, 0]);
      }
    }

    this.lastReward = reward;
    this.currentReward = null;
  }

  async emote(...[input, { client }]: Parameters<Shard.Service['emote']>): ReturnType<Shard.Service['emote']> {
    if (!input) throw new Error('Input should not be void');

    if (client.isDead && !client.isJoining) throw new Error('Invalid at this time');
    if (client.isSpectating) throw new Error('Invalid at this time');

    this.emitAll.onEmote.mutate([client.id, input]);
  }

  async updateMyself(
    ...[input, { client }]: Parameters<Shard.Service['updateMyself']>
  ): ReturnType<Shard.Service['updateMyself']> {
    if (!input) throw new Error('Input should not be void');

    if (client.isDead && !client.isJoining) throw new Error('Invalid at this time');
    if (client.isSpectating) throw new Error('Invalid at this time');
    if (this.config.isMaintenance && !client.isMod) {
      this.emit.onMaintenance.mutate([true], { context: { client } });
      this.disconnectClient(client, 'maintenance');
      throw new Error('Invalid at this time');
    }

    const now = getTime();
    if (now - client.lastUpdate < this.config.forcedLatency) throw new Error('Invalid at this time');
    if (client.name === 'Testman' && now - client.lastUpdate < 200) throw new Error('Invalid at this time');

    if (client.isJoining) {
      client.isDead = false;
      client.isJoining = false;
      client.joinedAt = Math.round(getTime() / 1000);
      client.invincibleUntil = client.joinedAt + this.config.immunitySeconds;

      if (this.config.isBattleRoyale) {
        this.emit.onBroadcast.mutate(['Spectate until the round is over', 0], { context: { client } });

        this.spectate(null, { client });
        return;
      }

      this.addToRecentClients(client);
      this.emitAll.onSpawnClient.mutate([
        client.id,
        client.name,
        client.overrideSpeed || client.speed,
        client.avatar,
        client.position.x,
        client.position.y,
        client.position.x,
        client.position.y,
      ]);

      if (this.config.isRoundPaused) {
        this.emit.onRoundPaused.mutate(null, { context: { client } });
        return;
      }
    }

    // const pack = decodePayload(input);
    const positionX = parseFloat(parseFloat(input.position.split(':')[0].replace(',', '.')).toFixed(3));
    const positionY = parseFloat(parseFloat(input.position.split(':')[1].replace(',', '.')).toFixed(3));
    const targetX = parseFloat(parseFloat(input.target.split(':')[0].replace(',', '.')).toFixed(3));
    const targetY = parseFloat(parseFloat(input.target.split(':')[1].replace(',', '.')).toFixed(3));

    if (
      !Number.isFinite(positionX) ||
      !Number.isFinite(positionY) ||
      !Number.isFinite(targetX) ||
      !Number.isFinite(targetY) ||
      positionX < this.mapBoundary.x.min ||
      positionX > this.mapBoundary.x.max ||
      positionY < this.mapBoundary.y.min ||
      positionY > this.mapBoundary.y.max
    )
      return;

    if (
      this.config.anticheat.disconnectPositionJumps &&
      this.distanceBetweenPoints(client.position, { x: positionX, y: positionY }) > 5
    ) {
      client.log.positionJump += 1;
      this.disconnectClient(client, 'position jumped');
      return;
    }

    client.clientPosition = { x: this.normalizeFloat(positionX, 4), y: this.normalizeFloat(positionY, 4) };
    client.clientTarget = { x: this.normalizeFloat(targetX, 4), y: this.normalizeFloat(targetY, 4) };
    client.lastReportedTime = client.name === 'Testman' ? parseFloat(input.time) - 300 : parseFloat(input.time);
    client.lastUpdate = now;

    if (this.distanceBetweenPoints(client.position, this.currentZone.objects.Harold) < 1) {
      client.ui.push('shop');

      this.emit.onShowUI.mutate('shop', {
        context: { client },
      });
    } else if (client.ui.includes('shop')) {
      client.ui = client.ui.filter((ui) => ui !== 'shop');

      this.emit.onHideUI.mutate('shop', {
        context: { client },
      });
    }

    const modifiers = {
      Luck: {
        id: '111',
      },
    };

    // Touch the tusk for good luck
    if (this.distanceBetweenPoints(client.position, this.currentZone.objects.ElonTusk) < 1) {
      if (!this.currentZone.modifiers[modifiers.Luck.id] || this.currentZone.modifiers[modifiers.Luck.id] < 10)
        this.currentZone.modifiers[modifiers.Luck.id] += 10;
    }

    // Touch the portal to move between games
    if (this.distanceBetweenPoints(client.position, this.games.MageIsles.zones[0].objects.MemeIslesPortal) < 1) {
      this.currentGame = this.currentGame.key === 'meme-isles' ? this.games.MageIsles : this.games.MemeIsles;
      this.currentZone = this.currentGame.zones[0];

      this.emit.onChangeGame.mutate('MemeIsles', {
        context: { client },
      });
    }
  }

  async restart(
    input: Shard.RouterInput['restart'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['restart']> {
    this.emitAll.onBroadcast.mutate([`Server is rebooting in 10 seconds`, 3]);
    await sleep(10 * 1000);
    process.exit(1);
  }

  async maintenance(
    input: Shard.RouterInput['maintenance'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['maintenance']> {
    this.sharedConfig.isMaintenance = true;
    this.config.isMaintenance = true;
    this.emitAll.onMaintenance.mutate([this.config.isMaintenance]);
  }

  async unmaintenance(
    input: Shard.RouterInput['unmaintenance'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['unmaintenance']> {
    this.sharedConfig.isMaintenance = false;
    this.config.isMaintenance = false;
    this.emitAll.onUnmaintenance.mutate([this.config.isMaintenance]);
  }

  async startBattleRoyale(
    input: Shard.RouterInput['startBattleRoyale'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['startBattleRoyale']> {
    this.emitAll.onBroadcast.mutate([`Battle Royale in 3...`, 1]);
    await sleep(1 * 1000);
    this.emitAll.onBroadcast.mutate([`Battle Royale in 2...`, 1]);
    await sleep(1 * 1000);
    this.emitAll.onBroadcast.mutate([`Battle Royale in 1...`, 1]);
    await sleep(1 * 1000);
    this.baseConfig.isBattleRoyale = true;
    this.config.isBattleRoyale = true;
    this.baseConfig.isGodParty = false;
    this.config.isGodParty = false;
    this.emitAll.onBroadcast.mutate([`Battle Royale Started`, 3]);
    this.emitAll.onBroadcast.mutate([`God Party Stopped`, 3]);
  }

  async stopBattleRoyale(
    input: Shard.RouterInput['stopBattleRoyale'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['stopBattleRoyale']> {
    this.baseConfig.isBattleRoyale = false;
    this.config.isBattleRoyale = false;
    this.emitAll.onBroadcast.mutate([`Battle Royale Stopped`, 0]);
  }

  async pauseRound(
    input: Shard.RouterInput['pauseRound'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['pauseRound']> {
    clearTimeout(this.roundLoopTimeout);
    this.baseConfig.isRoundPaused = true;
    this.config.isRoundPaused = true;
    this.emitAll.onRoundPaused.mutate();
    this.emitAll.onBroadcast.mutate([`Round Paused`, 0]);
  }

  async startRound(
    input: Shard.RouterInput['startRound'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['startRound']> {
    if (!input) throw new Error('Input should not be void');
    if (this.config.isRoundPaused) {
      this.baseConfig.isRoundPaused = false;
      this.config.isRoundPaused = false;
    }
    clearTimeout(this.roundLoopTimeout);
    this.resetLeaderboard(
      presets.find((p) => p.gameMode === input.gameMode),
      { client }
    );
  }

  async enableForceLevel2(
    input: Shard.RouterInput['enableForceLevel2'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['enableForceLevel2']> {
    this.baseConfig.level2forced = true;
    this.config.level2forced = true;
  }

  async disableForceLevel2(
    input: Shard.RouterInput['disableForceLevel2'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['disableForceLevel2']> {
    this.baseConfig.level2forced = false;
    this.config.level2forced = false;
  }

  async startGodParty(
    input: Shard.RouterInput['startGodParty'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['startGodParty']> {
    this.baseConfig.isGodParty = true;
    this.config.isGodParty = true;
    this.emitAll.onBroadcast.mutate([`God Party Started`, 0]);
  }

  async stopGodParty(
    input: Shard.RouterInput['stopGodParty'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['stopGodParty']> {
    this.baseConfig.isGodParty = false;
    this.config.isGodParty = false;
    for (const client of this.clients) {
      client.isInvincible = false;
    }
    this.emitAll.onBroadcast.mutate([`God Party Stopped`, 2]);
  }

  async startRoyale(
    input: Shard.RouterInput['startRoyale'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['startRoyale']> {
    this.baseConfig.isRoyale = true;
    this.config.isRoyale = true;
    this.emitAll.onBroadcast.mutate([`Royale Started`, 0]);
  }

  async pauseRoyale(
    input: Shard.RouterInput['pauseRoyale'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['pauseRoyale']> {
    this.emitAll.onBroadcast.mutate([`Royale Paused`, 2]);
  }

  async unpauseRoyale(
    input: Shard.RouterInput['unpauseRoyale'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['unpauseRoyale']> {
    this.emitAll.onBroadcast.mutate([`Royale Unpaused`, 2]);
  }

  async stopRoyale(
    input: Shard.RouterInput['stopRoyale'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['stopRoyale']> {
    this.baseConfig.isRoyale = false;
    this.config.isRoyale = false;
    this.emitAll.onBroadcast.mutate([`Royale Stopped`, 2]);
  }

  async makeBattleHarder(
    input: Shard.RouterInput['makeBattleHarder'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['makeBattleHarder']> {
    this.baseConfig.dynamicDecayPower = false;
    this.config.dynamicDecayPower = false;
    this.sharedConfig.decayPower += 2;
    this.config.decayPower += 2;
    this.sharedConfig.baseSpeed += 1;
    this.config.baseSpeed += 1;
    this.sharedConfig.checkPositionDistance += 1;
    this.config.checkPositionDistance += 1;
    this.sharedConfig.checkInterval += 1;
    this.config.checkInterval += 1;
    this.sharedConfig.spritesStartCount -= 10;
    this.config.spritesStartCount -= 10;
    this.emitAll.onSetPositionMonitor.mutate([
      this.config.checkPositionDistance,
      this.config.checkInterval,
      this.config.resetInterval,
    ]);
    this.emitAll.onBroadcast.mutate([`Difficulty Increased!`, 2]);
  }

  async makeBattleEasier(
    input: Shard.RouterInput['makeBattleEasier'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['makeBattleEasier']> {
    this.baseConfig.dynamicDecayPower = false;
    this.config.dynamicDecayPower = false;
    this.sharedConfig.decayPower -= 2;
    this.config.decayPower -= 2;
    this.sharedConfig.baseSpeed -= 1;
    this.config.baseSpeed -= 1;
    this.sharedConfig.checkPositionDistance -= 1;
    this.config.checkPositionDistance -= 1;
    this.sharedConfig.checkInterval -= 1;
    this.config.checkInterval -= 1;
    this.sharedConfig.spritesStartCount += 10;
    this.config.spritesStartCount += 10;
    this.emitAll.onSetPositionMonitor.mutate([
      this.config.checkPositionDistance,
      this.config.checkInterval,
      this.config.resetInterval,
    ]);
    this.emitAll.onBroadcast.mutate([`Difficulty Decreased!`, 0]);
  }

  async resetBattleDifficulty(
    input: Shard.RouterInput['resetBattleDifficulty'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['resetBattleDifficulty']> {
    this.baseConfig.dynamicDecayPower = true;
    this.config.dynamicDecayPower = true;
    this.sharedConfig.decayPower = 1.4;
    this.config.decayPower = 1.4;
    this.sharedConfig.baseSpeed = 3;
    this.config.baseSpeed = 3;
    this.sharedConfig.checkPositionDistance = 2;
    this.config.checkPositionDistance = 2;
    this.sharedConfig.checkInterval = 1;
    this.config.checkInterval = 1;
    this.emitAll.onSetPositionMonitor.mutate([
      this.config.checkPositionDistance,
      this.config.checkInterval,
      this.config.resetInterval,
    ]);
    this.emitAll.onBroadcast.mutate([`Difficulty Reset!`, 0]);
  }

  async messageUser(
    input: Shard.RouterInput['messageUser'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['messageUser']> {
    if (!input) throw new Error('Input should not be void');
    const targetClient = this.clients.find((c) => c.address === input.target);
    if (!targetClient) throw new Error('Target not found');
    this.sockets[targetClient.id].emitAll.onBroadcast.mutate([input.message.replace(/:/gi, ''), 0]);
  }

  async changeUser(
    input: Shard.RouterInput['changeUser'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['changeUser']> {
    if (!input) throw new Error('Input should not be void');
    const newClient = this.clients.find((c) => c.address === input.target);
    if (!newClient) throw new Error('User not found');
    for (const key of Object.keys(input.config)) {
      const value = input.config[key];
      const val = value === 'true' ? true : value === 'false' ? false : isNumeric(value) ? parseFloat(value) : value;
      if (client.hasOwnProperty(key)) (newClient as any)[key] = val;
      else throw new Error("User doesn't have that option");
    }
  }

  async broadcast(
    input: Shard.RouterInput['broadcast'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['broadcast']> {
    if (!input) throw new Error('Input should not be void');
    this.emitAll.onBroadcast.mutate([input.replace(/:/gi, ''), 0]);
  }

  async kickClient(
    input: Shard.RouterInput['kickClient'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['kickClient']> {
    if (!input) throw new Error('Input should not be void');
    const targetClient = this.clients.find((c) => c.address === input.target);
    if (!targetClient) throw new Error('Target not found');
    this.disconnectClient(targetClient, 'kicked');
  }

  async info(input: Shard.RouterInput['info'], { client }: Shard.ServiceContext): Promise<Shard.RouterOutput['info']> {
    return {
      id: this.config.id || 'Unknown',
      version: this.serverVersion,
      // port: this.state.spawnPort,
      round: { id: this.round.id, startedDate: this.round.startedDate },
      clientCount: this.clients.length,
      // clientCount: this.clients.filter((c) => !c.isDead && !c.isSpectating).length,
      spectatorCount: this.clients.filter((c) => c.isSpectating).length,
      recentClientsCount: this.round.clients.length,
      spritesCount: this.config.spritesTotal,
      connectedClients: this.clients.filter((c) => !!c.address).map((c) => c.address),
      rewardItemAmount: this.config.rewardItemAmount,
      rewardWinnerAmount: this.config.rewardWinnerAmount,
      gameMode: this.config.gameMode,
      orbs: this.orbs,
      currentReward: this.currentReward,
    };
  }

  async handleClientMessage(socket: any, message: any) {
    // log('Shard client trpc message', message);
    const pack = typeof message === 'string' ? decodePayload(message) : message;
    // log('Shard client trpc pack', pack, socket.shardClient.id, socket.shardClient.id);
    const { id, method, type, params } = pack;

    if (method === 'onEvents') return;

    try {
      // const createCaller = createCallerFactory(client.emit);
      // const caller = createCaller(ctx);

      if (this.loggableEvents.includes(method))
        log(`Shard client trpc method: client.emit.${method}(${JSON.stringify(params)})`, id, method, type, params);

      // @ts-ignore
      const result = params ? await socket.shardClient.emit[method](params) : await socket.shardClient.emit[method]();

      if (this.loggableEvents.includes(method)) log('Shard client trpc method call result', result);
      // log(client.emit[method]);
      // const result = await client.emit[method](params);

      socket.emit('trpcResponse', { id: generateShortId(), oid: id, result });
    } catch (e) {
      log('Shard client trpc error', pack, e);
      socket.emit('trpcResponse', { id: generateShortId(), oid: id, error: e.stack + '' });
    }
  }
}

export async function init(app) {
  try {
    const service = new Service(app);

    log('Starting event handler');

    app.io.on('connection', async function (socket) {
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

      socket.shardClient = client;

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

export default { init };
