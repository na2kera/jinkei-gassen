// 対戦の段階と画面の対応を決める唯一の場所。届いた room.phase を正として、出す画面を選ぶ。
// シーンは自分で次の段階を決めず、ここに「終わった」「出る」を知らせるだけにする。
//   waiting → Lobby（相手を待っています）／ setup → Deploy（対戦の配置）／ reveal → Reveal（公開）
//   battle → Battle（RemoteBattleSource）／ result → PvpResult（戦闘の画面の決着の表示が終わってから）

import type { Placement, Roster } from '@jinkei/engine';
import type Phaser from 'phaser';
import { savedRoomCode, saveRoomCode } from '../save.ts';
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
} = { setupFor: null, placements: [], roster: {} };

/** 画面に短く出す知らせ（NetOverlay が出す） */
export const notice: { text: string; until: number; error: boolean } = { text: '', until: 0, error: true };

/** 短い知らせを出す。error が false なら、失敗ではない知らせ（「写しました」など）として目立たない色で出す */
export function notify(text: string, ms = 2500, error = true): void {
  notice.text = text;
  notice.until = Date.now() + ms;
  notice.error = error;
}

const OVERLAY = 'NetOverlay';

class PvpFlow {
  active = false;
  private game: Phaser.Game | null = null;
  /** 戦闘の画面が、決着の表示を出し終えたか（battleNo ごと） */
  private battleDone = -1;
  private battleShown = -1;
  private unsubscribe: (() => void) | null = null;

  attach(game: Phaser.Game): void {
    this.game = game;
  }

  /** 部屋に入る前（作る・入る）に呼ぶ。以降、room が届くたびに画面を選ぶ */
  begin(): void {
    if (!this.unsubscribe) this.unsubscribe = client.subscribe(() => this.route());
    this.active = true;
    this.battleDone = -1;
    this.battleShown = -1;
    if (this.game && !this.game.scene.isActive(OVERLAY)) this.game.scene.start(OVERLAY);
  }

  /** 部屋を出る（どの画面からでも）。部屋の画面へ戻る */
  leave(): void {
    this.active = false;
    client.leave();
    saveRoomCode(null);
    pvpLocal.setupFor = null;
    this.go('Lobby');
  }

  /** 戦闘の画面が決着の表示を出し終えた */
  finishBattle(battleNo: number): void {
    this.battleDone = battleNo;
    this.route();
  }

  /** いまの段階に合う画面へ移す */
  route(): void {
    if (!this.active) return;
    if (client.status === 'idle') {
      // 入れなかった・つなぎ直せなかった。部屋の画面へ戻して知らせる
      this.active = false;
      if (client.failure) {
        notify(failureText(client.failure));
        if (client.failure === 'not_found' || client.failure === 'full') saveRoomCode(null);
      }
      this.go('Lobby');
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

  /** いま出ている画面（重ねている NetOverlay を除く） */
  private current(): string | null {
    const scenes = this.game?.scene.getScenes(true) ?? [];
    const s = scenes.find((x) => x.scene.key !== OVERLAY);
    return s ? s.scene.key : null;
  }

  private go(key: string, data?: object): void {
    const game = this.game;
    if (!game) return;
    const cur = this.current();
    // 同じ画面のままなら作り直さない（Lobby・Deploy などは、届いた room を見て自分で描き直す）
    if (cur === key && key !== 'Battle') return;
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
