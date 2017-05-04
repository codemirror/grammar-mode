const parse = require("./parse")
const buildGraph = require("./graph")

module.exports = function(file) {
  let ast = parse(file), result = file
  for (let i = ast.body.length - 1; i >= 0; i--) {
    let node = ast.body[i]
    if (node.type == "GrammarDeclaration")
      result = result.slice(0, node.start) + compileGrammar(node, file) + result.slice(node.end)
  }
  return result
}

function compileGrammar(grammar, file) {
  let graph = buildGraph(grammar)
  console.log(graph.toString())
  return "FIXME"
}
