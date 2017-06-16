const {nullMatch, anyMatch, dotMatch, StringMatch, RangeMatch, SeqMatch,
       ChoiceMatch, RepeatMatch, LookaheadMatch, PredicateMatch} = require("./matchexpr")
const {normalizeExpr, eqExprs, instantiateArgs, forEachExpr} = require("./ast")

exports.buildGraph = function(grammar, options) {
  let {rules, start, tokens} = gatherRules(grammar)
  countReferences(rules, start, tokens)
  let cx = new Context(rules, Object.create(null))
  let startGraph = cx.registerGraph("_start", new SubGraph), after = startGraph.node()
  startGraph.copy(0, after, cx.evalCall(start, []))
  startGraph.edge(after, 0, anyMatch)
  let startGraphs = ["_start"]

  if (options.token !== false) {
    let tokenGraph = cx.registerGraph("_token", new SubGraph)
    for (let i = 0; i < tokens.length; i++)
      tokenGraph.copy(0, null, cx.evalCall(tokens[i], []))
    tokenGraph.edge(0, null, anyMatch)
    startGraphs.push("_token")
  }

  return gcGraphs(cx.graphs, startGraphs)
}

class Call {
  constructor(target, context) { this.target = target; this.context = context }
  toString() { return `CALL(${this.target.name})` }
}
exports.Call = Call
class Token {
  constructor(type) { this.type = type }
  toString() { return `TOKEN(${this.type})` }
}
exports.Token = Token

class Edge {
  constructor(to, match, effect) {
    this.to = to
    this.match = match
    this.effect = effect
  }

  toString(graph, from) {
    let result = `${graph}_${from} -> ${graph}_${this.to == null ? "RET" : this.to}`, label = this.match.toRegexp()
    if (this.effect) label = (label ? label + " " : "") + this.effect.toString()
    if (label) result += `[label=${JSON.stringify(label)}]`
    return result
  }

  canCombine(other) {
    if (this.effect instanceof Call || other.effect instanceof Call) return false
    let thisIsolated = this.match.isolated || !!this.effect, otherIsolated = other.match.isolated || !!other.effect
    return thisIsolated ? other.match.isNull && !otherIsolated
      : otherIsolated ? this.match.isNull
      : true
  }
}

class Rule {
  constructor(name, expr, params, context) {
    this.name = name
    this.expr = expr
    this.params = params
    this.context = context
    this.instances = []
    this.recursive = null
    this.refcount = 0
  }

  getInstance(cx, args) {
    for (let i = 0; i < this.instances.length; i++) {
      let inst = this.instances[i]
      if (eqExprs(inst.args, args)) {
        if (this.recursive !== false)
          this.recursive = true
        return inst.graph
      }
    }
    let graph = cx.registerGraph(this.name, new SubGraph)
    this.instances.push({args, graph})
    let result = cx.evalExpr(instantiateArgs(this.params, args, this.expr))
    graph.nodes = result.nodes
    if (this.recursive === null) this.recursive = false
    return graph
  }
}

class SubGraph {
  constructor() {
    this.name = null
    this.nodes = [[]]
  }

  get edgeCount() {
    let count = 0
    for (let i = 0; i < this.nodes.length; i++)
      count += this.nodes[i].length
    return count
  }

  node() {
    return this.nodes.push([]) - 1
  }

  edge(from, to, match, effect) {
    this.nodes[from].push(new Edge(to, match, effect))
  }

  copy(from, to, source, start = 0) {
    let mapping = []
    mapping[start] = from
    let work = [start], workIndex = 0
    while (workIndex < work.length) {
      let cur = work[workIndex++], edges = source.nodes[cur]
      for (let i = 0; i < edges.length; i++) {
        let edge = edges[i]
        if (edge.to != null && work.indexOf(edge.to) == -1) {
          mapping[edge.to] = this.node()
          work.push(edge.to)
        }
        this.edge(mapping[cur], edge.to == null ? to : mapping[edge.to], edge.match, edge.effect)
      }
    }
  }

  join(mayHaveOutgoing) {
    let found = []
    this.edges((e, n) => { if (e.to == null) found.push(n, e) })
    if (found.length == 2) {
      let edge = found[1], node = this.nodes[found[0]]
      if (edge.match == nullMatch && !edge.effect && (mayHaveOutgoing || node.length == 1)) {
        node.splice(node.indexOf(edge), 1)
        return found[0]
      }
    }
    let add = this.node()
    for (let i = 1; i < found.length; i += 2) found[i].to = add
    return add
  }

  edges(f) {
    for (let i = 0; i < this.nodes.length; i++) {
      let edges = this.nodes[i]
      for (let j = 0; j < edges.length; j++) f(edges[j], i)
    }
  }

  countReferences(node) {
    let count = 0
    this.edges(e => { if (e.to == node) count++ })
    return count
  }

  toString() {
    let output = ""
    this.edges((e, n) => output += "  " + e.toString(this.name, n) + ";\n")
    return output
  }

  singleEdgeFrom(node) {
    let edges = this.nodes[node]
    return edges.length == 1 ? edges[0] : null
  }

  singleEdgeTo(node) {
    let found = null
    this.edges(e => {
      if (e.to == node) found = found == null ? e : false
    })
    return found === false ? null : found
  }

  get simple() {
    if (this.nodes.length != 1) return null
    let node = this.nodes[0]
    if (node.length != 1 || node[0].effect) return null
    return node[0].match
  }

  static simple(match, effect) {
    let graph = new SubGraph
    graph.edge(0, null, match, effect)
    return graph
  }
}

SubGraph.any = SubGraph.simple(anyMatch)
SubGraph.dot = SubGraph.simple(dotMatch)

const MAX_INLINE_EDGE_COUNT = 5

class Context {
  constructor(rules, graphs) {
    this.rules = rules
    this.graphs = graphs
  }

  registerGraph(name, graph) {
    for (let i = 0;; i++) {
      let cur = name + (i ? "_" + i : "")
      if (!(cur in this.graphs)) {
        graph.name = cur
        return this.graphs[cur] = graph
      }
    }
  }

  evalExpr(expr) {
    let t = expr.type
    if (t == "CharacterRange") {
      return SubGraph.simple(new RangeMatch(expr.from, expr.to))
    } else if (t == "StringMatch") {
      return SubGraph.simple(new StringMatch(expr.value))
    } else if (t == "AnyMatch") {
      return SubGraph.any
    } else if (t == "DotMatch") {
      return SubGraph.dot
    } else if (t == "RuleIdentifier") {
      return this.evalCall(expr.id.name, expr.arguments)
    } else if (t == "RepeatedMatch") {
      return this.evalRepeat(expr.expr, expr.kind)
    } else if (t == "SequenceMatch") {
      return this.evalSequence(expr.exprs)
    } else if (t == "ChoiceMatch") {
      return this.evalChoice(expr.exprs)
    } else if (t == "LookaheadMatch") {
      let inner = this.evalExpr(expr.expr), simple = inner.simple, match
      if (simple) {
        match = new LookaheadMatch(null, simple, expr.kind == "~")
      } else {
        this.registerGraph("_lookahead", inner)
        match = new LookaheadMatch(inner, null, expr.kind == "~")
      }
      return SubGraph.simple(match)
    } else if (t == "PredicateMatch") {
      return SubGraph.simple(new PredicateMatch(expr.id.name))
    } else {
      throw new Error("Unrecognized AST node type " + t)
    }
  }

  evalCall(name, args) {
    let rule = this.rules[name]
    if (args.length != rule.params.length) throw new Error("Wrong number of arguments for " + name)
    let graph = rule.getInstance(this, args), simple
    if (rule.context && rule.context.token && (simple = graph.simple))
      return SubGraph.simple(simple, new Token(rule.context.token))
    else if (!rule.recursive && !rule.context && (rule.refcount == 1 || graph.edgeCount <= MAX_INLINE_EDGE_COUNT))
      return graph
    else
      return SubGraph.simple(nullMatch, new Call(graph, rule.context))
  }

  // FIXME there's still a bug here that showed up when doing listOf(x? y)
  evalRepeat(expr, kind) {
    let inner = this.evalExpr(expr), simple
    if ((simple = inner.simple) && !simple.isolated)
      return SubGraph.simple(new RepeatMatch(simple, kind))
    let graph = new SubGraph
    if (kind == "*") {
      graph.copy(0, 0, inner)
      graph.edge(0, null, nullMatch)
    } else if (kind == "+") {
      let next = graph.node()
      graph.copy(0, next, inner)
      graph.edge(next, 0, nullMatch)
      graph.edge(next, null, nullMatch)
    } else if (kind == "?") {
      graph.copy(0, null, inner)
      graph.edge(0, null, nullMatch)
    }
    return graph
  }

  evalSequence(exprs) {
    let graph = new SubGraph, edge = graph.edge(0, null, nullMatch)
    for (let i = 0; i < exprs.length; i++) {
      let next = this.evalExpr(exprs[i])
      let firstEdge, copyFrom = 0
      if (edge && (firstEdge = next.singleEdgeFrom(0)) && !firstEdge.effect && edge.canCombine(firstEdge)) {
        edge.match = SeqMatch.create(edge.match, firstEdge.match)
        copyFrom = firstEdge.to
      }
      if (copyFrom != null) {
        let hasIncoming = next.countReferences(copyFrom) == (copyFrom == 0 ? 0 : 1)
        graph.copy(graph.join(hasIncoming), null, next, copyFrom)
        if (i < exprs.length - 1)
          edge = graph.singleEdgeTo(null)
      }
    }
    return graph
  }

  evalChoice(exprs) {
    let graph = new SubGraph
    for (let i = 0, last = exprs.length - 1, next = null; i <= last; i++) {
      let curGraph = next || this.evalExpr(exprs[i]), simple = curGraph.simple
      next = null
      if (simple) {
        while (i < last) {
          let nextExpr = this.evalExpr(exprs[i + 1]), nextSimple = nextExpr.simple
          if (nextSimple) {
            simple = ChoiceMatch.create(simple, nextSimple)
            i++
          } else {
            next = nextExpr
            break
          }
        }
        graph.edge(0, null, simple)
      } else {
        let start = 0
        if (curGraph.countReferences(0) > 0)
          graph.edge(0, start = graph.node(), nullMatch)
        graph.copy(start, null, curGraph)
      }
    }
    return graph
  }
}

function gatherRules(grammar) {
  let info = {rules: Object.create(null), start: null, tokens: []}
  function gather(grammar) {
    let explicitStart = null
    for (let name in grammar.rules) {
      let ast = grammar.rules[name]
      if (ast.start) {
        if (explicitStart) throw new Error("Multiple start rules")
        explicitStart = name
      }
      if (info.rules[name]) continue
      let expr = normalizeExpr(ast.expr, name, grammar.super, ast.skip)
      info.rules[name] = new Rule(name, expr, ast.params.map(n => n.name),
                                  !ast.context && !ast.tokenType ? null : ast.tokenType ? {name, token: ast.tokenType} : {name})
    }
    if (grammar.super) gather(grammar.super)
    if (explicitStart) info.start = explicitStart
    for (let name in grammar.rules) {
      if (info.start == null) info.start = name
      if (grammar.rules[name].isToken && info.tokens.indexOf(name) == -1) info.tokens.push(name)
    }
  }
  gather(grammar)
  return info
}

function countReferences(rules, start, tokens) {
  function count(name, weight) {
    let rule = rules[name]
    if (!rule) throw new Error("Undefined rule " + name)
    rule.refcount += weight
  }
  count(start, 1)
  for (let i = 0; i < tokens.length; i++) count(tokens[i], 1)

  function countExpr(weight, params) {
    return expr => {
      if (expr.type == "RuleIdentifier") {
        if (params.indexOf(expr.id.name) == -1)
          count(expr.id.name, weight)
        for (let i = 0; i < expr.arguments.length; i++)
          forEachExpr(expr.arguments[i], countExpr(2, params))
        return false
      }
    }
  }

  for (let name in rules) {
    let rule = rules[name]
    forEachExpr(rule.expr, countExpr(rule.params.length ? 2 : 1, rule.params))
  }
}

function gcGraphs(graphs, startNames) {
  let work = startNames.slice(), workIndex = 0
  function add(name) {
    if (work.indexOf(name) < 0) work.push(name)
  }

  while (workIndex < work.length) {
    graphs[work[workIndex++]].edges(edge => {
      if (edge.effect instanceof Call) add(edge.effect.target.name)
      edge.match.forEach(m => {
        if (m instanceof LookaheadMatch && m.start) add(m.start.name)
      })
    })
  }

  let result = Object.create(null)
  work.forEach(name => result[name] = graphs[name])
  return result
}
