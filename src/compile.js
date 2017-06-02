const {Call, Token} = require("./graph")
const {OP_CALL, OP_TOKEN} = require("./matchexpr")

function buildEdgeInfo(graphs, getName) {
  let edgeList = [], exprN = 0

  for (let name in graphs) graphs[name].edges(({match, effect, to}) => {
    let expr
    if (effect instanceof Call) {
      expr = `[${OP_CALL}, ${getName(effect.target.name)}]` // FIXME context
    } else {
      expr = match.toExpr(getName)
      if (effect instanceof Token) expr = `[${OP_TOKEN}, ${expr}]`
    }
    let useExpr = -1
    if (expr.length > 8) for (let i = 0; i < edgeList.length; i++) {
      let other = edgeList[i]
      if (other.expr == expr) {
        useExpr = other.useExpr == -1 ? other.useExpr = exprN++ : other.useExpr
        break
      }
    }
    edgeList.push({
      expr: useExpr == -1 ? expr : null,
      useExpr,
      to: to == null ? -1 : to
    })
  })
  return edgeList
}

function compileEdge(edgeInfo) {
  let match = edgeInfo.useExpr != -1 ? `e[${edgeInfo.useExpr}]` : edgeInfo.expr
  return `${match}, ${edgeInfo.to}`
}

module.exports = function(graphs, options = {}) {
  let getName = options.names ? JSON.stringify : (() => {
    let names = Object.keys(graphs)
    return n => names.indexOf(n)
  })()
  let edgeInfo = buildEdgeInfo(graphs, getName)

  let exprVector = []
  for (let i = 0; i < edgeInfo.length; i++) {
    let info = edgeInfo[i]
    if (info.useExpr > -1 && info.expr) exprVector[info.useExpr] = info.expr
  }

  let code = "", exp = options.esModule ? "export var " : "exports."
  if (exprVector.length) code += `var e = [${exprVector.join(", ")}]\n`
  let graphCode = [], edgeIndex = 0
  for (let name in graphs) {
    let graph = graphs[name], nodeCode = []
    for (let i = 0; i < graph.nodes.length; i++) {
      let edges = graph.nodes[i], edgeCode = []
      for (let j = 0; j < edges.length; j++)
        edgeCode.push(compileEdge(edgeInfo[edgeIndex++]))
      nodeCode.push(`[${edgeCode.join(",\n     ")}]`)
    }
    let nodeCodeFlat = `[\n    ${nodeCode.join(",\n    ")}\n  ]`
    if (options.names) graphCode.push(`${name}: ${nodeCodeFlat}`)
    else graphCode.push(nodeCodeFlat)
  }
  code += `${exp}graphs = ${options.names ? "{" : "["}\n  ${graphCode.join(",\n  ")}\n${options.names ? "}" : "]"}\n`

  return code
}
