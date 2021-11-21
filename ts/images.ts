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
function load(url: string) {
  const img = document.createElement("div")
  img.style.content = "url(" + url + ")"
  return img
}

export class Images {
  readonly cards: HTMLDivElement[] = []
  readonly cardBack: HTMLDivElement
  
  constructor(urlCards: string, urlCardBack: string) {
    for (let s = 0; s < 4; ++s) {
      for (let r = 0; r < 13; ++r) {
        this.cards.push(load(urlCards + '#c' + s + '_' + r))
      }
    }
    
    this.cardBack = load(urlCardBack)
  }

  card(suit: number, rank: number): HTMLDivElement {
    return this.cards[suit*13+rank].cloneNode(true) as HTMLDivElement
  }
}
