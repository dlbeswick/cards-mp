const CARD_WIDTH = 74
const CARD_HEIGHT = 112
type SlotUpdate = [Slot, Slot]

function errorHandler(message, source?, lineno?, colno?, error?, showAlert=true) {
  if (showAlert)
    alert(message)
  document.getElementById("error").style.display = "block"
  document.getElementById("error").innerHTML = message + "<br/>" + "Line: " + lineno + "<br/>" + source
  return true
}

function assert(test, message='', ...args) {
  if (!test) {
    for (let arg of args) {
      message += JSON.stringify(arg) + " "
    }
    errorHandler(message, undefined, undefined, undefined, undefined, false)
    throw new Error(message)
  }
}

window.onerror = errorHandler

abstract class Identified<T, IdType=string> {
  readonly id:IdType

  constructor(id:IdType) {
    this.id = id
  }
  
  is(rhs:Identified<T, IdType>):boolean {
    return this.isId(rhs.id)
  }

  isId(id:IdType):boolean {
    return this.id == id
  }

  serialize(): any {
    return { id: this.id }
  }
}

class Slot extends Identified<Slot> implements Iterable<WorldCard> {
  private cards:WorldCard[]

  constructor(id:string, cards:WorldCard[] = []) {
    super(id)
    this.cards = cards
  }

  static fromSerialized(serialized:any) {
    return new Slot(serialized.id, serialized.cards.map(c => new WorldCard(Card.fromSerialized(c.card), c.faceUp)))
  }
  
  add(wcards:WorldCard[], before?:Card):Slot {
    const idx = (() => {
      if (before) {
        const result = this.cards.findIndex(c => c.card.is(before))
        assert(result != -1)
        return result
      } else {
        return this.cards.length
      }
    })()
    
    assert(wcards.every(wc => !this.cards.includes(wc)))
    assert(idx >= 0 && idx <= this.cards.length)
    return new Slot(this.id, this.cards.slice(0, idx).concat(wcards).concat(this.cards.slice(idx)))
  }

  remove(wcards:WorldCard[]):Slot {
    assert(wcards.every(wc => this.cards.includes(wc)))
    return new Slot(this.id, this.cards.filter(wc => !wcards.includes(wc)))
  }

  replace(wcard:WorldCard, wcard_:WorldCard):Slot {
    const idx = this.cards.findIndex(c => c.card.is(wcard.card))
    assert(idx != -1)
    return new Slot(this.id, this.cards.slice(0, idx).concat([wcard_]).concat(this.cards.slice(idx+1)))
  }

  clear():Slot {
    return new Slot(this.id, [])
  }
  
  top():WorldCard {
    assert(!this.empty())
    return this.cards[this.cards.length-1]
  }

  empty():boolean {
    return this.cards.length == 0
  }

  card(idx:number) {
    assert(idx >= 0 && idx < this.cards.length)
    return this.cards[idx]
  }

  hasCard(wcard:WorldCard) {
    return this.cards.some(wc => wc.card.is(wcard.card))
  }

  cardById(idCard:string):WorldCard|undefined {
    return this.cards.find(wc => wc.card.id == idCard)
  }
  
  [Symbol.iterator]():Iterator<WorldCard> {
    return this.cards[Symbol.iterator]()
  }

  serialize() {
    return { ...super.serialize(), cards: this.cards.map(c => c.serialize()) }
  }
}

class UISlotRoot {
  add(child:UISlot):void {
    document.body.appendChild(child.element)
  }
}

class Player {
}

abstract class UISlot {
  readonly element:HTMLElement
  readonly idSlot:string
  protected readonly app:App
  protected readonly owner:Player|null
  protected readonly viewer:Player
  
  constructor(element:HTMLElement, idSlot:string, app:App, owner:Player|null, viewer:Player) {
    this.element = element
    this.idSlot = idSlot
    this.app = app
    this.owner = owner
    this.viewer = viewer

    this.app.notifierSlot.events[this.idSlot] = new EventTarget()
    this.app.notifierSlot.events[this.idSlot].addEventListener(
      "slotchange",
      e => { this.change(this.app.urlCardImages, this.app.urlCardBack, e.old, e.slot) }
    )

    this.element.classList.add("slot")
    this.element.classList.add("droptarget")
  }

  init():void {
    this.element.addEventListener("dragenter", this.onDragEnter.bind(this))
    this.element.addEventListener("drop", this.onDrop.bind(this))
    this.element.addEventListener("dragover", this.onDragOver.bind(this))
    this.element.addEventListener("dragleave", this.onDragLeave.bind(this))
    this.element.addEventListener("click", this.onClick.bind(this))
  }
  
  abstract change(urlImage:string, urlBack:string, slotOld:Slot, slot:Slot):void

  isViewableBy(viewer:Player) {
    return this.owner == null || viewer == this.owner
  }
  
  slot(playfield:Playfield):Slot {
    return playfield.slot(this.idSlot)
  }
  
  onDragEnter(e:DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    this.element.classList.add("dragged-over")
  }
  
  onDragOver(e:DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = "move"
  }

  onClick(e:MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (this.app.selected) {
      this.app.selected.element.classList.remove("selected")
      this.doMove(this.app.selected.wcard.card.id)
      this.app.selected = null
    }
  }

  onDrop(e:DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    this.element.classList.remove("dragged-over")
    const dragData = e.dataTransfer.getData("application/json")
    console.debug(JSON.stringify(dragData))
    if (dragData) {
      const msg = JSON.parse(dragData)
      this.doMove(msg.card.id)
    }
  }

  private doMove(idCard:string) {
    const cardSrc = this.app.playfieldGet().wcard(idCard)
    const slotSrc = this.app.playfieldGet().slotForCard(cardSrc)
    const slotDst = this.app.playfieldGet().slot(this.idSlot)
    // Two playfield mutates to simplify logic/reduce object creation? Or one mutate?
    if (slotSrc.is(slotDst)) {
      // case 1: same slot. Only possible outcome is move to end, otherwise drop target would be UICard.
      const slotSrc_ = slotSrc.remove([cardSrc]).add([cardSrc])
      this.app.playfieldGet().slotsUpdate([[slotSrc, slotSrc_]], this.app)
    } else {
      // case 2: diff slot. flip
      const slotSrc_ = slotSrc.remove([cardSrc])
      const slotDst_ = slotDst.add([cardSrc.withFaceUp(true)])
      this.app.playfieldMutate(
        this.app.playfieldGet().slotsUpdate([[slotSrc, slotSrc_], [slotDst, slotDst_]], this.app)
      )
    }
  }
  
  onDragLeave(e:DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    this.element.classList.remove("dragged-over")
  }
}

class UISlotSingle extends UISlot {
  readonly element:HTMLElement
  
  constructor(idSlot:string, app:App, owner:Player|null, viewer:Player, height:string, width='100%') {
    super(document.createElement("div"), idSlot, app, owner, viewer)
    this.element.style.width = CARD_WIDTH.toString()
    this.element.style.minHeight = height
  }

  change(urlImage:string, urlBack:string, slotOld:Slot, slot:Slot):void {
    this.element.innerHTML = ''
    if (!slot.empty())
      this.element.appendChild(new UICard(slot.top(), this, this.app, false, this.viewer).element)
  }
}

class UISlotFullWidth extends UISlot {
  readonly element:HTMLElement
  
  constructor(idSlot:string, app:App, owner:Player|null, viewer:Player, height:string, width='100%') {
    super(document.createElement("div"), idSlot, app, owner, viewer)
    this.element.setAttribute("style", `width: ${width}; min-height: ${height};`)
  }

  change(urlImage:string, urlBack:string, slotOld:Slot, slot:Slot):void {
    this.element.innerHTML = ''
    for (let wcard of slot) {
      this.element.appendChild(new UICard(wcard, this, this.app, true, this.viewer).element)
    }
  }
}

class UICard {
  readonly wcard:WorldCard
  readonly element:HTMLElement
  readonly uislot:UISlot
  private readonly app:App
  private timerPress = null
  private readonly dropTarget:boolean
  
  constructor(wcard:WorldCard, uislot:UISlot, app:App, dropTarget:boolean, viewer:Player) {
    this.dropTarget = dropTarget
    this.app = app
    this.wcard = wcard
    this.uislot = uislot
    
    this.element = document.createElement("div")
    this.element.classList.add("card")
    if (dropTarget)
      this.element.classList.add("droptarget")

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute('draggable', "false")
    this.element.appendChild(svg)
    
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use")

    if (wcard.faceUp && (this.uislot.isViewableBy(viewer)))
      use.setAttribute('href', app.urlCardImages + '#c' + wcard.card.suit + '_' + wcard.card.rank)
    else {
      use.setAttribute('href', app.urlCardBack + '#back')
      use.setAttribute('transform', 'scale(0.45)')
    }
      
    svg.appendChild(use)
    svg.setAttribute('width', CARD_WIDTH.toString())
    svg.setAttribute('height', CARD_HEIGHT.toString())

    this.element.setAttribute("draggable", "true")
    this.element.addEventListener("dragstart", this.onDragStart.bind(this))
//    this.element.addEventListener("drag", this.onDrag.bind(this))
    this.element.addEventListener("dragend", this.onDragEnd.bind(this))

    if (dropTarget) {
      this.element.addEventListener("dragenter", this.onDragEnter.bind(this))
      this.element.addEventListener("drop", this.onDrop.bind(this))
      this.element.addEventListener("dragleave", this.onDragLeave.bind(this))
    }

    this.element.addEventListener("click", (e) => {
      e.preventDefault()
      e.stopPropagation()
    })
    
    this.element.addEventListener("mouseup", (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (this.timerPress) {
        clearTimeout(this.timerPress)
        this.timerPress = null
        this.onClick()
      }
    })
    this.element.addEventListener("mousedown", (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.timerPress = window.setTimeout(
        () => {
          this.timerPress = null
          this.onLongPress()
        }, 750)
    })
  }

  detach() {
    this.element.parentNode.removeChild(this.element)
  }
  
  attach(parent:HTMLElement) {
    console.assert(!this.element.parentNode)
    parent.appendChild(this.element)
  }

  private onLongPress() {
    this.flip()
  }
  
  private onClick() {
//    const el = document.getElementsByClassName("droptarget")
    
    if (this.app.selected) {
//      for (let i = 0; i < el.length; ++i) {
//        el[i].classList.remove("highlighted")
//      }

      this.app.selected.element.classList.remove("selected")
      this.doMove(this.app.selected.wcard)
      this.app.selected = null
    } else {
//      for (let i = 0; i < el.length; ++i) {
//        el[i].classList.add("highlighted")
//      }

      this.element.classList.add("selected")
      this.app.selected = this
    }
  }
  
  private flip() {
    const slot = this.uislot.slot(this.app.playfieldGet())
    const slot_ = slot.replace(this.wcard, this.wcard.withFaceUp(!this.wcard.faceUp))
    this.app.playfieldGet().slotsUpdate([[slot, slot_]], this.app)
  }
  
  private onDragStart(e:DragEvent) {
    e.stopPropagation()
    console.debug("Drag start " + e.clientX + "," + e.clientY)
    e.dataTransfer.setData("application/json", JSON.stringify(this.wcard.serialize()))
  }
    
  private onDrag(e:DragEvent) {
    e.preventDefault()
    e.stopPropagation()
  }
    
  private onDragEnd(e:DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    console.debug("Drag end " + e.clientX + ","  +e.clientY)
  }
  
  private onDragEnter(e:DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    this.element.classList.add("dragged-over")
  }

  onDrop(e:DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    this.element.classList.remove("dragged-over")
    const dragData = e.dataTransfer.getData("application/json")
    console.debug(JSON.stringify(dragData))
    if (dragData) {
      const msg = JSON.parse(dragData)
      this.doMove(this.app.playfieldGet().wcard(msg.card.id))
    }
  }

  private doMove(cardSrc:WorldCard) {
    // Two playfield mutates to simplify logic/reduce object creation? Or one mutate?
    if (!cardSrc.card.is(this.wcard.card)) {
      const slotSrc = this.app.playfieldGet().slotForCard(cardSrc)
      const slotDst = this.uislot.slot(this.app.playfieldGet())

      if (slotSrc.is(slotDst)) {
        // case 1: same slot. Only possible outcome is move to end.
        const slot = this.app.playfieldGet().slotForCard(cardSrc)
        const slot_ = slot.remove([cardSrc]).add([cardSrc], this.wcard.card)
        this.app.playfieldGet().slotsUpdate([[slot, slot_]], this.app)
      } else {
        // case 2: diff slot. flip
        const slotSrc_ = slotSrc.remove([cardSrc])
        const slotDst_ = slotDst.add([cardSrc])
        this.app.playfieldMutate(
          this.app.playfieldGet().slotsUpdate([[slotSrc, slotSrc_], [slotDst, slotDst_]], this.app)
        )
      }
    }
  }
  
  private onDragLeave(e:DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    this.element.classList.remove("dragged-over")
  }
}

enum Suit {
  CLUB=0,
  DIAMOND,
  HEART,
  SPADE
}

enum Color {
  BLACK=0,
  RED=1
}

class Card extends Identified<Card> {
  readonly suit:number
  readonly rank:number
  readonly id:string
    
  constructor(rank:number, suit:number, id:string) {
    super(id)
    this.suit = suit
    this.rank = rank
  }

  static fromSerialized(serialized:any) {
    return new Card(serialized.rank, serialized.suit, serialized.id)
  }
  
  serialize():any {
    return {
      ...super.serialize(),
      suit: this.suit,
      rank: this.rank
    }
  }
}

class WorldCard {
  readonly card:Card
  readonly faceUp:boolean

  constructor(card:Card, faceUp:boolean) {
    this.card = card
    this.faceUp = faceUp
  }

  withFaceUp(faceUp:boolean) {
    return new WorldCard(this.card, faceUp)
  }

  serialize():any {
    return {
      card: this.card.serialize(),
      faceUp: this.faceUp
    }
  }
}

function deck52() {
  const result:Card[] = []
  
  for (let suit = 0; suit < 4; ++suit) {
    for (let rank = 0; rank < 12; ++rank) {
      result.push(new Card(rank, suit, rank+'_'+suit))
    }
  }

  return result
}

function shuffled(deck:Card[]):Card[] {
  const result:Card[] = []
  
  while (deck.length) {
    const idx = Math.floor(Math.random() * deck.length)
    result.push(deck[idx])
    deck = deck.slice(0,idx).concat(deck.slice(idx+1))
  }
  
  return result
}

class EventSlotChange extends Event {
  old:Slot
  slot:Slot
  
  constructor(old:Slot, slot:Slot) {
    super('slotchange')
    this.old = old
    this.slot = slot
  }
}

class NotifierSlot {
  readonly events:Map<string, EventTarget> = new Map()
}

class Playfield {
  readonly slots:Slot[]

  constructor(slots:Slot[]) {
    this.slots = slots
  }

  static fromSerialized(serialized:any):Playfield {
    return new Playfield(serialized.slots.map(s => Slot.fromSerialized(s)))
  }
  
  slot(id:string):Slot {
    const result = this.slots.find(s => s.isId(id))
    assert(result)
    return result
  }

  slotForCard(wcard:WorldCard) {
    for (const slot of this.slots) {
      if (slot.hasCard(wcard))
        return slot
    }
    throw new Error(`Card ${wcard.card.id} is not in a slot`)
  }
  
  wcard(id:string):WorldCard {
    for (const slot of this.slots) {
      const w = slot.cardById(id)
      if (w)
        return w
    }
    throw new Error(`No such card ${id}`)
  }
  
  slotsUpdate(slots:SlotUpdate[], app:App, rpc=true):Playfield {
    assert(slots.every(([slot, _slot]) => slot.is(_slot) && this.slots.find(s => s.is(slot))))
    for (const [slot, slot_] of slots) {
      app.notifierSlot.events[slot.id].dispatchEvent(new EventSlotChange(slot, slot_))
    }
    if (rpc && app.peerConn) {
      app.peerConn.send({slotUpdates: slots.map(([s, s_]) => [s.serialize(), s_.serialize()])})
    }
    return new Playfield(
      this.slots.filter(s => !slots.some(([slot,_]) => slot.is(s))).concat(slots.map(([_,slotNew]) => slotNew))
    )
  }

  serialize():any {
    return { slots: this.slots.map(s => s.serialize()) }
  }
}

declare var Peer

class App {
  peer:any
  peerConn:any
  receiveChannel:any
  sendChannel:any
  selected?:UICard
  readonly notifierSlot:NotifierSlot
  readonly urlCardImages:string
  readonly urlCardBack:string
  private playfield:Playfield
  
  constructor(playfield:Playfield, notifierSlot:NotifierSlot, urlCardImages:string, urlCardBack:string) {
    this.playfield = playfield
    this.notifierSlot = notifierSlot
    this.urlCardImages = urlCardImages
    this.urlCardBack = urlCardBack
  }

  playfieldGet():Playfield {
    return this.playfield
  }
  
  playfieldMutate(playfield:Playfield):Playfield {
    this.playfield = playfield
    return playfield
  }
}

function host(app:App) {
  const id = (document.getElementById("peerjs-id") as HTMLInputElement).value
  app.peer = new Peer(id)
  console.log("Registering as " + id)
  
  app.peer.on('open', function(id) {
    document.getElementById("peerjs-status").innerHTML = "Registered"
  })

  app.peer.on('connection', function(conn) {
    console.debug("Peer connected")
    
    // Receive messages
    conn.on('data', function(data) {
      console.log('Received', data)

      let updates:SlotUpdate[]
      let slots:Slot[]
      
      if (data.slotUpdates != undefined) {
        updates = data.slotUpdates.map(([s,s_]) => [Slot.fromSerialized(s), Slot.fromSerialized(s_)])
      } else {
        slots = Playfield.fromSerialized(data.playfield).slots
        updates = []
        for (const slot of slots) {
          updates.push([app.playfieldGet().slot(slot.id), slot])
        }
      }
      
      app.playfieldGet().slotsUpdate(updates, app, false)
    });
  })

  app.peer.on('error', function(err) { throw new Error("PeerJS: " + err) })
}

function connect(app:App) {
  const idPeer = (document.getElementById("peerjs-target") as HTMLInputElement).value
  console.log("Attempting connection to " + idPeer)
  const conn = app.peer.connect(idPeer)
  conn.on('open', function() {
    console.debug("Peer opened")
    document.getElementById("connect-status").innerHTML = "Connected"
    app.peerConn = conn
  });
  conn.on('error', function(err) { throw new Error(`Connection to ${idPeer}: ${err}`) })
}

function send(app:App) {
  if (app.peerConn) {
    app.peerConn.send({playfield: app.playfieldGet().serialize()})
  } else {
    console.error("No peer")
  }
}

function run(urlCardImages:string, urlCardBack:string) {
  let playfield = new Playfield(
    [new Slot("p0"),
     new Slot("p1"),
     new Slot("stock"),
     new Slot("waste")]
  )

  const app = new App(playfield, new NotifierSlot(), urlCardImages, urlCardBack)

  document.getElementById("id-get").addEventListener("click", () => host(app))
  document.getElementById("connect").addEventListener("click", () => connect(app))
  document.getElementById("send").addEventListener("click", () => send(app))
  
  const p0 = new Player()
  const p1 = new Player()
  
  const deck = shuffled(deck52())
  const root = new UISlotRoot()
  const uislotTop = new UISlotFullWidth('p1', app, p1, p0, `${CARD_HEIGHT}px`)
  uislotTop.init()
  root.add(uislotTop)

  // Refactor as UI element...
  const divPlay = document.createElement("div")
  divPlay.style.display = 'flex'
  
  const uislotWaste = new UISlotFullWidth('waste', app, null, p0, CARD_HEIGHT*1.5+'px','100%')
  uislotWaste.init()
  uislotWaste.element.style.flexGrow = "1"
  divPlay.appendChild(uislotWaste.element)
  const uislotStock = new UISlotSingle('stock', app, null, p0, CARD_HEIGHT*1.5+'px',`${CARD_WIDTH}px`)
  uislotStock.init()
  divPlay.appendChild(uislotStock.element)

  document.body.appendChild(divPlay)
  
  const uislotBottom = new UISlotFullWidth('p0', app, p0, p0, `${CARD_HEIGHT}px`)
  uislotBottom.init()
  root.add(uislotBottom)

  function newGame() {
    const playfield = app.playfieldGet()
    const updates:Array<SlotUpdate> = []
    
    updates.push([playfield.slot("p0"),
                  playfield.slot("p0").clear().add(deck.slice(0,10).map(c => new WorldCard(c, true)))])

    updates.push([playfield.slot("p1"),
                  playfield.slot("p1").clear().add(deck.slice(10,20).map(c => new WorldCard(c, true)))])

    updates.push([playfield.slot("stock"),
                  playfield.slot("stock").clear().add(deck.slice(20).map(c => new WorldCard(c, false)))])

    updates.push([playfield.slot("waste"),
                  playfield.slot("waste").clear()])
    
    app.playfieldMutate(playfield.slotsUpdate(updates, app))
  }

  newGame()
  document.getElementById("game-new").addEventListener("click", () => newGame())
}

document.addEventListener("deviceready", () => {
  run("img/cards.svg", "img/back.svg")
})
