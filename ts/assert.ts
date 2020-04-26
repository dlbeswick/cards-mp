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

