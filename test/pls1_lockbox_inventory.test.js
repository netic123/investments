'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const inventory = require('../scripts/pls1-lockbox-inventory');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pls1-inventory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const expected = [
    'freeze/seed.json',
    'freeze/seed.json.sha256',
    'raw/sha256/ab/ab.json.gz',
    'decisions/2026/08/28/r000/decision.json',
    'decisions/2026/08/28/r000/decision.json.sha256',
  ];
  for (const relative of expected) {
    const file = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, relative);
  }
  return { root, expected };
}

test('closed inventory accepts exactly declared real files and directories', t => {
  const { root, expected } = fixture(t);
  const result = inventory.assertClosedInventory(root, expected);
  assert.deepEqual(result.files, [...expected].sort());
  assert.match(result.inventorySha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(result), true);
});

test('unknown files, orphan raw blobs, missing files, and empty directories fail closed', async t => {
  await t.test('unknown file', nested => {
    const { root, expected } = fixture(nested);
    fs.writeFileSync(path.join(root, 'unknown.txt'), 'unknown');
    assert.throws(() => inventory.assertClosedInventory(root, expected), /unknown=unknown\.txt/);
  });
  await t.test('orphan raw blob', nested => {
    const { root, expected } = fixture(nested);
    const orphan = path.join(root, 'raw', 'sha256', 'cd', 'cd.json.gz');
    fs.mkdirSync(path.dirname(orphan), { recursive: true });
    fs.writeFileSync(orphan, 'orphan');
    assert.throws(() => inventory.assertClosedInventory(root, expected), /cd\.json\.gz/);
  });
  await t.test('missing expected file', nested => {
    const { root, expected } = fixture(nested);
    fs.unlinkSync(path.join(root, 'freeze', 'seed.json'));
    assert.throws(() => inventory.assertClosedInventory(root, expected), /missing=freeze\/seed\.json/);
  });
  await t.test('unknown empty directory', nested => {
    const { root, expected } = fixture(nested);
    fs.mkdirSync(path.join(root, 'empty'));
    assert.throws(() => inventory.assertClosedInventory(root, expected), /unknown=empty/);
  });
});

test('expected traversal and absolute paths outside the lockbox are rejected', t => {
  const { root, expected } = fixture(t);
  assert.throws(() => inventory.assertClosedInventory(root, [...expected, '../escape']), /escapes/);
  assert.throws(() => inventory.assertClosedInventory(root, [...expected, path.join(os.tmpdir(), 'escape')]),
    /escapes/);
});

test('directory links and reparse aliases are rejected rather than traversed', t => {
  const { root, expected } = fixture(t);
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'pls1-inventory-target-'));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  const linked = path.join(root, 'linked');
  try {
    fs.symlinkSync(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) {
      t.skip(`filesystem cannot create a test link: ${error.code}`);
      return;
    }
    throw error;
  }
  assert.throws(() => inventory.assertClosedInventory(root, expected), /links and reparse paths are forbidden/);
});

test('regular files with multiple hard links are rejected', t => {
  const { root, expected } = fixture(t);
  const source = path.join(root, 'freeze', 'seed.json');
  const externalLink = `${root}-hard-link`;
  t.after(() => fs.rmSync(externalLink, { force: true }));

  try {
    fs.linkSync(source, externalLink);
  } catch (error) {
    if (['EACCES', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV'].includes(error.code)) {
      t.skip(`filesystem cannot create a hard link: ${error.code}`);
      return;
    }
    throw error;
  }

  assert.ok(fs.lstatSync(source).nlink > 1, 'test filesystem must report the additional hard link');
  assert.throws(
    () => inventory.assertClosedInventory(root, expected),
    /freeze\/seed\.json: regular lockbox files must have exactly one hard link \(nlink=\d+\)/,
  );
});
