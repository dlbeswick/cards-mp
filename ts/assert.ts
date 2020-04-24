import errorHandler from "./error_handler.js"

export default function assert(test:() => any, message='', ...args:any) {
  if (!test()) {
    message = test.toString() + ", " + message
    for (let arg of args) {
      message += JSON.stringify(arg) + " "
    }
    errorHandler(message, undefined, undefined, undefined, undefined, false)
    throw new Error(message)
  }
}

