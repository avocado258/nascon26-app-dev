const test = require('node:test');
const assert = require('node:assert/strict');
const { generateRoundRobin } = require('../../backend/src/fixtures/roundRobin');

const teamsOf = (n) => Array.from({ length: n }, (_, i) => `t${i + 1}`);
const allMatches = (r) => r.rounds.flatMap((rd) => rd.matches);

test('structure and balance hold for 2-40 teams, single and double leg', () => {
  for (let n = 2; n <= 40; n++) {
    for (const legs of [1, 2]) {
      const r = generateRoundRobin(teamsOf(n), { legs });
      const perLeg = n % 2 ? n : n - 1;
      assert.equal(r.round_count, perLeg * legs);
      const unordered = new Map();
      const ordered = new Map();
      const balance = {};
      const byes = new Map();
      r.rounds.forEach((rd, k) => {
        assert.equal(rd.round, k + 1, 'round numbers are global');
        assert.equal(rd.matches.length, Math.floor(n / 2));
        assert.equal(rd.byes.length, n % 2);
        const seen = new Set(rd.byes);
        for (const b of rd.byes) {
          const key = `${b}|${Math.ceil(rd.round / perLeg)}`;
          byes.set(key, (byes.get(key) || 0) + 1);
        }
        rd.matches.forEach((m, j) => {
          assert.equal(m.match_id, `RR-L${m.leg}-R${rd.round}-M${j + 1}`);
          for (const t of [m.home, m.away]) {
            assert.ok(!seen.has(t), `${t} twice in round ${rd.round}`);
            seen.add(t);
          }
          const u = [m.home, m.away].sort().join();
          unordered.set(u, (unordered.get(u) || 0) + 1);
          ordered.set(`${m.home}>${m.away}`, (ordered.get(`${m.home}>${m.away}`) || 0) + 1);
          const b = (balance[m.leg] = balance[m.leg] || {});
          b[m.home] = (b[m.home] || 0) + 1;
          b[m.away] = (b[m.away] || 0) - 1;
        });
        assert.equal(seen.size, n);
      });
      assert.equal(unordered.size, (n * (n - 1)) / 2);
      for (const c of unordered.values()) assert.equal(c, legs);
      if (legs === 2) {
        assert.equal(ordered.size, n * (n - 1));
        for (const c of ordered.values()) assert.equal(c, 1);
      }
      for (const leg of Object.values(balance)) {
        for (const d of Object.values(leg)) assert.ok(Math.abs(d) <= 1, `home/away imbalance n=${n}`);
      }
      if (n % 2) {
        assert.equal(byes.size, n * legs);
        for (const c of byes.values()) assert.equal(c, 1, 'one bye per team per leg');
      }
    }
  }
});

test('spec 5.7-A example: forfeit_remaining after round 2', () => {
  const r = generateRoundRobin(teamsOf(5), { withdrawals: [{ team_id: 't3', after_round: 2 }] });
  assert.deepEqual(r.summary, { total: 10, scheduled: 8, forfeit: 2, voided: 0 });
  for (const rd of r.rounds) {
    for (const m of rd.matches) {
      if (m.status === 'forfeit') {
        assert.ok(rd.round > 2);
        assert.equal(m.awarded_to, m.home === 't3' ? m.away : m.home);
      }
    }
  }
});

test('fixture between two withdrawn teams is voided', () => {
  const r = generateRoundRobin(teamsOf(4), {
    withdrawals: [{ team_id: 't1', after_round: 0 }, { team_id: 't2', after_round: 0 }],
  });
  const m = allMatches(r).find((x) => [x.home, x.away].sort().join() === 't1,t2');
  assert.equal(m.status, 'voided');
  assert.equal(m.awarded_to, null);
});

test('void_all voids every fixture of the withdrawn team', () => {
  const r = generateRoundRobin(teamsOf(4), { withdrawal_policy: 'void_all', withdrawals: [{ team_id: 't1', after_round: 3 }] });
  assert.deepEqual(r.summary, { total: 6, scheduled: 3, forfeit: 0, voided: 3 });
});

test('after_round may equal round_count', () => {
  const r = generateRoundRobin(teamsOf(3), { withdrawals: [{ team_id: 't1', after_round: 3 }] });
  assert.equal(r.summary.forfeit, 0);
});

test('invalid params are 400 VALIDATION_ERROR', () => {
  const cases = [
    { withdrawals: [{ team_id: 't1', after_round: 4 }] },
    { withdrawals: [{ team_id: 't1', after_round: -1 }] },
    { withdrawals: [{ team_id: 'zz', after_round: 1 }] },
    { legs: 3 },
    { withdrawal_policy: 'nope' },
  ];
  for (const params of cases) {
    assert.throws(() => generateRoundRobin(teamsOf(3), params), (e) => e.status === 400 && e.code === 'VALIDATION_ERROR');
  }
  assert.throws(() => generateRoundRobin(['t1'], {}), (e) => e.status === 400);
});
