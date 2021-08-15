import { assert, assertf } from './assert.js'
import * as array from './array.js'
import * as dom from './dom.js' // remove this
import * as it from './iterator.js'

export enum ConflictResolution {
  LEFT_STAY,
  RIGHT_STAY,
  BOTH_STAY,
  BOTH_REMOVE
}

export interface MoveItemsAny  {
  readonly turnSequence: number
  readonly items: ItemSlot[]
  readonly idSource: [string, number]
  readonly idDest: [string, number]
  readonly destBeforeItem?: ItemSlot
  readonly slotsChanged: [string, number][]
  readonly slotsNew: [string, number][]
  readonly timestamp: number
  serialize(): any
  isConflictingWith(rhs: this): boolean
  resolveConflictWith(rhs: this): ConflictResolution
  apply(playfield: Playfield): Playfield
}

export abstract class MoveItems<S extends SlotItem<T>, T extends ItemSlot> implements MoveItemsAny {

  constructor(
    readonly turnSequence: number,
    readonly items: T[],
    readonly idSource: [string, number],
    readonly idDest: [string, number],
    readonly destBeforeItem?: T,
    readonly slotsNew: [string, number][] = [],
    readonly timestamp = new Date().getTime()
    // tbd: ordering? I.e. move 5 cards into deck, have them all order correctly.
  ) {}

  abstract isValid(pf: Playfield): boolean
  
  apply(playfield: Playfield): Playfield {
    assert(playfield.sequence == this.turnSequence)
    
    // "Invalid" moves are ignored. How can a move be invalid? One way:
    // 1. Client receives a move in a previous turn that generates a conflict.
    // 2. Conflict resolution invalidates moves in the proceeding turns.
    // 3. Client receives a move having a cause/effect relationship with an invalidated move, from a client who hasn't
    //    yet assimilated the conflict resolution.
    //
    // It would be better to detect this case in some other way, to avoid the need for this logic.
    // Re-write sequence numbers?
    // Version turns?
    const allNewSlotsNotExisting =
      this.slotsNew.length == 0 ||
      this.slotsNew.every(([idCnt, id]) => !playfield.container(idCnt).hasSlot(idCnt, id))

    // tbd: check "before"
    
    const moveToNewSlot = this.slotsNew.some(([idCnt, id]) => this.idDest[0] == idCnt && this.idDest[1] == id);
    
    if (allNewSlotsNotExisting && (moveToNewSlot || this.isValid(playfield)))
      return this.doApply(playfield)
    else {
      console.error("Invalid move discarded during apply", this, playfield)
      return playfield.withTurnSequence(this.turnSequence)
    }
  }

  protected abstract doApply(playfield: Playfield): Playfield
  
  // Two moves conflict if:
  // * They use any of the same cards.
  // * They create the same slot.
  isConflictingWith(rhs: this) {
    return rhs !== this &&
      (rhs.items.some(ri => this.items.some(li => li.is(ri))) ||
        rhs.slotsNew.some(rs => this.slotsNew.some(ls => array.equals(ls, rs))))
  }
  
  resolveConflictWith(rhs: this): ConflictResolution {
    if (this === rhs) {
      return ConflictResolution.BOTH_STAY
    } else if (this.isConflictingWith(rhs)) {
      if (this.timestamp == rhs.timestamp)
        return ConflictResolution.BOTH_REMOVE
      else
        return this.timestamp < rhs.timestamp ? ConflictResolution.LEFT_STAY : ConflictResolution.RIGHT_STAY
    } else {
      return ConflictResolution.BOTH_STAY
    }
  }

  // Doesn't include new slots
  get slotsChanged(): [string,number][] {
    if (array.equals(this.idSource, this.idDest))
      return [this.idSource]
    else
      return [this.idSource, this.idDest]
  }

  abstract makeSlotsNew(): S[]
  
  serialize(): any {
    return {
      turnSequence: this.turnSequence,
      items: this.items.map(c => c.serialize()),
      idSource: this.idSource,
      idDest: this.idDest,
      destBeforeItem: this.destBeforeItem?.serialize(),
      slotsNew: this.slotsNew,
      timestamp: this.timestamp
    }
  }
}

export class MoveCards extends MoveItems<SlotCard, WorldCard> {
  // Note: TypeScript inherits superclass constructors
  
  isValid(pf: Playfield) {
    const src = pf.containerCard(this.idSource[0]).slot(this.idSource[1])
    const dst = pf.containerCard(this.idDest[0]).slot(this.idDest[1])
    
    return this.items.every(i =>
      src.hasItem(i) &&
      (src.is(dst) || !dst.hasItem(i)) &&
      (!this.destBeforeItem || dst.hasItem(this.destBeforeItem))
    )
  }
  
  makeSlotsNew(): SlotCard[] {
    return this.slotsNew.map(([idCnt, id]) => new SlotCard(idCnt, id))
  }
  
  protected doApply(playfield: Playfield): Playfield {
    return playfield.withMoveCards(this)
  }
  
  serialize(): any {
    return {...super.serialize(), type: "MoveCards" }
  }
  
  static fromSerialized(s: any) {
    return new MoveCards(
      s.turnSequence,
      s.items.map((e: any) => WorldCard.fromSerialized(e)),
      s.idSource,
      s.idDest,
      s.destBeforeItem ? WorldCard.fromSerialized(s.destBeforeItem) : undefined,
      s.slotsNew,
      s.timestamp
    )
  }
}

export class MoveChips extends MoveItems<SlotChip, Chip> {
  // Note: TypeScript inherits superclass constructors
  
  isValid(pf: Playfield) {
    const src = pf.containerChip(this.idSource[0]).slot(this.idSource[1])
    const dst = pf.containerChip(this.idDest[0]).slot(this.idDest[1])
    
    return this.items.every(i =>
      src.hasItem(i) &&
      (src.is(dst) || !dst.hasItem(i)) &&
      (!this.destBeforeItem || dst.hasItem(this.destBeforeItem))
    )
  }
  
  makeSlotsNew(): SlotChip[] {
    return this.slotsNew.map(([idCnt, id]) => new SlotChip(idCnt, id))
  }
  
  protected doApply(playfield: Playfield): Playfield {
    return playfield.withMoveChips(this)
  }
  
  serialize(): any {
    return {...super.serialize(), type: "MoveChips" }
  }
  
  static fromSerialized(s: any) {
    return new MoveChips(
      s.turnSequence,
      s.items.map((e: any) => Chip.fromSerialized(e)),
      s.idSource,
      s.idDest,
      s.destBeforeItem ? Chip.fromSerialized(s.destBeforeItem) : undefined,
      s.slotsNew,
      s.timestamp
    )
  }
}

export function deserializeMove(s: any) {
  if (s.type == "MoveCards")
    return MoveCards.fromSerialized(s)
  else if (s.type == "MoveChips")
    return MoveChips.fromSerialized(s)
  else
    throw new Error("Unknown type " + s.type)
}

export function aryIdEquals<T extends Identified>(lhs: T[], rhs: T[]) {
  if (lhs.length != rhs.length)
    return false

  for (let i = 0; i < lhs.length; ++i)
    if (!lhs[i].is(rhs[i]))
      return false
  
  return true
}

interface Identified {
  is(rhs: this): boolean
  serialize(): any
}

function fsort_id<IdType extends string>(a: IdentifiedByVal<IdType>, b: IdentifiedByVal<IdType>): number {
  return a.id.localeCompare(b.id)
}

abstract class IdentifiedByVal<IdType> implements Identified {
  abstract get id(): IdType
  
  is(rhs: this): boolean {
    return this.isId(rhs.id)
  }
  
  isId(id: IdType): boolean {
    return this.id == id
  }

  serialize(): any {
    return { id: this.id }
  }
}

abstract class IdentifiedVar<IdType=string> extends IdentifiedByVal<IdType> {
  private readonly _id: IdType

  constructor(id: IdType) {
    super()
    this._id = id
  }

  get id(): IdType {
    return this._id
  }
}

abstract class ContainerSlotAny extends IdentifiedVar {
  abstract slot(id: number): Slot
  abstract hasSlot(idCnt: string, id: number): boolean
  abstract isEmpty(): boolean
}

abstract class ContainerSlot<S extends SlotItem<T>, T extends ItemSlot> extends ContainerSlotAny {

  readonly secret: boolean
  private readonly slots: readonly S[] = []
  private readonly construct:(id: string,slots: readonly S[],secret: boolean) => this
  
  constructor(id: string, construct:(id: string, slots: readonly S[], secret: boolean) => any, slots: readonly S[],
              secret: boolean) {
    super(id)
    this.slots = slots
    this.secret = secret
    this.construct = construct
  }

  serialize(): any {
    return { ...super.serialize(), slots: this.slots.map(s => s.serialize()), secret: this.secret }
  }

  first(): S {
    assert(this.slots, "No first of empty slot")
    return this.slots[0]
  }
  
  add(slots: S[]): this {
    return this.construct(this.id, this.slots.concat(slots), this.secret)
  }

  slot(id: number): S {
    const slot = this.slots.find(s => s.isId(this.id, id))
    assert(slot, "No slot of id", this.id, id)
    return slot
  }
  
  clear(): this {
    return this.construct(this.id, [], this.secret)
  }
  
  isEmpty(): boolean {
    return this.slots.every(s => s.isEmpty())
  }
  
  hasSlot(idCnt: string, id: number): boolean {
    return this.isId(idCnt) && this.slots.some(s => s.isId(idCnt, id))
  }
  
  lengthSlots(): number {
    return this.slots.length
  }
  
  length(): number {
    return this.slots.reduce((a, s) => a + s.length(), 0)
  }
  
  withMove(move: MoveItems<S, T>): this {
    const slotsNew = move.makeSlotsNew().filter(s => this.isId(s.idCnt))
    assert(slotsNew.every(s => !this.hasSlot(s.idCnt, s.idSlot)), "Container already has new slot")
    return this.construct(this.id, this.slots.concat(slotsNew).map(s => s.withMove(move)), this.secret)
  }

  allItems(): T[] {
    return this.slots.reduce((agg, s) => agg.concat(Array.from(s)), [] as T[])
  }
  
  [Symbol.iterator](): Iterator<S> {
    return this.slots[Symbol.iterator]()
  }
}

// Note: idSlot is only unique within a container
export abstract class Slot implements Identified {
  readonly idSlot: number
  readonly idCnt: string

  static sort(lhs: Slot, rhs: Slot) {
    return lhs.idCnt.localeCompare(rhs.idCnt) || lhs.idSlot - rhs.idSlot
  }
  
  constructor(idCnt: string, idSlot: number) {
    this.idSlot = idSlot
    this.idCnt = idCnt
  }
  
  abstract isEmpty(): boolean
  abstract length(): number

  is(rhs: Slot) {
    return this.isId(rhs.idCnt, rhs.idSlot)
  }

  isId(idCnt: string, idSlot: number) {
    return this.idSlot == idSlot && this.idCnt == idCnt
  }

  get id(): [string, number] { return [this.idCnt, this.idSlot] }
  
  serialize(): any {
    return { idSlot: this.idSlot, idCnt: this.idCnt }
  }
}

// An Item held by a Slot
export interface ItemSlot extends Identified {
  serialize(): any
}

// A Slot that holds Items
abstract class SlotItem<T extends ItemSlot> extends Slot implements Iterable<T> {
  protected readonly items: readonly T[]
  private readonly construct: (b: string, a: number, c: readonly T[]) => this

  constructor(id: number,
              construct: (b: string, a: number, c: readonly T[]) => any, idCnt: string, items: readonly T[]) {
    
    super(idCnt, id)
    this.items = items
    this.construct = construct
  }

  serialize() {
    return { ...super.serialize(), items: this.items.map(c => c.serialize()), idCnt: this.idCnt }
  }

  // Assuming the slot is sorted, then returns the first item higher then the given item by the given ordering, if
  // any such item exists.
  //
  // The given item need not be in the slot.
  itemAfter(item: T, compareFn:(a: T, b: T) => number): T|undefined {
    return this.items.find(i => compareFn(i, item) > 0)
  }

  // Get the item following the given one, if any.
  next(item: T): T|undefined {
    for (let i = 0; i < this.items.length; ++i) {
      if (this.items[i].is(item))
        return this.items[i+1]
    }

    assert(false, "Item not in slot as expected")
    return undefined
  }
  
  add(items: T[], before?: T): this {
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
    return this.construct(this.idCnt, this.idSlot, this.items.slice(0, idx).concat(items).concat(this.items.slice(idx)))
  }

  remove(items: T[]): this {
    if (items.length) {
      assertf(() => items.every(i => this.items.some(i2 => i2.is(i))), "Some items to be removed not found in slot")
      return this.construct(this.idCnt, this.idSlot, this.items.filter(i => !items.some(i2 => i2.is(i))))
    } else {
      return this
    }
  }

  replace(item: T, item_: T): this {
    const idx = this.items.findIndex(i => i.is(item))
    assertf(() => idx != -1, "Item to be replaced not found in slot")
    return this.construct(this.idCnt, this.idSlot,
                          this.items.slice(0, idx).concat([item_]).concat(this.items.slice(idx+1)))
  }

  top(): T {
    assertf(() => !this.isEmpty())
    return this.items[this.items.length-1]
  }

  isEmpty(): boolean {
    return this.items.length == 0
  }

  item(idx: number): T {
    assertf(() => idx >= 0 && idx < this.items.length)
    return this.items[idx]
  }

  length(): number {
    return this.items.length
  }

  hasItem(item: T): boolean {
    return this.items.some(i => i.is(item))
  }

  map(f: (c: T) => T): this {
    return this.construct(this.idCnt, this.idSlot, this.items.map(f))
  }
  
  withMove(move: MoveItems<this, T>) {
    let result = this

    // A move may have the same slot as both a source and a destination.
    // The card state may have changed.
    if (this.isId(...move.idSource))
      result = result.remove(move.items)
    if (this.isId(...move.idDest))
      result = result.add(move.items, move.destBeforeItem)

    return result
  }
  
  [Symbol.iterator](): Iterator<T> {
    return this.items[Symbol.iterator]()
  }
}

export class SlotCard extends SlotItem<WorldCard> {
  constructor(idCnt: string, id: number, cards: readonly WorldCard[] = []) {
    super(id, (idCnt,id,cards) => new SlotCard(idCnt, id, cards), idCnt, cards)
  }

  static fromSerialized(serialized: any) {
    return new SlotCard(serialized.idCnt, serialized.idSlot, serialized.items.map((c: any) => WorldCard.fromSerialized(c)))
  }

  container(playfield: Playfield): ContainerSlotCard {
    return playfield.containerCard(this.idCnt)
  }

  findById(id: string): WorldCard|undefined {
    return this.items.find(i => i.isId(id))
  }
}

export class ContainerSlotCard extends ContainerSlot<SlotCard, WorldCard> {
  constructor(id: string, slots: readonly SlotCard[]=[], secret=false) {
    super(id, (id,slots,secret) => new ContainerSlotCard(id,slots,secret), slots, secret)
  }
  
  static fromSerialized(s: any) {
    return new ContainerSlotCard(s.id, s.slots.map((c: any) => SlotCard.fromSerialized(c)), s.secret)
  }
}

export class Player extends IdentifiedVar {
  readonly idCnts: string[]
  
  constructor(id: string, idCnts: string[]) {
    super(id)
    this.idCnts = idCnts
  }

  multipleAssignmentPossible(): boolean { return false }
}

export class PlayerSpectator extends Player {
  constructor() {
    super("spectator", [])
  }

  multipleAssignmentPossible(): boolean { return true }
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
  readonly suit: number
  readonly rank: number
    
  constructor(rank: number, suit: number, id: string) {
    super(id)
    this.suit = suit
    this.rank = rank
  }

  static fromSerialized(serialized: any) {
    return new Card(serialized.rank, serialized.suit, serialized.id)
  }

  color(): Color {
    if (this.suit == Suit.CLUB || this.suit == Suit.SPADE)
      return Color.BLACK
    else
      return Color.RED
  }

  rankValue(aceHigh: boolean): number {
    return this.rank == 0 && aceHigh ? 13 : this.rank
  }
  
  serialize(): any {
    return {
      ...super.serialize(),
      suit: this.suit,
      rank: this.rank
    }
  }
}

export class WorldCard extends IdentifiedVar<string> {
  readonly card: Card
  readonly faceUp: boolean
  readonly faceUpIsConscious: boolean
  readonly turned: boolean

  constructor(card: Card, faceUp: boolean, faceUpIsConscious=false, turned=false, id=card.id) {
    super(id)
    this.card = card
    this.faceUp = faceUp
    this.faceUpIsConscious = faceUpIsConscious
    this.turned = turned
  }

  static fromSerialized(serialized: any) {
    return new WorldCard(Card.fromSerialized(serialized.card), serialized.faceUp, serialized.faceUpIsConscious,
                        serialized.turned)
  }

  equals(rhs: WorldCard): boolean {
    return this.card.is(rhs.card) &&
      this.faceUp == rhs.faceUp &&
      this.faceUpIsConscious == rhs.faceUpIsConscious &&
      this.turned == rhs.turned
  }

  withFaceUp(faceUp: boolean) {
    return new WorldCard(this.card, faceUp, this.faceUpIsConscious, this.turned)
  }

  withFaceStateConscious(faceUp: boolean, conscious: boolean) {
    return new WorldCard(this.card, faceUp, conscious, this.turned)
  }
  
  withTurned(turned: boolean) {
    return new WorldCard(this.card, this.faceUp, this.faceUpIsConscious, turned)
  }
  
  serialize(): any {
    return {
      card: this.card.serialize(),
      faceUp: this.faceUp,
      faceUpIsConscious: this.faceUpIsConscious,
      turned: this.turned
    }
  }
}

function deck52() {
  const result: Card[] = []
  
  for (let suit = 0; suit < 4; ++suit) {
    for (let rank = 0; rank < 13; ++rank) {
      result.push(new Card(rank, suit, rank+'_'+suit))
    }
  }

  return result
}

function deck51NoDeuce() {
  return deck52().filter(c => c.suit != Suit.SPADE && c.rank != 1)
}

function shuffled(deck: Card[]): Card[] {
  const result: Card[] = []
  
  while (deck.length) {
    const idx = Math.floor(Math.random() * deck.length)
    result.push(deck[idx])
    deck = deck.slice(0,idx).concat(deck.slice(idx+1))
  }
  
  return result
}

function orderColorAlternate(c: Card): number {
  switch (c.suit) {
    case Suit.CLUB: return 0
    case Suit.DIAMOND: return 1
    case Suit.SPADE: return 2
    case Suit.HEART: return 3
    default: throw new Error("Unknown suit " + c.suit)
  }
}

function orderColorAlternateRank(aceHigh: boolean, a: Card, b: Card): number {
  return orderColorAlternate(a) - orderColorAlternate(b) || a.rankValue(aceHigh) - b.rankValue(aceHigh)
}

function orderColorAlternateRankW(aceHigh: boolean, a: WorldCard, b: WorldCard): number {
  return orderColorAlternateRank(aceHigh, a.card, b.card)
}

export class EventMove extends Event {
  constructor(readonly move: MoveItemsAny, readonly localAction: boolean) {
    super('gamemove')
  }
}

export class EventContainerChange extends Event {
  constructor(readonly playfield: Playfield, readonly playfield_: Playfield, readonly idCnt: string) {
    super('containerchange')
  }
}

export class EventSlotChange extends Event {
  constructor(readonly playfield: Playfield, readonly playfield_: Playfield, readonly idCnt: string,
              readonly idSlot: number) {
    super('slotchange')
  }
}

export class EventPingBack extends Event {
  readonly secs: number
  
  constructor(secs: number) {
    super('pingback')
    this.secs = secs
  }
}

export class EventPeerUpdate extends Event {
  readonly peers: PeerPlayer[]
  
  constructor(peers: PeerPlayer[]) {
    super('peerupdate')
    this.peers = peers
  }
}

export class EventPlayfieldChange extends Event {
  readonly playfield: Playfield
  readonly playfield_: Playfield

  constructor(playfield: Playfield, playfield_: Playfield) {
    super('playfieldchange')
    this.playfield = playfield
    this.playfield_ = playfield_
  }
}

export interface EventMapNotifierSlot {
  "gamemove": EventMove,
  "slotchange": EventSlotChange,
  "containerchange": EventContainerChange,
  "playfieldchange": EventPlayfieldChange
}

interface EventTargetNotifierSlot {
  addEventListener<K extends keyof EventMapNotifierSlot>(type: K, listener: (ev: EventMapNotifierSlot[K]) => any): void
  dispatchEvent(event: Event): boolean
}

function newEventTarget() {
  // Should be 'new EventTarget()', but iOS doesn't support that.
  return document.createElement('div') as EventTargetNotifierSlot
}

type FuncSlotUpdatePre = (slotsOld: Slot[], localAction: boolean) => any
type FuncSlotUpdatePost = (slots: Slot[], result: any, localAction: boolean) => void

export class NotifierSlot {
  readonly eventTarget: EventTargetNotifierSlot = newEventTarget()
  private readonly events: Map<string, EventTargetNotifierSlot> = new Map()
  private readonly preSlotUpdates: FuncSlotUpdatePre[] = []
  private readonly postSlotUpdates: FuncSlotUpdatePost[] = []

  container(idCnt: string) {
    let result = this.events.get(idCnt)
    if (!result) {
      result = newEventTarget()
      this.events.set(idCnt, result)
    }
    return result
  }

  slot(idCnt: string, idSlot: number) {
    const key = idCnt + "-" + idSlot
    let result = this.events.get(key)
    if (!result) {
      result = newEventTarget()
      this.events.set(key, result)
    }
    return result
  }

  registerPreSlotUpdate(func: FuncSlotUpdatePre) {
    this.preSlotUpdates.push(func)
  }
  
  registerPostSlotUpdate(func: FuncSlotUpdatePost) {
    this.postSlotUpdates.push(func)
  }

  move(move: MoveItemsAny, localAction=true) {
    this.eventTarget.dispatchEvent(new EventMove(move, localAction))
  }
  
  slotsUpdate(playfield: Playfield, playfield_: Playfield, slotsChanged: Set<[string, number]>, localAction: boolean) {
    // Note: slotsChanged may include new slots not in the old playfield
    const oldSlots = it.flatMap(
      slotsChanged,
      ([idCnt, id]) => playfield.container(idCnt).hasSlot(idCnt, id) ? [playfield.container(idCnt).slot(id)] : []
    )
    const preSlotChangeInfo = this.preSlotUpdates.map(f => f(Array.from(oldSlots), localAction))
                                                      
    for (const [idCnt, id] of slotsChanged) {
      this.slot(idCnt, id).dispatchEvent(
        new EventSlotChange(playfield, playfield_, idCnt, id)
      )
    }
      
    const newSlots = it.map(slotsChanged, ([idCnt, id]) => playfield_.container(idCnt).slot(id))
    for (const result of preSlotChangeInfo)
      for (const f of this.postSlotUpdates)
        f(Array.from(newSlots), result, localAction)
  }
}

export class Chip extends IdentifiedVar<number> {
  readonly value: number
  
  constructor(id: number, value: number) {
    super(id)
    this.value = value
  }

  serialize(): any {
    return {...super.serialize(), value: this.value }
  }
  
  static fromSerialized(s: any) {
    return new Chip(s.id, s.value)
  }
}

export class SlotChip extends SlotItem<Chip> {
  constructor(idCnt: string, id: number, chips: readonly Chip[] = []) {
    super(id, (idCnt: string, id: number, chips: readonly Chip[]) => new SlotChip(idCnt, id, chips), idCnt, chips)
  }

  static fromSerialized(serialized: any): SlotChip {
    return new SlotChip(serialized.idCnt, serialized.id, serialized.items.map((c: any) => Chip.fromSerialized(c)))
  }

  container(playfield: Playfield): ContainerSlotChip {
    return playfield.containerChip(this.idCnt)
  }
}

class ContainerSlotChip extends ContainerSlot<SlotChip, Chip> {
  constructor(id: string, slots: readonly SlotChip[]=[], secret=false) {
    super(id,
          (id: string,slots: readonly SlotChip[],secret=false) => new ContainerSlotChip(id,slots,secret),
          slots,
          secret)
  }
  
  static fromSerialized(s: any) {
    return new ContainerSlotChip(s.id, s.slots.map((c: any) => SlotChip.fromSerialized(c)), s.secret)
  }
}

export class Playfield {
  constructor(readonly sequence: number,
              readonly containers: readonly ContainerSlotCard[],
              readonly containersChip: readonly ContainerSlotChip[]) {
    assert(sequence != NaN)
  }

  static fromSerialized(serialized: any): Playfield {
    return new Playfield(
      serialized.sequence,
      serialized.containers.map((s: any) => ContainerSlotCard.fromSerialized(s)),
      serialized.containersChip.map((s: any) => ContainerSlotChip.fromSerialized(s))
    )
  }
  
  serialize(): any {
    return { sequence: this.sequence, containers: this.containers.map(s => s.serialize()),
             containersChip: this.containersChip.map(s => s.serialize()) }
  }

  withTurnSequence(turnSequence: number) {
    return new Playfield(turnSequence, this.containers, this.containersChip)
  }
  
  withMoveCards(move: MoveCards): Playfield {
    return new Playfield(move.turnSequence, this.containers.map(cnt => cnt.withMove(move)), this.containersChip)
  }
  
  withMoveChips(move: MoveChips): Playfield {
    return new Playfield(move.turnSequence, this.containers, this.containersChip.map(cnt => cnt.withMove(move)))
  }
    
  containerCard(id: string): ContainerSlotCard {
    const cnt = this.containers.find(c => c.isId(id))
    assertf(() => cnt)
    return cnt!
  }

  containerChip(id: string): ContainerSlotChip {
    const cnt = this.containersChip.find(c => c.isId(id))
    assertf(() => cnt)
    return cnt!
  }

  container(id: string): ContainerSlotAny {
    let cnt: ContainerSlotAny|undefined = this.containers.find(c => c.isId(id))
    if (!cnt)
       cnt = this.containersChip.find(c => c.isId(id))
    assertf(() => cnt)
    return cnt!
  }
}

declare var Peer: any

export class PeerPlayer extends IdentifiedVar {
  private conn?: any
  private err?: any
  private player: Player
  private connecting = true
  consistency = 0
  consistencyReported = 0

  constructor(id: string, private readonly conns: Connections, player: Player,
              readonly onReconnect:(p: PeerPlayer) => void) {
    super(id)
    this.conns = conns
    this.player = player
  }

  get consistent() { return this.consistency == this.consistencyReported }
  
  keepConnected(timeout=10000, failTimeout=2000, reconnects=0) {
    if (this.open()) {
      window.setTimeout(() => this.keepConnected(timeout, 2000, 0), timeout)
    } else {
      if (reconnects < 30) {
        console.log("Lost peer connection, trying to reconnect", this.id, reconnects, failTimeout)

        this.err = undefined
        this.conns.connect(
          this.id,
          this.player,
          (peerPlayer, conn) => { this.onOpened(conn); this.onReconnect(peerPlayer) },
          {}
        )
        
        window.setTimeout(() => this.keepConnected(timeout, failTimeout, ++reconnects), failTimeout)
      } else {
        console.warn(`Can't reconnect to peer ${this.id} after ${reconnects} tries`)
        this.conns.onPeerLost(this)
      }
    }
  }

  connectingGet() { return this.connecting }
  
  onOpened(conn: any) {
    const firstConnection = this.conn === undefined
    this.conn = conn
    this.connecting = false
    this.err = undefined

    if (firstConnection)
      this.keepConnected()
  }

  onOpenFailed(err: any) {
    this.connecting = false
    this.err = err
  }
  
  open(): boolean {
    return this.conn?.open
  }

  status(): string {
    return this.err ? 'Error' :
      this.connectingGet() ? 'Connecting...' :
      this.open() ? 'Connected' :
      'Disconnected'
  }

  playerGet(): Player { return this.player }
  playerChange(player: Player): void { this.player = player }
  
  send(data: any) {
    assert(this.open())
    console.debug('Send to ' + this.id, data)
    this.conn.send(data)
  }

  serialize(): any {
    return { ...super.serialize(), player: this.player.id }
  }
}

interface EventMapConnections {
  "peerupdate": EventPeerUpdate
}

interface EventTargetConnections {
  addEventListener<K extends keyof EventMapConnections>(type: K, listener: (ev: EventMapConnections[K]) => any): void
  dispatchEvent(event: EventPeerUpdate): void
}

export class Connections {
  readonly events: EventTargetConnections = document.createElement("div") as EventTargetConnections
  private registrant: any
  private registering: boolean = false
  private peers: Map<string, PeerPlayer> = new Map()

  constructor(private readonly onReconnect:(peer: PeerPlayer) => void) {
  }
  
  registrantId(): string|undefined {
    return this.registrant?.id
  }
  
  register(id: string,
           onPeerConnect:(metadata: any, peer: PeerPlayer) => void,
           onReceive:(data: any, peer: PeerPlayer) => void,
           playerDefault: Player,
           registrantPlayerGet:() => Player,
           maxPlayersGet:() => number
          ) {
    
    assertf(() => id)
    assertf(() => !this.registering)
    
    if (this.registrant) {
      if (id == this.registrant.id) {
        if (this.registrant.disconnected) {
          dom.demandById("peerjs-status").innerHTML = "Re-registering" // move this
          this.registrant.reconnect()
        }
      } else {
        dom.demandById("peerjs-status").innerHTML = "Re-registering"
        this.registrant.disconnect()
        this.registrant = null
        this.register(id, onPeerConnect, onReceive, playerDefault, registrantPlayerGet, maxPlayersGet)
      }
      return
    }

    this.registering = true

    const host = dom.demandById("peerjs-host", HTMLInputElement).value.split('/')[0]
    const path = dom.demandById("peerjs-host", HTMLInputElement).value.split('/')[1]
    const connection =
      host ? {host: host.split(':')[0], port: host.split(':')[1] ?? 9000, path: path ?? '/'} : undefined
    const registrant = new Peer(id, connection)

    registrant.on('error', (err: any) => {
      this.registering = false
      if (err.type != 'peer-unavailable') {
        this.registrant = null
        dom.demandById("peerjs-status").innerHTML = "Unregistered"
        throw new Error(`${err.type} ${err}`)
      } else {
        // ?
        const idPeer = err.toString().slice("Error: Could not connect to peer ".length)
        this.peerById(idPeer)?.onOpenFailed(err.toString())
        this.events.dispatchEvent(new EventPeerUpdate(Array.from(this.peers.values())))
        console.log("Registrant error", err.type, err)
      }
    })
    
    console.log("Registering as " + id)

    registrant.on('close', (id: any) => {
      dom.demandById("peerjs-status").innerHTML = "Unregistered"
      this.registrant = null
    })
    
    registrant.on('open', (id: any) => {
      this.registering = false
      this.registrant = registrant
      
      dom.demandById("peerjs-status").innerHTML = "Registered"
    })

    registrant.on('connection', (conn: any) => {
      console.log("Peer connected to us", conn)

      {
        const peerPlayer = this.peerById(conn.peer)
        
        if (!peerPlayer || !peerPlayer.open()) {
          this.connect(
            conn.peer,
            playerDefault,
            (peer: PeerPlayer, _: any) => onPeerConnect(conn.metadata, peer),
            {}
          )
        }
      }

      conn.on('data', (data: any) => {
        const peer = this.peerById(conn.peer)

        console.debug('Received from ' + conn.peer + ' in state open=' + peer?.open(), data)

        peer && peer.open() && onReceive(data, peer)
      })
      
      conn.on('error', (e: any) => {
        const peer = this.peerById(conn.peer)
        peer && this.onPeerError(peer, e)
      })
    })
  }

  peerById(id: string): PeerPlayer|undefined {
    return this.peers.get(id)
  }

  peerByPlayer(player: Player): PeerPlayer|undefined {
    return Array.from(this.peers.values()).find((p) => p.playerGet() === player)
  }
  
  connectYom(idPeer: string, playerForPeer: Player) {
    this.connect(idPeer, playerForPeer, () => {}, 'yom')
  }

  connect(idPeer: string, playerDefault: Player, onConnect:(peer: PeerPlayer, conn: any) => void, metadata: any) {
    
    assertf(() => idPeer)
    
    if (this.registrant) {
      if (this.registrant.id == idPeer)
        throw new Error("Can't connect to your own id")
      
      const peerPlayer = this.peers.get(idPeer)
      if (peerPlayer?.open()) {
        console.log("Peer connection already open", idPeer)
      } else if (peerPlayer?.connectingGet()) {
        console.log("Peer already connecting", idPeer)
      } else {
        let peerPlayer = this.peers.get(idPeer)
        if (!peerPlayer) {
          peerPlayer = new PeerPlayer(idPeer, this, playerDefault, this.onReconnect)
          this.peers.set(idPeer, peerPlayer)
        }
        
        console.log("Attempting " + (peerPlayer.connectingGet() ? '' : "re-") + "connection to peer", idPeer)
        const conn = this.registrant.connect(
          idPeer,
          {
            reliable: true,
            metadata: metadata
          }
        )
        
        conn.on('open', () => {
          console.log("Peer opened", conn)

          assert(peerPlayer)
          peerPlayer.onOpened(conn)

          onConnect && onConnect(peerPlayer, conn)
          
          this.events.dispatchEvent(new EventPeerUpdate(Array.from(this.peers.values())))
          
          function ping(secs: any) {
            assert(peerPlayer)
            if (peerPlayer.open()) {
              peerPlayer.send({ping: {secs: secs}})
              window.setTimeout(() => ping(secs+30), 30000)
            }
          }
          ping(0)
          
          conn.on('error', (err: any) => {
            assert(peerPlayer)
            peerPlayer.onOpenFailed(err)
            this.onPeerError(peerPlayer, err)
          })
        })
      }
    } else {
      throw new Error("Not registered")
    }
  }

  broadcast(data: any, exclusions: PeerPlayer[] = []) {
    for (const [id,peer] of this.peers) {
      if (peer.open() && !exclusions.some(p => p.is(peer)))
        peer.send(data)
    }
  }

  onPeerError(peer: PeerPlayer, error: any) {
    console.log('Peer connection error', peer.id, error)
    this.events.dispatchEvent(new EventPeerUpdate(Array.from(this.peers.values())))
  }

  onPeerLost(peer: PeerPlayer) {
    this.peers.delete(peer.id)
    this.events.dispatchEvent(new EventPeerUpdate(Array.from(this.peers.values())))
  }

  onPeerUpdate(registrantPlayer: Player) {
    const peers = this.peersGet().map((p) => p.serialize())
    this.broadcast({
      peerUpdate: {
        peerPlayers: peers.concat([{id: this.registrantId(), player: registrantPlayer.id}])
      }
    })
    this.events.dispatchEvent(new EventPeerUpdate(Array.from(this.peers.values())))
  }

  peersGet() { return Array.from(this.peers.values()) }
}

export abstract class Game extends IdentifiedVar {
  readonly players: Player[]

  constructor(id: string, readonly description: string, readonly makeUi:(...args: any) => void, players: Player[]) {
    super(id)
    this.description = description
    this.makeUi = makeUi
    this.players = players.concat([new PlayerSpectator()])
  }
  
  abstract playfield(players: number): Playfield

  decks(): [string, Card[]][] {
    return [
      ["Standard 52", deck52()],
      ["No deuce 51", deck51NoDeuce()]
    ]
  }
  
  *deal(players: number, playfield: Playfield): Generator<MoveCards, void> {
  }
  
  playfieldNewHand(players: number, playfieldOld: Playfield): Playfield {
    const pf = this.playfield(players)
    return new Playfield(0, pf.containers, playfieldOld.containersChip)
  }

  playersActive(): Player[] {
    return this.players.filter(p => p.idCnts.length != 0)
  }

  spectator(): Player {
    return this.players[this.players.length-1]
  }
  
  protected *dealEach(players: number, playfieldIn: Playfield, cnt: number,
                      ordering: (a: WorldCard, b: WorldCard) => number) {

    let pf = playfieldIn
    
    for (let i = 0; i < cnt; ++i)
      for (const p of this.playersActive().slice(0, players)) {
        const slotSrc = pf.containerCard('stock').slot(0)
        const slotDst = pf.containerCard(p.idCnts[0]).slot(0)
        
        const move = new MoveCards(
          pf.sequence, [slotSrc.top().withFaceUp(true)], slotSrc.id, slotDst.id,
          slotDst.itemAfter(slotSrc.top(), ordering)
        )

        pf = pf.withMoveCards(move)
        yield move
      }
  }
}

export class GameGinRummy extends Game {
  constructor(makeUi:(...args: any) => any) {
    super("gin-rummy", "Gin Rummy", makeUi,
          [new Player('Player 1', ['p0']), new Player('Player 2', ['p1'])])
  }

  deal(players: number, playfield: Playfield) {
    return this.dealEach(players, playfield, 10, orderColorAlternateRankW.bind(null, false))
  }
  
  playfield(players: number): Playfield {
    return new Playfield(
      0,
      [new ContainerSlotCard("p0", [new SlotCard("p0", 0)]),
       new ContainerSlotCard("p1", [new SlotCard("p1", 0)]),
       new ContainerSlotCard("waste", [new SlotCard("waste", 0)]),
       new ContainerSlotCard("stock", [new SlotCard("stock", 0, shuffled(deck52()).map(c => new WorldCard(c, false)))])
      ],
      []
    )
  }
}

export class GameDummy extends Game {
  constructor(makeUi:(...args: any) => any) {
    super("dummy", "Dummy / 500 Rum", makeUi,
          [new Player('Player 1', ['p0']), new Player('Player 2', ['p1'])])
  }
  
  deal(players: number, playfield: Playfield) {
    return this.dealEach(players, playfield, 13, orderColorAlternateRankW.bind(null, false))
  }
  
  playfield(players: number): Playfield {
    return new Playfield(
      0,
      [new ContainerSlotCard("p0", [new SlotCard("p0", 0)]),
       new ContainerSlotCard("p1", [new SlotCard("p1", 0)]),
       new ContainerSlotCard("p0-meld", []),
       new ContainerSlotCard("waste", [new SlotCard("waste", 0)]),
       new ContainerSlotCard("p1-meld", []),
       new ContainerSlotCard("stock", [new SlotCard("stock", 0, shuffled(deck52()).map(c => new WorldCard(c, false)))])
      ],
      []
    )
  }
}

export class GamePoker extends Game {
  constructor(makeUi:(...args: any) => any) {
    super("poker", "Poker", makeUi,
          array.range(8).map((_,i) => new Player('Player '+(i+1), ['p'+i, `p${i}-chip`])))
  }
  
  playfield(players: number): Playfield {
    const deck = shuffled(deck52())

    const chips = (id: string, base: number) => 
      [new SlotChip(id, 0, array.range(3).map((_,i) => new Chip(i+80+100*base, 100))),
       new SlotChip(id, 1, array.range(6).map((_,i) => new Chip(i+60+100*base, 50))),
       new SlotChip(id, 2, array.range(10).map((_,i) => new Chip(i+40+100*base,20))),
       new SlotChip(id, 3, array.range(20).map((_,i) => new Chip(i+20+100*base, 10)))
       ]
    
    return new Playfield(
      0,
      this.players.map(p => new ContainerSlotCard(p.idCnts[0], [new SlotCard(p.idCnts[0], 0)])).concat(
        [new ContainerSlotCard("waste", [new SlotCard("waste", 0)], true),
         new ContainerSlotCard("community", [new SlotCard("community", 0)]),
         new ContainerSlotCard("stock", [new SlotCard("stock", 0, deck.map(c => new WorldCard(c, false)))])]
      ),
      this.players.map((p,idx) => new ContainerSlotChip(p.idCnts[1], chips(p.idCnts[1], idx))).concat(
        [new ContainerSlotChip("ante", array.range(4).map((_,i) => new SlotChip("ante", i)))]
      )
    )
  }
}

export class GamePokerChinese extends Game {
  constructor(makeUi:(...args: any) => any) {
    super("poker-chinese", "Chinese Poker", makeUi,
          array.range(4).map((_,i) => new Player('Player '+(i+1), ['p'+i, `p${i}-chip`])))
  }
  
  deal(players: number, playfield: Playfield) {
    return this.dealEach(players, playfield, 13, orderColorAlternateRankW.bind(null, true))
  }
  
  playfield(players: number): Playfield {
    const chips = (id: string, base: number) => 
      [new SlotChip(id, 0, array.range(3).map((_,i) => new Chip(i+80+100*base, 100))),
       new SlotChip(id, 1, array.range(6).map((_,i) => new Chip(i+60+100*base, 50))),
       new SlotChip(id, 2, array.range(10).map((_,i) => new Chip(i+40+100*base,20))),
       new SlotChip(id, 3, array.range(20).map((_,i) => new Chip(i+20+100*base, 10)))
       ]
    
    return new Playfield(
      0,
      this.players.flatMap(p => [
        new ContainerSlotCard(p.idCnts[0], [new SlotCard(p.idCnts[0], 0)]),
        new ContainerSlotCard(p.idCnts[0] + "-show",
                              array.range(3).map((_,i) => new SlotCard(p.idCnts[0] + "-show", i))),
      ]).concat(
        [
          new ContainerSlotCard("stock", [new SlotCard("stock", 0,
                                                       shuffled(deck52()).map(c => new WorldCard(c, false)))])
        ]
      ),
      this.players.map((p,idx) => new ContainerSlotChip(p.idCnts[1], chips(p.idCnts[1], idx))).concat(
        [new ContainerSlotChip("ante", array.range(4).map((_,i) => new SlotChip("ante", i)))]
      )
    )
  }
}

export class GameHearts extends Game {
  constructor(makeUi:(...args: any) => any) {
    super("hearts", "Hearts", makeUi,
          array.range(4).map((_,i) => new Player('Player '+(i+1), ['p'+i, `p${i}-trick`])))
  }
  
  deal(players: number, playfield: Playfield) {
    const numCards = playfield.containerCard("stock").length()
    return this.dealEach(players, playfield, numCards/players, orderColorAlternateRankW.bind(null, false))
  }
  
  playfield(players: number): Playfield {
    const deck = shuffled(players == 3 ? deck51NoDeuce() : deck52())

    return new Playfield(
      0,
      this.
        players.
        flatMap(p => [
          new ContainerSlotCard(p.idCnts[0], [new SlotCard(p.idCnts[0], 0)]),
          new ContainerSlotCard(p.idCnts[1], [new SlotCard(p.idCnts[1], 0)]),
        ]).
        concat([
          new ContainerSlotCard("trick", [new SlotCard("trick", 0)]),
          new ContainerSlotCard("stock", [new SlotCard("stock", 0, deck.map(c => new WorldCard(c, false)))])
        ]),
      []
    )
  }
}
