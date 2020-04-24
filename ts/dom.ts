export function withElement<T extends HTMLElement>(id:string, klass:new() => T, func:(t:T) => void) {
  func(demandById(id, klass))
}

export function demandById<T extends HTMLElement=HTMLElement>(id:string, klass?:new() => T):T {
  const klass_:any = klass ?? HTMLElement
  
  const result = document.getElementById(id)
  if (result == undefined) {
    throw new Error(`Element '${id}' not found`)
  } else if (!(result instanceof klass_)) {
    throw new Error(`Element '${id}' is not '${klass}', but is '${result.constructor.name}'`)
  } else {
    return result as T
  }
}

