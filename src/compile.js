const {CallEffect, PushContext, popContext} = require("./graph")
const opcode = require("./opcode")

function buildEdgeInfo(graph, nodeName) {
  let edgeList = [], exprN = 0, codeN = 0

  for (let n in graph.nodes) {
    let edges = graph.nodes[n]
    for (let i = 0; i < edges.length; i++) {
      let {match, effects, to} = edges[i]
      let expr = match.toExpr(nodeName)
      let code = generateCode(effects, to, nodeName)
      let useExpr = -1, useCode = -1
      for (let j = 0; j < edgeList.length; j++) {
        let other = edgeList[j]
        if (useExpr == -1 && expr.length > 8 && other.expr == expr)
          useExpr = other.useExpr == -1 ? other.useExpr = exprN++ : other.useExpr
        if (useCode == -1 && other.code == code)
          useCode = other.useCode == -1 ? other.useCode = codeN++ : other.useCode
      }
      edgeList.push({
        expr: useExpr == -1 ? expr : null,
        useExpr,
        code: useCode == -1 ? code : null,
        useCode
      })
    }
  }
  return edgeList
}

function isLocalPush(effects, index) {
  for (let depth = 0, i = index + 1; i < effects.length; i++) {
    if (effects[i] instanceof PushContext) {
      depth++
    } else if (effects[i] == popContext) {
      if (depth == 0) return true
      depth--
    }
  }
  return false
}

function generateCode(effects, to, nodeName) {
  let codes = [], result = null
  for (let i = 0; i < effects.length; i++) {
    let effect = effects[i]
    if (effect instanceof CallEffect) {
      codes.push(opcode.PUSH, nodeName(effect.returnTo))
    } else if (effect instanceof PushContext) {
      if (isLocalPush(effects, i)) {
        if (effect.tokenType)
          result = (result ? result + " " : "") + effect.tokenType
      } else {
        if (effect.tokenType)
          codes.push(opcode.ADD_TOKEN_CONTEXT, JSON.stringify(effect.name), JSON.stringify(effect.tokenType))
        else
          codes.push(opcode.ADD_CONTEXT, JSON.stringify(effect.name))
      }
    }
  }
  if (to) codes.push(opcode.PUSH, nodeName(to))
  if (result) codes.push(opcode.TOKEN, JSON.stringify(result))
  return `[${codes.join(", ")}]`
}

function compileEdge(edgeInfo) {
  let match, code
  if (edgeInfo.useExpr != -1)
    match = `e[${edgeInfo.useExpr}]`
  else
    match = edgeInfo.expr

  if (edgeInfo.useCode != -1)
    code = `c[${edgeInfo.useCode}]`
  else
    code = edgeInfo.code

  return `${match}, ${code}`
}

module.exports = function(graph, options = {}) {
  let nodeName = options.names ? JSON.stringify : (() => {
    let props = Object.keys(graph.nodes)
    return x => props.indexOf(x)
  })()
  let edgeInfo = buildEdgeInfo(graph, nodeName)

  let exprVector = [], codeVector = []
  for (let i = 0; i < edgeInfo.length; i++) {
    let info = edgeInfo[i]
    if (info.useExpr > -1 && info.expr) exprVector[info.useExpr] = info.expr
    if (info.useCode > -1 && info.code) codeVector[info.useCode] = info.code
  }

  let code = "", exp = options.esModule ? "export var " : "exports."
  if (exprVector.length) code += `var e = [${exprVector.join(", ")}]\n`
  if (codeVector.length) code += `var c = [${codeVector.join(", ")}]\n`
  let nodes = [], edgeIndex = 0
  for (let name in graph.nodes) {
    let content = `[${graph.nodes[name].map(_ => compileEdge(edgeInfo[edgeIndex++])).join(",\n   ")}]`
    if (options.names) nodes.push(`${name}: ${content}`)
    else nodes.push(content)
  }
  code += `${exp}nodes = ${options.names ? "{" : "["}\n  ${nodes.join(",\n  ")}\n${options.names ? "}" : "]"}\n`
  code += `${exp}start = ${nodeName(graph.start)}\n`
  code += `${exp}token = ${nodeName(graph.token)}\n`

  return code
}
