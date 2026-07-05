import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface MigrationJournal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationDirectory = resolve(repositoryRoot, 'apps/api/drizzle');
const metadataDirectory = resolve(migrationDirectory, 'meta');
const journalPath = resolve(metadataDirectory, '_journal.json');
const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as MigrationJournal;

assert.equal(journal.version, '7');
assert.equal(journal.dialect, 'postgresql');
assert.ok(Array.isArray(journal.entries));
assert.ok(journal.entries.length > 0);

const tags = new Set<string>();
let previousTimestamp = -1;

for (const [position, entry] of journal.entries.entries()) {
  assert.equal(entry.idx, position, `Migration idx mismatch for ${entry.tag}.`);
  assert.equal(entry.version, journal.version, `Migration version mismatch for ${entry.tag}.`);
  assert.equal(entry.breakpoints, true, `Breakpoints must remain enabled for ${entry.tag}.`);
  assert.match(entry.tag, /^\d{4}_[a-z0-9_]+$/u);
  assert.ok(Number.isSafeInteger(entry.when), `Invalid migration timestamp for ${entry.tag}.`);
  assert.ok(
    entry.when > previousTimestamp,
    `Migration timestamps must be strictly increasing: ${entry.tag}.`,
  );
  assert.equal(tags.has(entry.tag), false, `Duplicate migration tag ${entry.tag}.`);

  const prefix = entry.tag.slice(0, 4);
  assert.equal(
    prefix,
    String(position).padStart(4, '0'),
    `Migration prefix mismatch: ${entry.tag}.`,
  );

  const sqlPath = resolve(migrationDirectory, `${entry.tag}.sql`);
  const snapshotPath = resolve(metadataDirectory, `${prefix}_snapshot.json`);
  assert.ok(readFileSync(sqlPath, 'utf8').trim().length > 0, `Empty migration ${entry.tag}.`);
  assert.ok(readFileSync(snapshotPath, 'utf8').trim().length > 0, `Empty snapshot ${prefix}.`);

  previousTimestamp = entry.when;
  tags.add(entry.tag);
}

const sqlTags = readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
  .map((name) => name.replace(/\.sql$/u, ''))
  .sort();
const snapshotPrefixes = readdirSync(metadataDirectory)
  .filter((name) => /^\d{4}_snapshot\.json$/u.test(name))
  .map((name) => name.slice(0, 4))
  .sort();

assert.deepEqual(sqlTags, [...tags].sort(), 'Journal and SQL migration files differ.');
assert.deepEqual(
  snapshotPrefixes,
  journal.entries.map((entry) => entry.tag.slice(0, 4)).sort(),
  'Journal and migration snapshots differ.',
);

console.log('Migration journal integrity PASS.');
console.log(
  JSON.stringify(
    {
      migrations: journal.entries.length,
      first: journal.entries[0]?.tag,
      last: journal.entries.at(-1)?.tag,
      timestampsStrictlyIncreasing: true,
      sqlFilesMatchJournal: true,
      snapshotsMatchJournal: true,
    },
    null,
    2,
  ),
);
