const parse = require("./parse")
const {buildGraph, CallEffect, PushContext, popContext} = require("./graph")
const {nullMatch} = require("./matchexpr")

module.exports = function(file, showGraph) {
  let ast = parse(file), result = file
  for (let i = ast.body.length - 1; i >= 0; i--) {
    let node = ast.body[i]
    if (node.type == "GrammarDeclaration") {
      if (showGraph) return buildGraph(node).toString()
      result = result.slice(0, node.start) + compileGrammar(node) + result.slice(node.end)
    }
  }
  return result
}

function compileEdge(edge) {
  let match = "null", body = ""
  if (edge.match != nullMatch)
    match = `/^(?:${edge.match.regexp()})/${edge.match.matchesNewline ? "m" : ""}`
  for (let i = 0; i < edge.effects.length; i++) {
    let effect = edge.effects[i]
    if (effect instanceof CallEffect)
      body += `  state.push(${effect.returnTo})\n`
    else if (effect instanceof PushContext)
      body += `  state.pushContext(${JSON.stringify(effect.name)}${!effect.value ? "" : ", " + JSON.stringify(effect.value)})\n`
  }
  if (edge.to)
    body += `  state.push(${edge.to})\n`

  return match + ", " + (body ? "function(state) {\n" + body + "}" : needNoop = "noop")
}

let needNoop = false

function compileGrammar(grammar) {
  let graph = buildGraph(grammar)

  let code = `var ${grammar.id.name} = function() {\n`, nodes = []
  needNoop = false

  for (let name in graph.nodes) {
    let edges = graph.nodes[name]
    nodes.push(`${name} = [${edges.map(compileEdge).join(",\n")}]`)
  }
  code += `var ${nodes.join(",\n")}\n`

  if (needNoop) code += `function noop(){}\n`

  code += require("fs").readFileSync(__dirname + "/matcher.js", "utf8")

  code += `return new GrammarMode(${graph.rules.START.start})\n`

  return code + "}();\n"
}
