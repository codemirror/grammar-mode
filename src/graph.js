const {nullMatch, anyMatch, dotMatch, StringMatch, RangeMatch, SeqMatch, ChoiceMatch, RepeatMatch,
       LookaheadMatch, SimpleLookaheadMatch, eqArray} = require("./matchexpr")

const none = [], noParams = Object.create(null)

class Rule {
  constructor(name, ast) {
    this.name = name
    this.context = ast.context || ast.tokenType
    this.tokenType = ast.tokenType
    this.skip = ast.skip
    this.expr = ast.expr
    this.instances = Object.create(null)
    this.params = ast.params && ast.params.map(id => id.name)
  }
}

class LexicalContext {
  constructor(graph, name, params, skip) {
    this.graph = graph
    this.name = name
    this.params = params
    this.skip = skip
  }

  node(suffix) {
    return this.graph.node(this.name, suffix)
  }

  call(start, end, name, params) {
    let target, hasContext = false
    if (name in this.params) {
      target = this.params[name]
      if (params.length) throw new Error("Can't pass arguments to parameters")
    } else {
      target = this.graph.getRule(name, params)
      hasContext = this.graph.rules[name].context
    }
    this.graph.edge(start, target, null, [new CallEffect(end, name, hasContext)])
  }
}

function paramsFor(params, args) {
  if (!args.length) return noParams
  let result = Object.create(null)
  for (let i = 0; i < args.length; i++) result[params[i]] = args[i]
  return result
}

class Graph {
  constructor(grammar, options) {
    this.options = options || noParams
    this.nodes = Object.create(null)
    this.curName = null
    this.skipExprs = []
    this.rules = Object.create(null)
    let first = null, tokens = []
    for (let name in grammar.rules) {
      if (first == null) first = name
      let ast = grammar.rules[name]
      this.rules[name] = new Rule(name, ast)
      if (ast.isToken) tokens.push(name)
    }
    if (!first) throw new SyntaxError("Empty grammar")

    this.start = this.buildStartNode(first)
    if (this.options.token !== false)
      this.token = this.buildTokenNode(tokens)
  }

  getSkipExpr(node) {
    if (!node) return null
    for (let i = 0; i < this.skipExprs.length; i += 2)
      if (this.skipExprs[i] == node) return this.skipExprs[i + 1]
    let compiled = compileSingleExpr(node, new LexicalContext(this, "skip", noParams, null))
    this.skipExprs.push(node, compiled)
    return compiled
  }

  getRule(name, args) {
    let rule = this.rules[name]
    if (!rule) throw new SyntaxError(`No rule '${name}' defined`)
    if (rule.params.length != args.length) throw new SyntaxError(`Wrong number of arguments for rule '${name}'`)
    let instanceKey = args.join(" "), found = rule.instances[instanceKey]
    if (!found) {
      let cx = new LexicalContext(this, name, paramsFor(rule.params, args), this.getSkipExpr(rule.skip))
      let start = found = rule.instances[instanceKey] = cx.node()
      let end = cx.node("end")
      generateExpr(start, end, rule.expr, cx)
      if (rule.context) {
        let edges = this.nodes[start], effect = new PushContext(name, rule.tokenType)
        for (let i = 0; i < edges.length; i++)
          edges[i].effects.unshift(effect)
      }
      this.edge(end, null, null, rule.context ? [popContext, returnEffect] : [returnEffect])
    }
    return found
  }

  node(base, suffix) {
    let label = base + (suffix ? "_" + suffix : "")
    for (let i = 0;; i++) {
      let cur = i ? label + "_" + i : label
      if (!(cur in this.nodes)) {
        this.nodes[cur] = []
        return cur
      }
    }
  }

  edge(from, to, match, effects) {
    let edge = new Edge(to, match || nullMatch, effects)
    this.nodes[from].push(edge)
    return edge
  }

  gc() {
    let reached = this.forEachRef()
    for (let n in this.nodes) if (!(n in reached)) delete this.nodes[n]
  }

  forEachRef(f) {
    let reached = Object.create(null), work = []

    function reach(from, to, type) {
      if (f) f(from, to, type)
      if (!to || (to in reached)) return
      reached[to] = true
      work.push(to)
    }
    reach(null, this.start, "start")
    if (this.token) reach(null, this.token, "start")

    while (work.length) {
      let node = work.pop(), next = this.nodes[node]
      for (let i = 0; i < next.length; i++) {
        let edge = next[i]
        if (edge.to) reach(node, edge.to, "edge")
        if (edge.match instanceof LookaheadMatch)
          reach(node, edge.match.start, "lookahead")
        for (let j = 0; j < edge.effects.length; j++)
          if (edge.effects[j] instanceof CallEffect)
            reach(node, edge.effects[j].returnTo, "return")
      }
    }
    return reached
  }

  buildStartNode(first) {
    let cx = new LexicalContext(this, "START", noParams, null)
    let start = cx.node(), cur = start
    let skip = this.getSkipExpr(this.rules[first].skip)
    if (skip) {
      let next = cx.node()
      this.edge(cur, skip, null, [new CallEffect(next, "skip")])
      cur = next
    }
    cx.call(cur, start, first, none)
    return start
  }

  buildTokenNode(tokens) {
    let cx = new LexicalContext(this, "TOKEN", noParams, null)
    let start = cx.node(), end = cx.node("end")
    this.edge(end, null, null, [returnEffect])
    for (let i = 0; i < tokens.length; i++)
      cx.call(start, end, tokens[i], none)
    this.edge(start, end, anyMatch)
    return start
  }

  merge(a, b) {
    delete this.nodes[b]
    for (let node in this.nodes) {
      let edges = this.nodes[node]
      for (let i = 0; i < edges.length; i++) edges[i].merge(a, b)
    }
    for (let name in this.rules) {
      let instances = this.rules[name].instances
      for (let key in instances) if (instances[key] == b) instances[key].start = a
    }
    if (this.start == b) this.start = a
    if (this.token == b) this.token = a
  }

  toString() {
    let output = "digraph {\n"
    for (let node in this.nodes) {
      let edges = this.nodes[node]
      for (let i = 0; i < edges.length; i++)
        output += "  " + edges[i].toString(node) + ";\n"
    }
    return output + "}\n"
  }
}

class Edge {
  constructor(to, match, effects) {
    this.to = to
    this.match = match
    this.effects = effects || []
  }

  eq(other) {
    return this.to == other.to && this.match.eq(other.match) && eqArray(this.effects, other.effects)
  }

  merge(a, b) {
    if (this.to == b) this.to = a
    for (let i = 0; i < this.effects.length; i++) this.effects[i].merge(a, b)
    if (this.match instanceof LookaheadMatch && this.match.start == b) this.match.start = a
  }

  toString(from) {
    let result = `${from || ""} -> ${this.to || "NULL"}`, label = this.match.regexp()
    if (this.effects.length) label = (label ? label + " " : "") + this.effects.join(" ")
    if (label) result += `[label=${JSON.stringify(label)}]`
    return result
  }
}

function forAllExprs(e, f) {
  f(e)
  if (e.exprs) for (let i = 0; i < e.exprs.length; i++) forAllExprs(e.exprs[i], f)
  if (e.expr) {
    forAllExprs(e.expr, f)
    if (e.type == "+") forAllExprs(e.expr, f) // The body of + is duplicated
  }
}

const CallEffect = exports.CallEffect = class {
  constructor(returnTo, name, hasContext) {
    this.returnTo = returnTo
    this.name = name
    this.hasContext = !!hasContext
  }

  eq(other) {
    return other instanceof CallEffect && other.hasContext == this.hasContext && other.returnTo == this.returnTo
  }

  merge(a, b) { if (this.returnTo == b) this.returnTo = a }

  toString() { return `call ${this.name} -> ${this.returnTo}` }
}

const returnEffect = exports.returnEffect = new class ReturnEffect {
  eq(other) { return other == this }

  merge() {}

  toString() { return "return" }
}

const PushContext = exports.PushContext = class {
  constructor(name, tokenType) {
    this.name = name
    this.tokenType = tokenType
  }
  eq(other) { return other instanceof PushContext && other.name == this.name }
  merge() {}
  toString() { return `push ${this.name}` }
}

const popContext = exports.popContext = new class PopContext {
  eq(other) { return other == this }
  merge() {}
  toString() { return "pop" }
}

function rm(array, i) {
  let copy = array.slice()
  copy.splice(i, 1)
  return copy
}

function maybeSkipBefore(node, cx) {
  if (!cx.skip) return node
  let before = cx.node()
  cx.graph.edge(before, cx.skip, null, [new CallEffect(node, "skip")])
  return before
}

function compileSingleExpr(expr, cx) {
  let start = cx.node(), end = cx.node()
  generateExpr(start, end, expr, cx)
  cx.graph.edge(end, null, null, [returnEffect])
  return start
}

function generateExpr(start, end, expr, cx) {
  let t = expr.type, graph = cx.graph
  if (t == "CharacterRange") {
    graph.edge(start, end, new RangeMatch(expr.from, expr.to))
  } else if (t == "StringMatch") {
    let str = expr.value.replace(/\n\r?|\r/g, "\n"), pos = 0
    for (;;) {
      let next = str.indexOf("\n", pos)
      if (next == -1) {
        graph.edge(start, end, new StringMatch(str.slice(pos)))
        break
      }
      if (next > pos) {
        let after = cx.node()
        graph.edge(start, after, new StringMatch(str.slice(pos, next)))
        start = after
      }
      if (next == str.length - 1) {
        graph.edge(start, end, new StringMatch("\n"))
        break
      }
      let after = cx.node()
      graph.edge(start, after, new StringMatch("\n"))
      start = after
      pos = next + 1
    }
  } else if (t == "AnyMatch") {
    graph.edge(start, end, anyMatch)
  } else if (t == "DotMatch") {
    graph.edge(start, end, dotMatch)
  } else if (t == "RuleIdentifier") {
    cx.call(start, end, expr.id.name, expr.arguments.map(arg => compileSingleExpr(arg, cx)))
  } else if (t == "RepeatedMatch") {
    if (expr.kind == "*") {
      let mid = cx.node("rep")
      graph.edge(start, mid)
      generateExpr(mid, maybeSkipBefore(mid, cx), expr.expr, cx)
      graph.edge(mid, end)
    } else if (expr.kind == "+") {
      let mid = cx.node("rep"), midBefore = maybeSkipBefore(mid, cx)
      generateExpr(start, midBefore, expr.expr, cx)
      generateExpr(mid, midBefore, expr.expr, cx)
      graph.edge(mid, end)
    } else if (expr.kind == "?") {
      generateExpr(start, end, expr.expr, cx)
      graph.edge(start, end)
    }
  } else if (t == "LookaheadMatch") {
    let before = cx.node("lookahead"), after = cx.node("lookahead_end")
    generateExpr(before, after, expr.expr, cx)
    graph.edge(after, null, null, [returnEffect])
    graph.edge(start, end, new LookaheadMatch(before, expr.kind == "~"))
  } else if (t == "SequenceMatch") {
    for (let i = 0; i < expr.exprs.length; i++) {
      let next = end, to = next, cur = expr.exprs[i]
      if (i < expr.exprs.length - 1) {
        next = cx.node()
        to = maybeSkipBefore(next, cx)
      }
      generateExpr(start, to, cur, cx)
      start = next
    }
  } else if (t == "ChoiceMatch") {
    for (let i = 0; i < expr.exprs.length; i++)
      generateExpr(start, end, expr.exprs[i], cx)
  } else {
    throw new Error("Unrecognized AST node type " + t)
  }
}

function maybeSimplifyReturn(edge) {
  if (edge.to) return edge
  let callI = -1, returnI = -1
  for (let i = edge.effects.length - 1; callI == -1 && i >= 0; i--) {
    if (edge.effects[i] instanceof CallEffect) callI = i
    else if (edge.effects[i] == returnEffect) returnI = i
  }
  if (returnI == -1) throw new Error("Invalid return edge " + edge)
  if (callI == -1) return edge
  return new Edge(edge.effects[callI].returnTo, edge.match, rm(rm(edge.effects, returnI), callI))
}

function simplifySequence(graph, node, edges) {
  let changed = false
  outer: for (let i = 0; i < edges.length; i++) {
    let first = edges[i]
    if (first.to == node || first.to == graph.start || !first.to) continue
    let next = graph.nodes[first.to]
    if (next.length != 1) continue
    let second = next[0]
    if (second.to == first.to ||
        (first.match != nullMatch && second.match.isolated) ||
        (second.match != nullMatch && first.match.isolated) ||
        (!first.match.isNull && second.effects.some(e => e instanceof PushContext)) ||
        (!second.match.isNull && first.effects.indexOf(popContext) > -1))
      continue
    edges[i] = maybeSimplifyReturn(new Edge(second.to, SeqMatch.create(first.match, second.match),
                                            first.effects.concat(second.effects)))
    changed = true
  }
  return changed
}

function sameEffect(edge1, edge2) {
  let e1 = edge1.effects, e2 = edge2.effects
  if (e1.length != e2.length) return false
  for (let i = 0; i < e1.length; i++)
    if (!e1[i].eq(e2[i])) return false
  return true
}

function simplifyChoice(strict, _graph, _node, edges) {
  let changed = false
  for (let from = 0; from < edges.length - 1; from++) {
    if (strict && from > 0) break
    let first = edges[from], to = from + 1
    if (first.match.isNull) continue
    if (!first.match.isolated) for (; to < edges.length; to++) {
      let edge = edges[to]
      if (edge.to != first.to || !sameEffect(first, edge) || edge.match.isNull || edge.match.isolated)
        break
    }
    if (strict && to < edges.length - 1) break
    let choices = to - from, match = first.match
    for (let j = 1; j < choices; j++) match = ChoiceMatch.create(match, edges[j].match)
    let next = to < edges.length && edges[to]
    if (next && next.match.isNull && next.to == first.to && sameEffect(first, next)) {
      to++
      match = new RepeatMatch(match, "?")
    }
    if (to > from + 1) {
      edges.splice(from, to - from, new Edge(first.to, match, first.effects))
      changed = true
    }
  }
  return changed
}

function simplifyChoiceStrict(graph, node, edges) {
  return simplifyChoice(true, graph, node, edges)
}
function simplifyChoiceLoose(graph, node, edges) {
  return simplifyChoice(false, graph, node, edges)
}

// FIXME bring back agressive repeat simplification as a second-tier
// simplifier, to fix things like comments being consumed one char at
// a time
function simplifyRepeat(graph, node, edges) {
  if (node == graph.start || edges.length != 2) return false
  let first = edges[0]
  if (first.to != node || first.effects.length > 0 || first.match.isolated) return false
  let newNode = graph.node(node, "after")
  graph.nodes[newNode] = [edges[1]]
  graph.nodes[node] = [new Edge(newNode, new RepeatMatch(first.match, "*"))]
  return true
}

function simplifyLookahead(graph, _node, edges) {
  for (let i = 0; i < edges.length; i++) {
    let edge = edges[i]
    if (!(edge.match instanceof LookaheadMatch)) continue
    let out = graph.nodes[edge.match.start]
    if (out.length != 1 || out[0].to || out[0].match.isolated) continue
    edges[i] = new Edge(edge.to, new SimpleLookaheadMatch(out[0].match, edge.match.positive), edge.effects)
    return true
  }
}

function isCalledOnlyOnce(graph, node) {
  let localNodes = [node], returnNodes = [], workIndex = 0
  function add(node) {
    if (localNodes.indexOf(node) == -1) localNodes.push(node)
  }

  while (workIndex < localNodes.length) {
    let cur = localNodes[workIndex++], edges = graph.nodes[cur]
    edgeLoop: for (let i = 0; i < edges.length; i++) {
      let edge = edges[i], to = edge.to
      if (!to) {
        returnNodes.push(cur)
      } else {
        for (let j = edge.effects.length - 1; j >= 0; j--)
          if (edge.effects[j] instanceof CallEffect) {
            add(edge.effects[j].returnTo)
            continue edgeLoop
          }
        add(edge.to)
      }
    }
  }

  let called = 0
  graph.forEachRef((from, to, type) => {
    if (localNodes.indexOf(from) == -1 && localNodes.indexOf(to) > -1)
      called += (type == "edge" ? 1 : 100)
  })
  return called == 1 && returnNodes.length ? returnNodes : null
}

// FIXME this is very quadratic
function simplifyCall(graph, _node, edges) {
  for (let i = 0; i < edges.length; i++) {
    let edge = edges[i], last = true
    for (let j = edge.effects.length - 1; j >= 0; j--) {
      let effect = edge.effects[j], returnNodes
      if (!(effect instanceof CallEffect)) continue
      if (last && !effect.hasContext && edge.to && (returnNodes = isCalledOnlyOnce(graph, edge.to))) {
        edges[i] = new Edge(edge.to, edge.match, rm(edge.effects, j))
        for (let k = 0; k < returnNodes.length; k++) {
          let edges = graph.nodes[returnNodes[k]]
          for (let l = 0; l < edges.length; l++) {
            let edge = edges[l]
            if (!edge.to) edges[l] = new Edge(effect.returnTo, edge.match, edge.effects.filter(e => e != returnEffect))
          }
        }
        return true
      }
      let out = graph.nodes[effect.returnTo]
      if (out.length != 1) continue
      let after = out[0]
      if (after.match != nullMatch) continue
      if (last && after.effects.length == 1 && after.effects[0] == returnEffect && !effect.hasContext) {
        // Change tail call to direct connection
        edges[i] = new Edge(edge.to, edge.match, rm(edge.effects, j))
        return true
      } else if (after.effects.length == 0) {
        // Erase a null edge after a call
        edge.effects[j] = new CallEffect(after.to, effect.name, effect.hasContext)
        return true
      }
      last = false
    }
  }
}

// Look for simplification possibilities around the given node, return
// true if anything was done
function simplifyWith(graph, simplifier) {
  let changed = false
  for (let node in graph.nodes)
    if (simplifier(graph, node, graph.nodes[node]))
      changed = true
  return changed
}

function simplify(graph) {
  for (;;) {
    while (simplifyWith(graph, simplifyChoiceStrict) |
           simplifyWith(graph, simplifyRepeat) |
           simplifyWith(graph, simplifyLookahead) |
           simplifyWith(graph, simplifySequence)) {}
    graph.gc()
    mergeDuplicates(graph)
    if (!(simplifyWith(graph, simplifyChoiceLoose) |
          simplifyWith(graph, simplifyCall))) break
  }
}

function mergeDuplicates(graph) {
  outer: for (;;) {
    let names = Object.keys(graph.nodes)
    for (let i = 0; i < names.length; i++) {
      let name = names[i], edges = graph.nodes[name]
      for (let j = i + 1; j < names.length; j++) {
        let otherName = names[j]
        if (eqArray(edges, graph.nodes[otherName])) {
          graph.merge(name, otherName)
          continue outer
        }
      }
    }
    break
  }
}

function checkForCycles(graph) {
  function addCalls(stack, edge) {
    let copy = null
    for (let i = 0; i < edge.effects.length; i++) {
      let effect = edge.effects[i]
      if (effect instanceof CallEffect)
        (copy || (copy = stack.slice())).push(effect.returnTo)
    }
    return copy || stack
  }

  function scan(path, node, stack) {
    let edges = graph.nodes[node]
    for (let i = 0; i < edges.length; i++) {
      let edge = edges[i]
      if (!edge.match.isNull) continue
      let next = edge.to, stackHere = stack
      if (!next && stackHere.length) {
        stackHere = stackHere.slice()
        next = stackHere.pop()
      }
      if (next) {
        let newStack = addCalls(stackHere, edge)
        for (let j = 0; j < path.length; j += 2) {
          if (path[j] == next && path[j + 1] <= newStack.length)
            throw new Error("Null-match cycle " + path.slice(j).filter(v => typeof v == "string").join(" → ")
                            + " → " + next + " in " + graph)
        }
        scan(path.concat(next, newStack.length), next, addCalls(stackHere, edge))
      }
    }
  }

  for (let n in graph.nodes) scan([n], n, [])
}

exports.buildGraph = function(grammar, options) {
  let graph = new Graph(grammar, options)
  if (options.simplify !== false) {
    simplify(graph)
    checkForCycles(graph)
  }
  return graph
}
