import { assert, assertf } from './assert.js'
import * as dom from "./dom.js"
import {
  Connections, EventContainerChange, EventPeerUpdate, EventPlayfieldChange, EventSlotChange, Game, GameGinRummy, GameDummy, GameHearts, GamePoker, GamePokerChinese, NotifierSlot, PeerPlayer, Player, Playfield, Slot, SlotCard, SlotChip, UpdateSlot
} from "./game.js"
import errorHandler from "./error_handler.js"
import { Vector } from "./math.js"
import { Selection, UICard, UIContainer, UIContainerDiv, UIContainerFlex, UIContainerSlotsMulti, UIMovable, UISlotChip, UISlotSingle, UISlotRoot, UISlotSpread } from "./ui.js"

window.onerror = errorHandler

document.addEventListener("deviceready", () => {
  run("img/cards.svg", "img/back.svg")

  const config:RTCConfiguration = {
    iceServers: [],
    iceTransportPolicy: "all",
    iceCandidatePoolSize: 0
  };

  const offerOptions = {offerToReceiveAudio: false}
  // Whether we gather IPv6 candidates.
  // Whether we only gather a single set of candidates for RTP and RTCP.

  console.log(`Creating new PeerConnection with config=${JSON.stringify(config)}`);
  const pc = new RTCPeerConnection(config)
  const dc = pc.createDataChannel("data")
  pc.onicecandidate = (c) => console.debug(c)
//  pc.onicegatheringstatechange = gatheringStateChange;
  pc.onicecandidateerror = (c) => console.debug(c);
  pc.createOffer(
      offerOptions
  ).then((offer) => { console.debug(offer.sdp); pc.setLocalDescription(offer) });
})

class App {
  readonly selection:Selection = new Selection()
  readonly notifierSlot:NotifierSlot
  readonly urlCards:string
  readonly urlCardBack:string
  readonly connections:Connections = new Connections(this.onPeerReconnect.bind(this))
  readonly games:Game[]
  private maxPlayers:number = 2
  private root:UISlotRoot
  private cardWidth = 74
  private cardHeight = 112
  private viewer:Player
  private game:Game
  private audioCtx?:AudioContext
  private playfield = new Playfield([], [])
  
  constructor(games:Game[],
              notifierSlot:NotifierSlot,
              urlCards:string,
              urlCardBack:string,
              root:UISlotRoot,
              readonly onNewGame:(game:Game) => void = () => {},
              readonly onMaxPlayers:(maxPlayers:number) => void = () => {},
              readonly onPeerChanged:(peers:PeerPlayer[]) => void = () => {}
             ) {
    
    assertf(() => games)
    this.games = games
    this.game = games[0]
    this.notifierSlot = notifierSlot
    this.urlCards = urlCards
    this.urlCardBack = urlCardBack
    this.viewer = this.game.players[0]
    this.root = root
  }

  audioCtxGet():AudioContext|undefined {
    const ctx = (<any>window).AudioContext || (<any>window).webkitAudioContext
    if (ctx)
      this.audioCtx = this.audioCtx || new ctx()
    return this.audioCtx
  }

  init() {
    this.notifierSlot.registerSlotUpdate(this.preSlotUpdateCard.bind(this))
    this.notifierSlot.registerSlotUpdateChip(this.preSlotUpdateChip.bind(this))
    this.notifierSlot.registerPostSlotUpdate(this.postSlotUpdate.bind(this))
    this.notifierSlot.playfield.addEventListener("playfieldchange",
                                                 (e:EventPlayfieldChange) => this.playfield = e.playfield_)
  }
                                         
  rootGet():UISlotRoot {
    return this.root
  }
  
  newGame(idGame:string, playfield?:Playfield, viewerId?:string) {
    const game = this.games.find(g => g.idGet() == idGame)
    if (!game) {
      throw new Error("No such game " + idGame)
    }

    this.game = game
    this.maxPlayers = Math.min(this.maxPlayers, this.game.playersActive().length)
    this.playfield = playfield ?? this.game.playfield(this.maxPlayers)
    this.viewerSet(
      this.game.players.find(p => p.idGet() == viewerId) ??
        this.game.players.find(p => p.idGet() == this.viewer?.idGet()) ??
        this.game.players[0]
    ) || this.uiCreate()

    this.onNewGame(this.game)
  }

  newHand() {
    this.playfield = this.game.playfieldNewHand(this.maxPlayers, this.playfield)
    this.uiCreate()
  }
  
  cardSizeSet(width:number, height:number) {
    this.cardWidth = width
    this.cardHeight = height
    this.uiCreate()
  }

  cardWidthGet() { return this.cardWidth }
  cardHeightGet() { return this.cardHeight }
  
  viewerSet(viewer:Player):boolean {
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
    dom.demandById("player").innerText = this.viewer.idGet()

    for (const cnt of this.playfield.containers) {
      for (const slot of cnt) {
        this.notifierSlot.slot(cnt.idGet(), slot.id).dispatchEvent(
          new EventSlotChange(this.playfield, this.playfield, cnt.idGet(), slot.id)
        )
      }
      this.notifierSlot.container(cnt.idGet()).dispatchEvent(
        new EventContainerChange(this.playfield, this.playfield, cnt.idGet(), Array.from(cnt).map(s => [s,s]))
      )
    }

    for (const cnt of this.playfield.containersChip) {
      for (const slot of cnt) {
        this.notifierSlot.slot(cnt.idGet(), slot.id).dispatchEvent(
          new EventSlotChange(this.playfield, this.playfield, cnt.idGet(), slot.id)
        )
      }
      this.notifierSlot.container(cnt.idGet()).dispatchEvent(
        new EventContainerChange(this.playfield, this.playfield, cnt.idGet(), Array.from(cnt).map(s => [s,s]))
      )
    }
  }

  viewerGet() {
    return this.viewer
  }

  gameGet() {
    return this.game
  }

  preSlotUpdateCard(updates:UpdateSlot<SlotCard>[], localAction:boolean):[UIMovable, Vector][] {
    if (localAction) {
      this.connections.broadcast({slotUpdates: updates.map(([s, s_]) => [s?.serialize(), s_.serialize()])})
    }

    return this.preSlotUpdate(updates, localAction)
  }

  preSlotUpdateChip(updates:UpdateSlot<SlotChip>[], localAction:boolean):[UIMovable, Vector][] {
    if (localAction) {
      this.connections.broadcast({slotUpdatesChip: updates.map(([s, s_]) => [s?.serialize(), s_.serialize()])})
    }

    return this.preSlotUpdate(updates, localAction)
  }
  
  private preSlotUpdate(updates:UpdateSlot<Slot>[], localAction:boolean):[UIMovable, Vector][] {
    const slotsOld = updates.map(u => u[0]!).filter(u => u)
    return this.root.uiMovablesForSlots(slotsOld).map(uim => [uim, uim.coordsAbsolute()])
  }

  postSlotUpdate(updates:UpdateSlot<Slot>[], uicards:[UIMovable, Vector][], localAction:boolean) {
    const msDuration = localAction ? 250 : 1000
    
    const uicards_ = this.root.uiMovablesForSlots(updates.map(u => u[1]))
    for (const [uicard, start] of uicards) {
      const uicard_ = uicards_.find(u_ => u_.is(uicard))
      if (uicard_) {
        if (uicard_ != uicard) {
          const end = uicard_.coordsAbsolute()
          const [fade0,fade1] = ['100%', '100%']
          if (end[0] == start[0] && end[1] == start[1]) {
            uicard_.fadeTo('0%', '100%', 250)
            uicard.fadeTo('100%', '0%', 250, uicard.destroy.bind(uicard))
          } else {
            uicard.animateTo(start, end, Number(uicard_.element.style.zIndex), msDuration,
                             () => {
                               uicard_.element.style.visibility = 'visible'
                               if (uicard.equalsVisually(uicard_)) {
                                 uicard.destroy()
                               } else {
                                 uicard_.fadeTo('0%', '100%', 250)
                                 uicard.fadeTo('100%', '0%', 250, uicard.destroy.bind(uicard))
                               }
                             })
            uicard_.element.style.visibility = 'hidden'
          }
        }
      } else {
        uicard.animateTo(start, [start[0], start[1]], Number(uicard.element.style.zIndex), 0)
        uicard.fadeTo('100%', '0%', 250, uicard.destroy.bind(uicard))
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

  sync(idPeer='') {
    const data = {
      sync: {
        game: this.game.idGet(),
        playfield: this.playfield.serialize(),
        maxPlayers: this.maxPlayers
      }
    }
    if (idPeer)
      this.connections.peerById(idPeer)?.send(data)
    else
      this.connections.broadcast(data)
  }

  revealAll() {
    const updates:UpdateSlot<SlotCard>[] = this.playfield.containers.flatMap(
      cnt => cnt.map(wc => wc.withFaceStateConscious(true, true))
    )
    
    this.notifierSlot.slotsUpdateCard(this.playfield, this.playfield.withUpdateCard(updates), updates)
  }

  onReceiveData(data:any, peer:PeerPlayer) {
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
      this.newGame(data.sync.game, Playfield.fromSerialized(data.sync.playfield))
      this.onMaxPlayers(this.maxPlayers)
    } else if (data.askSync) {
      this.sync(peer.idGet())
    } else if (data.peerUpdate) {
      for (const peerPlayer of data.peerUpdate.peerPlayers) {
        const peerPlayerId = peerPlayer.id
        const player = this.game.players.find((p) => p.idGet() == peerPlayer.player)
        assert(player)
        
        if (peerPlayerId == this.connections.registrantId()) {
          this.viewerSet(player)
        } else {
          this.connections.peerById(peerPlayerId)?.playerChange(player)
        }
      }
      this.onPeerChanged(this.connections.peersGet())
    } else if (data.slotUpdates) {
      let updates:UpdateSlot<SlotCard>[]
      let slots:SlotCard[]
      
      updates = (data.slotUpdates as UpdateSlot<SlotCard>[]).map(
        ([s,s_]) => [s ? SlotCard.fromSerialized(s) : undefined, SlotCard.fromSerialized(s_)]
      )

      this.notifierSlot.slotsUpdateCard(this.playfield, this.playfield.withUpdateCard(updates), updates, false)
    } else if (data.slotUpdatesChip) {
      let updates:UpdateSlot<SlotChip>[]
      let slots:SlotChip[]
      
      updates = (data.slotUpdatesChip as UpdateSlot<SlotChip>[]).map(
        ([s,s_]) => [s ? SlotChip.fromSerialized(s) : undefined, SlotChip.fromSerialized(s_)]
      )
      
      this.notifierSlot.slotsUpdateChip(this.playfield, this.playfield.withUpdateChip(updates), updates, false)
    } else if (data.deny) {
      errorHandler("Connection denied: " + data.deny.message)
    } else {
      console.debug("Unknown message", data)
    }
  }

  onPeerConnect(metadata:any, peer:PeerPlayer):void {
    if (metadata == 'yom') {
      // tbd: check playfield sequence # and sync if necessary?
      const [playerForPeer, _] = this.playerGetForPeer(peer)
      assert(playerForPeer)
      peer.playerChange(playerForPeer)
      this.onPeerReconnect(peer)
    }
  }

  private onPeerReconnect(peer:PeerPlayer) {
    this.sync(peer.idGet())
    this.connections.broadcast({
      chern: {
        connecting: peer.idGet(),
        peers: Array.from(this.connections.peersGet().values()).
          map(p => p.serialize()).
          concat({id: this.connections.registrantId(), player: this.viewer.idGet()}),
        maxPlayers: this.maxPlayers
      }
    })
  }
  
  playerGetForPeer(peer:PeerPlayer):[Player|undefined, string] {
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
      game: this.game.idGet(),
      viewer: this.viewer.idGet(),
      playfield: this.playfield.serialize(),
      maxPlayers: this.maxPlayers
    }
  }

  restore(serialized:any) {
    this.maxPlayers = serialized.maxPlayers
    this.newGame(serialized.game, Playfield.fromSerialized(serialized.playfield), serialized.viewer)
    this.sync()
  }

  dealInteractive() {
    const gen = this.game.deal(this.maxPlayers, this.playfield)
    const step = (playfield:Playfield) => {
      const it = gen.next()
      if (!it.done) {
        const [playfield_, updates] = it.value
        this.notifierSlot.slotsUpdateCard(playfield, playfield_, updates)
        window.setTimeout(step.bind(this, playfield), 250)
      }
    }
    window.setTimeout(step.bind(this, this.playfield), 250)
    return false
  }

  maxPlayersSet(max:number) {
    if (max != this.maxPlayers) {
      this.maxPlayers = max
      this.uiCreate()
    }
  }
  
  maxPlayersGet() { return this.maxPlayers }
}

let appGlobal:App

function makeUiGinRummy(playfield:Playfield, app:App) {
  const root = app.rootGet()
  const viewer = app.viewerGet()
  const player = viewer.idCnts[0] ? viewer : app.gameGet().players[0]!
  assertf(() => player)
  const opponent:Player = app.gameGet().players.find(p => p.idCnts[0] && p != player)!
  assertf(() => opponent)
  
  root.add(
    new UIContainerFlex().with(cnt => {
      cnt.add(
        new UISlotSpread(opponent.idCnts[0], app.selection, opponent, viewer, playfield, 0,
                         app.notifierSlot, app.urlCards, app.urlCardBack, app.cardWidthGet(),
                         app.cardHeightGet(), '100%').init()
      )
    })
  )
  
  root.add(
    new UIContainerFlex().with(cnt => {
      
      const uislotWaste = new UISlotSpread('waste', app.selection, null, viewer, playfield, 0, app.notifierSlot,
                                           app.urlCards, app.urlCardBack, app.cardWidthGet(), app.cardHeightGet(),
                                           '100%')
      uislotWaste.init()
      uislotWaste.element.style.flexGrow = "1"
      cnt.add(uislotWaste)
      
      const uislotStock = new UISlotSingle('stock', app.selection, null, viewer, playfield, 0, app.notifierSlot,
                                           app.urlCards, app.urlCardBack, app.cardWidthGet(), app.cardHeightGet(),
                                           'flip', ['Deal', () => app.dealInteractive()])
      uislotStock.init()
      cnt.add(uislotStock)
    })
  )
  
  const uislotBottom = new UISlotSpread(player.idCnts[0], app.selection, player, viewer, playfield,
                                        0, app.notifierSlot, app.urlCards, app.urlCardBack,
                                        app.cardWidthGet(), app.cardHeightGet(),
                                        '100%')
  uislotBottom.init()
  root.add(uislotBottom)
}

function makeUiDummy(playfield:Playfield, app:App) {
  const root = app.rootGet()
  const viewer = app.viewerGet()
  const player = viewer.idCnts[0] ? viewer : app.gameGet().players[0]!
  assertf(() => player)
  const opponent:Player = app.gameGet().players.find(p => p.idCnts[0] && p != player)!
  assertf(() => opponent)
  
  root.add(
    new UIContainerFlex().with(cnt => {
      cnt.add(
        new UISlotSpread(opponent.idCnts[0], app.selection, opponent, viewer, playfield, 0,
                         app.notifierSlot, app.urlCards, app.urlCardBack, app.cardWidthGet(),
                         app.cardHeightGet(), '100%').init()
      )
    })
  )

  root.add(
    new UIContainerFlex().with(cnt => {
      cnt.add(
        new UIContainerSlotsMulti(opponent.idCnts[0]+'-meld', app.selection, null, viewer, playfield,
                                  app.notifierSlot, app.urlCards, app.urlCardBack,
                                  app.cardWidthGet(), app.cardHeightGet(), 'turn').init()
      )
    })
  )
  
  root.add(
    new UIContainerFlex().with(cnt => {
      cnt.add(
        new UISlotSpread('waste', app.selection, null, viewer, playfield, 0, app.notifierSlot,
                         app.urlCards, app.urlCardBack, app.cardWidthGet(), app.cardHeightGet(),
                         '100%', undefined, undefined, 'flip', 'all-proceeding').init()
      )
    })
  )
  
  root.add(
    new UIContainerFlex().with(cnt => {
      cnt.add(
        new UIContainerSlotsMulti(player.idCnts[0]+'-meld', app.selection, null, viewer, playfield,
                                  app.notifierSlot, app.urlCards, app.urlCardBack,
                                  app.cardWidthGet(), app.cardHeightGet(), 'turn').init()
      )
    })
  )
  
  root.add(
    new UIContainerFlex().with(cnt => {
      cnt.add(
        new UISlotSpread(player.idCnts[0], app.selection, player, viewer, playfield, 0,
                         app.notifierSlot, app.urlCards, app.urlCardBack, app.cardWidthGet(),
                         app.cardHeightGet(), '100%').init()
      )
    })
  )

  root.add(
    new UIContainerFlex().with(cnt => {
      cnt.add(
        new UISlotSingle('stock', app.selection, null, viewer, playfield, 0, app.notifierSlot,
                         app.urlCards, app.urlCardBack, app.cardWidthGet(), app.cardHeightGet(),
                         'flip', ['Deal', () => app.dealInteractive()]).init()
      )
    })
  )
}

function makeUiPlayerChips(app:App, owner:Player, viewer:Player, playfield:Playfield) {
  return new UIContainerFlex('row', false, 'container-tight').with(cnt => {
    for (let idx=0; idx < 4; ++idx) {
      cnt.add(
        new UISlotChip(owner.idCnts[1], app.selection, owner, viewer, playfield, app.notifierSlot, idx,
                       app.cardWidthGet()).init()
      )
    }
  })
}

function makeUiPlayerCards(app:App, cntId:string, owner:Player, viewer:Player, playfield:Playfield, idSlot=0,
                           classes:string[]=[]) {
  
  return new UISlotSpread(cntId, app.selection, owner, viewer, playfield, idSlot,
                          app.notifierSlot, app.urlCards, app.urlCardBack, app.cardWidthGet(),
                          app.cardHeightGet(), '100%', ['slot', 'slot-overlap'].concat(classes)).init()
}

function makeUiPoker(playfield:Playfield, app:App) {
  const root = app.rootGet()
  const viewer = app.viewerGet()
  const player = viewer.idCnts[0] ? viewer : app.gameGet().players[0]
  assert(player)
  
  const opponent = app.gameGet().players.find(p => p.idCnts[0] && p != player)
  assert(opponent)

  root.add(
    new UIContainerFlex('aware').with(cnt => {
      cnt.add(makeUiPlayerChips(app, opponent, viewer, playfield))
      cnt.add(makeUiPlayerCards(app, opponent.idCnts[0], opponent, viewer, playfield))
    })
  )
  
  root.add(
    new UIContainerDiv().with(cnt => {

      cnt.add(
        new UIContainerFlex().with(cnt => {
          let uislotWaste = new UISlotSpread('waste', app.selection, null, viewer, playfield, 0,
                                             app.notifierSlot, app.urlCards, app.urlCardBack, app.cardWidthGet(),
                                             app.cardHeightGet(), '100%', ['slot', 'slot-overlap', 'narrow'])
          uislotWaste.init()
          uislotWaste.element.style.flexGrow = "1"
          cnt.add(uislotWaste)
          
          uislotWaste = new UISlotSpread('community', app.selection, null, viewer, playfield, 0,
                                         app.notifierSlot, app.urlCards, app.urlCardBack, app.cardWidthGet(),
                                         app.cardHeightGet(), '100%', ['slot', 'slot-overlap', 'aware'])
          uislotWaste.init()
          uislotWaste.element.style.flexGrow = "1"
          cnt.add(uislotWaste)
        
          const uislotStock = new UISlotSingle('stock', app.selection, null, viewer, playfield, 0, app.notifierSlot,
                                               app.urlCards, app.urlCardBack, app.cardWidthGet(), app.cardHeightGet())
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

function makeUiPokerChinese(playfield:Playfield, app:App) {
  const root = app.rootGet()
  const viewer = app.viewerGet()
  const player = viewer.idCnts[0] ? viewer : app.gameGet().players[0]
  assert(player)
  const opponents = app.gameGet().playersActive().filter(p => p != player).slice(0, app.maxPlayersGet()-1)

  root.add(
    new UISlotSingle('stock', app.selection, null, viewer, playfield, 0, app.notifierSlot,
                     app.urlCards, app.urlCardBack, app.cardWidthGet(), app.cardHeightGet(),
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
          cnt.add(makeUiPlayerCards(app, opponent.idCnts[0] + "-show", opponent, viewer, playfield, i, ['aware']))
      })
    )
  }
  
  root.add(
    new UIContainerFlex().with(cnt => {
      for (let i=0; i<3; ++i)
        cnt.add(makeUiPlayerCards(app, player.idCnts[0] + "-show", player, viewer, playfield, i, ['aware']))
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

function makeUiHearts(playfield:Playfield, app:App) {
  const root = app.rootGet()
  const viewer = app.viewerGet()
  const player = viewer.idCnts[0] ? viewer : app.gameGet().players[0]!
  assertf(() => player)
  const opponents = app.gameGet().playersActive().filter(p => p != player).slice(0, 3)
  const opponent = opponents[0]
  
  root.add(
    new UISlotSingle('stock', app.selection, null, viewer, playfield, 0, app.notifierSlot,
                     app.urlCards, app.urlCardBack, app.cardWidthGet(), app.cardHeightGet(),
                     'flip', ['Deal', () => app.dealInteractive()]).init()
  )

  function slotTrick(player:Player, cnt:UIContainer, slotClass:string) {
    cnt.add(
      new UISlotSpread(player.idCnts[1], app.selection, null, viewer, playfield, 0,
                       app.notifierSlot, app.urlCards, app.urlCardBack, app.cardWidthGet(),
                       app.cardHeightGet(), '100%', ['slot', slotClass]).init()
    )
  }
  
  function slotOpponent(opponent:Player, cnt:UIContainer, slotClass:string) {
    cnt.add(
      new UISlotSpread(opponent.idCnts[0], app.selection, opponent, viewer, playfield, 0,
                       app.notifierSlot, app.urlCards, app.urlCardBack, app.cardWidthGet(),
                       app.cardHeightGet(), '100%', ['slot', slotClass, 'narrow']).init()
    )
    slotTrick(opponent, cnt, slotClass)
  }
  
  root.add(
    new UIContainerFlex('row', false, 'container-flex-centered').with(cnt => {
      cnt.add(
        new UIContainerFlex('column').with(cnt => {
          slotOpponent(opponents[0], cnt, 'slot-overlap-vert')
        })
      )

      cnt.add(
        new UIContainerFlex('column').with(cnt => {
//          cnt.element.style.minWidth = '70%'
          
          cnt.add(
            new UIContainerFlex().with(cnt => {
              slotOpponent(opponents[1], cnt, 'slot-overlap')
            })
          )
          
          cnt.add(
            new UISlotSpread('trick', app.selection, null, viewer, playfield, 0,
                             app.notifierSlot, app.urlCards, app.urlCardBack, app.cardWidthGet(),
                             app.cardHeightGet(), '100%').init()
          )
          
          cnt.add(
            new UISlotSpread(player.idCnts[0], app.selection, player, viewer, playfield, 0,
                             app.notifierSlot, app.urlCards, app.urlCardBack, app.cardWidthGet(),
                             app.cardHeightGet(), '100%').init()
          )
          slotTrick(player, cnt, 'slot-overlap')
        })
      )
      
      cnt.add(
        new UIContainerFlex('column').with(cnt => {
//          cnt.element.style.minWidth = '15%'
          slotOpponent(opponents[2], cnt, 'slot-overlap-vert')
        })
      )
    })
  )
}

function run(urlCards:string, urlCardBack:string) {
  const elMaxPlayers = dom.demandById("max-players", HTMLInputElement)
  const tblPlayers = dom.demandById("players", HTMLTableElement)

  function tblPlayersUpdate(peers:PeerPlayer[]) {
    tblPlayers.innerHTML = ''
    for (const peer of peers) {
      const row = tblPlayers.insertRow()
      row.insertCell().innerText = peer.idGet().slice(7)
      row.insertCell().innerText = peer.playerGet().idGet()
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
    urlCards,
    urlCardBack,
    new UISlotRoot(),
    (game:Game) => {
      elMaxPlayers.max = game.playersActive().length.toString()
    },
    (maxPlayers:number) => {
      elMaxPlayers.value = maxPlayers.toString()
    },
    tblPlayersUpdate
  )

  app.init()
  
  appGlobal = app

  dom.demandById("error").addEventListener(
    "click",
    () => dom.demandById("error").style.display = 'none'
  )

  app.connections.events.addEventListener("peerupdate", (e:EventPeerUpdate) => tblPlayersUpdate(e.peers))

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
  dom.demandById("sync").addEventListener("click", () => app.sync())
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
    function (e:EventPingBack) { this.innerHTML = `Connected for ${e.secs}s` }
  )*/
  
  dom.demandById("game-new").addEventListener(
    "click",
    () => {
      app.newGame(dom.demandById("game-type", HTMLSelectElement).value)
      app.sync()
    }
  )

  dom.demandById("hand-new").addEventListener(
    "click",
    () => {
      app.newHand()
      app.sync()
    }
  )
  
  elMaxPlayers.addEventListener(
    "change",
    () => { app.maxPlayersSet(Number(elMaxPlayers.value)); app.sync() }
  )
  
  dom.withElement("game-type", HTMLSelectElement, (elGames) => {
    for (const game of app.games) {
      const opt = document.createElement("option")
      opt.text = game.description
      opt.value = game.idGet()
      elGames.add(opt)
    }
    elGames.addEventListener(
      "change",
      () => {
        app.newGame(elGames.value)
        app.sync()
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
        host: dom.demandById("peerjs-host", HTMLInputElement).value,
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
      dom.demandById("game-type", HTMLSelectElement).value = app.gameGet().idGet()
    }

    return state != undefined
  }
  
  dom.demandById("load").addEventListener("click", restore)

  try {
    restore() || app.newGame(app.gameGet().idGet())
  } catch(e) {
    errorHandler("Problem restoring game state: " + e)
    app.newGame(app.gameGet().idGet())
  }
}

function test() {
  function moveStock() {
    const app = appGlobal as any
    const playfield = app.playfield
    const stock = playfield.container("stock").first()
    const waste = playfield.container("waste").first()
    const updates:UpdateSlot<SlotCard>[] = [
      [
        stock,
        stock.remove([stock.top()])
      ],
      [
        waste,
        waste.add([waste.top().withFaceUp(true)])
      ]
    ]
    
    app.playfield = 
      playfield.slotsUpdate(
        playfield.withUpdateCard(updates),
        updates,
        appGlobal.connections,
        appGlobal.notifierSlot
      )

    if (app.playfield.container("stock").isEmpty()) {
      appGlobal.newGame(appGlobal.gameGet().idGet())
    }
    
    window.setTimeout(
      moveStock,
      100
    )
  }

  moveStock()
}
