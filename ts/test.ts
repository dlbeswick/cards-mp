import { GameGinRummy, MoveCards } from "./game.js"
import { Gameplay, Turn } from "./turn.js"

export function test() {
  const gp = new Gameplay()
  gp.newGame([new Turn(new GameGinRummy(() => {}).playfield(2), 0, [])])
  const stock = gp.playfield.containerCard("stock").first()
  const p0 = gp.playfield.containerCard("p0").first()
  const p1 = gp.playfield.containerCard("p1").first()
  const waste = gp.playfield.containerCard("waste").first()
  const card = stock.top()
  gp.integrateMove(new MoveCards(gp.turnCurrent.sequence, [card], stock.id, waste.id, undefined, [], 1))
  console.debug("After move 0", gp.turns)
  gp.integrateMove(new MoveCards(gp.turnCurrent.sequence, [card], waste.id, p1.id, undefined, [], 2))
  console.debug("After move 1", gp.turns)
  gp.integrateMove(new MoveCards(gp.turnCurrent.sequence, [card], p1.id, p0.id, undefined, [], 3))
  console.debug("After move 2", gp.turns)
  gp.integrateMove(new MoveCards(0, [card], stock.id, p1.id, undefined, [], 0))
  console.debug("After conflict", gp.turns)
  return true
}
