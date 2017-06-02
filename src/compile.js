const {Call, Token} = require("./graph")
const {OP_CALL, OP_TOKEN} = require("./matchexpr")

function buildEdgeInfo(graphs, getName, options) {
  let edgeList = [], matchN = 0

  for (let name in graphs) {
    let graph = graphs[name]
    for (let node = 0; node < graph.nodes.length; node++) {
      let edges = graph.nodes[node], nodeName = getName(name, node)
      for (let i = 0; i < edges.length; i++) {
        let {match, effect, to} = edges[i], matchStr
        if (effect instanceof Call) {
          matchStr = `[${OP_CALL}, ${getName(effect.target.name)}]` // FIXME context
        } else {
          matchStr = match.toExpr(getName)
          if (effect instanceof Token) matchStr = `[${OP_TOKEN}, ${matchStr}]`
        }
        let useMatch = -1
        if (matchStr.length > 8 && !options.names) for (let j = 0; j < edgeList.length; j++) {
          let other = edgeList[j]
          if (other.match == matchStr) {
            useMatch = other.useMatch == -1 ? other.useMatch = matchN++ : other.useMatch
            break
          }
        }
        edgeList.push({
          from: nodeName,
          to: to == null ? -1 : getName(name, to),
          match: useMatch == -1 ? matchStr : null,
          useMatch
        })
      }
    }
  }
  return edgeList
}

function compileEdge(edgeInfo) {
  let match = edgeInfo.useMatch != -1 ? `e[${edgeInfo.useMatch}]` : edgeInfo.match
  return `${match}, ${edgeInfo.to}`
}

function buildNamer(graphs, options) {
  if (options.names) {
    return (graphName, node) => JSON.stringify(graphName + (node ? "$" + node : ""))
  } else {
    let offsets = {}, offset = 0
    for (let name in graphs) {
      offsets[name] = offset
      offset += graphs[name].nodes.length
    }
    return (graphName, node) => offsets[graphName] + (node || 0)
  }
}

module.exports = function(graphs, options = {}) {
  let getName = buildNamer(graphs, options)
  let edgeInfo = buildEdgeInfo(graphs, getName, options)

  let exprVector = []
  for (let i = 0; i < edgeInfo.length; i++) {
    let info = edgeInfo[i]
    if (info.useMatch > -1 && info.match) exprVector[info.useMatch] = info.match
  }

  let code = "", exp = options.esModule ? "export var " : "exports."
  if (exprVector.length) code += `var e = [${exprVector.join(", ")}]\n`
  let edges = [], nodes = []
  for (let curNode = edgeInfo[0].from, i = 0;; i++) {
    let info = edgeInfo[i]
    if (!info || info.from != curNode) {
      if (options.names) nodes.push(`${curNode}: [\n    ${edges.join(",\n    ")}\n  ]`)
      else nodes.push(`[${edges.join(",\n   ")}]`)
      if (!info) break
      curNode = info.from
      edges.length = 0
    }
    edges.push(compileEdge(info))
  }
  code += `${exp}graph = ${options.names ? "{" : "["}\n  ${nodes.join("\n  ")}\n${options.names ? "}" : "]"}\n`

  return code
}
