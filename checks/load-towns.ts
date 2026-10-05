import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseTown, type TownManifest } from '../packages/town-model/src/core';

export const ROOT = new URL('..', import.meta.url).pathname;

export function loadTowns(): { towns: TownManifest[]; errors: string[] } {
  const towns: TownManifest[] = [];
  const errors: string[] = [];
  for (const dir of readdirSync(join(ROOT, 'towns'))) {
    const file = join(ROOT, 'towns', dir, 'town.yaml');
    if (!existsSync(file)) continue;
    const { town, errors: e } = parseTown(readFileSync(file, 'utf8'));
    for (const x of e) errors.push(`towns/${dir}/town.yaml: ${x}`);
    if (town && town.town !== dir) errors.push(`towns/${dir}/town.yaml: town "${town.town}" does not match its directory`);
    if (town) towns.push(town);
  }
  return { towns, errors };
}
