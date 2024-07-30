import { httpBatchLink, createTRPCProxyClient, loggerLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import axios from 'axios';
import shortId from 'shortid';
import semver from 'semver/preload.js';
import {
  log,
  getTime,
  logError,
  shuffleArray,
  randomPosition,
  sha256,
  decodePayload,
  isNumeric,
  ipHashFromSocket,
} from '@arken/node/util';
import { sleep } from '@arken/node/util/time';
import { customErrorFormatter, hasRole, transformer } from '@arken/node/util/rpc';
import { testMode, baseConfig, sharedConfig, Config } from '@arken/evolution-protocol/config';
import { presets } from '@arken/evolution-protocol/presets';
import * as schema from '@arken/evolution-protocol/shard/schema';
import type * as Schema from '@arken/evolution-protocol/shard/schema';
import { procedure, router } from '@arken/evolution-protocol/shard/server';
import type {
  Orb,
  ShardApplication,
  ShardClient,
  Position,
  Boundary,
  Signature,
  Reward,
  PowerUp,
  RoundEvent,
  Round,
  Preset,
  Event,
  ShardContext,
  ShardClientRouter,
  Realm,
} from '@arken/evolution-protocol/types';
import { Mechanic } from '@arken/evolution-protocol/types';
import mapData from './public/data/map.json';

export const createRealmRouter = (realm: Realm) => {
  return router({
    // connected: t.procedure
    //   .use(hasRole('realm', t))
    //   .use(customErrorFormatter(t))
    //   .input(schema.connected)
    //   .mutation(({ input, ctx }) => Realm.connected(input as Schema.ConnectedInput, ctx)),
  });
};

class Shard {
  io: any;
  state: any;
  realm: any; //ReturnType<typeof createClient>;
  guestNames: string[];
  serverVersion: string;
  roundLoopTimeout?: NodeJS.Timeout;
  addressToUsername: Record<string, string>;
  announceReboot: boolean;
  rebootAfterRound: boolean;
  debugQueue: boolean;
  killSameNetworkClients: boolean;
  sockets: Record<string, any>;
  clientLookup: Record<string, ShardClient>;
  powerups: PowerUp[];
  powerupLookup: Record<string, PowerUp>;
  currentReward?: Reward;
  orbs: Orb[];
  orbLookup: Record<string, Orb>;
  eventQueue: Event[];
  clients: ShardClient[];
  lastReward?: Reward;
  lastLeaderName?: string;
  config: Partial<Config>;
  sharedConfig: Partial<Config>;
  baseConfig: Partial<Config>;
  round: Round;
  ranks: Record<string, any>;
  pandas: string[];
  rateLimitWindow: number;
  maxRequestsPerWindow: number;
  requestTimestamps: Record<string, number[]>;
  loggableEvents: string[];
  currentPreset: Preset;
  roundConfig: Config;
  spawnBoundary1: Boundary;
  spawnBoundary2: Boundary;
  mapBoundary: Boundary;
  eventFlushedAt: number;
  clientSpawnPoints: Position[];
  lastFastGameloopTime: number;
  lastFastestGameloopTime: number;
  app: ShardApplication;
  emit: ReturnType<typeof createTRPCProxyClient<ShardClientRouter>>;
  emitDirect: ReturnType<typeof createTRPCProxyClient<ShardClientRouter>>;
  emitAll: ReturnType<typeof createTRPCProxyClient<ShardClientRouter>>;
  emitAllDirect: ReturnType<typeof createTRPCProxyClient<ShardClientRouter>>;

  constructor(app: ShardApplication) {
    this.app = app;
    this.realm = new Realm();
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
      'Rokk',
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
    this.serverVersion = '2.0.0';
    this.roundLoopTimeout;
    this.addressToUsername = {};
    this.announceReboot = false;
    this.rebootAfterRound = false;
    this.debugQueue = false;
    this.killSameNetworkClients = true;
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
      id: shortId(),
      startedAt: Math.round(getTime() / 1000),
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
    this.loggableEvents = ['onMaintenance', 'saveRound'];
    this.currentPreset = presets[Math.floor(Math.random() * presets.length)];
    this.baseConfig = baseConfig;
    this.sharedConfig = sharedConfig;
    this.config = { ...baseConfig, ...sharedConfig };
    this.roundConfig = { ...baseConfig, ...sharedConfig, ...this.currentPreset };
    this.spawnBoundary1 = { x: { min: -17, max: 0 }, y: { min: -13, max: -4 } };
    this.spawnBoundary2 = { x: { min: -37, max: 0 }, y: { min: -13, max: -2 } };
    this.mapBoundary = { x: { min: -38, max: 2 }, y: { min: -20, max: 2 } };
    this.clientSpawnPoints = [
      { x: -4.14, y: -11.66 },
      { x: -11.14, y: -8.55 },
      { x: -12.27, y: -14.24 },
      { x: -7.08, y: -12.75 },
      { x: -7.32, y: -15.29 },
    ];
    this.lastFastGameloopTime = getTime();
    this.lastFastestGameloopTime = getTime();

    this.emit = createTRPCProxyClient<ShardClientRouter>({
      links: [
        () =>
          ({ op, next }) => {
            return observable((observer) => {
              const { input, context } = op;
              const { name, args } = input as Event;
              const client = context.client as ShardClient;

              if (!client) {
                log('Emit Direct failed, no client', ...args);
                observer.complete();
                return;
              }

              if (!client.socket || !client.socket.emit) {
                log('Emit Direct failed, bad socket', ...args);
                observer.complete();
                return;
              }
              log('Emit Direct', ...args);
              const compiled: any[] = [];
              const eventQueue = [{ name, args }];
              for (const e of eventQueue) {
                compiled.push(`["${e.name}","${Object.values(e.args).join(':')}"]`);
                this.round.events.push({ type: 'emitDirect', client: client.id, name: e.name, args: e.args });
              }

              (context.client as ShardClient).socket.emit('onEvents', this.getPayload(compiled));

              observer.complete();
            });
          },
      ],
      transformer,
    });

    this.emitDirect = createTRPCProxyClient<ShardClientRouter>({
      links: [
        () =>
          ({ op, next }) => {
            return observable((observer) => {
              const { input, context } = op;
              const { name, args } = input as Event;
              if (this.loggableEvents.includes(name)) {
                console.log(`emitDirect: ${name}`, args);
              }

              (context.client as ShardClient).socket.emit(name, Object.values(args));

              observer.complete();
            });
          },
      ],
      transformer,
    });

    this.emitAll = createTRPCProxyClient<ShardClientRouter>({
      links: [
        () =>
          ({ op, next }) => {
            return observable((observer) => {
              const { input, context } = op;
              const { name, args } = input as Event;
              this.eventQueue.push({ name, args });
              observer.complete();
            });
          },
      ],
      transformer,
    });

    this.emitAllDirect = createTRPCProxyClient<ShardClientRouter>({
      links: [
        () =>
          ({ op, next }) => {
            return observable((observer) => {
              const { input, context } = op;

              if (op.path === 'events') {
                const events = input as Event[];

                if (events.length) {
                  const now = this.getTime();

                  if (this.debugQueue) log('Sending queue', this.eventQueue);

                  let recordDetailed = now - this.eventFlushedAt > 500;
                  if (recordDetailed) {
                    this.eventFlushedAt = now;
                  }

                  const compiled: string[] = [];
                  for (const e of this.eventQueue) {
                    compiled.push(`["${e.name}","${e.args.join(':')}"]`);

                    if (e.name === 'onUpdateClient' || e.name === 'onSpawnPowerup') {
                      if (recordDetailed) {
                        this.round.events.push({ type: 'emitAll', name: e.name, args: e.args });
                      }
                    } else {
                      this.round.events.push({ type: 'emitAll', name: e.name, args: e.args });
                    }

                    if (this.loggableEvents.includes(e.name)) {
                      console.log(`Publish Event: ${e.name}`, e.args);
                    }

                    this.io.emit('events', this.getPayload(compiled));
                  }
                }
              } else {
                this.io.emit(op.path, ...Object.values(input));
              }

              observer.complete();
            });
          },
      ],
      transformer,
    });
  }

  clearSprites() {
    this.powerups.splice(0, this.powerups.length); // clear the powerup list
  }

  init() {
    if (Object.keys(this.clientLookup).length == 0) {
      this.randomRoundPreset();
      this.clearSprites();
      this.spawnSprites(this.app.config.spritesStartCount);
    }
    setTimeout(() => this.monitorRealm(), 30 * 1000);
    setTimeout(() => this.fastGameloop(), this.app.config.fastLoopSeconds * 1000);
    setTimeout(() => this.slowGameloop(), this.app.config.slowLoopSeconds * 1000);
    setTimeout(() => this.sendUpdates(), this.app.config.sendUpdateLoopSeconds * 1000);
    setTimeout(() => this.spawnRewards(), this.app.config.rewardSpawnLoopSeconds * 1000);
    setTimeout(() => this.checkConnectionLoop(), this.app.config.checkConnectionLoopSeconds * 1000);
    this.roundLoopTimeout = setTimeout(() => {
      this.resetLeaderboard();
    }, this.app.config.roundLoopSeconds * 1000);
  }

  public async calcRoundRewards() {
    const calcRewardsRes = await this.realm.emit.configureRequest.mutate({
      clients: this.clients,
    });

    if (calcRewardsRes?.data) {
      this.sharedConfig.rewardWinnerAmount = calcRewardsRes.data.rewardWinnerAmount;
      this.config.rewardWinnerAmount = calcRewardsRes.data.rewardWinnerAmount;
      this.sharedConfig.rewardItemAmount = calcRewardsRes.data.rewardItemAmount;
      this.config.rewardItemAmount = calcRewardsRes.data.rewardItemAmount;

      if (this.config.rewardWinnerAmount === 0 && calcRewardsRes.data.rewardWinnerAmount !== 0) {
        const roundTimer = this.round.startedAt + this.config.roundLoopSeconds - Math.round(this.getTime() / 1000);
        this.emit.onSetRoundInfo.mutate(
          roundTimer + ':' + this.getRoundInfo().join(':') + ':' + this.getGameModeGuide(this.config).join(':')
        );
      }
    }
  }

  public async resetLeaderboard(preset: any = null) {
    try {
      log('resetLeaderboard', preset);

      if (this.config.gameMode === 'Pandamonium') {
        this.roundLoopTimeout = setTimeout(() => this.resetLeaderboard(), this.config.roundLoopSeconds * 1000);
        return;
      }

      if (!this.realm.client?.socket?.connected) {
        this.emit.onBroadcast.mutate({ message: `Realm not connected. Contact support.`, priority: 0 });
        this.roundLoopTimeout = setTimeout(() => this.resetLeaderboard(), this.config.roundLoopSeconds * 1000);
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
          this.emit.onRoundWinner.mutate(winners[0].name);
        }

        if (this.config.isBattleRoyale) {
          this.emit.onBroadcast.mutate(
            `Top 5 - ${winners
              .slice(0, 5)
              .map((l) => l.name)
              .join(', ')}`,
            0
          );
        }
      }

      const saveRoundRes = await this.realm.emit.saveRoundRequest.mutate({
        startedAt: this.round.startedAt,
        endedAt: this.round.endedAt,
        players: this.round.clients,
        winners,
      });

      if (saveRoundRes?.status !== 1) {
        this.sharedConfig.rewardWinnerAmount = 0;
        this.config.rewardWinnerAmount = 0;
        this.sharedConfig.rewardItemAmount = 0;
        this.config.rewardItemAmount = 0;

        setTimeout(() => {
          this.emit.onBroadcast.mutate({ message: `Maintenance`, priority: 3 });
        }, 30 * 1000);
      }

      if (this.config.calcRoundRewards) {
        await this.calcRoundRewards();
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

      this.baseConfig.roundId = this.baseConfig.roundId + 1;
      this.config.roundId = this.baseConfig.roundId;

      this.round = {
        startedAt: Math.round(this.getTime() / 1000),
        endedAt: null,
        players: [],
        events: [],
        states: [],
      };

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
        client.baseSpeed = 1;
        client.decayPower = 1;
        client.pickups = [];
        client.xp = 50;
        client.maxHp = 100;
        client.avatar = this.config.startAvatar;
        client.speed = this.getClientSpeed(client, this.config);
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
          replay: [],
        };
        client.gameMode = this.config.gameMode;

        if (this.config.gameMode === 'Pandamonium' && this.pandas.includes(client.address)) {
          client.avatar = 2;
          this.emit('onUpdateEvolution', client.id, client.avatar, client.speed);
        } else {
          this.emit('onUpdateRegression', client.id, client.avatar, client.speed);
        }

        if (client.isDead || client.isSpectating) continue;

        client.startedRoundAt = Math.round(this.getTime() / 1000);

        this.round.players.push(client);
      }

      for (let i = 0; i < this.orbs.length; i++) {
        this.emit('onUpdatePickup', 'null', this.orbs[i].id, 0);
      }

      this.orbs.splice(0, this.orbs.length);

      this.randomizeSpriteXp();

      this.syncSprites();

      const roundTimer = this.round.startedAt + this.config.roundLoopSeconds - Math.round(this.getTime() / 1000);
      this.emit(
        'OnSetRoundInfo',
        roundTimer + ':' + this.getRoundInfo().join(':') + ':' + this.getGameModeGuide(this.config).join(':')
      );

      log(
        'roundInfo',
        roundTimer + ':' + this.getRoundInfo().join(':') + ':' + this.getGameModeGuide(this.config).join(':'),
        (
          this.config.roundLoopSeconds +
          ':' +
          this.getRoundInfo().join(':') +
          ':' +
          this.getGameModeGuide(this.config).join(':')
        ).split(':').length
      );

      this.emit('onClearLeaderboard');

      this.emit.onBroadcast.mutate({
        message: `Game Mode - ${this.config.gameMode} (Round ${this.config.roundId})`,
        priority: 0,
      });

      if (this.config.hideMap) {
        this.emit('onHideMinimap');
        this.emit.onBroadcast.mutate({ message: `Minimap hidden in this mode!`, priority: 2 });
      } else {
        this.emit('onShowMinimap');
      }

      if (this.config.periodicReboots && this.rebootAfterRound) {
        this.emit('onMaintenance', true);

        setTimeout(() => {
          process.exit();
        }, 3 * 1000);
      }

      if (this.config.periodicReboots && this.announceReboot) {
        const value = 'Restarting server at end of this round.';

        this.emit.onBroadcast.mutate({ message: value, priority: 1 });

        this.rebootAfterRound = true;
      }
    } catch (e) {
      log('Error:', e);
    }

    this.roundLoopTimeout = setTimeout(() => this.resetLeaderboard(), this.config.roundLoopSeconds * 1000);
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
      this.emitAll(
        'onUpdateBestClient',
        leaderboard[j].name,
        j,
        leaderboard[j].points,
        leaderboard[j].kills,
        leaderboard[j].deaths,
        leaderboard[j].powerups,
        leaderboard[j].evolves,
        leaderboard[j].rewards,
        leaderboard[j].isDead ? '-' : Math.round(leaderboard[j].latency),
        this.ranks[leaderboard[j].address]?.kills / 5 || 1
      );
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

    const rewardRes = await this.realm.router.getRandomReward.mutate();

    if (rewardRes?.status !== 1) return;

    const tempReward = rewardRes.reward;

    if (!tempReward) {
      return;
    }

    if (tempReward.type !== 'rune') {
      this.emitAll.onBroadcast.mutate({
        message: `Powerful Energy Detected - ${tempReward.rewardItemName}`,
        priority: 3,
      });
    }

    await sleep(3 * 1000);
    this.currentReward = { ...tempReward };

    this.emitAll.onSpawnReward.mutate([
      this.currentReward.id,
      this.currentReward.rewardItemType,
      this.currentReward.rewardItemName,
      this.currentReward.quantity,
      this.currentReward.position.x,
      this.currentReward.position.y,
    ]);

    await sleep(3 * 1000);
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
      this.emitAll.onBroadcast.mutate({ message: `Realm not connected. Contact support.`, priority: 0 });
      this.disconnectAllClients();
    }

    setTimeout(() => this.monitorRealm(), 5 * 1000);
  }

  fastGameloop(): void {
    try {
      const now = this.getTime();

      this.detectCollisions();

      for (let i = 0; i < this.clients.length; i++) {
        const client = this.clients[i];

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

        client.speed = this.getClientSpeed(client, this.config);

        if (!this.config.isRoundPaused && this.config.gameMode !== 'Pandamonium') {
          let decay = this.config.noDecay
            ? 0
            : ((client.avatar + 1) / (1 / this.config.fastLoopSeconds)) *
              ((this.config['avatarDecayPower' + client.avatar] || 1) * this.config.decayPower);

          if (this.isMechanicEnabled({ id: 1105 }, { client }) && this.isMechanicEnabled({ id: 1104 }, { client })) {
            decay = decay * (1 + (client.character.meta[1105] - client.character.meta[1104]) / 100);
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

        this.emitAll.onUpdatePlayer(
          {
            data: [
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
            ],
          },
          { client }
        );
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

    setTimeout(() => this.fastGameloop(), this.config.fastLoopSeconds * 1000);
  }

  disconnectAllClients(): void {
    if (this.clients.length === 0) return;

    log('Disconnecting all clients');

    for (const client of this.clients) {
      this.disconnectClient(client, 'disconnect all clients');
    }
  }

  handleClientDecay(client: ShardClient, decay: number, now: number, isInvincible: boolean, currentTime: number): void {
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

          if (this.isMechanicEnabled({ id: 1223 }, { client }) && client.character.meta[1223] > 0) {
            client.overrideSpeedUntil = this.getTime() + 1000;
            client.overrideSpeed = client.speed * (1 + client.character.meta[1223] / 100);

            if (this.isMechanicEnabled({ id: 1030 }, { client }) && client.character.meta[1030] > 0) {
              client.overrideSpeed = client.overrideSpeed * (1 + client.character.meta[1030] / 100);
            }
          }

          this.emitAll('onUpdateEvolution', client.id, client.avatar, client.overrideSpeed || client.speed);
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

          if (this.isMechanicEnabled({ id: 1223 }, { client }) && client.character.meta[1223] > 0) {
            client.overrideSpeedUntil = this.getTime() + 1000;
            client.overrideSpeed = client.speed * (1 + client.character.meta[1223] / 100);

            if (this.isMechanicEnabled({ id: 1030 }, { client }) && client.character.meta[1030] > 0) {
              client.overrideSpeed = client.overrideSpeed * (1 + client.character.meta[1030] / 100);
            }
          }

          this.emitAll('onUpdateEvolution', client.id, client.avatar, client.overrideSpeed || client.speed);
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
                this.registerKill(this.app, this.clientLookup[client.lastTouchClientId], client);
              } else {
                this.disconnectClient(client, 'starved');
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

            this.emitAll('onUpdateRegression', client.id, client.avatar, client.overrideSpeed || client.speed);
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

            this.emitAll('onUpdateRegression', client.id, client.avatar, client.overrideSpeed || client.speed);
          }
        }
      }
    }
  }

  registerKill(winner: ShardClient, loser: ShardClient): void {
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

    if (this.isMechanicEnabled({ id: 1102 }, { client: loser }) && loser.character.meta[1102] > 0) {
      const r = this.random(1, 100);

      if (r <= loser.character.meta[1102]) {
        deathPenaltyAvoid = true;
        this.emitAll.onBroadcast.mutate({ message: `${loser.name} avoided penalty!`, priority: 0 });
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

    if (winner.points < 0) winner.points = 0;
    if (loser.points < 0) loser.points = 0;

    if (winner.log.deaths.length && winner.log.deaths[winner.log.deaths.length - 1] === loser.hash) {
      winner.log.revenge += 1;
    }

    if (this.isMechanicEnabled({ id: 1222 }, { client: winner }) && winner.character.meta[1222] > 0) {
      winner.overrideSpeed =
        winner.speed * (1 + winner.character.meta[1222] / 100) * (1 + winner.character.meta[1030] / 100);
      winner.overrideSpeedUntil = this.getTime() + 5000;
    }

    if (this.isMechanicEnabled({ id: 1219 }, { client: winner }) && winner.character.meta[1219] > 0) {
      winner.maxHp = winner.maxHp * (1 + winner.character.meta[1219] / 100);
    }

    winner.xp += 25;

    if (winner.xp > winner.maxHp) winner.xp = winner.maxHp;

    this.emitAll('onGameOver', loser.id, winner.id);

    this.disconnectClient(loser, 'got killed');

    const orb: Orb = {
      id: shortId.generate(),
      type: 4,
      points: orbPoints,
      scale: orbPoints,
      enabledAt: now + this.config.orbTimeoutSeconds * 1000,
      position: {
        x: loser.position.x,
        y: loser.position.y,
      },
    };

    const currentRound = this.config.roundId;

    if (this.config.orbOnDeathPercent > 0 && !this.roundEndingSoon(this.config.orbCutoffSeconds)) {
      setTimeout(() => {
        if (this.config.roundId !== currentRound) return;

        this.orbs.push(orb);
        this.orbLookup[orb.id] = orb;

        this.emitAll('onSpawnPowerUp', orb.id, orb.type, orb.position.x, orb.position.y, orb.scale);
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
      this.emitAll.onBroadcast.mutate({
        message: `${totalAliveClients[0].name} is the last dragon standing`,
        priority: 3,
      });

      this.baseConfig.isBattleRoyale = false;
      this.config.isBattleRoyale = false;
      this.baseConfig.isGodParty = true;
      this.config.isGodParty = true;
    }
  }

  getTime(): number {
    return Date.now();
  }

  async connected(input: Schema.ConnectedInput, { client }: ShardContext) {
    if (this.realm.client?.socket?.connected) {
      this.disconnectClient(this.realm.client, 'Realm already connected');
      return;
    }

    client.isRealm = true;

    this.realm.client = client;

    // Initialize the realm server with status 1
    const res = await this.realm.router.init.mutate();
    log('init', res);

    // Check if initialization was successful
    if (res?.status !== 1) {
      logError('Could not init');
      return { status: 0 };
    }

    // Update this.app configuration based on the response
    this.baseConfig.id = res.id;
    this.config.id = res.id;
    this.baseConfig.roundId = res.data.roundId;
    this.config.roundId = res.data.roundId;

    return { status: 1 };
  }

  weightedRandom(items: { weight: number }[]): any {
    let table = items.flatMap((item) => Array(item.weight).fill(item));
    return table[Math.floor(Math.random() * table.length)];
  }

  randomRoundPreset(): void {
    const gameMode = this.config.gameMode;
    while (this.config.gameMode === gameMode) {
      const filteredPresets = presets.filter((p) => !p.isOmit);
      this.currentPreset = this.weightedRandom(filteredPresets);
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
    this.emitAll('onUpdateReward', 'null', this.currentReward.id);
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
            const diff = 25;
            collider.minY -= diff;
            collider.maxY -= diff;
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
      const powerupSpawnPoint = { id: shortId.generate(), type: Math.floor(Math.random() * 4), scale: 1, position };
      this.powerups.push(powerupSpawnPoint);
      this.powerupLookup[powerupSpawnPoint.id] = powerupSpawnPoint;
      this.emitAll(
        'onSpawnPowerUp',
        powerupSpawnPoint.id,
        powerupSpawnPoint.type,
        powerupSpawnPoint.position.x,
        powerupSpawnPoint.position.y,
        powerupSpawnPoint.scale
      );
    }
    this.config.spritesTotal = this.powerups.length;
  }

  addToRecentClients(client: ShardClient): void {
    if (!client.address || !client.name) return;
    this.round.clients = this.round.clients.filter((r) => r.address !== client.address);
    this.round.clients.push(client);
  }

  roundEndingSoon(sec: number): boolean {
    const roundTimer = this.round.startedAt + this.config.roundLoopSeconds - Math.round(this.getTime() / 1000);
    return roundTimer < sec;
  }

  generateGuestName(): string {
    const randomIndex = Math.floor(Math.random() * this.guestNames.length);
    return this.guestNames[randomIndex];
  }

  async apiConnected(input: Schema.ApiConnectedInput, ctx: ShardContext) {
    this.emitAll.onBroadcast.mutate({ message: 'API connected', priority: 0 });
    return { status: 1 };
  }

  async apiDisconnected(input: Schema.ApiDisconnectedInput, ctx: ShardContext) {
    this.emitAll.onBroadcast.mutate({ message: 'API disconnected', priority: 0 });
    return { status: 1 };
  }

  // Example usage in your function:
  broadcastMechanics(input: Schema.BroadcastInput, { client }: ShardContext): void {
    if (this.isMechanicEnabled({ id: Mechanic.RewardsIncrease }, { client })) {
      this.emit(
        client,
        'onBroadcast',
        `${this.formatNumber(
          client.character.meta[Mechanic.RewardsIncrease] - client.character.meta[Mechanic.RewardsDecrease]
        )}% Rewards`,
        0
      );
    }
    if (this.isMechanicEnabled({ id: Mechanic.MovementBurstOnKill }, { client })) {
      this.emit(
        client,
        'onBroadcast',
        `${this.formatNumber(client.character.meta[Mechanic.MovementBurstOnKill])}% Movement Burst On Kill`,
        0
      );
    }
    if (this.isMechanicEnabled({ id: Mechanic.MovementBurstOnEvolve }, { client })) {
      this.emit(
        client,
        'onBroadcast',
        `${this.formatNumber(client.character.meta[Mechanic.MovementBurstOnEvolve])}% Movement Burst On Evolve`,
        0
      );
    }
    if (this.isMechanicEnabled({ id: Mechanic.MovementBurstStrength }, { client })) {
      this.emit(
        client,
        'onBroadcast',
        `${this.formatNumber(client.character.meta[Mechanic.MovementBurstStrength])}% Movement Burst Strength`,
        0
      );
    }
    if (this.isMechanicEnabled({ id: Mechanic.AvoidDeathPenalty }, { client })) {
      this.emit(
        client,
        'onBroadcast',
        `${this.formatNumber(client.character.meta[Mechanic.AvoidDeathPenalty])}% Avoid Death Penalty`,
        0
      );
    }
    if (this.isMechanicEnabled({ id: Mechanic.DoublePickupChance }, { client })) {
      this.emit(
        client,
        'onBroadcast',
        `${this.formatNumber(client.character.meta[Mechanic.DoublePickupChance])}% Double Pickup Chance`,
        0
      );
    }
    if (this.isMechanicEnabled({ id: Mechanic.IncreasedHealthOnKill }, { client })) {
      this.emit(
        client,
        'onBroadcast',
        `${this.formatNumber(client.character.meta[Mechanic.IncreasedHealthOnKill])}% Increased Health On Kill`,
        0
      );
    }
    if (this.isMechanicEnabled({ id: Mechanic.EnergyDecay }, { client })) {
      this.emit(
        client,
        'onBroadcast',
        `${this.formatNumber(
          client.character.meta[Mechanic.EnergyDecay] - client.character.meta[Mechanic.EnergyDecay - 1]
        )}% Energy Decay`,
        0
      );
    }
    if (this.isMechanicEnabled({ id: Mechanic.SpriteFuel }, { client })) {
      this.emit(
        client,
        'onBroadcast',
        `${this.formatNumber(
          client.character.meta[Mechanic.SpriteFuel] - client.character.meta[Mechanic.SpriteFuel - 1]
        )}% Sprite Fuel`,
        0
      );
    }
  }

  isMechanicEnabled({ id }: { id: number }, { client }: ShardContext): boolean {
    return !!client.character.meta[id];
  }

  async setCharacter(input: Schema.SetCharacterInput, { client }: ShardContext) {
    // Check if the client is a realm client
    if (!client.isRealm) {
      return { status: 0 };
    }

    // Find the client with the specified address
    const newClient = this.clients.find((c) => c.address === input.data.address);
    if (!newClient) {
      return { status: 0 };
    }

    // Update the character information
    newClient.character = {
      ...input.data.character,
      meta: { ...newClient.character.meta, ...input.data.character.meta },
    };

    return { status: 1 };
  }

  async setConfig(input: Schema.SetConfigInput, { client }: ShardContext) {
    return { status: 1 };
  }

  async getConfig(input: Schema.GetConfigInput, { client }: ShardContext) {
    return { status: 1, data: this.config };
  }

  async load(input: Schema.LoadInput, { client }: ShardContext) {
    log('Load', client.hash);
    this.emit.onLoaded.mutate(1, { client });
    return { status: 1 };
  }

  public spectate(input: Schema.SpectateInput, { client }: ShardContext) {
    // Spectating is not allowed during maintenance unless the client is a moderator
    if (this.config.isMaintenance && !client.isMod) return { status: 0 };

    if (client.isSpectating) {
      // Handle case where client is already spectating (commented-out logic for unspectating)
      // You may want to define this logic if needed.
    } else {
      // Enable spectating for the client
      client.isSpectating = true;
      client.isInvincible = true;
      client.points = 0;
      client.xp = 0;
      client.maxHp = 100;
      client.avatar = this.config.startAvatar;
      client.speed = 7;
      client.overrideSpeed = 7;
      client.cameraSize = 8;
      client.overrideCameraSize = 8;
      client.log.spectating += 1;

      this.syncSprites();
      this.emitAll('onSpectate', client.id, client.speed, client.cameraSize);
    }
  }

  syncSprites() {
    log('Syncing sprites');
    const clientCount = this.clients.filter((c) => !c.isDead && !c.isSpectating && !c.isGod).length;
    const length = this.config.spritesStartCount + clientCount * this.config.spritesPerClientCount;

    if (this.powerups.length > length) {
      const deletedPoints = this.powerups.splice(length);
      for (let i = 0; i < deletedPoints.length; i++) {
        this.emitAll('onUpdatePickup', 'null', deletedPoints[i].id, 0);
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

    this.emitAllDirect.onEvents.mutate(this.eventQueue);

    this.eventQueue = [];
  }

  disconnectClient(client: ShardClient, reason = 'Unknown', immediate = false) {
    if (client.isRealm) return;

    this.clients = this.clients.filter((c) => c.id !== client.id);

    if (this.config.gameMode === 'Pandamonium') {
      this.emitAll.onBroadcast.mutate({
        message: `${
          this.clients.filter(
            (c) => !c.isDead && !c.isDisconnected && !c.isSpectating && !this.pandas.includes(c.address)
          ).length
        } alive`,
        priority: 0,
      });
    }

    if (client.isDisconnected) return;

    try {
      log(`Disconnecting (${reason})`, client.id, client.name);
      delete this.clientLookup[client.id];
      client.isDisconnected = true;
      client.isDead = true;
      client.joinedAt = 0;
      client.latency = 0;

      const oldSocket = this.sockets[client.id];
      setTimeout(
        () => {
          this.emitAll('onUserDisconnected', client.id);
          this.syncSprites();
          this.flushEventQueue();
          if (oldSocket && oldSocket.emit && oldSocket.connected) oldSocket.disconnect();
          delete this.sockets[client.id];
        },
        immediate ? 0 : 1000
      );
    } catch (e) {
      log('Error:', e);
    }
  }

  public async getUsername(address: string): Promise<string> {
    try {
      log(`Getting username for ${address}`);
      const response = await axios.get(`https://envoy.arken.gg/profile/${address}`);
      const { username = '' } = response.data;
      return username;
    } catch (error) {
      return ''; // Return an empty string or a default value if needed
    }
  }

  async setInfo({ msg }: Schema.SetInfoInput, { client }: ShardContext) {
    log('SetInfo', msg);

    const pack = decodePayload(msg);
    if (!pack.signature || !pack.network || !pack.device || !pack.address) {
      client.log.signinProblem += 1;
      this.disconnectClient(client, 'signin problem');
      return { status: 0 };
    }

    const address = await this.normalizeAddress(pack.address);
    log('SetInfo normalizeAddress', pack.address, address);
    if (!address) {
      client.log.addressProblem += 1;
      this.disconnectClient(client, 'address problem');
      return { status: 0 };
    }

    if (
      !(await this.auth(
        {
          data: 'evolution',
          signature: { hash: pack.signature.trim(), address },
        },
        { client }
      ))
    ) {
      client.log.signatureProblem += 1;
      this.disconnectClient(client, 'signature problem');
      return { status: 0 };
    }

    if (client.isBanned) {
      this.emit(client, 'onBanned', true);
      this.disconnectClient(client, 'banned');
      return { status: 0 };
    }

    if (this.config.isMaintenance && !client.isMod) {
      client.log.maintenanceJoin += 1;
      this.emit(client, 'onMaintenance', true);
      this.disconnectClient(client, 'maintenance');
      return { status: 0 };
    }

    let name = this.addressToUsername[address] || (await this.getUsername(address)) || this.generateGuestName();
    this.addressToUsername[address] = name;
    if (['Testman', 'join'].includes(name)) {
      client.overrideCameraSize = 12;
    }

    log('User ' + name + ' with address ' + address + ' with hash ' + client.hash);

    const now = getTime();
    if (client.name !== name || client.address !== address) {
      client.name = name;
      client.address = address;
      client.network = pack.network;
      client.device = pack.device;
      const recentClient = this.round.clients.find((r) => r.address === address);
      if (recentClient && now - recentClient.lastUpdate < 3000) {
        client.log.recentJoinProblem += 1;
        this.disconnectClient(client, 'joined too soon', true);
        return { status: 0 };
      }
      Object.assign(client, recentClient);
      client.log.connects += 1;
    }

    this.emitAll('onSetInfo', client.id, client.name, client.network, client.address, client.device);

    if (this.config.log.connections) {
      log('Connected', { hash: client.hash, address: client.address, name: client.name });
    }

    return { status: 1 };
  }

  // Method to compare clients by their points
  compareClients(a: ShardClient, b: ShardClient): number {
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
      const res = await this.realm.router.normalizeAddress.mutate({ address });
      log('normalizeAddressResponse', res);
      return res.address;
    } catch (e) {
      log('Error:', e);
      return false;
    }
  }

  // Method to verify if a signature request is valid
  async auth({ data, signature }: Schema.AuthInput, { client }: ShardContext) {
    log('Verifying', data);

    if (!signature.address) return { status: 0 };

    const res = await this.realm.router.auth.mutate({ data, signature });

    if (res.status !== 1) return { status: 0 };

    client.isSeer = res.groups.includes('seer');
    client.isAdmin = res.groups.includes('admin');
    client.isMod = res.groups.includes('mod');

    return { status: 1 };
  }

  // Method to format a number as a string with a sign
  formatNumber(num: number): string {
    return num >= 0 ? '+' + num : '-' + num;
  }

  // Method to calculate the speed of a client based on their config and base speed
  getClientSpeed(client: ShardClient): number {
    return this.normalizeFloat(
      this.config.baseSpeed * this.config['avatarSpeedMultiplier' + client.avatar!] * client.baseSpeed
    );
  }

  // Assume normalizeFloat is defined elsewhere in the class
  normalizeFloat(value: number, precision: number = 2): number {
    return parseFloat(value.toFixed(precision));
  }

  async join({ client }: ShardContext) {
    log('JoinShard', client.id, client.hash);

    try {
      const confirmUser = await this.realm.router.confirmUser.mutate({ address: client.address });

      if (confirmUser?.status !== 1) {
        client.log.failedRealmCheck += 1;
        this.disconnectClient(client, 'failed realm check');
        return { status: 0 };
      }

      if (confirmUser.isMod) {
        client.isMod = true;
      }

      const now = getTime();
      const recentClient = this.round.clients.find((r) => r.address === client.address);

      if (recentClient && now - recentClient.lastUpdate < 3000) {
        client.log.connectedTooSoon += 1;
        this.disconnectClient(client, 'connected too soon');
        return { status: 0 };
      }

      if (this.config.isMaintenance && !client.isMod) {
        this.emit(client, 'onMaintenance', true);
        this.disconnectClient(client, 'maintenance');
        return { status: 0 };
      }

      client.isJoining = true;
      client.avatar = this.config.startAvatar;
      client.speed = this.getClientSpeed(client);

      if (this.config.gameMode === 'Pandamonium' && this.pandas.includes(client.address)) {
        client.avatar = 2;
        this.emit(client, 'onUpdateEvolution', client.id, client.avatar, client.speed);
      }

      log('[INFO] client ' + client.id + ': logged!');
      log('[INFO] Total clients: ' + Object.keys(this.clientLookup).length);

      const roundTimer = this.round.startedAt + this.config.roundLoopSeconds - Math.round(getTime() / 1000);
      this.emit(
        client,
        'onSetPositionMonitor',
        `${Math.round(this.config.checkPositionDistance)}:${Math.round(this.config.checkInterval)}:${Math.round(
          this.config.resetInterval
        )}`
      );
      this.emit(
        client,
        'onJoinGame',
        client.id,
        client.name,
        client.avatar,
        client.isMasterClient ? 'true' : 'false',
        roundTimer,
        client.position.x,
        client.position.y
      );

      if (!this.realm) {
        this.emit(client, 'onBroadcast', `Realm not connected. Contact support.`, 0);
        this.disconnectClient(client, 'realm not connected');
        return { status: 0 };
      }

      if (!this.config.isRoundPaused) {
        this.emit(
          client,
          'onSetRoundInfo',
          `${roundTimer}:${this.getRoundInfo().join(':')}:${this.getGameModeGuide().join(':')}`
        );
        this.emit(client, 'onBroadcast', `Game Mode - ${this.config.gameMode} (Round ${this.config.roundId})`, 0);
      }

      this.syncSprites();

      if (this.config.hideMap) {
        this.emit(client, 'onHideMinimap');
        this.emit(client, 'onBroadcast', `Minimap hidden in this mode!`, 2);
      }

      if (this.config.level2open) {
        this.emit(client, 'onOpenLevel2');
        this.emit(client, 'onBroadcast', `Wall going down!`, 0);
      } else {
        this.emit(client, 'onCloseLevel2');
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

        this.emit(
          client,
          'onSpawnClient',
          otherClient.id,
          otherClient.name,
          otherClient.speed,
          otherClient.avatar,
          otherClient.position.x,
          otherClient.position.y,
          otherClient.position.x,
          otherClient.position.y
        );
      }

      for (const powerup of this.powerups) {
        this.emit(
          client,
          'onSpawnPowerUp',
          powerup.id,
          powerup.type,
          powerup.position.x,
          powerup.position.y,
          powerup.scale
        );
      }

      for (const orb of this.orbs) {
        this.emit(client, 'onSpawnPowerUp', orb.id, orb.type, orb.position.x, orb.position.y, orb.scale);
      }

      if (this.currentReward) {
        this.emit(
          client,
          'onSpawnReward',
          this.currentReward.id,
          this.currentReward.rewardItemType,
          this.currentReward.rewardItemName,
          this.currentReward.quantity,
          this.currentReward.position.x,
          this.currentReward.position.y
        );
      }

      client.lastUpdate = getTime();
      return { status: 1 };
    } catch (e) {
      log('Error:', e);
      this.disconnectClient(client, 'not sure: ' + e);
      return { status: 0 };
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
              } else {
                stuck = true;
              }
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
          client.phasedUntil = this.getTime() + 5000;
          client.phasedPosition = client.phasedPosition || position;
          client.log.phases += 1;
          client.log.collided += 1;
          client.overrideSpeed = 0.02;
          client.overrideSpeedUntil = this.getTime() + 1000;
        } else if (stuck && !isClientInvincible) {
          client.position = position;
          client.target = client.clientTarget;
          client.phasedUntil = this.getTime() + 5000;
          client.log.phases += 1;
          client.log.stuck += 1;
          client.overrideSpeed = 0.02;
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

      if (this.config.level2allowed) {
        if (
          this.config.level2forced ||
          this.clients.filter((c) => !c.isSpectating && !c.isDead).length >= this.config.clientsRequiredForLevel2
        ) {
          if (!this.config.level2open) {
            this.config.level2open = true;
            this.emitAll.onBroadcast.mutate({ message: `Wall going down...`, priority: 0 });

            setTimeout(() => {
              this.config.spritesStartCount = 200;
              this.clearSprites();
              this.spawnSprites(this.config.spritesStartCount);
            }, 2000);

            this.emitAll('onOpenLevel2');
          }
        }

        if (
          !this.config.level2forced &&
          this.clients.filter((c) => !c.isSpectating && !c.isDead).length < this.config.clientsRequiredForLevel2 - 7
        ) {
          if (this.config.level2open) {
            this.config.level2open = false;

            this.emitAll.onBroadcast.mutate({ message: `Wall going up...`, priority: 0 });

            this.config.spritesStartCount = 50;
            this.clearSprites();
            this.spawnSprites(this.config.spritesStartCount);

            setTimeout(() => {
              for (const client of this.clients) {
                this.resetClient(client);
              }
            }, 2000);

            this.emitAll('onCloseLevel2');
          }
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
              this.registerKill(this.app, client1, client2);
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

              if (client.character.meta[1117] > 0) {
                client.xp += (value * this.config.spriteXpMultiplier * client.character.meta[1117]) / 100;
              }

              this.emitAll('onUpdatePickup', client.id, powerup.id, value);

              this.removeSprite(powerup.id);
              this.spawnSprites(1);
            }
          }

          if (!client.isInvincible) {
            for (const orb of this.orbs) {
              if (now < orb.enabledAt) continue;
              if (this.distanceBetweenPoints(client.position, orb.position) > touchDistance) continue;

              client.orbs += 1;
              client.points += orb.points;
              client.points += this.config.pointsPerOrb;

              this.emitAll('onUpdatePickup', client.id, orb.id, 0);
              this.removeOrb(orb.id);

              this.emitAll.onBroadcast.mutate({ message: `${client.name} stole an orb (${orb.points})`, priority: 0 });
            }

            if (this.currentReward && now >= this.currentReward.enabledAt) {
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

  public async claimReward(client: ShardClient, reward: Reward): Promise<void> {
    if (!reward) return;

    if (this.config.anticheat.sameClientCantClaimRewardTwiceInRow && this.lastReward?.winner === client.name) return;

    // const claimRewardRes = await rsCall('GS_ClaimRewardRequest', { reward, client }) as any

    // if (claimRewardRes.status !== 1) {
    //   this.emit.onBroadcast.mutate({message:`Problem claiming reward. Contact support.`, priority: 3});
    //   return;
    // }

    reward.winner = client.name;

    this.emitAll('onUpdateReward', client.id, reward.id);

    client.rewards += 1;
    client.points += this.config.pointsPerReward;
    client.pickups.push(reward);

    if (this.isMechanicEnabled({ id: 1164 }, { client }) && client.character.meta[1164] > 0) {
      const r = this.random(1, 100);
      if (r <= client.character.meta[1164]) {
        client.pickups.push(reward);
        this.emitAll.onBroadcast.mutate({ message: `${client.name} got a double pickup!`, priority: 0 });
      }
    }

    this.lastReward = reward;
    this.currentReward = null;
  }

  async updateMyself({ msg }: Schema.UpdateMyselfInput, { client }: ShardContext) {
    if (client.isDead && !client.isJoining) return { status: 0 };
    if (client.isSpectating) return { status: 0 };
    if (this.config.isMaintenance && !client.isMod) {
      this.emit(client, 'onMaintenance', true);
      this.disconnectClient(client, 'maintenance');
      return { status: 0 };
    }

    const now = getTime();
    if (now - client.lastUpdate < this.config.forcedLatency) return { status: 0 };
    if (client.name === 'Testman' && now - client.lastUpdate < 200) return { status: 0 };

    if (client.isJoining) {
      client.isDead = false;
      client.isJoining = false;
      client.joinedAt = Math.round(getTime() / 1000);
      client.invincibleUntil = client.joinedAt + this.config.immunitySeconds;

      if (this.config.isBattleRoyale) {
        this.emit(client, 'onBroadcast', 'Spectate until the round is over', 0);

        return this.spectate({}, { client });
      }

      this.addToRecentClients(client);
      this.emitAll(
        'onSpawnClient',
        client.id,
        client.name,
        client.overrideSpeed || client.speed,
        client.avatar,
        client.position.x,
        client.position.y,
        client.position.x,
        client.position.y
      );

      if (this.config.isRoundPaused) {
        this.emit(client, 'onRoundPaused');
        return { status: 0 };
      }
    }

    try {
      const pack = decodePayload(input.msg);
      const positionX = parseFloat(parseFloat(pack.position.split(':')[0].replace(',', '.')).toFixed(3));
      const positionY = parseFloat(parseFloat(pack.position.split(':')[1].replace(',', '.')).toFixed(3));
      const targetX = parseFloat(parseFloat(pack.target.split(':')[0].replace(',', '.')).toFixed(3));
      const targetY = parseFloat(parseFloat(pack.target.split(':')[1].replace(',', '.')).toFixed(3));

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
        return { status: 0 };

      if (
        this.config.anticheat.disconnectPositionJumps &&
        this.distanceBetweenPoints(client.position, { x: positionX, y: positionY }) > 5
      ) {
        client.log.positionJump += 1;
        this.disconnectClient(client, 'position jumped');
        return { status: 0 };
      }

      client.clientPosition = { x: this.normalizeFloat(positionX, 4), y: this.normalizeFloat(positionY, 4) };
      client.clientTarget = { x: this.normalizeFloat(targetX, 4), y: this.normalizeFloat(targetY, 4) };
      client.lastReportedTime = client.name === 'Testman' ? parseFloat(pack.time) - 300 : parseFloat(pack.time);
      client.lastUpdate = now;
      return { status: 1 };
    } catch (e) {
      log('Error:', e);
      return { status: 0, error: e.message };
    }
  }

  async restart(input: Schema.RestartInput, ctx: ShardContext) {
    this.emitAll.onBroadcast.mutate({ message: `Server is rebooting in 10 seconds`, priority: 3 });
    await sleep(10 * 1000);
    process.exit(1);
    return { status: 1 };
  }

  async maintenance(input: Schema.MaintenanceInput, ctx: ShardContext) {
    this.sharedConfig.isMaintenance = true;
    this.config.isMaintenance = true;
    this.emitAll('onMaintenance', this.config.isMaintenance);
    return { status: 1 };
  }

  async unmaintenance(input: Schema.UnmaintenanceInput, ctx: ShardContext) {
    this.sharedConfig.isMaintenance = false;
    this.config.isMaintenance = false;
    this.emitAll('onUnmaintenance', this.config.isMaintenance);
    return { status: 1 };
  }

  async startBattleRoyale(input: Schema.StartBattleRoyaleInput, ctx: ShardContext) {
    this.emitAll.onBroadcast.mutate({ message: `Battle Royale in 3...`, priority: 1 });
    await sleep(1 * 1000);
    this.emitAll.onBroadcast.mutate({ message: `Battle Royale in 2...`, priority: 1 });
    await sleep(1 * 1000);
    this.emitAll.onBroadcast.mutate({ message: `Battle Royale in 1...`, priority: 1 });
    await sleep(1 * 1000);
    this.baseConfig.isBattleRoyale = true;
    this.config.isBattleRoyale = true;
    this.baseConfig.isGodParty = false;
    this.config.isGodParty = false;
    this.emitAll.onBroadcast.mutate({ message: `Battle Royale Started`, priority: 3 });
    this.emitAll.onBroadcast.mutate({ message: `God Party Stopped`, priority: 3 });
    return { status: 1 };
  }

  async stopBattleRoyale(input: Schema.StopBattleRoyaleInput, ctx: ShardContext) {
    this.baseConfig.isBattleRoyale = false;
    this.config.isBattleRoyale = false;
    this.emitAll.onBroadcast.mutate({ message: `Battle Royale Stopped`, priority: 0 });
    return { status: 1 };
  }

  async pauseRound(input: Schema.PauseRoundInput, ctx: ShardContext) {
    clearTimeout(this.roundLoopTimeout);
    this.baseConfig.isRoundPaused = true;
    this.config.isRoundPaused = true;
    this.emitAll('onRoundPaused');
    this.emitAll.onBroadcast.mutate({ message: `Round Paused`, priority: 0 });
    return { status: 1 };
  }

  async startRound(input: Schema.StartRoundInput, ctx: ShardContext) {
    clearTimeout(this.roundLoopTimeout);
    if (this.config.isRoundPaused) {
      this.baseConfig.isRoundPaused = false;
      this.config.isRoundPaused = false;
    }
    this.resetLeaderboard(presets.find((p) => p.gameMode === input.data.gameMode));
    return { status: 1 };
  }

  async enableForceLevel2(input: Schema.EnableForceLevel2Input, ctx: ShardContext) {
    this.baseConfig.level2forced = true;
    this.config.level2forced = true;
    return { status: 1 };
  }

  async disableForceLevel2(input: Schema.DisableForceLevel2Input, ctx: ShardContext) {
    this.baseConfig.level2forced = false;
    this.config.level2forced = false;
    return { status: 1 };
  }

  async startGodParty(input: Schema.StartGodPartyInput, ctx: ShardContext) {
    this.baseConfig.isGodParty = true;
    this.config.isGodParty = true;
    this.emitAll.onBroadcast.mutate({ message: `God Party Started`, priority: 0 });
    return { status: 1 };
  }

  async stopGodParty(input: Schema.StopGodPartyInput, ctx: ShardContext) {
    this.baseConfig.isGodParty = false;
    this.config.isGodParty = false;
    for (const client of this.clients) {
      client.isInvincible = false;
    }
    this.emitAll.onBroadcast.mutate({ message: `God Party Stopped`, priority: 2 });
    return { status: 1 };
  }

  async startRoyale(input: Schema.StartBattleRoyaleInput, ctx: ShardContext) {
    this.baseConfig.isRoyale = true;
    this.config.isRoyale = true;
    this.emitAll.onBroadcast.mutate({ message: `Royale Started`, priority: 0 });
    return { status: 1 };
  }

  async pauseRoyale(input: Schema.PauseRoundInput, ctx: ShardContext) {
    this.emitAll.onBroadcast.mutate({ message: `Royale Paused`, priority: 2 });
    return { status: 1 };
  }

  async unpauseRoyale(input: Schema.UnpauseRoyaleInput, ctx: ShardContext) {
    this.emitAll.onBroadcast.mutate({ message: `Royale Unpaused`, priority: 2 });
    return { status: 1 };
  }

  async stopRoyale(input: Schema.StopBattleRoyaleInput, ctx: ShardContext) {
    this.baseConfig.isRoyale = false;
    this.config.isRoyale = false;
    this.emitAll.onBroadcast.mutate({ message: `Royale Stopped`, priority: 2 });
    return { status: 1 };
  }

  async makeBattleHarder(input: Schema.MakeBattleHarderInput, ctx: ShardContext) {
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
    this.emitAll.onSetPositionMonitor.mutate(
      `${this.config.checkPositionDistance}:${this.config.checkInterval}:${this.config.resetInterval}`
    );
    this.emitAll.onBroadcast.mutate({ message: `Difficulty Increased!`, priority: 2 });
    return { status: 1 };
  }

  async makeBattleEasier(ctx: { client: ShardClient }, input: { signature: string }) {
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
    this.emitAll.onSetPositionMonitor.mutate(
      `${this.config.checkPositionDistance}:${this.config.checkInterval}:${this.config.resetInterval}`
    );
    this.emitAll.onBroadcast.mutate({ message: `Difficulty Decreased!`, priority: 0 });
    return { status: 1 };
  }

  async resetBattleDifficulty(ctx: { client: ShardClient }, input: { signature: string }) {
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
    this.emitAll.onSetPositionMonitor.mutate(
      `${this.config.checkPositionDistance}:${this.config.checkInterval}:${this.config.resetInterval}`
    );
    this.emitAll.onBroadcast.mutate({ message: `Difficulty Reset!`, priority: 0 });
    return { status: 1 };
  }

  async messageUser(ctx: { client: ShardClient }, input: { data: any; signature: string }) {
    const targetClient = this.clients.find((c) => c.address === input.data.target);
    if (!targetClient) return { status: 0 };
    this.sockets[targetClient.id].emitAll.onBroadcast.mutate({
      message: input.data.message.replace(/:/gi, ''),
      priority: 0,
    });
    return { status: 1 };
  }

  async changeUser(ctx: { client: ShardClient }, input: { data: any; signature: string }) {
    const newClient = this.clients.find((c) => c.address === input.data.target);
    if (!newClient) return { status: 0 };
    for (const key of Object.keys(input.data.this.app.config)) {
      const value = input.data.this.app.config[key];
      const val = value === 'true' ? true : value === 'false' ? false : isNumeric(value) ? parseFloat(value) : value;
      if (client.hasOwnProperty(key)) (newClient as any)[key] = val;
      else throw new Error("User doesn't have that option");
    }
    return { status: 1 };
  }

  async broadcast(ctx: { client: ShardClient }, input: { data: any; signature: string }) {
    this.emitAll.onBroadcast.mutate(input.data.message.replace(/:/gi, ''), 0);
    return { status: 1 };
  }

  async kickClient(ctx: { client: ShardClient }, input: { data: any; signature: string }) {
    const targetClient = this.clients.find((c) => c.address === input.data.target);
    if (!targetClient) return { status: 0 };
    this.disconnectClient(targetClient, 'kicked');
    return { status: 1 };
  }

  async info(ctx: { client: ShardClient }, input: any) {
    return {
      status: 1,
      data: {
        id: this.config.id,
        version: this.serverVersion,
        port: this.state.spawnPort,
        round: { id: this.config.roundId, startedAt: this.round.startedAt },
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
      },
    };
  }
}

export const createShardRouter = (gameWorld: Shard) => {
  return router({
    connected: procedure
      .use(hasRole('realm', t))
      .use(customErrorFormatter(t))
      .input(schema.connected)
      .mutation(({ input, ctx }) => gameWorld.connected(input as Schema.ConnectedInput, ctx)),

    apiConnected: procedure
      .use(hasRole('realm', t))
      .use(customErrorFormatter(t))
      .input(schema.apiConnected)
      .mutation(({ input, ctx }) => gameWorld.apiConnected(input as Schema.ApiConnectedInput, ctx)),

    apiDisconnected: procedure
      .use(hasRole('realm', t))
      .use(customErrorFormatter(t))
      .input(schema.apiDisconnected)
      .mutation(({ input, ctx }) => gameWorld.apiDisconnected(input as Schema.ApiDisconnectedInput, ctx)),

    setCharacter: procedure
      .use(hasRole('realm', t))
      .use(customErrorFormatter(t))
      .input(schema.setCharacter)
      .mutation(({ input, ctx }) => gameWorld.setCharacter(input as Schema.SetCharacterInput, ctx)),

    setConfig: procedure
      .use(hasRole('realm', t))
      .use(customErrorFormatter(t))
      .input(schema.setConfig)
      .mutation(({ input, ctx }) => gameWorld.setConfig(input as Schema.SetConfigInput, ctx)),

    getConfig: procedure
      .use(hasRole('realm', t))
      .use(customErrorFormatter(t))
      .input(schema.getConfig)
      .mutation(({ input, ctx }) => gameWorld.getConfig(input as Schema.GetConfigInput, ctx)),

    load: procedure
      .use(customErrorFormatter(t))
      .input(schema.load)
      .mutation(({ input, ctx }) => gameWorld.load(input as Schema.LoadInput, ctx)),

    spectate: procedure
      .use(customErrorFormatter(t))
      .input(schema.spectate)
      .mutation(({ input, ctx }) => gameWorld.spectate(input, ctx)),

    setInfo: procedure
      .use(customErrorFormatter(t))
      .input(schema.setInfo)
      .mutation(({ input, ctx }) => gameWorld.setInfo(input as Schema.SetInfoInput, ctx)),

    join: procedure
      .use(customErrorFormatter(t))
      .input(schema.join)
      .mutation(({ input, ctx }) => gameWorld.join(input as Schema.JoinInput, ctx)),

    updateMyself: procedure
      .use(customErrorFormatter(t))
      .input(schema.updateMyself)
      .mutation(({ input, ctx }) => gameWorld.updateMyself(input as Schema.UpdateMyselfInput, ctx)),

    restart: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.restart)
      .mutation(({ input, ctx }) => gameWorld.restart(input as Schema.RestartInput, ctx)),

    maintenance: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.maintenance)
      .mutation(({ input, ctx }) => gameWorld.maintenance(input as Schema.MaintenanceInput, ctx)),

    unmaintenance: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.unmaintenance)
      .mutation(({ input, ctx }) => gameWorld.unmaintenance(input as Schema.UnmaintenanceInput, ctx)),

    startBattleRoyale: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.startBattleRoyale)
      .mutation(({ input, ctx }) => gameWorld.startBattleRoyale(input as Schema.StartBattleRoyaleInput, ctx)),

    stopBattleRoyale: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.stopBattleRoyale)
      .mutation(({ input, ctx }) => gameWorld.stopBattleRoyale(input as Schema.StopBattleRoyaleInput, ctx)),

    pauseRound: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.pauseRound)
      .mutation(({ input, ctx }) => gameWorld.pauseRound(input as Schema.PauseRoundInput, ctx)),

    startRound: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.startRound)
      .mutation(({ input, ctx }) => gameWorld.startRound(input as Schema.StartRoundInput, ctx)),

    enableForceLevel2: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.enableForceLevel2)
      .mutation(({ input, ctx }) => gameWorld.enableForceLevel2(input as Schema.EnableForceLevel2Input, ctx)),

    disableForceLevel2: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.disableForceLevel2)
      .mutation(({ input, ctx }) => gameWorld.disableForceLevel2(input as Schema.DisableForceLevel2Input, ctx)),

    startGodParty: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.startGodParty)
      .mutation(({ input, ctx }) => gameWorld.startGodParty(input as Schema.StartGodPartyInput, ctx)),

    stopGodParty: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.stopGodParty)
      .mutation(({ input, ctx }) => gameWorld.stopGodParty(input as Schema.StopGodPartyInput, ctx)),

    startRoyale: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.startRoyale)
      .mutation(({ input, ctx }) => gameWorld.startRoyale(input as Schema.StartRoyaleInput, ctx)),

    pauseRoyale: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.pauseRoyale)
      .mutation(({ input, ctx }) => gameWorld.pauseRoyale(input as Schema.PauseRoyaleInput, ctx)),

    unpauseRoyale: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.unpauseRoyale)
      .mutation(({ input, ctx }) => gameWorld.unpauseRoyale(input as Schema.UnpauseRoyaleInput, ctx)),

    stopRoyale: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.stopRoyale)
      .mutation(({ input, ctx }) => gameWorld.stopRoyale(input as Schema.StopRoyaleInput, ctx)),

    makeBattleHarder: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.makeBattleHarder)
      .mutation(({ input, ctx }) => gameWorld.makeBattleHarder(input as Schema.MakeBattleHarderInput, ctx)),

    makeBattleEasier: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.makeBattleEasier)
      .mutation(({ input, ctx }) => gameWorld.makeBattleEasier(input as Schema.MakeBattleEasierInput, ctx)),

    resetBattleDifficulty: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.resetBattleDifficulty)
      .mutation(({ input, ctx }) => gameWorld.resetBattleDifficulty(input as Schema.ResetBattleDifficultyInput, ctx)),

    messageUser: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.messageUser)
      .mutation(({ input, ctx }) => gameWorld.messageUser(input as Schema.MessageUserInput, ctx)),

    changeUser: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.changeUser)
      .mutation(({ input, ctx }) => gameWorld.changeUser(input as Schema.ChangeUserInput, ctx)),

    broadcast: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.broadcast)
      .mutation(({ input, ctx }) => gameWorld.broadcast(input as Schema.BroadcastInput, ctx)),

    kickClient: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.kickClient)
      .mutation(({ input, ctx }) => gameWorld.kickClient(input as Schema.KickClientInput, ctx)),

    info: procedure
      .use(hasRole('mod', t))
      .use(customErrorFormatter(t))
      .input(schema.info)
      .mutation(({ input, ctx }) => gameWorld.info(input, ctx)),
  });
};

export type Router = typeof createShardRouter;

export async function init(app) {
  try {
    const gameWorld = new Shard(this.app);

    log('Starting event handler');
    this.app.io.on('connection', function (socket) {
      try {
        log('Connection', socket.id);

        const hash = ipHashFromSocket(socket);
        const spawnPoint = gameWorld.clientSpawnPoints[Math.floor(Math.random() * gameWorld.clientSpawnPoints.length)];
        const client: ShardClient = {
          name: 'Unknown' + Math.floor(Math.random() * 999),
          startedRoundAt: null,
          lastTouchClientId: null,
          lastTouchTime: null,
          id: socket.id,
          avatar: null,
          network: null,
          address: null,
          device: null,
          position: spawnPoint,
          target: spawnPoint,
          clientPosition: spawnPoint,
          clientTarget: spawnPoint,
          phasedPosition: undefined,
          socket, // TODO: might be a problem
          rotation: null,
          xp: 50,
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
          pickups: [],
          isSeer: false,
          isAdmin: false,
          isMod: false,
          isBanned: false,
          isMasterClient: false,
          isDisconnected: false,
          isDead: true,
          isJoining: false,
          isSpectating: false,
          isStuck: false,
          isGod: false,
          isRealm: false,
          isGuest: false,
          isInvincible: gameWorld.config.isGodParty ? true : false,
          isPhased: false,
          overrideSpeed: null as any,
          overrideCameraSize: null as any,
          cameraSize: gameWorld.config.cameraSize,
          speed: gameWorld.config.baseSpeed * gameWorld.config.avatarSpeedMultiplier0,
          joinedAt: 0,
          invincibleUntil: 0,
          decayPower: 1,
          hash: ipHashFromSocket(socket),
          lastReportedTime: getTime(),
          lastUpdate: 0,
          gameMode: this.app.config.gameMode,
          phasedUntil: getTime(),
          overrideSpeedUntil: 0,
          joinedRoundAt: getTime(),
          baseSpeed: 1,
          character: {
            meta: {
              [Mechanic.MovementBurstStrength]: 0,
              [Mechanic.AvoidDeathPenalty]: 0,
              [Mechanic.EnergyDecay]: 0,
              [Mechanic.RewardsIncrease]: 0,
              [Mechanic.RewardsDecrease]: 0,
              [Mechanic.MovementBurstOnKill]: 0,
              [Mechanic.MovementBurstOnEvolve]: 0,
              [Mechanic.DoublePickupChance]: 0,
              [Mechanic.IncreasedHealthOnKill]: 0,
              [Mechanic.SpriteFuel]: 0,
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

        if (!testMode && this.app.killSameNetworkClients) {
          const sameNetworkClient = this.app.clients.find((r) => r.hash === client.hash && r.id !== client.id);
          if (sameNetworkClient) {
            client.log.sameNetworkDisconnect += 1;
            gameWorld.disconnectClient(client, 'same network');
            return;
          }
        }
        gameWorld.sockets[client.id] = socket;
        gameWorld.clientLookup[client.id] = client;
        if (Object.keys(gameWorld.clientLookup).length == 1) {
          client.isMasterClient = true;
        }
        gameWorld.clients = gameWorld.clients.filter((c) => c.hash !== client.hash);
        gameWorld.clients.push(client);

        const router = createShardRouter(gameWorld);

        const ctx = { client };

        socket.on('trpc', async (message) => {
          const { id, method, params } = message;
          try {
            const createCaller = t.createCallerFactory(router);
            const caller = createCaller(ctx);
            const result = await caller[method](params);

            socket.emitAll('trpcResponse', { id, result });
          } catch (error) {
            console.log('user connection error', id, error.message);
            socket.emitAll('trpcResponse', { id, error: error.message });
          }
        });

        socket.on('disconnect', function () {
          log('User has disconnected');
          client.log.clientDisconnected += 1;
          gameWorld.disconnectClient(client, 'client disconnected');
          if (client.isRealm) {
            gameWorld.emitAll.onBroadcast.mutate({ message: `Realm disconnected`, priority: 0 });
          }
        });
      } catch (e) {
        console.log('initEventHandler error', e);
      }
    });
  } catch (e) {
    log('init game world failed', e);
  }
}

export default { init };
