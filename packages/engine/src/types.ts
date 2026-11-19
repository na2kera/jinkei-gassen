// engine の型（design §3.3、§3.4）。
// 状態はすべてただの JSON で表せる形にする（Map・Set・クラス・undefined の値を持たない）。

export type Side = 0 | 1;
export type Kind = 'infantry' | 'shield' | 'cavalry' | 'archer' | 'hq';
/**
 * 戦場に立つ部隊の種類。門（'gate'）は配置の兵種としては扱わず（validateArmy は知らない兵種として落とす）、
 * BattleSetup.gate で置く。画面に渡す UnitView には門を入れず、BattleView.gate で別に渡す。
 */
export type UnitKind = Kind | 'gate';
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
  | 'invalid_order'
  /** 遊軍がいない、または呼んだあと（§7.3） */
  | 'no_reserve'
  /** 開戦から T.reserveMinTick 刻み（5 秒）までは遊軍を呼べない */
  | 'reserve_not_ready'
  /** 遊軍が現れるマスがない（§7.4） */
  | 'no_spawn_cell';

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

/** 控えさせる部隊（遊軍。design §7）。兵種は本陣以外 */
export interface ReserveSetup {
  kind: Kind;
  stance: Stance;
}

/** 遊軍を呼ぶ側。その陣営から見た左右（翼と同じ向き） */
export type ReserveFrom = 'left' | 'right';

/** step に渡す、遊軍を呼ぶ入力 */
export interface ReserveInput {
  side: Side;
  from: ReserveFrom;
}

/** 予定された遊軍（面の敵と、見本・測定の自軍が呼ぶ予定）。陣営ごとに1つまで */
export interface ScriptedReserve {
  tick: number;
  side: Side;
  from: ReserveFrom;
}

/**
 * 遊軍の状態。used が true なら呼んだあと（unit は現れた部隊の id）。呼ぶ前は unit が null。
 * auto は予定された遊軍（なければ null）。tick になったら from から呼ぶ
 */
export interface ReserveState {
  kind: Kind;
  stance: Stance;
  used: boolean;
  unit: number | null;
  auto: null | { tick: number; from: ReserveFrom };
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
  /** 門（§3.8）。城壁の行の切れ目に置く。win が true なら、門が全滅した刻みに門の側の負け（理由は gate） */
  gate?: GateSetup;
  /** 既定は true。false は膠着の決まり（§3.6.4）を切る（state.quietTicks が null になり、膠着で終わらない）。動かない部隊を長く見る部品のテスト用 */
  stalemate?: boolean;
  /** この陣営の配置は「配置エリアの中」の検査をしない（面の敵の配置用）。戦場の中・城壁のマスでない・兵種・方針・本陣・部隊数は調べる */
  skipZoneCheck?: Side;
  /** 陣営ごとの遊軍（§7）。書かない・両方 null なら、遊軍のない戦い */
  reserves?: [ReserveSetup | null, ReserveSetup | null];
  /** 予定された遊軍。陣営ごとに1つまで。その陣営に遊軍がいること */
  scriptedReserves?: ScriptedReserve[];
}

export interface GateSetup {
  side: Side;
  col: number;
  row: number;
  win: boolean;
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
  kind: UnitKind;
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
  /** この刻みに実際に攻撃した相手（近接でも弓でも）。攻撃していなければ null */
  attacking: number | null;
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
  /** 前へ進む動き（§3.6.6）：直近の刻みに実際に動いた分 [dx, dy]（守備の味方にふさがれたかの判定に使う。最大 detourStuckTicks 個） */
  advMoves: [number, number][];
  /** 守備の味方の並びを回り込む途中なら、向かう出口の x。回り込んでいなければ null（§3.6.6） */
  detourX: number | null;
  /** 回り込みを始めてからの刻み数（回り込んでいなければ 0） */
  detourTicks: number;
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
  reason: 'hq' | 'wipeout' | 'timeout' | 'stalemate' | 'gate';
  /** 決着した刻み（その刻みを処理した step の state.tick。時間切れは maxTicks - 1。膠着は時計が満ちた刻み） */
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
  /** 膠着の時計（§3.6.4）：静かな刻みが続いた数。null は膠着の決まりを切った戦い（BattleSetup.stalemate が false） */
  quietTicks: number | null;
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
  /** 門（ない戦場は null）。id は門の部隊の id */
  gate: null | (GateSetup & { id: number });
  /** 陣営ごとの遊軍（いなければ null）。呼ぶ前の遊軍は units に入れない（§7.1） */
  reserves: [ReserveState | null, ReserveState | null];
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
  /** この刻みに実際に攻撃した相手（近接でも弓でも）。攻撃していなければ null。両軍ぶんを渡す（狙いは渡さない） */
  attacking: number | null;
  /** 自軍の部隊だけ。viewer が 'both' なら全部隊 */
  stance?: Stance;
}

export interface BattleView {
  tick: number;
  maxTicks: number;
  units: UnitView[];
  ordersLeft: [number, number];
  outcome: BattleState['outcome'];
  /** 門（ない戦場では項目ごとない）。門は units には入れない */
  gate?: GateView;
  /**
   * 遊軍（§7.2）。見る人の陣営のぶんだけ値を入れ、相手のぶんはいつも null（viewer が both なら両方入れる）。
   * 入れる値が1つもないとき（遊軍のない戦い、相手だけが遊軍を持つ戦い）は、項目ごと入れない（遊軍のない戦いの場面の形を、いままでと同じに保つため）
   */
  reserve?: [ReserveView | null, ReserveView | null];
}

/** 映す側に渡す遊軍。state が waiting はまだ呼べない（開戦 5 秒まで）、ready は呼べる、used は呼んだあと */
export interface ReserveView {
  kind: Kind;
  stance: Stance;
  state: 'waiting' | 'ready' | 'used';
}

/** 映す側に渡す門 */
export interface GateView {
  id: number;
  side: Side;
  col: number;
  row: number;
  x: number;
  y: number;
  /** 耐久 */
  men: number;
  maxMen: number;
  /** gone になったら門は破れている。そのとき門のマスと、その左右1マスずつの城壁は平地になっている（state.field.terrain も平地に変わる） */
  status: UnitStatus;
}

export type BattleEvent =
  | { type: 'order'; tick: number; side: Side; target: OrderTarget; kind: OrderKind }
  | { type: 'rout'; tick: number; unit: number }
  | { type: 'destroyed'; tick: number; unit: number }
  | { type: 'impact'; tick: number; attacker: number; defender: number; facing: Facing }
  | { type: 'end'; tick: number; winner: Side | 'draw'; reason: string }
  /** 遊軍が現れた（unit は現れた部隊の id） */
  | { type: 'reserve'; tick: number; side: Side; unit: number; from: ReserveFrom };

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
    /** その部隊の陣営から見た翼（UnitView.wing と同じ）。結果の画面だけに戻ってきた人も、振り返りの値だけで部隊を呼べるようにするため */
    wing: Wing;
    menLeft: number;
    dealt: number;
    routsCaused: number;
    fate: 'alive' | 'routed' | 'destroyed';
  }[];
  firstBroken: [number | null, number | null];
  /** 呼ばなかった遊軍（陣営ごと。いなければ、または呼んだなら null） */
  unusedReserve: [{ kind: Kind; men: number } | null, { kind: Kind; men: number } | null];
  /** 星の条件に使う割合（§7.5）。呼ばなかった遊軍を、無傷で残ったものとして数える。遊軍のない戦いでは remaining と同じ */
  remainingForStars: [number, number];
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
  | 'too_few_units'
  | 'over_roster'
  | 'on_wall';

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
  /** 遊軍（§7.6）。あれば、予算と部隊数に含めて数える。値の検査は reserveErrors */
  reserve?: ReserveSetup | null;
}

/** 手持ちの部隊（兵種ごとの数） */
export type Roster = Partial<Record<Kind, number>>;

export type TemplateId = 'line' | 'crane' | 'scale' | 'arrow' | 'ring' | 'crescent' | 'echelon';

export interface TemplateInfo {
  id: TemplateId;
  name: string;
  description: string;
}
