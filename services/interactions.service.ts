// evolution/packages/shard/src/services/interactions.service.ts
import * as util from '@arken/node/util';
import type { GameObjectDef, QuestDef, PatchOp, EntityPatch } from '@arken/seer-protocol/types';
import type { Service } from '../shard.service';

const METAVERSE_ID = 'arken';

// World objects (ElonTusk lives here)
const WORLD_OBJECTS: GameObjectDef[] = [
  {
    id: 'npc.zazu',
    type: 'npc',
    name: 'Zazu',
    position: { x: 0, y: 0 },
    radius: 1.25,
    tags: ['quest'],
  },
  {
    id: 'npc.harold',
    type: 'npc',
    name: 'Harold',
    position: { x: -23, y: -3 },
    radius: 1.0,
    tags: ['shop'],
  },
  {
    id: 'npc.elon_tusk',
    type: 'npc',
    name: 'Elon Tusk',
    position: { x: -37.5, y: -13.5 },
    radius: 1.0,
    tags: ['modifier', 'luck'],
    meta: {
      effect: { kind: 'zone.modifier', key: 'luck', value: 10, max: 10 },
    },
  },
  {
    id: 'portal.meme_to_mage',
    type: 'portal',
    name: 'MageIslesPortal',
    position: { x: 18.3, y: -4.3 },
    radius: 1.0,
  },
];

// Multiple simultaneous quests supported: just add more defs.
// runic-bag lives here as an EFFECT (not a “reward flag”)
const QUESTS: QuestDef[] = [
  {
    id: 'evolution.act1.isle_exploration',
    metaverseId: METAVERSE_ID,
    name: 'Isle Exploration',
    requirements: [
      { kind: 'exists', key: 'character.quest.evolution.act1.isle_exploration.exploredAt' },
      {
        kind: 'touchedObject',
        objectId: 'npc.zazu',
        afterKey: 'character.quest.evolution.act1.isle_exploration.exploredAt',
        writeKey: 'character.quest.evolution.act1.isle_exploration.zazuTouchedAt',
      },
    ],
    effects: [
      { kind: 'item.grant', itemKey: 'runic-bag', quantity: 1 },
      // completion bookkeeping is an EFFECT too, but now it’s expressed as state.patch
      {
        kind: 'state.patch',
        patch: {
          entityType: 'character',
          entityId: '__self__',
          ops: [
            { op: 'set', key: 'character.quest.evolution.act1.isle_exploration.completedAt', value: '__now_iso__' },
          ],
        },
      },
    ],
    writes: ['character.quest.evolution.act1.isle_exploration.zazuTouchedAt'],
  },
];

const CELL = 5;
const TOUCH_SCAN_RADIUS = 6; // query radius around player to find interactables

function cellKey(x: number, y: number) {
  return `${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`;
}

export class InteractionsService {
  private objectGrid: Record<string, GameObjectDef[]> = {};
  private lastClientCell: Record<string, string> = {};

  constructor(private ctx: Service) {}

  init() {
    this.rebuildObjectIndex();
  }

  rebuildObjectIndex() {
    this.objectGrid = {};
    for (const o of WORLD_OBJECTS) {
      const k = cellKey(o.position.x, o.position.y);
      (this.objectGrid[k] ||= []).push(o);
    }
  }

  private distance(a: { x: number; y: number }, b: { x: number; y: number }) {
    return util.physics.distanceBetweenPoints(a, b);
  }

  private queryObjectsNear(pos: { x: number; y: number }, radius: number): GameObjectDef[] {
    const cx = Math.floor(pos.x / CELL);
    const cy = Math.floor(pos.y / CELL);
    const rCells = Math.ceil(radius / CELL);

    const out: GameObjectDef[] = [];
    for (let dx = -rCells; dx <= rCells; dx++) {
      for (let dy = -rCells; dy <= rCells; dy++) {
        const bucket = this.objectGrid[`${cx + dx}:${cy + dy}`];
        if (!bucket) continue;
        out.push(...bucket);
      }
    }

    return out.filter((o) => this.distance(pos, o.position) <= radius);
  }

  private parseMs(v: any): number {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }

  private hasMeta(client: any, key: string) {
    const v = client?.character?.meta?.[key];
    return v !== undefined && v !== null;
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

    // optimistic cache update (keeps UI + quest eval responsive on shard)
    client.character ??= {};
    client.character.meta ??= {};
    for (const op of ops) {
      if (op.op === 'set') client.character.meta[op.key] = op.value;
      if (op.op === 'unset') delete client.character.meta[op.key];
      if (op.op === 'inc') {
        client.character.meta[op.key] = (Number(client.character.meta[op.key] ?? 0) || 0) + op.value;
      }
      if (op.op === 'push') {
        const arr = (client.character.meta[op.key] ||= []);
        if (Array.isArray(arr)) arr.push(op.value);
      }
      if (op.op === 'merge') {
        client.character.meta[op.key] = { ...(client.character.meta[op.key] || {}), ...op.value };
      }
    }

    client.questDirty = true;
  }

  // Called once per shard tick (fast loop), NOT per updateMyself
  tick(nowMs: number) {
    for (const client of this.ctx.clients) {
      if (client.isDead || client.isSpectating || client.isJoining) continue;
      if (!client.position) continue;

      const ck = cellKey(client.position.x, client.position.y);
      const movedCell = this.lastClientCell[client.id] !== ck;

      // only evaluate if moved across grid or was marked dirty
      if (!movedCell && !client.questDirty) continue;

      this.lastClientCell[client.id] = ck;
      client.questDirty = false;

      const nearby = this.queryObjectsNear(client.position, TOUCH_SCAN_RADIUS);

      // World object interactions
      for (const obj of nearby) {
        const touching = this.distance(client.position, obj.position) <= (obj.radius ?? 1);

        if (obj.id === 'npc.harold') {
          if (touching) {
            if (!client.ui.includes('shop')) client.ui.push('shop');
            this.ctx.emit.onShowUI.mutate('shop', { context: { client } });
          } else if (client.ui.includes('shop')) {
            client.ui = client.ui.filter((u) => u !== 'shop');
            this.ctx.emit.onHideUI.mutate('shop', { context: { client } });
          }
        }

        if (obj.id === 'portal.meme_to_mage' && touching) {
          this.ctx.currentGame =
            this.ctx.currentGame.key === 'meme-isles' ? this.ctx.games.MageIsles : this.ctx.games.MemeIsles;
          this.ctx.currentZone = this.ctx.currentGame.zones[0];
          this.ctx.emit.onChangeGame.mutate('MemeIsles', { context: { client } });
        }

        if (obj.meta?.effect?.kind === 'zone.modifier' && touching) {
          const { key, value, max } = obj.meta.effect;
          const current = this.ctx.currentZone.modifiers[key] ?? 0;
          if (current < max) {
            this.ctx.currentZone.modifiers[key] = Math.min(max, current + value);
          }
        }
      }

      // Quest requirement evaluation for touchedObject requirements
      for (const quest of QUESTS) {
        if (quest.metaverseId !== METAVERSE_ID) continue;

        for (const req of quest.requirements) {
          if (req.kind !== 'touchedObject') continue;

          const obj = nearby.find((o) => o.id === req.objectId);
          if (!obj) continue;

          const touching = this.distance(client.position, obj.position) <= (obj.radius ?? 1);
          if (!touching) continue;

          if (req.afterKey && !this.hasMeta(client, req.afterKey)) continue;

          if (req.afterKey) {
            const afterMs = this.parseMs(client.character.meta[req.afterKey]);
            if (afterMs && nowMs < afterMs) continue;
          }

          if (this.hasMeta(client, req.writeKey)) continue;

          this.pushCharacterOps(client, [{ op: 'set', key: req.writeKey, value: new Date(nowMs).toISOString() }]);
        }
      }
    }
  }

  // Expose quests to other services (completeQuest uses these)
  getQuests() {
    return QUESTS;
  }
}
