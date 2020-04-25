import { assert, assertf } from './assert.js'
import * as dom from "./dom.js"
import { Card, ContainerSlotCard, EventContainerChange, EventMapNotifierSlot, EventSlotChange, NotifierSlot, Player, Playfield, SlotCard, UpdateSlot, WorldCard } from './game.js'
import { Vector } from './math.js'

type RefEventListener = [string, (e:Event) => void]

class EventListeners {
  private refs:RefEventListener[] = []
  private target:EventTarget

  constructor(e:EventTarget) {
    this.target = e
  }
  
  add<T extends Event>(typeEvent:string, handler:(e:T) => boolean):RefEventListener {
    const ref:RefEventListener = [typeEvent,
                                  EventListeners.preventDefaultWrapper.bind(undefined, handler)]
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
    assert(idx != -1)
    this.target.removeEventListener(...ref)
    this.refs = this.refs.splice(0, idx).concat(this.refs.splice(idx+1))
  }
  
  private static preventDefaultWrapper(func:(e:any) => boolean, e:any):void {
    if (!func(e)) {
      e.preventDefault()
      e.stopPropagation()
    }
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
  uiMovablesForSlots(slots:SlotCard[]):UIMovable[] {
    return this.children.flatMap(c => c.uiMovablesForSlots(slots))
  }

  destroy() {
    super.destroy()
    for (const child of this.children)
      child.destroy()
    this.children = []
  }
}

export class UIContainerFlex extends UIContainer {
  constructor(direction:string|undefined='row', grow=false) {
    super(document.createElement("div"))
    this.element.style.display = 'flex'
    if (grow)
      this.element.style.flexGrow = "1"
    if (direction == undefined)
      this.element.classList.add("flex")
    else
      this.element.style.flexDirection = direction
  }
}

export class UISlotRoot extends UIContainer {
  constructor() {
    super(document.createElement("div"))
    dom.demandById("playfield").appendChild(this.element)
  }
}

/*
  Elements that can be clicked, touched, can have cards moved to and from them, etc.
*/
abstract class UIActionable extends UIElement {
  readonly idCnt:string
  protected readonly owner:Player|null
  protected readonly viewer:Player
  protected readonly selection:Selection
  protected readonly notifierSlot:NotifierSlot
  protected playfield:Playfield
  
  constructor(element:HTMLElement, idCnt:string, selection:Selection, owner:Player|null, viewer:Player,
              playfield:Playfield, notifierSlot:NotifierSlot) {
    super(element)
    this.idCnt = idCnt
    this.owner = owner
    this.viewer = viewer
    this.selection = selection
    this.playfield = playfield
    this.notifierSlot = notifierSlot
  }

  init():void {
    this.events.add("click", this.onClick.bind(this))
  }

  abstract uiMovablesForSlots(slots:SlotCard[]):UIMovable[]
  protected abstract onAction(selected:readonly UIMovable[]):void

  container():ContainerSlotCard {
    return this.playfield.container(this.idCnt)
  }
  
  isViewableBy(viewer:Player) {
    return this.owner == null || viewer == this.owner
  }
  
  onClick(e:MouseEvent) {
    this.selection.finalize(this.onAction.bind(this), UICard)
    return true
  }
}

/*
  Shows single card slots.
*/
abstract class UISlot extends UIActionable {
  idSlot:number
  readonly actionLongPress:string
  private readonly selectionMode:string
  protected children:UICard[] = []
  protected readonly urlCards:string
  protected readonly urlCardBack:string
  
  constructor(element:HTMLElement, idCnt:string, selection:Selection, owner:Player|null, viewer:Player,
              playfield:Playfield, idSlot:number, notifierSlot:NotifierSlot, urlCards:string, urlCardBack:string,
              actionLongPress='flip', selectionMode='single') {

    super(element, idCnt, selection, owner, viewer, playfield, notifierSlot)
    
    this.actionLongPress = actionLongPress
    this.selectionMode = selectionMode
    this.idSlot = idSlot
    this.urlCards = urlCards
    this.urlCardBack = urlCardBack

    this.element.classList.add("slot")
    
    notifierSlot.slot(this.idCnt, this.idSlot).addEventListener(
      "slotchange",
      (e:EventSlotChange) => 
        this.change(e.playfield_, e.playfield.container(e.idCnt).slot(e.idSlot),
                    e.playfield_.container(e.idCnt).slot(e.idSlot))
    )
  }

  abstract change(playfield_:Playfield, slot:SlotCard|undefined, slot_:SlotCard):void
  
  destroy() {
    super.destroy()
    for (const child of this.children)
      child.destroy()
  }
  
  onCardClicked(uicard:UICard) {
    if (this.selectionMode == 'all-proceeding') {
      const selectedIdx = this.children.indexOf(uicard)
      if (selectedIdx != -1) {
        this.selection.select(this.children.slice(selectedIdx))
      }
    } else {
      this.selection.select([uicard])
    }
  }
  
  slot():SlotCard {
    return this.container().slot(this.idSlot)
  }
  
  protected doMove(uiCards:UICard[]) {
    const cardsSrc = uiCards.map(ui => ui.wcard)
    assert(cardsSrc.length, "Source cards empty")
    const slotSrc = uiCards[0].uislot.slot()
    const slotDst = this.slot()
    if (slotSrc === slotDst) {
      // case 1: same slot. Only possible outcome is move to end, otherwise drop target would be UICard.
      const slotSrc_ = slotSrc.remove(cardsSrc).add(cardsSrc)
      this.playfield.slotsUpdate([[slotSrc, slotSrc_]], this.notifierSlot)
    } else {
      // case 2: diff slot. Always flip face-up, unless a human player has deliberately flipped it.
      
      const slotSrc_ = slotSrc.remove(cardsSrc)
      
      const slotDst_ = slotDst.add(cardsSrc.map(wc => {
        let faceUp
        if (wc.faceUpIsConscious)
          faceUp = wc.faceUp
        else
          faceUp = !slotDst.container(this.playfield).secret
        return wc.withFaceUp(faceUp)
      }))
      
      this.playfield.slotsUpdate([[slotSrc, slotSrc_], [slotDst, slotDst_]], this.notifierSlot)
    }
  }

  protected onAction(selected:UICard[]) {
    this.doMove(selected)
  }
}

/*
  Shows the topmost card of a single slot and a card count.
*/
export class UISlotSingle extends UISlot {
  readonly count:HTMLElement
  private readonly height:string
  private cards:HTMLElement
  private readonly cardWidth:number
  private readonly cardHeight:number
  
  constructor(idCnt:string, selection:Selection, owner:Player|null, viewer:Player, playfield:Playfield, height:string,
              idSlot:number, notifierSlot:NotifierSlot, urlCards:string, urlCardBack:string, cardWidth:number,
              cardHeight:number, actionLongPress='flip') {
    super(document.createElement("div"), idCnt, selection, owner, viewer, playfield, idSlot, notifierSlot,
          urlCards, urlCardBack, actionLongPress)
    this.element.classList.add("slot-single")
    this.element.style.width = cardWidth.toString()
    this.count = document.createElement("label")
    this.element.appendChild(this.count)
    this.height = height
    
    this.cards = this.makeCardsDiv(this.height)
    this.element.appendChild(this.cards)
    this.cardWidth = cardWidth
    this.cardHeight = cardHeight
  }

  uiMovablesForSlots(slots:SlotCard[]):UIMovable[] {
    return Array.from(slots).some(s => this.slot().is(s)) ? [this.children[0]] : []
  }
  
  change(playfield_:Playfield, slot:SlotCard|undefined, slot_:SlotCard):void {
    const cards = this.makeCardsDiv(this.height)
    this.children = []
    if (!slot_.isEmpty()) {
      this.children[0] = new UICard(slot_.top(), this, false, this.viewer, this.selection, this.playfield,
                                    this.notifierSlot, this.urlCards, this.urlCardBack, this.cardWidth, this.cardHeight)
      this.children[0].init()
      cards.appendChild(this.children[0].element)
    }
    this.cards.replaceWith(cards)
    this.cards = cards
    this.count.innerText = slot_.length().toString()
    this.playfield = playfield_
  }

  private makeCardsDiv(height:string):HTMLElement {
    const result = document.createElement("div")
    result.style.minHeight = height
    return result
  }
}

/*
  Shows a single slot as a fan of cards.
*/
export class UISlotSpread extends UISlot {
  private classesCard:string[]
  private containerEl:HTMLElement
  private cardWidth:number
  private cardHeight:number
  
  constructor(idCnt:string, selection:Selection, owner:Player|null, viewer:Player, playfield:Playfield, idSlot:number,
              notifierSlot:NotifierSlot, urlCards:string, urlCardBack:string, cardWidth:number, cardHeight:number,
              minHeight:string, width?:string, classesSlot?:string[],
              classesCard?:string[], actionLongPress='flip', selectionMode='single') {
    
    super(document.createElement("div"), idCnt, selection, owner, viewer, playfield, idSlot, notifierSlot, urlCards,
          urlCardBack, actionLongPress, selectionMode)
    classesSlot = classesSlot || ['slot', 'slot-overlap']
    classesCard = classesCard || ['card']
    this.classesCard = classesCard
    if (width)
      this.element.style.width = width
    this.element.style.minHeight = minHeight
    this.element.classList.add(...classesSlot)
    this.containerEl = document.createElement("div")
    this.element.appendChild(this.containerEl)
    this.cardWidth = cardWidth
    this.cardHeight = cardHeight
  }

  uiMovablesForSlots(slots:SlotCard[]):UIMovable[] {
    return slots.some(s => this.slot().is(s)) ? this.children : []
  }
  
  change(playfield_:Playfield, slot:SlotCard|undefined, slot_:SlotCard):void {
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
        const uicard = new UICard(wcard, this, true, this.viewer, this.selection, this.playfield, this.notifierSlot,
                                  this.urlCards, this.urlCardBack, this.cardWidth, this.cardHeight, this.classesCard)
        uicard.init()
        uicard.element.style.zIndex = (idx+1).toString() // Keep it +1 just in case transitions ever need to avoid
                                                         // overlaying the same card (then they can -1).
        this.children[idx] = uicard
        if (child)
          child.element.replaceWith(uicard.element)
        else
          this.containerEl.insertBefore(uicard.element, this.children[idx+1]?.element)
      }
      --idx
    }
    this.playfield = playfield_
  }
}

/*
  UI elements that can visualise ContainerSlots.
*/
abstract class UIContainerSlots extends UIActionable {
  constructor(element:HTMLElement, idCnt:string, selection:Selection, owner:Player|null, viewer:Player,
              playfield:Playfield, notifierSlot:NotifierSlot) {
    super(element, idCnt, selection, owner, viewer, playfield, notifierSlot)
    
    this.notifierSlot.container(this.idCnt).addEventListener<SlotCard, "containerchange">(
      "containerchange",
      (e:EventContainerChange<SlotCard>) => 
        this.change(e.playfield_, e.playfield.container(e.idCnt), e.playfield_.container(e.idCnt), e.updates)
    )
  }

  abstract change(playfield_:Playfield, cnt:ContainerSlotCard, cnt_:ContainerSlotCard,
                  updates:UpdateSlot<SlotCard>[]):void
}

/*
  A UI element that can visualise a whole ContainerSlot by displaying multiple UISlotSpreads within it, and allowing
  new slots to be created.
*/
export class UIContainerSlotsMulti extends UIContainerSlots {
  private children:UISlot[] = []
  private readonly actionLongPress:string
  private readonly urlCards:string
  private readonly urlCardBack:string
  private readonly cardWidth:number
  private readonly cardHeight:number
  
  constructor(idCnt:string, selection:Selection, owner:Player|null, viewer:Player, playfield:Playfield,
              notifierSlot:NotifierSlot, urlCards:string, urlCardBack:string, cardWidth:number, cardHeight:number,
              height:string, actionLongPress='flip') {
    super(document.createElement("div"), idCnt, selection, owner, viewer, playfield, notifierSlot)

    this.element.classList.add("slot")
    this.element.style.minHeight = height
    this.actionLongPress = actionLongPress
    this.urlCards = urlCards
    this.urlCardBack = urlCardBack
    this.cardWidth = cardWidth
    this.cardHeight = cardHeight
  }

  uiMovablesForSlots(slots:SlotCard[]):UIMovable[] {
    return this.children.flatMap(uis => uis.uiMovablesForSlots(slots))
  }
  
  onAction(selected:UICard[]) {
    assert(selected.length, "Empty selection")
    const cardsSrc = selected.map(ui => ui.wcard)
    const slotSrc = selected[0].uislot.slot()
    const slotSrc_ = slotSrc.remove(cardsSrc)
    const cnt:ContainerSlotCard = this.container()
    const slotDst_ = new SlotCard((this.children[this.children.length-1]?.idSlot ?? -1) + 1, cnt.id(), cardsSrc)
    
    this.playfield.slotsUpdate([[slotSrc, slotSrc_], [undefined, slotDst_]], this.notifierSlot)
  }
  
  change(playfield_:Playfield, cnt:ContainerSlotCard, cnt_:ContainerSlotCard, updates:UpdateSlot<SlotCard>[]):void {
    // Deletes not handled for now
    assert(Array.from(cnt).every(c => Array.from(cnt_).some(c_ => c.is(c_))), "Some slots not in multi")

    for (const [slot, slot_] of updates) {
      if (!this.children.some(uislot => slot_.isId(uislot.idSlot))) {
        const uislot = new UISlotSpread(
          cnt.id(),
          this.selection,
          this.owner,
          this.viewer,
          playfield_,
          slot_.id(),
          this.notifierSlot,
          this.urlCards,
          this.urlCardBack,
          this.cardWidth,
          this.cardHeight,
          '0px',
          `${this.cardWidth}px`,
          ['slot', 'slot-overlap-vert'],
          undefined,
          this.actionLongPress
        )

        uislot.init()
        uislot.change(playfield_, slot, slot_)
        this.element.appendChild(uislot.element)
        this.children.push(uislot)
      }
    }
    
    this.playfield = playfield_
  }
}

export abstract class UIMovable extends UIElement {
  protected readonly selection:Selection
  protected readonly dropTarget:boolean
  private eventsImg?:EventListeners
  private timerPress:number|null = null
  private touch?:Touch

  constructor(el:HTMLElement, selection:Selection, dropTarget:boolean) {
    super(el)
    this.selection = selection
    this.dropTarget = dropTarget
  }
  
  abstract equalsVisually(rhs:this):boolean
  abstract is(rhs:this):boolean
  protected abstract doMove(uimovable:readonly this[]):void
  
  protected init(elementClickable:EventTarget):void {
    // Adding events to a small-width div (as with cards) works fine on Chrome and FF, but iOS ignores clicks on the
    // image if it extends past the div borders. Or perhaps it's firing pointerups? That's why a specific events target
    // on the actual clickable is needed.
    this.eventsImg = new EventListeners(elementClickable)

    function lpMouseUp(self:UIMovable) {
      if (self.timerPress) {
        cancel(self)
        self.onClick()
      }
      return false
    }
    
    function lpMouseDown(self:UIMovable) {
      self.timerPress = window.setTimeout(
        () => {
          self.timerPress = null
          self.touch = undefined
          self.onLongPress()
        }, 500)
      return false
    }
    
    function cancel(self:UIMovable) {
      self.touch = undefined
      if (self.timerPress) {
        clearTimeout(self.timerPress)
        self.timerPress = null
      }
      return false
    }

    assert(this.eventsImg, "Failed to call init")
    
    // Touch events here must both allow longpress and not block scrolling. "touchstart" return true, so further
    // mouse events can't be blocked by the browser and this code must ignore them where required.
    this.eventsImg.add("mouseup", () => !this.touch ? lpMouseUp(this) : true)
    this.eventsImg.add("mousedown", () => !this.touch ? lpMouseDown(this) : true)
    this.eventsImg.add("mouseout", () => cancel(this))
    this.eventsImg.add("touchstart",
                       (e:TouchEvent) => { this.touch = e.touches[0]; lpMouseDown(this); return true })
    this.eventsImg.add("touchmove", (e:TouchEvent) => {
      if (!this.touch || Math.abs(e.touches[0].screenY - this.touch.screenY) > 5)
        cancel(this)
      return true
    })
    this.eventsImg.add("touchcancel", () => cancel(this))
    this.eventsImg.add("touchend", () => this.touch ? lpMouseUp(this) : false)

    // Stop slots acting on mouse events that this element has acted on.
    this.eventsImg.add("click",
                       (e) => (!(this.dropTarget || !this.selection.active() || this.selection.includes(this))))

    // Stop press-on-image context menu on mobile browsers.
    this.eventsImg.add("contextmenu", (e) => false)
  }

  destroy() {
    super.destroy()
    this.eventsImg?.removeAll()
  }

  onSelect() {
    this.element.classList.add("selected")
  }

  onDeselect() {
    this.element.classList.remove("selected")
  }

  fadeTo(start:string, end:string, msDuration:number, onFinish:(e?:Event) => void = (e) => {}) {
    if (this.element.animate) {
      const filter = this.element.style.filter
      
      const anim = this.element.animate(
        [
          { filter: ` opacity(${start})` },
          { filter: ` opacity(${end})` }
        ],
        {
          duration: msDuration,
          easing: 'ease-in-out'
        }
      )
      anim.addEventListener("finish", onFinish)
    } else {
      onFinish(undefined)
    }
  }
  
  animateTo(start:Vector, end:Vector, zIndexEnd: number, msDuration:number,
            onFinish:(e?:Event) => void = (e) => {}) {
    
    if (this.element.animate) {
      this.events.removeAll()
      this.eventsImg?.removeAll()
      this.element.style.position = 'absolute'
      this.element.style.left = start[0]+'px'
      this.element.style.top = start[1]+'px'
      document.body.appendChild(this.element)
      const kfEnd = { transform: `translate(${end[0]-start[0]}px, ${end[1] - start[1]}px)`,
                      zIndex: zIndexEnd.toString() }
      this.element.animate(
        [
          { transform: 'translate(0px, 0px)', zIndex: this.element.style.zIndex || '0' },
          kfEnd
        ],
        {
          duration: msDuration,
          easing: 'ease-in-out'
        }
      ).addEventListener("finish", (e) => {
        this.element.style.transform = kfEnd.transform
        this.element.style.zIndex = kfEnd.zIndex
        onFinish(e)
      })
    } else {
      onFinish(undefined)
    }
  }
  
  coordsAbsolute():Vector {
    const rectThis = this.element.getBoundingClientRect()
    return [rectThis.left + window.pageXOffset, rectThis.top + window.pageYOffset]
  }

  protected onLongPress() {}
  
  protected onClick() {}
}

//export class UIChip extends UIMovable {
//}

/*
  Assumptions: 1->1 UICard->Card on given Playfield
*/
export class UICard extends UIMovable {
  readonly wcard:WorldCard
  readonly uislot:UISlot
  private readonly faceUp:boolean
  private playfield:Playfield
  private notifierSlot:NotifierSlot
  private readonly img:HTMLImageElement
  
  constructor(wcard:WorldCard, uislot:UISlot, dropTarget:boolean, viewer:Player, selection:Selection,
              playfield:Playfield, notifierSlot:NotifierSlot, urlCardImages:string, urlCardBack:string,
              cardWidth:number, cardHeight:number, classesCard=["card"]) {
    super(document.createElement("div"), selection, dropTarget)
    this.wcard = wcard
    this.uislot = uislot
    this.notifierSlot = notifierSlot
    this.playfield = playfield
    this.element.classList.add(...classesCard)
    this.faceUp = wcard.faceUp && (this.uislot.isViewableBy(viewer) || wcard.faceUpIsConscious)

    this.img = document.createElement("img")
    if (this.faceUp) {
      this.img.setAttribute('src', urlCardImages + '#c' + wcard.card.suit + '_' + wcard.card.rank)
    } else {
      this.img.setAttribute('src', urlCardBack)
    }

    if (wcard.turned) {
      this.element.classList.add('turned')
    }
    
    this.img.setAttribute('width', cardWidth.toString())
    this.img.setAttribute('height', cardHeight.toString())

    this.element.appendChild(this.img)
  }

  init() {
    super.init(this.img)
  }

  equalsVisually(rhs:this) {
    return this.wcard.card.is(rhs.wcard.card) && this.faceUp == rhs.faceUp
  }

  is(rhs:this):boolean {
    return this.wcard.is(rhs.wcard)
  }
  
  protected doMove(uicards:readonly UICard[]) {
    assert(uicards.length, "Move of no cards")
    const cardsSrc = uicards.map(ui => ui.wcard)
    const slotSrc = uicards[0].uislot.slot()
    const slotDst = this.uislot.slot()

    if (slotSrc === slotDst) {
      const slot_ = slotSrc.remove(cardsSrc).add(cardsSrc, this.wcard)
      this.playfield.slotsUpdate([[slotSrc, slot_]], this.notifierSlot)
    } else {
      const slotSrc_ = slotSrc.remove(cardsSrc)
      const slotDst_ = slotDst.add(cardsSrc, this.wcard)
      this.playfield.slotsUpdate([[slotSrc, slotSrc_], [slotDst, slotDst_]], this.notifierSlot)
    }
  }
  
  protected onClick() {
    // This logic is necessary to allow non-drop targets (single slot) to have this action fall through to the slot.
    if (this.dropTarget && this.selection.active() && !this.selection.includes(this)) {
      this.selection.finalize(this.doMove.bind(this), UICard)
    } else if (this.selection.active() && this.selection.includes(this)) {
      this.selection.deselect()
    } else if (!this.selection.active()) {
      this.uislot.onCardClicked(this)
    }
  }
  
  protected onLongPress() {
    if (this.uislot.actionLongPress == 'flip') {
      this.flip()
    } else {
      this.turn()
    }
  }
  
  private flip() {
    const slot = this.uislot.slot()
    const slot_ = slot.replace(this.wcard, this.wcard.withFaceStateConscious(!this.wcard.faceUp, this.wcard.faceUp))
    this.playfield.slotsUpdate([[slot, slot_]], this.notifierSlot)
  }
  
  private turn() {
    const slot = this.uislot.slot()
    const slot_ = slot.replace(this.wcard, this.wcard.withTurned(!this.wcard.turned))
    this.playfield.slotsUpdate([[slot, slot_]], this.notifierSlot)
  }
}

export class Selection {
  private selected:readonly UIMovable[] = []

  select(selects:readonly UIMovable[]) {
    const deselects = this.selected.filter(s => !selects.includes(s))
    const newselects = selects.filter(s => !this.selected.includes(s))
    this.deselect(deselects)
    this.selected = selects
    for (const s of newselects) s.onSelect()
  }

  deselect(selects:readonly UIMovable[]=this.selected) {
    assert(selects.every(s => this.selected.includes(s)), "Deselect of unselected elem")
    for (const s of selects) s.onDeselect()
    this.selected = this.selected.filter(s => !selects.includes(s))
  }

  finalize<T extends UIMovable>(func:(selected:readonly T[]) => void, klass:new (...args:any) => T) {
    assert(this.selected.every(s => s instanceof klass))
    if (this.selected.length > 0)
      func(this.selected as T[])
    this.deselect(this.selected)
  }

  includes(s:UIMovable) {
    return this.selected.includes(s)
  }

  active() {
    return this.selected.length > 0
  }
}
