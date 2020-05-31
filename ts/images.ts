function load(url:string) {
  const img = document.createElement("img")
  img.src = url
  return img
}

export class Images {
  readonly cards:HTMLImageElement[] = []
  readonly cardBack:HTMLImageElement
  
  constructor(urlCards:string, urlCardBack:string) {
    for (let s = 0; s < 4; ++s) {
      for (let r = 0; r < 13; ++r) {
        this.cards.push(load(urlCards + '#c' + s + '_' + r))
      }
    }
    
    this.cardBack = load(urlCardBack)
  }
}
