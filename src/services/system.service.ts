import type { Service } from '../shard.service';

export class SystemService {
  constructor(private ctx: Service) {}

  init() {}
}
