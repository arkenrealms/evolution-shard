// evolution/packages/shard/src/services/client.service.ts
//
import type * as Shard from '@arken/evolution-protocol/shard/shard.types';
import type { Service } from '../shard.service';
import * as util from '@arken/node/util';
import { log } from '@arken/node/log';
import type { PatchOp, EntityPatch } from '@arken/seer-protocol/types';

const { getTime } = util;

export class ClientService {
  constructor(private ctx: Service) {}

  init() {}

  async forceJoin(
    input: Shard.RouterInput['forceJoin'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['forceJoin']> {
    try {
      client.isSpectating = false;
      client.isInvincible = false;
      client.avatar = this.ctx.config.startAvatar;
      client.speed = this.ctx.getClientSpeed(client);
      client.overrideSpeed = null;
      client.cameraSize = this.ctx.config.cameraSize;
      client.overrideCameraSize = null;
      client.xp = 75;
      client.maxHp = 100;

      client.isDisconnected = false;
      client.isJoining = true;

      if (this.ctx.config.gameMode === 'Pandamonium' && this.ctx.pandas.includes(client.address)) {
        client.avatar = 2;
        this.ctx.emit.onUpdateEvolution.mutate([client.id, client.avatar, client.speed], { context: { client } });
      }

      log('[INFO] client ' + client.id + ': logged!');
      log('[INFO] Total clients: ' + Object.keys(this.ctx.clientLookup).length);

      const roundTimer = this.ctx.round.startedDate + this.ctx.config.roundLoopSeconds - Math.round(getTime() / 1000);
      this.ctx.emit.onSetPositionMonitor.mutate(
        [
          Math.round(this.ctx.config.checkPositionDistance),
          Math.round(this.ctx.config.checkInterval),
          Math.round(this.ctx.config.resetInterval),
        ],
        { context: { client } }
      );

      this.ctx.emit.onJoinGame.mutate(
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

      if (!this.ctx.realm) {
        this.ctx.emit.onBroadcast.mutate([`Realm not connected. Contact support.`, 0], { context: { client } });
        this.ctx.disconnectClient(client, 'realm not connected');
        throw new Error('Realm not connected');
      }

      if (!this.ctx.config.isRoundPaused) {
        this.ctx.emit.onSetRoundInfo.mutate(
          [roundTimer, this.ctx.getRoundInfo().join(':'), this.ctx.getGameModeGuide().join(':')],
          { context: { client } }
        );
        this.ctx.emit.onBroadcast.mutate([`Game Mode - ${this.ctx.config.gameMode}`, 0], {
          //  (Round ${this.ctx.round.id})
          context: { client },
        });
      }

      this.ctx.services.gameloop.syncSprites();

      if (this.ctx.config.hideMap) {
        this.ctx.emit.onHideMinimap.mutate([], { context: { client } });
        this.ctx.emit.onBroadcast.mutate([`Minimap hidden in this mode!`, 2], { context: { client } });
      }

      if (this.ctx.config.level2open) {
        this.ctx.emit.onOpenLevel2.mutate([], { context: { client } });
        this.ctx.emit.onBroadcast.mutate([`Wall going down!`, 0], { context: { client } });
      } else {
        this.ctx.emit.onCloseLevel2.mutate([], { context: { client } });
      }

      for (const otherClient of this.ctx.clients) {
        if (
          otherClient.id === client.id ||
          otherClient.isDisconnected ||
          otherClient.isDead ||
          otherClient.isSpectating ||
          otherClient.isJoining
        )
          continue;

        this.ctx.emit.onSpawnClient.mutate(
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

      for (const powerup of this.ctx.powerups) {
        this.ctx.emit.onSpawnPowerUp.mutate(
          [powerup.id, parseInt(powerup.type + ''), powerup.position.x, powerup.position.y, powerup.scale],
          { context: { client } }
        );
      }

      for (const orb of this.ctx.orbs) {
        this.ctx.emit.onSpawnPowerUp.mutate([orb.id, orb.type, orb.position.x, orb.position.y, orb.scale], {
          context: { client },
        });
      }

      if (this.ctx.currentReward) {
        this.ctx.emit.onSpawnReward.mutate(
          [
            this.ctx.currentReward.id,
            this.ctx.currentReward.rewardItemType,
            this.ctx.currentReward.rewardItemName,
            this.ctx.currentReward.quantity,
            this.ctx.currentReward.position.x,
            this.ctx.currentReward.position.y,
          ],
          { context: { client } }
        );
      }

      client.lastUpdate = getTime();
    } catch (e) {
      log('Error:', e);
      this.ctx.disconnectClient(client, 'not sure: ' + e);
      throw new Error('Not sure');
    }
  }

  async join(input: Shard.RouterInput['join'], { client }: Shard.ServiceContext): Promise<Shard.RouterOutput['join']> {
    log('join', client.id, client.hash);

    try {
      const now = getTime();
      const recentClient = this.ctx.round.clients.find((r) => r.address === client.address);

      if (recentClient && now - recentClient.lastUpdate < 3000) {
        client.log.connectedTooSoon += 1;
        this.ctx.disconnectClient(client, 'connected too soon');
        throw new Error('Connected too soon');
      }

      if (this.ctx.clients.filter((c) => !c.isSpectating).length > this.ctx.config.maxClients) {
        if (!this.ctx.queuedClients.find((c) => c.id === client.id)) {
          this.ctx.queuedClients.push(client);
        }

        this.ctx.spectate(null, { client });
      } else {
        this.ctx.forceJoin(null, { client });
      }
    } catch (e) {
      log('Error:', e);
      this.ctx.disconnectClient(client, 'not sure: ' + e);
      throw new Error('Not sure');
    }
  }

  async emote(...[input, { client }]: Parameters<Shard.Service['emote']>): ReturnType<Shard.Service['emote']> {
    if (!input) return this.throwError(client, 'Input should not be void');

    if (client.isDead && !client.isJoining) return;
    if (client.isSpectating) return;

    this.ctx.emitAll.onEmote.mutate([client.id, input]);
  }

  private canWrite(client: any, permission: string) {
    return !!client?.permissions?.[permission];
  }

  private pushCharacterOps(client: any, ops: PatchOp[]) {
    if (!ops?.length) return;
    if (!this.canWrite(client, 'character.data.write')) return;

    client.ops ??= [];

    const patch: EntityPatch = {
      entityType: 'character',
      entityId: client.character?.id,
      baseVersion: client.character?.version,
      ops,
    };

    client.ops.push(patch);

    // optimistic local cache update (since meta is your fast state)
    client.character ??= {};
    client.character.meta ??= {};
    for (const op of ops) {
      if (op.op === 'set') client.character.meta[op.key] = op.value;
      if (op.op === 'unset') delete client.character.meta[op.key];
      if (op.op === 'inc') client.character.meta[op.key] = (Number(client.character.meta[op.key] ?? 0) || 0) + op.value;
      // (push/merge optional for meta cache; you can ignore unless needed)
    }
  }

  async action(
    input: Shard.RouterInput['action'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['action']> {
    if (!input) return this.throwError(client, 'Input should not be void');

    if (client.isDead && !client.isJoining) return;
    if (client.isSpectating) return;

    this.ctx.emitAll.onAction.mutate([client.id, input]);
  }

  throwError(client: any, text: string) {
    client.log.errors += 1;

    throw new Error(text);
  }

  async updateMyself(
    ...[input, { client }]: Parameters<Shard.Service['updateMyself']>
  ): ReturnType<Shard.Service['updateMyself']> {
    if (!input) return this.throwError(client, 'Input should not be void');

    if (client.isSpectating) {
      return;
      // client.log.errors += 1;
      // throw new Error('Invalid at this time');
    }
    if (client.isDead && !client.isJoining) {
      return;
      // client.log.errors += 1;
      // throw new Error('Invalid at this time');
    }
    if (this.ctx.config.isMaintenance && !client.isMod) {
      this.ctx.emit.onMaintenance.mutate([true], { context: { client } });
      this.ctx.disconnectClient(client, 'maintenance');
      // throw new Error('Invalid at this time');
      return;
    }

    const now = getTime();
    if (now - client.lastUpdate < this.ctx.config.forcedLatency) return;
    if (client.name === 'Testman' && now - client.lastUpdate < 200) return;

    if (client.isJoining) {
      client.isDead = false;
      client.isJoining = false;
      client.joinedAt = Math.round(getTime() / 1000);
      client.invincibleUntil = client.joinedAt + this.ctx.config.immunitySeconds;

      if (this.ctx.config.isBattleRoyale) {
        this.ctx.emit.onBroadcast.mutate(['Spectate until the round is over', 0], { context: { client } });

        this.ctx.spectate(null, { client });
        return;
      }

      this.ctx.services.core.addToRecentClients(client);
      this.ctx.emitAll.onSpawnClient.mutate([
        client.id,
        client.name,
        client.overrideSpeed || client.speed,
        client.avatar,
        client.position.x,
        client.position.y,
        client.position.x,
        client.position.y,
      ]);

      if (this.ctx.config.isRoundPaused) {
        this.ctx.emit.onRoundPaused.mutate(null, { context: { client } });
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
      positionX < this.ctx.mapBoundary.x.min ||
      positionX > this.ctx.mapBoundary.x.max ||
      positionY < this.ctx.mapBoundary.y.min ||
      positionY > this.ctx.mapBoundary.y.max
    )
      return;

    if (
      this.ctx.config.anticheat.disconnectPositionJumps &&
      util.physics.distanceBetweenPoints(client.position, { x: positionX, y: positionY }) > 5
    ) {
      client.log.positionJump += 1;
      this.ctx.disconnectClient(client, 'position jumped');
      return;
    }

    client.clientPosition = {
      x: util.number.normalizeFloat(positionX, 4),
      y: util.number.normalizeFloat(positionY, 4),
    };
    client.clientTarget = { x: util.number.normalizeFloat(targetX, 4), y: util.number.normalizeFloat(targetY, 4) };
    client.lastReportedTime = client.name === 'Testman' ? parseFloat(input.time) - 300 : parseFloat(input.time);
    client.lastUpdate = now;

    const modifiers = {
      Luck: {
        id: '111',
      },
    };

    // Touch the tusk for good luck
    if (util.physics.distanceBetweenPoints(client.position, this.ctx.currentZone.objects.ElonTusk) < 1) {
      if (!this.ctx.currentZone.modifiers[modifiers.Luck.id] || this.ctx.currentZone.modifiers[modifiers.Luck.id] < 10)
        this.ctx.currentZone.modifiers[modifiers.Luck.id] += 10;
    }

    // Touch the portal to move between games
    if (
      util.physics.distanceBetweenPoints(client.position, this.ctx.games.MageIsles.zones[0].objects.MemeIslesPortal) < 1
    ) {
      this.ctx.currentGame =
        this.ctx.currentGame.key === 'meme-isles' ? this.ctx.games.MageIsles : this.ctx.games.MemeIsles;
      this.ctx.currentZone = this.ctx.currentGame.zones[0];

      this.ctx.emit.onChangeGame.mutate('MemeIsles', {
        context: { client },
      });
    }
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

      // this.ctx.emit.onBroadcast.mutate([`Error Occurred. Please report.`, 3]);
      this.ctx.emitAll.onBroadcast.mutate([`${client.name} joined BLM`, 0]);
    }
    if (input == '201') {
      client.speed += 2;

      this.ctx.emitAll.onBroadcast.mutate([`${client.name} got speedy`, 0]);
    }
    if (input == '202') {
      client.speed += 2;

      this.ctx.emitAll.onBroadcast.mutate([`${client.name} got a bump`, 0]);
    }

    this.ctx.services.gameloop.handleUpgrades(client);
  }

  async load(input: Shard.RouterInput['load'], { client }: Shard.ServiceContext): Promise<Shard.RouterOutput['load']> {
    log('Load', client.id, client.hash);
    this.ctx.emit.onLoaded.mutate([1], { context: { client } });
  }

  async spectate(
    input: Shard.RouterInput['spectate'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['spectate']> {
    // Spectating is not allowed during maintenance unless the client is a moderator
    if (this.ctx.config.isMaintenance && !client.isMod) throw new Error('Unauthorized');

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
      client.avatar = this.ctx.config.startAvatar;
      client.speed = 7;
      client.overrideSpeed = 7;
      client.cameraSize = 8;
      client.overrideCameraSize = 8;
      client.log.spectating += 1;

      this.ctx.services.gameloop.syncSprites();
      this.ctx.emitAll.onSpectate.mutate([client.id, client.speed, client.cameraSize]);
    }
  }

  async completeQuest(input: { questId: string }, { client }: Shard.ServiceContext): Promise<{ status: 1 }> {
    const quest = this.ctx.services.interactions.getQuests().find((q) => q.id === input.questId);
    if (!quest) throw new Error('Quest not found');

    // shard validates requirements (generic)
    for (const req of quest.requirements) {
      if (req.kind === 'exists') {
        if (!client.character?.meta?.[req.key]) throw new Error('Requirements not met');
      }

      if (req.kind === 'touchedObject') {
        const touchedAt = client.character?.meta?.[req.writeKey];
        if (!touchedAt) throw new Error('Requirements not met');

        if (req.afterKey) {
          const a = Date.parse(client.character?.meta?.[req.afterKey]);
          const b = Date.parse(touchedAt);
          if (Number.isFinite(a) && Number.isFinite(b) && b < a) throw new Error('Requirements not met');
        }
      }
    }

    // prevent double-complete (shard-side rule; seer can also enforce idempotency)
    const completedAtKey = `character.quest.${quest.id}.completedAt`;
    if (client.character?.meta?.[completedAtKey]) throw new Error('Already completed');

    // enqueue semantic op + allow seer to apply effects
    client.ops ??= [];
    client.ops.push({
      kind: 'quest.complete',
      id: util.rpc.opId('quest.complete', client, this.ctx.round.id),
      ts: Date.now(),
      questId: quest.id,
      metaverseId: quest.metaverseId,
      evidence: {
        completedAt: new Date().toISOString(),
      },
    });

    // optimistic local completion marker (optional)
    client.character.meta[completedAtKey] = new Date().toISOString();

    return { status: 1 };
  }
}
