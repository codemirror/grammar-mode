# CodeMirror grammar mode

This is an experimental tool for building CodeMirror modes from
grammar descriptions.

You write a grammar like this:

    skip (' ' | '\t' | '\n')* {
      Expr { (num | var | ParenExpr) (op Expr)? }
      context ParenExpr { '(' Expr ')' }
    }
    tokens {
      num="number" { digit+ }
      var="variable" { letter (letter | digit)* }
      op { '+' | '-' | '/' | '*' }
    }
    digit { "0"-"9" }
    letter { "a"-"z" | "A"-"Z" }

And then run `grammar-mode` on it to convert it into a JavaScript
file. This file will export a set of bindings that can be given to the
accompanying interpreter (in `src/matcher.js`) to create a CodeMirror
mode.

## Grammar syntax

A grammar is a set of rules. Rules may appear on the top level or
within `tokens` or `skip` blocks. The rules within `tokens` are
considered the base token types of the language, and will be fallen
back on when nothing else matches. A `skip` block is used to
automatically insert whitespace-like productions between the elements
of the rules inside of it.

Each rule has a name, optionally followed by the keyword `context` to
mark it as a rule for which a context has to be pushed onto the
context stack. Contexts can be used by external code to do things like
computing indentation based on what rules are currently active.

After the rule name, you can add an equals sign and a quoted string to
set a token type for the rule (for example `num="number"` in the
example). That token type will be used to highlight the text that
matches the rule.

Each rule contains a match expression, which is built up like this:

 - A `"literal string"` matches that exact text.

 - An underscore matches any character, and a period matches any
   character except newlines.

 - A character range is written as two single-character strings
   with a dash in between.

 - An unquoted word is a reference to another rule.

 - Multiple expressions separated by whitespace indicate that these
   things must match in sequence.

 - Parentheses can be used around expressions to group them.

 - Multiple expressions separated by pipe characters indicate a choice
   between those expressions. The first choice that matches is taken.

 - A `+`, `*`, or `?` after an expression allows that expression to
   occur one or more (`+`), zero or more (`*`), or zero or one (`?`)
   times. This is done greedily — as many repetitions as possible are
   matched.

 - A `~` or `!` character followed by an expression denotes a
   lookahead — positive lookahead for `~` and negative for `!`.

 - An `&` followed by a name is a call to a predicate. This is an
   external function that will be called to determine whether a given
   position matches.

## Single-edge lookahead

A grammar is compiled to a set of state machines, whose edges are
regular expressions, possibly extended with predicate calls and
lookaheads, or calls to rules. When parsing, the interpreter will take
the first edge that matches and consumes input, without looking ahead
further.

The catch is that you have somehow write your grammar so that the
right choice is made at every point. If something is ambiguous, the
parser will just always take the first path. So, depending on your
grammar, you might have to insert lookaheads to disambiguate things.
For example, to distinguish between a variable and a label in a C-like
language, you'd need rules something like this:

    Statement {
      label ":" |
      variable |
      otherThing
    }
    
    label="meta" { letter+ ~(spaceChar* ":") }
    variable="variable" { letter+ }

## Command-line parameters

The `grammar-mode` command expects a file as argument, or will read
from standard input when not given one. Other, optional, arguments
include:

 * `--output file` specifies a file to write the output to (defaults
   to standard output).

 * `--es-module` tells the tool to output an ES6 module (default is a
   CommonJS module).

 * `--graph` will cause it to output a graph in .dot format instead of
   a JavaScript module. Can be useful for debugging.

 * `--names` will cause the JavaScript output to be more verbose but
   easier to read, using string names rather than numbers for the
   nodes.
