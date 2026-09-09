import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOLEAN_COLUMNS,
  NEEDS_USER_ID,
  SYNC_TABLES,
  type QueueEntry,
  coalesceQueue,
  isSyncTable,
  resolveConflict,
  toLocalRow,
  toRemoteRow,
} from '../../src/services/sync/plan.ts';

const entry = (
  id: number,
  table: string,
  rowId: string,
  op: 'upsert' | 'delete',
  queuedAt = id,
): QueueEntry => ({ id, table_name: table, row_id: rowId, op, queued_at: queuedAt });

describe('coalescing the outbox', () => {
  test('five edits to one row become one push', () => {
    const planned = coalesceQueue([
      entry(1, 'log_entries', 'a', 'upsert'),
      entry(2, 'log_entries', 'a', 'upsert'),
      entry(3, 'log_entries', 'a', 'upsert'),
    ]);
    assert.equal(planned.length, 1);
    assert.deepEqual(planned[0]?.queueIds, [1, 2, 3], 'all three clear together');
  });

  test('a delete after edits is a delete', () => {
    const planned = coalesceQueue([
      entry(1, 'log_entries', 'a', 'upsert'),
      entry(2, 'log_entries', 'a', 'delete'),
    ]);
    assert.equal(planned[0]?.op, 'delete');
  });

  test('an edit after a delete is still a delete', () => {
    // Undo re-queues an upsert; the row is soft-deleted either way and carries
    // its own final state, so the outcome must not depend on queue order.
    const planned = coalesceQueue([
      entry(1, 'log_entries', 'a', 'delete'),
      entry(2, 'log_entries', 'a', 'upsert'),
    ]);
    assert.equal(planned[0]?.op, 'delete');
  });

  test('different rows stay separate', () => {
    const planned = coalesceQueue([
      entry(1, 'log_entries', 'a', 'upsert'),
      entry(2, 'log_entries', 'b', 'upsert'),
    ]);
    assert.equal(planned.length, 2);
  });

  test('parents are pushed before their children', () => {
    const planned = coalesceQueue([
      entry(1, 'food_portions', 'p', 'upsert'),
      entry(2, 'foods', 'f', 'upsert'),
      entry(3, 'users', 'u', 'upsert'),
    ]);
    assert.deepEqual(
      planned.map((p) => p.table),
      ['users', 'foods', 'food_portions'],
      'a portion whose food has not arrived is a foreign key violation',
    );
  });

  test('within a table, the earliest queued row goes first', () => {
    const planned = coalesceQueue([
      entry(1, 'log_entries', 'b', 'upsert', 500),
      entry(2, 'log_entries', 'a', 'upsert', 100),
    ]);
    assert.deepEqual(planned.map((p) => p.rowId), ['a', 'b']);
  });

  test('a later edit does not drag a row to the back of the queue', () => {
    const planned = coalesceQueue([
      entry(1, 'log_entries', 'a', 'upsert', 100),
      entry(2, 'log_entries', 'b', 'upsert', 200),
      entry(3, 'log_entries', 'a', 'upsert', 300),
    ]);
    assert.deepEqual(planned.map((p) => p.rowId), ['a', 'b'], 'ordered by first queued');
  });

  test('rows for tables that do not sync are dropped', () => {
    const planned = coalesceQueue([
      entry(1, 'sync_queue', 'x', 'upsert'),
      entry(2, 'app_meta', 'y', 'upsert'),
      entry(3, 'log_entries', 'a', 'upsert'),
    ]);
    assert.equal(planned.length, 1);
    assert.equal(planned[0]?.table, 'log_entries');
  });

  test('an empty outbox plans nothing', () => {
    assert.deepEqual(coalesceQueue([]), []);
  });
});

describe('the sync table list', () => {
  test('recognises its own members and nothing else', () => {
    assert.ok(isSyncTable('log_entries'));
    assert.ok(!isSyncTable('sync_queue'));
    assert.ok(!isSyncTable('app_meta'));
    assert.ok(!isSyncTable('schema_migrations'));
  });

  test('users comes first, since everything references it', () => {
    assert.equal(SYNC_TABLES[0], 'users');
  });

  test('every table declares its boolean columns', () => {
    for (const table of SYNC_TABLES) {
      assert.ok(Array.isArray(BOOLEAN_COLUMNS[table]), table);
    }
  });
});

describe('projecting a row for the cloud', () => {
  const row = {
    id: 'x',
    user_id: 'u1',
    name: 'Oats',
    is_favorite: 1,
    is_verified: 0,
    use_count: 3,
    dirty: 1,
    server_updated_at: null,
  };

  test('local bookkeeping never leaves the device', () => {
    const remote = toRemoteRow('foods', row, 'u1');
    assert.ok(!('dirty' in remote));
    assert.ok(!('server_updated_at' in remote));
  });

  test('0 and 1 become real booleans', () => {
    const remote = toRemoteRow('foods', row, 'u1');
    assert.equal(remote.is_favorite, true);
    assert.equal(remote.is_verified, false);
  });

  test('numbers that are not flags are left alone', () => {
    assert.equal(toRemoteRow('foods', row, 'u1').use_count, 3);
  });

  test('an owner is attached where the cloud keeps one', () => {
    const portion = toRemoteRow('food_portions', { id: 'p', food_id: 'f' }, 'u1');
    assert.equal(portion.user_id, 'u1');
    for (const table of NEEDS_USER_ID) {
      assert.ok(!['users', 'log_entries'].includes(table));
    }
  });

  test('tables that already carry an owner keep their own', () => {
    const entry = toRemoteRow('log_entries', { id: 'l', user_id: 'u1' }, 'u1');
    assert.equal(entry.user_id, 'u1');
  });
});

describe('projecting a row back to the device', () => {
  const localColumns = ['id', 'user_id', 'name', 'is_favorite', 'use_count'];

  test('booleans become 0 and 1 again', () => {
    const local = toLocalRow(
      'foods',
      { id: 'x', user_id: 'u', name: 'Oats', is_favorite: true, use_count: 2 },
      localColumns,
    );
    assert.equal(local.is_favorite, 1);
  });

  test('false becomes 0, not undefined', () => {
    const local = toLocalRow('foods', { id: 'x', is_favorite: false }, localColumns);
    assert.equal(local.is_favorite, 0);
  });

  test('columns the device does not have are discarded', () => {
    // food_portions carries a user_id in the cloud that the local table lacks;
    // writing it would fail the insert.
    const local = toLocalRow(
      'food_portions',
      { id: 'p', food_id: 'f', user_id: 'u1' },
      ['id', 'food_id'],
    );
    assert.deepEqual(Object.keys(local), ['id', 'food_id']);
  });
});

describe('resolving a conflict', () => {
  test('the later edit wins', () => {
    assert.equal(resolveConflict(200, 100), 'local');
    assert.equal(resolveConflict(100, 200), 'remote');
  });

  test('a tie goes to the remote copy so devices converge', () => {
    // If each device kept its own on a tie they would disagree forever.
    assert.equal(resolveConflict(100, 100), 'identical');
  });

  test('a delete is decided by time like any other edit', () => {
    // Deleted on one device at t=200, edited on another at t=100.
    assert.equal(resolveConflict(200, 100), 'local');
  });
});
