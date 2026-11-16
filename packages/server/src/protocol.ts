// client と server の通信の型（design §4.4）。
// client は `import type { ... } from '@jinkei/server/protocol'` で使う。型だけを置き、実行時の値は置かない。
//
// 座標の決まり:
//   client が送る配置も、server が送る配置・場面・戦場も、すべて「自分が下」の座標で書く。
//   陣営0の人には戦場の座標そのまま、陣営1の人には上下左右を返した座標が届く（server が返す）。
//   翼（wing・号令の target）は engine と同じく「その部隊の陣営から見た左右」で、返さない。
//   自軍の翼はそのまま自分から見た左右になる。敵軍の翼は、表示するときに左右を入れ替える（design §5.2）。
//   陣営の番号（side）は返さない。自分の陣営は room.you で知る。
//
// 接続の流れ:
//   1. POST /api/rooms（本文 { pid }）→ 201 { code }。作った人は60秒以内につなぐ。
//   2. GET /api/rooms/:code/ws?pid=…&name=…（WebSocket）。
//      つながると、まず `room` が届く。続けて段階に応じて、reveal なら `reveal`、battle なら `snap`、result なら `result` が届く。
//      入れないとき（部屋がない・満員）は `error` が届き、server が接続を閉じる（4003 / 4002）。
//   3. 部屋の様子（段階・席・成績・期限など）が変わるたびに `room` が届く。
//      決まりを破った接続は閉じる：バイナリ 1003、大きすぎる 1009、多すぎる 1008。同じ pid で入り直せる。
//   4. 文字列 "ping" を送ると "pong" が返る（JSON ではない。任意）。

import type {
  ArmyError,
  BattleEvent,
  BattleSummary,
  Field,
  Kind,
  OrderKind,
  OrderTarget,
  Outcome,
  Placement,
  Roster,
  Side,
  Stance,
  UnitStatus,
  Wing,
} from '@jinkei/engine';

// ---------- client → server ----------

/** 配置の下書き（setup の間だけ。確定中は無視される）。配置が変わるたびに送る（0.5秒に1回まで）。 */
export type DraftMessage = { type: 'draft'; army: Placement[] };

/**
 * 配置の確定（setup の間だけ）。army を付けると、それを下書きとして受け取ってから確定する（下書きの送信を待たずに確定できる）。
 * 付けなければ、最後に届いた下書きで確定する。検査を通らなければ `error`（invalid_army）が返り、確定しない。
 */
export type ReadyMessage = { type: 'ready'; army?: Placement[] };

/** 確定の取り消し（setup の間だけ）。 */
export type UnreadyMessage = { type: 'unready' };

/**
 * 号令（battle の間だけ、battleNo が今の戦いと同じときだけ）。
 * target は自分から見た翼。受け付けられなければ `error`（invalid_order）が返る。
 * 受け付けられた号令は次の刻みで engine に渡り、両者の `snap` の events に { type: 'order' } が出る。
 */
export type OrderMessage = { type: 'order'; battleNo: number; target: OrderTarget; kind: OrderKind };

/** もう一戦（result の間だけ、battleNo が終わった戦いと同じときだけ）。両者がそろうと setup に戻る。 */
export type RematchMessage = { type: 'rematch'; battleNo: number };

export type ClientMessage = DraftMessage | ReadyMessage | UnreadyMessage | OrderMessage | RematchMessage;

// ---------- server → client ----------

/** 外へ見える段階。empty と reserved は、席に着いた人には見えない。 */
export type RoomPhase = 'waiting' | 'setup' | 'reveal' | 'battle' | 'result';

export type SeatView = {
  name: string;
  /** いまつながっているか */
  connected: boolean;
  /** 配置を確定したか（setup の間だけ意味がある） */
  ready: boolean;
};

/** 対戦の予算（engine の PVP_RULES と同じ）。maxUnits は本陣以外の部隊数の上限 */
export type PvpRulesView = {
  budget: number;
  costs: Record<Kind, number>;
  maxUnits: number;
  /** 時間切れで配置がないときに使う既定の編成（横陣で並べる） */
  standardRoster: Roster;
};

export type RoomMessage = {
  type: 'room';
  /** 部屋のコード（4桁の数字） */
  code: string;
  phase: RoomPhase;
  /** この部屋で何戦目か。reveal に入るときに増える。order と rematch に付けて送る */
  battleNo: number;
  /** 自分の陣営。0 が部屋を作った人、1 が入った人 */
  you: Side;
  /** 陣営の順。空いた席は null */
  seats: [SeatView | null, SeatView | null];
  /** [陣営0の勝ち, 陣営1の勝ち, 引き分け] */
  score: [number, number, number];
  /** 期限の時刻（server の時計のミリ秒）。その段階でなければ null */
  deadlines: { setup: number | null; reveal: number | null };
  /** 送った時点の server の時刻。client は自分の時計との差を補正に使う */
  serverTime: number;
  /** 戦場の id（段階3は 'plain' だけ） */
  map: string;
  /** 戦場（自分が下の座標）。zones は陣営の順で、zones[you] がいつも下側 */
  field: Field;
  rules: PvpRulesView;
  /** 「もう一戦」を押したか（陣営の順） */
  rematch: [boolean, boolean];
  /**
   * 自分の、最後に検査を通った下書き（自分が下の座標）。setup の途中で入り直したときに、配置を戻すために使う。
   * 下書きがなければ null。
   */
  myArmy: Placement[] | null;
};

/** 公開の段階で届く配置。自軍だけ stance が付く */
export type RevealUnit = { kind: Kind; col: number; row: number; stance?: Stance };

export type RevealMessage = {
  type: 'reveal';
  battleNo: number;
  /**
   * 両軍の配置（自分が下の座標、陣営の順）。
   * 部隊の id は、陣営0の配列の順に 0 から、続けて陣営1の配列の順に振られる（engine §3.1）。snap の id と対応する。
   */
  armies: [RevealUnit[], RevealUnit[]];
  /** 開戦の時刻（server の時計） */
  startsAt: number;
  serverTime: number;
};

/**
 * 詰めた部隊（snap の units の1要素）。engine の UnitView を、項目名を省いて並べたもの。
 * 位置と向きは自分が下の座標。stance は自軍の部隊だけで、敵軍は null。
 * 位置は 0.01、向きは 0.001、兵数と士気は 0.1 の単位に丸めてある。
 */
export type PackedUnit = [
  id: number,
  side: Side,
  kind: Kind,
  wing: Wing,
  x: number,
  y: number,
  fx: number,
  fy: number,
  men: number,
  maxMen: number,
  morale: number,
  status: UnitStatus,
  order: OrderKind | null,
  attacking: number | null,
  stance: Stance | null,
];

export type SnapMessage = {
  type: 'snap';
  battleNo: number;
  /** 終わった step の回数（engine の state.tick） */
  tick: number;
  maxTicks: number;
  units: PackedUnit[];
  /**
   * 前の snap のあとに起きた出来事（engine の BattleEvent。陣営の番号はそのまま）。
   * server が作り直されたあとは、保存した刻みから続けるので、tick が少し戻り、同じ出来事がもう一度届くことがある。
   */
  events: BattleEvent[];
  /** 残りの号令（陣営の順） */
  ordersLeft: [number, number];
  outcome: Outcome | null;
};

export type ResultMessage = {
  type: 'result';
  battleNo: number;
  winner: Side | 'draw';
  reason: string;
  summary: BattleSummary;
  /** 加算したあとの成績 */
  score: [number, number, number];
};

export type ErrorReason =
  | 'not_found' // 部屋がない（入室時。この後、接続が閉じられる）
  | 'full' // 満員（入室時。この後、接続が閉じられる）
  | 'invalid_army' // 配置が不正（ready のとき）
  | 'invalid_order'; // 号令が受け付けられない（残りがない・対象の部隊がいない・決着した）

export type ErrorMessage = {
  type: 'error';
  reason: ErrorReason;
  message: string;
  /** invalid_army のとき、engine の validateArmy が返した誤り（index は送った配列の添字） */
  armyErrors?: ArmyError[];
};

export type ServerMessage = RoomMessage | RevealMessage | SnapMessage | ResultMessage | ErrorMessage;

/** WebSocket を server が閉じるときのコード */
export type CloseCode =
  | 1003 // バイナリのメッセージを送った
  | 1008 // メッセージが多すぎる（頻度の上限を超え続けた）
  | 1009 // メッセージが大きすぎる
  | 4001 // 同じ pid で新しい接続が来た
  | 4002 // 満員
  | 4003 // 部屋がない・片付けられた
  | 4004; // 接続が多すぎる

// ---------- HTTP ----------

/** POST /api/rooms の本文。pid は端末が作る128ビットの乱数（16進の小文字32文字）。相手には送られない */
export type CreateRoomRequest = { pid: string };
/** POST /api/rooms の応答（201） */
export type CreateRoomResponse = { code: string };
/**
 * HTTP のエラーの応答。部屋のコードが取れないときは 503 { error: 'busy' }（「混み合っています」）。
 * 部屋の作成・入室の試みが多すぎるときは 429 { error: 'rate_limited' }（送信元ごと。作成は1分に10回、入室は1分に30回）
 */
export type HttpErrorResponse = { error: string };
