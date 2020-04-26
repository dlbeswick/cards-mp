import { assert, assertf } from './assert.js'
import * as dom from "./dom.js"
import {
  Connections, EventContainerChange, EventPeerUpdate, EventSlotChange, Game, GameGinRummy, GameDummy, GamePoker,
  NotifierSlot, PeerPlayer, Player, Playfield, Slot, SlotCard, SlotChip, UpdateSlot
} from "./game.js"
import errorHandler from "./error_handler.js"
import { Vector } from "./math.js"
import { Selection, UICard, UIContainerDiv, UIContainerFlex, UIContainerSlotsMulti, UIMovable, UISlotChip, UISlotSingle, UISlotRoot, UISlotSpread } from "./ui.js"

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
  readonly connections:Connections = new Connections()
  readonly games:Game[]
  private root:UISlotRoot
  private cardWidth = 74
  private cardHeight = 112
  private viewer:Player
  private game:Game
  private audioCtx?:AudioContext
  private playfield = new Playfield([], [])
  
  constructor(games:Game[], notifierSlot:NotifierSlot, urlCards:string, urlCardBack:string, root:UISlotRoot) {
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
    this.notifierSlot.registerSlotUpdate(this.preSlotUpdateCard.bind(this), this.postSlotUpdate.bind(this))
    this.notifierSlot.registerSlotUpdateChip(this.preSlotUpdateChip.bind(this), this.postSlotUpdate.bind(this))
  }
                                         
  run(gameId:string) {
    this.newGame(gameId)
  }

  rootGet():UISlotRoot {
    return this.root
  }
  
  newGame(idGame:string, playfield?:Playfield) {
    const game = this.games.find(g => g.id() == idGame)
    if (!game) {
      throw new Error("No such game " + idGame)
    }

    this.game = game
    this.playfield = playfield ?? this.game.playfield()
    this.viewerSet(this.game.players.find(p => p.id == this.viewer?.id) ?? this.game.players[0])
  }

  cardSizeSet(width:number, height:number) {
    this.cardWidth = width
    this.cardHeight = height
  }

  cardWidthGet() { return this.cardWidth }
  cardHeightGet() { return this.cardHeight }
  
  viewerSet(viewer:Player) {
    assertf(() => this.game)
    this.viewer = viewer

    this.root.destroy()
    this.root = new UISlotRoot()
    this.game.makeUi(this.playfield, this)
    dom.demandById("player").innerText = this.viewer.id()

    for (const cnt of this.playfield.containers) {
      for (const slot of cnt) {
        this.notifierSlot.slot(cnt.id(), slot.id).dispatchEvent(
          new EventSlotChange(this.playfield, this.playfield, cnt.id(), slot.id)
        )
      }
      this.notifierSlot.container(cnt.id()).dispatchEvent(
        new EventContainerChange(this.playfield, this.playfield, cnt.id(), Array.from(cnt).map(s => [s,s]))
      )
    }

    for (const cnt of this.playfield.containersChip) {
      for (const slot of cnt) {
        this.notifierSlot.slot(cnt.id(), slot.id).dispatchEvent(
          new EventSlotChange(this.playfield, this.playfield, cnt.id(), slot.id)
        )
      }
      this.notifierSlot.container(cnt.id()).dispatchEvent(
        new EventContainerChange(this.playfield, this.playfield, cnt.id(), Array.from(cnt).map(s => [s,s]))
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
    const data = { sync: { game: this.game.id(), playfield: this.playfield.serialize() } }
    if (idPeer)
      this.connections.peerById(idPeer)?.send(data)
    else
      this.connections.broadcast(data)
  }

  revealAll() {
    const updates:UpdateSlot<SlotCard>[] = this.playfield.containers.flatMap(
      cnt => cnt.map(wc => wc.withFaceStateConscious(true, true))
    )
    
    this.playfield.slotsUpdateCard(this.playfield.withUpdateCard(updates), updates, this.notifierSlot)
  }

  onReceiveData(data:any, registrant:any, peer:PeerPlayer) {
    console.log('Received', data)

    if (data.chern) {
      for (const id of data.chern.idPeers)
        if (id != registrant.id)
          registrant.connect(id)
    } else if (data.ping) {
      //demandElementById("connect-status").dispatchEvent(new EventPingBack(data.ping.secs))
      peer.send({ping_back: {secs: data.ping.secs}})
    } else if (data.ping_back) {
      //demandElementById("connect-status").dispatchEvent(new EventPingBack(data.ping_back.secs))
    } else if (data.sync) {
      this.newGame(data.sync.game, Playfield.fromSerialized(data.sync.playfield))
    } else if (data.askSync) {
      this.sync(peer.id())
    } else if (data.slotUpdates) {
      let updates:UpdateSlot<SlotCard>[]
      let slots:SlotCard[]
      
      updates = (data.slotUpdates as UpdateSlot<SlotCard>[]).map(
        ([s,s_]) => [s ? SlotCard.fromSerialized(s) : undefined, SlotCard.fromSerialized(s_)]
      )
      
      this.playfield = this.playfield.slotsUpdateCard(this.playfield.withUpdateCard(updates), updates,
                                                      this.notifierSlot, false)
    } else if (data.slotUpdatesChip) {
      let updates:UpdateSlot<SlotChip>[]
      let slots:SlotChip[]
      
      updates = (data.slotUpdatesChip as UpdateSlot<SlotChip>[]).map(
        ([s,s_]) => [s ? SlotChip.fromSerialized(s) : undefined, SlotChip.fromSerialized(s_)]
      )
      
      this.playfield = this.playfield.slotsUpdateChip(this.playfield.withUpdateChip(updates), updates,
                                                      this.notifierSlot, false)
    } else {
      console.debug("Unknown message", data)
    }
  }
}

let appGlobal:App

function makeUiGinRummy(playfield:Playfield, app:App) {
  const root = app.rootGet()
  const viewer = app.viewerGet()
  const player = viewer.idCnts[0] ? viewer : app.gameGet().players[0]!
  assertf(() => player)
  const opponent:Player = app.gameGet().players.find(p => p.idCnts[0] && p != player)!
  assertf(() => opponent)
  
  const uislotOpp = new UISlotSpread(opponent.idCnts[0], app.selection, opponent, viewer, playfield, 0,
                                     app.notifierSlot, app.urlCards, app.urlCardBack, app.cardWidthGet(),
                                     app.cardHeightGet(), `${app.cardHeightGet()+25}px`, '100%')
  uislotOpp.init()
  root.add(uislotOpp)

  const divPlay = new UIContainerFlex()
  
  const uislotWaste = new UISlotSpread('waste', app.selection, null, viewer, playfield, 0, app.notifierSlot,
                                       app.urlCards, app.urlCardBack, app.cardWidthGet(), app.cardHeightGet(),
                                       app.cardHeightGet()*1.5+'px', '100%')
  uislotWaste.init()
  uislotWaste.element.style.flexGrow = "1"
  divPlay.add(uislotWaste)
  
  const divStock = new UIContainerFlex('column', true)
  const divStockSpacer = document.createElement("div") // tbd: make spacer UIElement
  divStockSpacer.style.flexGrow = "1"
  divStock.element.appendChild(divStockSpacer)
  const uislotStock = new UISlotSingle('stock', app.selection, null, viewer, playfield, '', 0, app.notifierSlot,
                                       app.urlCards, app.urlCardBack, app.cardWidthGet(), app.cardHeightGet())
  uislotStock.init()
  divStock.add(uislotStock)
  divPlay.add(divStock)

  root.add(divPlay)
  
  const uislotBottom = new UISlotSpread(player.idCnts[0], app.selection, player, viewer, playfield,
                                        0, app.notifierSlot, app.urlCards, app.urlCardBack,
                                        app.cardWidthGet(), app.cardHeightGet(),
                                        `${app.cardHeightGet()+25}px`, '100%')
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
  
  const uislotTop = new UISlotSpread(opponent.idCnts[0], app.selection, opponent, viewer, playfield, 0,
                                     app.notifierSlot, app.urlCards, app.urlCardBack, app.cardWidthGet(),
                                     app.cardHeightGet(), `${app.cardHeightGet()+25}px`, '100%')
  uislotTop.init()
  root.add(uislotTop)

  const divPlay = new UIContainerFlex('column')
  
  const uislotMeldOpp = new UIContainerSlotsMulti(opponent.idCnts[0]+'-meld', app.selection, null, viewer, playfield,
                                                  app.notifierSlot, app.urlCards, app.urlCardBack,
                                                  app.cardWidthGet(), app.cardHeightGet(), `${app.cardHeightGet()}px`,
                                                  'turn')
  uislotMeldOpp.init()
  uislotMeldOpp.element.style.flexGrow = "1" // tbd: encode in UIElement
  divPlay.add(uislotMeldOpp)
  
  const uislotWaste = new UISlotSpread('waste', app.selection, null, viewer, playfield, 0, app.notifierSlot,
                                       app.urlCards, app.urlCardBack, app.cardWidthGet(), app.cardHeightGet(),
                                       (app.cardHeightGet()+25)+'px', '100%', undefined,
                                       undefined, 'flip', 'all-proceeding')
  uislotWaste.init()
  uislotWaste.element.style.flexGrow = "1" // tbd: encode in UIElement
  divPlay.add(uislotWaste)
  
  const uislotMeldPlay = new UIContainerSlotsMulti(player.idCnts[0]+'-meld', app.selection, null, viewer, playfield,
                                                   app.notifierSlot, app.urlCards, app.urlCardBack,
                                                   app.cardWidthGet(), app.cardHeightGet(), `${app.cardHeightGet()}px`,
                                                   'turn')
  uislotMeldPlay.init()
  uislotMeldPlay.element.style.flexGrow = "1"  // tbd: encode in UIElement
  divPlay.add(uislotMeldPlay)
  
  root.add(divPlay)
  
  const divCombiner = new UIContainerFlex('row', true)
  divPlay.add(divCombiner)
  
  const uislotBottom = new UISlotSpread(player.idCnts[0], app.selection, player, viewer, playfield, 0,
                                        app.notifierSlot, app.urlCards, app.urlCardBack, app.cardWidthGet(),
                                        app.cardHeightGet(), `${app.cardHeightGet()+25}px`, '100%')
  uislotBottom.init()
  root.add(uislotBottom)

  const uislotStock = new UISlotSingle('stock', app.selection, null, viewer, playfield, '', 0, app.notifierSlot,
                                       app.urlCards, app.urlCardBack, app.cardWidthGet(), app.cardHeightGet())
  uislotStock.init()
  uislotStock.element.style.marginTop = 'auto' // tbd: encode in UIElement
  root.add(uislotStock)
}

function makeUiPoker(playfield:Playfield, app:App) {
  const root = app.rootGet()
  const viewer = app.viewerGet()
  const player = viewer.idCnts[0] ? viewer : app.gameGet().players[0]
  assert(player)
  const opponent = app.gameGet().players.find(p => p.idCnts[0] && p != player)
  assert(opponent)

  function playerSlots(owner:Player) {
    return new UIContainerFlex('aware').with(cnt => {
      cnt.add(
        new UIContainerFlex().with(cnt => {
          for (let idx=0; idx < 4; ++idx) {
            cnt.add(
              new UISlotChip(owner.idCnts[1], app.selection, owner, viewer, playfield, app.notifierSlot, idx,
                             app.cardWidthGet()).init()
            )
          }
        })
      )
      
      cnt.add(
        new UISlotSpread(owner.idCnts[0], app.selection, owner, viewer, playfield, 0,
                         app.notifierSlot, app.urlCards, app.urlCardBack, app.cardWidthGet(),
                         app.cardHeightGet(), `${app.cardHeightGet()+25}px`, '100%').init()
      )
    })
  }

  root.add(playerSlots(opponent))
  
  root.add(
    new UIContainerFlex('aware').with(cnt => {

      cnt.add(
        new UIContainerFlex().with(cnt => {
          let uislotWaste = new UISlotSpread('waste-secret', app.selection, null, viewer, playfield, 0,
                                             app.notifierSlot, app.urlCards, app.urlCardBack, app.cardWidthGet(),
                                             app.cardHeightGet(), app.cardHeightGet()*1.5+'px', '100%')
          uislotWaste.init()
          uislotWaste.element.style.flexGrow = "1"
          cnt.add(uislotWaste)
          
          uislotWaste = new UISlotSpread('waste', app.selection, null, viewer, playfield, 0,
                                         app.notifierSlot, app.urlCards, app.urlCardBack, app.cardWidthGet(),
                                         app.cardHeightGet(), app.cardHeightGet()*1.5+'px', '100%')
          uislotWaste.init()
          uislotWaste.element.style.flexGrow = "1"
          cnt.add(uislotWaste)
        
          const divStock = new UIContainerFlex(undefined, true)
          const divStockSpacer = document.createElement("div") // tbd: make spacer UIElement
          divStockSpacer.style.flexGrow = "1"
          divStock.element.appendChild(divStockSpacer)
          const uislotStock = new UISlotSingle('stock', app.selection, null, viewer, playfield, '', 0, app.notifierSlot,
                                               app.urlCards, app.urlCardBack, app.cardWidthGet(), app.cardHeightGet())
          uislotStock.init()
          divStock.add(uislotStock)
          cnt.add(divStock)
        })
      )

      cnt.add(
        new UIContainerFlex().with(cnt => {
          for (let i=0; i<4; ++i)
            cnt.add(
              new UISlotChip('ante', app.selection, null, viewer, playfield, app.notifierSlot, i,
                             app.cardWidthGet()).init()
            )
        })
      )
    })
  )


  root.add(playerSlots(player))
}

function run(urlCards:string, urlCardBack:string) {
  const app = new App(
    [
      new GameGinRummy(makeUiGinRummy),
      new GameDummy(makeUiDummy),
      new GamePoker(makeUiPoker),
    ],
    new NotifierSlot(),
    urlCards,
    urlCardBack,
    new UISlotRoot()
  )

  app.init()
  
  appGlobal = app

  dom.demandById("error").addEventListener(
    "click",
    () => dom.demandById("error").style.display = 'none'
  )

  const tblPlayers = (dom.demandById("players", HTMLTableElement))
  app.connections.events.addEventListener("peerupdate", (e:EventPeerUpdate) => {
    tblPlayers.innerHTML = ''
    for (const peer of e.peers) {
      const row = tblPlayers.insertRow()
      row.insertCell().innerText = peer.id()
      row.insertCell().innerText = peer.open() ? 'Connected' : 'Disconnected'
    }
  })

  dom.demandById("id-get").addEventListener("click", () => {
    const id = (dom.demandById("peerjs-id", HTMLInputElement)).value.toLowerCase()
    if (!id) {
      throw new Error("Id not given")
    }
    
    app.connections.register(
      "mpcard-" + id,
      (metadata, peerId) => {
        if (metadata != 'reconnect')
            app.sync(peerId) // tbd: check playfield sequence # and only sync if necessary
      },
      app.onReceiveData.bind(app)
    )
  })
  dom.demandById("connect").addEventListener("click", () => {
    const id = dom.demandById("peerjs-target", HTMLInputElement).value.toLowerCase()
    if (!app.connections.peerById(id))
      app.connections.connect("mpcard-" + id)
  })
  dom.demandById("sync").addEventListener("click", () => app.sync())
  dom.demandById("player-next").addEventListener("click", () => {
    app.viewerSet(app.gameGet().players[(app.gameGet().players.indexOf(app.viewerGet()) + 1) % app.gameGet().players.length])
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

  dom.withElement("game-type", HTMLSelectElement, (elGames) => {
    for (const game of app.games) {
      const opt = document.createElement("option")
      opt.text = game.description
      opt.value = game.id()
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

  app.run(dom.demandById("game-type", HTMLSelectElement).value)
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
      appGlobal.newGame(appGlobal.gameGet().id())
    }
    
    window.setTimeout(
      moveStock,
      100
    )
  }

  moveStock()
}
