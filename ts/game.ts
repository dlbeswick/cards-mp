import { assert, assertf } from './assert.js'
import * as array from './array.js'
import * as dom from './dom.js' // remove this
import { Vector } from './math.js'

export type UpdateSlot<S extends Slot> = [S|undefined, S]

export function aryIdEquals<T extends Identified>(lhs:T[], rhs:T[]) {
  if (lhs.length != rhs.length)
    return false

  for (let i = 0; i < lhs.length; ++i)
    if (!lhs[i].is(rhs[i]))
      return false
  
  return true
}

interface Identified {
  is(rhs:this):boolean
  serialize():any
}

abstract class IdentifiedByVal<IdType> implements Identified {
  abstract id():IdType
  
  is(rhs:this):boolean {
    return this.isId(rhs.id())
  }
  
  isId(id:IdType):boolean {
    return this.id() == id
  }

  serialize(): any {
    return { id: this.id() }
  }
}

abstract class IdentifiedVar<IdType=string> extends IdentifiedByVal<IdType> {
  private readonly _id:IdType

  constructor(id:IdType) {
    super()
    this._id = id
  }

  id():IdType {
    return this._id
  }
}

abstract class ContainerSlot<S extends SlotItem<T>, T extends ItemSlot> extends IdentifiedVar implements Iterable<S> {

  readonly secret:boolean
  private readonly slots:readonly S[] = []
  private readonly construct:(id:string,slots:readonly S[],secret:boolean) => this
  
  constructor(id:string, construct:(id:string,slots:readonly S[],secret:boolean) => any, slots:readonly S[],
              secret:boolean) {
    super(id)
    this.slots = slots
    this.secret = secret
    this.construct = construct
  }

  serialize():any {
    return { ...super.serialize(), slots: this.slots.map(s => s.serialize()), secret: this.secret }
  }

  first():S {
    assert(this.slots, "No first of empty slot")
    return this.slots[0]
  }
  
  add(slots:S[]):this {
    return this.construct(this.id(), this.slots.concat(slots), this.secret)
  }

  slot(id:number):S {
    const slot = this.slots.find(s => s.isId(id, this.id()))
    assert(slot, "No slot of id", id)
    return slot
  }
  
  clear():this {
    return this.construct(this.id(), [], this.secret)
  }
  
  isEmpty():boolean {
    return this.slots.every(s => s.isEmpty())
  }
  
  hasSlot(id:number, idCnt:string):boolean {
    return this.isId(idCnt) && this.slots.some(s => s.isId(id, idCnt))
  }
  
  lengthSlots():number {
    return this.slots.length
  }
  
  length():number {
    return this.slots.reduce((a, s) => a + s.length(), 0)
  }
  
  map(f: (c: T) => T):UpdateSlot<S>[] {
    return this.slots.map(s => [s, s.map(f)])
  }

  update(update:UpdateSlot<S>):this {
    const [slot, slot_] = update

    if (this.isId(slot_.idCnt)) {
      if (slot) {
        const idx = this.slots.findIndex(s => s.is(slot))
        assert(idx != -1, "Slot not found in update", slot.id, slot.idCnt)
        return this.construct(
          this.id(),
          this.slots.slice(0, idx).concat([slot_] as S[]).concat(this.slots.slice(idx+1)),
          this.secret
        )
      } else {
        return this.construct(this.id(), this.slots.concat([slot_] as S[]), this.secret)
      }
    } else {
      return this
    }
  }

  [Symbol.iterator]():Iterator<S> {
    return this.slots[Symbol.iterator]()
  }
}

// Note: id is only unique within a container
export abstract class Slot implements Identified {
  readonly id:number
  readonly idCnt:string

  constructor(id:number, idCnt:string) {
    this.id = id
    this.idCnt = idCnt
  }
  
  abstract isEmpty():boolean
  abstract length():number

  is(rhs:Slot) {
    return this.isId(rhs.id, rhs.idCnt)
  }

  isId(id:number, idCnt:string) {
    return this.id == id && this.idCnt == idCnt
  }
  
  serialize():any {
    return { id: this.id, idCnt: this.idCnt }
  }
}

// An item within a slot
export interface ItemSlot extends Identified {
  serialize():any
}

abstract class SlotItem<T extends ItemSlot> extends Slot implements Iterable<T> {
  protected readonly items:readonly T[]
  private readonly construct:(a:number, b:string, c:readonly T[]) => this

  constructor(id:number, construct:(a:number, b:string, c:readonly T[]) => any, idCnt:string, items:readonly T[]) {
    super(id, idCnt)
    this.items = items
    this.construct = construct
  }

  serialize() {
    return { ...super.serialize(), items: this.items.map(c => c.serialize()), idCnt: this.idCnt }
  }
  
  add(items:T[], before?:T):this {
    const idx = (() => {
      if (before) {
        const result = this.items.findIndex(i => i.is(before))
        assert(result != -1, "No 'before' elem", before)
        return result
      } else {
        return this.items.length
      }
    })()
    
    assert(items.every(i => !this.items.some(i2 => i.is(i2))), "Re-add of item to slot")
    assertf(() => idx >= 0 && idx <= this.items.length)
    return this.construct(this.id, this.idCnt, this.items.slice(0, idx).concat(items).concat(this.items.slice(idx)))
  }

  remove(items:T[]):this {
    if (items.length) {
      assertf(() => items.every(i => this.items.some(i2 => i2.is(i))), "Some items to be removed not found in slot")
      return this.construct(this.id, this.idCnt, this.items.filter(i => !items.some(i2 => i2.is(i))))
    } else {
      return this
    }
  }

  replace(item:T, item_:T):this {
    const idx = this.items.findIndex(i => i.is(item))
    assertf(() => idx != -1, "Item to be replaced not found in slot")
    return this.construct(this.id, this.idCnt, this.items.slice(0, idx).concat([item_]).concat(this.items.slice(idx+1)))
  }

  top():T {
    assertf(() => !this.isEmpty())
    return this.items[this.items.length-1]
  }

  isEmpty():boolean {
    return this.items.length == 0
  }

  item(idx:number):T {
    assertf(() => idx >= 0 && idx < this.items.length)
    return this.items[idx]
  }

  length():number {
    return this.items.length
  }

  hasItem(item:T):boolean {
    return this.items.some(i => i.is(item))
  }

  map(f: (c: T) => T):this {
    return this.construct(this.id, this.idCnt, this.items.map(f))
  }
  
  [Symbol.iterator]():Iterator<T> {
    return this.items[Symbol.iterator]()
  }
}

export class SlotCard extends SlotItem<WorldCard> {
  constructor(id:number, idCnt:string, cards:readonly WorldCard[] = []) {
    super(id, (id,idCnt,cards) => new SlotCard(id, idCnt, cards), idCnt, cards)
  }

  static fromSerialized(serialized:any) {
    return new SlotCard(serialized.id, serialized.idCnt, serialized.items.map((c:any) => WorldCard.fromSerialized(c)))
  }

  container(playfield:Playfield):ContainerSlotCard {
    return playfield.container(this.idCnt)
  }

  findById(id:string):WorldCard|undefined {
    return this.items.find(i => i.isId(id))
  }
}

export class ContainerSlotCard extends ContainerSlot<SlotCard, WorldCard> {
  constructor(id:string, slots:readonly SlotCard[]=[], secret=false) {
    super(id, (id,slots,secret) => new ContainerSlotCard(id,slots,secret), slots, secret)
  }
  
  static fromSerialized(s:any) {
    return new ContainerSlotCard(s.id, s.slots.map((c:any) => SlotCard.fromSerialized(c)), s.secret)
  }
}

export class Player extends IdentifiedVar {
  readonly idCnts:string[]
  
  constructor(id:string, idCnts:string[]) {
    super(id)
    this.idCnts = idCnts
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

export class Card extends IdentifiedVar {
  readonly suit:number
  readonly rank:number
    
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

export class WorldCard extends IdentifiedByVal<string> {
  readonly card:Card
  readonly faceUp:boolean
  readonly faceUpIsConscious:boolean
  readonly turned:boolean

  constructor(card:Card, faceUp:boolean, faceUpIsConscious=false, turned=false) {
    super()
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

  id() {
    return this.card.id()
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

export class EventSlotChange extends Event {
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
}

export class EventContainerChange<S extends Slot> extends Event {
  readonly playfield:Playfield
  readonly playfield_:Playfield
  readonly updates:UpdateSlot<S>[]
  readonly idCnt:string
  
  constructor(playfield:Playfield, playfield_:Playfield, idCnt:string, updates:UpdateSlot<S>[]) {
    super('containerchange')
    this.playfield = playfield
    this.playfield_ = playfield_
    this.updates = updates
    this.idCnt = idCnt
  }
}

export class EventPingBack extends Event {
  readonly secs:number
  
  constructor(secs:number) {
    super('pingback')
    this.secs = secs
  }
}

export class EventPeerUpdate extends Event {
  readonly peers:PeerPlayer[]
  
  constructor(peers:PeerPlayer[]) {
    super('peerupdate')
    this.peers = peers
  }
}

export class EventPlayfieldChange extends Event {
  readonly playfield:Playfield
  readonly playfield_:Playfield

  constructor(playfield:Playfield, playfield_:Playfield) {
    super('playfieldchange')
    this.playfield = playfield
    this.playfield_ = playfield_
  }
}

export interface EventMapNotifierSlot<S extends Slot> {
  "slotchange": EventSlotChange,
  "containerchange": EventContainerChange<S>,
  "playfieldchange": EventPlayfieldChange
}

interface EventTargetNotifierSlot {
  addEventListener<S extends Slot, K extends keyof EventMapNotifierSlot<S>>(type: K, listener: (ev: EventMapNotifierSlot<S>[K]) => any): void
  dispatchEvent(event:Event):boolean
}

function newEventTarget() {
  // Should be 'new EventTarget()', but iOS doesn't support that.
  return document.createElement('div') as EventTargetNotifierSlot
}

type FuncSlotUpdatePre<S extends Slot> = (updates:UpdateSlot<S>[], localAction:boolean) => any
type FuncSlotUpdatePost = (updates:UpdateSlot<Slot>[], result:any, localAction:boolean) => void
type ResultPreSlotUpdate = [FuncSlotUpdatePost, any][]

export class NotifierSlot {
  readonly playfield:EventTargetNotifierSlot = newEventTarget()
  private readonly events:Map<string, EventTargetNotifierSlot> = new Map()
  private readonly slotUpdates:[FuncSlotUpdatePre<SlotCard>, FuncSlotUpdatePost][] = []
  private readonly slotUpdatesChip:[FuncSlotUpdatePre<SlotChip>, FuncSlotUpdatePost][] = []

  container(idCnt:string) {
    let result = this.events.get(idCnt)
    if (!result) {
      result = newEventTarget()
      this.events.set(idCnt, result)
    }
    return result
  }

  slot(idCnt:string, idSlot:number) {
    const key = idCnt + "-" + idSlot
    let result = this.events.get(key)
    if (!result) {
      result = newEventTarget()
      this.events.set(key, result)
    }
    return result
  }

  registerSlotUpdate(funcPre: FuncSlotUpdatePre<SlotCard>,funcPost: FuncSlotUpdatePost) {
    this.slotUpdates.push([funcPre, funcPost])
  }
  
  registerSlotUpdateChip(funcPre: FuncSlotUpdatePre<SlotChip>,funcPost: FuncSlotUpdatePost) {
    this.slotUpdatesChip.push([funcPre, funcPost])
  }
  
  preSlotUpdateCard(updates:UpdateSlot<SlotCard>[], localAction:boolean):ResultPreSlotUpdate {
    return this.slotUpdates.map(([pre, post]) => [post, pre(updates, localAction)])
  }

  preSlotUpdateChip(updates:UpdateSlot<SlotChip>[], localAction:boolean):ResultPreSlotUpdate {
    return this.slotUpdatesChip.map(([pre, post]) => [post, pre(updates, localAction)])
  }
  
  postSlotUpdate(updates:UpdateSlot<Slot>[], results:ResultPreSlotUpdate, localAction:boolean) {
    for (const [post, result] of results) {
      post(updates, result, localAction)
    }
  }
}

export class Chip extends IdentifiedVar<number> {
  readonly value:number
  
  constructor(id:number, value:number) {
    super(id)
    this.value = value
  }

  serialize(): any {
    return {...super.serialize(), value: this.value }
  }
  
  static fromSerialized(s:any) {
    return new Chip(s.id, s.value)
  }
}

export class SlotChip extends SlotItem<Chip> {
  constructor(id:number, idCnt:string, chips:readonly Chip[] = []) {
    super(id, (id:number,idCnt:string,chips:readonly Chip[]) => new SlotChip(id, idCnt, chips), idCnt, chips)
  }

  static fromSerialized(serialized:any):SlotChip {
    return new SlotChip(serialized.id, serialized.idCnt, serialized.items.map((c:any) => Chip.fromSerialized(c)))
  }

  container(playfield:Playfield):ContainerSlotChip {
    return playfield.containerChip(this.idCnt)
  }
}

class ContainerSlotChip extends ContainerSlot<SlotChip, Chip> {
  constructor(id:string, slots:readonly SlotChip[]=[], secret=false) {
    super(id,
          (id:string,slots:readonly SlotChip[],secret=false) => new ContainerSlotChip(id,slots,secret),
          slots,
          secret)
  }
  
  static fromSerialized(s:any) {
    return new ContainerSlotChip(s.id, s.slots.map((c:any) => SlotChip.fromSerialized(c)), s.secret)
  }
}

export class Playfield {
  readonly containers:ContainerSlotCard[]
  readonly containersChip:ContainerSlotChip[]

  constructor(containers:ContainerSlotCard[], containersChip:ContainerSlotChip[]) {
    this.containers = containers
    this.containersChip = containersChip
  }

  static fromSerialized(serialized:any):Playfield {
    return new Playfield(
      serialized.containers.map((s:any) => ContainerSlotCard.fromSerialized(s)),
      serialized.containersChip.map((s:any) => ContainerSlotChip.fromSerialized(s))
    )
  }
  
  serialize():any {
    return { containers: this.containers.map(s => s.serialize()),
             containersChip: this.containersChip.map(s => s.serialize()) }
  }
  
  container(id:string):ContainerSlotCard {
    const cnt = this.containers.find(c => c.isId(id))
    assertf(() => cnt)
    return cnt!
  }

  containerChip(id:string):ContainerSlotChip {
    const cnt = this.containersChip.find(c => c.isId(id))
    assertf(() => cnt)
    return cnt!
  }

  withUpdateCard(updates:UpdateSlot<SlotCard>[]):Playfield {
    assertf(() => updates.every(([slot, slot_]) => (slot == undefined || slot.idCnt == slot_.idCnt)))
    
    let containers_ = this.containers
    for (let update of updates) {
      containers_ = containers_.map(cnt => cnt.update(update))
    }
    return new Playfield(containers_, this.containersChip)
  }
  
  withUpdateChip(updates:UpdateSlot<SlotChip>[]):Playfield {
    assertf(() => updates.every(([slot, slot_]) => (slot == undefined || slot.idCnt == slot_.idCnt)))
    
    let containers_ = this.containersChip
    for (let update of updates) {
      containers_ = containers_.map(cnt => cnt.update(update))
    }
    return new Playfield(this.containers, containers_)
  }

  slotsUpdateCard(playfield_:Playfield, updates:UpdateSlot<SlotCard>[], notifierSlot:NotifierSlot,
                  send=true):Playfield {
    return this.slotsUpdate(playfield_, updates, notifierSlot, send, notifierSlot.preSlotUpdateCard(updates, send))
  }
  
  slotsUpdateChip(playfield_:Playfield, updates:UpdateSlot<SlotChip>[], notifierSlot:NotifierSlot,
                  send=true):Playfield {
    return this.slotsUpdate(playfield_, updates, notifierSlot, send, notifierSlot.preSlotUpdateChip(updates, send))
  }
  
  protected slotsUpdate<S extends Slot>(
    playfield_:Playfield, updates:UpdateSlot<S>[], notifierSlot:NotifierSlot, send:boolean,
    preSlotChangeInfo:ResultPreSlotUpdate
  ):Playfield {
    const cntChanged:Map<string, UpdateSlot<S>[]> = new Map()
    for (const update of updates) {
      const [slot, slot_] = update
      
      if (!cntChanged.has(slot_.idCnt)) {
        cntChanged.set(slot_.idCnt, [])
      }
      (cntChanged.get(slot_.idCnt) as UpdateSlot<S>[]).push(update)

      notifierSlot.slot(slot_.idCnt, slot_.id).dispatchEvent(
        new EventSlotChange(this, playfield_, slot_.idCnt, slot_.id)
      )
    }

    for (const [idCnt, updates] of cntChanged) {
      notifierSlot.container(idCnt).dispatchEvent(
        new EventContainerChange(this, playfield_, idCnt, updates)
      )
    }
    
    notifierSlot.postSlotUpdate(updates, preSlotChangeInfo, send)
    
    notifierSlot.playfield.dispatchEvent(new EventPlayfieldChange(this, playfield_))
    
    return playfield_
  }
}

declare var Peer:any

export class PeerPlayer extends IdentifiedVar {
  private conn:any
  private readonly conns:Connections
  
  constructor(id:string, conn:any, conns:Connections) {
    super(id)
    this.conn = conn
    this.conns = conns

    this.keepConnected()
  }

  keepConnected(timeout=15000, failTimeout=2000, reconnects=0) {
    if (this.open()) {
      window.setTimeout(() => this.keepConnected(timeout, 2000, 0), timeout)
    } else {
      if (reconnects < 5) {
        console.log("Lost peer connection, trying to reconnect", this.id(), reconnects, failTimeout)
        
        this.conns.connect(this.id(), (peerPlayer, conn) => {
          this.conn = conn
        })
        
        window.setTimeout(() => this.keepConnected(timeout, failTimeout * 2, ++reconnects), failTimeout)
      } else {
        console.warn(`Can't reconnect to peer ${this.id()} after ${reconnects} tries`)
        this.conns.onPeerLost(this)
      }
    }
  }
  
  open():boolean {
    return this.conn.open
  }

  send(data:any) {
    this.conn.send(data)
  }
}

interface EventMapConnections {
  "peerupdate": EventPeerUpdate
}

interface EventTargetConnections {
  addEventListener<K extends keyof EventMapConnections>(type: K, listener: (ev: EventMapConnections[K]) => any): void
  dispatchEvent(event:EventPeerUpdate):void
}

export class Connections {
  readonly events:EventTargetConnections = document.createElement("div") as EventTargetConnections
  private registrant:any
  private registering:boolean = false
  private peers:Map<string, PeerPlayer> = new Map()
  
  register(id:string,
           onPeerConnect:(metadata:any, peerId:string) => void,
           onReceive:(data:any, registrant:any, peer:PeerPlayer) => void) {
    
    assertf(() => id)
    assertf(() => !this.registering)
    
    if (this.registrant) {
      if (id == this.registrant.id()) {
        if (this.registrant.disconnected) {
          dom.demandById("peerjs-status").innerHTML = "Re-registering" // move this
          this.registrant.reconnect()
        }
      } else {
        const registrant = this.registrant
        dom.demandById("peerjs-status").innerHTML = "Re-registering"
        this.registrant.disconnect()
        this.registrant = null
        this.register(id, onPeerConnect, onReceive)
      }
      return
    }

    this.registering = true
    
    const registrant = new Peer(id)

    registrant.on('error', (err:any) => {
      this.registering = false
      if (err.type != 'peer-unavailable') {
        throw new Error(`${err.type} ${err}`)
        this.registrant = null
        dom.demandById("peerjs-status").innerHTML = "Unregistered"
      } else {
        console.log("Registrant error", err.type, err)
      }
    })
    
    console.log("Registering as " + id)

    registrant.on('close', (id:any) => {
      dom.demandById("peerjs-status").innerHTML = "Unregistered"
      this.registrant = null
    })
    
    registrant.on('open', (id:any) => {
      this.registering = false
      this.registrant = registrant
      
      dom.demandById("peerjs-status").innerHTML = "Registered"
    })

    registrant.on('connection', (conn:any) => {
      console.log("Peer connected to us", conn)
      
      if (!this.peerById(conn.peer) || !this.peerById(conn.peer)!.open()) {
        this.connect(conn.peer, () => {
          this.broadcast({chern: {connecting: conn.peer, idPeers: Array.from(this.peers.values()).map(p => p.id())}})
          onPeerConnect(conn.metadata, conn.peer)
        })
      }

      // Receive messages
      conn.on('data', (data:any) => {
        const peer = this.peerById(conn.peer)
        if (peer)
          onReceive(data, registrant, peer)
      })
      conn.on('error', (e:any) => {
        const peer = this.peerById(conn.peer)
        peer && this.onPeerError(peer, e)
      })
    })
  }

  peerById(id:string):PeerPlayer|undefined {
    return this.peers.get(id)
  }

  connect(idPeer:string, onConnect?:(peer:PeerPlayer, conn:any) => void) {
    assertf(() => idPeer)
    
    if (this.registrant) {
      if (this.registrant.id == idPeer)
        throw new Error("Can't connect to your own id")
      
      const peerPlayer = this.peers.get(idPeer)
      if (peerPlayer && peerPlayer.open()) {
        console.log("Peer connection already open", idPeer)
      } else {
        console.log("Attempting " + (peerPlayer ? "re-" : '') + "connection to peer", idPeer)
        const conn = this.registrant.connect(idPeer, {reliable: true, metadata: peerPlayer ? 'reconnect' : undefined})
        
        conn.on('open', () => {
          console.log("Peer opened", conn)
          //demandElementById("connect-status").innerHTML = "Waiting for reply"

          let peerPlayer = this.peers.get(idPeer)
          if (!peerPlayer) {
            peerPlayer = new PeerPlayer(conn.peer, conn, this)
            this.peers.set(conn.peer, peerPlayer)
          }

          onConnect && onConnect(peerPlayer, conn)
          
          this.events.dispatchEvent(new EventPeerUpdate(Array.from(this.peers.values())))
          
          function ping(secs:any) {
            if (peerPlayer!.open()) {
              peerPlayer!.send({ping: {secs: secs}})
              window.setTimeout(() => ping(secs+30), 30000)
            }
          }
          ping(0)
          
          conn.on('error', (err:any) => {
            this.onPeerError(peerPlayer!, err)
          })
        })
      }
    } else {
      throw new Error("Not registered")
    }
  }

  broadcast(data:any) {
    for (const [id,peer] of this.peers) {
      peer.send(data)
    }
  }

  onPeerError(peer:PeerPlayer, error:any) {
    console.log('Peer connection error', peer.id, error)
    this.events.dispatchEvent(new EventPeerUpdate(Array.from(this.peers.values())))
  }

  onPeerLost(peer:PeerPlayer) {
    this.peers.delete(peer.id())
    this.events.dispatchEvent(new EventPeerUpdate(Array.from(this.peers.values())))
  }
}

export abstract class Game extends IdentifiedVar {
  readonly description:string
  readonly makeUi:(...args:any) => void
  readonly players:Player[]

  constructor(id:string, description:string, makeUi:(...args:any) => void, players:Player[]) {
    super(id)
    this.description = description
    this.makeUi = makeUi
    this.players = players.concat([new Player('Spectator', [])])
  }
  
  abstract playfield():Playfield
  playfieldNewHand(playfieldOld:Playfield):Playfield {
    const pf = this.playfield()
    return new Playfield(pf.containers, playfieldOld.containersChip)
  }
}

export class GameGinRummy extends Game {
  constructor(makeUi:(...args:any) => any) {
    super("gin-rummy", "Gin Rummy", makeUi,
          [new Player('Player 1', ['p0']), new Player('Player 2', ['p1'])])
  }
  
  playfield():Playfield {
    const deck = shuffled(deck52())
    return new Playfield(
      [new ContainerSlotCard("p0", [new SlotCard(0, "p0",
                                         sortedByAltColorAndRank(deck.slice(0,10)).map(c => new WorldCard(c, true)))]),
       new ContainerSlotCard("p1", [new SlotCard(0, "p1",
                                         sortedByAltColorAndRank(deck.slice(10,20)).map(c => new WorldCard(c, true)))]),
       new ContainerSlotCard("waste", [new SlotCard(0, "waste")]),
       new ContainerSlotCard("stock", [new SlotCard(0, "stock",
                                                    deck.slice(20).map(c => new WorldCard(c, false)))])],
      []
    )
  }
}

export class GameDummy extends Game {
  constructor(makeUi:(...args:any) => any) {
    super("dummy", "Dummy / 500 Rum", makeUi,
          [new Player('Player 1', ['p0']), new Player('Player 2', ['p1']), new Player('Spectator', [])])
  }
  
  playfield():Playfield {
    const deck = shuffled(deck52())
    return new Playfield(
      [new ContainerSlotCard("p0", [new SlotCard(0, "p0", 
                                         sortedByAltColorAndRank(deck.slice(0,13)).map(c => new WorldCard(c, true)))]),
       new ContainerSlotCard("p1", [new SlotCard(0, "p1",
                                         sortedByAltColorAndRank(deck.slice(13,26)).map(c => new WorldCard(c, true)))]),
       new ContainerSlotCard("p0-meld", []),
       new ContainerSlotCard("waste", [new SlotCard(0, "waste")]),
       new ContainerSlotCard("p1-meld", []),
       new ContainerSlotCard("stock", [new SlotCard(0, "stock",
                                                    deck.slice(26).map(c => new WorldCard(c, false)))])],
      []
    )
  }
}

export class GamePoker extends Game {
  constructor(makeUi:(...args:any) => any) {
    super("poker", "Poker", makeUi,
          [new Player('Player 1', ['p0', 'p0-chip']),
           new Player('Player 2', ['p1', 'p1-chip']),
           ])
  }
  
  playfield():Playfield {
    const deck = shuffled(deck52())

    const chips = (id:string, base:number) => 
      [new SlotChip(0, id, array.range(3).map((_,i) => new Chip(i+512+base, 100))),
       new SlotChip(1, id, array.range(5).map((_,i) => new Chip(i+256+base, 50))),
       new SlotChip(2, id, array.range(10).map((_,i) => new Chip(i+128+base,25))),
       new SlotChip(3, id, array.range(20).map((_,i) => new Chip(i+base, 10)))
       ]
    
    return new Playfield(
      [new ContainerSlotCard("p0", [new SlotCard(0, "p0")]),
       new ContainerSlotCard("p1", [new SlotCard(0, "p1")]),
       new ContainerSlotCard("waste-secret", [new SlotCard(0, "waste-secret")], true),
       new ContainerSlotCard("waste", [new SlotCard(0, "waste")]),
       new ContainerSlotCard("stock", [new SlotCard(0, "stock",
                                                    deck.map(c => new WorldCard(c, false)))])],
      [new ContainerSlotChip("p0-chip", chips("p0-chip", 0)),
       new ContainerSlotChip("p1-chip", chips("p1-chip", 4096)),
       new ContainerSlotChip("ante", [new SlotChip(0, "ante"), new SlotChip(1, "ante"), new SlotChip(2, "ante"),
                                      new SlotChip(3, "ante")])
      ]
    )
  }
}

export class GamePokerChinese extends Game {
  constructor(makeUi:(...args:any) => any) {
    super("poker-chinese", "Chinese Poker", makeUi,
          [new Player('Player 1', ['p0', 'p0-chip']),
           new Player('Player 2', ['p1', 'p1-chip']),
           ])
  }
  
  playfield():Playfield {
    const deck = shuffled(deck52())

    const chips = (id:string, base:number) => 
      [new SlotChip(0, id, array.range(3).map((_,i) => new Chip(i+512+base, 100))),
       new SlotChip(1, id, array.range(5).map((_,i) => new Chip(i+256+base, 50))),
       new SlotChip(2, id, array.range(10).map((_,i) => new Chip(i+128+base,25))),
       new SlotChip(3, id, array.range(20).map((_,i) => new Chip(i+base, 10)))
       ]
    
    return new Playfield(
      [new ContainerSlotCard("p0", [new SlotCard(0, "p0", deck.slice(0,13).map(c => new WorldCard(c, true)))]),
       new ContainerSlotCard("p1", [new SlotCard(0, "p1", deck.slice(13,26).map(c => new WorldCard(c, true)))]),
       new ContainerSlotCard("p0-show", array.range(3).map((_,i) => new SlotCard(i, "p0-show"))),
       new ContainerSlotCard("p1-show", array.range(3).map((_,i) => new SlotCard(i, "p1-show")))
      ],
      [new ContainerSlotChip("p0-chip", chips("p0-chip", 0)),
       new ContainerSlotChip("p1-chip", chips("p1-chip", 4096))
      ]
    )
  }
}

