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

class Slot implements Iterable<WorldCard> {
  readonly id:string
  private cards:WorldCard[]

  constructor(id:string, cards:WorldCard[] = []) {
    this.id = id
    this.cards = cards
  }
  
  add(wcards:WorldCard[],idx:number=this.cards.length):Slot {
    assert(wcards.every(wc => !this.cards.includes(wc)))
    assert(idx >= 0 && idx <= this.cards.length)
    return new Slot(this.id, this.cards.slice(0, idx).concat(wcards).concat(this.cards.slice(idx)))
  }

  remove(wcards:WorldCard[]):Slot {
    assert(wcards.every(wc => this.cards.includes(wc)))
    return new Slot(this.id, this.cards.filter(wc => !wcards.includes(wc)))
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
    return this.cards.some(wc => wc.card.id == wcard.card.id)
  }

  cardById(idCard:string):WorldCard|undefined {
    return this.cards.find(wc => wc.card.id == idCard)
  }
  
  [Symbol.iterator]():Iterator<WorldCard> {
    return this.cards[Symbol.iterator]()
  }
}

class UISlotRoot {
  add(child:UISlot):void {
    document.body.appendChild(child.element)
  }
}

abstract class UISlot {
  readonly element:HTMLElement
  readonly idSlot:string
  private readonly app:App
  
  constructor(element:HTMLElement, idSlot:string, app:App) {
    this.element = element
    this.idSlot = idSlot
    this.app = app
  }

  init():void {
    this.element.addEventListener("dragenter", this.onDragEnter.bind(this))
    this.element.addEventListener("drop", this.onDrop.bind(this))
    this.element.addEventListener("dragover", this.onDragOver.bind(this))
    this.element.addEventListener("dragleave", this.onDragLeave.bind(this))
  }
  
  abstract change(urlImage:string, urlBack:string, slotOld:Slot, slot:Slot):void
  
  onDragEnter(e:DragEvent) {
    e.preventDefault()
    this.element.classList.add("dragged-over")
  }
  
  onDragOver(e:DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
  }

  onDrop(e:DragEvent) {
    e.preventDefault()
    this.element.classList.remove("dragged-over")
    const dragData = e.dataTransfer.getData("application/json")
    console.debug(JSON.stringify(dragData))
    if (dragData) {
      const msg = JSON.parse(dragData)
      const cardSrc = this.app.playfieldGet().card(msg.card.id)
      const slotSrc = this.app.playfieldGet().slotForCard(cardSrc)
      const slotDst = this.app.playfieldGet().slot(this.idSlot)
      const slotSrc_ = slotSrc.remove([cardSrc])
      const slotDst_ = slotDst.add([cardSrc])
      this.app.playfieldMutate(
        this.app.playfieldGet().slotsUpdate([slotSrc_, slotDst_])
      )
      this.app.notifierSlot.events[slotSrc.id].dispatchEvent(new EventSlotChange(slotSrc, slotSrc_))
      this.app.notifierSlot.events[slotDst.id].dispatchEvent(new EventSlotChange(slotDst, slotDst_))
    }
  }
  
  onDragLeave(e:DragEvent) {
    e.preventDefault()
    this.element.classList.remove("dragged-over")
  }
}

class UISlotSingle extends UISlot {
  readonly element:HTMLElement
  
  constructor(idSlot:string, app:App, height:string, width='100%') {
    super(document.createElement("div"), idSlot, app)
    this.element.setAttribute("style", `display: inline-block; width: ${width}; min-height: ${height}; border: 1px black`)
  }

  change(urlImage:string, urlBack:string, slotOld:Slot, slot:Slot):void {
    this.element.innerHTML = ''
    if (!slot.empty())
      this.element.appendChild(new UICard(urlImage, urlBack, slot.top()).element)
  }
}

class UISlotFullWidth extends UISlot {
  readonly element:HTMLElement
  
  constructor(idSlot:string, app:App, height:string, width='100%') {
    super(document.createElement("div"), idSlot, app)
    this.element.setAttribute("style", `display: inline-block; width: ${width}; min-height: ${height}; border: 1px black`)
  }

  change(urlImage:string, urlBack:string, slotOld:Slot, slot:Slot):void {
    this.element.innerHTML = ''
    for (let wcard of slot) {
      this.element.appendChild(new UICard(urlImage, urlBack, wcard).element)
    }
  }
}

class UICard {
  readonly wcard:WorldCard
  readonly element:HTMLElement
  
  constructor(urlImage:string, urlBack:string, wcard:WorldCard) {
    this.wcard = wcard
    
    this.element = document.createElement("div")
    this.element.setAttribute("style", "display: inline-block")

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute('draggable', "false")
    this.element.appendChild(svg)
    
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use")

    if (wcard.faceUp)
      use.setAttribute('href', urlImage + '#c' + wcard.card.suit + '_' + wcard.card.rank)
    else {
      use.setAttribute('href', urlBack + '#back')
      use.setAttribute('transform', 'scale(0.45)')
    }
      
    svg.appendChild(use)
    svg.setAttribute('width', '74')
    svg.setAttribute('height', '112')
    
    this.element.setAttribute("draggable", "true")
    this.element.addEventListener("dragstart", this.onDragStart.bind(this))
//    this.element.addEventListener("drag", this.onDrag.bind(this))
    this.element.addEventListener("dragend", this.onDragEnd.bind(this))

    this.element.addEventListener("dragenter", this.onDragEnter.bind(this))
    this.element.addEventListener("dragleave", this.onDragLeave.bind(this))
  }

  detach() {
    this.element.parentNode.removeChild(this.element)
  }
  
  attach(parent:HTMLElement) {
    console.assert(!this.element.parentNode)
    parent.appendChild(this.element)
  }

  private onDragStart(e:DragEvent) {
    console.debug("Drag start " + e.clientX + "," + e.clientY)
    e.dataTransfer.setData("application/json", JSON.stringify(this.wcard.serialize()))
  }
    
  private onDrag(e:DragEvent) {
  }
    
  private onDragEnd(e:DragEvent) {
    console.debug("Drag end " + e.clientX + ","  +e.clientY)
  }
  
  private onDragEnter(e:DragEvent) {
    this.element.classList.add("dragged-over")
    e.preventDefault()
  }

  private onDragLeave(e:DragEvent) {
    this.element.classList.remove("dragged-over")
    e.preventDefault()
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

class Card {
  readonly suit:number
  readonly rank:number
  readonly id:string
    
  constructor(rank:number, suit:number, id:string) {
    this.suit = suit
    this.rank = rank
    this.id = id
  }

  serialize():any {
    return {
      suit: this.suit,
      rank: this.rank,
      id: this.id
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
  private slots:Slot[]

  constructor(slots:Slot[]) {
    this.slots = slots
  }

  slot(id:string):Slot {
    const result = this.slots.find(s => s.id == id)
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
  
  card(id:string):WorldCard {
    for (const slot of this.slots) {
      const w = slot.cardById(id)
      if (w)
        return w
    }
    throw new Error(`No such card ${id}`)
  }
  
  slotsUpdate(slots:Slot[]):Playfield {
    assert(slots.every(slot => this.slots.find(s => s.id == slot.id)))
    return new Playfield(this.slots.filter(s => !slots.some(slot => slot.id == s.id)).concat(slots))
  }
}

class App {
  readonly notifierSlot:NotifierSlot
  private playfield:Playfield

  constructor(playfield:Playfield, notifierSlot:NotifierSlot) {
    this.playfield = playfield
    this.notifierSlot = notifierSlot
  }

  playfieldGet():Playfield {
    return this.playfield
  }
  
  playfieldMutate(playfield:Playfield):Playfield {
    this.playfield = playfield
    return playfield
  }
}

function run(urlCardImages:string, urlCardBack:string) {
  let playfield = new Playfield(
    [new Slot("p0"),
     new Slot("p1"),
     new Slot("stock"),
     new Slot("waste")]
  )

  const notifierSlot = new NotifierSlot()
  const app = new App(playfield, notifierSlot)
  
  const deck = shuffled(deck52())
  const root = new UISlotRoot()
  const uislotP1 = new UISlotFullWidth('p1', app, '112px')
  uislotP1.init()
  root.add(uislotP1)
  const uislotWaste = new UISlotFullWidth('waste', app, 112*1.5+'px','75%')
  uislotWaste.init()
  root.add(uislotWaste)
  const uislotStock = new UISlotSingle('stock', app, 112*1.5+'px','25%')
  uislotStock.init()
  root.add(uislotStock)
  const uislotP0 = new UISlotFullWidth('p0', app, '112px')
  uislotP0.init()
  root.add(uislotP0)

  notifierSlot.events["p0"] = new EventTarget()
  notifierSlot.events["p0"].addEventListener(
    "slotchange",
    e => { uislotP0.change(urlCardImages, urlCardBack, e.old, e.slot) }
  )

  notifierSlot.events["p1"] = new EventTarget()
  notifierSlot.events["p1"].addEventListener(
    "slotchange",
    e => { uislotP1.change(urlCardImages, urlCardBack, e.old, e.slot) }
  )

  notifierSlot.events["stock"] = new EventTarget()
  notifierSlot.events["stock"].addEventListener(
    "slotchange",
    e => { uislotStock.change(urlCardImages, urlCardBack, e.old, e.slot) }
  )
  
  notifierSlot.events["waste"] = new EventTarget()
  notifierSlot.events["waste"].addEventListener(
    "slotchange",
    e => { uislotWaste.change(urlCardImages, urlCardBack, e.old, e.slot) }
  )
  
  let sold = playfield.slot("p0")
  let snew = sold.add(deck.slice(0,10).map(c => new WorldCard(c, true)))
  playfield = playfield.slotsUpdate([snew])
  notifierSlot.events[sold.id].dispatchEvent(new EventSlotChange(sold, snew))

  sold = playfield.slot("p1")
  snew = sold.add(deck.slice(10,20).map(c => new WorldCard(c, false)))
  playfield = playfield.slotsUpdate([snew])
  notifierSlot.events[sold.id].dispatchEvent(new EventSlotChange(sold, snew))

  sold = playfield.slot("stock")
  snew = sold.add(deck.slice(20).map(c => new WorldCard(c, false)))
  playfield = playfield.slotsUpdate([snew])
  notifierSlot.events[sold.id].dispatchEvent(new EventSlotChange(sold, snew))

  app.playfieldMutate(playfield)

  uislotStock.element.addEventListener(
    "click",
    e => {
      let sold = playfield.slot("stock")
      if (!sold.empty()) {
        let top = sold.top()
        let snew = sold.remove([top])
        let playfield = app.playfieldGet().slotsUpdate([snew])
        notifierSlot.events[sold.id].dispatchEvent(new EventSlotChange(sold, snew))
      
        sold = playfield.slot("waste")
        snew = sold.add([top])
        playfield = playfield.slotsUpdate([snew])
        notifierSlot.events[sold.id].dispatchEvent(new EventSlotChange(sold, snew))
        app.playfieldMutate(playfield)
      }
    }
  )
}

document.addEventListener("deviceready", () => {
  run("img/cards.svg", "img/back.svg")
})
