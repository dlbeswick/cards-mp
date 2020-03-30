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

  [Symbol.iterator]():Iterator<WorldCard> {
    return this.cards[Symbol.iterator]()
  }
}

class UISlotRoot {
  add(child:UISlot):void {
    document.body.appendChild(child.element)
  }
}

interface UISlot {
  readonly element:HTMLElement
  change(urlImage:string, urlBack:string, slotOld:Slot, slot:Slot):void
}

class UISlotSingle implements UISlot {
  readonly element:HTMLElement
  
  constructor(height:string,width='100%') {
    this.element = document.createElement("div")
    this.element.setAttribute("style", `display: inline-block; width: ${width}; height: ${height}; border: 1px black`)
  }

  change(urlImage:string, urlBack:string, slotOld:Slot, slot:Slot):void {
    this.element.innerHTML = ''
    if (!slot.empty())
      this.element.appendChild(new UICard(urlImage, urlBack, slot.top()).element)
  }
}

class UISlotFullWidth implements UISlot {
  readonly element:HTMLElement
  constructor(height:string, width='100%') {
    this.element = document.createElement("div")
    this.element.setAttribute("style", `display: inline-block; width: ${width}; height: ${height}; border: 1px black`)
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
    this.element.addEventListener("ondragstart", this.onDragStart.bind(this))
    this.element.addEventListener("ondrag", this.onDrag.bind(this))
    this.element.addEventListener("ondragend", this.onDragEnd.bind(this))
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
  }
  private onDrag(e:DragEvent) {
    console.debug("Dragging " + e.clientX + "," + e.clientY)
  }
  private onDragEnd(e:DragEvent) {
    console.debug("Drag end " + e.clientX + ","  +e.clientY)
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
    
  constructor(rank:number, suit:number) {
    this.suit = suit
    this.rank = rank
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
}

function deck52() {
  const result:Card[] = []
  
  for (let suit = 0; suit < 4; ++suit) {
    for (let rank = 0; rank < 12; ++rank) {
      result.push(new Card(rank, suit))
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
    super('onslotchange')
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
  
  updateSlot(slot:Slot):Playfield {
    assert(this.slots.find(s => s.id == slot.id))
    const result = new Playfield(this.slots.filter(s => s.id != slot.id).concat([slot]))
    return result
  }
}

function run(urlCardImages:string, urlCardBack:string) {
  const deck = shuffled(deck52())
  const root = new UISlotRoot()
  const uislotP1 = new UISlotFullWidth('112px')
  root.add(uislotP1)
  const uislotWaste = new UISlotFullWidth(112*1.5+'px','75%')
  root.add(uislotWaste)
  const uislotStock = new UISlotSingle(112*1.5+'px','25%')
  root.add(uislotStock)
  const uislot = new UISlotFullWidth('112px')
  root.add(uislot)

  const notifierSlot = new NotifierSlot()
  notifierSlot.events["hand-p0"] = new EventTarget()
  notifierSlot.events["hand-p0"].addEventListener(
    "onslotchange",
    e => { uislot.change(urlCardImages, urlCardBack, e.old, e.slot) }
  )

  notifierSlot.events["hand-p1"] = new EventTarget()
  notifierSlot.events["hand-p1"].addEventListener(
    "onslotchange",
    e => { uislotP1.change(urlCardImages, urlCardBack, e.old, e.slot) }
  )

  notifierSlot.events["stock"] = new EventTarget()
  notifierSlot.events["stock"].addEventListener(
    "onslotchange",
    e => { uislotStock.change(urlCardImages, urlCardBack, e.old, e.slot) }
  )
  
  notifierSlot.events["waste"] = new EventTarget()
  notifierSlot.events["waste"].addEventListener(
    "onslotchange",
    e => { uislotWaste.change(urlCardImages, urlCardBack, e.old, e.slot) }
  )
  
  let playfield = new Playfield(
    [new Slot("hand-p0"),
     new Slot("hand-p1"),
     new Slot("stock"),
     new Slot("waste")]
  )
  
  let sold = playfield.slot("hand-p0")
  let snew = sold.add(deck.slice(0,10).map(c => new WorldCard(c, true)))
  playfield = playfield.updateSlot(snew)
  notifierSlot.events[sold.id].dispatchEvent(new EventSlotChange(sold, snew))

  sold = playfield.slot("hand-p1")
  snew = sold.add(deck.slice(10,20).map(c => new WorldCard(c, false)))
  playfield = playfield.updateSlot(snew)
  notifierSlot.events[sold.id].dispatchEvent(new EventSlotChange(sold, snew))

  sold = playfield.slot("stock")
  snew = sold.add(deck.slice(20).map(c => new WorldCard(c, false)))
  playfield = playfield.updateSlot(snew)
  notifierSlot.events[sold.id].dispatchEvent(new EventSlotChange(sold, snew))

  let p = [playfield]
  
  uislotStock.element.addEventListener(
    "onclick",
    e => {
      let sold = playfield.slot("stock")
      if (!sold.empty()) {
        let top = sold.top()
        let snew = sold.remove([top])
        let playfield = p[0].updateSlot(snew)
        notifierSlot.events[sold.id].dispatchEvent(new EventSlotChange(sold, snew))
      
        sold = playfield.slot("waste")
        snew = sold.add([top])
        playfield = playfield.updateSlot(snew)
        notifierSlot.events[sold.id].dispatchEvent(new EventSlotChange(sold, snew))
        p[0] = playfield
      }
    }
  )
}

document.addEventListener("deviceready", () => {
  run("img/cards.svg", "img/back.svg")
})
