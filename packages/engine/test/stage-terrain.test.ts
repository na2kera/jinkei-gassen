// 面のデータの受け皿（design §3.8「面のデータ」）：戦場の幅 6〜12、ひな形が狭い幅でも全部隊を置けること、
// 敵の配置エリアの検査を外す口、両軍のマスの重なり、Stage の seconds と gate
import { describe, expect, it } from 'vitest';
import { applyTemplate, createBattle, listTemplates, MAX_UNITS, plainField, STAGES, stageSetup, validateArmy, validateStageArmy, type Kind, type Roster, type Stage } from '../src/index.ts';
import { castleField } from '../sim/terrain-scenes.ts';

const KINDS: Kind[] = ['infantry', 'shield', 'cavalry', 'archer'];
function rosters(): Roster[] {
  const out: Roster[] = [];
  for (let n = 6; n <= MAX_UNITS; n++) {
    const r: Roster = { hq: 1 };
    for (let i = 0; i < n - 1; i++) r[KINDS[i % 4]!] = (r[KINDS[i % 4]!] ?? 0) + 1;
    out.push(r, { hq: 1, infantry: n - 1 }, { hq: 1, cavalry: n - 1 });
  }
  return out;
}

describe('ひな形は、幅 6〜12 のどれでも全部隊を重ならずに置ける', () => {
  for (let w = 6; w <= 12; w++) {
    it(`幅 ${w}`, () => {
      const f = plainField(w);
      for (const t of listTemplates()) {
        for (const roster of rosters()) {
          for (const side of [0, 1] as const) {
            const ps = applyTemplate(t.id, roster, f.zones[side], side);
            expect(validateArmy(ps, f.zones[side], { maxUnits: MAX_UNITS }), `${t.id} ${JSON.stringify(roster)}`).toEqual([]);
            const total = Object.values(roster).reduce((a, b) => a + (b ?? 0), 0);
            expect(ps.length).toBe(total);
          }
        }
      }
    });
  }
});

describe('面の戦場と配置', () => {
  const base = STAGES[0]!;
  it('幅 6 の戦場で、面の戦いを作れる', () => {
    const f = plainField(6);
    const st: Stage = { ...base, field: f, enemy: [{ kind: 'hq', stance: 'hold', col: 2, row: 0 }, { kind: 'infantry', stance: 'advance', col: 2, row: 4 }], solution: applyTemplate('line', base.roster, f.zones[0], 0) };
    expect(createBattle(stageSetup(st, st.solution, 1)).ok).toBe(true);
  });
  it('seconds は面の長さ（省略すると 180 秒）', () => {
    expect(stageSetup(base, base.solution, 1).maxTicks).toBe(1800);
    expect(stageSetup({ ...base, seconds: 90 }, base.solution, 1).maxTicks).toBe(900);
  });
  it('敵の配置は「エリアの中」の検査を外す（中間地帯にも置ける）。兵種・本陣・部隊数は調べる', () => {
    const enemy = [{ kind: 'hq' as const, stance: 'hold' as const, col: 5, row: 0 }, { kind: 'infantry' as const, stance: 'hold' as const, col: 5, row: 8 }];
    expect(createBattle(stageSetup({ ...base, enemy }, base.solution, 1)).ok).toBe(true);
    const noHq = [{ kind: 'infantry' as const, stance: 'hold' as const, col: 5, row: 8 }];
    expect(createBattle(stageSetup({ ...base, enemy: noHq }, base.solution, 1)).ok).toBe(false);
    const gateKind = [{ kind: 'hq' as const, stance: 'hold' as const, col: 5, row: 0 }, { kind: 'gate' as Kind, stance: 'hold' as const, col: 5, row: 2 }];
    expect(createBattle(stageSetup({ ...base, enemy: gateKind }, base.solution, 1)).ok).toBe(false);
  });
  it('自軍と敵軍のマスの重なりを調べる（validateStageArmy と createBattle の両方）', () => {
    const enemy = [{ kind: 'hq' as const, stance: 'hold' as const, col: 5, row: 0 }, { kind: 'infantry' as const, stance: 'hold' as const, col: 2, row: 10 }];
    const st: Stage = { ...base, enemy };
    const mine = [{ kind: 'hq' as const, stance: 'hold' as const, col: 5, row: 14 }, { kind: 'infantry' as const, stance: 'advance' as const, col: 2, row: 10 }];
    expect(validateStageArmy(st, mine).map((e) => e.code)).toContain('overlap');
    expect(createBattle(stageSetup(st, mine, 1)).ok).toBe(false);
  });
  it('gate のある面：門は陣営1のもの。win が gate なら、門が破れた側の負けで決着する。城壁と門のマスには置けない', () => {
    const f = castleField();
    const st: Stage = {
      ...base,
      field: f,
      gate: { col: 5, row: 5 },
      win: { type: 'gate' },
      enemy: [{ kind: 'hq', stance: 'hold', col: 5, row: 1 }, { kind: 'infantry', stance: 'hold', col: 4, row: 3 }],
    };
    const setup = stageSetup(st, base.solution, 1);
    expect(setup.gate).toEqual({ side: 1, col: 5, row: 5, win: true });
    expect(setup.timeout).toBe('side0_loses');
    expect(createBattle(setup).ok).toBe(true);
    expect(stageSetup({ ...st, win: { type: 'defeat' } }, base.solution, 1).gate?.win).toBe(false);
    const onWall = [{ kind: 'hq' as const, stance: 'hold' as const, col: 5, row: 14 }, { kind: 'infantry' as const, stance: 'advance' as const, col: 3, row: 5 }];
    // 自軍のエリア（行 10〜15）の外なので out_of_zone も出るが、城壁の検査も出ること
    expect(validateStageArmy(st, onWall).map((e) => e.code)).toContain('on_wall');
  });
});
