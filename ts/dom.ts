import { assert, assertf } from './assert.js'

export function withElement<T extends HTMLElement>(id:string, klass:new() => T, func:(t:T) => void) {
  func(demandById(id, klass))
}

export function demandById<T extends HTMLElement=HTMLElement>(id:string, klass?:new() => T):T {
  const klass_:any = klass ?? HTMLElement
  
  const result = document.getElementById(id)
  if (result == undefined) {
    throw new Error(`DOM element '${id}' not found`)
  } else if (!(result instanceof klass_)) {
    throw new Error(`DOM element '${id}' is not '${klass}', but is '${result.constructor.name}'`)
  } else {
    return result as T
  }
}

type RefEventListener = [string, (e:Event) => void]

export class EventListeners {
  private refs:RefEventListener[] = []
  private target:EventTarget

  constructor(e:EventTarget) {
    this.target = e
  }
  
  add<T extends Event>(typeEvent:string, handler:(e:T) => boolean):RefEventListener {
    const ref:RefEventListener = [typeEvent,
                                  EventListeners.preventDefaultWrapper.bind(undefined, handler)]
    this.refs.push(ref)
    this.target.addEventListener(typeEvent, ref[1])
    return ref
  }

  removeAll() {
    for (const ref of this.refs)
      this.target.removeEventListener(...ref)
    this.refs = []
  }

  remove(ref:RefEventListener) {
    const idx = this.refs.indexOf(ref)
    assert(idx != -1)
    this.target.removeEventListener(...ref)
    this.refs = this.refs.splice(0, idx).concat(this.refs.splice(idx+1))
  }
  
  private static preventDefaultWrapper(func:(e:any) => boolean, e:any):void {
    if (!func(e)) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
}

