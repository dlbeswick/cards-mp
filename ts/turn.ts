import { assert } from './assert.js'
import * as array from './array.js'
import * as it from "./iterator.js"
import * as set from './set.js'
import {
  ConflictResolution, MoveItemsAny, Playfield, deserializeMove, 
} from "./game.js"

export class Turn {
  constructor(
    readonly playfield: Playfield,
    readonly sequence: number,
    readonly moves: readonly MoveItemsAny[],
    readonly invalidated: Set<MoveItemsAny> = new Set()
  ) {}

  get isEmpty() {
    return this.moves.length == 0
  }
  
  get isValid() {
    return this.moves.some(move => this.moves.some(other => move.isConflictingWith(other))) == false
  }
  
  get nextPlayfield() {
    assert(this.isValid)

    return this.moves.
      reduce((pf, move) => move.apply(pf), this.playfield).
      withTurnSequence(this.playfield.sequence + 1)
  }

  withMove(move: MoveItemsAny) {
    return new Turn(this.playfield, this.sequence, this.moves.concat(move))
  }

  withConflictsRemoved(invalidated: Set<MoveItemsAny>) {
    const unionInvalidated = set.union(this.invalidated, invalidated)
    
    const [nonConflict, conflict] =
      array.partition(
        this.moves,
        move => it.some(unionInvalidated, c => move.isConflictingWith(c))
      )

    return new Turn(
      this.playfield,
      this.sequence,
      nonConflict,
      set.union(new Set(conflict), unionInvalidated)
    )
  }
  
  withConflictsResolved() {
    const f =
      (lhs: MoveItemsAny,
       items: readonly MoveItemsAny[],
       result: readonly MoveItemsAny[],
       removed: readonly MoveItemsAny[]): [readonly MoveItemsAny[], readonly MoveItemsAny[]] => {
        
        let tail = items
        while (tail.length != 0) {
          const item = tail[0]
          
          switch (lhs.resolveConflictWith(item)) {
            case ConflictResolution.BOTH_STAY:
              break;
            case ConflictResolution.LEFT_STAY:
              return f(lhs, array.remove(items, item), result, removed.concat([item]));
            case ConflictResolution.RIGHT_STAY:
              return f(items[0], items.slice(1), result, removed.concat([item]));
            case ConflictResolution.BOTH_REMOVE:
              return f(items[0], array.remove(items.slice(1), item), result, removed);
            default:
              assert(false)
          }
          
          tail = items.slice(1)
        }

        if (items.length == 0)
          return [result.concat(lhs), removed]
        else
          return f(items[0], items.slice(1), result.concat(lhs), removed)
      }

    const [resolved, removed] = f(this.moves[0], this.moves.slice(1), [], [])
    
    return new Turn(this.playfield, this.sequence, resolved, new Set(removed))
  }
  
  withPlayfield(playfield: Playfield) {
    return new Turn(playfield, this.sequence, this.moves, this.invalidated)
  }

  serialize() {
    return {
      playfield: this.playfield.serialize(),
      sequence: this.sequence,
      moves: this.moves.map(m => m.serialize())
    }
  }

  static fromSerialized(s: any) {
    const pf = Playfield.fromSerialized(s.playfield)
    return new Turn(
      pf,
      s.sequence,
      s.moves.map((m: any) => deserializeMove(m))
    )
  }
}

export class Gameplay {
  private _turns: Turn[] = [new Turn(new Playfield(0, [], []), 0, [])]

  private turnsReplay(fromIdx: number): Array<Turn> {
    const turnsProcessed: Array<Turn> = []

    // Process turns until reaching the head of the turn list, as long as the head is empty.
    // If the head isn't empty, create a new empty head at the end of the list.
    for (let turnIdx = fromIdx;
         turnIdx < this._turns.length && !(turnIdx == this._turns.length - 1 && this._turns[turnIdx].isEmpty); ) {
      
      const turn = this._turns[turnIdx]
      if (turn.isValid) {
        if (turn.isEmpty && turnIdx == this._turns.length - 1) {
          break;
        }
        
        const pf = turn.nextPlayfield
        assert(pf)

        if (turnIdx == this._turns.length - 1)
          this._turns[turnIdx+1] = new Turn(pf, pf.sequence, [])
        else
          this._turns[turnIdx+1] = this._turns[turnIdx+1].withPlayfield(pf)

        assert(this._turns[turnIdx+1].sequence - this._turns[turnIdx].sequence == 1)
        
        turnsProcessed.push(this._turns[turnIdx])

        ++turnIdx;
      } else {
        const resolved = turn.withConflictsResolved()
        this._turns[turnIdx] = resolved

        let invalidated = resolved.invalidated
        for (let turnIdx2 = fromIdx+1; turnIdx2 < this._turns.length; ++turnIdx2) {
          this._turns[turnIdx2] = this._turns[turnIdx2].withConflictsRemoved(invalidated)
          invalidated = this._turns[turnIdx2].invalidated
        }
      }

      assert(turnIdx == this._turns.length || this._turns[turnIdx].isValid)
    }

    this._turns.reduce((a,b) => {
      assert(b.sequence - a.sequence == 1, "Turns out-of-sequence"); return b
    })
    
    return turnsProcessed
  }

  get turnCurrent() {
    assert(this._turns.length > 0)
    return this._turns[this._turns.length - 1]
  }
  
  get playfield() {
    return this.turnCurrent.playfield
  }

  get turns(): readonly Turn[] {
    return Array.from(this._turns)
  }

  newGame(turns: readonly Turn[]) {
    this._turns = Array.from(turns)
  }

  hasSequence(sequence: number) {
    return this._turns.findIndex(t => t.sequence == sequence) != -1
  }

  restateTurn(turn: Turn) {
    const idx = this._turns.findIndex(t => t.sequence == turn.sequence)
    assert(idx != -1)
    this._turns[idx] = turn
    this.turnsReplay(idx)
  }
  
  integrateMove(move: MoveItemsAny): Set<[string, number]> {
    console.debug("Integrate move at sequence", move.turnSequence, move.items, move.idSource, move.idDest)
    
    const slotsChanged = new Set<[string, number]>()

    let turnsProcessed: Array<Turn>

    let turnIdx = this._turns.findIndex(t => t.sequence == move.turnSequence)
    assert(turnIdx != -1)

    this._turns[turnIdx] = this._turns[turnIdx].withMove(move)
    turnsProcessed = this.turnsReplay(turnIdx)
    if (this._turns.length > 100)
      this._turns.shift()

    for (const turn of turnsProcessed) {
      for (const move of turn.moves) {
        move.slotsChanged.forEach(s => slotsChanged.add(s))
      }
    }

    return slotsChanged
  }
}
