type UpdateSlot = [Slot|undefined, Slot]
type Vector = [number,number]

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

type RefEventListener = [string, (e:Event) => boolean]

class EventListeners {
  private refs:RefEventListener[] = []
  private target:EventTarget

  constructor(e:EventTarget) {
    this.target = e
  }
  
  add(typeEvent:string, handler:(e:Event) => boolean):RefEventListener {
    const ref:RefEventListener = [typeEvent, EventListeners.preventDefaultWrapper.bind(undefined, handler)]
    this.refs.push(ref)
    this.target.addEventListener(typeEvent, ref[1])
    return ref
  }

  removeAll() {
    for (const ref of this.refs)
      this.target.removeEventListener(...ref)
    this.refs = []
  }

  remove(ref:RefEventListener) {
    const idx = this.refs.indexOf(ref)
    assert(() => idx != -1)
    this.target.removeEventListener(...ref)
    this.refs = this.refs.splice(0, idx).concat(this.refs.splice(idx+1))
  }
  
  private static preventDefaultWrapper(func:(e:Event) => boolean, e:Event) {
    if (!func(e)) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
}

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
  
  map(f: (c: WorldCard) => WorldCard):UpdateSlot[] {
    return this.slots.map(s => [s, s.map(f)])
  }

  update(update:UpdateSlot):ContainerSlot {
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

  cardsAllSlots():Card[] {
    return this.slots.flatMap(s => Array.from(s).map(wc => wc.card))
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

class Player {
  readonly name:string
  readonly idSlot:string
  
  constructor(name:string, idSlot:string) {
    this.name = name
    this.idSlot = idSlot
  }
}

abstract class UIElement {
  readonly element:HTMLElement
  protected readonly events:EventListeners

  constructor(element:HTMLElement) {
    this.element = element
    this.events = new EventListeners(this.element)
  }

  destroy() {
    this.events.removeAll()
    this.element.remove()
  }
}

/*
  Elements that hold other containers or UIActionables.
*/
abstract class UIContainer extends UIElement {
  private children:Array<UIActionable|UIContainer> = []

  constructor(element:HTMLElement) {
    super(element)
  }
  
  add(child:UIActionable|UIContainer):void {
    this.element.appendChild(child.element)
    this.children.push(child)
  }

  // Note that it's possible for there to be no UICard present for a card, even if all cards are on the playfield as is
  // typical.
  //
  // For example, the "single slot" view of stock may logically contain the card but a UICard will only have been
  // created for the top card.
  uicardsForCards(cards:Card[]):UICard[] {
    return this.children.flatMap(c => c.uicardsForCards(cards))
  }

  destroy() {
    super.destroy()
    for (const child of this.children)
      child.destroy()
    this.children = []
  }
}

class UIContainerFlex extends UIContainer {
  constructor(direction='row', grow=false) {
    super(document.createElement("div"))
    this.element.style.display = 'flex'
    if (grow)
      this.element.style.flexGrow = "1"
    this.element.style.flexDirection = direction
  }
}

class UISlotRoot extends UIContainer {
  constructor() {
    super(document.createElement("div"))
    demandElementById("playfield").appendChild(this.element)
  }
}

/*
  Elements that can be clicked, touched, can have cards moved to and from them, etc.
*/
abstract class UIActionable extends UIElement {
  readonly idCnt:string
  protected readonly app:App
  protected readonly owner:Player|null
  protected readonly viewer:Player
  
  constructor(element:HTMLElement, idCnt:string, app:App, owner:Player|null, viewer:Player) {
    super(element)
    this.idCnt = idCnt
    this.app = app
    this.owner = owner
    this.viewer = viewer
  }

  init():void {
    this.events.add("click", this.onClick.bind(this))
  }

  abstract uicardsForCards(cards:Card[]):UICard[]
  protected abstract onAction(selected:UICard[]):void

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
      this.app.selected.forEach(s => s.select(false))
      this.app.selected = null
    }
  }
}

/*
  Shows single card slots.
*/
abstract class UISlot extends UIActionable {
  idSlot:number
  readonly actionLongPress:string
  private selectionMode:string
  protected children:UICard[] = []
  
  constructor(element:HTMLElement, idCnt:string, app:App, owner:Player|null, viewer:Player, idSlot?:number,
              actionLongPress='flip', selectionMode='single') {

    super(element, idCnt, app, owner, viewer)
    
    this.element.classList.add("slot")
    
    this.actionLongPress = actionLongPress
    this.selectionMode = selectionMode
    
    if (idSlot === undefined)
      this.idSlot = app.playfieldGet().container(idCnt).first().id
    else
      this.idSlot = idSlot

    // Should be 'new EventTarget()', but iOS doesn't support that.
    this.app.notifierSlot.slot(this.idCnt, this.idSlot).addEventListener(
      "slotchange",
      (e:EventSlotChange) => {
        this.change(EventSlotChange.slot(e), EventSlotChange.slot_(e))
      }
    )
  }

  abstract change(slot:Slot|undefined, slot_:Slot):void
  
  destroy() {
    super.destroy()
    for (const child of this.children)
      child.destroy()
  }
  
  onCardClicked(uicard:UICard) {
    if (this.selectionMode == 'all-proceeding') {
      const selectedIdx = this.children.indexOf(uicard)
      if (selectedIdx != -1) {
        const uicards = this.children.slice(selectedIdx+1)
        uicards.forEach(uicard => uicard.select())
        this.app.selected = (this.app.selected || []).concat(uicards)
      }
    }
  }
  
  slot(playfield:Playfield):Slot {
    return this.container(playfield).slot(this.idSlot)
  }
  
  protected doMove(uiCards:UICard[]) {
    const cardsSrc = uiCards.map(ui => ui.wcard)
    assert(() => cardsSrc.length)
    const slotSrc = this.app.playfieldGet().slotForCard(cardsSrc[0])
    const slotDst = this.slot(this.app.playfieldGet())
    if (slotSrc === slotDst) {
      // case 1: same slot. Only possible outcome is move to end, otherwise drop target would be UICard.
      const slotSrc_ = slotSrc.remove(cardsSrc).add(cardsSrc)
      this.app.playfieldMutate(
        this.app.playfieldGet().slotsUpdate([[slotSrc, slotSrc_]], this.app)
      )
    } else {
      // case 2: diff slot. Always flip face-up, unless a human player has deliberately flipped it.
      
      const slotSrc_ = slotSrc.remove(cardsSrc)
      
      const slotDst_ = slotDst.add(cardsSrc.map(wc => {
        let faceUp
        if (wc.faceUpIsConscious)
          faceUp = wc.faceUp
        else
          faceUp = true
        return wc.withFaceUp(faceUp)
      }))
      
      this.app.playfieldMutate(
        this.app.playfieldGet().slotsUpdate([[slotSrc, slotSrc_], [slotDst, slotDst_]], this.app)
      )
    }
  }

  protected onAction(selected:UICard[]) {
    this.doMove(selected)
  }
}

/*
  Shows the topmost card of a single slot and a card count.
*/
class UISlotSingle extends UISlot {
  readonly count:HTMLElement
  private readonly height:string
  private cards:HTMLElement
  
  constructor(idCnt:string, app:App, owner:Player|null, viewer:Player, height:string, idSlot?:number,
              actionLongPress='flip') {
    super(document.createElement("div"), idCnt, app, owner, viewer, idSlot, actionLongPress)
    this.element.classList.add("slot-single")
    this.element.style.width = app.cardWidthGet().toString()
    this.count = document.createElement("label")
    this.element.appendChild(this.count)
    this.height = height
    
    this.cards = this.makeCardsDiv(this.height)
    this.element.appendChild(this.cards)
  }

  uicardsForCards(cards:Card[]):UICard[] {
    if (cards.some(c => this.children[0]?.wcard.card.is(c)))
      return [this.children[0]]
    else
      return []
  }
  
  change(slot:Slot|undefined, slot_:Slot):void {
    const cards = this.makeCardsDiv(this.height)
    this.children = []
    if (!slot_.isEmpty()) {
      this.children[0] = new UICard(slot_.top(), this, this.app, false, this.viewer)
      cards.appendChild(this.children[0].element)
    }
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

/*
  Shows a single slot as a fan of cards.
*/
class UISlotSpread extends UISlot {
  private classesCard:string[]
  private containerEl:HTMLElement
  
  constructor(idCnt:string, app:App, owner:Player|null, viewer:Player, idSlot?:number,
              minHeight:string=`${app.cardHeightGet()}px`, width?:string, classesSlot?:string[],
              classesCard?:string[], actionLongPress='flip', selectionMode='single') {
    
    super(document.createElement("div"), idCnt, app, owner, viewer, idSlot, actionLongPress, selectionMode)
    classesSlot = classesSlot || ['slot', 'slot-overlap']
    classesCard = classesCard || ['card']
    this.classesCard = classesCard
    if (width)
      this.element.style.width = width
    this.element.style.minHeight = minHeight
    this.element.classList.add(...classesSlot)
    this.containerEl = document.createElement("div")
    this.element.appendChild(this.containerEl)
  }

  uicardsForCards(cards:Card[]):UICard[] {
    return this.children.filter(uicard => cards.some(card => uicard.wcard.card.is(card)))
  }
  
  change(slot:Slot|undefined, slot_:Slot):void {
    const cards_ = Array.from(slot_)

    let idx = this.children.length - 1
    while (idx > cards_.length - 1) {
      this.children[idx--].destroy()
    }
    
    this.children.length = cards_.length
    idx = this.children.length - 1

    while (idx >= 0) {
      const wcard = cards_[idx]
      const child = this.children[idx]
      if (!child || !child.wcard.equals(wcard)) {
        const uicard = new UICard(wcard, this, this.app, true, this.viewer, this.classesCard)
        uicard.element.style.zIndex = idx.toString()
        this.children[idx] = uicard
        if (child)
          child.element.replaceWith(uicard.element)
        else
          this.containerEl.insertBefore(uicard.element, this.children[idx+1]?.element)
      }
      --idx
    }
  }
}

/*
  UI elements that can visualise ContainerSlots.
*/
abstract class UIContainerSlots extends UIActionable {
  constructor(element:HTMLElement, idCnt:string, app:App, owner:Player|null, viewer:Player) {
    super(element, idCnt, app, owner, viewer)
    
    // Should be 'new EventTarget()', but iOS doesn't support that.
    this.app.notifierSlot.container(this.idCnt).addEventListener(
      "containerchange",
      (e:EventContainerChange) => {
        this.change(EventContainerChange.container(e), EventContainerChange.container_(e), e.updates)
      }
    )
  }

  abstract change(cnt:ContainerSlot, cnt_:ContainerSlot, updates:UpdateSlot[]):void
}

/*
  A UI element that can visualise a whole ContainerSlot by displaying multiple UISlotSpreads within it, and allowing
  new slots to be created.
*/
class UIContainerSlotsMulti extends UIContainerSlots {
  private children:UISlot[] = []
  private actionLongPress:string
  
  constructor(idSlot:string, app:App, owner:Player|null, viewer:Player, height:string=`${app.cardHeightGet()}px`,
              actionLongPress='flip') {
    super(document.createElement("div"), idSlot, app, owner, viewer)

    this.element.classList.add("slot")
    this.element.style.minHeight = height
    this.actionLongPress = actionLongPress
  }

  uicardsForCards(cards:Card[]):UICard[] {
    return this.children.flatMap(c => c.uicardsForCards(cards))
  }
  
  onAction(selected:UICard[]) {
    assert(() => selected.length)
    const cardsSrc = selected.map(ui => ui.wcard)
    const slotSrc = this.app.playfieldGet().slotForCard(cardsSrc[0])
    const slotSrc_ = slotSrc.remove(cardsSrc)
    const cnt:ContainerSlot = this.container(this.app.playfieldGet())
    const slotDst_ = new Slot(Date.now(), cnt.id, cardsSrc)
    
    this.app.playfieldMutate(
      this.app.playfieldGet().slotsUpdate([[slotSrc, slotSrc_], [undefined, slotDst_]], this.app)
    )
  }
  
  change(cnt:ContainerSlot, cnt_:ContainerSlot, updates:UpdateSlot[]):void {
    // Deletes not handled for now
    assert(() => Array.from(cnt).every(c => Array.from(cnt_).some(c_ => c.is(c_))))

    for (const [slot, slot_] of updates) {
      if (!this.children.some(uislot => slot_.isId(uislot.idSlot))) {
        const uislot = new UISlotSpread(
          cnt.id, this.app, this.owner, this.viewer, slot_.id, '0px', `${this.app.cardWidthGet()}px`,
          ['slot', 'slot-overlap-vert'], undefined, this.actionLongPress
        )

        uislot.init()
        uislot.change(slot, slot_)
        this.element.appendChild(uislot.element)
        this.children.push(uislot)
      }
    }
  }
}

/*
  Assumptions: 1->1 UICard->Card on active Playfield
*/
class UICard extends UIElement {
  readonly wcard:WorldCard
  readonly uislot:UISlot
  private readonly app:App
  private timerPress:number|null = null
  private touchYStart = 0
  private readonly dropTarget:boolean
  private x?:number
  private y?:number
  
  constructor(wcard:WorldCard, uislot:UISlot, app:App, dropTarget:boolean, viewer:Player,
              classesCard=["card"]) {
    super(document.createElement("div"))
    this.dropTarget = dropTarget
    this.app = app
    this.wcard = wcard
    this.uislot = uislot
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
    
    svg.setAttribute('height', app.cardHeightGet().toString())

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
      if (this.dropTarget || !this.app.selected || this.app.selected.includes(this)) {
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

  select(selected:boolean=true) {
    if (selected)
      this.element.classList.add("selected")
    else
      this.element.classList.remove("selected")
  }

  coordsAbsolute():Vector {
    const rectThis = this.element.getBoundingClientRect()
    return [rectThis.left + window.pageXOffset, rectThis.top + window.pageYOffset]
  }
  
  fadeTo(start:string, end:string, msDuration:number, onFinish:(e?:Event) => void = (e) => {}) {
    const filter = this.element.style.filter
    
    this.element.style.opacity = end
    this.element.animate(
      [
        { filter: ` opacity(${start})` },
        { filter: ` opacity(${end})` }
      ],
      {
        duration: msDuration,
        easing: 'ease-in-out'
      }
    ).addEventListener("finish", onFinish)
  }
  
  animateTo(start:Vector, end:Vector, zIndexEnd: number, msDuration:number, onFinish:(e?:Event) => void = (e) => {}) {
    this.events.removeAll()
    this.element.style.position = 'absolute'
    this.element.style.left = start[0]+'px'
    this.element.style.top = start[1]+'px'
    document.body.appendChild(this.element)
    this.element.animate(
      [
        { transform: 'translate(0px, 0px)', zIndex: this.element.style.zIndex || '0' },
        { transform: `translate(${end[0]-start[0]}px, ${end[1] - start[1]}px)`, zIndex: zIndexEnd.toString() }
      ],
      {
        duration: msDuration,
        easing: 'ease-in-out'
      }
    ).addEventListener("finish", onFinish)
  }
  
  private onLongPress() {
    if (this.uislot.actionLongPress == 'flip') {
      this.flip()
    } else {
      this.turn()
    }
  }
  
  private onClick() {
    this.app.selected?.forEach(s => s.select(false))
    // This logic is necessary to allow non-drop targets (single slot) to have this action fall through to the slot.
    if (this.dropTarget && this.app.selected && !this.app.selected.includes(this)) {
      this.doMove(this.app.selected as UICard[])
      this.app.selected = null
    } else if (this.app.selected && this.app.selected.includes(this)) {
      this.app.selected.forEach(s => s.select(false))
      this.app.selected = null
    } else if (!this.app.selected) {
      this.select()
      this.app.selected = [this]
      this.uislot.onCardClicked(this)
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
  
  private doMove(uicards:UICard[]) {
    assert(() => uicards.length)
    const cardsSrc = uicards.map(ui => ui.wcard)
    const slotSrc = this.app.playfieldGet().slotForCard(cardsSrc[0])
    const slotDst = this.uislot.slot(this.app.playfieldGet())

    if (slotSrc === slotDst) {
      const slot_ = slotSrc.remove(cardsSrc).add(cardsSrc, this.wcard.card)
      this.app.playfieldMutate(
        this.app.playfieldGet().slotsUpdate([[slotSrc, slot_]], this.app)
      )
    } else {
      const slotSrc_ = slotSrc.remove(cardsSrc)
      const slotDst_ = slotDst.add(cardsSrc, this.wcard.card)
      this.app.playfieldMutate(
        this.app.playfieldGet().slotsUpdate([[slotSrc, slotSrc_], [slotDst, slotDst_]], this.app)
      )
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

  equals(rhs:WorldCard):boolean {
    return this.card.is(rhs.card) &&
      this.faceUp == rhs.faceUp &&
      this.faceUpIsConscious == rhs.faceUpIsConscious &&
      this.turned == rhs.turned
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

  static container(self:EventSlotChange) { return self.playfield.container(self.idCnt) }
  static container_(self:EventSlotChange) { return self.playfield_.container(self.idCnt) }
  static slot(self:EventSlotChange):Slot|undefined {
    if (EventSlotChange.container(self).hasSlot(self.idSlot, self.idCnt))
      return EventSlotChange.container(self).slot(self.idSlot)
    else
      return undefined
  }
  static slot_(self:EventSlotChange) { return EventSlotChange.container_(self).slot(self.idSlot) }
}

class EventContainerChange extends Event {
  readonly playfield:Playfield
  readonly playfield_:Playfield
  readonly updates:UpdateSlot[]
  readonly idCnt:string
  
  constructor(playfield:Playfield, playfield_:Playfield, idCnt:string, updates:UpdateSlot[]) {
    super('containerchange')
    this.playfield = playfield
    this.playfield_ = playfield_
    this.updates = updates
    this.idCnt = idCnt
  }

  static container(self:EventContainerChange) { return self.playfield.container(self.idCnt) }
  static container_(self:EventContainerChange) { return self.playfield_.container(self.idCnt) }
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
  
  slotsUpdate(updates:UpdateSlot[], app:App, send=true):Playfield {
    assert(() => updates.every(([slot, slot_]) => (slot == undefined || slot.idCnt == slot_.idCnt)))
    
    if (send) {
      app.send({slotUpdates: updates.map(([s, s_]) => [s?.serialize(), s_.serialize()])})
    }
    
    let containers_ = this.containers
    for (let update of updates) {
      containers_ = containers_.map(cnt => cnt.update(update))
    }
    const playfield_ = new Playfield(containers_)

    const preSlotChangeInfo = app.preSlotChange(updates)
    
    const cntChanged:Map<string, UpdateSlot[]> = new Map()
    for (const update of updates) {
      const [slot, slot_] = update
      
      if (!cntChanged.has(slot_.idCnt)) {
        cntChanged.set(slot_.idCnt, [])
      }
      (cntChanged.get(slot_.idCnt) as UpdateSlot[]).push(update)

      app.notifierSlot.slot(slot_.idCnt, slot_.id).dispatchEvent(
        new EventSlotChange(app.playfieldGet(), playfield_, slot_.idCnt, slot_.id)
      )
    }

    for (const [idCnt, updates] of cntChanged) {
      app.notifierSlot.container(idCnt).dispatchEvent(
        new EventContainerChange(app.playfieldGet(), playfield_, idCnt, updates)
      )
    }
    
    app.postSlotChange(preSlotChangeInfo)
    
    return playfield_
  }
}

declare var Peer

class App {
  peer:any
  peerConn:any
  selected:UICard[]|null
  readonly notifierSlot:NotifierSlot
  readonly urlCardImages:string
  readonly urlCardBack:string
  private root:UISlotRoot
  private cardWidth = 74
  private cardHeight = 112
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

  run(gameId:string) {
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

  cardSizeSet(width:number, height:number) {
    this.cardWidth = width
    this.cardHeight = height
  }

  cardWidthGet() { return this.cardWidth }
  cardHeightGet() { return this.cardHeight }
  
  viewerSet(viewer:Player) {
    assert(() => this.game)
    this.viewer = viewer

    this.root.destroy()
    this.root = new UISlotRoot()
    this.game.makeUI(this, this.root)
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

  preSlotChange(updates:UpdateSlot[]):[UICard, Vector][] {
    return this.root.uicardsForCards(updates.flatMap(([s, s_]) => s ? Array.from(s).map(wc => wc.card) : [])).
      map(uicard => [uicard, uicard.coordsAbsolute()])
  }

  postSlotChange(uicards:[UICard, Vector][]) {
    const uicards_ = this.root.uicardsForCards(uicards.map(u => u[0].wcard.card))
    for (const [uicard, coords] of uicards) {
      const uicard_ = uicards_.find(u_ => u_.wcard.card.is(uicard.wcard.card))
      if (uicard_) {
        if (uicard_ != uicard) {
          const end = uicard_.coordsAbsolute()
          if (coords[0] != end[0] || coords[1] != end[1]) {
            uicard.animateTo(coords, end, Number(uicard_.element.style.zIndex), 1000, uicard.destroy.bind(uicard))
            uicard_.fadeTo('0%', '100%', 1000)
          }
        }
      } else {
        uicard.animateTo(coords, [coords[0], 0], Number(uicard.element.style.zIndex), 1000, uicard.destroy.bind(uicard))
      }
    }
    
    const audioCtx = new ((<any>window).AudioContext || (<any>window).webkitAudioContext)()
    const osc = audioCtx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = 100 + Math.random() * 400
    osc.frequency.setTargetAtTime(osc.frequency.value + osc.frequency.value * (0.5 + Math.random() * 1.5), 0, 1.2)
    const gain = audioCtx.createGain()
    gain.gain.value = 0.25
    gain.gain.setTargetAtTime(0.0, audioCtx.currentTime + 0.5, 0.1)
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.start()
    osc.stop(audioCtx.currentTime + 1.0)
    window.setTimeout(() => gain.disconnect(), 1500)
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
          let updates:UpdateSlot[]
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
  const updates:UpdateSlot[] = app.playfieldGet().containers.flatMap(
    cnt => cnt.map(wc => wc.withFaceStateConscious(true, true))
  )
  
  app.playfieldMutate(app.playfieldGet().slotsUpdate(updates, app))
}

abstract class Game extends Identified<Game> {
  abstract playfield():Playfield
  abstract makeUI(app:App, root:UISlotRoot)
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
  
  makeUI(app:App, root:UISlotRoot) {
    const viewer = app.viewerGet()
    const opponent = app.playersGet().find(p => p != viewer) as Player
    assert(() => opponent)
    
    const uislotOpp = new UISlotSpread(opponent.idSlot, app, opponent, viewer, undefined, `${app.cardHeightGet()}px`, '100%')
    uislotOpp.init()
    root.add(uislotOpp)

    // Refactor as UI element...
    const divPlay = new UIContainerFlex()
    
    const uislotWaste = new UISlotSpread('waste', app, null, viewer, undefined, app.cardHeightGet()*1.5+'px', '100%')
    uislotWaste.init()
    uislotWaste.element.style.flexGrow = "1"
    divPlay.add(uislotWaste)
    
    const divStock = new UIContainerFlex('column', true)
    const divStockSpacer = document.createElement("div") // tbd: make spacer UIElement
    divStockSpacer.style.flexGrow = "1"
    divStock.element.appendChild(divStockSpacer)
    const uislotStock = new UISlotSingle('stock', app, null, viewer, '', undefined)
    uislotStock.init()
    divStock.add(uislotStock)
    divPlay.add(divStock)

    root.add(divPlay)
    
    const uislotBottom = new UISlotSpread(viewer.idSlot, app, viewer, viewer, undefined, `${app.cardHeightGet()}px`, '100%')
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
  
  makeUI(app:App, root:UISlotRoot) {
    const viewer = app.viewerGet()
    const opponent = app.playersGet().find(p => p != viewer) as Player
    assert(() => opponent)
    
    const uislotTop = new UISlotSpread(opponent.idSlot, app, opponent, viewer, undefined, `${app.cardHeightGet()}px`, '100%')
    uislotTop.init()
    root.add(uislotTop)

    // Refactor as UI element...
    const divPlay = new UIContainerFlex('column')
    
    const uislotMeldOpp = new UIContainerSlotsMulti(opponent.idSlot+'-meld', app, null, viewer,
                                                    `${app.cardHeightGet()}px`, 'turn')
    uislotMeldOpp.init()
    uislotMeldOpp.element.style.flexGrow = "1" // tbd: encode in UIElement
    divPlay.add(uislotMeldOpp)
    
    const uislotWaste = new UISlotSpread('waste', app, null, viewer, undefined, app.cardHeightGet()+'px', '100%',
                                         undefined, undefined, 'flip', 'all-proceeding')
    uislotWaste.init()
    uislotWaste.element.style.flexGrow = "1" // tbd: encode in UIElement
    divPlay.add(uislotWaste)
    
    const uislotMeldPlay = new UIContainerSlotsMulti(viewer.idSlot+'-meld', app, null, viewer,
                                                     `${app.cardHeightGet()}px`, 'turn')
    uislotMeldPlay.init()
    uislotMeldPlay.element.style.flexGrow = "1"  // tbd: encode in UIElement
    divPlay.add(uislotMeldPlay)
    
    root.add(divPlay)
    
    const divCombiner = new UIContainerFlex('row', true)
    divPlay.add(divCombiner)
    
    const uislotBottom = new UISlotSpread(viewer.idSlot, app, viewer, viewer, undefined, `${app.cardHeightGet()}px`,
                                          '100%')
    uislotBottom.init()
    root.add(uislotBottom)

    const uislotStock = new UISlotSingle('stock', app, null, viewer, '', undefined)
    uislotStock.init()
    uislotStock.element.style.marginTop = 'auto' // tbd: encode in UIElement
    root.add(uislotStock)
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
    new UISlotRoot()
  )

  appGlobal = app

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

  function cardSizeSet() {
    const [width, height] = JSON.parse(demandElementByIdTyped("card-size", HTMLSelectElement).value)
    app.cardSizeSet(width, height)
  }
  demandElementById("card-size").addEventListener("change", (e) => {
    cardSizeSet()
    app.viewerSet(app.viewerGet())
  })
  cardSizeSet()

  app.run(demandElementByIdTyped("game-type", HTMLSelectElement).value)
}

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
