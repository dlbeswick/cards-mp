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
import errorHandler from "./error_handler.js"

export function assert(test:any, message='Assertion failed', ...args:any): asserts test {
  if (!test) {
    message = [message, ...args.map(JSON.stringify)].join(", ")
    errorHandler(message, undefined, undefined, undefined, undefined, false)
    throw new Error(message)
  }
}

export function assertf(test:() => any, message?:string, ...args:any):void {
  if (!test()) {
    message = message ?? test.toString() + args.map(JSON.stringify).join(", ")
    errorHandler(message, undefined, undefined, undefined, undefined, false)
    throw new Error(message)
  }
}

