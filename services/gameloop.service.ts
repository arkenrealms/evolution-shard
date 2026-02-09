// evolution/packages/shard/src/services/gameloop.service.ts
//
import { generateShortId } from '@arken/node/db';
import * as util from '@arken/node/util';
import type { Orb, Boundary, Reward, PowerUp, Round, Preset, Event } from '@arken/evolution-protocol/shard/shard.types';
import { Position } from '@arken/evolution-protocol/shard/shard.types';
import { EvolutionMechanic as Mechanic } from '@arken/node/legacy/types';
import type * as Shard from '@arken/evolution-protocol/shard/shard.types';
import type { Service } from '../shard.service';
import { log } from '@arken/node/log';
import { sleep } from '@arken/node/time';

import mapData from '../data/map.json'; // TODO: get this from the embedded game client

const { getTime, shuffleArray, randomPosition, sha256, decodePayload, isNumeric, ipHashFromSocket } = util;

const FF = {
  MASTER_MODE: false,
};

export class GameloopService {
  constructor(private app: Service) {}

  init() {
    setTimeout(() => this.sendUpdates(), this.app.config.sendUpdateLoopSeconds * 1000);
    setTimeout(() => this.spawnRewards(), this.app.config.rewardSpawnLoopSeconds * 1000);
    setTimeout(() => this.fastGameloop(), this.app.config.fastLoopSeconds * 1000);
    setTimeout(() => this.slowGameloop(), this.app.config.slowLoopSeconds * 1000);
    setTimeout(() => this.checkConnectionLoop(), this.app.config.checkConnectionLoopSeconds * 1000);
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
    if (this.app.isMechanicEnabled({ id: Mechanic.WinRewardsIncrease }, { client })) {
      this.app.emit.onBroadcast.mutate([
        `${util.number.format(
          client.character.meta[Mechanic.WinRewardsIncrease] - client.character.meta[Mechanic.WinRewardsDecrease]
        )}% Rewards`,
        0,
        { context: { client } },
      ]);
    }
    if (this.app.isMechanicEnabled({ id: Mechanic.IncreaseMovementSpeedOnKill }, { client })) {
      this.app.emit.onBroadcast.mutate(
        [
          `${util.number.format(client.character.meta[Mechanic.IncreaseMovementSpeedOnKill])}% Movement Burst On Kill`,
          0,
        ],
        { context: { client } }
      );
    }
    if (this.app.isMechanicEnabled({ id: Mechanic.EvolveMovementBurst }, { client })) {
      this.app.emit.onBroadcast.mutate(
        [`${util.number.format(client.character.meta[Mechanic.EvolveMovementBurst])}% Movement Burst On Evolve`, 0],
        { context: { client } }
      );
    }
    if (this.app.isMechanicEnabled({ id: Mechanic.MovementSpeedIncrease }, { client })) {
      this.app.emit.onBroadcast.mutate(
        [`${util.number.format(client.character.meta[Mechanic.MovementSpeedIncrease])}% Movement Burst Strength`, 0],
        { context: { client } }
      );
    }
    if (this.app.isMechanicEnabled({ id: Mechanic.DeathPenaltyAvoid }, { client })) {
      this.app.emit.onBroadcast.mutate(
        [`${util.number.format(client.character.meta[Mechanic.DeathPenaltyAvoid])}% Avoid Death Penalty`, 0],
        { context: { client } }
      );
    }
    if (this.app.isMechanicEnabled({ id: Mechanic.DoublePickupChance }, { client })) {
      this.app.emit.onBroadcast.mutate(
        [`${util.number.format(client.character.meta[Mechanic.DoublePickupChance])}% Double Pickup Chance`, 0],
        { context: { client } }
      );
    }
    if (this.app.isMechanicEnabled({ id: Mechanic.IncreaseHealthOnKill }, { client })) {
      this.app.emit.onBroadcast.mutate(
        [`${util.number.format(client.character.meta[Mechanic.IncreaseHealthOnKill])}% Increased Health On Kill`, 0],
        { context: { client } }
      );
    }
    if (this.app.isMechanicEnabled({ id: Mechanic.EnergyDecayIncrease }, { client })) {
      this.app.emit.onBroadcast.mutate(
        [
          `${util.number.format(
            client.character.meta[Mechanic.EnergyDecayIncrease] -
              client.character.meta[Mechanic.EnergyDecayIncrease - 1]
          )}% Energy Decay`,
          0,
        ],
        { context: { client } }
      );
    }
    if (this.app.isMechanicEnabled({ id: Mechanic.SpriteFuelIncrease }, { client })) {
      this.app.emit.onBroadcast.mutate(
        [
          `${util.number.format(
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

    return this.app.config.mechanicsAllowed && !!client.character.meta[input.id];
  }

  syncSprites() {
    log('Syncing sprites');
    const clientCount = this.app.clients.filter((c) => !c.isDead && !c.isSpectating && !c.isGod).length;
    const length = this.app.config.spritesStartCount + clientCount * this.app.config.spritesPerClientCount;

    if (this.app.powerups.length > length) {
      const deletedPoints = this.app.powerups.splice(length);
      for (let i = 0; i < deletedPoints.length; i++) {
        this.app.emitAll.onUpdatePickup.mutate(['null', deletedPoints[i].id, 0]);
      }
      this.app.config.spritesTotal = length;
    } else if (length > this.app.powerups.length) {
      this.spawnSprites(length - this.app.powerups.length);
    }
  }

  getUnobstructedPosition(): Position {
    const spawnBoundary = this.app.config.level2open ? this.app.spawnBoundary2 : this.app.spawnBoundary1;
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
          if (this.app.config.level2open && gameObject.Name === 'Level2Divider') {
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
      this.app.powerups.push(powerupSpawnPoint);
      this.app.powerupLookup[powerupSpawnPoint.id] = powerupSpawnPoint;
      this.app.emitAll.onSpawnPowerUp.mutate([
        powerupSpawnPoint.id,
        powerupSpawnPoint.type,
        powerupSpawnPoint.position.x,
        powerupSpawnPoint.position.y,
        powerupSpawnPoint.scale,
      ]);
    }
    this.app.config.spritesTotal = this.app.powerups.length;
  }

  removeOrb(id: string): void {
    if (this.app.orbLookup[id]) {
      delete this.app.orbLookup[id];
    }
    for (let i = 0; i < this.app.orbs.length; i++) {
      if (this.app.orbs[i].id === id) {
        this.app.orbs.splice(i, 1);
        break;
      }
    }
  }

  removeSprite(id: string): void {
    if (this.app.powerupLookup[id]) {
      delete this.app.powerupLookup[id];
    }
    for (let i = 0; i < this.app.powerups.length; i++) {
      if (this.app.powerups[i].id === id) {
        this.app.powerups.splice(i, 1);
        break;
      }
    }
  }

  public async claimReward(client: Shard.Client, reward: Reward): Promise<void> {
    if (!reward) return;

    if (this.app.config.anticheat.sameClientCantClaimRewardTwiceInRow && this.app.lastReward?.winner === client.name)
      return;

    // const claimRewardRes = await rsCall('GS_ClaimRewardRequest', { reward, client }) as any

    // if (claimRewardRes.status !== 1) {
    //   this.app.emit.onBroadcast.mutate({message:`Problem claiming reward. Contact support.`, priority: 3});
    //   return;
    // }

    reward.winner = client.name;

    this.app.emitAll.onUpdateReward.mutate([client.id, reward.id]);

    client.rewards += 1;
    client.points += this.app.config.pointsPerReward;
    client.pickups.push(reward);
    if (
      this.app.isMechanicEnabled({ id: Mechanic.DoublePickupChance }, { client }) &&
      client.character.meta[Mechanic.DoublePickupChance] > 0
    ) {
      const r = util.number.random(1, 100);
      if (r <= client.character.meta[Mechanic.DoublePickupChance]) {
        client.pickups.push(reward);
        this.app.emitAll.onBroadcast.mutate([`${client.name} got a double pickup!`, 0]);
      }
    }

    this.app.lastReward = reward;
    this.app.currentReward = null;
  }

  spawnRewards(): void {
    if (!this.app.realm) {
      setTimeout(() => this.spawnRewards(), this.app.config.rewardSpawnLoopSeconds * 1000);
      return;
    }

    this.spawnRandomReward();

    setTimeout(() => this.spawnRewards(), this.app.config.rewardSpawnLoopSeconds * 1000);
  }

  public async spawnRandomReward(): Promise<void> {
    if (this.app.currentReward) {
      return;
    }

    this.removeReward();

    const tempReward = await this.app.realm.emit.getRandomReward.mutate();

    if (!tempReward) {
      return;
    }

    if (tempReward.type !== 'token') {
      this.app.emitAll.onBroadcast.mutate([`${tempReward.rewardItemName}`, 3]); // Powerful Energy Detected -
    }

    await sleep(3 * 1000);

    if (tempReward.rewardItemName) {
      this.app.currentReward = { ...tempReward };

      // rewardItemType = 0 = token | 1 = item | 2 = guardian | 3 = cube | 4 = trinket | 5 = old | 6 = santahat
      this.app.emitAll.onSpawnReward.mutate([
        this.app.currentReward.id,
        this.app.currentReward.rewardItemType,
        this.app.currentReward.rewardItemName,
        this.app.currentReward.quantity,
        this.app.currentReward.position.x,
        this.app.currentReward.position.y,
      ]);
    }

    await sleep(30 * 1000);
    if (!this.app.currentReward) return;
    if (this.app.currentReward.id !== tempReward.id) return;

    this.removeReward();
  }

  removeReward(): void {
    if (!this.app.currentReward) return;
    this.app.emitAll.onUpdateReward.mutate(['null', this.app.currentReward.id]);
    this.app.currentReward = undefined;
  }

  public detectCollisions(): void {
    try {
      const now = Date.now();
      const currentTime = Math.round(now / 1000);
      const deltaTime = (now - this.app.lastFastestGameloopTime) / 1000;

      const distanceMap = {
        0: this.app.config.avatarTouchDistance0,
        1: this.app.config.avatarTouchDistance0,
        2: this.app.config.avatarTouchDistance0,
      };

      for (const client of this.app.clients) {
        if (client.isDead || client.isSpectating || client.isJoining) continue;

        if (!Number.isFinite(client.position.x) || !Number.isFinite(client.speed)) {
          client.log.speedProblem += 1;
          this.app.disconnectClient(client, 'speed problem');
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
        if (position.x > this.app.mapBoundary.x.max) {
          position.x = this.app.mapBoundary.x.max;
          outOfBounds = true;
        }
        if (position.x < this.app.mapBoundary.x.min) {
          position.x = this.app.mapBoundary.x.min;
          outOfBounds = true;
        }
        if (position.y > this.app.mapBoundary.y.max) {
          position.y = this.app.mapBoundary.y.max;
          outOfBounds = true;
        }
        if (position.y < this.app.mapBoundary.y.min) {
          position.y = this.app.mapBoundary.y.min;
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
                if (this.app.config.stickyIslands) {
                  stuck = true;
                } else {
                  collided = true;
                }
              } else if (gameObject.Name.indexOf('Collider') === 0) {
                stuck = true;
              } else if (gameObject.Name.indexOf('Level2Divider') === 0) {
                if (!this.app.config.level2open) stuck = true;
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
          if (this.app.config.stickyIslands) {
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

      if (!this.app.config.isRoundPaused) {
        for (const client1 of this.app.clients) {
          if (client1.isSpectating || client1.isDead || client1.invincibleUntil > currentTime) continue;

          for (const client2 of this.app.clients) {
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

        for (const client of this.app.clients) {
          if (client.isDead || client.isSpectating || client.isPhased || now < client.phasedUntil) continue;

          const touchDistance = this.app.config.pickupDistance + this.app.config[`avatarTouchDistance${client.avatar}`];

          for (const powerup of this.app.powerups) {
            if (util.physics.distanceBetweenPoints(client.position, powerup.position) <= touchDistance) {
              if (this.app.config.gameMode === 'Hayai') {
                client.baseSpeed -= 0.001;
                if (client.baseSpeed <= 0.5) client.baseSpeed = 0.5;
              }

              let value = 0;
              switch (powerup.type) {
                case 0:
                  value = this.app.config.powerupXp0;
                  if (this.app.config.gameMode === 'Sprite Juice') client.invincibleUntil = currentTime + 2;
                  if (this.app.config.gameMode === 'Marco Polo') client.cameraSize += 0.05;
                  break;
                case 1:
                  value = this.app.config.powerupXp1;
                  if (this.app.config.gameMode === 'Sprite Juice') {
                    client.baseSpeed += 0.1;
                    client.decayPower -= 0.2;
                  }
                  if (this.app.config.gameMode === 'Marco Polo') client.cameraSize += 0.01;
                  break;
                case 2:
                  value = this.app.config.powerupXp2;
                  if (this.app.config.gameMode === 'Sprite Juice') client.baseSpeed -= 0.1;
                  if (this.app.config.gameMode === 'Marco Polo') client.cameraSize -= 0.01;
                  break;
                case 3:
                  value = this.app.config.powerupXp3;
                  if (this.app.config.gameMode === 'Sprite Juice') client.decayPower += 0.2;
                  if (this.app.config.gameMode === 'Marco Polo') client.cameraSize -= 0.05;
                  break;
              }

              client.powerups += 1;
              client.points += this.app.config.pointsPerPowerup;

              client.xp += value * this.app.config.spriteXpMultiplier;

              if (
                this.app.isMechanicEnabled({ id: Mechanic.SpriteFuelIncrease }, { client }) &&
                client.character.meta[Mechanic.SpriteFuelIncrease] > 0
              ) {
                client.xp +=
                  (value * this.app.config.spriteXpMultiplier * client.character.meta[Mechanic.SpriteFuelIncrease]) /
                  100;
              }

              this.app.emitAll.onUpdatePickup.mutate([client.id, powerup.id, value]);

              this.removeSprite(powerup.id);
              this.spawnSprites(1);
            }
          }

          if (!client.isInvincible) {
            for (const orb of this.app.orbs) {
              if (now < orb.enabledDate) continue;
              if (util.physics.distanceBetweenPoints(client.position, orb.position) > touchDistance) continue;

              client.orbs += 1;
              client.points += orb.points;
              client.points += this.app.config.pointsPerOrb;

              this.app.emitAll.onUpdatePickup.mutate([client.id, orb.id, 0]);
              this.removeOrb(orb.id);

              this.app.emitAll.onBroadcast.mutate([`${client.name} stole an orb (${orb.points})`, 0]);
            }

            if (this.app.currentReward && now >= this.app.currentReward.enabledDate) {
              if (
                util.physics.distanceBetweenPoints(client.position, this.app.currentReward.position) <= touchDistance
              ) {
                this.claimReward(client, this.app.currentReward);
                this.removeReward();
              }
            }
          }
        }
      }

      this.app.services.interactions.tick(Date.now());

      this.app.lastFastestGameloopTime = now;
    } catch (e) {
      console.error('Error in detectCollisions:', e);
    }
  }

  checkConnectionLoop(): void {
    if (!this.app.config.noBoot && !this.app.config.isRoundPaused) {
      const oneMinuteAgo = Date.now() - this.app.config.disconnectClientSeconds * 1000;

      for (const client of this.app.clients) {
        if (client.isSpectating || client.isGod || client.isMod || client.isRealm) {
          continue;
        }

        if (client.lastReportedTime <= oneMinuteAgo) {
          client.log.timeoutDisconnect += 1;
          this.app.disconnectClient(client, 'timed out');
        }
      }
    }

    setTimeout(() => this.checkConnectionLoop(), this.app.config.checkConnectionLoopSeconds * 1000);
  }

  sendUpdates(): void {
    if (!this.app.realm) {
      setTimeout(() => this.sendUpdates(), this.app.config.sendUpdateLoopSeconds * 1000);
      return;
    }

    this.app.emitAll.onClearLeaderboard.mutate();

    const leaderboard = this.app.round.clients.sort(this.compareClients).slice(0, 10);
    for (let j = 0; j < leaderboard.length; j++) {
      this.app.emitAll.onUpdateBestClient.mutate([
        leaderboard[j].name,
        j,
        leaderboard[j].points,
        leaderboard[j].kills,
        leaderboard[j].deaths,
        leaderboard[j].powerups,
        leaderboard[j].evolves,
        leaderboard[j].rewards,
        leaderboard[j].isDead ? '-' : Math.round(leaderboard[j].latency),
        this.app.ranks[leaderboard[j].address]?.kills / 5 || 1,
      ]);
    }

    this.flushEventQueue();

    setTimeout(() => this.sendUpdates(), this.app.config.sendUpdateLoopSeconds * 1000);
  }

  flushEventQueue() {
    if (!this.app.eventQueue.length) return;

    // log('Flushing event queue', this.app.eventQueue.length);

    this.app.emitAllDirect.onEvents.mutate(this.app.eventQueue);

    this.app.eventQueue = [];
  }

  clearSprites() {
    this.app.powerups.splice(0, this.app.powerups.length); // clear the powerup list
  }

  slowGameloop() {
    if (!this.app.realm) {
      setTimeout(() => this.slowGameloop(), this.app.config.slowLoopSeconds * 1000);
      return;
    }

    if (this.app.config.dynamicDecayPower) {
      const clients = this.app.clients.filter((p) => !p.isDead && !p.isSpectating);
      const maxEvolvedClients = clients.filter((p) => p.avatar === this.app.config.maxEvolves - 1);

      this.app.config.avatarDecayPower0 =
        this.app.roundConfig.avatarDecayPower0 +
        maxEvolvedClients.length * this.app.config.decayPowerPerMaxEvolvedClients * 0.33;
      this.app.config.avatarDecayPower1 =
        this.app.roundConfig.avatarDecayPower1 +
        maxEvolvedClients.length * this.app.config.decayPowerPerMaxEvolvedClients * 0.66;
      this.app.config.avatarDecayPower2 =
        this.app.roundConfig.avatarDecayPower1 +
        maxEvolvedClients.length * this.app.config.decayPowerPerMaxEvolvedClients * 1;
    }

    // if (this.app.config.calcRoundRewards && this.app.config.rewardWinnerAmount === 0) {
    //   await this.calcRoundRewards()
    // }

    setTimeout(() => this.slowGameloop(), this.app.config.slowLoopSeconds * 1000);
  }

  async fastGameloop() {
    if (!this.app.realm) {
      setTimeout(() => this.fastGameloop(), this.app.config.fastLoopSeconds * 1000);
      return;
    }

    // console.log('fastGameloop');

    try {
      const now = Date.now();

      this.detectCollisions();

      if (FF.MASTER_MODE) {
        if (!this.app.master) {
          log('Master not set');
          setTimeout(() => this.fastGameloop(), 10 * 1000);
          return;
        }
        // get player positions
        // await this.app.master.emit.onGetPlayerUpdates.mutate();

        this.app.emit.onGetPlayerUpdates.mutate({
          context: { client: this.app.master.client },
        });
      }

      for (let i = 0; i < this.app.clients.length; i++) {
        const client = this.app.clients[i];
        // console.log(client);
        if (client.isDisconnected || client.isDead || client.isSpectating || client.isJoining) continue;

        const currentTime = Math.round(now / 1000);
        const isInvincible =
          this.app.config.isGodParty ||
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

        client.speed = this.app.getClientSpeed(client);

        if (!this.app.config.isRoundPaused && this.app.config.gameMode !== 'Pandamonium') {
          let decay = this.app.config.noDecay
            ? 0
            : ((client.avatar + 1) / (1 / this.app.config.fastLoopSeconds)) *
              ((this.app.config['avatarDecayPower' + client.avatar] || 1) * this.app.config.decayPower);

          if (
            this.app.isMechanicEnabled({ id: Mechanic.EnergyDecayIncrease }, { client }) &&
            this.app.isMechanicEnabled({ id: Mechanic.EnergyDecayDecrease }, { client })
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

        if (this.app.config.gameMode === 'Pandamonium' && this.app.pandas.includes(client.address)) {
          client.avatar = 2;
        }

        this.app.emitAll.onUpdatePlayer.mutate([
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

      if (this.app.config.gameMode === 'Hayai') {
        this.adjustGameSpeed();
      }

      this.checkBattleRoyaleEnd();

      this.app.lastFastGameloopTime = now;
    } catch (e) {
      log('Error:', e);
      this.app.disconnectAllClients();
      setTimeout(() => process.exit(1), 2 * 1000);
    }
    // console.log('this.app.config.fastLoopSeconds');
    setTimeout(() => this.fastGameloop(), this.app.config.fastLoopSeconds * 1000);
  }

  checkBattleRoyaleEnd(): void {
    const totalAliveClients = this.app.clients.filter(
      (client) => !client.isGod && !client.isSpectating && !client.isDead
    );

    if (this.app.config.isBattleRoyale && totalAliveClients.length === 1) {
      this.app.emitAll.onBroadcast.mutate([`${totalAliveClients[0].name} is the last dragon standing`, 3]);

      this.app.baseConfig.isBattleRoyale = false;
      this.app.config.isBattleRoyale = false;
      this.app.baseConfig.isGodParty = true;
      this.app.config.isGodParty = true;
    }
  }

  adjustGameSpeed(): void {
    const timeStep = 5 * 60 * (this.app.config.fastLoopSeconds * 1000);
    const speedMultiplier = 0.25;

    this.app.config.baseSpeed += util.number.normalizeFloat((5 * speedMultiplier) / timeStep);
    this.app.config.checkPositionDistance += util.number.normalizeFloat((6 * speedMultiplier) / timeStep);
    this.app.config.checkInterval += util.number.normalizeFloat((3 * speedMultiplier) / timeStep);
  }

  handleUpgrades(client: Shard.Client): void {
    if (client.upgradesPending === 0) return;

    this.app.emit.onUpgrade.mutate([client.upgradesPending, client.upgradeRerolls, ['200', '201', '202']], {
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
        if (client.avatar < this.app.config.maxEvolves - 1) {
          client.xp = client.xp - client.maxHp;
          client.avatar = Math.max(
            Math.min(client.avatar + 1 * this.app.config.avatarDirection, this.app.config.maxEvolves - 1),
            0
          );
          client.evolves += 1;
          client.points += this.app.config.pointsPerEvolve;

          if (this.app.config.leadercap && client.name === this.app.lastLeaderName) {
            client.speed = client.speed * 0.8;
          }

          if (
            this.app.isMechanicEnabled({ id: Mechanic.EvolveMovementBurst }, { client }) &&
            client.character.meta[Mechanic.EvolveMovementBurst] > 0
          ) {
            client.overrideSpeedUntil = Date.now() + 1000;
            client.overrideSpeed = client.speed * (1 + client.character.meta[Mechanic.EvolveMovementBurst] / 100);

            if (
              this.app.isMechanicEnabled({ id: Mechanic.MovementSpeedIncrease }, { client }) &&
              client.character.meta[Mechanic.MovementSpeedIncrease] > 0
            ) {
              client.overrideSpeed =
                client.overrideSpeed * (1 + client.character.meta[Mechanic.MovementSpeedIncrease] / 100);
            }
          }

          this.app.emitAll.onUpdateEvolution.mutate([client.id, client.avatar, client.overrideSpeed || client.speed]);
        } else {
          client.xp = client.maxHp;
        }
      } else {
        if (client.avatar >= this.app.config.maxEvolves - 1) {
          client.xp = client.maxHp;
        } else {
          client.xp = client.xp - client.maxHp;
          client.avatar = Math.max(
            Math.min(client.avatar + 1 * this.app.config.avatarDirection, this.app.config.maxEvolves - 1),
            0
          );
          client.evolves += 1;
          client.points += this.app.config.pointsPerEvolve;

          if (this.app.config.leadercap && client.name === this.app.lastLeaderName) {
            client.speed = client.speed * 0.8;
          }

          if (
            this.app.isMechanicEnabled({ id: Mechanic.EvolveMovementBurst }, { client }) &&
            client.character.meta[Mechanic.EvolveMovementBurst] > 0
          ) {
            client.overrideSpeedUntil = Date.now() + 1000;
            client.overrideSpeed = client.speed * (1 + client.character.meta[Mechanic.EvolveMovementBurst] / 100);

            if (
              this.app.isMechanicEnabled({ id: Mechanic.MovementSpeedIncrease }, { client }) &&
              client.character.meta[Mechanic.MovementSpeedIncrease] > 0
            ) {
              client.overrideSpeed =
                client.overrideSpeed * (1 + client.character.meta[Mechanic.MovementSpeedIncrease] / 100);
            }
          }

          this.app.emitAll.onUpdateEvolution.mutate([client.id, client.avatar, client.overrideSpeed || client.speed]);
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
            const isNew = client.joinedAt >= currentTime - this.app.config.immunitySeconds;

            if (!this.app.config.noBoot && !isInvincible && !isNew && !this.app.config.isGodParty) {
              client.log.ranOutOfHealth += 1;

              if (client.lastTouchTime > now - 2000) {
                this.registerKill(this.app.clientLookup[client.lastTouchClientId], client);
              } else {
                // this.app.disconnectClient(client, 'starved');
                this.handleUpgrades(client);
                this.app.services.client.spectate(null, { client });
              }
            }
          } else {
            client.xp = client.maxHp;
            client.avatar = Math.max(
              Math.min(client.avatar - 1 * this.app.config.avatarDirection, this.app.config.maxEvolves - 1),
              0
            );

            if (this.app.config.leadercap && client.name === this.app.lastLeaderName) {
              client.speed = client.speed * 0.8;
            }

            this.app.emitAll.onUpdateRegression.mutate([
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
              Math.min(client.avatar - 1 * this.app.config.avatarDirection, this.app.config.maxEvolves - 1),
              0
            );

            if (this.app.config.leadercap && client.name === this.app.lastLeaderName) {
              client.speed = client.speed * 0.8;
            }

            this.app.emitAll.onUpdateRegression.mutate([
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
    const roundTimer = this.app.round.startedDate + this.app.config.roundLoopSeconds - Math.round(Date.now() / 1000);
    return roundTimer < sec;
  }

  registerKill(winner: Shard.Client, loser: Shard.Client): void {
    const now = Date.now();

    if (this.app.config.isGodParty) return;
    if (winner.isInvincible || loser.isInvincible) return;
    if (winner.isGod || loser.isGod) return;
    if (winner.isDead) return;

    if (this.app.config.gameMode !== 'Pandamonium' || !this.app.pandas.includes(winner.address)) {
      if (this.app.config.preventBadKills && (winner.isPhased || now < winner.phasedUntil)) return;

      const totalKills = winner.log.kills.filter((h) => h === loser.hash).length;
      const notReallyTrying = this.app.config.antifeed1
        ? (totalKills >= 2 && loser.kills < 2 && loser.rewards <= 1) ||
          (totalKills >= 2 && loser.kills < 2 && loser.powerups <= 100)
        : false;
      const tooManyKills = this.app.config.antifeed2
        ? this.app.clients.length > 2 &&
          totalKills >= 5 &&
          totalKills > winner.log.kills.length / this.app.clients.filter((c) => !c.isDead).length
        : false;
      const killingThemselves = this.app.config.antifeed3 ? winner.hash === loser.hash : false;
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

      if (this.app.config.preventBadKills && !allowKill) {
        loser.phasedUntil = Date.now() + 2000;
        return;
      }
    }

    if (this.app.config.gameMode === 'Pandamonium' && !this.app.pandas.includes(winner.address)) {
      return;
    }

    loser.xp -= this.app.config.damagePerTouch;
    winner.xp -= this.app.config.damagePerTouch;

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
    winner.points += this.app.config.pointsPerKill * (loser.avatar + 1);
    winner.log.kills.push(loser.hash);

    let deathPenaltyAvoid = false;

    if (
      this.app.isMechanicEnabled({ id: Mechanic.DeathPenaltyAvoid }, { client: loser }) &&
      loser.character.meta[Mechanic.DeathPenaltyAvoid] > 0
    ) {
      const r = util.random(1, 100);

      if (r <= loser.character.meta[Mechanic.DeathPenaltyAvoid]) {
        deathPenaltyAvoid = true;
        this.app.emitAll.onBroadcast.mutate([`${loser.name} avoided penalty!`, 0]);
      }
    }

    let orbOnDeathPercent =
      this.app.config.orbOnDeathPercent > 0
        ? this.app.config.leadercap && loser.name === this.app.lastLeaderName
          ? 50
          : this.app.config.orbOnDeathPercent
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
    loser.upgradesPending += util.number.chance(10) ? 1 : 0;

    // Chance for upgrade for 500 points, but less chance if they have equal amount of upgrades already
    // 500 points + 0 upgrades = (500 / 500) - 0 = 100%
    // 1000 points + 0 upgrades = (1000 / 500) - 0 = 200%
    // 1000 points + 2 upgrades = (1000 / 500) - 2 = 0%
    // So basically 500 points guarantees an upgrade on death instead of 10% random, if you have no upgrades
    // And you need to acquire 1000 points to get the next upgrade, or you don't get more on death
    // Meanwhile, somebody with less than 500 points always has a 10% chance on death
    // So the RNG gods could theoretically grant them more upgrades than the players with more points
    loser.upgradesPending += util.number.chance((Math.floor(loser.points / 500) - loser.upgrades.length) * 100) ? 1 : 0;

    if (winner.points < 0) winner.points = 0;
    if (loser.points < 0) loser.points = 0;

    winner.upgradeRerolls += 1;

    if (winner.log.deaths.length && winner.log.deaths[winner.log.deaths.length - 1] === loser.hash) {
      winner.log.revenge += 1;
    }

    if (
      this.app.isMechanicEnabled({ id: Mechanic.IncreaseMovementSpeedOnKill }, { client: winner }) &&
      winner.character.meta[Mechanic.IncreaseMovementSpeedOnKill] > 0
    ) {
      winner.overrideSpeed =
        winner.speed *
        (1 + winner.character.meta[Mechanic.IncreaseMovementSpeedOnKill] / 100) *
        (1 + winner.character.meta[Mechanic.MovementSpeedIncrease] / 100);
      winner.overrideSpeedUntil = Date.now() + 5000;
    }

    if (
      this.app.isMechanicEnabled({ id: Mechanic.IncreaseHealthOnKill }, { client: winner }) &&
      winner.character.meta[Mechanic.IncreaseHealthOnKill] > 0
    ) {
      winner.maxHp = winner.maxHp * (1 + winner.character.meta[Mechanic.IncreaseHealthOnKill] / 100);
    }

    winner.xp += 25;

    if (winner.xp > winner.maxHp) winner.xp = winner.maxHp;

    this.app.emitAll.onGameOver.mutate([loser.id, winner.id]);
    this.handleUpgrades(loser);

    // this.app.disconnectClient(loser, 'got killed');
    this.app.services.client.spectate(null, { client: loser });

    const orb: Orb = {
      id: generateShortId(),
      type: 4,
      points: orbPoints,
      scale: orbPoints,
      enabledDate: now + this.app.config.orbTimeoutSeconds * 1000,
      position: {
        x: loser.position.x,
        y: loser.position.y,
      },
    };

    const currentRound = this.app.round.id;

    if (this.app.config.orbOnDeathPercent > 0 && !this.roundEndingSoon(this.app.config.orbCutoffSeconds)) {
      setTimeout(() => {
        if (this.app.round.id !== currentRound) return;

        this.app.orbs.push(orb);
        this.app.orbLookup[orb.id] = orb;

        this.app.emitAll.onSpawnPowerUp.mutate([orb.id, orb.type, orb.position.x, orb.position.y, orb.scale]);
      }, this.app.config.orbTimeoutSeconds * 1000);
    }
  }
}
