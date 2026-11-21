import type { CatalogProduct, Outcome, PurchaseRecord, Purchases } from '@playbridge/core';

export interface FacebookPayments {
  onReady(callback: () => void): void;
  getCatalogAsync?(): Promise<unknown>;
  getPurchasesAsync(): Promise<unknown>;
  purchaseAsync?(config: { productID: string }): Promise<unknown>;
}

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error('Payments unavailable')), 8000);
    })]);
  } finally { clearTimeout(timer); }
}

function productId(value: unknown): string | undefined {
  if (typeof value !== 'object' || !value || !('productID' in value)) return;
  if (typeof value.productID === 'string' && value.productID.trim()) return value.productID;
}

function catalog(value: unknown): CatalogProduct[] {
  if (!Array.isArray(value)) throw new Error('Invalid purchase catalog.');
  return value.flatMap(item => {
    const id = productId(item);
    return id ? [{ productId: id, displayPrice: typeof item.price === 'string' ? item.price : null }] : [];
  });
}

function record(value: unknown): PurchaseRecord {
  const id = productId(value);
  if (!id) throw new Error('Invalid purchase entry.');
  const { isConsumed, purchaseToken } = value as { isConsumed?: unknown; purchaseToken?: unknown };
  if (isConsumed === true) return { productId: id, state: 'consumed' };
  if ((isConsumed === undefined || isConsumed === false) && typeof purchaseToken === 'string' && purchaseToken.trim()) {
    return { productId: id, state: 'active', receiptToken: purchaseToken };
  }
  return { productId: id, state: 'unverified' };
}

function inventory(value: unknown): PurchaseRecord[] {
  if (!Array.isArray(value)) throw new Error('Invalid purchase list.');
  return value.map(record);
}

export function createFacebookPurchases(getPayments: () => FacebookPayments | undefined): Purchases & { canCheckout(): boolean } {
  let readiness: Promise<void> | undefined;
  let readyPayments: FacebookPayments | undefined;
  let checkingOut = false;

  function canCheckout(): boolean {
    const payments = getPayments();
    return typeof payments?.purchaseAsync === 'function' && typeof payments.getCatalogAsync === 'function';
  }

  function ready(payments: FacebookPayments): Promise<void> {
    if (readyPayments !== payments) {
      readyPayments = payments;
      readiness = undefined;
    }
    readiness ??= new Promise<void>(resolve => payments.onReady(resolve)).catch(error => {
      if (readyPayments === payments) readiness = undefined;
      throw error;
    });
    return bounded(readiness);
  }

  async function read<T>(operation: 'getCatalogAsync' | 'getPurchasesAsync', decode: (value: unknown) => T): Promise<Outcome<T>> {
    try {
      const payments = getPayments();
      if (!payments || typeof payments.onReady !== 'function' || typeof payments[operation] !== 'function') {
        return { status: 'unsupported' };
      }
      await ready(payments);
      if (getPayments() !== payments) return { status: 'unavailable' };
      return { status: 'completed', value: decode(await bounded(payments[operation]!())) };
    } catch (error) { return { status: 'failed', error }; }
  }

  return {
    canCheckout,
    catalog: () => read('getCatalogAsync', catalog),
    inventory: () => read('getPurchasesAsync', inventory),
    async checkout(productId, isCurrent = () => true) {
      if (!productId.trim()) return { status: 'failed' };
      if (checkingOut) return { status: 'pending' };
      checkingOut = true;
      let attempted = false;
      try {
        const payments = getPayments();
        if (!payments) return { status: 'unavailable' };
        if (typeof payments.purchaseAsync !== 'function' || typeof payments.onReady !== 'function') return { status: 'unsupported' };
        await ready(payments);
        if (getPayments() !== payments) return { status: 'unavailable' };
        if (!isCurrent()) return { status: 'cancelled' };
        attempted = true;
        const receipt = record(await payments.purchaseAsync({ productID: productId }));
        return receipt.state === 'active' && receipt.productId === productId
          ? { status: 'completed', value: receipt } : { status: 'pending' };
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'PAYMENTS_USER_CANCELLED') {
          return { status: 'cancelled' };
        }
        return { status: attempted ? 'pending' : 'failed', error };
      } finally { checkingOut = false; }
    },
  };
}
