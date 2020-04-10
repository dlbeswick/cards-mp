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
    return new Slot(serialized.id, serialized.cards.map(c => WorldCard.fromSerialized(c)))
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
    assert(wcards.every(wc => this.cards.some(wc2 => wc.card.is(wc2.card))))
    return new Slot(this.id, this.cards.filter(wc => !wcards.some(wc2 => wc.card.is(wc2.card))))
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
    assert(!this.isEmpty())
    return this.cards[this.cards.length-1]
  }

  isEmpty():boolean {
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

  length() {
    return this.cards.length
  }

  map(f: (c: WorldCard) => WorldCard): Slot {
    return new Slot(this.id, this.cards.map(f))
  }
  
  [Symbol.iterator]():Iterator<WorldCard> {
    return this.cards[Symbol.iterator]()
  }

  serialize() {
    return { ...super.serialize(), cards: this.cards.map(c => c.serialize()) }
  }
}

class UISlotRoot {
  readonly element:HTMLElement
  
  constructor(element:HTMLElement) {
    this.element = element
  }
  
  add(child:UISlot):void {
    this.element.appendChild(child.element)
  }

  clear() {
    this.element.innerHTML = ''
  }
}

class Player {
  readonly name:string
  readonly idSlot:string
  
  constructor(name:string, idSlot:string) {
    this.name = name
    this.idSlot = idSlot
  }
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

    // Should be 'new EventTarget()', but iOS doesn't support that.
    this.app.notifierSlot.events[this.idSlot] = document.createElement('div')
    
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
      this.app.playfieldMutate(
        this.app.playfieldGet().slotsUpdate([[slotSrc, slotSrc_]], this.app)
      )
    } else {
      // case 2: diff slot. Always flip face-up, unless a human player has deliberately flipped it.
      let faceUp
      if (cardSrc.faceUpIsConscious)
        faceUp = cardSrc.faceUp
      else
        faceUp = true
      
      const slotSrc_ = slotSrc.remove([cardSrc])
      const slotDst_ = slotDst.add([cardSrc.withFaceUp(faceUp)])
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
  readonly cards:HTMLElement
  readonly count:HTMLElement
  
  constructor(idSlot:string, app:App, owner:Player|null, viewer:Player, height:string, width='100%') {
    super(document.createElement("div"), idSlot, app, owner, viewer)
    this.element.classList.add("slot-single")
    this.element.style.width = CARD_WIDTH.toString()
    this.count = document.createElement("label")
    this.count.style.width='100%'
    this.element.appendChild(this.count)
    
    this.cards = document.createElement("div")
    this.cards.style.minHeight = height
    this.element.appendChild(this.cards)
  }

  change(urlImage:string, urlBack:string, slotOld:Slot, slot:Slot):void {
    this.count.innerText = slot.length().toString()
    this.cards.innerHTML = ''
    if (!slot.isEmpty())
      this.cards.appendChild(new UICard(slot.top(), this, this.app, false, this.viewer).element)
  }
}

class UISlotFullWidth extends UISlot {
  readonly element:HTMLElement
  private classesCard:string[]
  
  constructor(idSlot:string, app:App, owner:Player|null, viewer:Player, height:string, width='100%',
              classesSlot:string[]=['slot'], classesCard:string[]=['card']) {
    
    super(document.createElement("div"), idSlot, app, owner, viewer)
    this.element.setAttribute("style", `width: ${width}; min-height: ${height};`)
    this.element.classList.add(...classesSlot)
    this.classesCard = classesCard
  }

  change(urlImage:string, urlBack:string, slotOld:Slot, slot:Slot):void {
    this.element.innerHTML = ''
    for (let wcard of slot) {
      this.element.appendChild(new UICard(wcard, this, this.app, true, this.viewer, this.classesCard).element)
    }
  }
}

class UICard {
  readonly wcard:WorldCard
  readonly element:HTMLElement
  readonly uislot:UISlot
  private readonly app:App
  private timerPress = null
  private touchYStart = 0
  private readonly dropTarget:boolean
  
  constructor(wcard:WorldCard, uislot:UISlot, app:App, dropTarget:boolean, viewer:Player, classesCard=["card"]) {
    this.dropTarget = dropTarget
    this.app = app
    this.wcard = wcard
    this.uislot = uislot
    
    this.element = document.createElement("div")
    this.element.classList.add(...classesCard)
    if (dropTarget)
      this.element.classList.add("droptarget")

    const svg = document.createElement("img")
    if (wcard.faceUp && (this.uislot.isViewableBy(viewer) || wcard.faceUpIsConscious))
      svg.setAttribute('src', app.urlCardImages + '#c' + wcard.card.suit + '_' + wcard.card.rank)
    else {
      svg.setAttribute('src', app.urlCardBack)
    }
    svg.setAttribute('draggable', "false")
    
    svg.setAttribute('width', CARD_WIDTH.toString())
    svg.setAttribute('height', CARD_HEIGHT.toString())

    this.element.appendChild(svg)
    
    this.element.setAttribute("draggable", "true")
    this.element.addEventListener("dragstart", this.onDragStart.bind(this))
//    this.element.addEventListener("drag", this.onDrag.bind(this))
    this.element.addEventListener("dragend", this.onDragEnd.bind(this))

    if (dropTarget) {
      this.element.addEventListener("dragenter", this.onDragEnter.bind(this))
      this.element.addEventListener("drop", this.onDrop.bind(this))
      this.element.addEventListener("dragleave", this.onDragLeave.bind(this))
    }

    // Stop slots swallowing our mouse events
    this.element.addEventListener("click", (e) => {
      e.preventDefault()
      e.stopPropagation()
    })

    function lpMouseUp(self, e) {
      e.preventDefault()
      e.stopPropagation()
      if (self.timerPress) {
        clearTimeout(self.timerPress)
        self.timerPress = null
        self.onClick()
      }
    }
    
    function lpMouseDown(self, e) {
      self.touchYStart = e.clientY
      self.timerPress = window.setTimeout(
        () => {
          self.timerPress = null
          self.onLongPress()
        }, 500)
    }
    
    this.element.addEventListener("pointerup", (e) => {e.preventDefault(); e.stopPropagation(); lpMouseUp(this, e)})
    this.element.addEventListener("pointerdown", (e) => {e.preventDefault(); e.stopPropagation(); lpMouseDown(this, e)})
    this.element.addEventListener("pointermove", (e) => {
      if (Math.abs(e.clientY - this.touchYStart) > 5) {
        if (this.timerPress) {
          clearTimeout(this.timerPress)
          this.timerPress = null
        }
      }
    })
    this.element.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); })
/*    this.element.addEventListener("touchstart", (e) => lpMouseDown(this, e))
    this.element.addEventListener("touchend", (e) => lpMouseUp(this, e))
    this.element.addEventListener("touchmove", (e) => {
      if (Math.abs(e.touch.clientY - this.touchYStart) > 5) {
        if (self.timerPress) {
          clearTimeout(this.timerPress)
          this.timerPress = null
        }
      }
    })*/
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
    const slot_ = slot.replace(this.wcard, this.wcard.withFaceStateConscious(!this.wcard.faceUp, this.wcard.faceUp))
    this.app.playfieldMutate(
      this.app.playfieldGet().slotsUpdate([[slot, slot_]], this.app)
    )
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
    if (!cardSrc.card.is(this.wcard.card)) {
      const slotSrc = this.app.playfieldGet().slotForCard(cardSrc)
      const slotDst = this.uislot.slot(this.app.playfieldGet())

      if (slotSrc.is(slotDst)) {
        const slot = this.app.playfieldGet().slotForCard(cardSrc)
        const slot_ = slot.remove([cardSrc]).add([cardSrc], this.wcard.card)
        this.app.playfieldMutate(
          this.app.playfieldGet().slotsUpdate([[slot, slot_]], this.app)
        )
      } else {
        const slotSrc_ = slotSrc.remove([cardSrc])
        const slotDst_ = slotDst.add([cardSrc], this.wcard.card)
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

  color():Color {
    if (this.suit == Suit.CLUB || this.suit == Suit.SPADE)
      return Color.BLACK
    else
      return Color.RED
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
  readonly faceUpIsConscious:boolean

  constructor(card:Card, faceUp:boolean, faceUpIsConscious=false) {
    this.card = card
    this.faceUp = faceUp
    this.faceUpIsConscious = faceUpIsConscious
  }

  static fromSerialized(serialized:any) {
    return new WorldCard(Card.fromSerialized(serialized.card), serialized.faceUp, serialized.faceUpIsConscious)
  }
  
  withFaceUp(faceUp:boolean) {
    return new WorldCard(this.card, faceUp, this.faceUpIsConscious)
  }

  withFaceStateConscious(faceUp:boolean, conscious:boolean) {
    return new WorldCard(this.card, faceUp, conscious)
  }
  
  serialize():any {
    return {
      card: this.card.serialize(),
      faceUp: this.faceUp,
      faceUpConscious: this.faceUpIsConscious
    }
  }
}

function deck52() {
  const result:Card[] = []
  
  for (let suit = 0; suit < 4; ++suit) {
    for (let rank = 0; rank < 13; ++rank) {
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

function orderColorAlternate(c:Card):number {
  switch (c.suit) {
    case Suit.CLUB: return 0; break;
    case Suit.DIAMOND: return 1; break;
    case Suit.SPADE: return 2; break;
    case Suit.HEART: return 3; break;
  }
}

function sortedByAltColorAndRank(deck:Card[]):Card[] {
  const result = [...deck]
  result.sort((a, b) => orderColorAlternate(a) - orderColorAlternate(b) || a.rank - b.rank)
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

class EventPingBack extends Event {
  secs:number
  
  constructor(secs:number) {
    super('pingback')
    this.secs = secs
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
    if (rpc && app.peerConn) {
      app.peerConn.send({slotUpdates: slots.map(([s, s_]) => [s.serialize(), s_.serialize()])})
    }
    for (const [slot, slot_] of slots) {
      app.notifierSlot.events[slot.id].dispatchEvent(new EventSlotChange(slot, slot_))
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
  private viewer:Player
  private playfield:Playfield
  private root:UISlotRoot
  private players:Player[]
  
  constructor(playfield:Playfield, notifierSlot:NotifierSlot, urlCardImages:string, urlCardBack:string, viewer:Player,
              players:Player[], root:UISlotRoot) {
    this.playfield = playfield
    this.notifierSlot = notifierSlot
    this.urlCardImages = urlCardImages
    this.urlCardBack = urlCardBack
    this.viewer = viewer
    this.players = players
    this.root = root
  }

  init() {
    this.viewerSet(this.viewer)
  }
  
  playfieldGet():Playfield {
    return this.playfield
  }
  
  playfieldMutate(playfield:Playfield):Playfield {
    this.playfield = playfield
    return playfield
  }

  viewerSet(viewer:Player) {
    this.viewer = viewer

    const opponent = this.players.find(p => p != this.viewer)
    
    this.root.clear()
    const uislotTop = new UISlotFullWidth(opponent.idSlot, this, opponent, this.viewer, `${CARD_HEIGHT}px`)
    uislotTop.init()
    this.root.add(uislotTop)

    // Refactor as UI element...
    const divPlay = document.createElement("div")
    divPlay.style.display = 'flex'
    
    const uislotWaste = new UISlotFullWidth('waste', this, null, this.viewer, CARD_HEIGHT*1.5+'px','100%',
                                            ['slot', 'slot-overlap'], ['card', 'card-overlap'])
    uislotWaste.init()
    uislotWaste.element.style.flexGrow = "1"
    divPlay.appendChild(uislotWaste.element)
    
    const divStock = document.createElement("div")
    divStock.style.display = 'flex'
    divStock.style.flexDirection = 'column'
    const divStockSpacer = document.createElement("div")
    divStockSpacer.style.flexGrow = "1"
    divStock.appendChild(divStockSpacer)
    const uislotStock = new UISlotSingle('stock', this, null, this.viewer, '',`${CARD_WIDTH}px`)
    uislotStock.init()
    divStock.appendChild(uislotStock.element)
    divPlay.appendChild(divStock)

    this.root.element.appendChild(divPlay)
    
    const uislotBottom = new UISlotFullWidth(this.viewer.idSlot, this, this.viewer, this.viewer, `${CARD_HEIGHT}px`)
    uislotBottom.init()
    this.root.add(uislotBottom)

    document.getElementById("player").innerText = this.viewer.name

    for (const slot of this.playfield.slots) {
      this.notifierSlot.events[slot.id].dispatchEvent(new EventSlotChange(slot, slot))
    }
  }

  viewerGet() {
    return this.viewer
  }
}

function host(app:App) {
  if (app.peer) {
    return
  }
  
  const id = (document.getElementById("peerjs-id") as HTMLInputElement).value.toLowerCase()
  if (!id) {
    throw new Error("Id not given")
  }
  
  let peer = new Peer("mpcard-"+id)
  console.log("Registering as " + id)
  
  peer.on('open', function(id) {
    app.peer = peer
    app.peer.on('error', function(err) {
      app.peer = null
      document.getElementById("peerjs-status").innerHTML = "Unregistered"
    })
    
    document.getElementById("peerjs-status").innerHTML = "Registered"

    peer.on('connection', function(conn) {
      console.debug("Peer connected to us")
      
      // Receive messages
      conn.on('data', function(data) {
        console.log('Received', data)

        if (data.ping) {
          document.getElementById("connect-status").dispatchEvent(new EventPingBack(data.ping.secs))
          if (app.peerConn)
            app.peerConn.send({ping_back: {secs: data.ping.secs}})
        } else if (data.ping_back) {
          document.getElementById("connect-status").dispatchEvent(new EventPingBack(data.ping_back.secs))
        } else {
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
          
          app.playfieldMutate(app.playfieldGet().slotsUpdate(updates, app, false))
        }
      });
    })
  })

  peer.on('error', function(err) { throw new Error("PeerJS: " + err) })
}

function connect(app:App) {
  if (app.peer) {
    const idPeer = (document.getElementById("peerjs-target") as HTMLInputElement).value.toLowerCase()

    if (!idPeer) {
      throw new Error("Peer's id not given")
    }
    
    console.log("Attempting connection to " + idPeer)
    const conn = app.peer.connect("mpcard-"+idPeer)
    conn.on('open', function() {
      console.debug("Peer opened")
      document.getElementById("connect-status").innerHTML = "Waiting for reply"
      app.peerConn = conn
      function ping(secs) {
        conn.send({ping: {secs: secs}})
        window.setTimeout(() => ping(secs+30), 30000)
      }
      ping(0)
    });
    conn.on('error', function(err) {
      app.peerConn = null
      document.getElementById("connect-status").innerHTML = "Disconnected"
      throw new Error(`Connection to ${idPeer}: ${err}`)
    })
  }
}

function send(app:App) {
  if (app.peerConn) {
    app.peerConn.send({playfield: app.playfieldGet().serialize()})
  } else {
    console.error("No peer")
  }
}

function revealAll(app:App) {
  const updates:SlotUpdate[] = app.playfieldGet().slots.map(s => [s, s.map(wc => wc.withFaceStateConscious(true, true))])
  app.playfieldMutate(app.playfieldGet().slotsUpdate(updates, app))
}

function newGameGinRummy(app:App) {
  const deck = shuffled(deck52())
  //    const deck = deck52()
  const playfield = app.playfieldGet()
  const updates:Array<SlotUpdate> = []
  
  updates.push([playfield.slot("p0"),
                playfield.slot("p0").clear().add(sortedByAltColorAndRank(deck.slice(0,10)).map(c => new WorldCard(c, true)))])

  updates.push([playfield.slot("p1"),
                playfield.slot("p1").clear().add(sortedByAltColorAndRank(deck.slice(10,20)).map(c => new WorldCard(c, true)))])

  updates.push([playfield.slot("stock"),
                playfield.slot("stock").clear().add(deck.slice(20).map(c => new WorldCard(c, false)))])

  updates.push([playfield.slot("waste"),
                playfield.slot("waste").clear()])
  
  app.playfieldMutate(playfield.slotsUpdate(updates, app))
}

let appGlobal:App

function run(urlCardImages:string, urlCardBack:string) {
  let playfield = new Playfield(
    [new Slot("p0"),
     new Slot("p1"),
     new Slot("stock"),
     new Slot("waste")]
  )

  const p0 = new Player('Player 1', 'p0')
  const p1 = new Player('Player 2', 'p1')
  
  const app = new App(playfield, new NotifierSlot(), urlCardImages, urlCardBack, p0, [p0, p1],
                      new UISlotRoot(document.getElementById("playfield")))

  appGlobal = app

  app.init()
  
  document.getElementById("error").addEventListener("click", () => document.getElementById("error").innerHTML='')
  document.getElementById("id-get").addEventListener("click", () => host(app))
  document.getElementById("connect").addEventListener("click", () => connect(app))
  document.getElementById("send").addEventListener("click", () => send(app))
  document.getElementById("player-next").addEventListener("click", () => {
    if (app.viewerGet() == p0) {
      app.viewerSet(p1)
    } else {
      app.viewerSet(p0)
    }
  })
  document.getElementById("connect-status").addEventListener(
    "pingback",
    function (e:EventPingBack) { this.innerHTML = `Connected for ${e.secs}s` }
  )
  
  newGameGinRummy(app)
  document.getElementById("game-new").addEventListener("click", () => newGameGinRummy(app))
  document.getElementById("reveal-all").addEventListener("click", () => revealAll(app))
}

document.addEventListener("deviceready", () => {
  run("img/cards.svg", "img/back.svg")

  // Create a PeerConnection with no streams, but force a m=audio line.
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

function test() {
  function moveStock() {
    const playfield = appGlobal.playfieldGet()
    appGlobal.playfieldMutate(
      playfield.slotsUpdate([
        [
          playfield.slot("stock"),
          playfield.slot("stock").remove([playfield.slot("stock").top()])
        ],
        [
          playfield.slot("waste"),
          playfield.slot("waste").add([playfield.slot("stock").top().withFaceUp(true)])
        ]
      ],
      appGlobal
      )
    )

    if (appGlobal.playfieldGet().slot("stock").isEmpty()) {
      newGameGinRummy(appGlobal)
    }
    
    window.setTimeout(
      moveStock,
      100
    )
  }

  moveStock()
}
