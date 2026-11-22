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
//   2. GET /api/rooms/:code/ws?pid=…&name=…&cv=3（WebSocket）。
//      cv は client の版。付けない（古い画面）は 1 として扱う。いまの盤（design §13）を知っている cv=3 より小さい版は、
//      席を探す前に error（reason: 'outdated'）を送って 1008 で閉じる（design §13.6）。
//      両方の席が cv>=2 のときだけ、room.rules.reserve が true になり、遊軍を使える（版 3 以上しか入れないので、いつも使える）。
//      つながると、まず `room` が届く。続けて段階に応じて、reveal なら `reveal`、battle なら `snap`、result なら `result` が届く。
//      入れないとき（部屋がない・満員・古い版）は `error` が届き、server が接続を閉じる（4003 / 4002 / 1008）。
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
  ReserveFrom,
  ReserveSetup,
  ReserveView,
  Placement,
  Roster,
  Side,
  Stance,
  UnitStatus,
  Wing,
} from '@jinkei/engine';

// ---------- client → server ----------

/**
 * 配置の下書き（setup の間だけ。確定中は無視される）。配置が変わるたびに送る（0.5秒に1回まで）。
 * reserve は遊軍（design §7）。省略と null は「遊軍なし」。配置と遊軍は一組で扱い、組ごと入れ替わる。
 * 遊軍を使えない部屋（room.rules.reserve が false）で reserve に値を付けると、下書きごと捨てられ、error（reserve_disabled）が返る。
 */
export type DraftMessage = { type: 'draft'; army: Placement[]; reserve?: ReserveSetup | null };

/**
 * 配置の確定（setup の間だけ）。army を付けると、それと同じメッセージの reserve（省略なら「なし」）を一組の下書きとして
 * 受け取ってから確定する（下書きの送信を待たずに確定できる）。
 * army を付けなければ、最後に届いた下書きの組（配置と遊軍）で確定し、reserve の値は見ない。
 * 検査を通らなければ `error`（invalid_army）が返り、確定しない。遊軍の誤りは armyErrors に index なしで入る。
 * 遊軍を使えない部屋で遊軍つきの組を確定しようとすると、error（reserve_disabled）が返り、確定しない。
 */
export type ReadyMessage = { type: 'ready'; army?: Placement[]; reserve?: ReserveSetup | null };

/** 確定の取り消し（setup の間だけ）。 */
export type UnreadyMessage = { type: 'unready' };

/**
 * 号令（battle の間だけ、battleNo が今の戦いと同じときだけ）。
 * target は自分から見た翼。受け付けられなければ `error`（invalid_order）が返る。
 * 受け付けられた号令は次の刻みで engine に渡り、両者の `snap` の events に { type: 'order' } が出る。
 */
export type OrderMessage = { type: 'order'; battleNo: number; target: OrderTarget; kind: OrderKind };

/**
 * 遊軍を呼ぶ（battle の間だけ、battleNo が今の戦いと同じときだけ。それ以外は黙って捨てる）。from は自分から見た左右（返さない）。
 * 受け付けられると次の刻みで engine に渡り、両者の `snap` の events に { type: 'reserve' } が出て、現れた部隊が units に入る。
 * 呼べなければ、本人にだけ error（reason: 'invalid_reserve'、op: 'reserve'、code は engine の理由）が返る。
 * まだ engine に渡していない遊軍の入力は陣営ごとに1つまで（2つ目にも error が返る。code は 'no_reserve'）。
 * 受け付けたあとでも、渡す刻みまでに現れるマスがふさがると、engine が黙って捨てる（snap.reserve.state が 'ready' のまま残る）。
 * 遊軍を使えない部屋（room.rules.reserve が false）では error（reserve_disabled、op: 'reserve'）が返る。
 */
export type ReserveMessage = { type: 'reserve'; battleNo: number; from: ReserveFrom };

/** もう一戦（result の間だけ、battleNo が終わった戦いと同じときだけ）。両者がそろうと setup に戻る。 */
export type RematchMessage = { type: 'rematch'; battleNo: number };

/**
 * 自分で部屋を出た（design §11.2）。「部屋を出る」などを押したとき、閉じる前に送る。ただ切れたのとは別に扱う。
 *   waiting：席を空ける。
 *   setup・result：席を空け、部屋を待機に戻す（成績・結果は消える）。残った人の room の opponentLeft が true になる。
 *   reveal・battle：席は残し、seats の left を true にする。戦闘は最後まで進み、結果のあと、残った人が rematch を送るか
 *   15 秒たつと、出た人の席を空けて待機に戻す（opponentLeft が true）。出た人は、それまでなら同じ pid で入り直せる。
 * どの場合も、server がその接続を閉じる（1000）。知らない古い server は、形の違うメッセージとして捨てる
 */
export type LeaveMessage = { type: 'leave' };

export type ClientMessage = DraftMessage | ReadyMessage | UnreadyMessage | OrderMessage | ReserveMessage | RematchMessage | LeaveMessage;

// ---------- server → client ----------

/** 外へ見える段階。empty と reserved は、席に着いた人には見えない。 */
export type RoomPhase = 'waiting' | 'setup' | 'reveal' | 'battle' | 'result';

export type SeatView = {
  name: string;
  /** いまつながっているか */
  connected: boolean;
  /** 配置を確定したか（setup の間だけ意味がある） */
  ready: boolean;
  /**
   * 自分で部屋を出た席か（design §11.2。戦闘の途中で出たときだけ席が残る。connected は false）。
   * 古い server は項目を送らないので、ない場合は false として読む
   */
  left?: boolean;
};

/** 対戦の予算（engine の PVP_RULES と同じ）。maxUnits は本陣以外の部隊数の上限 */
export type PvpRulesView = {
  budget: number;
  costs: Record<Kind, number>;
  maxUnits: number;
  /** 時間切れで配置がないときに使う既定の編成（横陣で並べる） */
  standardRoster: Roster;
  /**
   * この部屋で遊軍（design §7）を使えるか。両方の席が cv>=2 でつないでいるときだけ true（相手を待っている間は false）。
   * 席の cv は下げない（同じ人が cv なしで入り直しても、大きいほうのまま）ので、同じ顔ぶれのあいだは true から false に変わらない。
   * false から true には変わりうる（古い画面の人が新しい画面で入り直したとき。変わると room が送り直される）。
   * false の間は、遊軍つきの draft / ready が error（reserve_disabled）で断られる。
   * 戦闘中の reserve のメッセージは、その戦いを作った時点（公開に入るとき）の可否で受け付け、戦いが終わるまで変わらない。
   * 古い server は項目自体を送らないので、ない場合は false として読む。
   */
  reserve?: boolean;
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
  /** 戦場の id（'plain' | 'hill' | 'river' | 'forest'。setup に入るたびにランダムに選ぶ） */
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
  /**
   * 自分の、最後に検査を通った下書きの遊軍（myArmy と同じ組）。なければ null。相手の遊軍は、あるかないかも含めて送らない。
   * 古い server は項目を送らないので、ない場合は null として読む。
   */
  myReserve?: ReserveSetup | null;
  /**
   * 待機に戻ったわけが、相手が自分で部屋を出たことか（design §11.2）。新しい相手が席に着いて setup に入ると false に戻る。
   * 古い server は項目を送らないので、ない場合は false として読む
   */
  opponentLeft?: boolean;
};

/** 公開の段階で届く配置。自軍だけ stance が付く */
export type RevealUnit = { kind: Kind; col: number; row: number; stance?: Stance };

export type RevealMessage = {
  type: 'reveal';
  battleNo: number;
  /**
   * 両軍の配置（自分が下の座標、陣営の順）。
   * 部隊の id は、陣営0の配列の順に 0 から、続けて陣営1の配列の順に振られる（engine §3.1）。snap の id と対応する。
   * 遊軍はここには入らない。呼ばれた刻みに、そのときの部隊の数を id にして snap の units に加わる。
   */
  armies: [RevealUnit[], RevealUnit[]];
  /** 自分の遊軍（なければ null）。相手の遊軍は、あるかないかも含めて送らない */
  myReserve?: ReserveSetup | null;
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
   * events の先頭の出来事の通し番号（その戦いの最初から 0, 1, 2, …）。events[i] の番号は evBase + i。
   * client は、すでに受け取った番号より小さい出来事を捨てる（server が作り直されたあとに同じ出来事がもう一度届いても、
   * 同じ番号が付いている。同じ刻みに同じ号令が2つ受け付けられても、番号は別になる）。
   * 入り直したときに最初に届く snap は events が空で、evBase は「いままでに出た出来事の数」（過去の出来事は演出しない）
   */
  evBase: number;
  /**
   * 前の snap のあとに起きた出来事（engine の BattleEvent。陣営の番号はそのまま）。
   * server が作り直されたあとは、保存した刻みから続けるので、tick が少し戻り、同じ出来事がもう一度届くことがある。
   */
  events: BattleEvent[];
  /** 残りの号令（陣営の順） */
  ordersLeft: [number, number];
  outcome: Outcome | null;
  /**
   * 自分の遊軍の様子（engine の ReserveView。'waiting' は開戦 5 秒まで、'ready' は呼べる、'used' は呼んだあと）。
   * 自分に遊軍がいなければ null。相手のぶんは送らない（RemoteBattleSource は BattleView.reserve の自分の側に入れ、相手の側を null にする）。
   * 古い server は項目を送らないので、ない場合は null として読む。
   */
  reserve?: ReserveView | null;
};

export type ResultMessage = {
  type: 'result';
  battleNo: number;
  winner: Side | 'draw';
  reason: string;
  /**
   * 振り返り。見る人ごとに作る：相手の unusedReserve は null に、相手の remainingForStars は remaining と同じ値にしてある
   * （呼ばなかった遊軍がいたことを、戦いのあとも相手に知らせない）。
   */
  summary: BattleSummary;
  /** 加算したあとの成績 */
  score: [number, number, number];
};

export type ErrorReason =
  | 'not_found' // 部屋がない（入室時。この後、接続が閉じられる）
  | 'full' // 満員（入室時。この後、接続が閉じられる）
  | 'outdated' // client の版が古い（入室時。この後、1008 で接続が閉じられる。design §13.6）
  | 'invalid_army' // 配置が不正（ready のとき）
  | 'invalid_order' // 号令が受け付けられない（残りがない・対象の部隊がいない・決着した）
  | 'invalid_reserve' // 遊軍を呼べない（op: 'reserve'。code に engine の理由）
  | 'reserve_disabled'; // この部屋では遊軍を使えない（room.rules.reserve が false。draft / ready / reserve のとき）

export type ErrorMessage = {
  type: 'error';
  reason: ErrorReason;
  message: string;
  /** invalid_army のとき、engine の validateArmy が返した誤り（index は送った配列の添字。遊軍の誤りは index なし） */
  armyErrors?: ArmyError[];
  /**
   * どのメッセージへの返事か。いまは遊軍（reserve のメッセージ）への返事にだけ 'reserve' を付ける。
   * client は、号令の「送って返事待ち」の数を、op が 'reserve' のエラーで減らさない
   */
  op?: 'reserve';
  /**
   * invalid_reserve のときの engine の理由：'no_reserve'（遊軍がいない・呼んだあと・まだ渡していない入力がある）、
   * 'reserve_not_ready'（開戦 5 秒まで）、'no_spawn_cell'（現れるマスがない）、'battle_over'（決着した）
   */
  code?: ReserveErrorCode;
};

export type ReserveErrorCode = 'no_reserve' | 'reserve_not_ready' | 'no_spawn_cell' | 'battle_over';

export type ServerMessage = RoomMessage | RevealMessage | SnapMessage | ResultMessage | ErrorMessage;

/** WebSocket を server が閉じるときのコード */
export type CloseCode =
  | 1003 // バイナリのメッセージを送った
  | 1008 // メッセージが多すぎる（頻度の上限を超え続けた）・client の版が古い（入室時。直前に error の outdated が届く）
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
 * 部屋の作成・入室の試みが多すぎるときは 429 { error: 'rate_limited' }（送信元ごと。作成は1分に60回、席にいない人の入室は1分に120回、ws の頼みは全部で1分に600回）
 */
export type HttpErrorResponse = { error: string };
