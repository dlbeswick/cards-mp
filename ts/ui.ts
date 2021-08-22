import * as array from './array.js'
import { assert, assertf } from './assert.js'
import * as dom from "./dom.js"
import { Card, Chip, ContainerSlotCard, EventContainerChange, EventMapNotifierSlot, EventPlayfieldChange,
         EventSlotChange, MoveCards, MoveChips, NotifierSlot, Player, Playfield, Slot, SlotCard, SlotChip,
         WorldCard } from './game.js'
import { Images } from './images.js'
import * as it from './iterator.js'
import { Vector } from './math.js'

const HighDetail = false

function cardFaceUp(isSecretContainer: boolean, wc: WorldCard) {
  let faceUp
  if (wc.faceUpIsConscious)
    faceUp = wc.faceUp
  else
    faceUp = !isSecretContainer
  return wc.withFaceUp(faceUp)
}

abstract class UIElement {
  readonly element: HTMLElement
  protected readonly events: dom.EventListeners

  constructor(element: HTMLElement) {
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
  private children: Array<UIActionable|UIContainer> = []

  constructor(element: HTMLElement) {
    super(element)
  }
  
  add(child: UIActionable|UIContainer): void {
    this.element.appendChild(child.element)
    this.children.push(child)
  }

  // Note that it's possible for there to be no UICard present for a card, even if all cards are on the playfield as is
  // typical.
  //
  // For example, the "single slot" view of stock may logically contain the card but a UICard will only have been
  // created for the top card.
  uiMovablesForSlots(slots: Slot[]): UIMovable[] {
    return this.children.flatMap(c => c.uiMovablesForSlots(slots))
  }

  destroy() {
    super.destroy()
    for (const child of this.children)
      child.destroy()
    this.children = []
  }

  with(f: (cnt: this) => void): this {
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
  constructor(direction: string|undefined='row', grow: boolean|string='', klass="container-flex") {
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
  readonly idCnt: string
  protected readonly owner: Player|null
  protected readonly viewer: Player
  protected readonly selection: Selection
  protected readonly notifierSlot: NotifierSlot
  private readonly eventsPlayfield: dom.EventListeners
  _playfield: Playfield
  
  constructor(element: HTMLElement, idCnt: string, selection: Selection, owner: Player|null, viewer: Player,
              playfield: Playfield, notifierSlot: NotifierSlot) {

    assert(idCnt)
    
    super(element)
    this.idCnt = idCnt
    this.owner = owner
    this.viewer = viewer
    this.selection = selection
    this._playfield = playfield
    this.notifierSlot = notifierSlot
    this.eventsPlayfield = new dom.EventListeners(this.notifierSlot.eventTarget as EventTarget)
  }

  init(): this {
    this.eventsPlayfield.add(
      "playfieldchange",
      (e: EventPlayfieldChange) => { this.onPlayfieldUpdate(e.playfield_); return true }
    )
    
    this.events.add("click", this.onClick.bind(this))
    return this
  }

  abstract uiMovablesForSlots(slots: Slot[]): UIMovable[]
  protected abstract onAction(selected: readonly UIMovable[]): void

  destroy() {
    super.destroy()
    this.eventsPlayfield.removeAll()
  }
  
  isViewableBy(viewer: Player) {
    return this.owner == null || viewer == this.owner
  }

  get isSecret() { return this.owner != null }
  
  abstract onClick(): boolean

  onPlayfieldUpdate(playfield: Playfield) {
    this._playfield = playfield
  }
}

/*
  Shows one card slot.
*/
abstract class UISlotCard extends UIActionable {
  idSlot: number
  protected children: UICard[] = []
  private readonly eventsSlot: dom.EventListeners
  
  constructor(element: HTMLElement, idCnt: string, selection: Selection, owner: Player|null, viewer: Player,
              playfield: Playfield, idSlot: number, notifierSlot: NotifierSlot, readonly images: Images,
              readonly actionLongPress='flip', private readonly selectionMode='single') {

    super(element, idCnt, selection, owner, viewer, playfield, notifierSlot)
    
    this.idSlot = idSlot

    this.element.classList.add("slot")
    
    this.eventsSlot = new dom.EventListeners(notifierSlot.slot(this.idCnt, this.idSlot) as EventTarget)
    this.eventsSlot.add(
      "slotchange",
      (e: EventSlotChange) => {
        this.change(
          e.playfield_,
          e.playfield.containerCard(e.idCnt).hasSlot(e.idCnt, e.idSlot) ?
            e.playfield.containerCard(e.idCnt).slot(e.idSlot) : undefined,
          e.playfield_.containerCard(e.idCnt).slot(e.idSlot)
        )
        
        return true
      }
    )
  }

  abstract change(playfield_: Playfield, slot: SlotCard|undefined, slot_: SlotCard): void
  
  uiMovablesForSlots(slots: Slot[]): UIMovable[] {
    return Array.from(slots).some(s => this.slot().is(s)) ? this.children : []
  }
  
  onClick() {
    if (!this.selection.active() && this.selectionMode == 'all-on-space')
      this.selection.select(this.children)
    else
      this.selection.finalize(this.onAction.bind(this), UICard)
    return true
  }
  
  destroy() {
    super.destroy()
    for (const child of this.children)
      child.destroy()
    this.eventsSlot.removeAll()
  }
  
  slot(): SlotCard {
    return this._playfield.containerCard(this.idCnt).slot(this.idSlot)
  }
  
  onCardClicked(uicard: UICard) {
    if (this.selectionMode == 'all-proceeding') {
      const selectedIdx = this.children.indexOf(uicard)
      if (selectedIdx != -1) {
        this.selection.select(this.children.slice(selectedIdx))
      }
    } else {
      this.selection.select([uicard])
    }
  }
  
  protected onAction(uiCards: readonly UICard[]) {
    const cardsSrc = uiCards.map(ui => ui.wcard)
    assert(cardsSrc.length, "Source cards empty")
    const slotSrc = uiCards[0].uislot.slot()
    const slotDst = this.slot()
    
    const move = (() => {
      if (slotSrc.is(slotDst)) {
        // case 1: same slot. Only possible outcome is move to end, otherwise drop target would be UICard.
        return new MoveCards(this._playfield.sequence, cardsSrc, slotSrc.id, slotSrc.id)
      } else {
        // case 2: diff slot. Always flip face-up, unless a human player has deliberately flipped it up or down before.
        return new MoveCards(
          this._playfield.sequence,
          cardsSrc.map(wc => cardFaceUp(slotDst.container(this._playfield).secret, wc)),
          slotSrc.id,
          slotDst.id
        )
      }
    })()
    
    
    this.notifierSlot.move(move)
  }
}

/*
  Shows the topmost card of a single slot and a card count.
*/
export class UISlotSingle extends UISlotCard {
  readonly count: HTMLElement
  private elCard: HTMLElement;
  
  constructor(idCnt: string, selection: Selection, owner: Player|null, viewer: Player, playfield: Playfield,
              idSlot: number, notifierSlot: NotifierSlot, images: Images, private readonly cardWidth: number,
              private readonly cardHeight: number, actionLongPress='flip', action?: [string, () => boolean]) {
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
  
  change(playfield_: Playfield, slot: SlotCard|undefined, slot_: SlotCard): void {
    if (slot_.isEmpty()) {
      const space = this.spaceMake()
      this.elCard.replaceWith(space)
      this.elCard = space
      this.children = []
    } else {
      const card = new UICard(
        slot_.top(), this, false, this.viewer, this.selection, this.notifierSlot, this.images,
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
  private classesCard: string[]
  private containerEl: HTMLElement
  private cardWidth: number
  private cardHeight: number
  
  constructor(idCnt: string, selection: Selection, owner: Player|null, viewer: Player, playfield: Playfield, idSlot: number,
              notifierSlot: NotifierSlot, images: Images, cardWidth: number, cardHeight: number,
              width?: string, classesSlot?: string[], classesCard?: string[], actionLongPress='flip',
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

  change(playfield_: Playfield, slot: SlotCard|undefined, slot_: SlotCard): void {
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
        const uicard = new UICard(wcard, this, true, this.viewer, this.selection, this.notifierSlot,
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
  private readonly eventsContainer: dom.EventListeners
  
  constructor(element: HTMLElement, idCnt: string, selection: Selection, owner: Player|null, viewer: Player,
              playfield: Playfield, notifierSlot: NotifierSlot) {
    super(element, idCnt, selection, owner, viewer, playfield, notifierSlot)

    this.eventsContainer = new dom.EventListeners(this.notifierSlot.container(this.idCnt) as EventTarget)
    this.eventsContainer.add(
      "containerchange",
      (e: EventContainerChange) => {
        this.change(e.playfield_, e.playfield.containerCard(e.idCnt), e.playfield_.containerCard(e.idCnt))
        return true
      }
    )
  }

  abstract change(playfield_: Playfield, cnt: ContainerSlotCard, cnt_: ContainerSlotCard): void

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
  private children: UISlotCard[] = []
  
  constructor(idCnt: string, selection: Selection, owner: Player|null, viewer: Player, playfield: Playfield,
              notifierSlot: NotifierSlot, private readonly images: Images, private readonly cardWidth: number,
              private readonly cardHeight: number, height: string, private readonly actionLongPress='flip') {
    super(document.createElement("div"), idCnt, selection, owner, viewer, playfield, notifierSlot)

    this.element.classList.add("slot")
    this.element.classList.add("slot-multi")
    this.element.style.minHeight = height
  }

  uiMovablesForSlots(slots: Slot[]): UIMovable[] {
    return this.children.flatMap(uis => uis.uiMovablesForSlots(slots))
  }
  
  onClick() {
    this.selection.finalize(this.onAction.bind(this), UICard)
    return true
  }
  
  onAction(selected: readonly UICard[]) {
    const cardsSrc = selected.map(ui => ui.wcard)
    const cardsDst = cardsSrc.map(wc => cardFaceUp(false, wc))
    const slotSrc = selected[0].uislot.slot()
    const cnt: ContainerSlotCard = this._playfield.containerCard(this.idCnt)
    const slotNewId = [cnt.id, (this.children[this.children.length-1]?.idSlot ?? -1) + 1] as [string, number]

    const move = new MoveCards(this._playfield.sequence, cardsDst, slotSrc.id, slotNewId, undefined, [slotNewId])
    this.notifierSlot.move(move)
  }
  
  change(playfield_: Playfield, cnt: ContainerSlotCard, cnt_: ContainerSlotCard): void {
    // Note, this only catches additions and deletions.
    // If the contents of any of the slots in a container have changed, then it won't be corrected here.
    // That must be picked up by a lot change event.
    const removed = it.filter(cnt, slot => !cnt_.hasSlot(slot.idCnt, slot.idSlot))
    
    for (const slot of removed) {
      const ui = this.children.find(ui => ui.slot().is(slot))
      if (ui) {
        ui.destroy()
        this.children = array.remove(this.children, ui)
      }
    }
    
    for (const slot of cnt_) {
      const ui = this.children.find(ui => ui.slot().is(slot))
      if (!ui) {
        const uislot = new UISlotSpread(
          cnt.id,
          this.selection,
          this.owner,
          this.viewer,
          playfield_,
          slot.idSlot,
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
        uislot.change(playfield_, cnt.hasSlot(slot.idCnt, slot.idSlot) ? cnt.slot(slot.idSlot) : undefined, slot)
        this.element.appendChild(uislot.element)
        this.children.push(uislot)
      }
    }
  }
}

export abstract class UIMovable extends UIElement {
  protected readonly selection: Selection
  protected readonly dropTarget: boolean
  private eventsImg?: dom.EventListeners
  private timerPress?: number
  private touch?: Touch
  private wasMouseDown = false
  private _isInPlay: boolean = true
  
  constructor(el: HTMLElement, selection: Selection, dropTarget: boolean) {
    super(el)
    this.selection = selection
    this.dropTarget = dropTarget
  }
  
  abstract equalsVisually(rhs: this): boolean
  abstract is(rhs: this): boolean

  // The relative importance of this movable's location in terms of player's interest in the game state.
  // I.e. if in a player's secret hand, then it has a very low important as others can't see it anyway, and any moves
  // made will be visible to the player whose hand it is.
  // Used to determine what kinds of sounds to play when the element moves around.
  abstract get locationImportance(): number

  isInPlay(): boolean { return this._isInPlay }
  removeFromPlay(): void {
    if (this.selection.includes(this))
      this.selection.deselect([this])
    this._isInPlay = false
  }
  
  protected abstract playfield(): Playfield
  
  init(): this {
    this.eventsImg = new dom.EventListeners(this.interactionElement)

    function lpMouseUp(self: UIMovable) {
      if (self.timerPress) {
        cancel(self)
        self.onClick()
      }
      return true
    }
    
    function lpMouseDown(self: UIMovable) {
      const pf = self.playfield()
      self.timerPress = window.setTimeout(
        () => {
          cancel(self)
//          window.alert("longpress")
          self.timerPress = undefined
          self.onLongPress(pf)
        }, 500)
      return true
    }
    
    function cancel(self: UIMovable) {
      self.touch = undefined
      self.wasMouseDown = false
      if (self.timerPress) {
        clearTimeout(self.timerPress)
        self.timerPress = undefined
      }
      return true
    }

    assert(this.eventsImg, "Failed to call init")
    
    // Touch events here must both allow longpress and not block scrolling. "touchstart" return true, so 
    // mouse events will also then be processed by the browser. This code must ignore them where required.
    // Using 'preventDefault' in touchstart would block scrolling.
    // Also, note that 'mousedown/mouseup' isn't actually sent until the user lifts their finger.
    //
    // A weird sequence takes place on WebKit, watch out for this:
    // 1. User longpresses.
    // 2. Card flips.
    // 3. New card element gets no touch events, no mouseup, mousedown, etc, just like other browsers.
    // 4. Unlike other browsers, as soon as the user lifts their finger then "mousedown" and "mouseup" are sent,
    //    immediately selecting the new element.
    this.eventsImg.add("mousedown", () => {
      if (!this.touch && this.selection.lastTouchedId != this.itemId) {
        this.wasMouseDown = true
        lpMouseDown(this)
      }
      return false
    } )
    
    this.eventsImg.add("mouseup", () => {
      if (this.wasMouseDown && this.selection.lastTouchedId != this.itemId) {
        lpMouseUp(this)
        this.wasMouseDown = false
      } else {
        this.selection.lastTouchedId = ""
      }
      return false
    })
    this.eventsImg.add("mouseout", () => cancel(this))
    
    this.eventsImg.add(
      "touchstart",
      (e: TouchEvent) => {
        // This unfortunate variable is the fix for that weird WebKit behaviour described above.
        this.selection.lastTouchedId = this.itemId
        this.touch = e.touches[0]
        lpMouseDown(this)
      },
      {"passive": true}
    )
    
    this.eventsImg.add(
      "touchmove",
      (e: TouchEvent) => {
        if (!this.touch || Math.abs(e.touches[0].screenY - this.touch.screenY) > 5)
          cancel(this)
      },
      {"passive": true}
    )
    
    this.eventsImg.add("touchend", () => {
      if (this.touch)
        lpMouseUp(this)
      
      this.selection.lastTouchedId = ""

      return false
    })

    // Stop slots acting on mouse events that this element has acted on.
    this.eventsImg.add("click",
                       () => !(this.dropTarget || !this.selection.active() || this.selection.includes(this)))

    return this
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

  fadeTo(start: string, end: string, msDuration: number, onFinish: (e?: Event) => void = (e) => {}) {
    
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
  
  animateTo(start: Vector, end: Vector, zIndexEnd: number, msDuration: number,
            onFinish: (e?: Event) => void = (e) => {}) {

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
      if (kfEnd.zIndex) {
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
  
  coordsAbsolute(): Vector {
    const rectThis = this.element.getBoundingClientRect()
    return [rectThis.left + window.pageXOffset, rectThis.top + window.pageYOffset]
  }

  // playfield: Playfield at the time the longpress was started
  protected onLongPress(playfield: Playfield) {}
  
  protected onClick() {}

  protected abstract get itemId(): string

  // FF and Chrome are happy to allow the user to select visible elements that extended beyond the bounds of their
  // parent, as the cards in a stack are.
  // WebKit seems to have problem with that, however. This method should generally return the overflowing child element
  // to get around this issue.
  protected abstract get interactionElement(): HTMLElement
}

export class UISlotChip extends UIActionable {
  readonly idSlot: number
  protected children: UIChip[] = []
  private readonly cardWidth: number
  private readonly eventsSlot: dom.EventListeners
  private readonly count: HTMLLabelElement
  
  constructor(idCnt: string, selection: Selection, owner: Player|null, viewer: Player,
              playfield: Playfield, notifierSlot: NotifierSlot, idSlot: number, cardWidth: number) {

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
      (e: EventSlotChange) => {
        this.change(e.playfield_, e.playfield.containerChip(e.idCnt).slot(e.idSlot),
                    e.playfield_.containerChip(e.idCnt).slot(e.idSlot))
        return true
      }
    )
  }

  uiMovablesForSlots(slots: Slot[]): UIMovable[] {
    return Array.from(slots).some(s => this.slot().is(s)) ? this.children : []
  }
  
  change(playfield_: Playfield, slot: SlotChip|undefined, slot_: SlotChip): void {
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
  
  slot(): SlotChip {
    return this._playfield.containerChip(this.idCnt).slot(this.idSlot)
  }

  top(): UIChip|undefined {
    return this.children[this.children.length-1]
  }
  
  onClick() {
    if (this.selection.active())
      this.selection.finalize(this.onAction.bind(this), UIChip)
    else {
      const valueToSelect = this.top()?.chip.value
      this.selection.select(this.children.filter(ui => ui.chip.value == valueToSelect))
    }
    return true
  }
  
  protected onAction(selected: readonly UIChip[]) {
    assert(selected.every(ui => ui.uislot.slot() == selected[0].uislot.slot()), "Chip selection has different slots")
    const slotSrc = selected[0].uislot.slot()
    const toMove = selected
    const chipsSrc = toMove.map(ui => ui.chip)
    const slotDst = this.slot()
    if (!slotSrc.is(slotDst)) {
      this.notifierSlot.move(new MoveChips(this._playfield.sequence, chipsSrc, slotSrc.id, slotDst.id))
    }
  }
}

export class UIChip extends UIMovable {
  readonly chip: Chip
  readonly uislot: UISlotChip
  readonly img: HTMLDivElement

  constructor(selection: Selection, chip: Chip, uislot: UISlotChip, cardWidth: number) {
    super(document.createElement("div"), selection, true)
    this.uislot = uislot
    this.chip = chip

    this.element.classList.add("chip")

    this.img = document.createElement("div")
    this.img.style.width = cardWidth * 0.75 + 'px'
    this.img.style.height = cardWidth * 0.75 + 'px'
    this.img.style.content = "url(img/chips.svg#" + this.chip.value + ")"
    this.element.appendChild(this.img)
  }

  protected playfield(): Playfield {
    return this.uislot._playfield
  }
  
  is(rhs: UIChip) {
    return this.chip.is(rhs.chip)
  }

  equalsVisually(rhs: UIChip) {
    return true
  }

  protected onClick() {
    if (this.selection.active())
      this.uislot.onClick()
    else
      this.selection.select([this])
  }

  protected get itemId() { return this.chip.id.toString() }
  protected get interactionElement() { return this.img }
  get locationImportance() { return 0 }
}

/*
  Assumptions: 1->1 UICard->Card on given Playfield
*/
export class UICard extends UIMovable {
  readonly wcard: WorldCard
  readonly uislot: UISlotCard
  private readonly faceUp: boolean
  private notifierSlot: NotifierSlot
  private readonly img: HTMLDivElement
  
  constructor(wcard: WorldCard, uislot: UISlotCard, dropTarget: boolean, viewer: Player, selection: Selection,
              notifierSlot: NotifierSlot, images: Images,
              cardWidth: number, cardHeight: number, classesCard=["card"]) {
    super(document.createElement("div"), selection, dropTarget)
    this.wcard = wcard
    this.uislot = uislot
    this.notifierSlot = notifierSlot
    this.element.classList.add(...classesCard)
    this.faceUp = wcard.faceUp && (this.uislot.isViewableBy(viewer) || wcard.faceUpIsConscious)

    this.img = this.faceUp ?
      images.card(wcard.card.suit, wcard.card.rank) :
      images.cardBack.cloneNode() as HTMLDivElement

    if (wcard.turned) {
      this.element.classList.add('turned')
    }
    
    this.img.style.width = cardWidth + 'px'
    this.img.style.height = cardHeight + 'px'

    this.element.appendChild(this.img)
  }

  protected playfield(): Playfield {
    return this.uislot._playfield
  }
  
  equalsVisually(rhs: this) {
    return this.wcard.card.is(rhs.wcard.card) && this.faceUp == rhs.faceUp
  }

  is(rhs: this): boolean {
    return this.wcard.is(rhs.wcard)
  }
  
  private doMove(uicards: readonly UICard[]) {
    assert(uicards.length, "Move of no cards")
    const cardsSrc = uicards.map(ui => ui.wcard)
    const slotSrc = uicards[0].uislot.slot()
    const slotDst = this.uislot.slot()

    const move = (() => {
      if (slotSrc.is(slotDst)) {
        return new MoveCards(this.playfield().sequence, cardsSrc, slotSrc.id, slotSrc.id, this.wcard)
      } else {
        return new MoveCards(
          this.playfield().sequence, 
          cardsSrc.map(wc => cardFaceUp(slotDst.container(this.playfield()).secret, wc)),
          slotSrc.id,
          slotDst.id,
          this.wcard
        )
      }
    })()
    
    this.notifierSlot.move(move)
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
  
  protected onLongPress(playfield: Playfield) {
    // Playfield may have changed since press was initiated
    if (playfield == this.uislot._playfield) {
      if (this.uislot.actionLongPress == 'flip') {
        this.flip()
      } else if (this.uislot.actionLongPress == 'turn') {
        this.turn()
      } else {
        assert("Unknown longpress action", this.uislot.actionLongPress)
      }
    }
  }
  
  private flip() {
    const move = new MoveCards(
      this.playfield().sequence,
      [this.wcard.withFaceStateConscious(!this.wcard.faceUp, this.wcard.faceUp)],
      this.uislot.slot().id,
      this.uislot.slot().id,
      this.uislot.slot().next(this.wcard)
    )
    this.notifierSlot.move(move)
  }
  
  private turn() {
    const move = new MoveCards(
      this.playfield().sequence,
      [this.wcard.withTurned(!this.wcard.turned)],
      this.uislot.slot().id,
      this.uislot.slot().id,
      this.uislot.slot().next(this.wcard)
    )
    this.notifierSlot.move(move)
  }

  protected get itemId() { return this.wcard.id.toString() }
  protected get interactionElement() { return this.img }
  get locationImportance() {
    if (this.uislot.isSecret)
      return 0
    else
      return 1
  }
}

export class Selection {
  private selected: readonly UIMovable[] = []
  lastTouchedId = ""

  select(selects: readonly UIMovable[]) {
    const deselects = this.selected.filter(s => !selects.includes(s))
    const newselects = selects.filter(s => !this.selected.includes(s))
    this.deselect(deselects)
    this.selected = selects
    for (const s of newselects) s.onSelect()
  }

  deselect(selects: readonly UIMovable[]=this.selected) {
    assert(selects.every(s => this.selected.includes(s)), "Deselect of unselected elem")
    for (const s of selects) s.onDeselect()
    this.selected = this.selected.filter(s => !selects.includes(s))
  }

  finalize<T extends UIMovable>(func: (selected: readonly T[]) => void, klass: new (...args: any) => T) {
    if (this.selected.length > 0) {
      if (this.isConsistent()) {
        if (this.selected.every(s => s instanceof klass)) {
          if (this.selected.length > 0)
            func(this.selected as T[])
        }
      } else {
        console.debug("Some elements of selection inconsistent with current playfield, selection not finalized")
      }
      
      this.deselect(this.selected)
    }
  }

  includes(s: UIMovable) {
    return this.selected.includes(s)
  }

  active() {
    return this.selected.length > 0
  }

  private isConsistent() {
    return this.selected.every(m => m.isInPlay())
  }
}
