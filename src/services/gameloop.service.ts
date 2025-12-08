// evolution/packages/shard/src/services/gameloop.service.ts
//
import { generateShortId } from '@arken/node/util/db';
import { chance } from '@arken/node/util/number';
import * as util from '@arken/node/util';
import { sleep } from '@arken/node/util/time';
import type { Orb, Boundary, Reward, PowerUp, Round, Preset, Event } from '@arken/evolution-protocol/shard/shard.types';
import { Position } from '@arken/node/types';
import { EvolutionMechanic as Mechanic } from '@arken/node/legacy/types';
import type * as Shard from '@arken/evolution-protocol/shard/shard.types';
import type { Service } from '../shard.service';
import mapData from '../data/map.json'; // TODO: get this from the embedded game client
import { normalizeFloat, formatNumber } from '../util';
const { log, getTime, shuffleArray, randomPosition, sha256, decodePayload, isNumeric, ipHashFromSocket } = util;

const FF = {
  MASTER_MODE: true,
};

export class GameloopService {
  constructor(private ctx: Service) {}

  init() {
    setTimeout(() => this.sendUpdates(), this.ctx.config.sendUpdateLoopSeconds * 1000);
    setTimeout(() => this.spawnRewards(), this.ctx.config.rewardSpawnLoopSeconds * 1000);
    setTimeout(() => this.fastGameloop(), this.ctx.config.fastLoopSeconds * 1000);
    setTimeout(() => this.slowGameloop(), this.ctx.config.slowLoopSeconds * 1000);
    setTimeout(() => this.checkConnectionLoop(), this.ctx.config.checkConnectionLoopSeconds * 1000);
  }

  // Method to compare clients by their points
  compareClients(a: Shard.Client, b: Shard.Client): number {
    if (a.points > b.points) return -1;
    if (a.points < b.points) return 1;
    return 0;
  }

  async broadcastMechanics(
    input: Shard.RouterInput['broadcastMechanics'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['broadcastMechanics']> {
    if (this.ctx.isMechanicEnabled({ id: Mechanic.WinRewardsIncrease }, { client })) {
      this.ctx.emit.onBroadcast.mutate([
        `${formatNumber(
          client.character.meta[Mechanic.WinRewardsIncrease] - client.character.meta[Mechanic.WinRewardsDecrease]
        )}% Rewards`,
        0,
        { context: { client } },
      ]);
    }
    if (this.ctx.isMechanicEnabled({ id: Mechanic.IncreaseMovementSpeedOnKill }, { client })) {
      this.ctx.emit.onBroadcast.mutate(
        [`${formatNumber(client.character.meta[Mechanic.IncreaseMovementSpeedOnKill])}% Movement Burst On Kill`, 0],
        { context: { client } }
      );
    }
    if (this.ctx.isMechanicEnabled({ id: Mechanic.EvolveMovementBurst }, { client })) {
      this.ctx.emit.onBroadcast.mutate(
        [`${formatNumber(client.character.meta[Mechanic.EvolveMovementBurst])}% Movement Burst On Evolve`, 0],
        { context: { client } }
      );
    }
    if (this.ctx.isMechanicEnabled({ id: Mechanic.MovementSpeedIncrease }, { client })) {
      this.ctx.emit.onBroadcast.mutate(
        [`${formatNumber(client.character.meta[Mechanic.MovementSpeedIncrease])}% Movement Burst Strength`, 0],
        { context: { client } }
      );
    }
    if (this.ctx.isMechanicEnabled({ id: Mechanic.DeathPenaltyAvoid }, { client })) {
      this.ctx.emit.onBroadcast.mutate(
        [`${formatNumber(client.character.meta[Mechanic.DeathPenaltyAvoid])}% Avoid Death Penalty`, 0],
        { context: { client } }
      );
    }
    if (this.ctx.isMechanicEnabled({ id: Mechanic.DoublePickupChance }, { client })) {
      this.ctx.emit.onBroadcast.mutate(
        [`${formatNumber(client.character.meta[Mechanic.DoublePickupChance])}% Double Pickup Chance`, 0],
        { context: { client } }
      );
    }
    if (this.ctx.isMechanicEnabled({ id: Mechanic.IncreaseHealthOnKill }, { client })) {
      this.ctx.emit.onBroadcast.mutate(
        [`${formatNumber(client.character.meta[Mechanic.IncreaseHealthOnKill])}% Increased Health On Kill`, 0],
        { context: { client } }
      );
    }
    if (this.ctx.isMechanicEnabled({ id: Mechanic.EnergyDecayIncrease }, { client })) {
      this.ctx.emit.onBroadcast.mutate(
        [
          `${formatNumber(
            client.character.meta[Mechanic.EnergyDecayIncrease] -
              client.character.meta[Mechanic.EnergyDecayIncrease - 1]
          )}% Energy Decay`,
          0,
        ],
        { context: { client } }
      );
    }
    if (this.ctx.isMechanicEnabled({ id: Mechanic.SpriteFuelIncrease }, { client })) {
      this.ctx.emit.onBroadcast.mutate(
        [
          `${formatNumber(
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

    return this.ctx.config.mechanicsAllowed && !!client.character.meta[input.id];
  }

  syncSprites() {
    log('Syncing sprites');
    const clientCount = this.ctx.clients.filter((c) => !c.isDead && !c.isSpectating && !c.isGod).length;
    const length = this.ctx.config.spritesStartCount + clientCount * this.ctx.config.spritesPerClientCount;

    if (this.ctx.powerups.length > length) {
      const deletedPoints = this.ctx.powerups.splice(length);
      for (let i = 0; i < deletedPoints.length; i++) {
        this.ctx.emitAll.onUpdatePickup.mutate(['null', deletedPoints[i].id, 0]);
      }
      this.ctx.config.spritesTotal = length;
    } else if (length > this.ctx.powerups.length) {
      this.spawnSprites(length - this.ctx.powerups.length);
    }
  }

  getUnobstructedPosition(): Position {
    const spawnBoundary = this.ctx.config.level2open ? this.ctx.spawnBoundary2 : this.ctx.spawnBoundary1;
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
          if (this.ctx.config.level2open && gameObject.Name === 'Level2Divider') {
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
      this.ctx.powerups.push(powerupSpawnPoint);
      this.ctx.powerupLookup[powerupSpawnPoint.id] = powerupSpawnPoint;
      this.ctx.emitAll.onSpawnPowerUp.mutate([
        powerupSpawnPoint.id,
        powerupSpawnPoint.type,
        powerupSpawnPoint.position.x,
        powerupSpawnPoint.position.y,
        powerupSpawnPoint.scale,
      ]);
    }
    this.ctx.config.spritesTotal = this.ctx.powerups.length;
  }

  removeOrb(id: string): void {
    if (this.ctx.orbLookup[id]) {
      delete this.ctx.orbLookup[id];
    }
    for (let i = 0; i < this.ctx.orbs.length; i++) {
      if (this.ctx.orbs[i].id === id) {
        this.ctx.orbs.splice(i, 1);
        break;
      }
    }
  }

  removeSprite(id: string): void {
    if (this.ctx.powerupLookup[id]) {
      delete this.ctx.powerupLookup[id];
    }
    for (let i = 0; i < this.ctx.powerups.length; i++) {
      if (this.ctx.powerups[i].id === id) {
        this.ctx.powerups.splice(i, 1);
        break;
      }
    }
  }

  public async claimReward(client: Shard.Client, reward: Reward): Promise<void> {
    if (!reward) return;

    if (this.ctx.config.anticheat.sameClientCantClaimRewardTwiceInRow && this.ctx.lastReward?.winner === client.name)
      return;

    // const claimRewardRes = await rsCall('GS_ClaimRewardRequest', { reward, client }) as any

    // if (claimRewardRes.status !== 1) {
    //   this.ctx.emit.onBroadcast.mutate({message:`Problem claiming reward. Contact support.`, priority: 3});
    //   return;
    // }

    reward.winner = client.name;

    this.ctx.emitAll.onUpdateReward.mutate([client.id, reward.id]);

    client.rewards += 1;
    client.points += this.ctx.config.pointsPerReward;
    client.pickups.push(reward);
    if (
      this.ctx.isMechanicEnabled({ id: Mechanic.DoublePickupChance }, { client }) &&
      client.character.meta[Mechanic.DoublePickupChance] > 0
    ) {
      const r = util.number.random(1, 100);
      if (r <= client.character.meta[Mechanic.DoublePickupChance]) {
        client.pickups.push(reward);
        this.ctx.emitAll.onBroadcast.mutate([`${client.name} got a double pickup!`, 0]);
      }
    }

    this.ctx.lastReward = reward;
    this.ctx.currentReward = null;
  }

  spawnRewards(): void {
    this.spawnRandomReward();

    setTimeout(() => this.spawnRewards(), this.ctx.config.rewardSpawnLoopSeconds * 1000);
  }

  public async spawnRandomReward(): Promise<void> {
    if (this.ctx.currentReward) {
      return;
    }

    this.removeReward();

    const tempReward = await this.ctx.realm.emit.getRandomReward.mutate();

    if (!tempReward) {
      return;
    }

    if (tempReward.type !== 'token') {
      this.ctx.emitAll.onBroadcast.mutate([`${tempReward.rewardItemName}`, 3]); // Powerful Energy Detected -
    }

    await sleep(3 * 1000);

    if (tempReward.rewardItemName) {
      this.ctx.currentReward = { ...tempReward };

      // rewardItemType = 0 = token | 1 = item | 2 = guardian | 3 = cube | 4 = trinket | 5 = old | 6 = santahat
      this.ctx.emitAll.onSpawnReward.mutate([
        this.ctx.currentReward.id,
        this.ctx.currentReward.rewardItemType,
        this.ctx.currentReward.rewardItemName,
        this.ctx.currentReward.quantity,
        this.ctx.currentReward.position.x,
        this.ctx.currentReward.position.y,
      ]);
    }

    await sleep(30 * 1000);
    if (!this.ctx.currentReward) return;
    if (this.ctx.currentReward.id !== tempReward.id) return;

    this.removeReward();
  }

  removeReward(): void {
    if (!this.ctx.currentReward) return;
    this.ctx.emitAll.onUpdateReward.mutate(['null', this.ctx.currentReward.id]);
    this.ctx.currentReward = undefined;
  }

  public detectCollisions(): void {
    try {
      const now = Date.now();
      const currentTime = Math.round(now / 1000);
      const deltaTime = (now - this.ctx.lastFastestGameloopTime) / 1000;

      const distanceMap = {
        0: this.ctx.config.avatarTouchDistance0,
        1: this.ctx.config.avatarTouchDistance0,
        2: this.ctx.config.avatarTouchDistance0,
      };

      for (const client of this.ctx.clients) {
        if (client.isDead || client.isSpectating || client.isJoining) continue;

        if (!Number.isFinite(client.position.x) || !Number.isFinite(client.speed)) {
          client.log.speedProblem += 1;
          this.ctx.disconnectClient(client, 'speed problem');
          continue;
        }

        if (util.physics.distanceBetweenPoints(client.position, client.clientPosition) > 2) {
          client.phasedUntil = Date.now() + 2000;
          client.log.phases += 1;
          client.log.clientDistanceProblem += 1;
        }

        let position = util.physics.moveVectorTowards(
          client.position,
          client.clientTarget,
          (client.overrideSpeed || client.speed) * deltaTime
        );

        let outOfBounds = false;
        if (position.x > this.ctx.mapBoundary.x.max) {
          position.x = this.ctx.mapBoundary.x.max;
          outOfBounds = true;
        }
        if (position.x < this.ctx.mapBoundary.x.min) {
          position.x = this.ctx.mapBoundary.x.min;
          outOfBounds = true;
        }
        if (position.y > this.ctx.mapBoundary.y.max) {
          position.y = this.ctx.mapBoundary.y.max;
          outOfBounds = true;
        }
        if (position.y < this.ctx.mapBoundary.y.min) {
          position.y = this.ctx.mapBoundary.y.min;
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
                if (this.ctx.config.stickyIslands) {
                  stuck = true;
                } else {
                  collided = true;
                }
              } else if (gameObject.Name.indexOf('Collider') === 0) {
                stuck = true;
              } else if (gameObject.Name.indexOf('Level2Divider') === 0) {
                if (!this.ctx.config.level2open) stuck = true;
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
          client.phasedUntil = Date.now() + 3000;
          client.phasedPosition = client.phasedPosition || position;
          client.log.phases += 1;
          client.log.collided += 1;
          client.overrideSpeed = 0.5;
          client.overrideSpeedUntil = Date.now() + 1000;
        } else if (stuck && !isClientInvincible) {
          client.position = position;
          client.target = client.clientTarget;
          client.phasedUntil = Date.now() + 3000;
          client.log.phases += 1;
          client.log.stuck += 1;
          client.overrideSpeed = 0.5;
          client.overrideSpeedUntil = Date.now() + 1000;
          if (this.ctx.config.stickyIslands) {
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

      if (!this.ctx.config.isRoundPaused) {
        for (const client1 of this.ctx.clients) {
          if (client1.isSpectating || client1.isDead || client1.invincibleUntil > currentTime) continue;

          for (const client2 of this.ctx.clients) {
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

            if (util.physics.distanceBetweenPoints(position1, position2) <= distance) {
              this.registerKill(client1, client2);
            }
          }
        }

        for (const client of this.ctx.clients) {
          if (client.isDead || client.isSpectating || client.isPhased || now < client.phasedUntil) continue;

          const touchDistance = this.ctx.config.pickupDistance + this.ctx.config[`avatarTouchDistance${client.avatar}`];

          for (const powerup of this.ctx.powerups) {
            if (util.physics.distanceBetweenPoints(client.position, powerup.position) <= touchDistance) {
              if (this.ctx.config.gameMode === 'Hayai') {
                client.baseSpeed -= 0.001;
                if (client.baseSpeed <= 0.5) client.baseSpeed = 0.5;
              }

              let value = 0;
              switch (powerup.type) {
                case 0:
                  value = this.ctx.config.powerupXp0;
                  if (this.ctx.config.gameMode === 'Sprite Juice') client.invincibleUntil = currentTime + 2;
                  if (this.ctx.config.gameMode === 'Marco Polo') client.cameraSize += 0.05;
                  break;
                case 1:
                  value = this.ctx.config.powerupXp1;
                  if (this.ctx.config.gameMode === 'Sprite Juice') {
                    client.baseSpeed += 0.1;
                    client.decayPower -= 0.2;
                  }
                  if (this.ctx.config.gameMode === 'Marco Polo') client.cameraSize += 0.01;
                  break;
                case 2:
                  value = this.ctx.config.powerupXp2;
                  if (this.ctx.config.gameMode === 'Sprite Juice') client.baseSpeed -= 0.1;
                  if (this.ctx.config.gameMode === 'Marco Polo') client.cameraSize -= 0.01;
                  break;
                case 3:
                  value = this.ctx.config.powerupXp3;
                  if (this.ctx.config.gameMode === 'Sprite Juice') client.decayPower += 0.2;
                  if (this.ctx.config.gameMode === 'Marco Polo') client.cameraSize -= 0.05;
                  break;
              }

              client.powerups += 1;
              client.points += this.ctx.config.pointsPerPowerup;
              client.xp += value * this.ctx.config.spriteXpMultiplier;

              if (client.character.meta[Mechanic.SpriteFuelIncrease] > 0) {
                client.xp +=
                  (value * this.ctx.config.spriteXpMultiplier * client.character.meta[Mechanic.SpriteFuelIncrease]) /
                  100;
              }

              this.ctx.emitAll.onUpdatePickup.mutate([client.id, powerup.id, value]);

              this.removeSprite(powerup.id);
              this.spawnSprites(1);
            }
          }

          if (!client.isInvincible) {
            for (const orb of this.ctx.orbs) {
              if (now < orb.enabledDate) continue;
              if (util.physics.distanceBetweenPoints(client.position, orb.position) > touchDistance) continue;

              client.orbs += 1;
              client.points += orb.points;
              client.points += this.ctx.config.pointsPerOrb;

              this.ctx.emitAll.onUpdatePickup.mutate([client.id, orb.id, 0]);
              this.removeOrb(orb.id);

              this.ctx.emitAll.onBroadcast.mutate([`${client.name} stole an orb (${orb.points})`, 0]);
            }

            if (this.ctx.currentReward && now >= this.ctx.currentReward.enabledDate) {
              if (
                util.physics.distanceBetweenPoints(client.position, this.ctx.currentReward.position) <= touchDistance
              ) {
                this.claimReward(client, this.ctx.currentReward);
                this.removeReward();
              }
            }
          }
        }
      }

      this.ctx.lastFastestGameloopTime = now;
    } catch (e) {
      console.error('Error in detectCollisions:', e);
    }
  }

  checkConnectionLoop(): void {
    if (!this.ctx.config.noBoot && !this.ctx.config.isRoundPaused) {
      const oneMinuteAgo = Date.now() - this.ctx.config.disconnectClientSeconds * 1000;

      for (const client of this.ctx.clients) {
        if (client.isSpectating || client.isGod || client.isMod || client.isRealm) {
          continue;
        }

        if (client.lastReportedTime <= oneMinuteAgo) {
          client.log.timeoutDisconnect += 1;
          this.ctx.disconnectClient(client, 'timed out');
        }
      }
    }

    setTimeout(() => this.checkConnectionLoop(), this.ctx.config.checkConnectionLoopSeconds * 1000);
  }

  sendUpdates(): void {
    this.ctx.emitAll.onClearLeaderboard.mutate();

    const leaderboard = this.ctx.round.clients.sort(this.compareClients).slice(0, 10);
    for (let j = 0; j < leaderboard.length; j++) {
      this.ctx.emitAll.onUpdateBestClient.mutate([
        leaderboard[j].name,
        j,
        leaderboard[j].points,
        leaderboard[j].kills,
        leaderboard[j].deaths,
        leaderboard[j].powerups,
        leaderboard[j].evolves,
        leaderboard[j].rewards,
        leaderboard[j].isDead ? '-' : Math.round(leaderboard[j].latency),
        this.ctx.ranks[leaderboard[j].address]?.kills / 5 || 1,
      ]);
    }

    this.flushEventQueue();

    setTimeout(() => this.sendUpdates(), this.ctx.config.sendUpdateLoopSeconds * 1000);
  }

  flushEventQueue() {
    if (!this.ctx.eventQueue.length) return;

    // log('Flushing event queue', this.ctx.eventQueue.length);

    this.ctx.emitAllDirect.onEvents.mutate(this.ctx.eventQueue);

    this.ctx.eventQueue = [];
  }

  clearSprites() {
    this.ctx.powerups.splice(0, this.ctx.powerups.length); // clear the powerup list
  }

  slowGameloop() {
    if (this.ctx.config.dynamicDecayPower) {
      const clients = this.ctx.clients.filter((p) => !p.isDead && !p.isSpectating);
      const maxEvolvedClients = clients.filter((p) => p.avatar === this.ctx.config.maxEvolves - 1);

      this.ctx.config.avatarDecayPower0 =
        this.ctx.roundConfig.avatarDecayPower0 +
        maxEvolvedClients.length * this.ctx.config.decayPowerPerMaxEvolvedClients * 0.33;
      this.ctx.config.avatarDecayPower1 =
        this.ctx.roundConfig.avatarDecayPower1 +
        maxEvolvedClients.length * this.ctx.config.decayPowerPerMaxEvolvedClients * 0.66;
      this.ctx.config.avatarDecayPower2 =
        this.ctx.roundConfig.avatarDecayPower1 +
        maxEvolvedClients.length * this.ctx.config.decayPowerPerMaxEvolvedClients * 1;
    }

    // if (this.ctx.config.calcRoundRewards && this.ctx.config.rewardWinnerAmount === 0) {
    //   await this.calcRoundRewards()
    // }

    setTimeout(() => this.slowGameloop(), this.ctx.config.slowLoopSeconds * 1000);
  }

  async fastGameloop() {
    // console.log('fastGameloop');
    try {
      const now = Date.now();

      this.detectCollisions();

      if (FF.MASTER_MODE) {
        if (!this.ctx.master) {
          log('Master not set');
          setTimeout(() => this.fastGameloop(), 10 * 1000);
          return;
        }
        // get player positions
        // await this.ctx.master.emit.onGetPlayerUpdates.mutate();

        this.ctx.emit.onGetPlayerUpdates.mutate({
          context: { client: this.ctx.master.client },
        });
      }

      for (let i = 0; i < this.ctx.clients.length; i++) {
        const client = this.ctx.clients[i];
        // console.log(client);
        if (client.isDisconnected || client.isDead || client.isSpectating || client.isJoining) continue;

        const currentTime = Math.round(now / 1000);
        const isInvincible =
          this.ctx.config.isGodParty ||
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

        client.speed = this.ctx.getClientSpeed(client);

        if (!this.ctx.config.isRoundPaused && this.ctx.config.gameMode !== 'Pandamonium') {
          let decay = this.ctx.config.noDecay
            ? 0
            : ((client.avatar + 1) / (1 / this.ctx.config.fastLoopSeconds)) *
              ((this.ctx.config['avatarDecayPower' + client.avatar] || 1) * this.ctx.config.decayPower);

          if (
            this.ctx.isMechanicEnabled({ id: Mechanic.EnergyDecayIncrease }, { client }) &&
            this.ctx.isMechanicEnabled({ id: Mechanic.EnergyDecayDecrease }, { client })
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

        if (this.ctx.config.gameMode === 'Pandamonium' && this.ctx.pandas.includes(client.address)) {
          client.avatar = 2;
        }

        this.ctx.emitAll.onUpdatePlayer.mutate([
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

      if (this.ctx.config.gameMode === 'Hayai') {
        this.adjustGameSpeed();
      }

      this.checkBattleRoyaleEnd();

      this.ctx.lastFastGameloopTime = now;
    } catch (e) {
      log('Error:', e);
      this.ctx.disconnectAllClients();
      setTimeout(() => process.exit(1), 2 * 1000);
    }
    // console.log('this.ctx.config.fastLoopSeconds');
    setTimeout(() => this.fastGameloop(), this.ctx.config.fastLoopSeconds * 1000);
  }

  checkBattleRoyaleEnd(): void {
    const totalAliveClients = this.ctx.clients.filter(
      (client) => !client.isGod && !client.isSpectating && !client.isDead
    );

    if (this.ctx.config.isBattleRoyale && totalAliveClients.length === 1) {
      this.ctx.emitAll.onBroadcast.mutate([`${totalAliveClients[0].name} is the last dragon standing`, 3]);

      this.ctx.baseConfig.isBattleRoyale = false;
      this.ctx.config.isBattleRoyale = false;
      this.ctx.baseConfig.isGodParty = true;
      this.ctx.config.isGodParty = true;
    }
  }

  adjustGameSpeed(): void {
    const timeStep = 5 * 60 * (this.ctx.config.fastLoopSeconds * 1000);
    const speedMultiplier = 0.25;

    this.ctx.config.baseSpeed += normalizeFloat((5 * speedMultiplier) / timeStep);
    this.ctx.config.checkPositionDistance += normalizeFloat((6 * speedMultiplier) / timeStep);
    this.ctx.config.checkInterval += normalizeFloat((3 * speedMultiplier) / timeStep);
  }

  handleUpgrades(client: Shard.Client): void {
    if (client.upgradesPending === 0) return;

    this.ctx.emit.onUpgrade.mutate([client.upgradesPending, client.upgradeRerolls, ['200', '201', '202']], {
      context: { client },
    });
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
        if (client.avatar < this.ctx.config.maxEvolves - 1) {
          client.xp = client.xp - client.maxHp;
          client.avatar = Math.max(
            Math.min(client.avatar + 1 * this.ctx.config.avatarDirection, this.ctx.config.maxEvolves - 1),
            0
          );
          client.evolves += 1;
          client.points += this.ctx.config.pointsPerEvolve;

          if (this.ctx.config.leadercap && client.name === this.ctx.lastLeaderName) {
            client.speed = client.speed * 0.8;
          }

          if (
            this.ctx.isMechanicEnabled({ id: Mechanic.EvolveMovementBurst }, { client }) &&
            client.character.meta[Mechanic.EvolveMovementBurst] > 0
          ) {
            client.overrideSpeedUntil = Date.now() + 1000;
            client.overrideSpeed = client.speed * (1 + client.character.meta[Mechanic.EvolveMovementBurst] / 100);

            if (
              this.ctx.isMechanicEnabled({ id: Mechanic.MovementSpeedIncrease }, { client }) &&
              client.character.meta[Mechanic.MovementSpeedIncrease] > 0
            ) {
              client.overrideSpeed =
                client.overrideSpeed * (1 + client.character.meta[Mechanic.MovementSpeedIncrease] / 100);
            }
          }

          this.ctx.emitAll.onUpdateEvolution.mutate([client.id, client.avatar, client.overrideSpeed || client.speed]);
        } else {
          client.xp = client.maxHp;
        }
      } else {
        if (client.avatar >= this.ctx.config.maxEvolves - 1) {
          client.xp = client.maxHp;
        } else {
          client.xp = client.xp - client.maxHp;
          client.avatar = Math.max(
            Math.min(client.avatar + 1 * this.ctx.config.avatarDirection, this.ctx.config.maxEvolves - 1),
            0
          );
          client.evolves += 1;
          client.points += this.ctx.config.pointsPerEvolve;

          if (this.ctx.config.leadercap && client.name === this.ctx.lastLeaderName) {
            client.speed = client.speed * 0.8;
          }

          if (
            this.ctx.isMechanicEnabled({ id: Mechanic.EvolveMovementBurst }, { client }) &&
            client.character.meta[Mechanic.EvolveMovementBurst] > 0
          ) {
            client.overrideSpeedUntil = Date.now() + 1000;
            client.overrideSpeed = client.speed * (1 + client.character.meta[Mechanic.EvolveMovementBurst] / 100);

            if (
              this.ctx.isMechanicEnabled({ id: Mechanic.MovementSpeedIncrease }, { client }) &&
              client.character.meta[Mechanic.MovementSpeedIncrease] > 0
            ) {
              client.overrideSpeed =
                client.overrideSpeed * (1 + client.character.meta[Mechanic.MovementSpeedIncrease] / 100);
            }
          }

          this.ctx.emitAll.onUpdateEvolution.mutate([client.id, client.avatar, client.overrideSpeed || client.speed]);
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
            const isNew = client.joinedAt >= currentTime - this.ctx.config.immunitySeconds;

            if (!this.ctx.config.noBoot && !isInvincible && !isNew && !this.ctx.config.isGodParty) {
              client.log.ranOutOfHealth += 1;

              if (client.lastTouchTime > now - 2000) {
                this.registerKill(this.ctx.clientLookup[client.lastTouchClientId], client);
              } else {
                // this.ctx.disconnectClient(client, 'starved');
                this.handleUpgrades(client);
                this.ctx.services.client.spectate(null, { client });
              }
            }
          } else {
            client.xp = client.maxHp;
            client.avatar = Math.max(
              Math.min(client.avatar - 1 * this.ctx.config.avatarDirection, this.ctx.config.maxEvolves - 1),
              0
            );

            if (this.ctx.config.leadercap && client.name === this.ctx.lastLeaderName) {
              client.speed = client.speed * 0.8;
            }

            this.ctx.emitAll.onUpdateRegression.mutate([
              client.id,
              client.avatar,
              client.overrideSpeed || client.speed,
            ]);
          }
        } else {
          if (client.avatar === 0) {
            client.xp = 0;
          } else {
            client.xp = client.maxHp;
            client.avatar = Math.max(
              Math.min(client.avatar - 1 * this.ctx.config.avatarDirection, this.ctx.config.maxEvolves - 1),
              0
            );

            if (this.ctx.config.leadercap && client.name === this.ctx.lastLeaderName) {
              client.speed = client.speed * 0.8;
            }

            this.ctx.emitAll.onUpdateRegression.mutate([
              client.id,
              client.avatar,
              client.overrideSpeed || client.speed,
            ]);
          }
        }
      }
    }
  }

  roundEndingSoon(sec: number): boolean {
    const roundTimer = this.ctx.round.startedDate + this.ctx.config.roundLoopSeconds - Math.round(Date.now() / 1000);
    return roundTimer < sec;
  }

  registerKill(winner: Shard.Client, loser: Shard.Client): void {
    const now = Date.now();

    if (this.ctx.config.isGodParty) return;
    if (winner.isInvincible || loser.isInvincible) return;
    if (winner.isGod || loser.isGod) return;
    if (winner.isDead) return;

    if (this.ctx.config.gameMode !== 'Pandamonium' || !this.ctx.pandas.includes(winner.address)) {
      if (this.ctx.config.preventBadKills && (winner.isPhased || now < winner.phasedUntil)) return;

      const totalKills = winner.log.kills.filter((h) => h === loser.hash).length;
      const notReallyTrying = this.ctx.config.antifeed1
        ? (totalKills >= 2 && loser.kills < 2 && loser.rewards <= 1) ||
          (totalKills >= 2 && loser.kills < 2 && loser.powerups <= 100)
        : false;
      const tooManyKills = this.ctx.config.antifeed2
        ? this.ctx.clients.length > 2 &&
          totalKills >= 5 &&
          totalKills > winner.log.kills.length / this.ctx.clients.filter((c) => !c.isDead).length
        : false;
      const killingThemselves = this.ctx.config.antifeed3 ? winner.hash === loser.hash : false;
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

      if (this.ctx.config.preventBadKills && !allowKill) {
        loser.phasedUntil = Date.now() + 2000;
        return;
      }
    }

    if (this.ctx.config.gameMode === 'Pandamonium' && !this.ctx.pandas.includes(winner.address)) {
      return;
    }

    loser.xp -= this.ctx.config.damagePerTouch;
    winner.xp -= this.ctx.config.damagePerTouch;

    const time = Date.now();

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
    winner.points += this.ctx.config.pointsPerKill * (loser.avatar + 1);
    winner.log.kills.push(loser.hash);

    let deathPenaltyAvoid = false;

    if (
      this.ctx.isMechanicEnabled({ id: Mechanic.DeathPenaltyAvoid }, { client: loser }) &&
      loser.character.meta[Mechanic.DeathPenaltyAvoid] > 0
    ) {
      const r = util.random(1, 100);

      if (r <= loser.character.meta[Mechanic.DeathPenaltyAvoid]) {
        deathPenaltyAvoid = true;
        this.ctx.emitAll.onBroadcast.mutate([`${loser.name} avoided penalty!`, 0]);
      }
    }

    let orbOnDeathPercent =
      this.ctx.config.orbOnDeathPercent > 0
        ? this.ctx.config.leadercap && loser.name === this.ctx.lastLeaderName
          ? 50
          : this.ctx.config.orbOnDeathPercent
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
      this.ctx.isMechanicEnabled({ id: Mechanic.IncreaseMovementSpeedOnKill }, { client: winner }) &&
      winner.character.meta[Mechanic.IncreaseMovementSpeedOnKill] > 0
    ) {
      winner.overrideSpeed =
        winner.speed *
        (1 + winner.character.meta[Mechanic.IncreaseMovementSpeedOnKill] / 100) *
        (1 + winner.character.meta[Mechanic.MovementSpeedIncrease] / 100);
      winner.overrideSpeedUntil = Date.now() + 5000;
    }

    if (
      this.ctx.isMechanicEnabled({ id: Mechanic.IncreaseHealthOnKill }, { client: winner }) &&
      winner.character.meta[Mechanic.IncreaseHealthOnKill] > 0
    ) {
      winner.maxHp = winner.maxHp * (1 + winner.character.meta[Mechanic.IncreaseHealthOnKill] / 100);
    }

    winner.xp += 25;

    if (winner.xp > winner.maxHp) winner.xp = winner.maxHp;

    this.ctx.emitAll.onGameOver.mutate([loser.id, winner.id]);
    this.handleUpgrades(loser);

    // this.ctx.disconnectClient(loser, 'got killed');
    this.ctx.services.client.spectate(null, { client: loser });

    const orb: Orb = {
      id: generateShortId(),
      type: 4,
      points: orbPoints,
      scale: orbPoints,
      enabledDate: now + this.ctx.config.orbTimeoutSeconds * 1000,
      position: {
        x: loser.position.x,
        y: loser.position.y,
      },
    };

    const currentRound = this.ctx.round.id;

    if (this.ctx.config.orbOnDeathPercent > 0 && !this.roundEndingSoon(this.ctx.config.orbCutoffSeconds)) {
      setTimeout(() => {
        if (this.ctx.round.id !== currentRound) return;

        this.ctx.orbs.push(orb);
        this.ctx.orbLookup[orb.id] = orb;

        this.ctx.emitAll.onSpawnPowerUp.mutate([orb.id, orb.type, orb.position.x, orb.position.y, orb.scale]);
      }, this.ctx.config.orbTimeoutSeconds * 1000);
    }
  }
}
