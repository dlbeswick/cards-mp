import * as dom from "./dom"

export default function errorHandler(message, source?, lineno?, colno?, error?, showAlert=true) {
  if (showAlert)
    alert(message)
  dom.demandById("error").style.display = "block"
  dom.demandById("error").innerHTML = message + "<br/>" + "Line: " + lineno + "<br/>" + source
  console.error(message)
  return true
}

