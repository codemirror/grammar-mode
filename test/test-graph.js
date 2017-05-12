const ist = require("ist")
const {buildGraph} = require("../src/graph.js")
const {nullMatch, anyMatch, StringMatch, RangeMatch} = require("../src/matchexpr")
const parse = require("../src/parse")

function gr(text) { return buildGraph(parse(text), {token: false}) }

function eq(graph, str) {
  let lines = str.split(/[\n;]+\s*/).filter(x => x)
  return graph.toString() == "digraph {\n  " + lines.join(";\n  ") + ";\n}\n"
}

describe("graph simplification", () => {
  it("can combine simple edges", () => {
    ist(gr(`foo { 'a' 'b' }`),
        `START -> START[label="ab"]`, eq)
  })

  it("can combine choices", () => {
    ist(gr(`foo { 'a' | 'b' }`),
        `START -> START[label="[ab]"]`, eq)
  })

  it("can inline simple calls", () => {
    ist(gr(`foo { 'a' bar } bar { 'b' }`),
        `START -> START[label="ab"]`, eq)
  })

  it("won't inline context rules", () => {
    ist(gr(`foo { 'a' bar } bar* { 'b' }`),
        `START -> foo_1[label="a"];foo_end -> NULL[label="return"];foo_1 -> START[label="b call bar -> foo_end push bar pop"]`, eq)
  })

  it("keeps newline matches separate", () => {
    ist(gr(`foo { 'a' '\\n' }`),
        `START -> foo_1[label="a"];foo_1 -> START[label="\\\\n"]`, eq)
  })    
})
