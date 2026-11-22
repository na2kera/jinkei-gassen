// 通り道つきの 10×12 の盤（design §13.2、decisions §22）。定数・plainField の配置エリア・通り道の決まり。
import { describe, expect, it } from 'vitest';
import {
  applyTemplate,
  armyCost,
  createBattle,
  listTemplates,
  MAX_UNITS,
  plainField,
  PVP_MAPS,
  PVP_RULES,
  pvpArmyLimits,
  pvpField,
  recognizeFormation,
  STAGES,
  STANDARD_HEIGHT,
  STANDARD_LANE,
  STANDARD_ROSTER,
  STANDARD_WIDTH,
  STANDARD_ZONE_DEPTH,
  STANDARD_ZONE_WIDTH,
  step,
  TUTORIAL_STAGE,
  validateArmy,
  wingOf,
  type Field,
  type Placement,
  type Roster,
  type Side,
} from '../src/index.ts';
import { spawnCell } from '../src/reserve.ts';
import { T } from '../src/tuning.ts';
import { p } from './helpers.ts';

const field = plainField();
const laneCols = [0, STANDARD_WIDTH - 1];

/** 配置エリアの、敵に近い前の行といちばん後ろの行 */
function rowsOf(side: Side): { front: number; back: number } {
  const z = field.zones[side];
  return side === 0 ? { front: z.row, back: z.row + z.height - 1 } : { front: z.row + z.height - 1, back: z.row };
}

describe('定数', () => {
  it('戦場は 10×12、配置エリアは 8×4、通り道は両端の 1 列ずつ。部隊は 12 まで、対戦の予算は 24', () => {
    expect(STANDARD_ZONE_WIDTH).toBe(8);
    expect(STANDARD_LANE).toBe(1);
    expect(STANDARD_WIDTH).toBe(STANDARD_ZONE_WIDTH + STANDARD_LANE * 2);
    expect(STANDARD_WIDTH).toBe(10);
    expect(STANDARD_HEIGHT).toBe(12);
    expect(STANDARD_ZONE_DEPTH).toBe(4);
    expect(MAX_UNITS).toBe(12);
    expect(PVP_RULES.budget).toBe(24);
    expect(PVP_RULES.maxUnits).toBe(MAX_UNITS - 1);
  });
  it('対戦の標準の編成は 本陣・歩4・盾2・騎1・弓2 で、値段は予算ちょうど', () => {
    expect(PVP_RULES.standardRoster).toEqual({ hq: 1, infantry: 4, shield: 2, cavalry: 1, archer: 2 });
    const ps = applyTemplate('line', PVP_RULES.standardRoster, field.zones[0], 0);
    expect(armyCost(ps, PVP_RULES.costs)).toBe(PVP_RULES.budget);
    expect(validateArmy(ps, field.zones[0], pvpArmyLimits())).toEqual([]);
  });
});

describe('plainField', () => {
  it('標準：陣営0は列 1〜8・行 8〜11、陣営1は列 1〜8・行 0〜3。あいだは 4 行', () => {
    expect(field.width).toBe(10);
    expect(field.height).toBe(12);
    expect(field.terrain.length).toBe(120);
    expect(field.zones).toEqual([
      { col: 1, row: 8, width: 8, height: 4 },
      { col: 1, row: 0, width: 8, height: 4 },
    ]);
  });
  it('両軍の最前列の中心どうしは 5.0 マス離れる（main と同じ。弓の射程 5.6・守備の見張り 4 をそのまま使う）', () => {
    const d = rowsOf(0).front - rowsOf(1).front;
    expect(d).toBe(5);
    expect(T.archerRange).toBe(5.6);
    expect(T.holdWatchRange).toBe(4);
  });
  it('標準でない幅は、省略すると通り道なし（狭い面の plainField(6) は配置エリアが幅いっぱい）', () => {
    expect(plainField(6).zones[0]).toEqual({ col: 0, row: 8, width: 6, height: 4 });
    expect(plainField(12, 16, 6).zones[1]).toEqual({ col: 0, row: 0, width: 12, height: 6 });
  });
  it('lane を渡せば、その数だけ両端を外す。0 なら通り道なし', () => {
    expect(plainField(10, 12, 4, 0).zones[0]).toEqual({ col: 0, row: 8, width: 10, height: 4 });
    expect(plainField(8, 12, 4, 1).zones[0]).toEqual({ col: 1, row: 8, width: 6, height: 4 });
    expect(plainField(10, 12, 4, 2).zones[1]).toEqual({ col: 2, row: 0, width: 6, height: 4 });
  });
  it('lane * 2 が幅以上になる値・負の値・整数でない値は、通り道なし', () => {
    for (const lane of [3, 5, 9, -1, 0.5, Number.NaN]) {
      expect(plainField(6, 12, 4, lane).zones[0]).toEqual({ col: 0, row: 8, width: 6, height: 4 });
    }
  });
  it('配置エリアは左右に同じ数の列を空ける（対戦で 180 度回しても、列 0 と列 9 が通り道のまま。server の flipZone の col = width − col − zone.width）', () => {
    for (const z of field.zones) expect(field.width - z.col - z.width).toBe(z.col);
  });
});

describe('通り道への配置は断る', () => {
  for (const side of [0, 1] as const) {
    const { front, back } = rowsOf(side);
    const z = field.zones[side];
    it(`陣営${side}：列 0 と列 9 は out_of_zone、列 1 と列 8 は置ける`, () => {
      for (const col of laneCols) {
        const errs = validateArmy([p('hq', 4, back, 'hold'), p('infantry', col, front)], z, { maxUnits: MAX_UNITS });
        expect(errs.map((e) => [e.code, e.index])).toEqual([['out_of_zone', 1]]);
      }
      expect(validateArmy([p('hq', 4, back, 'hold'), p('infantry', 1, front), p('infantry', 8, front)], z, { maxUnits: MAX_UNITS })).toEqual([]);
    });
    it(`陣営${side}：対戦の条件（pvpArmyLimits）でも通り道は out_of_zone`, () => {
      for (const col of laneCols) {
        const errs = validateArmy([p('hq', 4, back, 'hold'), p('infantry', col, front)], z, pvpArmyLimits());
        expect(errs.map((e) => e.code)).toEqual(['out_of_zone']);
      }
    });
  }
  it('createBattle も、通り道に置いた軍を invalid_army で断る', () => {
    const r = createBattle({
      field: plainField(),
      armies: [[p('hq', 4, 11, 'hold'), p('infantry', 0, 8)], [p('hq', 4, 0, 'hold'), p('infantry', 4, 3)]],
      seed: 1,
      maxTicks: 10,
      timeout: 'compare',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('invalid_army');
      expect(r.error.side).toBe(0);
    }
  });
});

describe('翼', () => {
  it('配置できる列（1〜8）では、左翼 2・中央 4・右翼 2。通り道は左翼と右翼に入る', () => {
    const cols = Array.from({ length: STANDARD_ZONE_WIDTH }, (_, i) => field.zones[0].col + i);
    const count = (side: Side): Record<string, number> => {
      const c: Record<string, number> = { left: 0, center: 0, right: 0 };
      for (const col of cols) c[wingOf(col, field, side)]!++;
      return c;
    };
    expect(count(0)).toEqual({ left: 2, center: 4, right: 2 });
    expect(count(1)).toEqual({ left: 2, center: 4, right: 2 });
    expect(wingOf(0, field, 0)).toBe('left');
    expect(wingOf(9, field, 0)).toBe('right');
    expect(wingOf(0, field, 1)).toBe('right');
    expect(wingOf(9, field, 1)).toBe('left');
  });
});

describe('騎兵の迂回', () => {
  it('配置エリアの端から迂回した騎兵は、通り道の列（x が 0〜1 か 9〜10）を走る', () => {
    for (const [col, lane] of [[1, 0], [8, 9]] as const) {
      const r = createBattle({
        field: plainField(),
        armies: [
          [p('hq', 4, 11, 'hold'), p('cavalry', col, 8, 'flank')],
          [p('hq', 4, 0, 'hold'), ...[2, 3, 4, 5, 6, 7].map((c) => p('infantry', c, 3, 'hold'))],
        ],
        seed: 1,
        maxTicks: 600,
        timeout: 'compare',
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const s = r.value;
      let inLane = false;
      for (let i = 0; i < 300 && !s.outcome; i++) {
        step(s, []);
        const cav = s.units[1]!;
        if (Math.floor(cav.x) === lane && cav.y < rowsOf(0).front) inLane = true;
      }
      expect(inLane).toBe(true);
    }
  });
});

describe('遊軍の現れるマス', () => {
  it('標準の盤では、通り道の列の、中央の線のすぐ自陣側（陣営0は行 6、陣営1は行 5）', () => {
    const r = createBattle({ field: plainField(), armies: [[p('hq', 4, 11, 'hold'), p('infantry', 4, 8)], [p('hq', 4, 0, 'hold'), p('infantry', 4, 3)]], seed: 1, maxTicks: 10, timeout: 'compare' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(spawnCell(r.value, 0, 'left')).toEqual({ col: 0, row: 6 });
    expect(spawnCell(r.value, 0, 'right')).toEqual({ col: 9, row: 6 });
    expect(spawnCell(r.value, 1, 'left')).toEqual({ col: 9, row: 5 });
    expect(spawnCell(r.value, 1, 'right')).toEqual({ col: 0, row: 5 });
  });
});

describe('ひな形と陣形の見分け（新しい配置エリア 8×4）', () => {
  const rosters: Roster[] = [STANDARD_ROSTER, PVP_RULES.standardRoster, { hq: 1, infantry: 11 }, { hq: 1, infantry: 3, shield: 3, cavalry: 2, archer: 3 }];
  it('ひな形は、どの手持ちでも通り道に置かない', () => {
    for (const t of listTemplates()) {
      for (const roster of rosters) {
        for (const side of [0, 1] as const) {
          const ps = applyTemplate(t.id, roster, field.zones[side], side);
          expect(ps.some((x) => laneCols.includes(x.col))).toBe(false);
          expect(validateArmy(ps, field.zones[side], { maxUnits: MAX_UNITS })).toEqual([]);
        }
      }
    }
  });
  it('総当たりの手持ちと対戦の標準の編成で並べたひな形は、自分の名前で判定される（両陣営）', () => {
    for (const t of listTemplates()) {
      for (const roster of [STANDARD_ROSTER, PVP_RULES.standardRoster]) {
        for (const side of [0, 1] as const) {
          const ps = applyTemplate(t.id, roster, field.zones[side], side);
          expect(recognizeFormation(ps, field.zones[side], side)?.id, `${t.id} 陣営${side} ${JSON.stringify(roster)}`).toBe(t.id);
        }
      }
    }
  });
});

// 面と対戦の地図の約束（design §13.2 の 6）。面の置き直し（§13.5）が済むまで、いまの面では落ちるものがある
describe('面と対戦の地図', () => {
  const fields: [string, Field, Placement[]][] = [
    ...PVP_MAPS.map((m): [string, Field, Placement[]] => [`対戦の地図 ${m.id}`, pvpField(m.id), []]),
    ...STAGES.map((s): [string, Field, Placement[]] => [`面 ${s.id}`, s.field, s.enemy]),
    ['チュートリアル', TUTORIAL_STAGE.field, TUTORIAL_STAGE.enemy],
  ];
  for (const [name, f, enemy] of fields) {
    it(`${name}：配置エリアの幅が STANDARD_ZONE_WIDTH 以下で、通り道のある戦場では敵が通り道の列にいない`, () => {
      for (const z of f.zones) expect(z.width).toBeLessThanOrEqual(STANDARD_ZONE_WIDTH);
      const z1 = f.zones[1];
      for (const e of enemy) {
        expect(e.col >= z1.col && e.col < z1.col + z1.width, `敵 (${e.col}, ${e.row})`).toBe(true);
      }
    });
  }
});
