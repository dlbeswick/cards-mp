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
