const {nullMatch, anyMatch, dotMatch, StringMatch, RangeMatch, SeqMatch,
       ChoiceMatch, RepeatMatch, LookaheadMatch, PredicateMatch} = require("./matchexpr")
const {normalizeExpr, eqExprs, instantiateArgs} = require("./ast")

exports.buildGraph = function(grammar, _options) {
  let {rules, start/*, tokens*/} = gatherRules(grammar)
  let cx = new Context(rules, Object.create(null))
  let startGraph = cx.registerGraph("_start", new SubGraph)
  // FIXME guard against infinite loops
  startGraph.edge(0, 0, nullMatch, new Call(cx.getRuleGraph(start, [])))

  return cx.graphs //gcGraphs(cx.graphs, ".start")
}

class Call {
  constructor(target) { this.target = target }
  toString() { return `CALL(${this.target.name})` }
}
class Token {
  constructor(type) { this.type = type }
  toString() { return `TOKEN(${this.type})` }
}

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
}

class Rule {
  constructor(name, expr, params, context) {
    this.name = name
    this.expr = expr
    this.params = params
    this.context = context
    this.instances = []
  }

  getInstance(cx, args) {
    for (let i = 0; i < this.instances.length; i++) {
      let inst = this.instances[i]
      if (eqExprs(inst.args, args)) {
        if (inst.graph.recursive !== false)
          inst.graph.recursive = true
        return inst.graph
      }
    }
    let graph = cx.registerGraph(this.name, new SubGraph(this.context))
    this.instances.push({args, graph})
    let result = cx.evalExpr(instantiateArgs(this.params, args, this.expr), graph.node(), null)
    graph.copy(0, null, result)
    if (graph.recursive === null) graph.recursive = false
    return graph
  }
}

class SubGraph {
  constructor(context) {
    this.name = null
    this.nodes = [[]]
    this.recursive = null
    this.context = context
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

  forEachRef(f) {
    for (let i = 0; i < this.nodes.length; i++) {
      let edges = this.nodes[i]
      for (let j = 0; j < edges.length; j++) {
        let edge = edges[j]
        f(edge.to, edge, "to")
        edge.match.forEach(expr => {
          if (expr instanceof LookaheadMatch && expr.start != null)
            f(edge.start, expr, "start")
        })
      }
    }
  }

  countReferences(node) {
    let count = 0
    this.forEachRef(ref => { if (ref == node) count++ })
    return count
  }

  merge(a, b) {
    this.nodes.splice(b, 1)
    if (a > b) a--
    this.forEachRef((node, obj, prop) => {
      if (node >= b) obj[prop] = node == b ? a : node - 1
    })
  }

  mergeNullEdges() {
    for (let node = 0; node < this.nodes.length; node++) {
      let edges = this.nodes[node], edge = edges[edges.length - 1]
      if (edge.match == nullMatch && !edge.call && edge.to != null &&
          (edges.length == 1 || this.countReferences(edge.to) == 1)) {
        this.nodes[node] = edges.slice(0, edges.length - 1).concat(this.nodes[edge.to])
        this.merge(node, edge.to)
        node = -1 // Restart loop
      }
    }
  }

  toString() {
    let output = ""
    for (let node = 0; node < this.nodes.length; node++) {
      let edges = this.nodes[node]
      for (let i = 0; i < edges.length; i++)
        output += "  " + edges[i].toString(this.name, node) + ";\n"
    }
    return output
  }

  singleEdgeFrom(node) {
    let edges = this.nodes[node]
    return edges.length == 1 ? edges[0] : null
  }

  singleEdgeTo(node) {
    let edge = null
    for (let i = 0; i < this.nodes.length; i++) {
      let edges = this.nodes[i]
      for (let j = 0; j < edges.length; j++) {
        if (edges[j].to == node) {
          if (edge == null) edge = edges[j]
          else return null
        }
      }
    }
    return edge
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

  getRuleGraph(name, args) {
    let rule = this.rules[name]
    if (!rule) throw new Error("Undefined rule " + name)
    if (args.length != rule.params.length) throw new Error("Wrong number of arguments for " + name)
    return rule.getInstance(this, args)
  }

  evalExpr(expr, continued) {
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
      let graph = this.getRuleGraph(expr.id.name, expr.arguments)
      if (!graph.recursive && !graph.context && graph.edgeCount <= MAX_INLINE_EDGE_COUNT)
        return graph
      else
        return SubGraph.simple(nullMatch, new Call(graph))
    } else if (t == "RepeatedMatch") {
      return this.evalRepeat(expr.expr, expr.kind, continued)
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

  evalRepeat(expr, kind, continued) {
    let inner = this.evalExpr(expr), simple
    if ((continued || kind == "+") && (simple = inner.simple) && !simple.isolated)
      return SubGraph.simple(new RepeatMatch(simple, kind))
    let graph = new SubGraph
    if (kind == "*") {
      graph.copy(0, 0, inner)
      graph.edge(0, null, nullMatch)
    } else if (kind == "+") {
      let next = graph.node()
      graph.copy(0, next, inner)
      graph.copy(next, next, inner)
      graph.edge(next, null, nullMatch)
    } else if (kind == "?") {
      graph.copy(0, null, inner)
      graph.edge(0, null, nullMatch)
    }
    return graph
  }

  evalSequence(exprs) {
    let graph = new SubGraph, node = 0, lastEdge = null
    for (let i = 0, last = exprs.length - 1, next = null; i <= last; i++) {
      let curGraph = next || this.evalExpr(exprs[i]), simple = curGraph.simple
      next = null
      if (simple) while (i < last) {
        let nextExpr = this.evalExpr(exprs[i + 1], true)
        let nextSimple = nextExpr.simple
        if (nextSimple && SeqMatch.canCombine(simple, nextSimple)) {
          simple = SeqMatch.create(simple, nextSimple)
          i++
        } else {
          next = nextExpr
          break
        }
      }
      lastEdge = null
      let end = i == last ? null : graph.node()
      if (simple) {
        if (lastEdge && !lastEdge.effect && SeqMatch.canCombine(lastEdge.match, simple))
          lastEdge.match = SeqMatch.create(lastEdge.match, simple)
        else
          lastEdge = graph.edge(node, end, simple)
      } else {
        let firstEdge, copyFrom = 0
        if (lastEdge && !lastEdge.effect &&
            (firstEdge = curGraph.singleEdgeFrom(0)) && !firstEdge.effect &&
            SeqMatch.canCombine(lastEdge.match, firstEdge.match)) {
          lastEdge.match = SeqMatch.create(lastEdge.match, firstEdge.match)
          copyFrom = firstEdge.to
        }
        graph.copy(node, end, curGraph, copyFrom)
        lastEdge = graph.singleEdgeTo(end)
      }
      node = end
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
        graph.copy(0, null, curGraph)
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
                                  ast.tokenType ? {token: ast.tokenType} : !!ast.context)
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
