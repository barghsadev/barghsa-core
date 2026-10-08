export interface ServerQueryScope {
  context: 'customer' | 'staff' | 'account';
  ownerId: string;
  revision: number;
  accountId?: string | null;
}

export type ServerQueryKey = readonly [
  'barghsa',
  string,
  ServerQueryScope['context'],
  string,
  number,
  string | null,
  ...string[],
];

/** Snapshot route params in a stable order; preserve repeated filter values. */
export function serverListParams(params: URLSearchParams) {
  const criteria = new URLSearchParams(params),
    pagination = new URLSearchParams();
  for (const name of ['cursor', 'before', 'offset', 'page']) {
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
    return [
      'barghsa',
      resource,
      scope.context,
      scope.ownerId,
      scope.revision,
      scope.accountId ?? null,
    ];
  };
  return {
    all,
    lists: (scope: ServerQueryScope): ServerQueryKey => [...all(scope), 'list'],
    list: (scope: ServerQueryScope, params: URLSearchParams, readRevision = 0): ServerQueryKey => {
      const { criteria, pagination } = serverListParams(params);
      return [...all(scope), 'list', criteria, JSON.stringify([pagination, readRevision])];
    },
    detail: (scope: ServerQueryScope, id: string): ServerQueryKey => [...all(scope), 'detail', id],
  };
}

const walletKeys = resourceKeys('wallet');
const profileKeys = resourceKeys('profiles');

export const queryKeys = {
  profiles: {
    ...profileKeys,
    authority: (scope: ServerQueryScope, request: string): ServerQueryKey => [
      ...profileKeys.all(scope),
      'authority',
      request,
    ],
  },
  orders: resourceKeys('orders'),
  invoices: resourceKeys('invoices'),
  contracts: resourceKeys('contracts'),
  dashboard: resourceKeys('dashboard'),
  catalogue: resourceKeys('catalogue'),
  saving: resourceKeys('saving'),
  solar: resourceKeys('solar'),
  preferences: resourceKeys('preferences'),
  wallet: {
    ...walletKeys,
    balance: (scope: ServerQueryScope): ServerQueryKey => [...walletKeys.all(scope), 'balance'],
  },
};

/** Previous rows are usable only during paging within the same owner and criteria. */
export function sameServerList(previous: readonly unknown[], next: ServerQueryKey) {
  return (
    previous.length === 9 &&
    next.length === 9 &&
    previous[6] === 'list' &&
    next[6] === 'list' &&
    previous.slice(0, 8).every((value, index) => value === next[index])
  );
}
