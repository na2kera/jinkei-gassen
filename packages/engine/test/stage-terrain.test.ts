// 面のデータの受け皿（design §3.8「面のデータ」、§13.5）：配置エリアの幅 5〜8、ひな形が狭い幅でも全部隊を置けること、
// 敵の配置エリアの検査を外す口、両軍のマスの重なり、Stage の seconds と gate
import { describe, expect, it } from 'vitest';
import { applyTemplate, createBattle, listTemplates, MAX_UNITS, plainField, STAGES, STANDARD_WIDTH, stageSetup, validateArmy, validateStageArmy, type Kind, type Roster, type Stage } from '../src/index.ts';
import { stdCastleField, STD_CASTLE_GAP_COL, STD_CASTLE_WALL_ROW } from '../sim/terrain-scenes.ts';

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

describe('ひな形は、配置エリアの幅 5〜8 のどれでも全部隊を重ならずに置ける', () => {
  // 狭い面（通り道なし）の幅 5〜8 と、標準の盤（幅 10、配置エリアは通り道を除いた 8 列）
  for (const w of [5, 6, 7, 8, STANDARD_WIDTH]) {
    it(`戦場の幅 ${w}（配置エリアの幅 ${plainField(w).zones[0].width}）`, () => {
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
    // 中間地帯の行（敵の配置エリアのすぐ外の 2 行目）。座標は面の配置エリアから読む
    const z1 = base.field.zones[1];
    const midRow = z1.row + z1.height + 1;
    const enemy = [{ kind: 'hq' as const, stance: 'hold' as const, col: 5, row: 0 }, { kind: 'infantry' as const, stance: 'hold' as const, col: 5, row: midRow }];
    expect(createBattle(stageSetup({ ...base, enemy }, base.solution, 1)).ok).toBe(true);
    const noHq = [{ kind: 'infantry' as const, stance: 'hold' as const, col: 5, row: midRow }];
    expect(createBattle(stageSetup({ ...base, enemy: noHq }, base.solution, 1)).ok).toBe(false);
    const gateKind = [{ kind: 'hq' as const, stance: 'hold' as const, col: 5, row: 0 }, { kind: 'gate' as Kind, stance: 'hold' as const, col: 5, row: 2 }];
    expect(createBattle(stageSetup({ ...base, enemy: gateKind }, base.solution, 1)).ok).toBe(false);
  });
  it('自軍と敵軍のマスの重なりを調べる（validateStageArmy と createBattle の両方）', () => {
    const z0 = base.field.zones[0];
    const front = z0.row;
    const back = z0.row + z0.height - 1;
    const enemy = [{ kind: 'hq' as const, stance: 'hold' as const, col: 5, row: 0 }, { kind: 'infantry' as const, stance: 'hold' as const, col: 2, row: front }];
    const st: Stage = { ...base, enemy };
    const mine = [{ kind: 'hq' as const, stance: 'hold' as const, col: 5, row: back }, { kind: 'infantry' as const, stance: 'advance' as const, col: 2, row: front }];
    expect(validateStageArmy(st, mine).map((e) => e.code)).toContain('overlap');
    expect(createBattle(stageSetup(st, mine, 1)).ok).toBe(false);
  });
  it('gate のある面（標準の盤の城の場面）：門は陣営1のもの。win が gate なら、門が破れた側の負けで決着する。城壁と門のマスには置けない', () => {
    const f = stdCastleField();
    // 自軍は横陣のひな形で置く（城の場面の戦場の配置エリアに合わせるため）
    const mine = applyTemplate('line', base.roster, f.zones[0], 0);
    const st: Stage = {
      ...base,
      field: f,
      gate: { col: STD_CASTLE_GAP_COL, row: STD_CASTLE_WALL_ROW },
      win: { type: 'gate' },
      enemy: [{ kind: 'hq', stance: 'hold', col: 4, row: 0 }, { kind: 'infantry', stance: 'hold', col: 3, row: 1 }],
      solution: mine,
    };
    const setup = stageSetup(st, mine, 1);
    expect(setup.gate).toEqual({ side: 1, col: STD_CASTLE_GAP_COL, row: STD_CASTLE_WALL_ROW, win: true });
    expect(setup.timeout).toBe('side0_loses');
    expect(createBattle(setup).ok).toBe(true);
    expect(stageSetup({ ...st, win: { type: 'defeat' } }, mine, 1).gate?.win).toBe(false);
    const onWall = [{ kind: 'hq' as const, stance: 'hold' as const, col: 4, row: 11 }, { kind: 'infantry' as const, stance: 'advance' as const, col: 3, row: STD_CASTLE_WALL_ROW }];
    // 自軍のエリア（行 8〜11）の外なので out_of_zone も出るが、城壁の検査も出ること
    expect(validateStageArmy(st, onWall).map((e) => e.code)).toContain('on_wall');
  });
});
