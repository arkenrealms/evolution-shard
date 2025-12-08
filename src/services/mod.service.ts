// evolution/packages/shard/src/services/mod.service.ts
//
import { isNumeric } from '@arken/node/util';
import { sleep } from '@arken/node/util/time';
import { presets } from '@arken/evolution-protocol/presets';
import type * as Shard from '@arken/evolution-protocol/shard/shard.types';
import type { Service } from '../shard.service';

export class ModService {
  constructor(private ctx: Service) {}

  init() {}

  async startBattleRoyale(
    input: Shard.RouterInput['startBattleRoyale'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['startBattleRoyale']> {
    this.ctx.emitAll.onBroadcast.mutate([`Battle Royale in 3...`, 1]);
    await sleep(1 * 1000);
    this.ctx.emitAll.onBroadcast.mutate([`Battle Royale in 2...`, 1]);
    await sleep(1 * 1000);
    this.ctx.emitAll.onBroadcast.mutate([`Battle Royale in 1...`, 1]);
    await sleep(1 * 1000);
    this.ctx.baseConfig.isBattleRoyale = true;
    this.ctx.config.isBattleRoyale = true;
    this.ctx.baseConfig.isGodParty = false;
    this.ctx.config.isGodParty = false;
    this.ctx.emitAll.onBroadcast.mutate([`Battle Royale Started`, 3]);
    this.ctx.emitAll.onBroadcast.mutate([`God Party Stopped`, 3]);
  }

  async stopBattleRoyale(
    input: Shard.RouterInput['stopBattleRoyale'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['stopBattleRoyale']> {
    this.ctx.baseConfig.isBattleRoyale = false;
    this.ctx.config.isBattleRoyale = false;
    this.ctx.emitAll.onBroadcast.mutate([`Battle Royale Stopped`, 0]);
  }

  async pauseRound(
    input: Shard.RouterInput['pauseRound'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['pauseRound']> {
    clearTimeout(this.ctx.roundLoopTimeout);
    this.ctx.baseConfig.isRoundPaused = true;
    this.ctx.config.isRoundPaused = true;
    this.ctx.emitAll.onRoundPaused.mutate();
    this.ctx.emitAll.onBroadcast.mutate([`Round Paused`, 0]);
  }

  async startRound(
    input: Shard.RouterInput['startRound'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['startRound']> {
    if (!input) throw new Error('Input should not be void');
    if (this.ctx.config.isRoundPaused) {
      this.ctx.baseConfig.isRoundPaused = false;
      this.ctx.config.isRoundPaused = false;
    }
    clearTimeout(this.ctx.roundLoopTimeout);
    this.ctx.services.core.resetLeaderboard(
      presets.find((p) => p.gameMode === input.gameMode),
      { client }
    );
  }

  async enableForceLevel2(
    input: Shard.RouterInput['enableForceLevel2'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['enableForceLevel2']> {
    this.ctx.baseConfig.level2forced = true;
    this.ctx.config.level2forced = true;
  }

  async disableForceLevel2(
    input: Shard.RouterInput['disableForceLevel2'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['disableForceLevel2']> {
    this.ctx.baseConfig.level2forced = false;
    this.ctx.config.level2forced = false;
  }

  async startGodParty(
    input: Shard.RouterInput['startGodParty'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['startGodParty']> {
    this.ctx.baseConfig.isGodParty = true;
    this.ctx.config.isGodParty = true;
    this.ctx.emitAll.onBroadcast.mutate([`God Party Started`, 0]);
  }

  async stopGodParty(
    input: Shard.RouterInput['stopGodParty'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['stopGodParty']> {
    this.ctx.baseConfig.isGodParty = false;
    this.ctx.config.isGodParty = false;
    for (const client of this.ctx.clients) {
      client.isInvincible = false;
    }
    this.ctx.emitAll.onBroadcast.mutate([`God Party Stopped`, 2]);
  }

  async startRoyale(
    input: Shard.RouterInput['startRoyale'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['startRoyale']> {
    this.ctx.baseConfig.isRoyale = true;
    this.ctx.config.isRoyale = true;
    this.ctx.emitAll.onBroadcast.mutate([`Royale Started`, 0]);
  }

  async pauseRoyale(
    input: Shard.RouterInput['pauseRoyale'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['pauseRoyale']> {
    this.ctx.emitAll.onBroadcast.mutate([`Royale Paused`, 2]);
  }

  async unpauseRoyale(
    input: Shard.RouterInput['unpauseRoyale'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['unpauseRoyale']> {
    this.ctx.emitAll.onBroadcast.mutate([`Royale Unpaused`, 2]);
  }

  async stopRoyale(
    input: Shard.RouterInput['stopRoyale'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['stopRoyale']> {
    this.ctx.baseConfig.isRoyale = false;
    this.ctx.config.isRoyale = false;
    this.ctx.emitAll.onBroadcast.mutate([`Royale Stopped`, 2]);
  }

  async makeBattleHarder(
    input: Shard.RouterInput['makeBattleHarder'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['makeBattleHarder']> {
    this.ctx.baseConfig.dynamicDecayPower = false;
    this.ctx.config.dynamicDecayPower = false;
    this.ctx.sharedConfig.decayPower += 2;
    this.ctx.config.decayPower += 2;
    this.ctx.sharedConfig.baseSpeed += 1;
    this.ctx.config.baseSpeed += 1;
    this.ctx.sharedConfig.checkPositionDistance += 1;
    this.ctx.config.checkPositionDistance += 1;
    this.ctx.sharedConfig.checkInterval += 1;
    this.ctx.config.checkInterval += 1;
    this.ctx.sharedConfig.spritesStartCount -= 10;
    this.ctx.config.spritesStartCount -= 10;
    this.ctx.emitAll.onSetPositionMonitor.mutate([
      this.ctx.config.checkPositionDistance,
      this.ctx.config.checkInterval,
      this.ctx.config.resetInterval,
    ]);
    this.ctx.emitAll.onBroadcast.mutate([`Difficulty Increased!`, 2]);
  }

  async makeBattleEasier(
    input: Shard.RouterInput['makeBattleEasier'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['makeBattleEasier']> {
    this.ctx.baseConfig.dynamicDecayPower = false;
    this.ctx.config.dynamicDecayPower = false;
    this.ctx.sharedConfig.decayPower -= 2;
    this.ctx.config.decayPower -= 2;
    this.ctx.sharedConfig.baseSpeed -= 1;
    this.ctx.config.baseSpeed -= 1;
    this.ctx.sharedConfig.checkPositionDistance -= 1;
    this.ctx.config.checkPositionDistance -= 1;
    this.ctx.sharedConfig.checkInterval -= 1;
    this.ctx.config.checkInterval -= 1;
    this.ctx.sharedConfig.spritesStartCount += 10;
    this.ctx.config.spritesStartCount += 10;
    this.ctx.emitAll.onSetPositionMonitor.mutate([
      this.ctx.config.checkPositionDistance,
      this.ctx.config.checkInterval,
      this.ctx.config.resetInterval,
    ]);
    this.ctx.emitAll.onBroadcast.mutate([`Difficulty Decreased!`, 0]);
  }

  async resetBattleDifficulty(
    input: Shard.RouterInput['resetBattleDifficulty'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['resetBattleDifficulty']> {
    this.ctx.baseConfig.dynamicDecayPower = true;
    this.ctx.config.dynamicDecayPower = true;
    this.ctx.sharedConfig.decayPower = 1.4;
    this.ctx.config.decayPower = 1.4;
    this.ctx.sharedConfig.baseSpeed = 3;
    this.ctx.config.baseSpeed = 3;
    this.ctx.sharedConfig.checkPositionDistance = 2;
    this.ctx.config.checkPositionDistance = 2;
    this.ctx.sharedConfig.checkInterval = 1;
    this.ctx.config.checkInterval = 1;
    this.ctx.emitAll.onSetPositionMonitor.mutate([
      this.ctx.config.checkPositionDistance,
      this.ctx.config.checkInterval,
      this.ctx.config.resetInterval,
    ]);
    this.ctx.emitAll.onBroadcast.mutate([`Difficulty Reset!`, 0]);
  }

  async messageUser(
    input: Shard.RouterInput['messageUser'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['messageUser']> {
    if (!input) throw new Error('Input should not be void');
    const targetClient = this.ctx.clients.find((c) => c.address === input.target);
    if (!targetClient) throw new Error('Target not found');
    this.ctx.sockets[targetClient.id].emitAll.onBroadcast.mutate([input.message.replace(/:/gi, ''), 0]);
  }

  async changeUser(
    input: Shard.RouterInput['changeUser'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['changeUser']> {
    if (!input) throw new Error('Input should not be void');
    const newClient = this.ctx.clients.find((c) => c.address === input.target);
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
    this.ctx.emitAll.onBroadcast.mutate([input.replace(/:/gi, ''), 0]);
  }

  async kickClient(
    input: Shard.RouterInput['kickClient'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['kickClient']> {
    if (!input) throw new Error('Input should not be void');
    const targetClient = this.ctx.clients.find((c) => c.address === input.target);
    if (!targetClient) throw new Error('Target not found');
    this.ctx.disconnectClient(targetClient, 'kicked');
  }

  async restart(
    input: Shard.RouterInput['restart'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['restart']> {
    this.ctx.emitAll.onBroadcast.mutate([`Server is rebooting in 10 seconds`, 3]);
    await sleep(10 * 1000);
    process.exit(1);
  }

  async maintenance(
    input: Shard.RouterInput['maintenance'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['maintenance']> {
    this.ctx.sharedConfig.isMaintenance = true;
    this.ctx.config.isMaintenance = true;
    this.ctx.emitAll.onMaintenance.mutate([this.ctx.config.isMaintenance]);
  }

  async unmaintenance(
    input: Shard.RouterInput['unmaintenance'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['unmaintenance']> {
    this.ctx.sharedConfig.isMaintenance = false;
    this.ctx.config.isMaintenance = false;
    this.ctx.emitAll.onUnmaintenance.mutate([this.ctx.config.isMaintenance]);
  }
}
