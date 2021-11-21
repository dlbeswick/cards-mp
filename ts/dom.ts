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
  private refs: RefEventListener[] = []
  private target: EventTarget

  constructor(e: EventTarget) {
    this.target = e
  }
  
  add<T extends Event>(typeEvent:string, handler:(e:T) => boolean|void,
                       options:AddEventListenerOptions={}):RefEventListener {

    const ref:RefEventListener = [typeEvent,
                                  EventListeners.preventDefaultWrapper.bind(undefined, handler)]
    this.refs.push(ref)
    this.target.addEventListener(typeEvent, ref[1], options)
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
  
  private static preventDefaultWrapper(func: (e:any) => boolean|void, e: any): boolean|void {
    const result = func(e)
    if (result === false) {
      e.preventDefault()
      e.stopPropagation()
    }
    return result
  }
}

