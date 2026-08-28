'use strict';

const fs = require('node:fs');
const path = require('node:path');
const common = require('./pls1-lockbox-common');
const model = require('../research/fear_greed_control_residual_pls1');

function relativeIdentity(root, value) {
  const absolute = path.isAbsolute(String(value))
    ? path.resolve(String(value)) : path.resolve(root, String(value));
  if (!common.isPathWithin(root, absolute)) {
    throw new Error(`${value}: inventory path escapes the lockbox root`);
  }
  const relative = path.relative(path.resolve(root), absolute).replace(/\\/g, '/');
  if (!relative || relative === '.' || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error(`${value}: inventory path is not one lockbox file`);
  }
  return relative;
}

function parentDirectories(relativeFile) {
  const directories = [];
  let current = path.posix.dirname(relativeFile);
  while (current !== '.') {
    directories.push(current);
    current = path.posix.dirname(current);
  }
  return directories;
}

function walkClosedTree(root) {
  const rootStatus = fs.lstatSync(root);
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    throw new Error('lockbox root must be a real directory, not a link or reparse file');
  }
  const files = [];
  const directories = [];
  function walk(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      const status = fs.lstatSync(full);
      if (entry.isSymbolicLink() || status.isSymbolicLink()) {
        const relative = path.relative(path.resolve(root), full).replace(/\\/g, '/');
        throw new Error(`${relative}: links and reparse paths are forbidden in the lockbox`);
      }
      if (!common.isPathWithin(root, full)) throw new Error(`${full}: inventory traversal escaped root`);
      const relative = relativeIdentity(root, full);
      if (entry.isDirectory() && status.isDirectory()) {
        directories.push(relative);
        walk(full);
      } else if (entry.isFile() && status.isFile()) {
        if (status.nlink !== 1) {
          throw new Error(`${relative}: regular lockbox files must have exactly one hard link (nlink=${status.nlink})`);
        }
        files.push(relative);
      } else {
        throw new Error(`${relative}: unsupported lockbox filesystem object`);
      }
    }
  }
  walk(root);
  return { files: files.sort(), directories: directories.sort() };
}

function assertClosedInventory(root, expectedFiles) {
  if (!Array.isArray(expectedFiles) || !expectedFiles.length) {
    throw new Error('closed lockbox inventory requires at least one expected file');
  }
  const expected = expectedFiles.map(file => relativeIdentity(root, file));
  if (new Set(expected).size !== expected.length) {
    throw new Error('closed lockbox inventory contains duplicate expected paths');
  }
  expected.sort();
  const expectedDirectories = [...new Set(expected.flatMap(parentDirectories))].sort();
  const actual = walkClosedTree(root);
  if (model.canonicalStringify(actual.files) !== model.canonicalStringify(expected)) {
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual.files);
    const unknown = actual.files.filter(file => !expectedSet.has(file));
    const missing = expected.filter(file => !actualSet.has(file));
    throw new Error(`lockbox file inventory is not closed (unknown=${unknown.join(',') || '-'}; missing=${missing.join(',') || '-'})`);
  }
  if (model.canonicalStringify(actual.directories)
      !== model.canonicalStringify(expectedDirectories)) {
    const expectedSet = new Set(expectedDirectories);
    const actualSet = new Set(actual.directories);
    const unknown = actual.directories.filter(directory => !expectedSet.has(directory));
    const missing = expectedDirectories.filter(directory => !actualSet.has(directory));
    throw new Error(`lockbox directory inventory is not closed (unknown=${unknown.join(',') || '-'}; missing=${missing.join(',') || '-'})`);
  }
  return model.deepFreeze({
    files: expected,
    directories: expectedDirectories,
    inventorySha256: model.hashCanonical({ files: expected, directories: expectedDirectories }),
  });
}

module.exports = Object.freeze({
  relativeIdentity,
  parentDirectories,
  walkClosedTree,
  assertClosedInventory,
});
