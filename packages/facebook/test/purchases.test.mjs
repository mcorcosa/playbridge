import assert from 'node:assert/strict';
import test from 'node:test';
import { createFacebookPurchases } from '../dist/index.js';

test('reports explicit checkout outcomes and normalizes receipts for reconciliation', async () => {
  const sku = 'example';
  const receipt = { productID: sku, purchaseToken: 'test-token' };
  const payments = {
    onReady: ready => ready(),
    getPurchasesAsync: async () => [receipt],
    purchaseAsync: async () => receipt,
  };
  const adapter = createFacebookPurchases(() => payments);
  const expected = { productId: sku, state: 'active', receiptToken: 'test-token' };
  assert.deepEqual(await adapter.checkout(sku), { status: 'completed', value: expected });
  assert.deepEqual(await adapter.inventory(), { status: 'completed', value: [expected] });
  assert.deepEqual(await adapter.checkout(sku, () => false), { status: 'cancelled' });
  assert.deepEqual(await adapter.catalog(), { status: 'unsupported' });
  payments.purchaseAsync = async () => ({ ...receipt, productID: 'different' });
  assert.deepEqual(await adapter.checkout(sku), { status: 'pending' });
  payments.purchaseAsync = async () => { throw { code: 'PAYMENTS_USER_CANCELLED' }; };
  assert.equal((await adapter.checkout(sku)).status, 'cancelled');
});
