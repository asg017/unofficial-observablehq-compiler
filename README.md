# @alex.garcia/unofficial-observablehq-compiler [![CircleCI](https://circleci.com/gh/asg017/unofficial-observablehq-compiler.svg?style=svg)](https://circleci.com/gh/asg017/unofficial-observablehq-compiler)
asdf
An unoffical compiler for Observable notebooks (glue between the Observable parser and runtime)

This compiler will compile "observable syntax" into "javascript syntax".
For example -

```javascript
import compiler from "@alex.garcia/unofficial-observablehq-compiler";
import { Inspector, Runtime } from "@observablehq/runtime";

const compile = new compiler.Compiler();

const define = compile.module(`
import {text} from '@jashkenas/inputs'

viewof name = text({
  title: "what's your name?",
  value: ''
})

md\`Hello **\${name}**, it's nice to meet you!\`

`);

const runtime = new Runtime();

const module = runtime.module(define, Inpsector.into(document.body));
```

For more live examples and functionality, take a look at the [announcement notebook](https://observablehq.com/d/74f872c4fde62e35)
and this [test page](https://github.com/asg017/unofficial-observablehq-compiler/blob/master/test/test.html).

## API Reference

### Compiler

<a href="#Compiler" name="Compiler">#</a> new <b>Compiler</b>(<i>resolve</i> = defaultResolver, <i>fileAttachmentsResolve</i> = name => name) [<>](https://github.com/asg017/unofficial-observablehq-compiler/blob/master/src/compiler.js#L119 "Source")

Returns a new compiler. `resolve` is an optional function that, given a `path`
string, will resolve a new define function for a new module. This is used when
the compiler comes across an import statement - for example:

```
import {chart} from "@d3/bar-chart"
```

In this case, `resolve` gets called with `path="@d3/bar-chart"`. The `defaultResolver`
function will lookup the given path on observablehq.com and return the define
function to define that notebook.

For example, if you have your own set of notebooks on some other server, you
could use something like:

```javascript
const resolve = path =>
  import(`other.server.com/notebooks/${path}.js`).then(
    module => module.default
  );

const compile = new Compiler(resolve);
```

`fileAttachmentsResolve` is an optional function from strings to URLs which is used as a <i>resolve</i> function in the standard library's <a href="https://github.com/observablehq/stdlib#FileAttachments">FileAttachments</a> function. For example, if you wanted to reference `example.com/my_file.png` in a cell which reads:
```javascript
await FileAttachment("my_file.png").url()
```
Then you could compile this cell with:
```javascript
const fileAttachmentsResolve = name => `example.com/${name}`;

const compile = new Compiler(, fileAttachmentsResolve);
```

By default, `fileAtachmentsResolve` simply returns the same string, so you would have to use valid absolute or relative URLs in your `FileAttachment`s.

<a href="#compile_module" name="compile_module">#</a>compile.<b>module</b>(<i>contents</i>)

Returns a define function. `contents` is a string that defines a "module", which
is a list of "cells" (both defintions from [@observablehq/parser](https://github.com/observablehq/parser)).
It must be compatible with [`parseModule`](https://github.com/observablehq/parser#parseModule).

For example:

```javascript
const define = compile.module(`a = 1
b = 2
c = a + b`);
```

You can now use `define` with the Observable [runtime](https://github.com/observablehq/runtime):

```javascript
const runtime = new Runtime();
const main = runtime.module(define, Inspector.into(document.body));
```

<a href="#compile_notebook" name="compile_notebook">#</a>compile.<b>notebook</b>(<i>object</i>)

Returns a define function. `object` is a "notebook JSON object" as used by the
ObservableHQ notebook app to display notebooks. Such JSON files are served by
the API endpoint at `https://api.observablehq.com/document/:slug` (see the
[`observable-client`](https://github.com/mootari/observable-client) for a
convenient way to authenticate and make requests).

`compile.notebook` requires that `object` has a field named `"nodes"`
consisting of an array of cell objects. Each of the cell objects must have a
field `"value"` consisting of a string with the source code for that cell.

The notebook JSON objects also ordinarily contain some other metadata fields,
e.g. `"id"`, `"slug"`, `"owner"`, etc. which are currently ignored by the
compiler. Similarly, the cell objects in `"nodes"` ordinarily contain `"id"` and
`"pinned"` fields which are also unused here.

For example:

```javascript
const define = compile.notebook({
  nodes:[
    { "value": "a = 1" },
    { "value": "b = 2" },
    { "value": "c = a + b" }
  ]
});
```

You can now use `define` with the Observable [runtime](https://github.com/observablehq/runtime):

```javascript
const runtime = new Runtime();
const main = runtime.module(define, Inspector.into(document.body));
```

<a href="#compile_cell" name="compile_cell">#</a>compile.<b>cell</b>(<i>contents</i>)

**WARNING** this isn't implemented yet! I'm not 100% sure how to structure it :/

## License

This library is MIT, but it relies and gets heavy inspiration from the following
libraries licensed under ISC:

- [@observablehq/runtime](https://github.com/observablehq/runtime)
- [@observablehq/stdlib](https://github.com/observablehq/stdlib)
- [@observablehq/inspector](https://github.com/observablehq/inspector)
- [@observablehq/parser](https://github.com/observablehq/parser)

## Contributing

Feel free to send in PR's as you wish! Take a look at the [issues](https://github.com/asg017/unofficial-observablehq-compiler/issues)
to find something to work on. Just please follow the [Contributor Covenant](https://www.contributor-covenant.org/)
in all your interactions :smile:
