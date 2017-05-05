const parse = require("./parse")
const buildGraph = require("./graph")
const {nullMatch, StringMatch} = require("./matchexpr")

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
  let code = "function(stream, state) {\n", match = edge.match
  if (match instanceof StringMatch) {
    if (match.matchesNewline)
      code += "if (!stream.sol()) return F;\n"
    else
      code += `if (!stream.match(/${JSON.stringify(match.string)}/)) return F;\n`
  } else if (match != nullMatch) {
    code += `if (!stream.match(/^(?:${match.regexp()})/)) return F;\n`
  }
  code += "return state.context;\n}"
  return code
}

function compileGrammar(grammar) {
  let graph = buildGraph(grammar)

  let code = `var ${grammar.id.name} = function() {\n`
  code += `var F = {};\n`
  for (let name in graph.nodes) {
    let edges = graph.nodes[name]
    code += `var ${name} = [${edges.map(compileEdge).join(", ")}];\n`
  }

  return code + "}();\n"
}
