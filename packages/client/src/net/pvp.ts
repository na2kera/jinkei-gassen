// 対戦の段階と画面の対応を決める唯一の場所。届いた room.phase を正として、出す画面を選ぶ。
// シーンは自分で次の段階を決めず、ここに「終わった」「出る」を知らせるだけにする。
//   waiting → Lobby（相手を待っています）／ setup → Deploy（対戦の配置）／ reveal → Reveal（公開）
//   battle → Battle（RemoteBattleSource）／ result → PvpResult（戦闘の画面の決着の表示が終わってから）
// 画面の切り替えの予約（scene.start・restart）は、対戦の間はここだけが行う。
// シーンが自分で作り直しを予約すると、ここの切り替えとぶつかって2つの画面が同時に動くため。
//
// 配置の下書きと確定も、まだサーバーに届いていない分をここに持つ（シーンを作り直しても、つなぎ直しても失わない）。

import type { Placement, Roster } from '@jinkei/engine';
import type Phaser from 'phaser';
import { savedRoomCode, saveRoomCode, savePvpArmy } from '../save.ts';
import { RemoteBattleSource } from './RemoteBattleSource.ts';
import { failureText, RoomClient } from './RoomClient.ts';

export const client = new RoomClient();

/** 対戦の配置を、画面を作り直しても失わないよう、ここに持つ */
export const pvpLocal: {
  /** どの戦いの前の配置か（room.battleNo）。変わったら、room.myArmy か前の戦いの配置から始め直す */
  setupFor: number | null;
  placements: Placement[];
  /** 編成（兵種ごとの数） */
  roster: Roster;
  /** まだサーバーに届けていない配置の変更がある */
  draftDirty: boolean;
  /** 自分が望む確定の状態。サーバーの席の ready と違えば、届くまで送り直す。null は望みなし */
  wantReady: boolean | null;
} = { setupFor: null, placements: [], roster: {}, draftDirty: false, wantReady: null };

/** 部屋の画面の入力途中の値（向きを変えてシーンを作り直しても消えないよう、ここに持つ） */
export const lobbyInput = { code: '' };

/** 画面に短く出す知らせ（NetOverlay と部屋の画面が出す） */
export const notice: { text: string; until: number; error: boolean } = { text: '', until: 0, error: true };

/** 短い知らせを出す。error が false なら、失敗ではない知らせ（「写しました」など）として目立たない色で出す */
export function notify(text: string, ms = 2500, error = true): void {
  notice.text = text;
  notice.until = Date.now() + ms;
  notice.error = error;
}

const OVERLAY = 'NetOverlay';
/** 下書きを送る間隔の下限（ミリ秒。design §4.3） */
const DRAFT_GAP_MS = 500;

class PvpFlow {
  active = false;
  private game: Phaser.Game | null = null;
  /** 戦闘の画面が、決着の表示を出し終えたか（battleNo ごと） */
  private battleDone = -1;
  private battleShown = -1;
  /** 開始を予約したが、まだ create されていない画面 */
  private pending: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private lastDraftAt = 0;
  private draftTimer = 0;

  attach(game: Phaser.Game): void {
    this.game = game;
    if (!this.unsubscribe) {
      this.unsubscribe = client.subscribe(() => this.route());
      client.onError((m) => {
        // 確定が断られたら、確定の望みを取り下げる（送り直し続けないため）
        if (m.reason === 'invalid_army') {
          pvpLocal.wantReady = false;
          notify('配置が正しくありません');
        }
      });
    }
  }

  /** 部屋に入る前（作る・入る）に呼ぶ。以降、room が届くたびに画面を選ぶ */
  begin(): void {
    this.active = true;
    this.battleDone = -1;
    this.battleShown = -1;
    if (this.game && !this.game.scene.isActive(OVERLAY)) this.game.scene.start(OVERLAY);
  }

  /** 部屋に入る前の操作をやめる（部屋の画面の「戻る」）。作成の途中の応答は捨てられる */
  cancel(): void {
    this.active = false;
    client.leave();
  }

  /** 部屋を出る（どの画面からでも）。部屋の画面へ戻る */
  leave(): void {
    this.active = false;
    client.leave();
    saveRoomCode(null);
    pvpLocal.setupFor = null;
    pvpLocal.draftDirty = false;
    pvpLocal.wantReady = null;
    window.clearTimeout(this.draftTimer);
    this.go('Lobby', undefined, true);
  }

  /** 戦闘の画面が決着の表示を出し終えた */
  finishBattle(battleNo: number): void {
    this.battleDone = battleNo;
    this.route();
  }

  /** シーンの create から呼ぶ。予約していた画面が始まった */
  arrived(key: string): void {
    if (this.pending === key) this.pending = null;
  }

  /**
   * 対戦のシーンが、向きの切り替えなどで自分を作り直したいときに呼ぶ。
   * 別の画面への切り替えを予約中なら、作り直さない（2つの画面が同時に動くのを防ぐ）
   */
  requestRestart(scene: Phaser.Scene, data?: object): void {
    if (this.pending && this.pending !== scene.scene.key) return;
    this.pending = scene.scene.key;
    scene.scene.restart(data);
  }

  // ---- 配置の下書きと確定（まだ届いていない分を持ち、届くまで送り直す） ----

  /** 配置が変わった。0.5秒に1回までにまとめて送る */
  markDraft(): void {
    pvpLocal.draftDirty = true;
    // 手元の最後の配置として保存にも残す（読み込み直したあとの次の戦いで、前の配置から始めるため）
    savePvpArmy(pvpLocal.placements);
    this.scheduleDraft();
  }

  private scheduleDraft(): void {
    window.clearTimeout(this.draftTimer);
    const wait = Math.max(0, this.lastDraftAt + DRAFT_GAP_MS - Date.now());
    this.draftTimer = window.setTimeout(() => this.flushDraft(), wait);
  }

  /** まだ送っていない下書きがあれば送る。送れなかったら印を残す（つなぎ直したあとに送る） */
  flushDraft(): void {
    const room = client.room;
    if (!pvpLocal.draftDirty || !room || room.phase !== 'setup') return;
    // 確定中（または確定を望んでいる間）は下書きを受け付けないので送らない
    if (room.seats[room.you]?.ready || pvpLocal.wantReady === true) return;
    if (Date.now() - this.lastDraftAt < DRAFT_GAP_MS) {
      this.scheduleDraft();
      return;
    }
    if (client.send({ type: 'draft', army: pvpLocal.placements.map((p) => ({ ...p })) })) {
      this.lastDraftAt = Date.now();
      pvpLocal.draftDirty = false;
    }
  }

  /** 確定・取り消しを望む。届いていなければ、room が届くたびに送り直す */
  setReady(ready: boolean): void {
    pvpLocal.wantReady = ready;
    this.syncReady();
  }

  private syncReady(): void {
    const room = client.room;
    if (!room || room.phase !== 'setup' || pvpLocal.wantReady === null) return;
    const now = room.seats[room.you]?.ready ?? false;
    if (now === pvpLocal.wantReady) return;
    if (pvpLocal.wantReady) {
      // 確定には最新の配置を付けて送る（下書きの送信を待たずに確定できる）
      if (client.send({ type: 'ready', army: pvpLocal.placements.map((p) => ({ ...p })) })) pvpLocal.draftDirty = false;
    } else {
      client.send({ type: 'unready' });
    }
  }

  /** 配置の段階で、まだ届いていない下書き・確定を送る（シーンを作り直したとき・つなぎ直したとき・room が届いたとき） */
  syncSetup(): void {
    const room = client.room;
    if (!room || room.phase !== 'setup') return;
    const ready = room.seats[room.you]?.ready ?? false;
    // サーバーが確定を受け付けたら、望みは果たされた
    if (pvpLocal.wantReady === ready) pvpLocal.wantReady = null;
    this.syncReady();
    this.flushDraft();
  }

  /** いまの段階に合う画面へ移す */
  route(): void {
    if (!this.active) return;
    if (client.status === 'idle') {
      if (client.creating) return;
      // 入れなかった・つなぎ直せなかった・別の画面で開かれた。部屋の画面へ戻して知らせる
      this.active = false;
      if (client.failure) {
        notify(failureText(client.failure));
        // 部屋がない・満員・別の画面で開かれたときは、保存したコードを消す（「前の部屋に戻る」を出さない）。
        // 別の画面で開かれたときに戻ると、もう一方の画面を締め出してしまうため
        if (client.failure === 'not_found' || client.failure === 'full' || client.failure === 'replaced') saveRoomCode(null);
      }
      this.go('Lobby', undefined, true);
      return;
    }
    const r = client.room;
    if (!r) return;
    saveRoomCode(r.code);
    switch (r.phase) {
      case 'waiting':
        this.go('Lobby');
        return;
      case 'setup':
        if (pvpLocal.setupFor !== r.battleNo) {
          // 新しい配置の段階に入った。前の戦いの「届いていない分」は持ち越さない
          pvpLocal.wantReady = null;
        }
        this.syncSetup();
        this.go('Deploy', { pvp: true });
        return;
      case 'reveal':
        this.go('Reveal');
        return;
      case 'battle': {
        if (this.current() === 'Battle' && this.battleShown === r.battleNo) return;
        this.battleShown = r.battleNo;
        const source = new RemoteBattleSource(client, r.battleNo, r.you);
        this.go('Battle', {
          source,
          field: r.field,
          viewer: r.you,
          // 場面はサーバーが「自分が下」に返し済みなので、ここでは返さない（二重に返さない）
          flip: false,
          orders: true,
          quitLabel: '出る',
          onQuit: () => this.leave(),
          onFinished: () => this.finishBattle(r.battleNo),
          stageId: '',
        });
        return;
      }
      case 'result':
        // 戦闘の画面が決着の表示を出しているあいだは待つ（終わったら finishBattle から呼ばれる）
        if (this.current() === 'Battle' && this.battleDone !== r.battleNo) return;
        this.go('PvpResult');
        return;
    }
  }

  /** いま出ている画面（重ねている NetOverlay を除く）。予約中の画面があれば、それを今の画面とみなす */
  private current(): string | null {
    if (this.pending) return this.pending;
    const scenes = this.game?.scene.getScenes(true) ?? [];
    const s = scenes.find((x) => x.scene.key !== OVERLAY);
    return s ? s.scene.key : null;
  }

  /**
   * 画面を移す。同じ画面のままなら作り直さない（Lobby・Deploy などは、届いた room を見て自分で描き直す）。
   * force は、同じ画面でも始め直すとき（部屋を出て、部屋の画面を入る前の表示に戻すとき）
   */
  private go(key: string, data?: object, force = false): void {
    const game = this.game;
    if (!game) return;
    const cur = this.current();
    if (cur === key && key !== 'Battle' && !force) return;
    this.pending = key;
    const s = game.scene.getScenes(true).find((x) => x.scene.key !== OVERLAY);
    if (s) s.scene.start(key, data);
    else game.scene.start(key, data);
  }
}

export const pvp = new PvpFlow();

/** 読み込み直したときに「前の部屋に戻る」を出すか */
export function resumableCode(): string | null {
  return savedRoomCode();
}
