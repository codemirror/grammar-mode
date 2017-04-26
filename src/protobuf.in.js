/*Things that can be attached to a production:

 - signficant flag: rule*
 - token style: function(context) -> string? Or direct field stored in context?
 - body: -> { ... }
 - whether to match whitespace around productions
*/

grammar protobuf {
  rules {
    Program { Statement* }
    Statement { package id ';' | message id '{' Field* '}' }
    Field { modifier* type id '=' number ';' }
  }

  whitespace { (space | comment)* }

  tokens {
    package { 'package' !identifierChar }
    message { 'message' !identifierChar }
    modifier { ('required' | 'optional' | 'repeated' | 'reserved' | 'default' | 'extensions' | 'packed') !identifierChar }
    type { ('bool' | 'bytes' | 'double' | 'float' | 'string' | 'int32' | 'int64' | 'uint32' | 'uint64' | 'sint32' | 'sint64' | 'fixed32' | 'fixed64' | 'sfixed32' | 'sfixed64') !identifierChar }

    id { identifierChar identifierChar* }
    number { digit+ }

    comment { '//' (!'\n' _)* }
  }

  helpers {
    space { '\t' | '\n' | '\r' | ' ' }
    letter { 'a'-'z' | 'A'-'Z' }
    digit { '0'-'9' }
    identifierStart { letter }
    identifierChar { letter | digit }
  }
}

console.log("!")
