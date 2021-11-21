/*
 * Copyright (c) 2021 David Beswick.
 *
 * This file is part of cards-mp 
 * (see https://github.com/dlbeswick/cards-mp).
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */
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
