export interface ServerQueryScope {
  context: 'customer' | 'staff' | 'account';
  ownerId: string;
  revision: number;
}

export type ServerQueryKey = readonly [
  'barghsa',
  string,
  ServerQueryScope['context'],
  string,
  number,
  ...string[],
];

/** Snapshot route params in a stable order; preserve repeated filter values. */
export function serverListParams(params: URLSearchParams) {
  const criteria = new URLSearchParams(params),
    pagination = new URLSearchParams();
  for (const name of ['cursor', 'offset', 'page']) {
    for (const value of criteria.getAll(name)) pagination.append(name, value);
    criteria.delete(name);
  }
  criteria.sort();
  pagination.sort();
  return { criteria: criteria.toString(), pagination: pagination.toString() };
}

function resourceKeys(resource: string) {
  const all = (scope: ServerQueryScope): ServerQueryKey => {
    if (!scope.ownerId.trim()) throw new Error('Query owner is required');
    return ['barghsa', resource, scope.context, scope.ownerId, scope.revision];
  };
  return {
    all,
    lists: (scope: ServerQueryScope): ServerQueryKey => [...all(scope), 'list'],
    list: (scope: ServerQueryScope, params: URLSearchParams): ServerQueryKey => {
      const { criteria, pagination } = serverListParams(params);
      return [...all(scope), 'list', criteria, pagination];
    },
    detail: (scope: ServerQueryScope, id: string): ServerQueryKey => [...all(scope), 'detail', id],
  };
}

const walletKeys = resourceKeys('wallet');

export const queryKeys = {
  profiles: resourceKeys('profiles'),
  orders: resourceKeys('orders'),
  invoices: resourceKeys('invoices'),
  contracts: resourceKeys('contracts'),
  dashboard: resourceKeys('dashboard'),
  wallet: {
    ...walletKeys,
    balance: (scope: ServerQueryScope): ServerQueryKey => [...walletKeys.all(scope), 'balance'],
  },
};

/** Previous rows are usable only during paging within the same owner and criteria. */
export function sameServerList(previous: readonly unknown[], next: ServerQueryKey) {
  return (
    previous.length === 8 &&
    next.length === 8 &&
    previous[5] === 'list' &&
    next[5] === 'list' &&
    previous.slice(0, 7).every((value, index) => value === next[index])
  );
}
