// evolution/packages/shard/src/services/auth.service.ts
//
import { log, getTime } from '@arken/node/util';
import type * as Shard from '@arken/evolution-protocol/shard/shard.types';
import type { Service } from '../shard.service';

export class AuthService {
  constructor(private ctx: Service) {}

  init() {}

  generateGuestName(): string {
    const randomIndex = Math.floor(Math.random() * this.ctx.guestNames.length);
    return this.ctx.guestNames[randomIndex];
  }

  // Method to verify if a signature request is valid
  async auth(input: Shard.RouterInput['auth'], { client }: Shard.ServiceContext): Promise<Shard.RouterOutput['auth']> {
    if (!input) throw new Error('Input should not be void');

    log('Verifying', input.data);

    if (!input.signature.address) throw new Error('Signature problem');

    const res = await this.ctx.realm.emit.auth.mutate({ data: input.data, signature: input.signature });

    console.log('Realm auth response', res.roles, client.roles);

    if (!res) throw new Error('Auth problem');

    client.roles = res.roles;
    client.isSeer = res.roles.includes('seer');
    client.isAdmin = res.roles.includes('admin');
    client.isMod = res.roles.includes('mod');
  }

  async login(
    input: Shard.RouterInput['login'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['login']> {
    if (!input) throw new Error('Input should not be void');

    log('Login', input);

    if (!input.signature || !input.network || !input.device || !input.address) {
      client.log.signinProblem += 1;
      this.ctx.disconnectClient(client, 'signin problem');

      throw new Error('Invalid request');
    }

    // if (!this.ctx.realm && input.address === '') {
    //   this.ctx.realm = { client, emit: null };
    // }

    const address = await this.ctx.normalizeAddress(input.address);
    log('Login normalizeAddress', input.address, address);
    if (!address) {
      client.log.addressProblem += 1;
      this.ctx.disconnectClient(client, 'address problem');
      throw new Error('Address problem');
    }

    try {
      await this.ctx.auth(
        {
          data: 'evolution',
          signature: { hash: input.signature.trim(), address },
        },
        { client }
      );
    } catch (e) {
      client.log.signatureProblem += 1;
      this.ctx.disconnectClient(client, 'signature problem');

      throw new Error('Signature problem');
    }

    if (client.isBanned) {
      this.ctx.emit.onBanned.mutate([true], { context: { client } });
      this.ctx.disconnectClient(client, 'banned');
      throw new Error('Banned');
    }

    if (this.ctx.config.isMaintenance && !client.isMod) {
      client.log.maintenanceJoin += 1;
      this.ctx.emit.onMaintenance.mutate([true], { context: { client } });
      this.ctx.disconnectClient(client, 'maintenance');
      throw new Error('Maintenance');
    }

    const profile =
      this.ctx.addressToProfile[address] || (await this.ctx.realm.emit.confirmProfile.mutate({ address }));

    this.ctx.addressToProfile[address] = profile;

    if (this.ctx.config.isMaintenance && !client.isMod) {
      this.ctx.emit.onMaintenance.mutate([true], { context: { client } });
      this.ctx.disconnectClient(client, 'maintenance');
      throw new Error('Maintenance');
    }

    if (profile.isBanned) {
      this.ctx.disconnectClient(client, 'banned');
      throw new Error('Banned');
    }

    if (profile.isMod) {
      client.isMod = true;
    }

    let name = this.ctx.addressToProfile[address].name || this.generateGuestName();

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
      const recentClient = this.ctx.round.clients.find((r) => r.address === address);
      if (recentClient && now - recentClient.lastUpdate < 3000) {
        client.log.recentJoinProblem += 1;
        this.ctx.disconnectClient(client, 'joined too soon', true);
        throw new Error('Joined too soon');
      }
      // Object.assign(client, recentClient);
      client.log.connects += 1;
    }

    this.ctx.emit.onLogin.mutate([client.id, client.name, client.network, client.address, client.device], {
      context: { client },
    });

    if (this.ctx.config.log.connections) {
      log('Connected', { hash: client.hash, address: client.address, name: client.name });
    }
  }

  async seerConnected(
    input: Shard.RouterInput['seerConnected'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['seerConnected']> {
    this.ctx.emitAll.onBroadcast.mutate(['Seer connected', 0]);
  }

  async seerDisconnected(
    input: Shard.RouterInput['seerDisconnected'],
    { client }: Shard.ServiceContext
  ): Promise<Shard.RouterOutput['seerDisconnected']> {
    this.ctx.emitAll.onBroadcast.mutate(['Seer disconnected', 0]);
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
    const newClient = this.ctx.clients.find((c) => c.address === input.address);
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
    return this.ctx.config;
  }
}
