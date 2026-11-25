const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plain = value => JSON.parse(JSON.stringify(value));
function load(file, mocks = {}) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, {
    exports,
    require(name) {
      if (!(name in mocks)) throw new Error(`Unexpected import: ${name}`);
      return mocks[name];
    },
    URL, URLSearchParams, Date, Map, Set, Intl,
    console: { error() {} },
  });
  return exports;
}

const shared = load('src/lib/client-referrals.ts');
const next = { NextResponse: { json: (body, options) => ({ body, ...options }) } };
function server() {
  return load('src/lib/server/client-referrals.ts', {
    'next/server': next,
    '@/lib/client-referrals': shared,
    '@/lib/server/auth-worker': { workerFromRequest: async () => null, getAdminClient: () => ({}) },
  });
}
const item = (reward_type, amount, extra = {}) => ({
  reward_type, amount, roulette_level: null, rank_key: null, rank_days: null, ...extra,
});
const free = item('free_minutes', 15);
const coins = item('coins', 30);
const bundle = extra => ({
  title: 'X1 combinado', referrals_required: 1, enabled: true,
  reward_items: [free, coins], ...extra,
});

test('bundles validate all items and have one shared cost without requiring legacy scalar fields', () => {
  const input = bundle({ title: '  X1 combinado  ' });
  const before = JSON.stringify(input);
  const parsed = shared.parseReferralReward(input);
  assert.equal(parsed.title, 'X1 combinado');
  assert.equal(parsed.referrals_required, 1);
  assert.equal(parsed.reward_type, 'free_minutes');
  assert.equal(parsed.amount, 15);
  assert.deepEqual(plain(parsed.reward_items), [free, coins]);
  assert.equal(JSON.stringify(input), before, 'validation must not mutate the editor draft');
  assert.equal(shared.referralRewardDescription(parsed), '15 minutos FREE + 30 Coins');

  const allTypes = [
    free, item('normal_minutes', 5), coins, item('oracle', 2),
    item('rank', 1, { rank_key: 'oro', rank_days: 7 }),
    ...[1, 2, 3, 4, 5].map(roulette_level => item('roulette', 1, { roulette_level })),
  ];
  assert.equal(shared.parseReferralReward(bundle({ reward_items: allTypes })).reward_items.length, 10);
});

test('legacy saves retain an absent reward_items property while read helpers support singleton receipts', () => {
  const legacy = { title: 'Anterior', referrals_required: 1, enabled: true, ...coins };
  const parsed = shared.parseReferralReward(legacy);
  assert.equal(Object.hasOwn(parsed, 'reward_items'), false, 'the SQL must recognize old editor submissions');
  assert.deepEqual(plain(shared.referralRewardItems(parsed)), [coins]);
  assert.equal(shared.referralRewardDescription(parsed), '30 Coins');
  assert.equal(shared.parseReferralReward({ ...legacy, reward_type: 'rank', amount: 50, rank_key: 'oro', rank_days: 7 }).amount, 1);
});

test('explicit bundle payloads reject malformed items, unsafe values and repeated benefits', () => {
  const badLists = [
    null, undefined, {}, [], [null], [42], [[]], [{}],
    [item('unknown', 1)], [item('coins', 0)], [item('coins', -1)],
    [item('coins', '30')], [item('coins', 1.5)], [item('coins', NaN)],
    [item('coins', Infinity)], [item('coins', 1000001)],
    [item('free_minutes', 10001)], [item('normal_minutes', 10001)],
    [item('oracle', 101)], [item('roulette', 101, { roulette_level: 1 })],
    [item('roulette', 1, { roulette_level: 0 })],
    [item('roulette', 1, { roulette_level: 6 })],
    [item('roulette', 1, { roulette_level: '1' })],
    [item('rank', 2, { rank_key: 'oro', rank_days: 7 })],
    [item('rank', 1, { rank_key: 'admin', rank_days: 7 })],
    [item('rank', 1, { rank_key: 'oro', rank_days: null })],
    [item('rank', 1, { rank_key: 'oro', rank_days: 366 })],
    [free, { ...free, amount: 5 }], [coins, { ...coins, amount: 5 }],
    [item('roulette', 1, { roulette_level: 4 }), item('roulette', 2, { roulette_level: 4 })],
    [item('rank', 1, { rank_key: 'oro', rank_days: 7 }), item('rank', 1, { rank_key: 'diamante', rank_days: 7 })],
    Array.from({ length: 11 }, () => coins),
  ];
  for (const reward_items of badLists) {
    assert.throws(() => shared.parseReferralReward(bundle({ reward_items })), undefined, `Invalid items: ${JSON.stringify(reward_items)}`);
  }
});

test('admin saves send normalized components and bind a single operation to the verified actor', async () => {
  const calls = [];
  const admin = { rpc: async (name, args) => { calls.push({ name, args }); return { data: { id: id(5) }, error: null }; } };
  const route = load('src/app/api/admin/referral-rewards/route.ts', {
    '@/lib/admin/require-admin': { requireAdmin: async () => ({ ok: true, me: { id: id(1) }, authUserId: id(2), admin }) },
    '@/lib/client-referrals': shared,
    '@/lib/server/client-referrals': server(),
  });
  const body = { action: 'save', operation_id: id(5), expected_version: null, reward: bundle(), actor_worker_id: id(99) };
  const result = await route.POST({ json: async () => body });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'tc_save_referral_reward');
  assert.equal(calls[0].args.p_actor_worker_id, id(1));
  assert.equal(calls[0].args.p_actor_user_id, id(2));
  assert.equal(calls[0].args.p_operation_id, id(5));
  assert.equal(calls[0].args.p_data.referrals_required, 1);
  assert.deepEqual(plain(calls[0].args.p_data.reward_items), [free, coins]);
});

test('claim response describes the actual delivered bundle and ignores injected quantities and identity', async () => {
  const calls = [];
  const receipt = {
    claim_id: id(5), title: 'X1 combinado', referrals_used: 1,
    reward_type: 'free_minutes', amount: 15,
    reward_items: [{ ...free, before_balance: 7, after_balance: 22 }, { ...coins, before_balance: 5, after_balance: 35 }],
  };
  const route = load('src/app/api/cliente/referidos/route.ts', {
    '@/lib/server/auth-cliente': { clientFromRequest: async () => ({
      uid: id(1), cliente: { id: id(2) },
      admin: { rpc: async (name, args) => { calls.push({ name, args }); return { data: receipt, error: null }; } },
    }) },
    '@/lib/client-referrals': shared,
    '@/lib/server/client-referrals': server(),
  });
  const result = await route.POST({ json: async () => ({
    action: 'claim', reward_id: id(3), operation_id: id(5), expected_version: 2,
    cliente_id: id(99), auth_user_id: id(99), referrals_required: 0,
    reward_items: [item('coins', 1000000)],
  }) });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'tc_claim_referral_reward');
  assert.equal(calls[0].args.p_cliente_id, id(2));
  assert.equal(calls[0].args.p_auth_user_id, id(1));
  assert.equal(calls[0].args.p_expected_version, 2);
  assert.equal(Object.hasOwn(calls[0].args, 'reward_items'), false);
  assert.equal(Object.hasOwn(calls[0].args, 'referrals_required'), false);
  assert.equal(result.body.receipt.reward_description, '15 minutos FREE + 30 Coins');
  assert.match(result.headers['Cache-Control'], /no-store/);
  assert.equal(result.headers.Vary, 'Authorization');
});

test('client state checks rank benefits anywhere in a bundle and keeps referred identities private', async () => {
  const refs = [{ id: id(10), referred_id: id(20), status: 'available', created_at: '2026-11-22T00:00:00Z', paid_total: 17 }];
  const reward = {
    ...bundle({ title: 'Catálogo actualizado', reward_items: [free, item('rank', 1, { rank_key: 'oro', rank_days: 7 })] }),
    ...free, id: id(3), version: 2,
  };
  const previousClaim = {
    id: id(30), created_at: '2026-11-21T00:00:00Z',
    reward_snapshot: { title: 'Premio anterior', referrals_required: 1, ...free, reward_items: [free, coins] },
    receipt: { title: 'Premio anterior', referrals_used: 1, reward_items: [free, coins] },
  };
  const query = data => {
    const q = {
      select: () => q, order: () => q, range: () => q, eq: () => q, in: () => q,
      limit: () => q, or: () => q, then: resolve => Promise.resolve({ data, error: null }).then(resolve),
    };
    return q;
  };
  const admin = {
    rpc(name) {
      if (name === 'tc_client_referral_status') return query(refs);
      if (name === 'tc_client_rank_state') return Promise.resolve({ data: { effective: 'diamante' }, error: null });
      throw new Error(`Unexpected RPC: ${name}`);
    },
    from(table) {
      if (table === 'client_referral_rewards') return query([reward]);
      if (table === 'client_referral_claims') return query([previousClaim]);
      if (table === 'crm_clientes') return query([{ id: id(20), nombre: 'Sofía ApellidoPrivado', apellido: 'OtroApellidoPrivado' }]);
      if (table === 'client_rank_overrides') return query([]);
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  const state = await server().loadReferralState(admin, id(2));
  assert.equal(state.rewards[0].claimable, false, 'a nested rank must not replace an equal or better existing rank');
  assert.match(state.rewards[0].unavailable_reason, /rango/i);
  assert.equal(state.referrals[0].name, 'Sofía');
  assert.equal(Object.hasOwn(state.referrals[0], 'referred_id'), false);
  assert.equal(Object.hasOwn(state.referrals[0], 'paid_total'), false);
  assert.equal(JSON.stringify(state).includes('ApellidoPrivado'), false);
  assert.equal(state.claims[0].reward_title, 'Premio anterior');
  assert.equal(state.claims[0].reward_description, '15 minutos FREE + 30 Coins');
});

test('history filters reject invalid dates and convert Madrid calendar days across DST boundaries', () => {
  const parse = query => plain(shared.parseReferralHistoryQuery(new URLSearchParams(query)));
  assert.deepEqual(parse(''), { p_query: null, p_reward_id: null, p_from: null, p_to: null, p_offset: 0, p_limit: 25 });
  const filters = parse(`q=%20Luc%C3%ADa%20Mart%C3%ADnez%20&reward_id=${id(3)}&from=2026-11-25&to=2026-11-25&offset=25&limit=50`);
  assert.deepEqual(filters, {
    p_query: 'Lucía Martínez', p_reward_id: id(3), p_from: '2026-11-24T23:00:00.000Z',
    p_to: '2026-11-25T23:00:00.000Z', p_offset: 25, p_limit: 50,
  });
  const spring = parse('from=2026-03-29&to=2026-03-29');
  assert.equal(spring.p_from, '2026-03-28T23:00:00.000Z');
  assert.equal(spring.p_to, '2026-03-29T22:00:00.000Z');
  const autumn = parse('from=2026-10-25&to=2026-10-25');
  assert.equal(autumn.p_from, '2026-10-24T22:00:00.000Z');
  assert.equal(autumn.p_to, '2026-10-25T23:00:00.000Z');
  for (const query of [
    'reward_id=invalid', 'from=2026-02-30', 'to=2026-11-31',
    'from=25/11/2026', 'from=2026-11-25T00:00:00Z',
    'from=2026-11-26&to=2026-11-25', 'offset=-1', 'offset=1.5', 'offset=abc',
    'limit=0', 'limit=101', 'limit=1.5', `q=${'a'.repeat(201)}`,
  ]) assert.throws(() => parse(query), undefined, query);
});

function historyRoute(response, access = { ok: true }, calls = []) {
  const admin = {
    rpc: async (name, args) => { calls.push({ name, args }); return response; },
    from() { throw new Error('History must not rebuild delivered rewards from the current catalog'); },
  };
  return { calls, route: load('src/app/api/admin/referral-rewards/history/route.ts', {
    '@/lib/admin/require-admin': { requireAdmin: async () => ({ ...access, me: { id: id(1) }, authUserId: id(2), admin }) },
    '@/lib/client-referrals': shared,
    '@/lib/server/client-referrals': server(),
  }) };
}

test('admin history is private, paginated and describes actual receipts, with legacy snapshot fallback', async () => {
  const receiptItems = [{ ...free, after_balance: 22 }, { ...coins, after_balance: 35 }];
  const raw = {
    claims: [{
      id: id(11), created_at: '2026-11-25T12:00:00Z', cliente_id: id(2),
      client_name: 'Lucía Martínez', client_phone: '+1 787 555 0100', reward_id: id(3),
      reward_snapshot: { ...bundle({ reward_items: [item('free_minutes', 20), item('coins', 50)] }), ...free },
      receipt: { title: 'X1 combinado', referrals_used: 1, reward_items: receiptItems }, referrals_used: 1,
    }, {
      id: id(12), created_at: '2026-11-24T12:00:00Z', cliente_id: id(4),
      client_name: 'Lucía Vega', client_phone: null, reward_id: id(3),
      reward_snapshot: { title: 'Premio anterior', referrals_required: 2, ...item('coins', 60) },
      receipt: {}, referrals_used: 2,
    }],
    total: 27, offset: 25, limit: 25,
  };
  const { route, calls } = historyRoute({ data: raw, error: null });
  const result = await route.GET({ url: `https://example.test/api/admin/referral-rewards/history?offset=25&limit=25&reward_id=${id(3)}&from=2026-11-24&to=2026-11-25&q=Luc%C3%ADa` });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'tc_admin_referral_claim_history');
  assert.equal(calls[0].args.p_query, 'Lucía');
  assert.equal(calls[0].args.p_reward_id, id(3));
  assert.equal(calls[0].args.p_offset, 25);
  assert.equal(calls[0].args.p_limit, 25);
  assert.equal(calls[0].args.p_to, '2026-11-25T23:00:00.000Z');
  assert.equal(result.body.total, 27);
  assert.equal(result.body.offset, 25);
  assert.equal(result.body.limit, 25);
  assert.equal(result.body.claims[0].reward_description, '15 minutos FREE + 30 Coins');
  assert.deepEqual(plain(result.body.claims[0].reward_items), [free, coins]);
  assert.equal(result.body.claims[0].referrals_used, 1);
  assert.equal(result.body.claims[0].status, 'delivered');
  assert.equal(result.body.claims[0].client_phone, '+1 787 555 0100');
  assert.equal(result.body.claims[1].reward_title, 'Premio anterior');
  assert.equal(result.body.claims[1].reward_description, '60 Coins');
  assert.equal(result.body.claims[1].referrals_used, 2);
  assert.equal(result.body.claims[1].client_phone, null);
  assert.equal(Object.hasOwn(result.body.claims[0], 'receipt'), false);
  assert.equal(Object.hasOwn(result.body.claims[0], 'reward_snapshot'), false);
  assert.match(result.headers['Cache-Control'], /no-store/);
  assert.equal(result.headers.Vary, 'Authorization');
});

test('history authorizes before access and rejects malformed filters without querying the database', async () => {
  for (const [error, status] of [['NO_AUTH', 401], ['FORBIDDEN', 403]]) {
    const { route, calls } = historyRoute({ data: { claims: [], total: 0 }, error: null }, { ok: false, error });
    const result = await route.GET({ url: 'https://example.test/api/admin/referral-rewards/history?from=invalid' });
    assert.equal(result.status, status);
    assert.equal(calls.length, 0);
    assert.equal(Object.hasOwn(result.body, 'claims'), false);
    assert.match(result.headers['Cache-Control'], /no-store/);
  }
  const { route, calls } = historyRoute({ data: { claims: [], total: 0 }, error: null });
  assert.equal((await route.GET({ url: 'https://example.test/api/admin/referral-rewards/history?limit=101' })).status, 400);
  assert.equal(calls.length, 0);
});

test('history database errors are not misrepresented as empty successful history or exposed as SQL details', async () => {
  const { route } = historyRoute({ data: null, error: { message: 'private SQL statement and personal data', code: 'XX000' } });
  const result = await route.GET({ url: 'https://example.test/api/admin/referral-rewards/history' });
  assert.equal(result.status, 503);
  assert.equal(result.body.ok, false);
  assert.equal(JSON.stringify(result.body).includes('private SQL'), false);
  assert.equal(Object.hasOwn(result.body, 'claims'), false);
});
