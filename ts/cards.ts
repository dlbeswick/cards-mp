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
    return { ...super.serialize(), ...this.cards.map(c => c.serialize()) }
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
  }

  init():void {
    this.element.addEventListener("dragenter", this.onDragEnter.bind(this))
    this.element.addEventListener("drop", this.onDrop.bind(this))
    this.element.addEventListener("dragover", this.onDragOver.bind(this))
    this.element.addEventListener("dragleave", this.onDragLeave.bind(this))
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

  onDrop(e:DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    this.element.classList.remove("dragged-over")
    const dragData = e.dataTransfer.getData("application/json")
    console.debug(JSON.stringify(dragData))
    if (dragData) {
      const msg = JSON.parse(dragData)
      const cardSrc = this.app.playfieldGet().wcard(msg.card.id)
      const slotSrc = this.app.playfieldGet().slotForCard(cardSrc)
      const slotDst = this.app.playfieldGet().slot(this.idSlot)
      // Two playfield mutates to simplify logic/reduce object creation? Or one mutate?
      if (slotSrc.is(slotDst)) {
        // case 1: same slot. Only possible outcome is move to end, otherwise drop target would be UICard.
        const slotSrc_ = slotSrc.remove([cardSrc]).add([cardSrc])
        this.app.playfieldGet().slotsUpdate([[slotSrc, slotSrc_]], this.app.notifierSlot)
      } else {
        // case 2: diff slot. flip
        const cardSrc = this.app.playfieldGet().wcard(msg.card.id)
        const slotSrc_ = slotSrc.remove([cardSrc])
        const slotDst_ = slotDst.add([cardSrc.withFaceUp(true)])
        this.app.playfieldMutate(
          this.app.playfieldGet().slotsUpdate([[slotSrc, slotSrc_], [slotDst, slotDst_]], this.app.notifierSlot)
        )
      }
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
    this.element.setAttribute("style", `display: inline-block; width: ${width}; min-height: ${height}; border: 1px black`)
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
    this.element.setAttribute("style", `display: inline-block; width: ${width}; min-height: ${height}; border: 1px black`)
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
  private app:App
  
  constructor(wcard:WorldCard, uislot:UISlot, app:App, dropTarget:boolean, viewer:Player) {
    
    this.app = app
    this.wcard = wcard
    this.uislot = uislot
    
    this.element = document.createElement("div")
    this.element.setAttribute("style", "display: inline-block")

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
    svg.setAttribute('width', '74')
    svg.setAttribute('height', '112')

    this.element.setAttribute("draggable", "true")
    this.element.addEventListener("dragstart", this.onDragStart.bind(this))
//    this.element.addEventListener("drag", this.onDrag.bind(this))
    this.element.addEventListener("dragend", this.onDragEnd.bind(this))

    if (dropTarget) {
      this.element.addEventListener("dragenter", this.onDragEnter.bind(this))
      this.element.addEventListener("drop", this.onDrop.bind(this))
      this.element.addEventListener("dragleave", this.onDragLeave.bind(this))
    }

    this.element.addEventListener("dblclick", this.onDblClick.bind(this))
  }

  detach() {
    this.element.parentNode.removeChild(this.element)
  }
  
  attach(parent:HTMLElement) {
    console.assert(!this.element.parentNode)
    parent.appendChild(this.element)
  }

  private onDblClick(e:DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    
    const slot = this.uislot.slot(this.app.playfieldGet())
    const slot_ = slot.replace(this.wcard, this.wcard.withFaceUp(!this.wcard.faceUp))
    this.app.playfieldGet().slotsUpdate([[slot, slot_]], this.app.notifierSlot)
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
      const cardSrc = this.app.playfieldGet().wcard(msg.card.id)
      // Two playfield mutates to simplify logic/reduce object creation? Or one mutate?
      if (!cardSrc.card.is(this.wcard.card)) {
        const slotSrc = this.app.playfieldGet().slotForCard(cardSrc)
        const slotDst = this.uislot.slot(this.app.playfieldGet())

        if (slotSrc.is(slotDst)) {
          // case 1: same slot. Only possible outcome is move to end.
          const slot = this.app.playfieldGet().slotForCard(cardSrc)
          const slot_ = slot.remove([cardSrc]).add([cardSrc], this.wcard.card)
          this.app.playfieldGet().slotsUpdate([[slot, slot_]], this.app.notifierSlot)
        } else {
          // case 2: diff slot. flip
          const slotSrc_ = slotSrc.remove([cardSrc])
          const slotDst_ = slotDst.add([cardSrc])
          this.app.playfieldMutate(
            this.app.playfieldGet().slotsUpdate([[slotSrc, slotSrc_], [slotDst, slotDst_]], this.app.notifierSlot)
          )
        }
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
  private slots:Slot[]

  constructor(slots:Slot[]) {
    this.slots = slots
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
  
  slotsUpdate(slots:[Slot, Slot][], notifierSlot:NotifierSlot):Playfield {
    assert(slots.every(([slot, _slot]) => slot.is(_slot) && this.slots.find(s => s.is(slot))))
    for (const [slot, slot_] of slots) {
      notifierSlot.events[slot.id].dispatchEvent(new EventSlotChange(slot, slot_))
    }
    return new Playfield(
      this.slots.filter(s => !slots.some(([slot,_]) => slot.is(s))).concat(slots.map(([_,slotNew]) => slotNew))
    )
  }
}

class App {
  receiveChannel:any
  sendChannel:any
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

async function host(app:App) {
  function handleReceiveMessage(event) {
    console.debug(event.data);
  }
  
  function receiveChannelCallback(event) {
    app.receiveChannel = event.channel;
    app.receiveChannel.onmessage = handleReceiveMessage;
    app.receiveChannel.onopen = handleReceiveChannelStatusChange;
    app.receiveChannel.onclose = handleReceiveChannelStatusChange;
  }

  function handleSendChannelStatusChange(event) {
    if (app.sendChannel) {
      var state = app.sendChannel.readyState;
        console.debug(state)
      
      if (state === "open") {
        app.sendChannel.send("Hello")
      }
    }
  }

  function handleReceiveChannelStatusChange(event) {
    if (app.receiveChannel) {
      console.log("Receive channel's status has changed to " +
                  app.receiveChannel.readyState);
    }
  }

  const localConnection = new RTCPeerConnection({iceServers: [{urls: "stun:stun.l.google.com:19302"}]})  

  app.sendChannel = localConnection.createDataChannel("sendChannel")
  app.sendChannel.onopen = handleSendChannelStatusChange
  app.sendChannel.onclose = handleSendChannelStatusChange
  
  const remoteConnection = new RTCPeerConnection({iceServers: [{urls: "stun:stun.l.google.com:19302"}]})  
  remoteConnection.ondatachannel = receiveChannelCallback

  localConnection.onicecandidate = e => {
    console.debug("Local candidate")
    console.debug(e.candidate)
    if (e.candidate) {
//      remoteConnection.addIceCandidate(e.candidate)
      remoteConnection.addIceCandidate({
  "candidate": "candidate:1 1 UDP 1686052863 203.59.118.63 36937 typ srflx raddr 0.0.0.0 rport 0",
  "sdpMid": "0",
  "sdpMLineIndex": 0,
  "usernameFragment": "237a7cd8"
})
    }
  }
  remoteConnection.onicecandidate = e => {
    console.debug("Remote candidate")
    console.debug(e.candidate)
    if (e.candidate) {
//      localConnection.addIceCandidate(e.candidate)
      localConnection.addIceCandidate({
  "candidate": "candidate:1 1 UDP 1686052863 203.59.118.63 33198 typ srflx raddr 0.0.0.0 rport 0",
  "sdpMid": "0",
  "sdpMLineIndex": 0,
  "usernameFragment": "04bde3b0"
})
    }
  }

  const offer = await localConnection.createOffer()
  await localConnection.setLocalDescription(offer)
  console.debug("Offer")
  console.debug(offer.sdp)
  await remoteConnection.setRemoteDescription(localConnection.localDescription)
  const answer = await remoteConnection.createAnswer()
  await remoteConnection.setLocalDescription(answer)
  console.debug("Answer")
  console.log(answer.sdp)
  await localConnection.setRemoteDescription(remoteConnection.localDescription)
}

function run(urlCardImages:string, urlCardBack:string) {
  let playfield = new Playfield(
    [new Slot("p0"),
     new Slot("p1"),
     new Slot("stock"),
     new Slot("waste")]
  )

  const app = new App(playfield, new NotifierSlot(), urlCardImages, urlCardBack)

  document.getElementById("host").addEventListener("click", () => host(app))
  
  const p0 = new Player()
  const p1 = new Player()
  
  const deck = shuffled(deck52())
  const root = new UISlotRoot()
  const uislotP1 = new UISlotFullWidth('p1', app, p1, p0, '112px')
  uislotP1.init()
  root.add(uislotP1)
  const uislotWaste = new UISlotFullWidth('waste', app, null, p0, 112*1.5+'px','75%')
  uislotWaste.init()
  root.add(uislotWaste)
  const uislotStock = new UISlotSingle('stock', app, null, p0, 112*1.5+'px','25%')
  uislotStock.init()
  root.add(uislotStock)
  const uislotP0 = new UISlotFullWidth('p0', app, p0, p0, '112px')
  uislotP0.init()
  root.add(uislotP0)

  let sold = playfield.slot("p0")
  let snew = sold.add(deck.slice(0,10).map(c => new WorldCard(c, true)))
  playfield = playfield.slotsUpdate([[sold, snew]], app.notifierSlot)

  sold = playfield.slot("p1")
  snew = sold.add(deck.slice(10,20).map(c => new WorldCard(c, true)))
  playfield = playfield.slotsUpdate([[sold,snew]], app.notifierSlot)

  sold = playfield.slot("stock")
  snew = sold.add(deck.slice(20).map(c => new WorldCard(c, false)))
  playfield = playfield.slotsUpdate([[sold,snew]], app.notifierSlot)

  app.playfieldMutate(playfield)
}

document.addEventListener("deviceready", () => {
  run("img/cards.svg", "img/back.svg")
})
