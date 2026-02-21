// evolution/packages/shard/src/shard.service.ts
//
import { httpBatchLink, createTRPCProxyClient, loggerLink, TRPCClientError } from '@trpc/client';
import { generateShortId } from '@arken/node/db';
import * as util from '@arken/node/util';
import * as SeerProtocol from '@arken/seer-protocol';
import { createCallerFactory, createRouter as createShardRouter } from '@arken/evolution-protocol/shard/shard.router';
import type { ShardClientRouter, Realm } from '@arken/evolution-protocol/types';
import type { Orb, Boundary, Reward, PowerUp, Round, Preset, Event } from '@arken/evolution-protocol/shard/shard.types';
import { Position } from '@arken/evolution-protocol/shard/shard.types';
import { log } from '@arken/node/log';
import type * as Shard from '@arken/evolution-protocol/shard/shard.types';
import { CoreService } from './services/core.service';
import { AuthService } from './services/auth.service';
import { ClientService } from './services/client.service';
import { SystemService } from './services/system.service';
import { ModService } from './services/mod.service';
import { GameloopService } from './services/gameloop.service';
import { InteractionsService } from './services/interactions.service';

const { getTime, shuffleArray, randomPosition, sha256, isNumeric, ipHashFromSocket } = util;

const safeLogValue = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const safeGet = (record: Record<string, unknown>, key: string): unknown => {
  try {
    return record[key];
  } catch {
    return undefined;
  }
};

const normalizeTrpcId = (id: unknown): string | number | null => {
  if (typeof id === 'string') {
    return id;
  }

  if (typeof id === 'number' && Number.isFinite(id)) {
    return id;
  }

  return null;
};

const safeErrorString = (error: unknown): string => {
  if (error && typeof error === 'object') {
    try {
      const stack = (error as { stack?: unknown }).stack;
      if (typeof stack === 'string' && stack) {
        return stack;
      }
    } catch {
      // fall through to String coercion
    }
  }

  try {
    return String(error);
  } catch {
    return '[unstringifiable-error]';
  }
};

type ServiceHelpers = {
  core: CoreService;
  auth: AuthService;
  system: SystemService;
  client: ClientService;
  mod: ModService;
  gameloop: GameloopService;
  interactions: InteractionsService;
};

export class Service implements Shard.Service {
  services: ServiceHelpers;

  io: any;
  state: any;
  zones: any;
  realm: any; //ReturnType<typeof createClient>;
  master: any;
  guestNames: string[];
  serverVersion: string;
  roundLoopTimeout?: NodeJS.Timeout;
  addressToProfile: Record<string, SeerProtocol.Profile.Types.Profile>;
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

    this.services = {
      core: new CoreService(this),
      auth: new AuthService(this),
      system: new SystemService(this),
      client: new ClientService(this),
      gameloop: new GameloopService(this),
      mod: new ModService(this),
      interactions: new InteractionsService(this),
    };
  }

  init() {
    console.log('Evolution.Shard.Service.init');
    this.router = createShardRouter(this as Shard.Service);

    this.services.core.init();
    this.services.auth.init();
    this.services.system.init();
    this.services.client.init();
    this.services.gameloop.init();
    this.services.mod.init();
    this.services.interactions.init();
  }

  async onPlayerUpdates(
    input: Shard.RouterInput['onPlayerUpdates'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['onPlayerUpdates']> {
    log('onPlayerUpdates', input);
    return { status: 1 } as Shard.RouterOutput['onPlayerUpdates'];
  }

  async heartbeat(
    input: Shard.RouterInput['heartbeat'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['heartbeat']> {
    return this.services.core.heartbeat(input, ctx);
  }

  async initRealm(
    input: Shard.RouterInput['initRealm'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['initRealm']> {
    return this.services.core.initRealm(input, ctx);
  }

  async kickClient(
    input: Shard.RouterInput['kickClient'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['kickClient']> {
    return this.services.mod.kickClient(input, ctx);
  }

  async broadcast(
    input: Shard.RouterInput['broadcast'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['broadcast']> {
    return this.services.mod.broadcast(input, ctx);
  }

  async changeUser(
    input: Shard.RouterInput['changeUser'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['changeUser']> {
    return this.services.mod.changeUser(input, ctx);
  }

  async messageUser(
    input: Shard.RouterInput['messageUser'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['messageUser']> {
    return this.services.mod.messageUser(input, ctx);
  }

  async resetBattleDifficulty(
    input: Shard.RouterInput['resetBattleDifficulty'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['resetBattleDifficulty']> {
    return this.services.mod.resetBattleDifficulty(input, ctx);
  }

  async makeBattleEasier(
    input: Shard.RouterInput['makeBattleEasier'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['makeBattleEasier']> {
    return this.services.mod.makeBattleEasier(input, ctx);
  }

  async makeBattleHarder(
    input: Shard.RouterInput['makeBattleHarder'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['makeBattleHarder']> {
    return this.services.mod.makeBattleHarder(input, ctx);
  }

  async unpauseRoyale(
    input: Shard.RouterInput['unpauseRoyale'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['unpauseRoyale']> {
    return this.services.mod.unpauseRoyale(input, ctx);
  }

  async pauseRoyale(
    input: Shard.RouterInput['pauseRoyale'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['pauseRoyale']> {
    return this.services.mod.pauseRoyale(input, ctx);
  }

  async stopRoyale(
    input: Shard.RouterInput['stopRoyale'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['stopRoyale']> {
    return this.services.mod.stopRoyale(input, ctx);
  }

  async startRoyale(
    input: Shard.RouterInput['startRoyale'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['startRoyale']> {
    return this.services.mod.startRoyale(input, ctx);
  }

  async startGodParty(
    input: Shard.RouterInput['startGodParty'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['startGodParty']> {
    return this.services.mod.startGodParty(input, ctx);
  }

  async stopGodParty(
    input: Shard.RouterInput['stopGodParty'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['stopGodParty']> {
    return this.services.mod.stopGodParty(input, ctx);
  }

  async disableForceLevel2(
    input: Shard.RouterInput['disableForceLevel2'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['disableForceLevel2']> {
    return this.services.mod.disableForceLevel2(input, ctx);
  }

  async enableForceLevel2(
    input: Shard.RouterInput['enableForceLevel2'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['enableForceLevel2']> {
    return this.services.mod.enableForceLevel2(input, ctx);
  }

  async startRound(
    input: Shard.RouterInput['startRound'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['startRound']> {
    return this.services.mod.startRound(input, ctx);
  }

  async pauseRound(
    input: Shard.RouterInput['pauseRound'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['pauseRound']> {
    return this.services.mod.pauseRound(input, ctx);
  }

  async stopBattleRoyale(
    input: Shard.RouterInput['stopBattleRoyale'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['stopBattleRoyale']> {
    return this.services.mod.stopBattleRoyale(input, ctx);
  }

  async startBattleRoyale(
    input: Shard.RouterInput['startBattleRoyale'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['startBattleRoyale']> {
    return this.services.mod.startBattleRoyale(input, ctx);
  }

  async unmaintenance(
    input: Shard.RouterInput['unmaintenance'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['unmaintenance']> {
    return this.services.mod.unmaintenance(input, ctx);
  }

  async maintenance(
    input: Shard.RouterInput['maintenance'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['maintenance']> {
    return this.services.mod.maintenance(input, ctx);
  }

  async restart(
    input: Shard.RouterInput['restart'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['restart']> {
    return this.services.mod.restart(input, ctx);
  }

  async broadcastMechanics(
    input: Shard.RouterInput['broadcastMechanics'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['broadcastMechanics']> {
    return this.services.gameloop.broadcastMechanics(input, ctx);
  }

  async join(input: Shard.RouterInput['join'], ctx: Shard.ServiceContext): Promise<Shard.RouterOutput['join']> {
    return this.services.client.join(input, ctx);
  }

  async spectate(
    input: Shard.RouterInput['spectate'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['spectate']> {
    return this.services.client.spectate(input, ctx);
  }

  async load(input: Shard.RouterInput['load'], ctx: Shard.ServiceContext): Promise<Shard.RouterOutput['load']> {
    return this.services.client.load(input, ctx);
  }

  async getConfig(
    input: Shard.RouterInput['getConfig'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['getConfig']> {
    return this.services.auth.getConfig(input, ctx);
  }

  async setConfig(
    input: Shard.RouterInput['setConfig'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['setConfig']> {
    return this.services.auth.setConfig(input, ctx);
  }

  async setCharacter(
    input: Shard.RouterInput['setCharacter'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['setCharacter']> {
    return this.services.auth.setCharacter(input, ctx);
  }

  async action(input: Shard.RouterInput['action'], ctx: Shard.ServiceContext): Promise<Shard.RouterOutput['action']> {
    return this.services.client.action(input, ctx);
  }

  async updateMyself(
    input: Shard.RouterInput['updateMyself'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['updateMyself']> {
    return this.services.client.updateMyself(input, ctx);
  }

  async emote(input: Shard.RouterInput['emote'], ctx: Shard.ServiceContext): Promise<Shard.RouterOutput['emote']> {
    return this.services.client.emote(input, ctx);
  }

  async seerConnected(
    input: Shard.RouterInput['seerConnected'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['seerConnected']> {
    return this.services.auth.seerConnected(input, ctx);
  }

  async seerDisconnected(
    input: Shard.RouterInput['seerDisconnected'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['seerDisconnected']> {
    return this.services.auth.seerDisconnected(input, ctx);
  }

  async info(input: Shard.RouterInput['info'], ctx: Shard.ServiceContext): Promise<Shard.RouterOutput['info']> {
    return this.services.core.info(input, ctx);
  }

  async claimMaster(
    input: Shard.RouterInput['claimMaster'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['claimMaster']> {
    return this.services.core.claimMaster(input, ctx);
  }

  async auth(input: Shard.RouterInput['auth'], ctx: Shard.ServiceContext): Promise<Shard.RouterOutput['auth']> {
    return this.services.auth.auth(input, ctx);
  }

  async login(input: Shard.RouterInput['login'], ctx: Shard.ServiceContext): Promise<Shard.RouterOutput['login']> {
    return this.services.auth.login(input, ctx);
  }

  isMechanicEnabled(
    input: Shard.RouterInput['isMechanicEnabled'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['isMechanicEnabled']> {
    return this.services.gameloop.isMechanicEnabled(input, ctx);
  }

  async forceJoin(
    input: Shard.RouterInput['forceJoin'],
    ctx: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['forceJoin']> {
    return this.services.client.forceJoin(input, ctx);
  }

  // Method to calculate the speed of a client based on their config and base speed
  getClientSpeed(client: Shard.Client): number {
    return util.number.normalizeFloat(
      this.config.baseSpeed * this.config['avatarSpeedMultiplier' + client.avatar!] * client.baseSpeed
    );
  }

  // Method to normalize an address through an external service
  async normalizeAddress(address: string, ctx: Shard.ServiceContext): Promise<string | false> {
    if (!address) return false;
    try {
      // TODO: type check
      const res = await this.realm.emit.normalizeAddress.mutate(address);
      log('normalizeAddressResponse', res);
      return res;
    } catch (e) {
      log('Error:', e);
      return false;
    }
  }

  public getRoundInfo(): any[] {
    return Object.keys(this.sharedConfig)
      .sort()
      .reduce((obj, key) => {
        obj.push(this.config[key]);
        return obj;
      }, [] as any[]);
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
          this.services.gameloop.syncSprites();
          this.services.gameloop.flushEventQueue();
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

  disconnectAllClients(): void {
    if (this.clients.length === 0) return;

    log('Disconnecting all clients');

    for (const client of this.clients) {
      this.disconnectClient(client, 'disconnect all clients');
    }
  }

  async handleClientMessage(socket: any, message: any) {
    // log('Shard client trpc message', message);
    let pack: any;
    const emitResponse = (payload: any) => {
      if (typeof socket?.emit !== 'function') {
        return;
      }

      try {
        socket.emit('trpcResponse', payload);
      } catch (emitError) {
        log('Shard client trpc response emit error', emitError);
      }
    };

    try {
      let normalizedMessage = message;

      if (Buffer.isBuffer(normalizedMessage)) {
        normalizedMessage = normalizedMessage.toString('utf8');
      } else if (normalizedMessage instanceof Uint8Array) {
        normalizedMessage = Buffer.from(normalizedMessage).toString('utf8');
      } else if (normalizedMessage instanceof ArrayBuffer) {
        normalizedMessage = Buffer.from(normalizedMessage).toString('utf8');
      } else if (ArrayBuffer.isView(normalizedMessage)) {
        normalizedMessage = Buffer.from(
          normalizedMessage.buffer,
          normalizedMessage.byteOffset,
          normalizedMessage.byteLength
        ).toString('utf8');
      }

      if (typeof normalizedMessage === 'string') {
        const trimmedMessage = normalizedMessage.trim();
        const sanitizedMessage =
          trimmedMessage.charCodeAt(0) === 0xfeff ? trimmedMessage.slice(1).trimStart() : trimmedMessage;

        if (!sanitizedMessage) {
          throw new Error('Invalid trpc payload');
        }

        if (!sanitizedMessage.startsWith('{') && !sanitizedMessage.startsWith('[')) {
          throw new Error('Invalid trpc payload');
        }

        normalizedMessage = sanitizedMessage;
      }

      pack = typeof normalizedMessage === 'string' ? JSON.parse(normalizedMessage) : normalizedMessage;
      if (!pack || typeof pack !== 'object' || Array.isArray(pack)) {
        throw new Error('Invalid trpc payload');
      }

      // log('Shard client trpc pack', pack, socket.shardClient.id, socket.shardClient.id);
      const id = safeGet(pack, 'id');
      const method = safeGet(pack, 'method');
      const type = safeGet(pack, 'type');
      const params = safeGet(pack, 'params');
      const responseId = normalizeTrpcId(id);

      if (!method || typeof method !== 'string') {
        throw new Error('Invalid trpc method');
      }

      const normalizedMethod = method.trim();

      if (!normalizedMethod) {
        throw new Error('Invalid trpc method');
      }

      if (normalizedMethod === 'onEvents') return;

      const emitClient = socket?.shardClient?.emit;
      const hasOwnMethod =
        !!emitClient &&
        (Object.hasOwn
          ? Object.hasOwn(emitClient as Record<string, unknown>, normalizedMethod)
          : Object.prototype.hasOwnProperty.call(emitClient, normalizedMethod));
      const emitMethod = hasOwnMethod ? emitClient[normalizedMethod] : undefined;

      if (typeof emitMethod !== 'function') {
        throw new Error('Invalid trpc payload');
      }

      const isLoggableEvent = Array.isArray(this.loggableEvents) && this.loggableEvents.includes(normalizedMethod);

      if (isLoggableEvent)
        log(
          `Shard client trpc method: client.emit.${normalizedMethod}(${safeLogValue(params)})`,
          id,
          normalizedMethod,
          type,
          params
        );

      const result =
        typeof params === 'undefined'
          ? await emitMethod.call(emitClient)
          : await emitMethod.call(emitClient, params);

      if (isLoggableEvent) log('Shard client trpc method call result', result);

      emitResponse({ id: responseId, result });
    } catch (e: any) {
      log('Shard client trpc error', pack, e);

      const shardClient = socket?.shardClient;
      const shardClientLog = isRecord(shardClient?.log) ? shardClient.log : undefined;
      const previousErrors = Number(shardClientLog?.errors);

      if (shardClientLog) {
        shardClientLog.errors = Number.isFinite(previousErrors) ? previousErrors + 1 : 1;
      }

      if (typeof shardClientLog?.errors === 'number' && shardClientLog.errors > 50) {
        this.disconnectClient(shardClient, 'too many errors');
      } else {
        const errorResponseId = isRecord(pack) ? normalizeTrpcId(safeGet(pack, 'id')) : null;

        emitResponse({
          id: errorResponseId,
          result: {},
          error: safeErrorString(e),
        });
      }
    }
  }
}
