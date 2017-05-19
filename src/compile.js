const {CallEffect, PushContext, popContext} = require("./graph")
const {nullMatch, LookaheadMatch, eqArray} = require("./matchexpr")
const reserved = require("./reserved")

function buildEdgeInfo(graph) {
  let edgeList = [], vars = Object.create(null)
  function createVar(base) {
    for (let i = 0;; i++) {
      let name = base + "_" + i
      if (!(name in vars) && !reserved.hasOwnProperty(name) && !(name in graph.nodes)) {
        vars[name] = true
        return name
      }
    }
  }

  for (let n in graph.nodes) {
    let edges = graph.nodes[n]
    for (let i = 0; i < edges.length; i++) {
      let {match, effects, to} = edges[i]
      let regexp = match instanceof LookaheadMatch || match == nullMatch ? null : `/^(?:${match.regexp()})/`
      let useRegexp = null, useEffects = null
      for (let j = 0; j < edgeList.length; j++) {
        let other = edgeList[j]
        if (useRegexp == null && regexp && regexp.length > 8 && other.regexp == regexp)
          useRegexp = other.useRegexp || (other.useRegexp = createVar("re"))
        if (useEffects == null && other.to == to && other.effects && eqArray(effects, other.effects))
          useEffects = other.useEffects || (other.useEffects = createVar("apply"))
      }
      edgeList.push({
        regexp: useRegexp == null ? regexp : null,
        useRegexp,
        effects: useEffects == null ? effects : null,
        to,
        useEffects
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

function generateApply(effects, to) {
  let body = "", result = null
  for (let i = 0; i < effects.length; i++) {
    let effect = effects[i]
    if (effect instanceof CallEffect) {
      body += `  state.push(${effect.returnTo})\n`
    } else if (effect instanceof PushContext) {
      if (!isLocalPush(effects, i))
        body += `  state.pushContext(${JSON.stringify(effect.name)}${!effect.tokenType ? "" : ", " + JSON.stringify(effect.tokenType)})\n`
      else if (effect.tokenType)
        result = (result ? result + " " : "") + effect.tokenType
    }
  }
  if (to) body += `  state.push(${to})\n`
  if (result) body += `  return ${JSON.stringify(result)}\n`
  return `function(state) {\n${body}}`
}

function compileEdge(edge, edgeInfo) {
  let parts = []
  if (edge.match instanceof LookaheadMatch) {
    parts.push(`lookahead: ${edge.match.start}, type: ${edge.match.positive ? `"~"` : `"!"`}`)
  } else if (edge.match != nullMatch) {
    parts.push(`match: ${edgeInfo.useRegexp || edgeInfo.regexp}`)
  }
  parts.push(`apply: ${edgeInfo.useEffects || generateApply(edge.effects, edge.to)}`)
  return `{${parts.join(", ")}}`
}

module.exports = function(graph, options = {}) {
  let code = "", vars = []

  let edgeInfo = buildEdgeInfo(graph)
  for (let i = 0; i < edgeInfo.length; i++) {
    let info = edgeInfo[i]
    if (info.useRegexp && info.regexp)
      vars.push(`${info.useRegexp} = ${info.regexp}`)
    if (info.useEffects && info.effects)
      vars.push(`${info.useEffects} = ${generateApply(info.effects, info.to)}`)
  }
  let edgeIndex = 0
  for (let name in graph.nodes)
    vars.push(`${name} = [${JSON.stringify(name)},\n${graph.nodes[name].map(edge => compileEdge(edge, edgeInfo[edgeIndex++])).join(",\n")}]`)

  code += `var ${vars.join(",\n")}\n`

  if (options.esModule) {
    code += `export var start = ${graph.start}\n`
    if (graph.token) code += `export var token = ${graph.token}\n`
  } else {
    code += `exports.start = ${graph.start}\n`
    if (graph.token) code += `exports.token = ${graph.token}\n`
  }

  return code
}
