// engine の型（design §3.3、§3.4）。
// 状態はすべてただの JSON で表せる形にする（Map・Set・クラス・undefined の値を持たない）。

export type Side = 0 | 1;
export type Kind = 'infantry' | 'shield' | 'cavalry' | 'archer' | 'hq'; // 段階4で 'gate' を足す
export type Stance = 'advance' | 'hold' | 'flank' | 'hunt'; // 前進・守備・迂回・本陣狙い
export type OrderKind = 'charge' | 'brace' | 'retreat'; // 突撃・堅守・後退
export type OrderTarget = 'all' | 'left' | 'center' | 'right';
export type Wing = 'left' | 'center' | 'right';
export type Terrain = 'plain' | 'hill' | 'forest' | 'river' | 'fence' | 'wall';
export type UnitStatus = 'active' | 'routing' | 'gone';
export type Facing = 'front' | 'side' | 'rear';

export const KINDS: readonly Kind[] = ['infantry', 'shield', 'cavalry', 'archer', 'hq'];
export const STANCES: readonly Stance[] = ['advance', 'hold', 'flank', 'hunt'];
export const ORDER_KINDS: readonly OrderKind[] = ['charge', 'brace', 'retreat'];
export const ORDER_TARGETS: readonly OrderTarget[] = ['all', 'left', 'center', 'right'];

/** 成功か失敗のどちらか。engine は例外を投げず、失敗はこの形で返す。 */
export type Result<T, E = EngineError> = { ok: true; value: T } | { ok: false; error: E };

export type EngineErrorCode =
  | 'invalid_field'
  | 'invalid_setup'
  | 'invalid_army'
  | 'battle_over'
  | 'no_orders_left'
  | 'no_target_units'
  | 'invalid_order';

export interface EngineError {
  code: EngineErrorCode;
  message: string;
  /** invalid_army のとき、どちらの軍か */
  side?: Side;
  /** invalid_army のとき、配置の検査で見つかった誤り */
  armyErrors?: ArmyError[];
}

/** 配置エリア。マスの矩形で、左上のマス（col, row）と幅・高さで表す。 */
export interface Zone {
  col: number;
  row: number;
  width: number;
  height: number;
}

export interface Placement {
  kind: Kind;
  col: number;
  row: number;
  stance: Stance;
}

export interface Field {
  width: number;
  height: number;
  /** 行優先。長さは width × height */
  terrain: Terrain[];
  /** 陣営ごとの配置エリア */
  zones: [Zone, Zone];
}

export interface ScriptedOrder {
  tick: number;
  side: Side;
  target: OrderTarget;
  kind: OrderKind;
}

export interface BattleSetup {
  field: Field;
  /** 戦場の座標で書く */
  armies: [Placement[], Placement[]];
  seed: number;
  /** 標準は 1800（3分） */
  maxTicks: number;
  timeout: 'compare' | 'side0_wins' | 'side0_loses';
  /** ステージの敵の号令 */
  scriptedOrders?: ScriptedOrder[];
  /** 既定は true。false は部分的な戦いのテスト用 */
  requireHq?: boolean;
}

export interface UnitOrder {
  kind: OrderKind;
  untilTick: number;
}

export interface UnitStats {
  dealt: number;
  taken: number;
  flankDealt: number;
  routsCaused: number;
}

export interface Unit {
  id: number;
  side: Side;
  kind: Kind;
  wing: Wing;
  /** 位置 */
  x: number;
  y: number;
  /** 向きの単位ベクトル */
  fx: number;
  fy: number;
  men: number;
  maxMen: number;
  /** 0〜100 */
  morale: number;
  stance: Stance;
  home: { x: number; y: number };
  status: UnitStatus;
  goneReason: null | 'routed' | 'destroyed';
  /** 攻撃し、向く相手（§3.6.1） */
  target: number | null;
  order: null | UnitOrder;
  stats: UnitStats;
  /** 迂回の進み具合。1: 端の列へ出る、2: 端に沿って進む、3: 敵を狙う */
  flankPhase: 1 | 2 | 3;
  /** 迂回の①で出る端の列の x（開戦時に決める） */
  flankEdgeX: number;
  /** 騎兵の助走距離（近接の距離に敵がいない状態で続けて動いた距離） */
  runup: number;
  /** 本陣狙い：直近の刻みに本陣へ向かって動いた分 [dx, dy]（詰まりの判定に使う。最大 huntStuckTicks 個） */
  huntMoves: [number, number][];
  /** 本陣狙い：詰まって戦っている相手。なければ null */
  huntStuckOn: number | null;
  /** 本陣狙い：ぶつかり続けている間に回る側。動きたい向きの左が 1、右が -1、未定は 0 */
  slideSign: 1 | -1 | 0;
  /** 最後に損害を受けた刻み。まだなら null */
  lastHitTick: number | null;
  /** 敗走を始めた刻み。敗走していなければ null */
  routTick: number | null;
}

/** 前の刻みに敗走・全滅した部隊の記録（次の刻みの士気の計算に使う） */
export interface BrokenRecord {
  unit: number;
  side: Side;
  x: number;
  y: number;
  reason: 'routed' | 'destroyed';
  /** その刻みの初めに、この部隊を狙いにしていた部隊 */
  holders: number[];
}

export interface Outcome {
  winner: Side | 'draw';
  reason: 'hq' | 'wipeout' | 'timeout' | 'gate';
  /** 決着した刻み（その刻みを処理した step の state.tick。時間切れは maxTicks - 1） */
  tick: number;
}

export interface BattleState {
  tick: number;
  /** 乱数の状態（32ビット符号なし整数） */
  rng: number;
  field: Field;
  units: Unit[];
  ordersUsed: [number, number];
  maxTicks: number;
  timeout: BattleSetup['timeout'];
  outcome: null | Outcome;
  requireHq: boolean;
  /** 開戦時の兵数の合計（本陣を含む） */
  initialMen: [number, number];
  /** 陣営ごとに、最初に消えた（敗走・全滅した）部隊 */
  firstBroken: [number | null, number | null];
  /** 予定された号令（tick の昇順） */
  scriptedOrders: ScriptedOrder[];
  /** 予定された号令のうち、次に見る位置（毎刻み全件を走査しないため） */
  scriptedNext: number;
  /** 前の刻みに敗走・全滅した部隊 */
  brokenLastTick: BrokenRecord[];
  /** 陣営ごとの、迂回の②で進む先の y（開戦時の敵軍の重心から決める） */
  flankY: [number, number];
}

export interface OrderInput {
  side: Side;
  target: OrderTarget;
  kind: OrderKind;
}

export interface UnitView {
  id: number;
  side: Side;
  kind: Kind;
  wing: Wing;
  x: number;
  y: number;
  fx: number;
  fy: number;
  men: number;
  maxMen: number;
  morale: number;
  status: UnitStatus;
  order: OrderKind | null;
  /** 自軍の部隊だけ。viewer が 'both' なら全部隊 */
  stance?: Stance;
}

export interface BattleView {
  tick: number;
  maxTicks: number;
  units: UnitView[];
  ordersLeft: [number, number];
  outcome: BattleState['outcome'];
}

export type BattleEvent =
  | { type: 'order'; tick: number; side: Side; target: OrderTarget; kind: OrderKind }
  | { type: 'rout'; tick: number; unit: number }
  | { type: 'destroyed'; tick: number; unit: number }
  | { type: 'impact'; tick: number; attacker: number; defender: number; facing: Facing }
  | { type: 'end'; tick: number; winner: Side | 'draw'; reason: string };

export interface BattleSummary {
  winner: Side | 'draw';
  /** 決着していなければ 'ongoing' */
  reason: string;
  seconds: number;
  /** 残った兵の割合。敗走・全滅した部隊は0と数える */
  remaining: [number, number];
  units: {
    id: number;
    side: Side;
    kind: Kind;
    menLeft: number;
    dealt: number;
    routsCaused: number;
    fate: 'alive' | 'routed' | 'destroyed';
  }[];
  firstBroken: [number | null, number | null];
}

export type ArmyErrorCode =
  | 'invalid_kind'
  | 'invalid_stance'
  | 'invalid_cell'
  | 'out_of_zone'
  | 'overlap'
  | 'hq_count'
  | 'over_budget'
  | 'too_many_units'
  | 'too_few_units';

export interface ArmyError {
  code: ArmyErrorCode;
  /** 問題のある配置の添字（配置ごとの誤りのとき） */
  index?: number;
  message: string;
}

/** 配置の検査の条件 */
export interface ArmyLimits {
  /** 本陣を含めた部隊数の上限 */
  maxUnits: number;
  /** 本陣を除いた部隊数の下限。既定は 1 */
  minUnits?: number;
  /** 予算。省略すると予算を見ない */
  budget?: number;
  /** 兵種ごとの値段。省略すると DEFAULT_COSTS */
  costs?: Partial<Record<Kind, number>>;
  /** 本陣がちょうど1つ必要か。既定は true */
  requireHq?: boolean;
}

/** 手持ちの部隊（兵種ごとの数） */
export type Roster = Partial<Record<Kind, number>>;

export type TemplateId = 'line' | 'crane' | 'scale' | 'arrow' | 'ring' | 'crescent' | 'echelon';

export interface TemplateInfo {
  id: TemplateId;
  name: string;
  description: string;
}
