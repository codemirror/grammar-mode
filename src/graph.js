const {nullMatch, anyMatch, dotMatch, StringMatch, RangeMatch, SeqMatch,
       ChoiceMatch, RepeatMatch, LookaheadMatch, PredicateMatch} = require("./matchexpr")

exports.buildGraph = function(grammar, options) {
  let {rules, start, tokens} = Rule.fromGrammar(grammar)
  let graph = new Graph(rules)
  graph.buildStartNode(start)
  if (options.tokens !== false) graph.buildTokenNode(tokens)
  return graph
}

class Edge {
  constructor(to, match, call) {
    this.to = to
    this.match = match
    this.call = call
  }

  toString(from) {
    let result = `${from || ""} -> ${this.to || "RET"}`, label = this.match.toRegexp()
    if (this.call) label = (label ? label + " " : "") + `CALL(${this.call})`
    if (label) result += `[label=${JSON.stringify(label)}]`
    return result
  }
}

function buildNode(type, from, props) {
  props.type = type
  props.start = from.start
  props.end = from.end
  return props
}

const noSkipAfter = ["LookaheadMatch", "PredicateMatch", "Label", "RepeatedMatch"]

// Replaces super matches, inserts skip matches in the appropriate
// places, splits string matches with newlines, and collapses nested
// sequence/choice expressions, so that further passes don't have to
// worry about those.
function normalizeExpr(expr, ruleName, superGrammar, skip) {
  if (expr.type == "StringMatch" && expr.value > 1 && expr.value.indexOf("\n") > -1) {
    let exprs = []
    expr.value.split(/(?=\n)/).forEach(part => {
      exprs.push(buildNode("StringMatch", expr, {value: "\n"}))
      if (part.length > 1) exprs.push(buildNode("StringMatch", expr, {value: part.slice(1)}))
    })
    return buildNode("SequenceMatch", expr, {exprs})
  } else if (expr.type == "RepeatedMatch") {
    let inner = normalizeExpr(expr.expr, ruleName, superGrammar, skip)
    if (skip) inner = buildNode("SequenceMatch", inner, {exprs: [inner, skip]})
    expr.expr = inner
  } else if (expr.type == "LookaheadMatch") {
    expr.expr = normalizeExpr(expr.expr, ruleName, null, skip)
  } else if (expr.type == "SequenceMatch") {
    let exprs = []
    for (let i = 0; i < expr.exprs.length; i++) {
      let next = normalizeExpr(expr.exprs[i], ruleName, superGrammar, skip)
      if (next.type == "SequenceMatch") exprs = exprs.concat(next.exprs)
      else exprs.push(next)
      if (skip && i < expr.exprs.length - 1 && noSkipAfter.indexOf(next.type) < 0)
        exprs.push(skip)
    }
    expr.exprs = exprs
  } else if (expr.type == "ChoiceMatch") {
    let exprs = []
    for (let i = 0; i < expr.exprs.length; i++) {
      let next = normalizeExpr(expr.exprs[i], ruleName, superGrammar, skip)
      if (next.type == "ChoiceMatch") exprs = exprs.concat(next.exprs)
      else exprs.push(next)
    }
    expr.exprs = exprs
  } else if (expr.type == "SuperMatch") {
    for (let grammar = superGrammar; grammar; grammar = grammar.super) {
      let rule = grammar.rules[ruleName]
      if (rule) return normalizeExpr(rule.expr, ruleName, grammar.super, skip)
    }
    throw new SyntaxError(`No super rule found for '${ruleName}'`)
  }
  return expr
}

function forEachExpr(expr, f) {
  if (f(expr) === false) return
  if (expr.type == "RepeatedMatch" || expr.type == "LookaheadMatch")
    forEachExpr(expr.expr, f)
  else if (expr.type == "SequenceMatch" || expr.type == "ChoiceMatch")
    for (let i = 0; i < expr.exprs.length; i++) forEachExpr(expr.exprs[i], f)
}

function findReferences(expr) {
  let set = []
  forEachExpr(expr, expr => {
    if (expr.type == "LookaheadExpr") return false
    if (expr.type == "RuleIdentifier") {
      let name = expr.id.name
      if (set.indexOf(name) < 0) set.push(name)
    }
  })
  return set
}

function hasIsolatedMatches(expr) {
  let found = false
  forEachExpr(expr, expr => {
    if (expr.type == "LookaheadExpr") return false
    if (!found &&
        (expr.type == "AnyMatch" ||
         expr.type == "StringMatch" && expr.string == "\n" ||
         expr.type == "RangeMatch" && expr.from <= "\n" && expr.to >= "\n"))
      found = true
  })
  return found
}

function canBeNull(expr, rules) {
  if (expr.type == "RepeatedMatch") {
    return expr.kind == "+" ? canBeNull(expr.expr, rules) : true
  } else if (expr.type == "LookaheadMatch" || expr.type == "Label" || expr.type == "PredicateMatch") {
    return true
  } else if (expr.type == "SequenceMatch") {
    for (let i = 0; i < expr.exprs.length; i++)
      if (!canBeNull(expr.exprs[i], rules)) return false
    return true
  } else if (expr.type == "ChoiceMatch") {
    for (let i = 0; i < expr.exprs.length; i++)
      if (canBeNull(expr.exprs[i], rules)) return true
    return false
  } else if (expr.type == "RuleIdentifier") {
    return rules[expr.id.name].canBeNull(rules)
  } else {
    return false
  }
}

function checkExpr(expr, rules) {
  forEachExpr(expr, expr => {
    if (expr.type == "RepeatMatch" && expr.kind != "?" && canBeNull(expr.expr, rules))
      throw new Error(`Expressions that don't make progress (can match the empty string) can't have '${expr.kind}' applied to them`)
    else if (expr.type == "RuleIdentifier" && !(expr.id.name in rules))
      throw new Error(`Reference to undefined rule '${expr.id.name}'`)
    else if (expr.type == "SuperMatch")
      throw new Error("'super' in invalid position")
  })
}

class Rule {
  constructor(name, ast, grammar) {
    this.name = name
    this.context = ast.context || ast.tokenType
    this.tokenType = ast.tokenType
    this.expr = normalizeExpr(ast.expr, name, grammar.super, ast.skip)
    this.matchExpr = null
    this.instances = Object.create(null)
    this.params = ast.params && ast.params.map(id => id.name)
    this.references = findReferences(this.expr)
    this.flat = hasIsolatedMatches(this.expr) ? false : null
    this._canBeNull = null
    this._startNode = null
  }

  canBeNull(rules) {
    if (this._canBeNull == null) this._canBeNull = canBeNull(this.expr, rules)
    return this._canBeNull
  }

  startNode(graph, _args) { // FIXME handle args
    if (this._startNode == null) {
      this._startNode = graph.newNode(this.name)
      evalRuleExpr(graph, this.expr, this._startNode)
    }
    return this._startNode
  }

  static fromGrammar(grammar) {
    let info = {rules: Object.create(null), start: null, tokens: []}
    Rule.gather(grammar, info)
    for (let name in info.rules) checkExpr(info.rules[name].expr, info.rules)
    Rule.computeFlat(info.rules)
    return info
  }

  static computeFlat(rules) {
    // Fixpoint to figure out which rules can be recursively flattened
    for (;;) {
      let changed = false
      for (let name in rules) {
        let rule = rules[name]
        if (rule.flat === null && !rule.references.some(ref => rules[ref].flat !== true))
          changed = rule.flat = true
      }
      if (!changed) break
    }
  }

  static gather(grammar, ruleInfo) {
    let explicitStart = null
    for (let name in grammar.rules) {
      let ast = grammar.rules[name]
      if (ast.start) {
        if (explicitStart) throw new Error("Multiple start rules")
        explicitStart = name
      }
      if (ruleInfo.rules[name]) continue
      ruleInfo.rules[name] = new Rule(name, ast, grammar)
    }
    if (grammar.super) Rule.gather(grammar.super, ruleInfo)
    if (explicitStart) ruleInfo.start = explicitStart
    for (let name in grammar.rules) {
      if (ruleInfo.start == null) ruleInfo.start = name
      if (grammar.rules[name].isToken && ruleInfo.tokens.indexOf(name) == -1) ruleInfo.tokens.push(name)
    }
  }
}

class Graph {
  constructor(rules) {
    this.rules = rules
    this.nodes = Object.create(null)
    this.start = null
  }

  newNode(label) {
    for (let i = 0;; i++) {
      let name = label + (i ? "_" + i : "")
      if (!(name in this.nodes)) {
        this.nodes[name] = []
        return name
      }
    }
  }

  edge(from, to, match, call) {
    let edge = new Edge(to, match, call)
    this.nodes[from].push(edge)
    return edge
  }

  buildStartNode(name) {
    let startRule = this.rules[name]
    if (startRule.canBeNull(this.rules)) // FIXME maybe handle by inserting an anymatch?
      throw new Error("Start rule should consume input")
    this.start = this.newNode("START")
    this.edge(this.start, this.start, nullMatch, startRule.startNode(this, []))
  }

  buildTokenNode(_tokens) {
    // FIXME
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

function evalRuleExpr(graph, expr, start) {
  if (!start) start = graph.newNode("FOO")
  evalExpr(graph, expr, start, null)
  return start
}

function evalSimpleExpr(graph, expr) {
  return expr.simpleValue || (expr.simpleValue = evalSimpleExprInner(graph, expr))
}
  
function evalSimpleExprInner(graph, expr) {
  let t = expr.type
  if (t == "CharacterRange") {
    return new RangeMatch(expr.from, expr.to)
  } else if (t == "StringMatch") {
    return new StringMatch(expr.value)
  } else if (t == "AnyMatch") {
    return anyMatch
  } else if (t == "DotMatch") {
    return dotMatch
  } else if (t == "RuleIdentifier") { // FIXME also inline small, non-context rules
    let rule = graph.rules[expr.id.name]
    if (!rule.flat || rule.context) return null
    return rule.matchExpr || (rule.matchExpr = evalSimpleExpr(graph, rule.expr))
  } else if (t == "RepeatedMatch") {
    let inner = evalSimpleExpr(graph, expr.expr)
    if (inner == null) return null
    return new RepeatMatch(inner, expr.kind)
  } else if (t == "SequenceMatch" || t == "ChoiceMatch") {
    let result = null
    for (let i = 0; i < expr.exprs.length; i++) {
      let m = evalSimpleExpr(graph, expr.exprs[i])
      if (m == null || result != null && !SeqMatch.canCombine(result, m)) return null
      result = result == null ? m : (t == "SequenceMatch" ? SeqMatch : ChoiceMatch).create(result, m)
    }
    return result
  } else if (t == "LookaheadMatch") {
    let inner = evalSimpleExpr(graph, expr.expr)
    if (inner != null) return new LookaheadMatch(null, inner, expr.kind == "~")
    return new LookaheadMatch(evalRuleExpr(graph, expr.expr), null, expr.kind == "~")
  } else if (t == "PredicateMatch") {
    return new PredicateMatch(expr.id.name)
  } else {
    throw new Error("Unrecognized AST node type " + t)
  }
}

function evalExpr(graph, expr, start, end) {
  let simple = evalSimpleExpr(graph, expr)
  if (simple) {
    graph.edge(start, end, simple)
  } else if (expr.type == "RuleIdentifier") {
    let rule = graph.rules[expr.id.name]
    // FIXME properly compile args
    graph.edge(start, end, nullMatch, rule.startNode(graph, expr.args))
  } else if (expr.type == "RepeatedMatch") {
    if (expr.kind == "*") {
      if (graph.nodes[start].length) {
        let copy = graph.newNode("DUP")
        graph.edge(start, copy, nullMatch)
        start = copy
      }
      evalExpr(graph, expr.expr, start, start)
    } else if (expr.kind == "+") {
      let next = graph.newNode("NEXT")
      evalExpr(graph, expr.expr, start, next)
      evalExpr(graph, expr.expr, next, next)
    } else if (expr.kind == "?") {
      evalExpr(graph, expr.expr, start, end)
      graph.edge(start, end, nullMatch)
    }
  } else if (expr.type == "SequenceMatch") {
    let match = null, call = null
    for (let i = 0; i < expr.exprs.length; i++) {
      let next = expr.exprs[i], simple = !call && evalSimpleExpr(graph, next)
      if (simple && (!match || SeqMatch.canCombine(match, simple))) {
        match = match ? SeqMatch.create(match, simple) : match
      } else if (match && !match.isolated && next.type == "CallExpression" &&
                 (match.isNull || !graph.rules[next.id.name].context)) {
        call = graph.rules[next.id.name].startNode(graph, next.args)
      } else {
        if (match) {
          let newStart = graph.newNode("UGH")
          graph.edge(start, newStart, match, call)
          match = call = null
          start = newStart
        }
        let after = i == expr.exprs.length - 1 ? end : graph.newNode("OW")
        evalExpr(graph, next, start, after)
        start = after
      }
    }
    if (match) graph.edge(start, end, match, call)
  } else if (expr.type == "ChoiceMatch") {
    for (let i = 0; i < expr.exprs.length; i++) {
      let simple = evalSimpleExpr(graph, expr.exprs[i]), next
      if (simple && !simple.isolated) {
        while (i < expr.exprs.length - 1 &&
               (next = evalSimpleExpr(graph, expr.exprs[i + 1])) &&
               !next.isolated) {
          simple = ChoiceMatch.create(simple, next)
          i++
        }
        graph.edge(start, end, simple)
      } else {
        evalExpr(graph, expr.exprs[i], start, end)
      }
    }
  } else {
    throw new Error("Fell through with " + expr.type)
  }
}
