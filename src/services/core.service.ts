// evolution/packages/shard/src/services/core.service.ts
//
import { httpBatchLink, createTRPCProxyClient, loggerLink, TRPCClientError } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { generateShortId } from '@arken/node/util/db';
import { serialize, deserialize } from '@arken/node/util/rpc';
import { weightedRandom } from '@arken/node/util/array';
import * as util from '@arken/node/util';
import { testMode, baseConfig, sharedConfig } from '@arken/evolution-protocol/config';
import { presets } from '@arken/evolution-protocol/presets';
import type { ShardClientRouter, Realm } from '@arken/evolution-protocol/types';
import type { Orb, Boundary, Reward, PowerUp, Round, Preset, Event } from '@arken/evolution-protocol/shard/shard.types';
import type * as Shard from '@arken/evolution-protocol/shard/shard.types';
import type * as Bridge from '@arken/evolution-protocol/bridge/bridge.types';
import type { Service } from '../shard.service';
const { log, getTime, shuffleArray, randomPosition, sha256, decodePayload, isNumeric, ipHashFromSocket } = util;

export class CoreService {
  constructor(private ctx: Service) {}

  init() {
    // temporary, we need to move this into unity
    // when player touches an NPC, it fires the proper event
    this.ctx.games = {
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

    this.ctx.currentGame = this.ctx.games.MemeIsles;
    this.ctx.currentZone = this.ctx.currentGame.zones[0];

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

    this.ctx.guestNames = [
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
    this.ctx.serverVersion = '1.9.0';
    this.ctx.queuedClients = [];
    this.ctx.roundLoopTimeout;
    this.ctx.addressToProfile = {};
    this.ctx.announceReboot = false;
    this.ctx.rebootAfterRound = false;
    this.ctx.debugQueue = false;
    this.ctx.killSameNetworkClients = false;
    this.ctx.sockets = {};
    this.ctx.clientLookup = {};
    this.ctx.powerups = [];
    this.ctx.powerupLookup = {};
    this.ctx.currentReward = undefined;
    this.ctx.orbs = [];
    this.ctx.orbLookup = {};
    this.ctx.eventQueue = [];
    this.ctx.clients = [];
    this.ctx.lastReward = undefined;
    this.ctx.lastLeaderName = undefined;
    this.ctx.eventFlushedAt = getTime();
    this.ctx.round = {
      id: generateShortId(),
      gameMode: 'Standard',
      startedDate: Math.round(getTime() / 1000),
      endedAt: null,
      events: [],
      states: [],
      clients: [],
    };
    this.ctx.ranks = {};
    this.ctx.pandas = [
      '0x150F24A67d5541ee1F8aBce2b69046e25d64619c',
      '0x3551691499D740790C4511CDBD1D64b2f146f6Bd',
      '0x1a367CA7bD311F279F1dfAfF1e60c4d797Faa6eb',
      '0x82b644E1B2164F5B81B3e7F7518DdE8E515A419d',
      '0xeb3fCb993dDe8a2Cd081FbE36238E4d64C286AC0',
    ];
    this.ctx.rateLimitWindow = 60 * 1000;
    this.ctx.maxRequestsPerWindow = 5;
    this.ctx.requestTimestamps = {};
    this.ctx.realm = undefined;
    this.ctx.loggableEvents = [
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
      'onChangeGame',
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
    this.ctx.currentPreset = presets[Math.floor(Math.random() * presets.length)];
    this.ctx.baseConfig = baseConfig;
    this.ctx.sharedConfig = sharedConfig;
    this.ctx.config = { ...baseConfig, ...sharedConfig };
    this.ctx.roundConfig = { ...baseConfig, ...sharedConfig, ...this.ctx.currentPreset };
    this.ctx.spawnBoundary1 = { x: { min: -17, max: 0 }, y: { min: -13, max: -4 } };
    this.ctx.spawnBoundary2 = { x: { min: -37, max: 0 }, y: { min: -13, max: -2 } };
    this.ctx.mapBoundary = { x: { min: -38, max: 40 }, y: { min: -20, max: 2 } };
    this.ctx.clientSpawnPoints = [
      { x: -4.14, y: -11.66 },
      { x: -11.14, y: -8.55 },
      { x: -12.27, y: -14.24 },
      { x: -7.08, y: -12.75 },
      { x: -7.32, y: -15.29 },
    ];
    this.ctx.lastFastGameloopTime = getTime();
    this.ctx.lastFastestGameloopTime = getTime();

    this.ctx.emit = createTRPCProxyClient<ShardClientRouter>({
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
                if (this.ctx.loggableEvents.includes(op.path)) log('Emit Direct', op.path, input, client.id);

                const compiled: any[] = [];
                const eventQueue = [{ name: op.path, args: Array.isArray(input) ? input : [input] }];
                // TODO: optimize
                for (const e of eventQueue) {
                  compiled.push(`["${e.name}","${Object.values(e.args).join(':')}"]`);
                  this.ctx.round.events.push({ type: 'emitDirect', client: client.id, name: e.name, args: e.args });
                }

                const id = generateShortId();
                const data = `{"id":"${id}","method":"onEvents","type":"mutation","params":[${compiled.join(',')}]}`;

                // console.log(data);

                client.socket.emit(
                  'trpc',
                  Buffer.from(data) // JSON.stringify({ id, method: 'onEvents', type: 'mutation', params: [compiled] }))
                );
              } else {
                if (this.ctx.loggableEvents.includes(op.path)) log('Fake Emit Direct', op.path, input);

                this.ctx.eventQueue.push({ name: op.path, args: Array.isArray(input) ? input : [input] });
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

    this.ctx.emitDirect = createTRPCProxyClient<ShardClientRouter>({
      links: [
        () =>
          ({ op, next }) => {
            return observable((observer) => {
              const { input, context } = op;
              // const { name, args } = input as Event;
              if (this.ctx.loggableEvents.includes(op.path)) log(`emitDirect: ${op.path}`, op, input);

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

    this.ctx.emitAll = createTRPCProxyClient<ShardClientRouter>({
      links: [
        () =>
          ({ op, next }) => {
            return observable((observer) => {
              const { input, context } = op;

              // if (this.ctx.loggableEvents.includes(op.path)) log('emitAll', op);

              // const { name, args } = input as Event;
              this.ctx.eventQueue.push({ name: op.path, args: Array.isArray(input) ? input : [input] }); // input as Array<any>

              observer.next({
                result: { data: { status: 1 } },
              });

              observer.complete();
            });
          },
      ],
      // transformer,
    });

    this.ctx.emitAllDirect = createTRPCProxyClient<ShardClientRouter>({
      links: [
        () =>
          ({ op, next }) => {
            return observable((observer) => {
              const { input, context } = op;

              if (op.path === 'onEvents') {
                const events = input as Event[];

                if (events.length) {
                  const now = Date.now();

                  const events = op.input as Array<{ name: string; args: Array<any> }>;

                  if (this.ctx.debugQueue) log('Sending queue', events);

                  let recordDetailed = now - this.ctx.eventFlushedAt > 500;
                  if (recordDetailed) {
                    this.ctx.eventFlushedAt = now;
                  }

                  const compiled: string[] = [];
                  for (const e of events) {
                    try {
                      compiled.push(e.args ? `["${e.name}","${e.args.join(':')}"]` : `["${e.name}"]`);

                      if (e.name === 'onUpdateClient' || e.name === 'onSpawnPowerup') {
                        if (recordDetailed) {
                          this.ctx.round.events.push({ type: 'emitAll', name: e.name, args: e.args });
                        }
                      } else {
                        this.ctx.round.events.push({ type: 'emitAll', name: e.name, args: e.args });
                      }

                      if (this.ctx.loggableEvents.includes('onEvents')) log(`emitAllDirect: ${e.name}`, e.args);
                      // log('Emitting onEvents directly to all subscribers', op.path, compiled);
                    } catch (err) {
                      console.log('Problem with event', err, e);
                    }
                  }

                  this.ctx.app.io.emit(
                    'trpc',
                    Buffer.from(
                      `{"id":"${generateShortId()}","method":"onEvents","type":"mutation","params":[${compiled.join(
                        ','
                      )}]}`
                    )
                  );
                }
              } else {
                if (this.ctx.loggableEvents.includes(op.path)) log(`emitAllDirect: ${op.path}`, input);

                this.ctx.app.io.emit(
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

    // if (Object.keys(this.ctx.clientLookup).length == 0) {
    this.randomRoundPreset();
    this.ctx.services.gameloop.clearSprites();
    // }
    // console.log('ccccc', this.ctx.config);
    setTimeout(() => this.monitorRealm(), 30 * 1000);

    clearTimeout(this.ctx.roundLoopTimeout);
    this.ctx.roundLoopTimeout = setTimeout(() => {
      this.resetLeaderboard();
    }, this.ctx.config.roundLoopSeconds * 1000);
  }

  async claimMaster(
    input: Shard.RouterInput['claimMaster'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['claimMaster']> {
    log('claimMaster', input);

    if (!client.isAdmin) {
      // if (client.address !== '0x954246b18fee13712C48E5a7Da5b78D88e8891d5') {
      throw new Error('Not authorized');
    }

    if (this.ctx.master?.client) {
      this.ctx.master.client.isMaster = false;

      this.ctx.disconnectClient(this.ctx.master.client, 'New master connected');

      // throw new Error('Master already connected');
    }

    client.isMaster = true;
    client.roles.push('master');

    client.ioCallbacks = {};

    this.ctx.master = {
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
    const res = await this.ctx.master.emit.init.mutate();
    log('init', res);

    // Check if initialization was successful
    if (!res) {
      throw new Error('Could not init self with master');
    }
  }

  public async calcRoundRewards(input: any, ctx: any) {
    const configureRes = await this.ctx.realm.emit.configure.mutate({
      clients: this.ctx.clients.map((c: any) => ({
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
        this.ctx.baseConfig[key] = configureRes[key];
        this.ctx.config[key] = configureRes[key];
        this.ctx.sharedConfig[key] = configureRes[key];
      }

      if (this.ctx.config.rewardWinnerAmount === 0 && configureRes.rewardWinnerAmount !== 0) {
        const roundTimer =
          this.ctx.round.startedDate + this.ctx.config.roundLoopSeconds - Math.round(Date.now() / 1000);
        this.ctx.emit.onSetRoundInfo.mutate(
          [roundTimer, this.ctx.getRoundInfo().join(':'), this.ctx.getGameModeGuide().join(':')],
          { context: ctx }
        );
      }
    }
  }

  randomizeSpriteXp() {
    const shuffledValues = shuffleArray([2, 4, 8, 16]);
    this.ctx.config.powerupXp0 = shuffledValues[0];
    this.ctx.config.powerupXp1 = shuffledValues[1];
    this.ctx.config.powerupXp2 = shuffledValues[2];
    this.ctx.config.powerupXp3 = shuffledValues[3];
  }

  monitorRealm(): void {
    if (!this.ctx.realm?.client?.socket?.connected) {
      this.ctx.emitAll.onBroadcast.mutate([`Realm not connected. Contact support.`, 0]);
      this.ctx.disconnectAllClients();
    }

    setTimeout(() => this.monitorRealm(), 5 * 1000);
  }

  public async resetLeaderboard(preset: any = null, context: any = null) {
    log('resetLeaderboard', preset);

    try {
      clearTimeout(this.ctx.roundLoopTimeout);

      if (this.ctx.config.gameMode === 'Pandamonium') {
        clearTimeout(this.ctx.roundLoopTimeout);
        this.ctx.roundLoopTimeout = setTimeout(
          () => this.resetLeaderboard(preset, context),
          this.ctx.config.roundLoopSeconds * 1000
        );
        return;
      }

      if (!this.ctx.realm.client?.socket?.connected) {
        this.ctx.emit.onBroadcast.mutate([`Realm not connected. Contact support.`, 0], { context: context });
        clearTimeout(this.ctx.roundLoopTimeout);
        this.ctx.roundLoopTimeout = setTimeout(
          () => this.resetLeaderboard(preset, context),
          this.ctx.config.roundLoopSeconds * 1000
        );
        return;
      }

      this.ctx.round.endedAt = Math.round(Date.now() / 1000);

      const fiveSecondsAgo = Date.now() - 7000;
      const thirtySecondsAgo = Date.now() - 30 * 1000;

      const winners = this.ctx.round.clients
        .filter((p) => p.lastUpdate >= fiveSecondsAgo)
        .sort((a, b) => b.points - a.points)
        .slice(0, 10);

      if (winners.length) {
        this.ctx.lastLeaderName = winners[0].name;
        log('Leader: ', winners[0]);

        if (winners[0]?.address) {
          this.ctx.emitAll.onRoundWinner.mutate([winners[0].name]);
        }

        if (this.ctx.config.isBattleRoyale) {
          this.ctx.emitAll.onBroadcast.mutate([
            `Top 5 - ${winners
              .slice(0, 5)
              .map((l) => l.name)
              .join(', ')}`,
            0,
          ]);
        }
      }

      const res = await this.ctx.realm.emit.saveRound.mutate({
        id: this.ctx.round.id + '',
        startedAt: this.ctx.round.startedDate,
        endedAt: this.ctx.round.endedAt,
        events: [],
        clients: this.ctx.round.clients.map((c: any) => ({
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

      if (this.ctx.config.calcRoundRewards) {
        await this.calcRoundRewards(null, context);
      }

      if (preset) {
        this.ctx.roundConfig = {
          ...this.ctx.baseConfig,
          ...this.ctx.sharedConfig,
          ...preset,
        };
        this.ctx.config = JSON.parse(JSON.stringify(this.ctx.roundConfig));
      } else {
        this.randomRoundPreset();
      }

      // TODO: get ID from realm
      // this.ctx.baseConfig.roundId = this.ctx.baseConfig.roundId + 1;
      // this.ctx.round.id = this.ctx.baseConfig.roundId;

      this.ctx.round = {
        id: res.roundId,
        gameMode: this.ctx.config.gameMode,
        startedDate: Math.round(Date.now() / 1000),
        endedAt: null,
        clients: [],
        events: [],
        states: [],
      };

      if (
        !this.ctx.config.level2open &&
        (this.ctx.config.level2forced ||
          (this.ctx.config.level2allowed && this.ctx.clients.length >= this.ctx.config.clientsRequiredForLevel2))
      ) {
        this.ctx.config.level2open = true;
        this.ctx.emitAll.onBroadcast.mutate([`Wall going down...`, 0]);

        this.ctx.config.spritesStartCount = 200;

        // setTimeout(() => {
        //   this.ctx.config.spritesStartCount = 200;
        //   this.ctx.clearSprites();
        //   this.ctx.spawnSprites(this.ctx.config.spritesStartCount);
        // }, 2000);

        this.ctx.emitAll.onOpenLevel2.mutate();
      } else if (this.ctx.config.level2open && !this.ctx.config.level2forced) {
        this.ctx.config.level2open = false;

        this.ctx.emitAll.onBroadcast.mutate([`Wall going up...`, 0]);

        this.ctx.config.spritesStartCount = 50;

        // this.ctx.config.spritesStartCount = 50;
        // this.ctx.clearSprites();
        // this.ctx.spawnSprites(this.ctx.config.spritesStartCount);

        // setTimeout(() => {
        //   for (const client of this.ctx.clients) {
        //     this.ctx.resetClient(client);
        //   }
        // }, 2000);

        this.ctx.emitAll.onCloseLevel2.mutate();
      }

      for (const client of this.ctx.clients) {
        if (!this.ctx.ranks[client.address]) this.ctx.ranks[client.address] = {};
        if (!this.ctx.ranks[client.address].kills) this.ctx.ranks[client.address].kills = 0;

        this.ctx.ranks[client.address].kills += client.kills;

        client.joinedRoundAt = Date.now();
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
        client.avatar = this.ctx.config.startAvatar;
        client.speed = this.ctx.getClientSpeed(client);
        client.cameraSize = client.overrideCameraSize || this.ctx.config.cameraSize;
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
        client.gameMode = this.ctx.config.gameMode;

        if (this.ctx.config.gameMode === 'Pandamonium' && this.ctx.pandas.includes(client.address)) {
          client.avatar = 2;
          this.ctx.emitAll.onUpdateEvolution.mutate([client.id, client.avatar, client.speed]);
        } else {
          this.ctx.emitAll.onUpdateRegression.mutate([client.id, client.avatar, client.speed]);
        }

        if (client.isDead || client.isSpectating) continue;

        client.startedRoundAt = Math.round(Date.now() / 1000);

        this.ctx.round.clients.push(client);
      }

      for (let i = 0; i < this.ctx.orbs.length; i++) {
        this.ctx.emitAll.onUpdatePickup.mutate(['null', this.ctx.orbs[i].id, 0]);
      }

      this.ctx.orbs.splice(0, this.ctx.orbs.length);

      this.randomizeSpriteXp();

      this.ctx.services.gameloop.syncSprites();

      const roundTimer = this.ctx.round.startedDate + this.ctx.config.roundLoopSeconds - Math.round(Date.now() / 1000);
      this.ctx.emitAll.onSetRoundInfo.mutate([
        roundTimer,
        this.ctx.getRoundInfo().join(':'),
        this.ctx.getGameModeGuide().join(':'),
      ]);

      log(
        'roundInfo',
        roundTimer,
        this.ctx.getRoundInfo().join(':'),
        this.ctx.getGameModeGuide().join(':'),
        (
          this.ctx.config.roundLoopSeconds +
          ':' +
          this.ctx.getRoundInfo().join(':') +
          ':' +
          this.ctx.getGameModeGuide().join(':')
        ).split(':').length
      );

      this.ctx.emitAll.onClearLeaderboard.mutate();

      this.ctx.emitAll.onBroadcast.mutate([`Game Mode - ${this.ctx.config.gameMode} (Round ${this.ctx.round.id})`, 0]);

      if (this.ctx.config.hideMap) {
        this.ctx.emitAll.onHideMinimap.mutate();
        this.ctx.emitAll.onBroadcast.mutate([`Minimap hidden in this mode!`, 2]);
      } else {
        this.ctx.emitAll.onShowMinimap.mutate();
      }

      if (this.ctx.config.periodicReboots && this.ctx.rebootAfterRound) {
        this.ctx.emitAll.onMaintenance.mutate([true]);

        setTimeout(() => {
          process.exit();
        }, 3 * 1000);
      }

      if (this.ctx.config.periodicReboots && this.ctx.announceReboot) {
        const value = 'Restarting server at end of this round.';

        this.ctx.emitAll.onBroadcast.mutate([value, 1]);

        this.ctx.rebootAfterRound = true;
      }

      this.ctx.roundLoopTimeout = setTimeout(
        () => this.resetLeaderboard(preset, context),
        this.ctx.config.roundLoopSeconds * 1000
      );
    } catch (e) {
      console.log('Exception during resetLeaderboard', e);

      setTimeout(() => {
        this.ctx.emit.onBroadcast.mutate([`Error Occurred. Please report.`, 3]);
      }, 30 * 1000);

      this.ctx.sharedConfig.rewardWinnerAmount = 0;
      this.ctx.config.rewardWinnerAmount = 0;
      this.ctx.sharedConfig.rewardItemAmount = 0;
      this.ctx.config.rewardItemAmount = 0;

      log('Shard -> Realm: recalling init');
      // Initialize the realm server with status 1
      const res = await this.ctx.realm.emit.init.mutate();
      log('init', res);

      // Check if initialization was successful
      if (!res) {
        throw new Error('Could not init self with realm');
      }

      // this.ctx.config.maxClients = res.maxClients;
      this.ctx.round.id = res.roundId;

      for (const key of Object.keys(res)) {
        // console.log(key, res[key]);
        this.ctx.baseConfig[key] = res[key];
        this.ctx.config[key] = res[key];
        this.ctx.sharedConfig[key] = res[key];
      }

      console.log('Setting config', this.ctx.config);

      if (this.ctx.config.calcRoundRewards) {
        await this.calcRoundRewards(null, context);
      }

      this.ctx.roundLoopTimeout = setTimeout(() => this.resetLeaderboard(preset, context), 5 * 1000);
    }
  }

  randomRoundPreset(): void {
    const gameMode = this.ctx.config.gameMode;
    while (this.ctx.config.gameMode === gameMode) {
      const filteredPresets = presets.filter((p) => !!p.isEnabled);
      this.ctx.currentPreset = weightedRandom(filteredPresets);
      this.ctx.roundConfig = { ...this.ctx.baseConfig, ...this.ctx.sharedConfig, ...this.ctx.currentPreset };
      log('randomRoundPreset', this.ctx.config.gameMode, gameMode, this.ctx.currentPreset);
      this.ctx.config = JSON.parse(JSON.stringify(this.ctx.roundConfig));
    }
  }

  addToRecentClients(client: Shard.Client): void {
    if (!client.address || !client.name) return;
    this.ctx.round.clients = this.ctx.round.clients.filter((r) => r.address !== client.address);
    this.ctx.round.clients.push(client);
  }

  public getPayload(messages: string[]): Buffer {
    // Super-cheap JSON Array construction
    const jsonArray = `[${messages.join(',')}]`;
    return Buffer.from(jsonArray);
  }

  resetClient(client) {
    const spawnPoint = this.ctx.clientSpawnPoints[Math.floor(Math.random() * this.ctx.clientSpawnPoints.length)];
    client.position = spawnPoint;
    client.target = spawnPoint;
    client.clientPosition = spawnPoint;
    client.clientTarget = spawnPoint;
    client.avatar = 0;
    client.xp = 75;
    client.maxHp = 100;
  }

  async info(input: Shard.RouterInput['info'], { client }: Shard.ServiceContext): Promise<Shard.RouterOutput['info']> {
    return {
      id: this.ctx.config.id || 'Unknown',
      version: this.ctx.serverVersion,
      // port: this.ctx.state.spawnPort,
      round: { id: this.ctx.round.id, startedDate: this.ctx.round.startedDate },
      clientCount: this.ctx.clients.length,
      // clientCount: this.ctx.clients.filter((c) => !c.isDead && !c.isSpectating).length,
      spectatorCount: this.ctx.clients.filter((c) => c.isSpectating).length,
      recentClientsCount: this.ctx.round.clients.length,
      spritesCount: this.ctx.config.spritesTotal,
      connectedClients: this.ctx.clients.filter((c) => !!c.address).map((c) => c.address),
      rewardItemAmount: this.ctx.config.rewardItemAmount,
      rewardWinnerAmount: this.ctx.config.rewardWinnerAmount,
      gameMode: this.ctx.config.gameMode,
      orbs: this.ctx.orbs,
      currentReward: this.ctx.currentReward,
    };
  }

  async initRealm(
    input: Shard.RouterInput['initRealm'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['initRealm']> {
    log('initRealm', input);
    // async connected(input: Shard.ConnectedInput, { client }: Shard.ServiceContext): Shard.ConnectedOutput {
    if (this.ctx.realm?.client?.socket?.connected) {
      this.ctx.disconnectClient(this.ctx.realm.client, 'Realm already connected');

      throw new Error('Realm already connected');
    }

    client.isRealm = true;
    client.roles.push('realm');

    client.ioCallbacks = {};

    this.ctx.realm = {
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
                op.context.client.roles = ['admin', 'mod', 'user', 'guest'];

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
    const res = await this.ctx.realm.emit.init.mutate();
    log('init', res);

    // Check if initialization was successful
    if (!res) {
      throw new Error('Could not init self with realm');
    }

    // this.ctx.config.maxClients = res.maxClients;
    this.ctx.round.id = res.roundId;

    for (const key of Object.keys(res)) {
      // console.log(key, res[key]);
      this.ctx.baseConfig[key] = res[key];
      this.ctx.config[key] = res[key];
      this.ctx.sharedConfig[key] = res[key];
    }

    console.log('Setting config', this.ctx.config);
  }
}
