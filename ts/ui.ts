import { assert, assertf } from './assert.js'
import * as dom from "./dom.js"
import { Card, Chip, ContainerSlotCard, EventContainerChange, EventMapNotifierSlot, EventPlayfieldChange, EventSlotChange, NotifierSlot, Player, Playfield, Slot, SlotCard, SlotChip, UpdateSlot, WorldCard } from './game.js'
import { Images } from './images.js'
import { Vector } from './math.js'

const HighDetail = false

function cardFaceUp(isSecretContainer:boolean, wc:WorldCard) {
  let faceUp
  if (wc.faceUpIsConscious)
    faceUp = wc.faceUp
  else
    faceUp = !isSecretContainer
  return wc.withFaceUp(faceUp)
}

abstract class UIElement {
  readonly element:HTMLElement
  protected readonly events:dom.EventListeners

  constructor(element:HTMLElement) {
    this.element = element
    this.events = new dom.EventListeners(this.element)
  }

  destroy() {
    this.events.removeAll()
    this.element.remove()
  }
}

/*
  Elements that hold other containers or UIActionables.
*/
export abstract class UIContainer extends UIElement {
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
  uiMovablesForSlots(slots:Slot[]):UIMovable[] {
    return this.children.flatMap(c => c.uiMovablesForSlots(slots))
  }

  destroy() {
    super.destroy()
    for (const child of this.children)
      child.destroy()
    this.children = []
  }

  with(f:(cnt:this) => void):this {
    f(this)
    return this
  }
}

export class UIContainerDiv extends UIContainer {
  constructor() {
    super(document.createElement("div"))
    this.element.classList.add("container")
  }
}

export class UIContainerFlex extends UIContainerDiv {
  constructor(direction:string|undefined='row', grow:boolean|string='', klass="container-flex") {
    super()
    this.element.classList.add(klass)
    this.element.style.display = 'flex'
    this.element.style.direction = 'ltr'
    if (grow)
      this.element.style.flexGrow = "1"
    if (direction == 'aware')
      this.element.classList.add("flex")
    else if (direction == 'aware-reverse')
      this.element.classList.add("flex-reverse")
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
  private readonly eventsPlayfield:dom.EventListeners
  _playfield:Playfield
  
  constructor(element:HTMLElement, idCnt:string, selection:Selection, owner:Player|null, viewer:Player,
              playfield:Playfield, notifierSlot:NotifierSlot) {

    assert(idCnt)
    
    super(element)
    this.idCnt = idCnt
    this.owner = owner
    this.viewer = viewer
    this.selection = selection
    this._playfield = playfield
    this.notifierSlot = notifierSlot
    this.eventsPlayfield = new dom.EventListeners(this.notifierSlot.playfield as EventTarget)
  }

  init():this {
    this.eventsPlayfield.add(
      "playfieldchange",
      (e:EventPlayfieldChange) => { this.onPlayfieldUpdate(e.playfield_); return true }
    )
    
    this.events.add("click", this.onClick.bind(this))
    return this
  }

  abstract uiMovablesForSlots(slots:Slot[]):UIMovable[]
  protected abstract onAction(selected:readonly UIMovable[]):void

  destroy() {
    super.destroy()
    this.eventsPlayfield.removeAll()
  }
  
  isViewableBy(viewer:Player) {
    return this.owner == null || viewer == this.owner
  }
  
  abstract onClick():boolean

  onPlayfieldUpdate(playfield:Playfield) {
    this._playfield = playfield
  }
}

/*
  Shows one card slot.
*/
abstract class UISlotCard extends UIActionable {
  idSlot:number
  protected children:UICard[] = []
  private readonly eventsSlot:dom.EventListeners
  
  constructor(element:HTMLElement, idCnt:string, selection:Selection, owner:Player|null, viewer:Player,
              playfield:Playfield, idSlot:number, notifierSlot:NotifierSlot, readonly images:Images,
              readonly actionLongPress='flip', private readonly selectionMode='single') {

    super(element, idCnt, selection, owner, viewer, playfield, notifierSlot)
    
    this.idSlot = idSlot

    this.element.classList.add("slot")
    
    this.eventsSlot = new dom.EventListeners(notifierSlot.slot(this.idCnt, this.idSlot) as EventTarget)
    this.eventsSlot.add(
      "slotchange",
      (e:EventSlotChange) => {
        this.change(e.playfield_, e.playfield.container(e.idCnt).slot(e.idSlot),
                    e.playfield_.container(e.idCnt).slot(e.idSlot))
        return true
      }
    )
  }

  abstract change(playfield_:Playfield, slot:SlotCard|undefined, slot_:SlotCard):void
  
  uiMovablesForSlots(slots:Slot[]):UIMovable[] {
    return Array.from(slots).some(s => this.slot().is(s)) ? this.children : []
  }
  
  onClick() {
    if (!this.selection.active() && this.selectionMode == 'all-on-space')
      this.selection.select(this._playfield, this.children)
    else
      this.selection.finalize(this._playfield, this.onAction.bind(this), UICard)
    return true
  }
  
  destroy() {
    super.destroy()
    for (const child of this.children)
      child.destroy()
    this.eventsSlot.removeAll()
  }
  
  slot():SlotCard {
    return this._playfield.container(this.idCnt).slot(this.idSlot)
  }
  
  onCardClicked(uicard:UICard) {
    if (this.selectionMode == 'all-proceeding') {
      const selectedIdx = this.children.indexOf(uicard)
      if (selectedIdx != -1) {
        this.selection.select(this._playfield, this.children.slice(selectedIdx))
      }
    } else {
      this.selection.select(this._playfield, [uicard])
    }
  }
  
  protected onAction(uiCards:readonly UICard[]) {
    const cardsSrc = uiCards.map(ui => ui.wcard)
    assert(cardsSrc.length, "Source cards empty")
    const slotSrc = uiCards[0].uislot.slot()
    const slotDst = this.slot()
    if (slotSrc === slotDst) {
      // case 1: same slot. Only possible outcome is move to end, otherwise drop target would be UICard.
      const slotSrc_ = slotSrc.remove(cardsSrc).add(cardsSrc)
      const updates:UpdateSlot<SlotCard>[] = [[slotSrc, slotSrc_]]
      this.notifierSlot.slotsUpdateCard(this._playfield, this._playfield.withUpdateCard(updates), updates)
    } else {
      // case 2: diff slot. Always flip face-up, unless a human player has deliberately flipped it.
      
      const slotSrc_ = slotSrc.remove(cardsSrc)
      
      const slotDst_ = slotDst.add(cardsSrc.map(wc => cardFaceUp(slotDst.container(this._playfield).secret, wc)))
      
      const updates:UpdateSlot<SlotCard>[] = [[slotSrc, slotSrc_], [slotDst, slotDst_]]
      this.notifierSlot.slotsUpdateCard(this._playfield, this._playfield.withUpdateCard(updates), updates)
    }
  }
}

/*
  Shows the topmost card of a single slot and a card count.
*/
export class UISlotSingle extends UISlotCard {
  readonly count:HTMLElement
  private elCard:HTMLElement;
  
  constructor(idCnt:string, selection:Selection, owner:Player|null, viewer:Player, playfield:Playfield,
              idSlot:number, notifierSlot:NotifierSlot, images:Images, private readonly cardWidth:number,
              private readonly cardHeight:number, actionLongPress='flip', action?:[string, () => boolean]) {
    super(document.createElement("div"), idCnt, selection, owner, viewer, playfield, idSlot, notifierSlot,
          images, actionLongPress)
    this.element.classList.add("slot-single")
    this.element.style.width = cardWidth.toString()+'px'
    this.count = document.createElement("label")
    this.element.appendChild(this.count)
    
    this.elCard = this.spaceMake()
    this.element.appendChild(this.elCard)

    if (action) {
      const btn = document.createElement("button")
      btn.innerText = action[0]
      btn.addEventListener("click", () => {
        btn.disabled = !action[1]()
      })
      this.element.appendChild(btn)
    }
  }

  private spaceMake() {
    const space = document.createElement("div")
    space.style.width = this.cardWidth+'px'
    space.style.height = this.cardHeight+'px'
    return space
  }
  
  change(playfield_:Playfield, slot:SlotCard|undefined, slot_:SlotCard):void {
    if (slot_.isEmpty()) {
      const space = this.spaceMake()
      this.elCard.replaceWith(space)
      this.elCard = space
      this.children = []
    } else {
      const card = new UICard(
        slot_.top(), this, false, this.viewer, this.selection, playfield_, this.notifierSlot, this.images,
        this.cardWidth, this.cardHeight
      ).init()
      this.elCard.replaceWith(card.element)
      this.elCard = card.element
      this.children[0] = card
    }
    
    this.count.innerText = slot_.length().toString()
  }
}

/*
  Shows a single slot as a fan of cards.
*/
export class UISlotSpread extends UISlotCard {
  private classesCard:string[]
  private containerEl:HTMLElement
  private cardWidth:number
  private cardHeight:number
  
  constructor(idCnt:string, selection:Selection, owner:Player|null, viewer:Player, playfield:Playfield, idSlot:number,
              notifierSlot:NotifierSlot, images:Images, cardWidth:number, cardHeight:number,
              width?:string, classesSlot?:string[], classesCard?:string[], actionLongPress='flip',
              selectionMode='single') {
    
    super(document.createElement("div"), idCnt, selection, owner, viewer, playfield, idSlot, notifierSlot, images,
          actionLongPress, selectionMode)
    classesSlot = classesSlot || ['slot', 'slot-overlap']
    classesCard = classesCard || ['card']
    this.classesCard = classesCard
    if (width)
      this.element.style.width = width
    this.element.classList.add(...classesSlot)
    this.containerEl = this.element
    this.cardWidth = cardWidth
    this.cardHeight = cardHeight
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
        const uicard = new UICard(wcard, this, true, this.viewer, this.selection, playfield_, this.notifierSlot,
                                  this.images, this.cardWidth, this.cardHeight, this.classesCard)
        uicard.init()
        if (HighDetail) {
          // Keep it +1 just in case transitions ever need to avoid
          // overlaying the same card (then they can -1).
          uicard.element.style.zIndex = (idx+1).toString() 
        }
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
  private readonly eventsContainer:dom.EventListeners
  
  constructor(element:HTMLElement, idCnt:string, selection:Selection, owner:Player|null, viewer:Player,
              playfield:Playfield, notifierSlot:NotifierSlot) {
    super(element, idCnt, selection, owner, viewer, playfield, notifierSlot)

    this.eventsContainer = new dom.EventListeners(this.notifierSlot.container(this.idCnt) as EventTarget)
    this.eventsContainer.add(
      "containerchange",
      (e:EventContainerChange<SlotCard>) => {
        this.change(e.playfield_, e.playfield.container(e.idCnt), e.playfield_.container(e.idCnt), e.updates)
        return true
      }
    )
  }

  abstract change(playfield_:Playfield, cnt:ContainerSlotCard, cnt_:ContainerSlotCard,
                  updates:UpdateSlot<SlotCard>[]):void

  destroy() {
    super.destroy()
    this.eventsContainer.removeAll()
  }
}

/*
  A UI element that can visualise a whole ContainerSlot by displaying multiple UISlotSpreads within it, and allowing
  new slots to be created.
*/
export class UIContainerSlotsMulti extends UIContainerSlots {
  private children:UISlotCard[] = []
  
  constructor(idCnt:string, selection:Selection, owner:Player|null, viewer:Player, playfield:Playfield,
              notifierSlot:NotifierSlot, private readonly images:Images, private readonly cardWidth:number,
              private readonly cardHeight:number, height:string, private readonly actionLongPress='flip') {
    super(document.createElement("div"), idCnt, selection, owner, viewer, playfield, notifierSlot)

    this.element.classList.add("slot")
    this.element.classList.add("slot-multi")
    this.element.style.minHeight = height
  }

  uiMovablesForSlots(slots:Slot[]):UIMovable[] {
    return this.children.flatMap(uis => uis.uiMovablesForSlots(slots))
  }
  
  onClick() {
    this.selection.finalize(this._playfield, this.onAction.bind(this), UICard)
    return true
  }
  
  onAction(selected:readonly UICard[]) {
    const cardsSrc = selected.map(ui => ui.wcard)
    const slotSrc = selected[0].uislot.slot()
    const slotSrc_ = slotSrc.remove(cardsSrc)
    const cnt:ContainerSlotCard = this._playfield.container(this.idCnt)
    const slotDst_ = new SlotCard((this.children[this.children.length-1]?.idSlot ?? -1) + 1, cnt.idGet(),
                                  cardsSrc.map(wc => cardFaceUp(false, wc)))

    const updates:UpdateSlot<SlotCard>[] = [[slotSrc, slotSrc_], [undefined, slotDst_]]
    this.notifierSlot.slotsUpdateCard(this._playfield, this._playfield.withUpdateCard(updates), updates)
  }
  
  change(playfield_:Playfield, cnt:ContainerSlotCard, cnt_:ContainerSlotCard, updates:UpdateSlot<SlotCard>[]):void {
    // Deletes not handled for now
    assert(Array.from(cnt).every(c => Array.from(cnt_).some(c_ => c.is(c_))), "Some slots not in multi")

    for (const [slot, slot_] of updates) {
      if (!this.children.some(uislot => slot_.isId(uislot.idSlot, uislot.idCnt))) {
        const uislot = new UISlotSpread(
          cnt.idGet(),
          this.selection,
          this.owner,
          this.viewer,
          playfield_,
          slot_.id,
          this.notifierSlot,
          this.images,
          this.cardWidth,
          this.cardHeight,
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
  }
}

export abstract class UIMovable extends UIElement {
  protected readonly selection:Selection
  protected readonly dropTarget:boolean
  private eventsImg?:dom.EventListeners
  private timerPress?:number
  private touch?:Touch
  
  constructor(el:HTMLElement, selection:Selection, dropTarget:boolean) {
    super(el)
    this.selection = selection
    this.dropTarget = dropTarget
  }
  
  abstract equalsVisually(rhs:this):boolean
  abstract is(rhs:this):boolean
  protected abstract playfield():Playfield
  
  protected init(elementClickable:EventTarget):void {
    // Adding events to a small-width div (as with cards) works fine on Chrome and FF, but iOS ignores clicks on the
    // image if it extends past the div borders. Or perhaps it's firing pointerups? That's why a specific events target
    // on the actual clickable is needed.
    this.eventsImg = new dom.EventListeners(elementClickable)

    function lpMouseUp(self:UIMovable) {
      if (self.timerPress) {
        cancel(self)
        self.onClick()
      }
      return false
    }
    
    function lpMouseDown(self:UIMovable) {
      const pf = self.playfield()
      console.debug(pf)
      self.timerPress = window.setTimeout(
        () => {
          self.timerPress = undefined
          self.touch = undefined
          self.onLongPress(pf)
        }, 500)
      return false
    }
    
    function cancel(self:UIMovable) {
      self.touch = undefined
      if (self.timerPress) {
        clearTimeout(self.timerPress)
        self.timerPress = undefined
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
    
    const filterEnd = ` opacity(${end})`
    
    if (this.element.animate) {
      const anim = this.element.animate(
        [
          { filter: ` opacity(${start})` },
          { filter: filterEnd }
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

    // Cards can't be interacted with anymore after animating. They will be replaced with new cards at the end of the
    // animation.
    this.eventsImg?.removeAll()
    if (this.selection.includes(this))
      this.selection.deselect([this])

    const kfEnd = {
      ...(HighDetail ? {zIndex: zIndexEnd.toString()} : {}),
      transform: `translate(${end[0]-start[0]}px, ${end[1] - start[1]}px)`
    }
    
    const finish = () => {
      this.element.style.transform = kfEnd.transform
      if (HighDetail) {
        this.element.style.zIndex = kfEnd.zIndex
      }
    }
    
    if (this.element.animate) {
      this.events.removeAll()
      this.eventsImg?.removeAll()
      this.element.style.position = 'absolute'
      this.element.style.left = start[0]+'px'
      this.element.style.top = start[1]+'px'
      document.body.appendChild(this.element)
      this.element.animate(
        [
          { ...(HighDetail ? {zIndex: this.element.style.zIndex || '0'} : {}),
            transform: 'translate(0px, 0px)' },
          kfEnd
        ],
        {
          duration: msDuration,
          easing: 'ease-in-out'
        }
      ).addEventListener("finish", (e) => {
        finish()
        onFinish(e)
      })
    } else {
      finish()
      onFinish()
    }
  }
  
  coordsAbsolute():Vector {
    const rectThis = this.element.getBoundingClientRect()
    return [rectThis.left + window.pageXOffset, rectThis.top + window.pageYOffset]
  }

  // playfield: Playfield at the time the longpress was started
  protected onLongPress(playfield:Playfield) {}
  
  protected onClick() {}
}

export class UISlotChip extends UIActionable {
  readonly idSlot:number
  protected children:UIChip[] = []
  private readonly cardWidth:number
  private readonly eventsSlot:dom.EventListeners
  private readonly count:HTMLLabelElement
  
  constructor(idCnt:string, selection:Selection, owner:Player|null, viewer:Player,
              playfield:Playfield, notifierSlot:NotifierSlot, idSlot:number, cardWidth:number) {

    super(document.createElement("div"), idCnt, selection, owner, viewer, playfield, notifierSlot)
    
    this.idSlot = idSlot
    this.cardWidth = cardWidth

    this.count = document.createElement("label")
    this.element.appendChild(this.count)
    
    this.element.classList.add("slot")
    this.element.classList.add("slot-overlap")
    this.element.classList.add("slot-chip")

    this.eventsSlot = new dom.EventListeners(notifierSlot.slot(this.idCnt, this.idSlot) as EventTarget)
    this.eventsSlot.add(
      "slotchange",
      (e:EventSlotChange) => {
        this.change(e.playfield_, e.playfield.containerChip(e.idCnt).slot(e.idSlot),
                    e.playfield_.containerChip(e.idCnt).slot(e.idSlot))
        return true
      }
    )
  }

  uiMovablesForSlots(slots:Slot[]):UIMovable[] {
    return Array.from(slots).some(s => this.slot().is(s)) ? this.children : []
  }
  
  change(playfield_:Playfield, slot:SlotChip|undefined, slot_:SlotChip):void {
    const chips_ = Array.from(slot_)

    let idx = this.children.length - 1
    while (idx > chips_.length - 1) {
      this.children[idx--].destroy()
    }
    
    this.children.length = chips_.length
    idx = this.children.length - 1

    while (idx >= 0) {
      const chip = chips_[idx]
      const child = this.children[idx]
      if (!child || !child.chip.is(chip)) {
        const uichip = new UIChip(this.selection, chip, this, this.cardWidth)
        uichip.init()
        
        if (HighDetail) {
          // Keep it +1 just in case transitions ever need to avoid
          // overlaying the same chip (then they can -1).
          uichip.element.style.zIndex = (idx+1).toString()
        }
                                                         
        this.children[idx] = uichip
        this.element.insertBefore(uichip.element, this.children[idx+1]?.element)
      }
      --idx
    }
    this.count.innerText = '฿' + this.children.map(ui => ui.chip.value).reduce((a,b) => a + b, 0)
  }
  
  destroy() {
    super.destroy()
    for (const child of this.children)
      child.destroy()
    this.eventsSlot.removeAll()
  }
  
  slot():SlotChip {
    return this._playfield.containerChip(this.idCnt).slot(this.idSlot)
  }

  top():UIChip|undefined {
    return this.children[this.children.length-1]
  }
  
  onClick() {
    if (this.selection.active())
      this.selection.finalize(this._playfield, this.onAction.bind(this), UIChip)
    else {
      const valueToSelect = this.top()?.chip.value
      this.selection.select(this._playfield, this.children.filter(ui => ui.chip.value == valueToSelect))
    }
    return true
  }
  
  protected onAction(selected:readonly UIChip[]) {
    assert(selected.every(ui => ui.uislot.slot() == selected[0].uislot.slot()), "Chip selection has different slots")
    const slotSrc = selected[0].uislot.slot()
    const toMove = selected
    const chipsSrc = toMove.map(ui => ui.chip)
    const slotDst = this.slot()
    if (slotSrc !== slotDst) {
      const slotSrc_ = slotSrc.remove(chipsSrc)
      const slotDst_ = slotDst.add(chipsSrc)
      const updates:UpdateSlot<SlotChip>[] = [[slotSrc, slotSrc_], [slotDst, slotDst_]]
      this.notifierSlot.slotsUpdateChip(this._playfield, this._playfield.withUpdateChip(updates), updates)
    }
  }
}

export class UIChip extends UIMovable {
  readonly chip:Chip
  readonly uislot:UISlotChip
  readonly img:HTMLImageElement

  constructor(selection:Selection, chip:Chip, uislot:UISlotChip, cardWidth:number) {
    super(document.createElement("div"), selection, true)
    this.uislot = uislot
    this.chip = chip

    this.element.classList.add("chip")

    this.img = document.createElement("img")
    this.img.width = cardWidth * 0.75
    this.img.height = cardWidth * 0.75
    this.img.src = "img/chips.svg#" + this.chip.value
    this.element.appendChild(this.img)
  }

  protected playfield():Playfield {
    return this.uislot._playfield
  }
  
  init() {
    super.init(this.img)
  }
  
  is(rhs:UIChip) {
    return this.chip.is(rhs.chip)
  }

  equalsVisually(rhs:UIChip) {
    return true
  }

  protected onClick() {
    if (this.selection.active())
      this.uislot.onClick()
    else
      this.selection.select(this.playfield(), [this])
  }
}

/*
  Assumptions: 1->1 UICard->Card on given Playfield
*/
export class UICard extends UIMovable {
  readonly wcard:WorldCard
  readonly uislot:UISlotCard
  private readonly faceUp:boolean
  private notifierSlot:NotifierSlot
  private readonly img:HTMLImageElement
  
  constructor(wcard:WorldCard, uislot:UISlotCard, dropTarget:boolean, viewer:Player, selection:Selection,
              playfield:Playfield, notifierSlot:NotifierSlot, images:Images,
              cardWidth:number, cardHeight:number, classesCard=["card"]) {
    super(document.createElement("div"), selection, dropTarget)
    this.wcard = wcard
    this.uislot = uislot
    this.notifierSlot = notifierSlot
    this.element.classList.add(...classesCard)
    this.faceUp = wcard.faceUp && (this.uislot.isViewableBy(viewer) || wcard.faceUpIsConscious)

    this.img = this.faceUp ?
      images.card(wcard.card.suit, wcard.card.rank) :
      images.cardBack.cloneNode() as HTMLImageElement

    if (wcard.turned) {
      this.element.classList.add('turned')
    }
    
    this.img.setAttribute('width', cardWidth.toString())
    this.img.setAttribute('height', cardHeight.toString())

    this.element.appendChild(this.img)
  }

  protected playfield():Playfield {
    return this.uislot._playfield
  }
  
  init():this {
    super.init(this.img)
    return this
  }

  equalsVisually(rhs:this) {
    return this.wcard.card.is(rhs.wcard.card) && this.faceUp == rhs.faceUp
  }

  is(rhs:this):boolean {
    return this.wcard.is(rhs.wcard)
  }
  
  private doMove(uicards:readonly UICard[]) {
    assert(uicards.length, "Move of no cards")
    const cardsSrc = uicards.map(ui => ui.wcard)
    const slotSrc = uicards[0].uislot.slot()
    const slotDst = this.uislot.slot()

    if (slotSrc === slotDst) {
      const slot_ = slotSrc.remove(cardsSrc).add(cardsSrc, this.wcard)
      const updates:UpdateSlot<SlotCard>[] = [[slotSrc, slot_]]
      this.notifierSlot.slotsUpdateCard(this.playfield(), this.playfield().withUpdateCard(updates), updates)
    } else {
      const slotSrc_ = slotSrc.remove(cardsSrc)
      const slotDst_ = slotDst.add(cardsSrc.map(wc => cardFaceUp(slotDst.container(this.playfield()).secret, wc)),
                                   this.wcard)
      const updates:UpdateSlot<SlotCard>[] = [[slotSrc, slotSrc_], [slotDst, slotDst_]]
      this.notifierSlot.slotsUpdateCard(this.playfield(), this.playfield().withUpdateCard(updates), updates)
    }
  }
  
  protected onClick() {
    // This logic is necessary to allow non-drop targets (single slot) to have this action fall through to the slot.
    if (this.dropTarget && this.selection.active() && !this.selection.includes(this)) {
      this.selection.finalize(this.playfield(), this.doMove.bind(this), UICard)
    } else if (this.selection.active() && this.selection.includes(this)) {
      this.selection.deselect()
    } else if (!this.selection.active()) {
      this.uislot.onCardClicked(this)
    }
  }
  
  protected onLongPress(playfield:Playfield) {
    // Playfield may have changed since press was initiated
    if (playfield == this.uislot._playfield) {
      if (this.uislot.actionLongPress == 'flip') {
        this.flip()
      } else if (this.uislot.actionLongPress == 'turn') {
        this.turn()
      }
    }
  }
  
  private flip() {
    const slot = this.uislot.slot()
    const slot_ = slot.replace(this.wcard, this.wcard.withFaceStateConscious(!this.wcard.faceUp, this.wcard.faceUp))
    const updates:UpdateSlot<SlotCard>[] = [[slot, slot_]]
    this.notifierSlot.slotsUpdateCard(this.playfield(), this.playfield().withUpdateCard(updates), updates)
  }
  
  private turn() {
    const slot = this.uislot.slot()
    const slot_ = slot.replace(this.wcard, this.wcard.withTurned(!this.wcard.turned))
    const updates:UpdateSlot<SlotCard>[] = [[slot, slot_]]
    this.notifierSlot.slotsUpdateCard(this.playfield(), this.playfield().withUpdateCard(updates), updates)
  }
}

export class Selection {
  private selected:readonly UIMovable[] = []
  private playfield:Playfield|null = null

  select(playfield:Playfield, selects:readonly UIMovable[]) {
    const deselects = this.selected.filter(s => !selects.includes(s))
    const newselects = selects.filter(s => !this.selected.includes(s))
    this.deselect(deselects)
    this.selected = selects
    this.playfield = playfield
    for (const s of newselects) s.onSelect()
  }

  deselect(selects:readonly UIMovable[]=this.selected) {
    assert(selects.every(s => this.selected.includes(s)), "Deselect of unselected elem")
    for (const s of selects) s.onDeselect()
    this.selected = this.selected.filter(s => !selects.includes(s))
  }

  finalize<T extends UIMovable>(playfield:Playfield, func:(selected:readonly T[]) => void,
                                klass:new (...args:any) => T) {
    if (playfield == this.playfield) {
      if (this.selected.every(s => s instanceof klass)) {
        if (this.selected.length > 0)
          func(this.selected as T[])
      }
    }
    this.deselect(this.selected)
    this.playfield = null
  }

  includes(s:UIMovable) {
    return this.selected.includes(s)
  }

  active() {
    return this.selected.length > 0
  }
}
