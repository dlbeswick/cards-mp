import * as dom from "./dom.js"

export default function errorHandler(message:any, source?:any, lineno?:any, colno?:any, error?:any, showAlert=true) {
  if (showAlert)
    alert(message)
  dom.demandById("error").style.display = "block"
  dom.demandById("error").innerHTML = message + "<br/>" + "Line: " + lineno + "<br/>" + source
  console.error(message)
  return true
}

