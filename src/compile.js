const {CallEffect, PushContext, popContext} = require("./graph")
const {nullMatch, LookaheadMatch, ChoiceMatch, eqArray} = require("./matchexpr")
const opcode = require("./opcode")

function generateRe(match) {
  let re = match.regexp()
  if (match instanceof ChoiceMatch) re = `(?:${re})`
  return `/^${re}/`
}

function buildEdgeInfo(graph, names) {
  let edgeList = [], regexpN = 0, codeN = 0

  for (let n in graph.nodes) {
    let edges = graph.nodes[n]
    for (let i = 0; i < edges.length; i++) {
      let {match, effects, to} = edges[i]
      let regexp = match instanceof LookaheadMatch || match == nullMatch ? null : generateRe(match)
      let code = generateCode(effects, to, names)
      let useRegexp = -1, useCode = -1
      for (let j = 0; j < edgeList.length; j++) {
        let other = edgeList[j]
        if (useRegexp == -1 && regexp && regexp.length > 8 && other.regexp == regexp)
          useRegexp = other.useRegexp == -1 ? other.useRegexp = regexpN++ : other.useRegexp
        if (useCode == -1 && other.code == code)
          useCode = other.useCode == -1 ? other.useCode = codeN++ : other.useCode
      }
      edgeList.push({
        regexp: useRegexp == -1 ? regexp : null,
        useRegexp,
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

function generateCode(effects, to, names) {
  let codes = [], result = null
  for (let i = 0; i < effects.length; i++) {
    let effect = effects[i]
    if (effect instanceof CallEffect) {
      codes.push(opcode.PUSH, names.indexOf(effect.returnTo))
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
  if (to) codes.push(opcode.PUSH, names.indexOf(to))
  if (result) codes.push(opcode.TOKEN, JSON.stringify(result))
  return `[${codes.join(", ")}]`
}

function compileEdge(edge, edgeInfo, names) {
  let match, code
  if (edge.match instanceof LookaheadMatch)
    match = `${edge.match.positive ? "" : "-"}${names.indexOf(edge.match.start)}`
  else if (edge.match == nullMatch)
    match = "null"
  else if (edgeInfo.useRegexp != -1)
    match = `re[${edgeInfo.useRegexp}]`
  else
    match = edgeInfo.regexp

  if (edgeInfo.useCode != -1)
    code = `code[${edgeInfo.useCode}]`
  else
    code = edgeInfo.code

  return `${match}, ${code}`
}

module.exports = function(graph, options = {}) {
  let names = Object.keys(graph.nodes)
  let edgeInfo = buildEdgeInfo(graph, names)

  let regexpVector = [], codeVector = []
  for (let i = 0; i < edgeInfo.length; i++) {
    let info = edgeInfo[i]
    if (info.useRegexp > -1 && info.regexp) regexpVector[info.useRegexp] = info.regexp
    if (info.useCode > -1 && info.code) codeVector[info.useCode] = info.code
  }

  let code = "", exp = options.esModule ? "export var " : "exports."
  if (regexpVector.length) code += `var re = [${regexpVector.join(", ")}]\n`
  if (codeVector.length) code += `var code = [${codeVector.join(", ")}]\n`
  let nodes = [], edgeIndex = 0
  for (let name in graph.nodes)
    nodes.push(`[${graph.nodes[name].map(edge => compileEdge(edge, edgeInfo[edgeIndex++], names)).join(",\n   ")}]`)
  code += `${exp}nodes = [\n  ${nodes.join(",\n  ")}\n]\n`
  if (options.names) code += `${exp}names = ${JSON.stringify(names)}\n`
  code += `${exp}start = ${names.indexOf(graph.start)}\n`
  code += `${exp}token = ${names.indexOf(graph.token)}\n`

  return code
}
