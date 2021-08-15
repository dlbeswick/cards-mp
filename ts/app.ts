import { assert, assertf } from './assert.js'
import * as array from './array.js'
import * as dom from "./dom.js"
import {
  Connections, ContainerSlotCard, EventContainerChange, EventMove, EventPeerUpdate, EventPlayfieldChange,
  EventSlotChange, Game, GameGinRummy, GameDummy, GameHearts, GamePoker, GamePokerChinese, MoveCards, 
  MoveItemsAny, NotifierSlot, PeerPlayer, Player, Playfield, Slot,
  deserializeMove,
  ConflictResolution
} from "./game.js"
import errorHandler from "./error_handler.js"
import { Images } from "./images.js"
import * as it from "./iterator.js"
import { Vector } from "./math.js"
import * as set from './set.js'
import { Selection, UIContainer, UIContainerDiv, UIContainerFlex, UIContainerSlotsMulti, UIMovable, UISlotChip, UISlotSingle, UISlotRoot, UISlotSpread } from "./ui.js"

class Turn {
  constructor(
    readonly playfield: Playfield,
    readonly sequence: number,
    readonly moves: readonly MoveItemsAny[],
    readonly invalidated: Set<MoveItemsAny> = new Set()
  ) {}

  get isEmpty() {
    return this.moves.length == 0
  }
  
  get isValid() {
    return this.moves.some(move => this.moves.some(other => move.isConflictingWith(other))) == false
  }
  
  get nextPlayfield() {
    assert(this.isValid)

    return this.moves.
      reduce((pf, move) => move.apply(pf), this.playfield).
      withTurnSequence(this.playfield.sequence + 1)
  }

  withMove(move: MoveItemsAny) {
    return new Turn(this.playfield, this.sequence, this.moves.concat(move))
  }

  withConflictsRemoved(invalidated: Set<MoveItemsAny>) {
    const unionInvalidated = set.union(this.invalidated, invalidated)
    
    const [nonConflict, conflict] =
      array.partition(
        this.moves,
        move => it.some(unionInvalidated, c => move.isConflictingWith(c))
      )

    return new Turn(
      this.playfield,
      this.sequence,
      nonConflict,
      set.union(new Set(conflict), unionInvalidated)
    )
  }
  
  withConflictsResolved() {
    const f =
      (lhs: MoveItemsAny,
       items: readonly MoveItemsAny[],
       result: readonly MoveItemsAny[],
       removed: readonly MoveItemsAny[]): [readonly MoveItemsAny[], readonly MoveItemsAny[]] => {
        
        let tail = items
        while (tail.length != 0) {
          const item = tail[0]
          
          switch (lhs.resolveConflictWith(item)) {
            case ConflictResolution.BOTH_STAY:
              break;
            case ConflictResolution.LEFT_STAY:
              return f(lhs, array.remove(items, item), result, removed.concat([item]));
            case ConflictResolution.RIGHT_STAY:
              return f(items[0], items.slice(1), result, removed.concat([item]));
            case ConflictResolution.BOTH_REMOVE:
              return f(items[0], array.remove(items.slice(1), item), result, removed);
            default:
              assert(false)
          }
          
          tail = items.slice(1)
        }

        if (items.length == 0)
          return [result.concat(lhs), removed]
        else
          return f(items[0], items.slice(1), result.concat(lhs), removed)
      }

    const [resolved, removed] = f(this.moves[0], this.moves.slice(1), [], [])
    
    return new Turn(this.playfield, this.sequence, resolved, new Set(removed))
  }
  
  withPlayfield(playfield: Playfield) {
    return new Turn(playfield, this.sequence, this.moves)
  }

  serialize() {
    return {
      playfield: this.playfield.serialize(),
      sequence: this.sequence,
      moves: this.moves.map(m => m.serialize())
    }
  }

  static fromSerialized(s: any) {
    const pf = Playfield.fromSerialized(s.playfield)
    return new Turn(
      pf,
      s.sequence,
      s.moves.map((m: any) => deserializeMove(m))
    )
  }
}

window.onerror = errorHandler

document.addEventListener("deviceready", () => {
  run("img/cards.svg", "img/back.svg")
})

class App {
  readonly selection: Selection = new Selection()
  readonly notifierSlot: NotifierSlot
  readonly connections: Connections = new Connections(this.onPeerReconnect.bind(this))
  readonly games: Game[]
  private maxPlayers: number = 2
  private root: UISlotRoot
  private cardWidth = 74
  private cardHeight = 112
  private viewer: Player
  private game: Game
  private audioCtx?: AudioContext
  private turns: Turn[] = [new Turn(new Playfield(0, [], []), 0, [])]
  private debugMessages: any[] = []
  
  constructor(games: Game[],
              notifierSlot: NotifierSlot,
              root: UISlotRoot,
              readonly images: Images,
              readonly onNewGame:(game: Game) => void = () => {},
              readonly onMaxPlayers:(maxPlayers: number) => void = () => {},
              readonly onPeerChanged:(peers: PeerPlayer[]) => void = () => {}
             ) {
    
    assertf(() => games)
    this.games = games
    this.game = games[0]
    this.notifierSlot = notifierSlot
    this.viewer = this.game.players[0]
    this.root = root
  }

  private turnsReplay(fromIdx: number): Array<Turn> {
    const turnsProcessed: Array<Turn> = []

    // Process turns until reaching the head of the turn list, as long as the head is empty.
    // If the head isn't empty, create a new empty head at the end of the list.
    for (let turnIdx = fromIdx;
         turnIdx < this.turns.length && !(turnIdx == this.turns.length - 1 && this.turns[turnIdx].isEmpty); ) {
      
      const turn = this.turns[turnIdx]
      if (turn.isValid) {
        if (turn.isEmpty && turnIdx == this.turns.length - 1) {
          break;
        }
        
        const pf = turn.nextPlayfield
        assert(pf)

        if (turnIdx == this.turns.length - 1)
          this.turns[turnIdx+1] = new Turn(pf, pf.sequence, [])
        else
          this.turns[turnIdx+1] = this.turns[turnIdx+1].withPlayfield(pf)

        assert(this.turns[turnIdx+1].sequence - this.turns[turnIdx].sequence == 1)
        
        turnsProcessed.push(this.turns[turnIdx])

        ++turnIdx;
      } else {
        const resolved = turn.withConflictsResolved()
        this.turns[turnIdx] = resolved
        
        for (let turnIdx2 = fromIdx+1; turnIdx2 < this.turns.length; ++turnIdx2) {
          this.turns[turnIdx2] = this.turns[turnIdx2].withConflictsRemoved(resolved.invalidated)
        }
      }

      assert(turnIdx == this.turns.length || this.turns[turnIdx].isValid)
    }

    this.turns.reduce((a,b) => { assert(b.sequence - a.sequence == 1); return b })
    
    return turnsProcessed
  }
  
  private onMove(move: MoveItemsAny, localAction: boolean) {
    assert(this.turns.length > 0)
    
    if (localAction) {
      this.connections.broadcast({move: move.serialize()})
    }
    
    const playfield = this.playfield
    const slotsChanged = new Set<[string, number]>()

    let turnsProcessed: Array<Turn>

    let turnIdx = this.turns.findIndex(t => t.sequence == move.turnSequence)
    assert(turnIdx != -1)

    this.turns[turnIdx] = this.turns[turnIdx].withMove(move)
    turnsProcessed = this.turnsReplay(turnIdx)
    if (this.turns.length > 100)
      this.turns.shift()

    for (const turn of turnsProcessed) {
      for (const move of turn.moves) {
        move.slotsChanged.forEach(s => slotsChanged.add(s))
      }
    }

    for (const idCnt of move.slotsNew.map(([idCnt, id]) => idCnt)) {
      this.notifierSlot.container(idCnt).dispatchEvent(
        new EventContainerChange(playfield, this.playfield, idCnt)
      )
    }
    
    this.notifierSlot.slotsUpdate(playfield, this.playfield, slotsChanged, localAction)
    this.notifierSlot.eventTarget.dispatchEvent(new EventPlayfieldChange(playfield, this.playfield))
  }

  private get turnCurrent() {
    assert(this.turns.length > 0)
    return this.turns[this.turns.length - 1]
  }
  
  private get playfield() {
    return this.turnCurrent.playfield
  }
  
  audioCtxGet(): AudioContext|undefined {
    const ctx = (<any>window).AudioContext || (<any>window).webkitAudioContext
    if (ctx)
      this.audioCtx = this.audioCtx || new ctx()
    return this.audioCtx
  }

  init() {
    this.notifierSlot.registerPreSlotUpdate(this.preSlotUpdate.bind(this))
    this.notifierSlot.registerPostSlotUpdate(this.postSlotUpdate.bind(this))
    
    this.notifierSlot.eventTarget.addEventListener("gamemove", (e: EventMove) => this.onMove(e.move, e.localAction))
  }

  rootGet(): UISlotRoot {
    return this.root
  }
  
  newGame(idGame: string, turns?: Turn[], viewerId?: string) {
    const game = this.games.find(g => g.id == idGame)
    if (!game) {
      throw new Error("No such game " + idGame)
    }

    this.game = game
    this.maxPlayers = Math.min(this.maxPlayers, this.game.playersActive().length)
    this.turns = turns ?? [new Turn(this.game.playfield(this.maxPlayers), 0, [])]
    this.viewerSet(
      this.game.players.find(p => p.id == viewerId) ??
        this.game.players.find(p => p.id == this.viewer?.id) ??
        this.game.players[0]
    ) || this.uiCreate()

    this.onNewGame(this.game)
  }

  newHand() {
    this.turns = [new Turn(this.game.playfieldNewHand(this.maxPlayers, this.playfield), 0, [])]
    this.uiCreate()
  }
  
  cardSizeSet(width: number, height: number) {
    this.cardWidth = width
    this.cardHeight = height
    this.uiCreate()
  }

  cardWidthGet() { return this.cardWidth }
  cardHeightGet() { return this.cardHeight }
  
  viewerSet(viewer: Player): boolean {
    assertf(() => this.game)
    if (this.viewer == viewer)
      return false
    
    this.viewer = viewer
    this.uiCreate()
    return true
  }

  protected uiCreate() {
    assert(this.game)
    this.root.destroy()
    this.root = new UISlotRoot()
    this.game.makeUi(this.playfield, this)
    dom.demandById("player").innerText = this.viewer.id

    for (const cnt of this.playfield.containers) {
      for (const slot of cnt) {
        this.notifierSlot.slot(cnt.id, slot.idSlot).dispatchEvent(
          new EventSlotChange(this.playfield, this.playfield, cnt.id, slot.idSlot)
        )
      }
      this.notifierSlot.container(cnt.id).dispatchEvent(
        new EventContainerChange(this.playfield, this.playfield, cnt.id)
      )
    }

    for (const cnt of this.playfield.containersChip) {
      for (const slot of cnt) {
        this.notifierSlot.slot(cnt.id, slot.idSlot).dispatchEvent(
          new EventSlotChange(this.playfield, this.playfield, cnt.id, slot.idSlot)
        )
      }
      this.notifierSlot.container(cnt.id).dispatchEvent(
        new EventContainerChange(this.playfield, this.playfield, cnt.id)
      )
    }
  }

  viewerGet() {
    return this.viewer
  }

  gameGet() {
    return this.game
  }

  private preSlotUpdate(slotsOld: Slot[], localAction: boolean): [UIMovable, Vector][] {
    return this.root.uiMovablesForSlots(slotsOld).map(uim => [uim, uim.coordsAbsolute()])
  }

  postSlotUpdate(slots: Slot[], uimovs: [UIMovable, Vector][], localAction: boolean) {
    const msDuration = localAction ? 250 : 1000
    
    const uimovs_ = this.root.uiMovablesForSlots(slots)
    
    for (const [uimov, start] of uimovs) {
      const uimov_ = uimovs_.find(u_ => u_.is(uimov))
      
      if (uimov_) {
        // UIMoveable has a presence in the new playfield.
        
        if (uimov_ != uimov) {
          // The UIMoveable has changed visually in the new playfield.
          uimov.removeFromPlay()
          
          const end = uimov_.coordsAbsolute()
          if (end[0] == start[0] && end[1] == start[1]) {
            uimov_.fadeTo('0%', '100%', 250, uimov.destroy.bind(uimov))
          } else {
            uimov_.element.style.visibility = 'hidden'
            uimov.animateTo(
              start,
              end,
              Number(uimov_.element.style.zIndex),
              msDuration,
              () => {
                uimov_.element.style.visibility = 'visible'
                if (uimov.equalsVisually(uimov_)) {
                  uimov.destroy()
                } else {
                  uimov.fadeTo('100%', '0%', 250, uimov.destroy.bind(uimov))
                }
              })
          }
        }
      } else {
        // UIMoveable has no presence in the new playfield.
        uimov.removeFromPlay()
        uimov.animateTo(start, [start[0], start[1]], Number(uimov.element.style.zIndex), 0)
        uimov.fadeTo('100%', '0%', 250, uimov.destroy.bind(uimov))
      }
    }

    const ctx = this.audioCtxGet()
    if (ctx) {
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = 200 + Math.random() * 500
      osc.frequency.setTargetAtTime(200 + Math.random() * 500, 0, msDuration / 1000)
      const gain = ctx.createGain()
      gain.gain.value = 0.25
      gain.gain.setTargetAtTime(0.0, ctx.currentTime + msDuration / 1000 / 2, 0.1)
      osc.connect(gain)
      gain.connect(ctx.destination)

      const mod = ctx.createOscillator()
      mod.frequency.value = 10 + Math.random() * 10
      mod.frequency.setTargetAtTime(1 + Math.random() * 5, 0, msDuration / 1000)
      const gmod = ctx.createGain()
      gmod.gain.value = 100
      mod.connect(gmod)
      gmod.connect(osc.frequency)
      mod.start(0)

      osc.onended = () => { gain.disconnect(); gmod.disconnect(); mod.stop(0) }
      
      osc.start(0)
      osc.stop(ctx.currentTime + msDuration / 1000)
    }
  }

  sync(newGame: boolean, peerTarget?: PeerPlayer) {
    const data = {
      newGame: newGame,
      game: this.game.id,
      turn: this.turnCurrent.serialize(),
      maxPlayers: this.maxPlayers
    }
    for (const peer of this.connections.peersGet()) {
      if (!peerTarget || peerTarget == peer) {
        if (peer.open())
          peer.send({sync: {...data}})
        else
          console.error("sync: Peer not open", peer)
      }
    }
  }

  revealAll() {
    const moves: MoveCards[] = this.playfield.containers.flatMap( cnt =>
      Array.from(cnt).map( slot =>
        new MoveCards(
          this.turnCurrent.sequence,
          Array.from(slot).map(wc => wc.withFaceStateConscious(true, true)),
          slot.id,
          slot.id
        )
      )
    )

    for (const move of moves)
      this.notifierSlot.move(move)
  }

  onReceiveData(data: any, peer: PeerPlayer) {
    if ((window as any).mptest_latency) {
      this.debugMessages.push(data)
      window.setTimeout(
        () => {
          const d = this.debugMessages[0]
          this.debugMessages = this.debugMessages.slice(1)
          this._onReceiveData(d, peer)
        },
        Math.floor(Math.random() * 1000)
      )
    } else {
      this._onReceiveData(data, peer)
    }
  }
  
  private _onReceiveData(data: any, peer: PeerPlayer) {
    if (data.chern) {
      this.maxPlayersSet(Math.max(data.chern.maxPlayers, this.maxPlayers))

      // Synchronise the incoming (peer, player) pairs (including local player).
      // Connect to any peers that this node didn't know about before.
      for (const peer of data.chern.peers) {
        const player = this.game.players.find(p => p.isId(peer.player))
        assert(player, "Unknown player", peer)
        if (peer.id == this.connections.registrantId()) {
          this.viewerSet(player)
        } else if (!this.connections.peerById(peer.id)) {
          this.connections.connect(peer.id, player, () => {}, {})
        } else {
          const peerPlayer = this.connections.peerById(peer.id)
          assert(peerPlayer)
          peerPlayer.playerChange(player)
        }
      }
      this.onPeerChanged(this.connections.peersGet())
      this.onMaxPlayers(this.maxPlayers)
    } else if (data.ping) {
      //demandElementById("connect-status").dispatchEvent(new EventPingBack(data.ping.secs))
      peer.send({ping_back: {secs: data.ping.secs}})
    } else if (data.ping_back) {
      //demandElementById("connect-status").dispatchEvent(new EventPingBack(data.ping_back.secs))
    } else if (data.sync) {
      this.maxPlayers = data.sync.maxPlayers
      this.onMaxPlayers(this.maxPlayers)

      const turnIncoming = Turn.fromSerialized(data.sync.turn)
      const idxExisting = this.turns.findIndex(t => t.sequence == turnIncoming.sequence)
      if (data.sync.newGame || idxExisting == -1) {
        this.newGame(data.sync.game, [turnIncoming])
      } else {
        this.turns[idxExisting] = turnIncoming
        this.turnsReplay(idxExisting)
        this.newGame(data.sync.game, this.turns)
      }

      peer.send({gotSync: { sequence: turnIncoming.sequence }})
    } else if (data.askSync) {
      this.sync(false, peer)
    } else if (data.gotSync) {
      console.debug("Peer got sync for sequence " + data.gotSync.sequence)
    } else if (data.peerUpdate) {
      for (const peerPlayer of data.peerUpdate.peerPlayers) {
        const peerPlayerId = peerPlayer.id
        const player = this.game.players.find((p) => p.id == peerPlayer.player)
        assert(player)
        
        if (peerPlayerId == this.connections.registrantId()) {
          this.viewerSet(player)
        } else {
          this.connections.peerById(peerPlayerId)?.playerChange(player)
        }
      }
      this.onPeerChanged(this.connections.peersGet())
    } else if (data.move) {
      const turn = this.turns.find(t => t.sequence == data.move.turnSequence)
      if (turn) {
        this.notifierSlot.move(deserializeMove(data.move), false)
      } else {
        console.error("Move ignored, sequence not found in turn history", data.move, this.turns)
        peer.send({askSync: true})
      }
    } else if (data.deny) {
      errorHandler("Connection denied: " + data.deny.message)
    } else {
      console.error("Unknown message", data)
    }
  }

  private onPlayfieldInconsistent(peer: PeerPlayer, errors: string[]) {
    const registrantId = this.connections.registrantId()
    assert(registrantId)
    if (peer.id < registrantId) {
      console.debug("Inconsistent playfield with authoritive id, syncing", errors)
      this.sync(false, peer)
    } else {
      peer.send({askSync: true})
      console.debug("Inconsistent playfield with non-authoritive id, surrendering", errors)
    }
  }
  
  onPeerConnect(metadata: any, peer: PeerPlayer): void {
    if (metadata == 'yom') {
      // tbd: check playfield sequence # and sync if necessary?
      const [playerForPeer, _] = this.playerGetForPeer(peer)
      assert(playerForPeer)
      peer.playerChange(playerForPeer)
      this.onPeerReconnect(peer)
    }
  }

  private onPeerReconnect(peer: PeerPlayer) {
    this.sync(true,peer)
    this.connections.broadcast({
      chern: {
        connecting: peer.id,
        peers: Array.from(this.connections.peersGet().values()).
          map(p => p.serialize()).
          concat({id: this.connections.registrantId(), player: this.viewer.id}),
        maxPlayers: this.maxPlayers
      }
    })
  }
  
  playerGetForPeer(peer: PeerPlayer): [Player|undefined, string] {
    // If the incoming peer already has a player assigned to them, then use that.
    // Otherwise find the first free one, or use the spectator as a last resort.
    if (peer.playerGet() == this.game.spectator()) {
      for (const player of this.game.players.slice(0, this.maxPlayers)) {
        const peerForPlayer = this.connections.peerByPlayer(player)
        if (this.viewer != player && (!peerForPlayer || peerForPlayer.is(peer)))
          return [player, ""]
      }

      return [this.game.spectator(), ""]
    } else {
      return [peer.playerGet(), ""]
    }
  }
  
  serialize() {
    return {
      game: this.game.id,
      viewer: this.viewer.id,
      turn: this.turnCurrent.serialize(),
      maxPlayers: this.maxPlayers
    }
  }

  restore(serialized: any) {
    this.maxPlayers = serialized.maxPlayers
    this.newGame(serialized.game, [Turn.fromSerialized(serialized.turn)], serialized.viewer)
    this.sync(true)
  }

  dealInteractive() {
    const gen = this.game.deal(this.maxPlayers, this.playfield)
    const step = () => {
      const it = gen.next()
      if (!it.done) {
        this.notifierSlot.move(it.value)
        window.setTimeout(step, 250)
      }
    }
    window.setTimeout(step, 250)
    return false
  }

  maxPlayersSet(max: number) {
    if (max != this.maxPlayers) {
      this.maxPlayers = max
      this.uiCreate()
    }
  }
  
  maxPlayersGet() { return this.maxPlayers }
}

let appGlobal: App

function makeUiGinRummy(playfield: Playfield, app: App) {
  const root = app.rootGet()
  const viewer = app.viewerGet()
  const player = viewer.idCnts[0] ? viewer : app.gameGet().players[0]!
  assertf(() => player)
  const opponent: Player = app.gameGet().players.find(p => p.idCnts[0] && p != player)!
  assertf(() => opponent)
  
  root.add(
    new UIContainerFlex().with(cnt => {
      cnt.add(
        new UISlotSpread(opponent.idCnts[0], app.selection, opponent, viewer, playfield, 0,
                         app.notifierSlot, app.images, app.cardWidthGet(),
                         app.cardHeightGet(), '100%').init()
      )
    })
  )
  
  root.add(
    new UIContainerFlex().with(cnt => {
      
      const uislotWaste = new UISlotSpread('waste', app.selection, null, viewer, playfield, 0, app.notifierSlot,
                                           app.images, app.cardWidthGet(), app.cardHeightGet(),
                                           '100%')
      uislotWaste.init()
      uislotWaste.element.style.flexGrow = "1"
      cnt.add(uislotWaste)
      
      const uislotStock = new UISlotSingle('stock', app.selection, null, viewer, playfield, 0, app.notifierSlot,
                                           app.images, app.cardWidthGet(), app.cardHeightGet(),
                                           'flip', ['Deal', () => app.dealInteractive()])
      uislotStock.init()
      cnt.add(uislotStock)
    })
  )
  
  const uislotBottom = new UISlotSpread(player.idCnts[0], app.selection, player, viewer, playfield,
                                        0, app.notifierSlot, app.images,
                                        app.cardWidthGet(), app.cardHeightGet(),
                                        '100%')
  uislotBottom.init()
  root.add(uislotBottom)
}

function makeUiDummy(playfield: Playfield, app: App) {
  const root = app.rootGet()
  const viewer = app.viewerGet()
  const player = viewer.idCnts[0] ? viewer : app.gameGet().players[0]!
  assertf(() => player)
  const opponent: Player = app.gameGet().players.find(p => p.idCnts[0] && p != player)!
  assertf(() => opponent)
  
  root.add(
    new UIContainerFlex().with(cnt => {
      cnt.add(
        new UISlotSpread(opponent.idCnts[0], app.selection, opponent, viewer, playfield, 0,
                         app.notifierSlot, app.images, app.cardWidthGet(),
                         app.cardHeightGet(), '100%').init()
      )
    })
  )

  root.add(
    new UIContainerFlex().with(cnt => {
      cnt.add(
        new UIContainerSlotsMulti(opponent.idCnts[0]+'-meld', app.selection, null, viewer, playfield,
                                  app.notifierSlot, app.images,
                                  app.cardWidthGet(), app.cardHeightGet(), '', 'turn').init()
      )
    })
  )
  
  root.add(
    new UIContainerFlex().with(cnt => {
      cnt.add(
        new UISlotSpread('waste', app.selection, null, viewer, playfield, 0, app.notifierSlot,
                         app.images, app.cardWidthGet(), app.cardHeightGet(),
                         '100%', undefined, undefined, 'flip', 'all-proceeding').init()
      )
    })
  )
  
  root.add(
    new UIContainerFlex().with(cnt => {
      cnt.add(
        new UIContainerSlotsMulti(player.idCnts[0]+'-meld', app.selection, null, viewer, playfield,
                                  app.notifierSlot, app.images,
                                  app.cardWidthGet(), app.cardHeightGet(), '', 'turn').init()
      )
    })
  )
  
  root.add(
    new UIContainerFlex().with(cnt => {
      cnt.add(
        new UISlotSpread(player.idCnts[0], app.selection, player, viewer, playfield, 0,
                         app.notifierSlot, app.images, app.cardWidthGet(),
                         app.cardHeightGet(), '100%').init()
      )
    })
  )

  root.add(
    new UIContainerFlex().with(cnt => {
      cnt.add(
        new UISlotSingle('stock', app.selection, null, viewer, playfield, 0, app.notifierSlot,
                         app.images, app.cardWidthGet(), app.cardHeightGet(),
                         'flip', ['Deal', () => app.dealInteractive()]).init()
      )
    })
  )
}

function makeUiPlayerChips(app: App, owner: Player, viewer: Player, playfield: Playfield) {
  return new UIContainerFlex('row', false, 'container-tight').with(cnt => {
    for (let idx=0; idx < 4; ++idx) {
      cnt.add(
        new UISlotChip(owner.idCnts[1], app.selection, owner, viewer, playfield, app.notifierSlot, idx,
                       app.cardWidthGet()).init()
      )
    }
  })
}

function makeUiPlayerCards(app: App, cntId: string, owner: Player, viewer: Player, playfield: Playfield, idSlot=0,
                           classes: string[]=[]) {
  
  return new UISlotSpread(cntId, app.selection, owner, viewer, playfield, idSlot,
                          app.notifierSlot, app.images, app.cardWidthGet(),
                          app.cardHeightGet(), '100%', ['slot', 'slot-overlap'].concat(classes)).init()
}

function makeUiPoker(playfield: Playfield, app: App) {
  const root = app.rootGet()
  const viewer = app.viewerGet()
  const player = viewer.idCnts[0] ? viewer : app.gameGet().playersActive()[0]
  assert(player)
  
  const opponents = app.gameGet().playersActive().filter(p => p != player).slice(0, app.maxPlayersGet()-1)

  for (const opponent of opponents) {
    root.add(
      new UIContainerFlex('aware').with(cnt => {
        cnt.add(makeUiPlayerChips(app, opponent, viewer, playfield))
      })
    )
  }
  
  for (const opponent of opponents) {
    root.add(
      new UIContainerFlex('aware').with(cnt => {
        cnt.add(makeUiPlayerCards(app, opponent.idCnts[0], opponent, viewer, playfield))
      })
    )
  }
  
  root.add(
    new UIContainerDiv().with(cnt => {

      cnt.add(
        new UIContainerFlex().with(cnt => {
          let uislotWaste = new UISlotSpread('waste', app.selection, null, viewer, playfield, 0,
                                             app.notifierSlot, app.images, app.cardWidthGet(),
                                             app.cardHeightGet(), '100%', ['slot', 'slot-overlap', 'narrow'])
          uislotWaste.init()
          uislotWaste.element.style.flexGrow = "1"
          cnt.add(uislotWaste)
          
          uislotWaste = new UISlotSpread('community', app.selection, null, viewer, playfield, 0,
                                         app.notifierSlot, app.images, app.cardWidthGet(),
                                         app.cardHeightGet(), '100%', ['slot', 'slot-overlap', 'aware'])
          uislotWaste.init()
          uislotWaste.element.style.flexGrow = "1"
          cnt.add(uislotWaste)
        
          const uislotStock = new UISlotSingle('stock', app.selection, null, viewer, playfield, 0, app.notifierSlot,
                                               app.images, app.cardWidthGet(), app.cardHeightGet())
          uislotStock.init()
          cnt.add(uislotStock)
        })
      )
    })
  )

  root.add(
    new UIContainerFlex('aware-reverse').with(cnt => {
      cnt.add(makeUiPlayerCards(app, player.idCnts[0], player, viewer, playfield))
      cnt.add(
        new UIContainerFlex('row', false, 'container-tight').with(cnt => {
          for (let i=0; i<4; ++i)
            cnt.add(
              new UISlotChip('ante', app.selection, null, viewer, playfield, app.notifierSlot, i,
                             app.cardWidthGet()).init()
            )
        })
      )
      cnt.add(makeUiPlayerChips(app, player, viewer, playfield))
    })
  )
}

function makeUiPokerChinese(playfield: Playfield, app: App) {
  const root = app.rootGet()
  const viewer = app.viewerGet()
  const player = viewer.idCnts[0] ? viewer : app.gameGet().players[0]
  assert(player)
  const opponents = app.gameGet().playersActive().filter(p => p != player).slice(0, app.maxPlayersGet()-1)

  root.add(
    new UISlotSingle('stock', app.selection, null, viewer, playfield, 0, app.notifierSlot,
                     app.images, app.cardWidthGet(), app.cardHeightGet(),
                           'flip', ['Deal', () => app.dealInteractive()]).init()
  )
  
  for (const opponent of opponents) {
    root.add(
      new UIContainerFlex('aware').with(cnt => {
        cnt.add(makeUiPlayerChips(app, opponent, viewer, playfield))
        cnt.add(makeUiPlayerCards(app, opponent.idCnts[0], opponent, viewer, playfield))
      })
    )
  }

  for (const opponent of opponents) {
    root.add(
      new UIContainerFlex().with(cnt => {
        for (let i=0; i<3; ++i)
          cnt.add(makeUiPlayerCards(app, opponent.idCnts[0] + "-show", opponent, viewer, playfield, i,
                                    ['aware', 'card5']))
      })
    )
  }
  
  root.add(
    new UIContainerFlex().with(cnt => {
      for (let i=0; i<3; ++i)
        cnt.add(makeUiPlayerCards(app, player.idCnts[0] + "-show", player, viewer, playfield, i, ['aware', 'card5']))
    })
  )
  
  root.add(
    new UIContainerFlex('aware').with(cnt => {
      cnt.add(makeUiPlayerCards(app, player.idCnts[0], player, viewer, playfield))
    })
  )
  
  root.add(
    new UIContainerFlex('aware').with(cnt => {
      cnt.add(
        new UIContainerFlex('row',false,'container-tight').with(cnt => {
          for (let i=0; i<4; ++i)
            cnt.add(
              new UISlotChip('ante', app.selection, null, viewer, playfield, app.notifierSlot, i,
                             app.cardWidthGet()).init()
            )
        })
      )
      cnt.add(makeUiPlayerChips(app, player, viewer, playfield))
    })
  )
}

function makeUiHearts(playfield: Playfield, app: App) {
  const root = app.rootGet()
  const viewer = app.viewerGet()
  const player = viewer.idCnts[0] ? viewer : app.gameGet().players[0]!
  assertf(() => player)
  const players = app.gameGet().playersActive()
  
  root.add(
    new UISlotSingle('stock', app.selection, null, viewer, playfield, 0, app.notifierSlot,
                     app.images, app.cardWidthGet(), app.cardHeightGet(),
                     'flip', ['Deal', () => app.dealInteractive()]).init()
  )

  function slotTrickPlayer(player: Player, cnt: UIContainer, slotClass: string) {
    cnt.add(
      new UISlotSpread(player.idCnts[1], app.selection, null, viewer, playfield, 0,
                       app.notifierSlot, app.images, app.cardWidthGet(),
                       app.cardHeightGet(), '100%', ['slot', slotClass]).init()
    )
  }
  
  function slotOpponent(opponent: Player, cnt: UIContainer, slotClass: string) {
    cnt.add(
      new UISlotSpread(opponent.idCnts[0], app.selection, opponent, viewer, playfield, 0,
                       app.notifierSlot, app.images, app.cardWidthGet(),
                       app.cardHeightGet(), '100%', ['slot', slotClass]).init()
    )
    slotTrickPlayer(opponent, cnt, slotClass)
  }

  if (false/*players.length <= 4*/) {
    const opponents = app.gameGet().playersActive().filter(p => p != player).slice(0, 3)
    
    root.add(
      new UIContainerFlex('row', false, 'container-flex-centered').with(cnt => {
        for (const opponent of opponents) {
          cnt.add(
            new UIContainerFlex('column').with(cnt => {
              slotOpponent(opponent, cnt, 'slot-overlap-vert')
            })
          )
        }
        
      })
    )

    root.add(
      new UIContainerFlex('row', false, 'container-flex-centered').with(cnt => {
        cnt.add(
          new UISlotSpread('trick', app.selection, null, viewer, playfield, 0,
                           app.notifierSlot, app.images, app.cardWidthGet(),
                           app.cardHeightGet(), '100%').init()
        )
      })
    )
    
    root.add(
      new UISlotSpread(player.idCnts[0], app.selection, player, viewer, playfield, 0,
                       app.notifierSlot, app.images, app.cardWidthGet(),
                       app.cardHeightGet(), '100%').init()
    )
    slotTrickPlayer(player, root, 'slot-overlap')
  } else {
    for (const p of players) {
      if (p == player) {
        root.add(
          new UIContainerDiv().with(cnt => {
            cnt.element.style.padding = '7px 5px 7px 5px'
            
            cnt.add(
              new UIContainerFlex('row', false, 'container-flex-centered').with(cnt => {
                cnt.add(
                  new UISlotSpread('trick', app.selection, null, viewer, playfield, 0,
                                   app.notifierSlot, app.images, app.cardWidthGet(),
                                   app.cardHeightGet(), '50%', undefined, undefined, undefined,
                                   'all-on-space').init()
                )
              })
            )

            cnt.add(
              new UISlotSpread(player.idCnts[0], app.selection, p, viewer, playfield, 0,
                               app.notifierSlot, app.images, app.cardWidthGet(),
                               app.cardHeightGet(), '100%').init()
            )
            slotTrickPlayer(p, cnt, 'slot-overlap')
          })
        )
      } else {
        slotOpponent(p, root, 'slot-overlap')
      }
    }
  }
}

function run(urlCards: string, urlCardBack: string) {
  const elPeerJsHost = dom.demandById("peerjs-host", HTMLInputElement)
  const elMaxPlayers = dom.demandById("max-players", HTMLInputElement)
  const tblPlayers = dom.demandById("players", HTMLTableElement)

  function tblPlayersUpdate(peers: PeerPlayer[]) {
    tblPlayers.innerHTML = ''
    for (const peer of peers) {
      const row = tblPlayers.insertRow()
      row.insertCell().innerText = peer.id.slice(7)
      row.insertCell().innerText = peer.playerGet().id
      row.insertCell().innerText = peer.status()
    }
  }
  
  const app = new App(
    [
      new GameGinRummy(makeUiGinRummy),
      new GameDummy(makeUiDummy),
      new GameHearts(makeUiHearts),
      new GamePoker(makeUiPoker),
      new GamePokerChinese(makeUiPokerChinese),
    ],
    new NotifierSlot(),
    new UISlotRoot(),
    new Images(urlCards, urlCardBack),
    (game: Game) => {
      elMaxPlayers.max = game.playersActive().length.toString()
    },
    (maxPlayers: number) => {
      elMaxPlayers.value = maxPlayers.toString()
    },
    tblPlayersUpdate
  )

  app.init()
  
  appGlobal = app;
  
  (window as any).mpcardAppGlobal = app

  dom.demandById("error").addEventListener(
    "click",
    () => dom.demandById("error").style.display = 'none'
  )

  app.connections.events.addEventListener("peerupdate", (e: EventPeerUpdate) => tblPlayersUpdate(e.peers))

  dom.demandById("id-get").addEventListener("click", () => {
    const id = (dom.demandById("peerjs-id", HTMLInputElement)).value.toLowerCase()
    if (!id) {
      throw new Error("Id not given")
    }
    
    app.connections.register("mpcard-" + id,
                             app.onPeerConnect.bind(app),
                             app.onReceiveData.bind(app),
                             app.gameGet().spectator(),
                             app.viewerGet.bind(app),
                             app.maxPlayersGet.bind(app))
  })
  dom.demandById("connect").addEventListener("click", () => {
    const id = dom.demandById("peerjs-target", HTMLInputElement).value.toLowerCase()
    app.connections.connectYom("mpcard-" + id, app.gameGet().spectator())
  })
  dom.demandById("sync").addEventListener("click", () => app.sync(true))
  dom.demandById("player-next").addEventListener("click", () => {
    const playersAvailable = app.gameGet().players.slice(0, app.maxPlayersGet()).concat([app.gameGet().spectator()])
    const startIdx = playersAvailable.indexOf(app.viewerGet())
    assert(startIdx != -1)
    for (let i = startIdx+1; i < startIdx+playersAvailable.length; ++i) {
      const player = playersAvailable[i % playersAvailable.length]
      assert(player)
      if (player == app.gameGet().spectator() || !app.connections.peerByPlayer(player)) {
        app.viewerSet(player)
        app.connections.onPeerUpdate(player)
        return
      }
    }
  })
/*  demandElementById("connect-status").addEventListener(
    "pingback",
    function (e: EventPingBack) { this.innerHTML = `Connected for ${e.secs}s` }
  )*/
  
  dom.demandById("game-new").addEventListener(
    "click",
    () => {
      app.newGame(dom.demandById("game-type", HTMLSelectElement).value)
      app.sync(true)
    }
  )

  dom.demandById("hand-new").addEventListener(
    "click",
    () => {
      app.newHand()
      app.sync(true)
    }
  )
  
  elMaxPlayers.addEventListener(
    "change",
    () => { app.maxPlayersSet(Number(elMaxPlayers.value)); app.sync(true) }
  )
  
  dom.withElement("game-type", HTMLSelectElement, (elGames) => {
    for (const game of app.games) {
      const opt = document.createElement("option")
      opt.text = game.description
      opt.value = game.id
      elGames.add(opt)
    }
    elGames.addEventListener(
      "change",
      () => {
        app.newGame(elGames.value)
        app.sync(true)
      }
    )
  })
  
  dom.demandById("reveal-all").addEventListener("click", () => app.revealAll())

  function cardSizeSet() {
    const [width, height] = JSON.parse(dom.demandById("card-size", HTMLSelectElement).value)
    app.cardSizeSet(width, height)
  }
  dom.demandById("card-size").addEventListener("change", (e) => {
    cardSizeSet()
    app.viewerSet(app.viewerGet())
  })
  cardSizeSet()

  dom.demandById("save").addEventListener(
    "click",
    () => {
      const state = {
        id: dom.demandById("peerjs-id", HTMLInputElement).value,
        target: dom.demandById("peerjs-target", HTMLInputElement).value,
        host: elPeerJsHost.value,
        app: app.serialize()
      }
      
      window.localStorage.setItem("state", JSON.stringify(state))
    }
  )

  function restore() {
    const state = window.localStorage.getItem("state")
    if (state) {
      const serialized = JSON.parse(state)
      dom.demandById("peerjs-id", HTMLInputElement).value = serialized.id ?? ''
      dom.demandById("peerjs-target", HTMLInputElement).value = serialized.target ?? ''
      dom.demandById("peerjs-host", HTMLInputElement).value = serialized.host ?? ''
      app.restore(serialized.app)
      dom.demandById("game-type", HTMLSelectElement).value = app.gameGet().id
    }

    return state != undefined
  }
  
  dom.demandById("load").addEventListener("click", restore)

  try {
    restore() || app.newGame(app.gameGet().id)
  } catch(e) {
    errorHandler("Problem restoring game state: " + e)
    app.newGame(app.gameGet().id)
  }

  if (!elPeerJsHost.value)
    getDefaultPeerJsHost().then(url => { if (url) elPeerJsHost.value = url })
}

async function getDefaultPeerJsHost() {
  const url = "http://"+window.location.hostname+": 9000"
  try {
    const response = await window.fetch(url)
    const json = await response.json()
    if (json?.name == 'PeerJS Server')
      return window.location.hostname
  } catch (e) {
    console.debug("Default PeerJS host test", e)
    return undefined
  }
}
  
(window as any).mptest = () => {
  function moveStock() {
    const app = appGlobal as any
    const playfield = app.playfield
    const cntStock = playfield.container("stock")
    const stock = playfield.container("stock").first()
    const cntOthers = playfield.containers.filter((c: ContainerSlotCard) => c != cntStock)
    const waste = cntOthers[Math.floor(Math.random() * cntOthers.length)].first()
    const move = new MoveCards(app.turnCurrent.sequence, [stock.top().withFaceUp(true)], stock, waste)
    
    app.notifierSlot.move(move)

    if (app.playfield.container("stock").isEmpty()) {
      appGlobal.newGame(appGlobal.gameGet().id)
      appGlobal.sync(true)
    }
    
    window.setTimeout(
      moveStock,
      100
    )
  }

  moveStock()
}

(window as any).mptest_sync = () => {
  const app = appGlobal as any
  const playfield = app.playfield
  const cntStock = playfield.container("stock")
  const stock = playfield.container("stock").first()
  const cntOthers = playfield.containers.filter((c: ContainerSlotCard) => c != cntStock)
  const cntOther = cntOthers[Math.floor(Math.random() * cntOthers.length)]
  const other = cntOther.first()
  const otherAlt = cntOthers[(cntOthers.indexOf(cntOther)+1) % cntOthers.length].first()
  const move = new MoveCards(app.turnCurrent.sequence, [stock.top().withFaceUp(true)], stock, other)
  
  const moveAlt = new MoveCards(app.turnCurrent.sequence, [stock.top().withFaceUp(true)], stock, otherAlt)

  app.notifierSlot.move(move)

  const peer = {
    id: 'test',
    send: (data: any) => (app as any).onReceiveData(data, peer),
    consistent: true
  } as PeerPlayer
  
  window.setTimeout(() =>
    app.onReceiveData({ move: moveAlt.serialize() }, peer),
    1000
  )
}

(window as any).mptest_rnd = () => {
  (window as any).mptest_latency = true
  
  function work() {
    const app = appGlobal
    const playfield = (app as any).playfield as Playfield
    const cnts = playfield.containers.filter((c: ContainerSlotCard) => !c.isEmpty() && !c.first().isEmpty())
    const cnt = cnts[Math.floor(Math.random() * cnts.length)]
    const cntOthers = playfield.containers.filter((c: ContainerSlotCard) => c != cnt)
    const other = cntOthers[Math.floor(Math.random() * cntOthers.length)]
    const move = new MoveCards((app as any).turnCurrent.sequence, [cnt.first().top().withFaceUp(true)],
                               cnt.first().id, other.first().id)
  
    const playfield_ = playfield.withMoveCards(move)
    assert(playfield.containers.reduce((agg, i) => agg + i.allItems().length, 0) == 52)
    assert(playfield_.containers.reduce((agg, i) => agg + i.allItems().length, 0) == 52)
    app.notifierSlot.move(move)
    window.setTimeout(work, Math.floor(Math.random() * 2000))
  }

  work()
}

(window as any).mptest_latency = false
