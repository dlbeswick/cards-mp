const CARD_WIDTH = 74
const CARD_HEIGHT = 112
type SlotUpdate = [Slot|undefined, Slot]

function demandElementByIdTyped<T extends HTMLElement>(id:string, klass:new() => T):T {
  const result = document.getElementById(id)
  if (result == undefined) {
    throw new Error(`Element '${id}' not found`)
  } else if (!(result instanceof klass)) {
    throw new Error(`Element '${id}' is not '${klass}', but is '${result.constructor.name}'`)
  } else {
    return result
  }
}

function demandElementById(id:string) {
  return demandElementByIdTyped(id, HTMLElement)
}

function errorHandler(message, source?, lineno?, colno?, error?, showAlert=true) {
  if (showAlert)
    alert(message)
  demandElementById("error").style.display = "block"
  demandElementById("error").innerHTML = message + "<br/>" + "Line: " + lineno + "<br/>" + source
  return true
}

function assert(test:() => any, message=test.toString(), ...args) {
  if (!test()) {
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

class ContainerSlot extends Identified<ContainerSlot> implements Iterable<Slot> {
  private readonly slots:Slot[] = []
  
  constructor(id:string, slots:Slot[] = [new Slot(Date.now(), id)]) {
    super(id)
    this.slots = slots
  }

  static fromSerialized(s:any):ContainerSlot {
    return new ContainerSlot(s.id, s.slots.map(sl => Slot.fromSerialized(sl)))
  }

  serialize():any {
    return { ...super.serialize(), slots: this.slots.map(s => s.serialize()) }
  }

  first():Slot {
    assert(() => this.slots)
    return this.slots[0]
  }
  
  add(slots:Slot[]):ContainerSlot {
    return new ContainerSlot(this.id, this.slots.concat(slots))
  }

  slot(id:number):Slot {
    const slot = this.slots.find(s => s.isId(id))
    assert(() => slot)
    return slot as Slot
  }
  
  clear():ContainerSlot {
    return new ContainerSlot(this.id)
  }
  
  isEmpty():boolean {
    return this.slots.every(s => s.isEmpty())
  }
  
  hasSlot(id:number, idCnt:string):boolean {
    return this.isId(idCnt) && this.slots.some(s => s.isId(id))
  }
  
  hasCard(wcard:WorldCard):boolean {
    return this.slots.some(s => s.hasCard(wcard))
  }
  
  cardById(idCard:string):WorldCard|undefined {
    for (const s of this.slots) {
      const result = s.cardById(idCard)
      if (result)
        return result
    }
    return undefined
  }

  slotForCard(wcard:WorldCard):Slot|undefined {
    return this.slots.find(s => s.hasCard(wcard))
  }
  
  lengthSlots():number {
    return this.slots.length
  }
  
  length():number {
    return this.slots.reduce((a, s) => a + s.length(), 0)
  }
  
  map(f: (c: WorldCard) => WorldCard):SlotUpdate[] {
    return this.slots.map(s => [s, s.map(f)])
  }

  update(update:SlotUpdate):ContainerSlot {
    const [slot, slot_] = update

    if (this.isId(slot_.idCnt)) {
      if (slot) {
        const idx = this.slots.findIndex(s => s.is(slot))
        assert(() => idx != -1)
        return new ContainerSlot(this.id, this.slots.slice(0, idx).concat([slot_]).concat(this.slots.slice(idx+1)))
      } else {
        return new ContainerSlot(this.id, this.slots.concat([slot_]))
      }
    } else {
      return this
    }
  }
  
  [Symbol.iterator]():Iterator<Slot> {
    return this.slots[Symbol.iterator]()
  }
}

class Slot extends Identified<Slot, number> implements Iterable<WorldCard> {
  // Note: only unique within a container
  readonly id:number
  readonly idCnt:string
  private cards:WorldCard[]

  constructor(id:number, idCnt:string, cards:WorldCard[] = []) {
    super(id)
    this.cards = cards
    this.idCnt = idCnt
  }

  static fromSerialized(serialized:any) {
    return new Slot(serialized.id, serialized.idCnt, serialized.cards.map(c => WorldCard.fromSerialized(c)))
  }

  serialize() {
    assert(() => this.container)
    return { ...super.serialize(), cards: this.cards.map(c => c.serialize()), idCnt: this.idCnt }
  }
  
  container(playfield:Playfield):Slot {
    return playfield.container(this.idCnt).slot(this.id)
  }
  
  add(wcards:WorldCard[], before?:Card):Slot {
    const idx = (() => {
      if (before) {
        const result = this.cards.findIndex(c => c.card.is(before))
        assert(() => result != -1)
        return result
      } else {
        return this.cards.length
      }
    })()
    
    assert(() => wcards.every(wc => !this.cards.includes(wc)))
    assert(() => idx >= 0 && idx <= this.cards.length)
    return new Slot(this.id, this.idCnt, this.cards.slice(0, idx).concat(wcards).concat(this.cards.slice(idx)))
  }

  remove(wcards:WorldCard[]):Slot {
    assert(() => wcards.every(wc => this.cards.some(wc2 => wc.card.is(wc2.card))))
    return new Slot(this.id, this.idCnt, this.cards.filter(wc => !wcards.some(wc2 => wc.card.is(wc2.card))))
  }

  replace(wcard:WorldCard, wcard_:WorldCard):Slot {
    const idx = this.cards.findIndex(c => c.card.is(wcard.card))
    assert(() => idx != -1)
    return new Slot(this.id, this.idCnt, this.cards.slice(0, idx).concat([wcard_]).concat(this.cards.slice(idx+1)))
  }

  top():WorldCard {
    assert(() => !this.isEmpty())
    return this.cards[this.cards.length-1]
  }

  isEmpty():boolean {
    return this.cards.length == 0
  }

  card(idx:number) {
    assert(() => idx >= 0 && idx < this.cards.length)
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
    return new Slot(this.id, this.idCnt, this.cards.map(f))
  }
  
  [Symbol.iterator]():Iterator<WorldCard> {
    return this.cards[Symbol.iterator]()
  }
}

class UISlotRoot {
  readonly element:HTMLElement
  
  constructor(element:HTMLElement) {
    this.element = element
  }
  
  add(child:UIActionable):void {
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

abstract class UIActionable {
  readonly idCnt:string
  readonly element:HTMLElement
  protected readonly app:App
  protected readonly owner:Player|null
  protected readonly viewer:Player
  
  constructor(element:HTMLElement, idCnt:string, app:App, owner:Player|null, viewer:Player) {
    this.idCnt = idCnt
    this.element = element
    this.app = app
    this.owner = owner
    this.viewer = viewer

    this.element.classList.add("slot")
  }

  init():void {
    this.element.addEventListener("click", this.onClick.bind(this))
  }

  protected abstract onAction(selected:UICard):void

  container(playfield:Playfield):ContainerSlot {
    return playfield.container(this.idCnt)
  }
  
  isViewableBy(viewer:Player) {
    return this.owner == null || viewer == this.owner
  }
  
  onClick(e:MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (this.app.selected) {
      this.onAction(this.app.selected)
      this.app.selected.element.classList.remove("selected")
      this.app.selected = null
    }
  }
}

abstract class UISlot extends UIActionable {
  idSlot:number
  readonly actionLongPress:string
  
  constructor(element:HTMLElement, idCnt:string, app:App, owner:Player|null, viewer:Player, idSlot?:number,
              actionLongPress='flip') {
    super(element, idCnt, app, owner, viewer)
    this.actionLongPress = actionLongPress
    if (idSlot === undefined)
      this.idSlot = app.playfieldGet().container(idCnt).first().id
    else
      this.idSlot = idSlot

    // Should be 'new EventTarget()', but iOS doesn't support that.
    this.app.notifierSlot.slot(this.idCnt, this.idSlot).addEventListener(
      "slotchange",
      (e:EventSlotChange) => {
        this.change(e.slot(), e.slot_())
      }
    )
  }

  abstract change(slot:Slot|undefined, slot_:Slot):void
  
  slot(playfield:Playfield):Slot {
    return this.container(playfield).slot(this.idSlot)
  }
  
  protected doMove(idCard:string) {
    const cardSrc = this.app.playfieldGet().wcard(idCard)
    const slotSrc = this.app.playfieldGet().slotForCard(cardSrc)
    const slotDst = this.slot(this.app.playfieldGet())
    if (slotSrc === slotDst) {
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

  protected onAction(selected:UICard) {
    this.doMove(selected.wcard.card.id)
  }
}

class UISlotSingle extends UISlot {
  readonly count:HTMLElement
  private readonly height:string
  private cards:HTMLElement
  
  constructor(idCnt:string, app:App, owner:Player|null, viewer:Player, height:string, idSlot?:number,
              actionLongPress='flip') {
    super(document.createElement("div"), idCnt, app, owner, viewer, idSlot, actionLongPress)
    this.element.classList.add("slot-single")
    this.element.style.width = CARD_WIDTH.toString()
    this.count = document.createElement("label")
    this.element.appendChild(this.count)
    this.height = height
    
    this.cards = this.makeCardsDiv(this.height)
    this.element.appendChild(this.cards)
  }

  change(slot:Slot|undefined, slot_:Slot):void {
    const cards = this.makeCardsDiv(this.height)
    if (!slot_.isEmpty())
      cards.appendChild(new UICard(slot_.top(), this, this.app, false, this.viewer).element)
    this.cards.replaceWith(cards)
    this.cards = cards
    this.count.innerText = slot_.length().toString()
  }

  private makeCardsDiv(height):HTMLElement {
    const result = document.createElement("div")
    result.style.minHeight = height
    return result
  }
}

class UISlotSpread extends UISlot {
  private classesCard:string[]
  private containerEl:HTMLElement
  
  constructor(idCnt:string, app:App, owner:Player|null, viewer:Player, idSlot?:number,
              minHeight:string=`${CARD_HEIGHT}px`, width?:string, classesSlot:string[]=['slot'],
              classesCard:string[]=['card'], actionLongPress='flip') {
    
    super(document.createElement("div"), idCnt, app, owner, viewer, idSlot, actionLongPress)
    this.classesCard = classesCard
    if (width)
      this.element.style.width = width
    this.element.style.minHeight = minHeight
    this.element.classList.add(...classesSlot)
    this.containerEl = document.createElement("div")
    this.element.appendChild(this.containerEl)
  }

  change(slot:Slot|undefined, slot_:Slot):void {
    const container = this.containerEl.cloneNode(false) as HTMLElement
    let zIndex = 0
    for (const wcard of slot_) {
      const uicard = new UICard(wcard, this, this.app, true, this.viewer, this.classesCard)
      uicard.element.style.zIndex = (zIndex++).toString()
      container.appendChild(uicard.element)
    }
    this.containerEl.replaceWith(container)
    this.containerEl = container
  }
}

abstract class UIContainer extends UIActionable {
  constructor(element:HTMLElement, idCnt:string, app:App, owner:Player|null, viewer:Player) {
    super(element, idCnt, app, owner, viewer)
    
    // Should be 'new EventTarget()', but iOS doesn't support that.
    this.app.notifierSlot.container(this.idCnt).addEventListener(
      "containerchange",
      (e:EventContainerChange) => {
        this.change(e.container(), e.container_(), e.updates)
      }
    )
  }

  abstract change(cnt:ContainerSlot, cnt_:ContainerSlot, updates:SlotUpdate[]):void
}

class UIContainerMulti extends UIContainer {
  private children:UISlot[] = []
  private actionLongPress:string
  
  constructor(idSlot:string, app:App, owner:Player|null, viewer:Player, height:string=`${CARD_HEIGHT}px`,
              actionLongPress='flip') {
    super(document.createElement("div"), idSlot, app, owner, viewer)
    
    this.element.style.minHeight = height
    this.actionLongPress = actionLongPress
  }

  onAction(selected:UICard) {
    const cardSrc = selected.wcard
    const slotSrc = this.app.playfieldGet().slotForCard(cardSrc)
    const slotSrc_ = slotSrc.remove([cardSrc])
    const cnt:ContainerSlot = this.container(this.app.playfieldGet())
    const slotDst_ = new Slot(Date.now(), cnt.id, [cardSrc])
    
    this.app.playfieldMutate(
      this.app.playfieldGet().slotsUpdate([[slotSrc, slotSrc_], [undefined, slotDst_]], this.app)
    )
  }
  
  change(cnt:ContainerSlot, cnt_:ContainerSlot, updates:SlotUpdate[]):void {
    // Deletes not handled for now
    assert(() => Array.from(cnt).every(c => Array.from(cnt_).some(c_ => c.is(c_))))

    for (const [slot, slot_] of updates) {
      if (!this.children.some(uislot => slot_.isId(uislot.idSlot))) {
        const uislot = new UISlotSpread(
          cnt.id, this.app, this.owner, this.viewer, slot_.id, `${CARD_HEIGHT}px`, `${CARD_WIDTH}px`,
          ['slot', 'slot-overlap-vert'], ['card', 'card-overlap-vert'], this.actionLongPress
        )

        uislot.init()
        uislot.change(slot, slot_)
        this.element.appendChild(uislot.element)
        this.children.push(uislot)
      }
    }
  }
}

class UICard {
  readonly wcard:WorldCard
  readonly element:HTMLElement
  readonly uislot:UISlot
  private readonly app:App
  private timerPress:number|null = null
  private touchYStart = 0
  private readonly dropTarget:boolean
  
  constructor(wcard:WorldCard, uislot:UISlot, app:App, dropTarget:boolean, viewer:Player,
              classesCard=["card"]) {
    this.dropTarget = dropTarget
    this.app = app
    this.wcard = wcard
    this.uislot = uislot
    
    this.element = document.createElement("div")
    this.element.classList.add(...classesCard)

    const svg = document.createElement("img")
    if (wcard.faceUp && (this.uislot.isViewableBy(viewer) || wcard.faceUpIsConscious)) {
      svg.setAttribute('src', app.urlCardImages + '#c' + wcard.card.suit + '_' + wcard.card.rank)
    } else {
      svg.setAttribute('src', app.urlCardBack)
    }

    if (wcard.turned) {
      this.element.classList.add('turned')
    }
    
    svg.setAttribute('width', CARD_WIDTH.toString())
    svg.setAttribute('height', CARD_HEIGHT.toString())

    this.element.appendChild(svg)
    
    function lpMouseUp(self, e) {
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

    // Stop slots acting on mouse events that this element has acted on.
    this.element.addEventListener("click", (e) => {
      if (this.dropTarget || !this.app.selected || this.app.selected == this) {
        e.preventDefault()
        e.stopPropagation()
      }
    })

    // Stop press-on-image context menu on mobile browsers.
    this.element.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); })
  }

  detach() {
    this.element.parentNode?.removeChild(this.element)
  }
  
  attach(parent:HTMLElement) {
    console.assert(() => !this.element.parentNode)
    parent.appendChild(this.element)
  }

  private onLongPress() {
    if (this.uislot.actionLongPress == 'flip') {
      this.flip()
    } else {
      this.turn()
    }
  }
  
  private onClick() {
    if (this.app.selected) {
      if (this.dropTarget) {
        this.app.selected.element.classList.remove("selected")
        this.doMove(this.app.selected.wcard)
        this.app.selected = null
      }
    } else {
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
  
  private turn() {
    const slot = this.uislot.slot(this.app.playfieldGet())
    const slot_ = slot.replace(this.wcard, this.wcard.withTurned(!this.wcard.turned))
    this.app.playfieldMutate(
      this.app.playfieldGet().slotsUpdate([[slot, slot_]], this.app)
    )
  }
  
  private doMove(cardSrc:WorldCard) {
    if (!cardSrc.card.is(this.wcard.card)) {
      const slotSrc = this.app.playfieldGet().slotForCard(cardSrc)
      const slotDst = this.uislot.slot(this.app.playfieldGet())

      if (slotSrc === slotDst) {
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
  readonly turned:boolean

  constructor(card:Card, faceUp:boolean, faceUpIsConscious=false, turned=false) {
    this.card = card
    this.faceUp = faceUp
    this.faceUpIsConscious = faceUpIsConscious
    this.turned = turned
  }

  static fromSerialized(serialized:any) {
    return new WorldCard(Card.fromSerialized(serialized.card), serialized.faceUp, serialized.faceUpIsConscious,
                        serialized.turned)
  }
  
  withFaceUp(faceUp:boolean) {
    return new WorldCard(this.card, faceUp, this.faceUpIsConscious, this.turned)
  }

  withFaceStateConscious(faceUp:boolean, conscious:boolean) {
    return new WorldCard(this.card, faceUp, conscious, this.turned)
  }
  
  withTurned(turned:boolean) {
    return new WorldCard(this.card, this.faceUp, this.faceUpIsConscious, turned)
  }
  
  serialize():any {
    return {
      card: this.card.serialize(),
      faceUp: this.faceUp,
      faceUpIsConscious: this.faceUpIsConscious,
      turned: this.turned
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
    default: throw new Error("Unknown suit " + c.suit)
  }
}

function sortedByAltColorAndRank(deck:Card[]):Card[] {
  const result = [...deck]
  result.sort((a, b) => orderColorAlternate(a) - orderColorAlternate(b) || a.rank - b.rank)
  return result
}

class EventSlotChange extends Event {
  readonly playfield:Playfield
  readonly playfield_:Playfield
  readonly idCnt:string
  readonly idSlot:number
  
  constructor(playfield:Playfield, playfield_:Playfield, idCnt:string, idSlot:number) {
    super('slotchange')
    this.playfield = playfield
    this.playfield_ = playfield_
    this.idCnt = idCnt
    this.idSlot = idSlot
  }

  container() { return this.playfield.container(this.idCnt) }
  container_() { return this.playfield_.container(this.idCnt) }
  slot():Slot|undefined {
    if (this.container().hasSlot(this.idSlot, this.idCnt))
      return this.container().slot(this.idSlot)
    else
      return undefined
  }
  slot_() { return this.container_().slot(this.idSlot) }
}

class EventContainerChange extends Event {
  readonly playfield:Playfield
  readonly playfield_:Playfield
  readonly updates:SlotUpdate[]
  readonly idCnt:string
  
  constructor(playfield:Playfield, playfield_:Playfield, idCnt:string, updates:SlotUpdate[]) {
    super('containerchange')
    this.playfield = playfield
    this.playfield_ = playfield_
    this.updates = updates
    this.idCnt = idCnt
  }

  container() { return this.playfield.container(this.idCnt) }
  container_() { return this.playfield_.container(this.idCnt) }
}

class EventPingBack extends Event {
  secs:number
  
  constructor(secs:number) {
    super('pingback')
    this.secs = secs
  }
}

class NotifierSlot {
  private readonly events:Map<string, EventTarget> = new Map()

  container(idCnt:string) {
    let result = this.events.get(idCnt)
    if (!result) {
      result = document.createElement('div')
      this.events.set(idCnt, result)
    }
    return result
  }

  slot(idCnt:string, idSlot:number) {
    const key = idCnt + "-" + idSlot
    let result = this.events.get(key)
    if (!result) {
      result = document.createElement('div')
      this.events.set(key, result)
    }
    return result
  }
}

class Playfield {
  readonly containers:ContainerSlot[]

  constructor(containers:ContainerSlot[]) {
    this.containers = containers
  }

  static fromSerialized(serialized:any):Playfield {
    return new Playfield(serialized.containers.map(s => ContainerSlot.fromSerialized(s)))
  }
  
  serialize():any {
    return { containers: this.containers.map(s => s.serialize()) }
  }
  
  container(id:string):ContainerSlot {
    const cnt = this.containers.find(c => c.isId(id))
    assert(() => cnt)
    return cnt as ContainerSlot
  }

  slotForCard(wcard:WorldCard):Slot {
    for (const cnt of this.containers) {
      const result = cnt.slotForCard(wcard)
      if (result)
        return result
    }
    throw new Error(`Card ${wcard.card.id} is not in a slot`)
  }
  
  wcard(id:string):WorldCard {
    for (const cnt of this.containers) {
      const w = cnt.cardById(id)
      if (w)
        return w
    }
    throw new Error(`No such card ${id}`)
  }
  
  slotsUpdate(updates:SlotUpdate[], app:App, send=true):Playfield {
    assert(() => updates.every(([slot, slot_]) => (slot == undefined || slot.idCnt == slot_.idCnt)))
    
    if (send) {
      app.send({slotUpdates: updates.map(([s, s_]) => [s?.serialize(), s_.serialize()])})
    }
    
    let containers_ = this.containers
    for (let update of updates) {
      containers_ = containers_.map(cnt => cnt.update(update))
    }
    const playfield_ = new Playfield(containers_)

    const cntChanged:Map<string, SlotUpdate[]> = new Map()
    for (const update of updates) {
      const [slot, slot_] = update
      
      if (!cntChanged.has(slot_.idCnt)) {
        cntChanged.set(slot_.idCnt, [])
      }
      (cntChanged.get(slot_.idCnt) as SlotUpdate[]).push(update)

      app.notifierSlot.slot(slot_.idCnt, slot_.id).dispatchEvent(
        new EventSlotChange(app.playfieldGet(), playfield_, slot_.idCnt, slot_.id)
      )
    }

    for (const [idCnt, updates] of cntChanged) {
      app.notifierSlot.container(idCnt).dispatchEvent(
        new EventContainerChange(app.playfieldGet(), playfield_, idCnt, updates)
      )
    }
    
    return playfield_
  }
}

declare var Peer

class App {
  peer:any
  peerConn:any
  selected:UICard|null = null
  readonly notifierSlot:NotifierSlot
  readonly urlCardImages:string
  readonly urlCardBack:string
  readonly root:UISlotRoot
  private viewer:Player
  private playfield:Playfield = new Playfield([])
  private players:Player[]
  private games:Game[]
  private game:Game
  
  constructor(games:Game[], notifierSlot:NotifierSlot, urlCardImages:string, urlCardBack:string, viewer:Player,
              players:Player[], root:UISlotRoot) {
    assert(() => games)
    this.games = games
    this.game = games[0]
    this.notifierSlot = notifierSlot
    this.urlCardImages = urlCardImages
    this.urlCardBack = urlCardBack
    this.viewer = viewer
    this.players = players
    this.root = root
  }

  init(gameId:string) {
    this.newGame(gameId)
  }
  
  playfieldGet():Playfield {
    return this.playfield
  }
  
  playfieldMutate(playfield:Playfield):Playfield {
    this.playfield = playfield
    return playfield
  }

  send(data:any) {
    if (this.peerConn) {
      this.peerConn.send(data)
    }
  }
  
  newGame(idGame:string, playfield?:Playfield) {
    const game = this.games.find(g => g.id == idGame)
    if (!game) {
      throw new Error("No such game " + idGame)
    }

    this.game = game
    if (playfield)
      this.playfieldMutate(playfield)
    else
      this.playfieldMutate(this.game.playfield())
    
    this.viewerSet(this.viewer)
  }

  viewerSet(viewer:Player) {
    assert(() => this.game)
    this.viewer = viewer

    this.root.clear()
    this.game.makeUI(this)
    demandElementById("player").innerText = this.viewer.name

    for (const cnt of this.playfield.containers) {
      for (const slot of cnt) {
        this.notifierSlot.slot(cnt.id, slot.id).dispatchEvent(
          new EventSlotChange(this.playfield, this.playfield, cnt.id, slot.id)
        )
      }
      this.notifierSlot.container(cnt.id).dispatchEvent(
        new EventContainerChange(this.playfield, this.playfield, cnt.id, Array.from(cnt).map(s => [s,s]))
      )
    }
  }

  viewerGet() {
    return this.viewer
  }

  playersGet() {
    return this.players
  }

  gameGet() {
    return this.game
  }
}

function host(app:App) {
  if (app.peer) {
    return
  }
  
  const id = (demandElementByIdTyped("peerjs-id", HTMLInputElement)).value.toLowerCase()
  if (!id) {
    throw new Error("Id not given")
  }
  
  let peer = new Peer("mpcard-"+id)
  console.log("Registering as " + id)
  
  peer.on('open', function(id) {
    app.peer = peer
    app.peer.on('error', function(err) {
      app.peer = null
      demandElementById("peerjs-status").innerHTML = "Unregistered"
    })
    
    demandElementById("peerjs-status").innerHTML = "Registered"

    peer.on('connection', function(conn) {
      console.debug("Peer connected to us")

      function receive(data) {
        console.log('Received', data)

        if (data.ping) {
          demandElementById("connect-status").dispatchEvent(new EventPingBack(data.ping.secs))
          app.send({ping_back: {secs: data.ping.secs}})
        } else if (data.ping_back) {
          demandElementById("connect-status").dispatchEvent(new EventPingBack(data.ping_back.secs))
        } else if (data.sync) {
          app.newGame(data.sync.game, Playfield.fromSerialized(data.sync.playfield))
        } else if (data.slotUpdates) {
          let updates:SlotUpdate[]
          let slots:Slot[]
          
          updates = data.slotUpdates.map(
            ([s,s_]) => {
              if (s)
                return [Slot.fromSerialized(s), Slot.fromSerialized(s_)]
              else
                return [undefined, Slot.fromSerialized(s_)]
            })
          
          app.playfieldMutate(app.playfieldGet().slotsUpdate(updates, app, false))
        } else {
          console.debug("Unknown message", data)
        }
      }
      
      // Receive messages
      conn.on('data', receive);
    })
  })

  peer.on('error', function(err) { throw new Error("PeerJS: " + err) })
}

function connect(app:App) {
  if (app.peer) {
    const idPeer = (demandElementByIdTyped("peerjs-target", HTMLInputElement)).value.toLowerCase()

    if (!idPeer) {
      throw new Error("Peer's id not given")
    }
    
    console.log("Attempting connection to " + idPeer)
    const conn = app.peer.connect("mpcard-"+idPeer)
    conn.on('open', function() {
      console.debug("Peer opened")
      demandElementById("connect-status").innerHTML = "Waiting for reply"
      app.peerConn = conn
      function ping(secs) {
        conn.send({ping: {secs: secs}})
        window.setTimeout(() => ping(secs+30), 30000)
      }
      ping(0)
      sync(app)
    });
    conn.on('error', function(err) {
      app.peerConn = null
      demandElementById("connect-status").innerHTML = "Disconnected"
      throw new Error(`Connection to ${idPeer}: ${err}`)
    })
  }
}

function sync(app:App) {
  app.send({sync: {game: app.gameGet().id, playfield: app.playfieldGet().serialize()}})
}

function revealAll(app:App) {
  const updates:SlotUpdate[] = app.playfieldGet().containers.flatMap(
    cnt => cnt.map(wc => wc.withFaceStateConscious(true, true))
  )
  
  app.playfieldMutate(app.playfieldGet().slotsUpdate(updates, app))
}

abstract class Game extends Identified<Game> {
  abstract playfield():Playfield
  abstract makeUI(app:App)
}

class GameGinRummy extends Game {
  constructor() {
    super("gin-rummy")
  }
  
  playfield():Playfield {
    const deck = shuffled(deck52())
    return new Playfield(
      [new ContainerSlot("p0", [new Slot(Date.now(), "p0",
                                         sortedByAltColorAndRank(deck.slice(0,10)).map(c => new WorldCard(c, true)))]),
       new ContainerSlot("p1", [new Slot(Date.now(), "p1",
                                         sortedByAltColorAndRank(deck.slice(10,20)).map(c => new WorldCard(c, true)))]),
       new ContainerSlot("waste"),
       new ContainerSlot("stock", [new Slot(Date.now(), "stock",
                                            deck.slice(20).map(c => new WorldCard(c, false)))])]
    )
  }
  
  makeUI(app:App) {
    const viewer = app.viewerGet()
    const opponent = app.playersGet().find(p => p != viewer) as Player
    assert(() => opponent)
    const root = app.root
    
    const uislotTop = new UISlotSpread(opponent.idSlot, app, opponent, viewer, undefined, `${CARD_HEIGHT}px`, '100%')
    uislotTop.init()
    root.add(uislotTop)

    // Refactor as UI element...
    const divPlay = document.createElement("div")
    divPlay.style.display = 'flex'
    
    const uislotWaste = new UISlotSpread('waste', app, null, viewer, undefined, CARD_HEIGHT*1.5+'px', '100%',
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
    const uislotStock = new UISlotSingle('stock', app, null, viewer, '', undefined)
    uislotStock.init()
    divStock.appendChild(uislotStock.element)
    divPlay.appendChild(divStock)

    root.element.appendChild(divPlay)
    
    const uislotBottom = new UISlotSpread(viewer.idSlot, app, viewer, viewer, undefined, `${CARD_HEIGHT}px`, '100%')
    uislotBottom.init()
    root.add(uislotBottom)
  }
}

class GameDummy extends Game {
  constructor() {
    super("dummy")
  }
  
  playfield():Playfield {
    const deck = shuffled(deck52())
    return new Playfield(
      [new ContainerSlot("p0", [new Slot(Date.now(), "p0", 
                                         sortedByAltColorAndRank(deck.slice(0,13)).map(c => new WorldCard(c, true)))]),
       new ContainerSlot("p1", [new Slot(Date.now(), "p1",
                                         sortedByAltColorAndRank(deck.slice(13,26)).map(c => new WorldCard(c, true)))]),
       new ContainerSlot("p0-meld", []),
       new ContainerSlot("waste"),
       new ContainerSlot("p1-meld", []),
       new ContainerSlot("stock", [new Slot(Date.now(), "stock",
                                            deck.slice(26).map(c => new WorldCard(c, false)))])]
    )
  }
  
  makeUI(app:App) {
    const viewer = app.viewerGet()
    const opponent = app.playersGet().find(p => p != viewer) as Player
    assert(() => opponent)
    const root = app.root
    
    const uislotTop = new UISlotSpread(opponent.idSlot, app, opponent, viewer, undefined, `${CARD_HEIGHT}px`, '100%')
    uislotTop.init()
    root.add(uislotTop)

    // Refactor as UI element...
    const divPlay = document.createElement("div")
    divPlay.style.display = 'flex'
    divPlay.style.flexDirection = 'column'
    
    const uislotMeldOpp = new UIContainerMulti(opponent.idSlot+'-meld', app, null, viewer, `${CARD_HEIGHT}px`, 'turn')
    uislotMeldOpp.init()
    uislotMeldOpp.element.style.flexGrow = "1"
    divPlay.appendChild(uislotMeldOpp.element)
    
    const divWaste = document.createElement("div")
    divWaste.style.display = 'flex'
    divWaste.style.flexGrow = "1"
    divPlay.appendChild(divWaste)
    
    const uislotWaste = new UISlotSpread('waste', app, null, viewer, undefined, CARD_HEIGHT+'px', '100%',
                                         ['slot', 'slot-overlap'], ['card', 'card-overlap'])
    uislotWaste.init()
    uislotWaste.element.style.flexGrow = "1"
    divWaste.appendChild(uislotWaste.element)
    
    const uislotStock = new UISlotSingle('stock', app, null, viewer, '', undefined)
    uislotStock.init()
    uislotStock.element.style.marginTop = 'auto'
    divWaste.appendChild(uislotStock.element)

    const uislotMeldPlay = new UIContainerMulti(viewer.idSlot+'-meld', app, null, viewer, `${CARD_HEIGHT}px`, 'turn')
    uislotMeldPlay.init()
    uislotMeldPlay.element.style.flexGrow = "1"
    divPlay.appendChild(uislotMeldPlay.element)
    
    root.element.appendChild(divPlay)
    
    const uislotBottom = new UISlotSpread(viewer.idSlot, app, viewer, viewer, undefined, `${CARD_HEIGHT}px`, '100%')
    uislotBottom.init()
    root.add(uislotBottom)
  }
}

let appGlobal:App

function run(urlCardImages:string, urlCardBack:string) {
  const p0 = new Player('Player 1', 'p0')
  const p1 = new Player('Player 2', 'p1')
  
  const app = new App(
    [
      new GameGinRummy(),
      new GameDummy(),
    ],
    new NotifierSlot(),
    urlCardImages,
    urlCardBack,
    p0,
    [p0, p1],
    new UISlotRoot(demandElementById("playfield"))
  )

  appGlobal = app

  app.init(demandElementByIdTyped("game-type", HTMLSelectElement).value)
  
  demandElementById("error").addEventListener(
    "click",
    () => demandElementById("error").style.display = 'none'
  )
  
  demandElementById("id-get").addEventListener("click", () => host(app))
  demandElementById("connect").addEventListener("click", () => connect(app))
  demandElementById("sync").addEventListener("click", () => sync(app))
  demandElementById("player-next").addEventListener("click", () => {
    if (app.viewerGet() == p0) {
      app.viewerSet(p1)
    } else {
      app.viewerSet(p0)
    }
  })
  demandElementById("connect-status").addEventListener(
    "pingback",
    function (e:EventPingBack) { this.innerHTML = `Connected for ${e.secs}s` }
  )
  
  demandElementById("game-new").addEventListener(
    "click",
    () => {
      app.newGame(demandElementByIdTyped("game-type", HTMLSelectElement).value)
      sync(app)
    }
  )
  demandElementById("reveal-all").addEventListener("click", () => revealAll(app))
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
    const stock = playfield.container("stock").first()
    const waste = playfield.container("waste").first()
    appGlobal.playfieldMutate(
      playfield.slotsUpdate([
        [
          stock,
          stock.remove([stock.top()])
        ],
        [
          waste,
          waste.add([waste.top().withFaceUp(true)])
        ]
      ],
      appGlobal
      )
    )

    if (appGlobal.playfieldGet().container("stock").isEmpty()) {
      appGlobal.newGame(appGlobal.gameGet().id)
    }
    
    window.setTimeout(
      moveStock,
      100
    )
  }

  moveStock()
}
