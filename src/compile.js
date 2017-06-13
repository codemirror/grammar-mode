const {Call, Token} = require("./graph")

function buildEdgeInfo(graphs, getName, options) {
  let edgeList = [], matchN = 0

  for (let name in graphs) {
    let graph = graphs[name]
    for (let node = 0; node < graph.nodes.length; node++) {
      let edges = graph.nodes[node], nodeName = getName(name, node)
      for (let i = 0; i < edges.length; i++) {
        let {match, effect, to} = edges[i], matchStr = match.toExpr(getName)
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
          to,
          match: useMatch == -1 ? matchStr : null,
          useMatch,
          effect,
          graph: name
        })
      }
    }
  }
  return edgeList
}

// An edge can be one of the following:
// 0, nextNode                           null edge
// 1, callTarget, returnTo               regular call
// 2, callTarget, returnTo, context      context call
// 3, tokenType, matchExpr, nextNode     token edge
// matchExpr, nextNode                   regular match edge
function compileEdge(edgeInfo, getName) {
  let to = edgeInfo.to == null ? -1 : getName(edgeInfo.graph, edgeInfo.to)
  if (edgeInfo.effect instanceof Call) {
    let {target, context} = edgeInfo.effect
    if (!context) return `1, ${getName(target.name)}, ${to}`
    return `2, ${getName(target.name)}, ${to}, ${JSON.stringify(context)}`
  }
  let match = edgeInfo.useMatch != -1 ? `e[${edgeInfo.useMatch}]` : edgeInfo.match
  if (edgeInfo.effect instanceof Token)
    return `3, ${JSON.stringify(edgeInfo.effect.type)}, ${match}, ${to}`
  if (match == "null")
    return `0, ${to}`
  return `${match}, ${to}`
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
    edges.push(compileEdge(info, getName))
  }
  code += `${exp}nodes = ${options.names ? "{" : "["}\n  ${nodes.join(",\n  ")}\n${options.names ? "}" : "]"}\n`
  code += `${exp}start = ${getName("_start")}\n`
  if (options.tokens !== false)
    code += `${exp}token = ${getName("_token")}\n`

  return code
}
